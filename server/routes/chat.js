const router = require('express').Router();
const { OpenAI } = require('openai');
const pool = require('../db/pool');
const requireAuth = require('../middleware/auth');
const { sendText, configured: waConfigured } = require('../services/metaWhatsapp');

function getClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  return new OpenAI({ apiKey: key });
}

const ADMIN_SET   = new Set(['admin', 'manager']);
const SALES_SET   = new Set(['admin', 'manager', 'sales']);
const LEAD_SET    = new Set(['admin', 'manager', 'sales', 'production']);
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
          stage:         { type: 'string', description: 'שלב ספציפי לסנן לפיו' },
          priority:      { type: 'string', description: 'עדיפות: דחוף, גבוה, רגיל' },
          search:        { type: 'string', description: 'חיפוש לפי שם' },
          limit:         { type: 'number', description: 'מספר תוצאות (ברירת מחדל 15, מקסימום 30)' },
          include_closed: { type: 'boolean', description: 'true רק אם המשתמש מבקש לידים שלא סגרו או הסתיימו. ברירת מחדל: false' }
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
      description: 'מחזיר לידים שלא טופלו מעל N ימים או שסומנו דחופים',
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
  }
};

function getToolsForUser(userRoles) {
  const tools = [TOOL_DEFS.get_my_tasks];
  if (hasRole(userRoles, LEAD_SET))   tools.push(TOOL_DEFS.get_today_schedule, TOOL_DEFS.get_schedule);
  if (hasRole(userRoles, LEAD_SET))   tools.push(TOOL_DEFS.get_leads, TOOL_DEFS.get_lead_details);
  if (hasRole(userRoles, SALES_SET))  tools.push(TOOL_DEFS.get_urgent_leads);
  if (hasRole(userRoles, OPS_SET))    tools.push(TOOL_DEFS.get_op_tasks, TOOL_DEFS.get_maintenance);
  if (hasRole(userRoles, SUPPLY_SET)) tools.push(TOOL_DEFS.get_suppliers);
  if (hasRole(userRoles, RSVP_SET))   tools.push(TOOL_DEFS.get_rsvp_summary);
  return tools;
}

async function executeTool(name, args, user) {
  const userRoles = user.roles?.length ? user.roles : [user.role];
  const uid  = user.id;
  const isAM = hasRole(userRoles, ADMIN_SET);

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
      const { stage, priority, search, limit = 15, include_closed = false } = args;
      const params = [isAM, uid];
      let cond = '($1 = true OR assigned_to = $2)';
      if (!include_closed && !stage) {
        cond += ` AND stage NOT IN ('deposit','production','completed','lost')`;
      }
      if (stage)    { cond += ` AND stage = $${params.push(stage)}`; }
      if (priority) { cond += ` AND priority = $${params.push(priority)}`; }
      if (search)   { cond += ` AND name ILIKE $${params.push('%' + search + '%')}`; }
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
    const [{ rows: [knowledgeRow] }, { rows: kbFiles }] = await Promise.all([
      pool.query("SELECT value FROM settings WHERE key = 'ai_knowledge_text'"),
      pool.query("SELECT filename, content_text FROM ai_knowledge_files ORDER BY created_at DESC")
    ]);
    const knowledgeParts = [
      knowledgeRow?.value?.trim() ? `## מידע כללי על שרביה:\n${knowledgeRow.value.trim()}` : '',
      ...kbFiles.map(f => `## מסמך: ${f.filename}\n${f.content_text}`)
    ].filter(Boolean);
    const knowledgeSection = knowledgeParts.length ? '\n\n' + knowledgeParts.join('\n\n') : '';

    const systemPrompt = `אתה עוזר AI של מערכת CRM שרביה.
אתה מסייע ל-${user.display_name || user.username} (תפקיד: ${userRoles.join(', ')}).${modeHint}${leadContext}
תאריך היום: ${today}

כללים:
- ענה תמיד בעברית, בצורה תמציתית ומועילה
- אתה קורא נתונים בלבד — לא יכול לשנות, למחוק, או ליצור כלום
- כשמציין ליד, צרף: [שם](/?lead=ID) וטלפון: [מספר](tel:מספר)
- כשמציין ספק, צרף: [שם](/suppliers?id=ID) וטלפון: [מספר](tel:מספר)${knowledgeSection}`;

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

module.exports = router;
