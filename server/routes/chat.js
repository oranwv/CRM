const router = require('express').Router();
const { OpenAI } = require('openai');
const pool = require('../db/pool');
const requireAuth = require('../middleware/auth');
const { sendText, configured: waConfigured } = require('../services/metaWhatsapp');
const { getSignedUrl } = require('../services/storageService');

const { openai: meteredOpenAI } = require('../services/openaiClient');
const getClient = () => meteredOpenAI('assistant-chat');

const ADMIN_SET   = new Set(['admin', 'manager']);
const SALES_SET   = new Set(['admin', 'manager', 'sales_manager', 'sales']);
// Roles that see every rep's leads (lead scoping in the tools below)
const ALL_LEADS_SET = new Set(['admin', 'manager', 'sales_manager']);
const LEAD_SET    = new Set(['admin', 'manager', 'sales_manager', 'sales', 'production']);
const OPS_SET     = new Set(['admin', 'manager', 'operations', 'production']);
const SUPPLY_SET  = new Set(['admin', 'manager', 'suppliers']);
const RSVP_SET    = new Set(['admin', 'manager', 'rsvp']);

function hasRole(userRoles, set) {
  return userRoles.some(r => set.has(r));
}

const TOOL_DEFS = {
  get_my_tasks: {
    type: 'function',
    function: {
      name: 'get_my_tasks',
      description: 'מחזיר משימות ותזכורות של המשתמש שטרם הושלמו',
      parameters: {
        type: 'object',
        properties: {
          urgent_only: { type: 'boolean', description: 'true כדי להחזיר רק משימות שעבר מועדן' }
        },
        required: []
      }
    }
  },
  get_today_schedule: {
    type: 'function',
    function: {
      name: 'get_today_schedule',
      description: 'מחזיר פגישות ומשימות להיום',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  get_schedule: {
    type: 'function',
    function: {
      name: 'get_schedule',
      description: 'מחזיר פגישות, אירועים וחתונות לכל טווח תאריכים. GPT מחשב from_date/to_date לפי השאלה ("השבוע", "החודש", "השנה", "בקיץ", "במרץ" וכו\'). ניתן לבקש רק ספירה (count_only=true).',
      parameters: {
        type: 'object',
        properties: {
          from_date:  { type: 'string',  description: 'תאריך התחלה YYYY-MM-DD' },
          to_date:    { type: 'string',  description: 'תאריך סיום YYYY-MM-DD (כולל)' },
          count_only: { type: 'boolean', description: 'true אם המשתמש שואל רק כמה (ספירה, ללא רשימה)' }
        },
        required: ['from_date', 'to_date']
      }
    }
  },
  get_leads: {
    type: 'function',
    function: {
      name: 'get_leads',
      description: 'מחזיר רשימת לידים, ניתן לסנן לפי שלב, עדיפות, חיפוש שם',
      parameters: {
        type: 'object',
        properties: {
          stage: {
            type: 'string',
            enum: ['new','contacted','meeting_scheduled','meeting','offer_sent','negotiation','contract_sent','deposit','production','completed','lost'],
            description: 'שלב לסינון — מפה עברית לערך DB: חדש=new, שיחה ראשונית=contacted, נקבעה פגישה=meeting_scheduled, בוצעה פגישה=meeting, הצעת מחיר נשלחה=offer_sent, מו"מ=negotiation, חוזה נשלח=contract_sent, מקדמה=deposit, הפקה=production, הסתיים=completed, לא סגרו=lost'
          },
          priority:      { type: 'string', enum: ['דחוף','גבוה','רגיל'], description: 'עדיפות: דחוף, גבוה, רגיל' },
          search:        { type: 'string', description: 'חיפוש לפי שם' },
          limit:         { type: 'number', description: 'מספר תוצאות (ברירת מחדל 15, מקסימום 30)' },
          include_closed: { type: 'boolean', description: 'true כאשר שואלים על שלבים סגורים: deposit, production, completed, lost. ברירת מחדל: false' },
          no_open_tasks:  { type: 'boolean', description: 'true — החזר רק לידים שאין להם אף משימה פתוחה' }
        },
        required: []
      }
    }
  },
  get_lead_details: {
    type: 'function',
    function: {
      name: 'get_lead_details',
      description: 'מחזיר פרטים מלאים של ליד: אינטראקציות, משימות פתוחות',
      parameters: {
        type: 'object',
        properties: {
          lead_id: { type: 'number', description: 'מזהה הליד' }
        },
        required: ['lead_id']
      }
    }
  },
  get_urgent_leads: {
    type: 'function',
    function: {
      name: 'get_urgent_leads',
      description: 'מחזיר לידים פעילים שהאינטראקציה האחרונה איתם הייתה לפני יותר מ-N ימים, או שאין אינטראקציה בכלל. השתמש בכלי זה כשמבקשים: "לידים שלא דיברנו איתם", "לידים שצריך לחזור אליהם", "לידים ללא מענה מעל X ימים".',
      parameters: {
        type: 'object',
        properties: {
          days_without_contact: { type: 'number', description: 'ימים ללא מענה (ברירת מחדל 3)' }
        },
        required: []
      }
    }
  },
  get_op_tasks: {
    type: 'function',
    function: {
      name: 'get_op_tasks',
      description: 'מחזיר משימות תפעול',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'open, in_progress, done' }
        },
        required: []
      }
    }
  },
  get_maintenance: {
    type: 'function',
    function: {
      name: 'get_maintenance',
      description: 'מחזיר לוח תחזוקה — מה מתוכנן ומה עבר את המועד',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  get_suppliers: {
    type: 'function',
    function: {
      name: 'get_suppliers',
      description: 'מחזיר רשימת ספקים, ניתן לסנן לפי קטגוריה או חיפוש שם',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'קטגוריית ספק' },
          search:   { type: 'string', description: 'חיפוש שם ספק' }
        },
        required: []
      }
    }
  },
  get_rsvp_summary: {
    type: 'function',
    function: {
      name: 'get_rsvp_summary',
      description: 'מחזיר סיכום קמפיינים של אישורי הגעה עם ספירות מוזמנים',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },

  // ── Read tools added 2026-09-13 (landing-page roadmap: "עוזר AI לכל השאלות") ──
  get_lead_documents: {
    type: 'function',
    function: {
      name: 'get_lead_documents',
      description: 'מחזיר את המסמכים של ליד: הצעות מחיר (תאריך, סכום), חוזים (נשלח/נחתם, סכום, כמה פעמים דף החתימה נפתח), מסמכים פיננסיים (חשבוניות/קבלות שהופקו או ממתינות לאישור) וקבצים. השתמש כששואלים "נשלחה הצעה?", "החוזה נחתם?", "הופקה חשבונית?", "מה הסכום של העסקה".',
      parameters: {
        type: 'object',
        properties: { lead_id: { type: 'number', description: 'מזהה הליד' } },
        required: ['lead_id']
      }
    }
  },
  get_sales_worklist: {
    type: 'function',
    function: {
      name: 'get_sales_worklist',
      description: 'רשימת השיחות המדורגת של AI מכירות — מי הכי דחוף לטפל בו היום: חוזים שנשלחו וטרם נחתמו, הצעות מחיר פתוחות, דחופים. השתמש כששואלים "מה הכי דחוף", "למי לחזור קודם", "מה מצב המכירות".',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'כמה לידים להחזיר (ברירת מחדל 10, מקסימום 25)' } },
        required: []
      }
    }
  },
  get_analytics_kpis: {
    type: 'function',
    function: {
      name: 'get_analytics_kpis',
      description: 'מספרי אנליטיקס לתקופה: כמה לידים התקבלו, כמה הצעות וחוזים נשלחו, כמה נחתמו, כמה אבדו, אחוז סגירה, ומקורות הלידים. GPT מחשב from_date/to_date לפי השאלה ("החודש", "ספטמבר", "הרבעון").',
      parameters: {
        type: 'object',
        properties: {
          from_date: { type: 'string', description: 'YYYY-MM-DD' },
          to_date:   { type: 'string', description: 'YYYY-MM-DD (כולל)' }
        },
        required: ['from_date', 'to_date']
      }
    }
  },
  get_finance_summary: {
    type: 'function',
    function: {
      name: 'get_finance_summary',
      description: 'תמונת מצב כספים: מסמכים פיננסיים שממתינים לאישור מנהל, הוצאות שחסרה להן חשבונית בהתאמה האחרונה, חשבוניות ספקים שנסרקו מהמייל החודש, ומקדמות/תשלומים שסומנו כהתקבלו בכרטיס הליד בלי שהופקה קבלה.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  get_event_brief: {
    type: 'function',
    function: {
      name: 'get_event_brief',
      description: 'בריף ההפקה של אירוע (לפי ליד): פרטי האירוע, תפריט/שף/בר מהחוזה, הערות הבריף, ספקי האירוע, מצב הצ\'קליסט וההושבה. השתמש כששואלים על אירוע ספציפי בהפקה: "מה הספקים של האירוע של X", "מה חסר לאירוע של שבת".',
      parameters: {
        type: 'object',
        properties: { lead_id: { type: 'number', description: 'מזהה הליד' } },
        required: ['lead_id']
      }
    }
  },
  get_employee_activity: {
    type: 'function',
    function: {
      name: 'get_employee_activity',
      description: 'למנהלים: פעילות עובדים בטווח תאריכים — שיחות, פגישות, הערות, הודעות וואטסאפ, משימות שנוצרו/הושלמו, לידים שנוצרו, שעות פעילות, ותוצאות (הצעות שנשלחו, חוזים שנחתמו). השתמש כששואלים "מי עבד השבוע", "כמה שיחות עשתה נועה", "מי סגר הכי הרבה".',
      parameters: {
        type: 'object',
        properties: {
          from_date: { type: 'string', description: 'YYYY-MM-DD' },
          to_date:   { type: 'string', description: 'YYYY-MM-DD (כולל)' }
        },
        required: ['from_date', 'to_date']
      }
    }
  },

  // ── Action tools: they only PROPOSE — the user confirms in a card in the chat ──
  propose_task: {
    type: 'function',
    function: {
      name: 'propose_task',
      description: 'מציע למשתמש ליצור משימה/תזכורת (המשתמש מאשר בכרטיס בצ\'אט — שום דבר לא נשמר בלי אישור). השתמש כשהמשתמש מבקש "צור לי משימה", "תזכיר לי", "תזכורת מחר", או כשהצעת פעולה והוא אמר "כן, תעשה את זה".',
      parameters: {
        type: 'object',
        properties: {
          title:   { type: 'string', description: 'כותרת המשימה בעברית, קצרה וברורה' },
          lead_id: { type: 'number', description: 'מזהה הליד שהמשימה קשורה אליו (אם רלוונטי; חפש עם get_leads אם צריך)' },
          due_at:  { type: 'string', description: 'מועד ISO 8601 (למשל 2026-09-14T10:00:00). אם המשתמש אמר "מחר בבוקר" — 09:00 מחר' },
          assign_to_name: { type: 'string', description: 'שם העובד שיהיה אחראי, אם המשתמש ציין מישהו אחר מעצמו' }
        },
        required: ['title']
      }
    }
  },
  propose_note: {
    type: 'function',
    function: {
      name: 'propose_note',
      description: 'מציע להוסיף הערה לתיעוד של ליד (המשתמש מאשר בכרטיס). השתמש כשהמשתמש אומר "תרשום בליד ש...", "תעד ש...", "תוסיף הערה".',
      parameters: {
        type: 'object',
        properties: {
          lead_id: { type: 'number', description: 'מזהה הליד' },
          body:    { type: 'string', description: 'טקסט ההערה, בלשון המשתמש' }
        },
        required: ['lead_id', 'body']
      }
    }
  },
  propose_fault: {
    type: 'function',
    function: {
      name: 'propose_fault',
      description: 'מציע לפתוח תקלה לצוות התפעול (המשתמש מאשר בכרטיס). השתמש כשמדווחים על משהו מקולקל באולם — תאורה, מיזוג, חשמל, ציוד — או כשמדריך התפעול לא פתר את הבעיה. אם יש מדריך רלוונטי ב-[[file:ID]], הזכר אותו בתיאור.',
      parameters: {
        type: 'object',
        properties: {
          title:       { type: 'string', description: 'כותרת התקלה, קצרה' },
          description: { type: 'string', description: 'תיאור: מה קרה, איפה, מה כבר נוסה' }
        },
        required: ['title']
      }
    }
  }
};

const FIN_SET = new Set(['admin', 'manager', 'finance']);

function getToolsForUser(userRoles) {
  const tools = [TOOL_DEFS.get_my_tasks, TOOL_DEFS.propose_task];
  if (hasRole(userRoles, LEAD_SET))   tools.push(TOOL_DEFS.get_today_schedule, TOOL_DEFS.get_schedule);
  if (hasRole(userRoles, LEAD_SET))   tools.push(TOOL_DEFS.get_leads, TOOL_DEFS.get_lead_details, TOOL_DEFS.get_lead_documents, TOOL_DEFS.propose_note);
  if (hasRole(userRoles, SALES_SET))  tools.push(TOOL_DEFS.get_urgent_leads, TOOL_DEFS.get_sales_worklist, TOOL_DEFS.get_analytics_kpis);
  if (hasRole(userRoles, OPS_SET))    tools.push(TOOL_DEFS.get_op_tasks, TOOL_DEFS.get_maintenance, TOOL_DEFS.get_event_brief, TOOL_DEFS.propose_fault);
  if (hasRole(userRoles, SUPPLY_SET)) tools.push(TOOL_DEFS.get_suppliers);
  if (hasRole(userRoles, RSVP_SET))   tools.push(TOOL_DEFS.get_rsvp_summary);
  if (hasRole(userRoles, FIN_SET))    tools.push(TOOL_DEFS.get_finance_summary);
  if (hasRole(userRoles, ADMIN_SET))  tools.push(TOOL_DEFS.get_employee_activity);
  return tools;
}

async function executeTool(name, args, user) {
  const userRoles = user.roles?.length ? user.roles : [user.role];
  const uid  = user.id;
  const isAM = hasRole(userRoles, ALL_LEADS_SET);

  switch (name) {
    case 'get_my_tasks': {
      const { urgent_only } = args;
      let sql = `
        SELECT t.id, t.title, t.due_at, l.name AS lead_name, l.id AS lead_id, l.phone AS lead_phone
        FROM tasks t
        LEFT JOIN leads l ON l.id = t.lead_id
        WHERE t.assigned_to = $1 AND t.completed_at IS NULL
      `;
      if (urgent_only) sql += ` AND t.due_at IS NOT NULL AND t.due_at < NOW()`;
      sql += ` ORDER BY t.due_at ASC NULLS LAST LIMIT 20`;
      const { rows } = await pool.query(sql, [uid]);
      return rows;
    }

    case 'get_today_schedule': {
      const { rows: tasks } = await pool.query(`
        SELECT 'task' AS type, t.id, t.title, t.due_at AS time,
               l.name AS lead_name, l.id AS lead_id, l.phone AS lead_phone
        FROM tasks t
        LEFT JOIN leads l ON l.id = t.lead_id
        WHERE t.assigned_to = $1 AND t.completed_at IS NULL
          AND t.due_at IS NOT NULL AND t.due_at::date = CURRENT_DATE
      `, [uid]);

      const { rows: meetings } = await pool.query(`
        SELECT 'meeting' AS type, m.id, m.title, m.start_time AS time,
               l.name AS lead_name, l.id AS lead_id, l.phone AS lead_phone
        FROM meetings m
        JOIN leads l ON l.id = m.lead_id
        WHERE m.start_time::date = CURRENT_DATE
          AND ($1 = true OR l.assigned_to = $2)
        ORDER BY m.start_time ASC LIMIT 20
      `, [isAM, uid]);

      return [...tasks, ...meetings].sort((a, b) => {
        if (!a.time) return 1;
        if (!b.time) return -1;
        return new Date(a.time) - new Date(b.time);
      });
    }

    case 'get_schedule': {
      const { from_date, to_date, count_only = false } = args;

      const { rows: meetings } = await pool.query(`
        SELECT 'meeting' AS type, m.id, m.title, m.start_time AS time,
               l.name AS lead_name, l.id AS lead_id, l.phone AS lead_phone
        FROM meetings m
        JOIN leads l ON l.id = m.lead_id
        WHERE m.start_time::date >= $1::date AND m.start_time::date <= $2::date
          AND ($3 = true OR l.assigned_to = $4)
        ORDER BY m.start_time ASC LIMIT 100
      `, [from_date, to_date, isAM, uid]);

      const { rows: events } = await pool.query(`
        SELECT 'event' AS type, l.id, l.event_date::text AS time,
               l.event_type, l.guest_count, l.event_time,
               l.name AS lead_name, l.id AS lead_id, l.phone AS lead_phone
        FROM leads l
        WHERE l.event_date >= $1::date AND l.event_date <= $2::date
          AND l.stage NOT IN ('cancelled','lost')
          AND ($3 = true OR l.assigned_to = $4)
        ORDER BY l.event_date ASC LIMIT 100
      `, [from_date, to_date, isAM, uid]);

      const { rows: tasks } = await pool.query(`
        SELECT 'task' AS type, t.id, t.title, t.due_at AS time,
               l.name AS lead_name, l.id AS lead_id, l.phone AS lead_phone
        FROM tasks t
        LEFT JOIN leads l ON l.id = t.lead_id
        WHERE t.assigned_to = $1 AND t.completed_at IS NULL
          AND t.due_at::date >= $2::date AND t.due_at::date <= $3::date
        ORDER BY t.due_at ASC LIMIT 100
      `, [uid, from_date, to_date]);

      if (count_only) {
        return { meetings: meetings.length, events: events.length, tasks: tasks.length, total: meetings.length + events.length + tasks.length };
      }

      return [...meetings, ...events, ...tasks].sort((a, b) => {
        if (!a.time) return 1;
        if (!b.time) return -1;
        return new Date(a.time) - new Date(b.time);
      });
    }

    case 'get_leads': {
      const { stage, priority, search, limit = 15, include_closed = false, no_open_tasks = false } = args;
      const params = [isAM, uid];
      let cond = '($1 = true OR assigned_to = $2)';
      if (!include_closed && !stage) {
        cond += ` AND stage NOT IN ('deposit','production','completed','lost')`;
      }
      if (stage)         { cond += ` AND stage = $${params.push(stage)}`; }
      if (priority)      { cond += ` AND priority = $${params.push(priority)}`; }
      if (search)        { cond += ` AND name ILIKE $${params.push('%' + search + '%')}`; }
      if (no_open_tasks) { cond += ` AND NOT EXISTS (SELECT 1 FROM tasks WHERE lead_id = leads.id AND completed_at IS NULL)`; }
      const cap = Math.min(Number(limit) || 15, 30);
      const { rows } = await pool.query(`
        SELECT id, name, phone, event_type, event_date, stage, priority, guest_count, budget
        FROM leads
        WHERE ${cond}
        ORDER BY CASE WHEN priority='דחוף' THEN 0 WHEN priority='גבוה' THEN 1 ELSE 2 END,
                 created_at DESC
        LIMIT $${params.push(cap)}
      `, params);
      return rows;
    }

    case 'get_lead_details': {
      const { lead_id } = args;
      const { rows: [lead] } = await pool.query(`
        SELECT id, name, phone, email, event_type, event_date, stage, priority,
               guest_count, budget, notes
        FROM leads
        WHERE id = $1 AND ($2 = true OR assigned_to = $3)
      `, [lead_id, isAM, uid]);
      if (!lead) return { error: 'ליד לא נמצא' };

      const { rows: interactions } = await pool.query(`
        SELECT type, direction, body, created_at
        FROM lead_interactions
        WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 5
      `, [lead_id]);

      const { rows: openTasks } = await pool.query(`
        SELECT title, due_at FROM tasks
        WHERE lead_id = $1 AND completed_at IS NULL ORDER BY due_at ASC LIMIT 5
      `, [lead_id]);

      return { ...lead, recent_interactions: interactions, open_tasks: openTasks };
    }

    case 'get_urgent_leads': {
      const days = Number(args.days_without_contact) || 3;
      const { rows } = await pool.query(`
        SELECT l.id, l.name, l.phone, l.stage, l.priority, l.event_date,
               MAX(li.created_at) AS last_interaction
        FROM leads l
        LEFT JOIN lead_interactions li ON li.lead_id = l.id
        WHERE ($1 = true OR l.assigned_to = $2)
          AND l.stage NOT IN ('deposit','production','completed','lost')
        GROUP BY l.id
        HAVING MAX(li.created_at) < NOW() - ($3::int * INTERVAL '1 day')
            OR MAX(li.created_at) IS NULL
        ORDER BY CASE WHEN l.priority='דחוף' THEN 0 WHEN l.priority='גבוה' THEN 1 ELSE 2 END
        LIMIT 20
      `, [isAM, uid, days]);
      return rows;
    }

    case 'get_op_tasks': {
      const { status } = args;
      const params = [isAM, uid];
      let cond = '($1 = true OR ot.assigned_to = $2)';
      if (status) cond += ` AND ot.status = $${params.push(status)}`;
      const { rows } = await pool.query(`
        SELECT ot.id, ot.title, ot.description, ot.priority, ot.status, ot.due_date,
               u.display_name AS assignee_name
        FROM op_tasks ot
        LEFT JOIN users u ON u.id = ot.assigned_to
        WHERE ${cond}
        ORDER BY
          CASE WHEN ot.status='open' THEN 0 WHEN ot.status='in_progress' THEN 1 ELSE 2 END,
          CASE WHEN ot.priority='high' THEN 0 WHEN ot.priority='medium' THEN 1 ELSE 2 END
        LIMIT 30
      `, params);
      return rows;
    }

    case 'get_maintenance': {
      const { rows } = await pool.query(`
        SELECT om.id, om.name, om.interval_days, om.last_done, om.next_due,
               u.display_name AS assignee_name
        FROM op_maintenance om
        LEFT JOIN users u ON u.id = om.assignee_id
        ORDER BY om.next_due ASC NULLS LAST LIMIT 20
      `);
      return rows;
    }

    case 'get_suppliers': {
      const { category, search } = args;
      const params = [];
      let cond = '1=1';
      if (category) cond += ` AND category = $${params.push(category)}`;
      if (search)   cond += ` AND name ILIKE $${params.push('%' + search + '%')}`;
      const { rows } = await pool.query(`
        SELECT id, name, phone, email, category
        FROM suppliers
        WHERE ${cond} ORDER BY category, name LIMIT 50
      `, params);
      return rows;
    }

    case 'get_rsvp_summary': {
      const { rows } = await pool.query(`
        SELECT rc.id, rc.name, rc.status, rc.host_name,
               COUNT(rg.id)                                           AS total_guests,
               COUNT(rg.id) FILTER (WHERE rg.state = 'confirmed')    AS confirmed,
               COUNT(rg.id) FILTER (WHERE rg.state = 'declined')     AS declined,
               COUNT(rg.id) FILTER (WHERE rg.state = 'invited')      AS invited,
               COUNT(rg.id) FILTER (WHERE rg.state = 'not_sent')     AS not_sent
        FROM rsvp_campaigns rc
        LEFT JOIN rsvp_guests rg ON rg.campaign_id = rc.id
        GROUP BY rc.id ORDER BY rc.created_at DESC LIMIT 10
      `);
      return rows;
    }

    case 'get_lead_documents': {
      const leadId = Number(args.lead_id);
      const { rows: [lead] } = await pool.query(
        'SELECT id, name, stage FROM leads WHERE id = $1 AND ($2 = true OR assigned_to = $3)', [leadId, isAM, uid]
      );
      if (!lead) return { error: 'ליד לא נמצא' };
      const [{ rows: offers }, { rows: contracts }, { rows: pending }, { rows: files }] = await Promise.all([
        pool.query('SELECT id, fields, rows, offer_type, created_at FROM price_offers WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 5', [leadId]),
        pool.query(`SELECT c.id, c.status, c.sent_via, c.created_at, c.signed_at, c.signer_name, c.contract_data,
                           (SELECT COUNT(*)::int FROM contract_views v WHERE v.contract_id = c.id) AS views,
                           (SELECT MAX(viewed_at) FROM contract_views v WHERE v.contract_id = c.id) AS last_viewed_at
                    FROM contracts c WHERE c.lead_id = $1 ORDER BY c.created_at DESC LIMIT 5`, [leadId]),
        pool.query(`SELECT id, status, payload, created_at, filename FROM pending_documents WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 10`, [leadId]),
        pool.query(`SELECT id, filename, created_at FROM files WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 15`, [leadId]),
      ]);
      const { offerTotal, contractTotal } = require('../services/salesAdvisor');
      return {
        lead,
        offers: offers.map(o => ({ id: o.id, created_at: o.created_at, type: o.offer_type, total: offerTotal(o.rows, o.fields) })),
        contracts: contracts.map(c => ({
          id: c.id, status: c.status, sent_via: c.sent_via, created_at: c.created_at, signed_at: c.signed_at,
          signer_name: c.signer_name, total: contractTotal(c.contract_data), views: c.views, last_viewed_at: c.last_viewed_at,
        })),
        financial_docs: pending.map(p => ({ id: p.id, status: p.status, type: p.payload?.type, created_at: p.created_at, filename: p.filename,
          amount: (p.payload?.items || []).reduce((s, it) => s + Number(it.price || 0) * Number(it.quantity || 0), 0) })),
        issued_files: files.filter(f => /^(חשבונית|קבלה|מסמך)/.test(f.filename || '')).map(f => ({ id: f.id, filename: f.filename, created_at: f.created_at })),
        files: files.map(f => ({ id: f.id, filename: f.filename, created_at: f.created_at })),
      };
    }

    case 'get_sales_worklist': {
      const { getWorklist } = require('../services/salesAdvisor');
      const cap = Math.min(Number(args.limit) || 10, 25);
      const items = await getWorklist(user);
      return { total: items.length, items: items.slice(0, cap) };
    }

    case 'get_analytics_kpis': {
      const { from_date, to_date } = args;
      const p = [from_date, to_date];
      const [{ rows: [tot] }, { rows: src }] = await Promise.all([
        pool.query(`
          SELECT
            (SELECT COUNT(*)::int FROM leads WHERE created_at::date BETWEEN $1::date AND $2::date) AS received,
            (SELECT COUNT(DISTINCT lead_id)::int FROM price_offers WHERE created_at::date BETWEEN $1::date AND $2::date) AS offers_sent,
            (SELECT COUNT(DISTINCT lead_id)::int FROM contracts WHERE created_at::date BETWEEN $1::date AND $2::date) AS contracts_sent,
            (SELECT COUNT(DISTINCT lead_id)::int FROM contracts WHERE status = 'signed' AND signed_at::date BETWEEN $1::date AND $2::date) AS contracts_signed,
            (SELECT COALESCE(SUM((contract_data->'calculated'->>'subtotal')::numeric),0)::int FROM contracts WHERE status = 'signed' AND signed_at::date BETWEEN $1::date AND $2::date) AS signed_amount,
            (SELECT COUNT(DISTINCT lead_id)::int FROM lead_interactions WHERE type = 'note' AND body LIKE '%שינוי שלב%' AND body LIKE '%← אבוד%' AND created_at::date BETWEEN $1::date AND $2::date) AS lost,
            (SELECT COUNT(*)::int FROM meetings WHERE start_time::date BETWEEN $1::date AND $2::date) AS meetings
        `, p),
        pool.query(`SELECT COALESCE(source,'manual') AS source, COUNT(*)::int AS n FROM leads
                    WHERE created_at::date BETWEEN $1::date AND $2::date GROUP BY 1 ORDER BY 2 DESC`, p),
      ]);
      const closeRate = tot.received ? Math.round(100 * tot.contracts_signed / tot.received) : null;
      return { from_date, to_date, ...tot, close_rate_pct: closeRate, by_source: src };
    }

    case 'get_finance_summary': {
      const isMgr = hasRole(userRoles, ADMIN_SET);
      const [{ rows: [pend] }, { rows: [period] }, { rows: [scan] }, { rows: signals }] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM((SELECT SUM((it->>'price')::numeric * (it->>'quantity')::numeric) FROM jsonb_array_elements(payload->'items') it)),0)::int AS amount
                    FROM pending_documents WHERE status = 'pending'`),
        pool.query(`SELECT p.id, p.name,
                           (SELECT COUNT(*)::int FROM finance_missing_expenses e WHERE e.period_id = p.id AND e.resolved = false) AS open_items,
                           (SELECT COALESCE(SUM(amount),0)::int FROM finance_missing_expenses e WHERE e.period_id = p.id AND e.resolved = false) AS open_amount
                    FROM finance_periods p ORDER BY p.created_at DESC LIMIT 1`),
        pool.query(`SELECT COUNT(*)::int AS n, MAX(created_at) AS last_at FROM finance_invoice_files WHERE created_at > NOW() - INTERVAL '30 days'`),
        pool.query(`SELECT s.id, s.lead_id, l.name AS lead_name, s.kind, s.amount, s.said_at, s.snippet
                    FROM payment_signals s JOIN leads l ON l.id = s.lead_id
                    WHERE s.status = 'open' ORDER BY s.detected_at DESC LIMIT 10`),
      ]);
      return {
        pending_approvals: isMgr ? pend : { n: pend.n },
        last_reconciliation: period || null,
        invoices_scanned_30d: scan,
        payments_without_document: signals,
      };
    }

    case 'get_event_brief': {
      const leadId = Number(args.lead_id);
      const [{ rows: [lead] }, { rows: [contract] }, { rows: [brief] }, { rows: checklist }, { rows: sups }, { rows: [seat] }] = await Promise.all([
        pool.query(`SELECT id, name, event_type, event_date, event_time, event_end_time, guest_count, stage, event_name FROM leads WHERE id = $1`, [leadId]),
        pool.query(`SELECT contract_data FROM contracts WHERE lead_id = $1 ORDER BY (status='signed') DESC, created_at DESC LIMIT 1`, [leadId]),
        pool.query(`SELECT data, updated_at FROM event_briefs WHERE lead_id = $1`, [leadId]),
        pool.query(`SELECT item_key, checked_at FROM production_checklist WHERE lead_id = $1 AND checked_at IS NOT NULL`, [leadId]),
        pool.query(`SELECT s.name, s.category, s.phone FROM lead_suppliers ls JOIN suppliers s ON s.id = ls.supplier_id WHERE ls.lead_id = $1`, [leadId]),
        pool.query(`SELECT COUNT(*)::int AS sections FROM seating_layouts WHERE lead_id = $1 AND jsonb_array_length(elements) > 0`, [leadId]),
      ]);
      if (!lead) return { error: 'ליד לא נמצא' };
      const cd = contract?.contract_data || {};
      const briefData = brief?.data || {};
      const briefSuppliers = [];
      for (const [cat, list] of Object.entries(briefData.categorySuppliers || {})) {
        for (const s of (Array.isArray(list) ? list : [])) briefSuppliers.push({ category: cat, name: s.name, phone: s.phone });
      }
      return {
        lead,
        contract_fields: cd.fields ? { chef: cd.fields.chef, bar: cd.fields.bar, guests: cd.fields.guests, total: cd.calculated?.total } : null,
        brief: briefData,
        brief_updated_at: brief?.updated_at || null,
        checklist_done: checklist.map(c => c.item_key),
        suppliers: [...sups, ...briefSuppliers],
        seating_sections_with_elements: seat?.sections || 0,
      };
    }

    case 'get_employee_activity': {
      const { from_date, to_date } = args;
      const p = [from_date, to_date];
      const { rows } = await pool.query(`
        WITH ev AS (
          SELECT created_by AS uid, 'calls'::text AS metric FROM lead_interactions WHERE type='call' AND direction='outbound' AND created_at::date BETWEEN $1::date AND $2::date
          UNION ALL SELECT created_by, 'meetings' FROM lead_interactions WHERE type='meeting' AND created_at::date BETWEEN $1::date AND $2::date
          UNION ALL SELECT created_by, 'notes' FROM lead_interactions WHERE type='note' AND created_at::date BETWEEN $1::date AND $2::date
          UNION ALL SELECT sent_by, 'wa_sent' FROM messages WHERE direction='outbound' AND timestamp::date BETWEEN $1::date AND $2::date
          UNION ALL SELECT created_by, 'tasks_created' FROM tasks WHERE created_at::date BETWEEN $1::date AND $2::date
          UNION ALL SELECT assigned_to, 'tasks_completed' FROM tasks WHERE completed_at::date BETWEEN $1::date AND $2::date
          UNION ALL SELECT created_by, 'leads_created' FROM leads WHERE created_at::date BETWEEN $1::date AND $2::date
          UNION ALL SELECT created_by, 'contracts_sent' FROM contracts WHERE created_at::date BETWEEN $1::date AND $2::date
          UNION ALL SELECT c.created_by, 'contracts_signed' FROM contracts c WHERE c.status='signed' AND c.signed_at::date BETWEEN $1::date AND $2::date
        ),
        agg AS (SELECT uid, metric, COUNT(*)::int AS n FROM ev WHERE uid IS NOT NULL GROUP BY uid, metric),
        hours AS (
          SELECT user_id AS uid, ROUND(SUM(EXTRACT(EPOCH FROM (last_ping_at - started_at)))/3600)::int AS hours
          FROM user_sessions WHERE started_at::date BETWEEN $1::date AND $2::date GROUP BY user_id
        )
        SELECT u.id, u.display_name,
               COALESCE(jsonb_object_agg(a.metric, a.n) FILTER (WHERE a.metric IS NOT NULL), '{}'::jsonb) AS metrics,
               COALESCE(MAX(h.hours), 0) AS hours
        FROM users u
        LEFT JOIN agg a ON a.uid = u.id
        LEFT JOIN hours h ON h.uid = u.id
        WHERE u.blocked = false
        GROUP BY u.id, u.display_name
        HAVING COUNT(a.metric) > 0 OR MAX(h.hours) > 0
        ORDER BY u.display_name
      `, p);
      return { from_date, to_date, employees: rows };
    }

    // ── Proposals: nothing is written here. The route turns the returned proposal into an
    //    SSE "action" event, the client renders a confirm card, and POST /api/chat/actions
    //    executes it with the user's own credentials.
    case 'propose_task': {
      const title = String(args.title || '').trim();
      if (!title) return { error: 'חסרה כותרת' };
      let lead = null;
      if (args.lead_id) {
        const { rows } = await pool.query('SELECT id, name FROM leads WHERE id = $1', [Number(args.lead_id)]);
        lead = rows[0] || null;
      }
      let assignee = null;
      if (args.assign_to_name) {
        const { rows } = await pool.query(
          `SELECT id, display_name FROM users WHERE blocked = false AND (display_name ILIKE $1 OR username ILIKE $1) LIMIT 1`,
          [`%${args.assign_to_name}%`]
        );
        assignee = rows[0] || null;
      }
      return {
        proposal: {
          kind: 'task', title,
          lead_id: lead?.id || null, lead_name: lead?.name || null,
          due_at: args.due_at || null,
          assigned_to: assignee?.id || uid, assigned_name: assignee?.display_name || (user.display_name || user.username),
        },
      };
    }

    case 'propose_note': {
      const { rows } = await pool.query('SELECT id, name FROM leads WHERE id = $1 AND ($2 = true OR assigned_to = $3)', [Number(args.lead_id), isAM, uid]);
      if (!rows[0]) return { error: 'ליד לא נמצא' };
      const body = String(args.body || '').trim();
      if (!body) return { error: 'חסר טקסט להערה' };
      return { proposal: { kind: 'note', lead_id: rows[0].id, lead_name: rows[0].name, body } };
    }

    case 'propose_fault': {
      const title = String(args.title || '').trim();
      if (!title) return { error: 'חסרה כותרת' };
      return { proposal: { kind: 'fault', title, description: String(args.description || '').trim() || null } };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

async function alertManagers(user, question) {
  if (!waConfigured()) return;
  try {
    const { rows } = await pool.query(`
      SELECT phone FROM users
      WHERE (role IN ('admin','manager') OR roles && ARRAY['admin','manager']::text[])
        AND phone IS NOT NULL AND phone <> '' AND blocked = false
    `);
    const msg = `⚠️ ניסיון גישה לא מורשה ב-AI\nמשתמש: ${user.display_name || user.username} (${(user.roles || [user.role]).join(', ')})\nשאלה: ${question}`;
    for (const { phone } of rows) {
      const normalized = phone.replace(/\D/g, '').replace(/^0/, '972');
      sendText(normalized, msg).catch(() => {});
    }
  } catch {
    // non-blocking
  }
}

function formatLeads(rows) {
  if (!rows?.length) return 'לא נמצאו לידים.';
  return rows.map(r =>
    `- [${r.name}](/?lead=${r.id})` +
    (r.phone ? ` | [${r.phone}](tel:${r.phone})` : '') +
    (r.event_type ? ` | ${r.event_type}` : '') +
    (r.event_date ? ` | ${r.event_date}` : '') +
    (r.stage ? ` | שלב: ${r.stage}` : '') +
    (r.priority && r.priority !== 'רגיל' ? ` | עדיפות: ${r.priority}` : '')
  ).join('\n');
}

function formatToolResult(name, result) {
  if (result?.error) return `שגיאה: ${result.error}`;

  switch (name) {
    case 'get_leads':
    case 'get_urgent_leads':
      return formatLeads(result);

    case 'get_lead_details': {
      if (!result || result.error) return result?.error || 'לא נמצא';
      const lines = [
        `[${result.name}](/?lead=${result.id})` +
          (result.phone ? ` | [${result.phone}](tel:${result.phone})` : ''),
        result.event_type   ? `סוג אירוע: ${result.event_type}`   : '',
        result.event_date   ? `תאריך: ${result.event_date}`        : '',
        result.guest_count  ? `מוזמנים: ${result.guest_count}`     : '',
        result.stage        ? `שלב: ${result.stage}`               : '',
        result.notes        ? `הערות: ${result.notes}`             : '',
      ].filter(Boolean);
      if (result.recent_interactions?.length) {
        lines.push('אינטראקציות אחרונות:');
        result.recent_interactions.forEach(i =>
          lines.push(`  - ${i.type}: ${(i.body || '').slice(0, 80)}`)
        );
      }
      if (result.open_tasks?.length) {
        lines.push('משימות פתוחות:');
        result.open_tasks.forEach(t => lines.push(`  - ${t.title}`));
      }
      return lines.join('\n');
    }

    case 'get_today_schedule': {
      if (!result?.length) return 'אין פגישות או משימות להיום.';
      return result.map(item => {
        const time = item.time
          ? new Date(item.time).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
          : '';
        const leadPart = item.lead_name && item.lead_id
          ? ` | [${item.lead_name}](/?lead=${item.lead_id})` +
            (item.lead_phone ? ` [${item.lead_phone}](tel:${item.lead_phone})` : '')
          : '';
        return `- ${time} ${item.type === 'meeting' ? 'פגישה' : 'משימה'}: ${item.title}${leadPart}`;
      }).join('\n');
    }

    case 'get_schedule': {
      if (result && !Array.isArray(result) && 'total' in result) {
        return `סה"כ ${result.total} פריטים: ${result.events} אירועים, ${result.meetings} פגישות, ${result.tasks} משימות.`;
      }
      if (!result?.length) return 'אין פגישות, אירועים או משימות בתקופה זו.';
      return result.map(item => {
        const d = item.time ? new Date(item.time) : null;
        const dateStr = d
          ? d.toLocaleDateString('he-IL', { weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit' })
          : '';
        const timeStr = item.type !== 'event' && d
          ? ` ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}` : '';
        const typeLabel = item.type === 'event' ? 'אירוע' : item.type === 'meeting' ? 'פגישה' : 'משימה';
        const leadPart = item.lead_name && item.lead_id ? ` | [${item.lead_name}](/?lead=${item.lead_id})` : '';
        const extra = item.event_type ? ` ${item.event_type}` : '';
        const guests = item.guest_count ? ` (${item.guest_count} אורחים)` : '';
        const eventTime = item.event_time ? ` ${item.event_time}` : '';
        return `- ${dateStr}${timeStr}${eventTime} ${typeLabel}${extra}${guests}${leadPart}`;
      }).join('\n');
    }

    case 'get_sales_worklist': {
      if (!result?.items?.length) return 'אין לידים ברשימת השיחות.';
      const tierName = { 1: 'חוזה נשלח וטרם נחתם', 2: 'הצעת מחיר נשלחה', 3: 'דחוף / חם' };
      return `סה"כ ${result.total} לידים ברשימה. הראשונים לפי סדר עדיפות:\n` + result.items.map((it, i) =>
        `${i + 1}. [${it.name}](/?lead=${it.lead_id})` + (it.phone ? ` | [${it.phone}](tel:${it.phone})` : '') +
        ` | ${tierName[it.tier] || ''}` + (it.rep ? ` | נציג: ${it.rep}` : '') +
        (it.event_type ? ` | ${it.event_type}` : '') + (it.event_date ? ` | אירוע ${String(it.event_date).slice(0, 10)}` : '') +
        (it.deal_value ? ` | שווי ₪${Number(it.deal_value).toLocaleString('he-IL')}` : '') +
        (it.temperature ? ` | טמפרטורה: ${it.temperature}` : '') +
        (it.last_contact ? ` | קשר אחרון: ${it.last_contact.direction === 'inbound' ? 'הלקוח כתב' : 'אנחנו'} "${String(it.last_contact.body || '').slice(0, 60)}"` : ' | אין קשר מתועד') +
        (it.days_since_contact != null && it.days_since_contact < 900 ? ` (לפני ${it.days_since_contact} ימים)` : '')
      ).join('\n');
    }

    case 'propose_task':
    case 'propose_note':
    case 'propose_fault':
      if (result?.proposal) {
        return 'ההצעה הוצגה למשתמש ככרטיס אישור בצ\'אט. אל תקרא לכלי שוב עבור אותה פעולה. כתוב משפט קצר אחד שמסביר מה הצעת ושהוא יכול לאשר או לערוך בכרטיס. אל תכתוב שהמשימה/ההערה/התקלה נוצרה — היא עדיין ממתינה לאישור.';
      }
      return JSON.stringify(result);

    default:
      return JSON.stringify(result, null, 2);
  }
}

// POST /api/chat
router.post('/', requireAuth, async (req, res) => {
  const { message, history = [], context = {} } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message required' });
  }

  const user      = req.user;
  const userRoles = user.roles?.length ? user.roles : [user.role];
  const tools     = getToolsForUser(userRoles);
  const toolNames = new Set(tools.map(t => t.function.name));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let closed = false;
  res.on('close', () => { closed = true; });

  function sse(event, data) {
    if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  try {
    const openai = getClient();

    const today = new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const modeHint = context.mode ? `\nהמשתמש נמצא כרגע במסך: ${context.mode}` : '';
    let leadContext = '';
    if (context.leadId) {
      const leadDetails = await executeTool('get_lead_details', { lead_id: Number(context.leadId) }, user);
      leadContext = `\n\nפרטי הליד שהמשתמש מסתכל עליו כרגע:\n${formatToolResult('get_lead_details', leadDetails)}`;
    }

    // Load knowledge base from DB
    const [{ rows: [knowledgeRow] }, { rows: kbFiles }, { rows: kbMedia }] = await Promise.all([
      pool.query("SELECT value FROM settings WHERE key = 'ai_knowledge_text'"),
      pool.query("SELECT id, filename, content_text, stored_name FROM ai_knowledge_files ORDER BY created_at DESC"),
      pool.query("SELECT id, title, description, media_type FROM ai_knowledge_media ORDER BY created_at DESC"),
    ]);
    const mediaSection = kbMedia.length
      ? `\n\n## מדיה זמינה להצגה למשתמש:\nכשזה עוזר לתשובה (למשל שאלה "איך מפעילים..."), הצג את המדיה על ידי כתיבת התגית בשורה נפרדת בדיוק בפורמט [[media:ID]] — בנוסף להסבר טקסטואלי. הצג רק מדיה רלוונטית, ואל תמציא מזהים.\n`
        + kbMedia.map(m => `- [[media:${m.id}]] — ${m.title}${m.description ? `: ${m.description}` : ''} (${m.media_type === 'image' ? 'תמונה' : 'סרטון'})`).join('\n')
      : '';
    const sendableFiles = kbFiles.filter(f => f.stored_name);
    const filesSection = sendableFiles.length
      ? `\n\n## קבצים שאפשר למסור למשתמש (להורדה או לשליחה בוואטסאפ):\nכשהמשתמש מבקש קובץ/מסמך/טופס/תעודה ("תשלח לי את...", "צריך את פרטי החשבון", "הלקוח מבקש תעודת כשרות"), כתוב את התגית בשורה נפרדת בדיוק בפורמט [[file:ID]] — הצ'אט יציג אותו כקובץ עם כפתורי הורדה ושליחה. אפשר גם לצטט מהתוכן. אל תמציא מזהים.\n`
        + sendableFiles.map(f => `- [[file:${f.id}]] — ${f.filename}`).join('\n')
      : '';
    const knowledgeParts = [
      knowledgeRow?.value?.trim() ? `## מידע כללי על שרביה:\n${knowledgeRow.value.trim()}` : '',
      ...kbFiles.map(f => `## מסמך${f.stored_name ? ` [[file:${f.id}]]` : ''}: ${f.filename}\n${f.content_text}`)
    ].filter(Boolean);
    const knowledgeSection = (knowledgeParts.length ? '\n\n' + knowledgeParts.join('\n\n') : '') + mediaSection + filesSection;

    const systemPrompt = `אתה עוזר AI של מערכת CRM שרביה.
אתה מסייע ל-${user.display_name || user.username} (תפקיד: ${userRoles.join(', ')}).${modeHint}${leadContext}
תאריך היום: ${today}

כללים:
- ענה תמיד בעברית, בצורה תמציתית ומועילה
- אתה קורא נתונים; פעולות (משימה, הערה בליד, תקלה) אתה רק מציע דרך הכלים propose_* — המשתמש מאשר בכרטיס. אל תטען שביצעת משהו.
- כשהמשתמש מדווח על תקלה באולם (תאורה, חשמל, מיזוג, ציוד): קודם ענה מתוך מדריכי התפעול אם יש, ואז הצע לפתוח תקלה לתפעול (propose_fault) אם זה לא נפתר.
- כששואלים "מה הלו"ז שלי ומה הכי דחוף" — שלב לו"ז היום עם רשימת AI מכירות ומשימות שעבר מועדן, ותן תשובה מסודרת לפי סדר עדיפות.
- כשמציין ליד, צרף: [שם](/?lead=ID) וטלפון: [מספר](tel:מספר)
- כשמציין ספק, צרף: [שם](/suppliers?id=ID) וטלפון: [מספר](tel:מספר)
- אל תמציא קישורים לקבצים/מדיה ואל תכתוב כתובות אחסון (למשל supabase.co). מדיה אפשר להציג רק דרך תגית [[media:ID]] מתוך הרשימה למטה. אם אין קובץ/מדיה מתאימים — אמור זאת במפורש ואל תמציא קישור.${knowledgeSection}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-14),
      { role: 'user', content: message }
    ];

    let currentMessages = [...messages];
    const MAX_TURNS = 5;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (closed) break;

      const stream = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 1024,
        messages: currentMessages,
        tools: tools.length ? tools : undefined,
        tool_choice: tools.length ? 'auto' : undefined,
        stream: true,
      });

      let content = '';
      const toolCalls = [];
      let finishReason = null;

      for await (const chunk of stream) {
        if (closed) break;
        const choice = chunk.choices[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;

        const delta = choice.delta;
        if (delta?.content) {
          content += delta.content;
          sse('text', { chunk: delta.content });
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const i = tc.index;
            if (!toolCalls[i]) toolCalls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } };
            if (tc.id)                    toolCalls[i].id                    += tc.id;
            if (tc.function?.name)        toolCalls[i].function.name        += tc.function.name;
            if (tc.function?.arguments)   toolCalls[i].function.arguments   += tc.function.arguments;
          }
        }
      }

      if (finishReason === 'tool_calls') {
        currentMessages.push({
          role: 'assistant',
          content: content || null,
          tool_calls: toolCalls.filter(Boolean)
        });

        for (const tc of toolCalls.filter(Boolean)) {
          if (!toolNames.has(tc.function.name)) {
            await alertManagers(user, message);
            sse('error', { message: 'אין לך הרשאה לגשת למידע זה. המנהלים קיבלו התראה.' });
            res.end();
            return;
          }

          let args = {};
          try { args = JSON.parse(tc.function.arguments); } catch {}

          sse('tool_call', { name: tc.function.name });
          const result = await executeTool(tc.function.name, args, user);
          if (result?.proposal) sse('action', { id: tc.id, ...result.proposal });

          currentMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: formatToolResult(tc.function.name, result)
          });
        }
        continue;
      }

      // finish_reason === 'stop'
      sse('done', {});
      res.end();
      return;
    }

    sse('done', {});
    res.end();
  } catch (err) {
    console.error('[Chat] error:', err.message);
    sse('error', { message: 'שגיאה פנימית. נסה שוב.' });
    res.end();
  }
});

// GET /api/chat/media — media map for rendering [[media:ID]] tags the assistant emits
router.get('/media', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, title, url, media_type, source, stored_name FROM ai_knowledge_media'
    );
    // Uploaded files live in a private bucket — the stored public URL 404s, so sign at read time.
    const items = await Promise.all(rows.map(async ({ stored_name, ...item }) => {
      if (stored_name) {
        try { item.url = await getSignedUrl(stored_name, 6 * 60 * 60); }
        catch (err) { console.error('[Chat] media sign error:', err.message); }
      }
      return item;
    }));
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/files — knowledge files the assistant may hand over ([[file:ID]] chips)
router.get('/files', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, filename, stored_name FROM ai_knowledge_files WHERE stored_name IS NOT NULL ORDER BY created_at DESC'
    );
    const items = await Promise.all(rows.map(async ({ stored_name, ...item }) => {
      try { item.url = await getSignedUrl(stored_name, 6 * 60 * 60); }
      catch (err) { console.error('[Chat] file sign error:', err.message); }
      return item;
    }));
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/send — send a knowledge file / media item over WhatsApp.
// body: { kind: 'file'|'media', id, leadId?, phone?, toSelf?, caption? }
// Recipient = the lead's phone (logged on the lead's timeline), an explicit phone,
// or the user's own phone (toSelf) so an employee gets the document on their device.
router.post('/send', requireAuth, async (req, res) => {
  const { kind, id, leadId, phone: phoneOverride, toSelf, caption = '' } = req.body || {};
  const { sendFileToPhones, sendTextToPhones } = require('../services/waOutbound');
  const { normalizePhone } = require('../utils/phoneUtils');
  try {
    // Resolve recipients
    let phones = [];
    let logLeadId = null;
    if (toSelf) {
      const { rows } = await pool.query('SELECT phone FROM users WHERE id = $1', [req.user.id]);
      const p = normalizePhone(rows[0]?.phone);
      if (!p) return res.status(400).json({ error: 'אין מספר טלפון בפרופיל שלך' });
      phones = [p];
    } else if (phoneOverride) {
      const p = normalizePhone(phoneOverride);
      if (!p) return res.status(400).json({ error: 'מספר טלפון לא תקין' });
      phones = [p];
      if (leadId) logLeadId = Number(leadId);
    } else if (leadId) {
      const { rows } = await pool.query('SELECT id, phone FROM leads WHERE id = $1', [Number(leadId)]);
      if (!rows.length) return res.status(404).json({ error: 'ליד לא נמצא' });
      const p = normalizePhone(rows[0].phone);
      if (!p) return res.status(400).json({ error: 'אין מספר טלפון בליד' });
      phones = [p];
      logLeadId = rows[0].id;
    } else {
      return res.status(400).json({ error: 'לא נבחר נמען' });
    }

    // Resolve the item
    let storedName = null, fileName = null, mime = 'application/octet-stream', externalUrl = null;
    if (kind === 'file') {
      const { rows } = await pool.query('SELECT filename, stored_name FROM ai_knowledge_files WHERE id = $1', [Number(id)]);
      if (!rows.length || !rows[0].stored_name) return res.status(404).json({ error: 'הקובץ לא נמצא' });
      storedName = rows[0].stored_name; fileName = rows[0].filename;
      mime = /\.pdf$/i.test(fileName) ? 'application/pdf' : /\.txt$/i.test(fileName) ? 'text/plain' : mime;
    } else if (kind === 'media') {
      const { rows } = await pool.query('SELECT title, url, media_type, source, stored_name FROM ai_knowledge_media WHERE id = $1', [Number(id)]);
      if (!rows.length) return res.status(404).json({ error: 'המדיה לא נמצאה' });
      const m = rows[0];
      if (m.stored_name) {
        storedName = m.stored_name;
        const ext = (m.stored_name.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
        fileName = `${m.title || 'media'}${ext}`;
        mime = m.media_type === 'image' ? (ext === '.png' ? 'image/png' : 'image/jpeg') : 'video/mp4';
      } else {
        externalUrl = m.url; fileName = m.title || 'קישור';
      }
    } else {
      return res.status(400).json({ error: 'kind לא נתמך' });
    }

    let sentTo;
    let logBody;
    if (externalUrl) {
      const text = [caption, `${fileName}: ${externalUrl}`].filter(Boolean).join('\n');
      sentTo = await sendTextToPhones(phones, text);
      logBody = text;
    } else {
      const signed = await getSignedUrl(storedName, 300);
      sentTo = await sendFileToPhones(phones, { signedUrl: signed, fileName, mime, caption });
      logBody = `${caption ? caption + '\n' : ''}📎 ${fileName} (נשלח מהעוזר)`;
    }
    if (!sentTo.length) return res.status(500).json({ error: 'השליחה נכשלה' });

    if (logLeadId) {
      try {
        for (const p of sentTo) {
          await pool.query(
            `INSERT INTO messages (lead_id, channel, direction, body, timestamp, contact_value, sent_by)
             VALUES ($1, 'whatsapp', 'outbound', $2, NOW(), $3, $4)`,
            [logLeadId, logBody, p, req.user.id]
          );
        }
        await pool.query('UPDATE leads SET updated_at = NOW() WHERE id = $1', [logLeadId]);
      } catch (dbErr) { console.error('[Chat] send log error:', dbErr.message); }
    }
    res.json({ success: true, sentTo });
  } catch (err) {
    console.error('[Chat] send error:', err.response?.data || err.message);
    res.status(500).json({ error: 'השליחה נכשלה' });
  }
});

// POST /api/chat/actions — execute a proposal the user confirmed in the chat card.
// body: { kind: 'task'|'note'|'fault', ...fields }. Permission = the same role sets
// that expose the propose_* tool; everything is attributed to the confirming user.
router.post('/actions', requireAuth, async (req, res) => {
  const user = req.user;
  const userRoles = user.roles?.length ? user.roles : [user.role];
  const a = req.body || {};
  try {
    if (a.kind === 'task') {
      const title = String(a.title || '').trim();
      if (!title) return res.status(400).json({ error: 'חסרה כותרת' });
      const dueAt = a.due_at ? new Date(a.due_at) : null;
      if (dueAt && isNaN(dueAt)) return res.status(400).json({ error: 'מועד לא תקין' });
      const { rows } = await pool.query(
        `INSERT INTO tasks (lead_id, title, due_at, remind_via, assigned_to, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, title, due_at, lead_id`,
        [a.lead_id ? Number(a.lead_id) : null, title, dueAt, a.remind_via === 'app' ? 'app' : 'whatsapp',
         a.assigned_to ? Number(a.assigned_to) : user.id, user.id]
      );
      return res.json({ ok: true, task: rows[0] });
    }
    if (a.kind === 'note') {
      if (!hasRole(userRoles, LEAD_SET)) return res.status(403).json({ error: 'אין הרשאה' });
      const body = String(a.body || '').trim();
      if (!a.lead_id || !body) return res.status(400).json({ error: 'חסר ליד או טקסט' });
      const { rows } = await pool.query(
        `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by, source)
         VALUES ($1, 'note', 'outbound', $2, $3, 'assistant') RETURNING id`,
        [Number(a.lead_id), body, user.id]
      );
      await pool.query('UPDATE leads SET updated_at = NOW() WHERE id = $1', [Number(a.lead_id)]);
      return res.json({ ok: true, interaction_id: rows[0].id });
    }
    if (a.kind === 'fault') {
      if (!hasRole(userRoles, OPS_SET)) return res.status(403).json({ error: 'אין הרשאה' });
      const title = String(a.title || '').trim();
      if (!title) return res.status(400).json({ error: 'חסרה כותרת' });
      const { rows } = await pool.query(
        `INSERT INTO op_faults (title, description, reported_by) VALUES ($1, $2, $3) RETURNING id`,
        [title, a.description ? String(a.description).trim() : null, user.id]
      );
      try {
        await pool.query(
          `INSERT INTO op_activity_log (entity_type, entity_id, type, body, created_by) VALUES ('fault', $1, 'note', $2, $3)`,
          [rows[0].id, 'נפתח דרך העוזר', user.id]
        );
      } catch {}
      return res.json({ ok: true, fault_id: rows[0].id });
    }
    res.status(400).json({ error: 'פעולה לא מוכרת' });
  } catch (err) {
    console.error('[Chat] action error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports._executeTool = executeTool; // exposed for scripted tests (no HTTP / OpenAI needed)
