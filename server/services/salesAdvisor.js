const pool = require('../db/pool');
const { OpenAI } = require('openai');

// Stage groupings
const ACTIVE_EXCLUDE = ['deposit', 'production', 'completed', 'lost'];
const STALE_DAYS = 3; // no contact for this long → counts as needing attention
const NEAR_EVENT_DAYS = 45;

function openai() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  return new OpenAI({ apiKey: key });
}

// Chronological, labeled conversation for one lead (messages + interactions)
async function buildLeadContext(leadId) {
  const [{ rows: [lead] }, { rows: messages }, { rows: interactions }, { rows: [offer] }, { rows: [contract] },
         { rows: meetings }, { rows: tasks }, { rows: views }, { rows: [rep] }] = await Promise.all([
    pool.query('SELECT * FROM leads WHERE id = $1', [leadId]),
    pool.query('SELECT direction, body, timestamp AS ts, \'whatsapp\' AS kind FROM messages WHERE lead_id = $1', [leadId]),
    pool.query('SELECT direction, body, created_at AS ts, type AS kind FROM lead_interactions WHERE lead_id = $1', [leadId]),
    pool.query('SELECT id, fields, rows, offer_type, created_at FROM price_offers WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1', [leadId]),
    pool.query(`SELECT id, status, created_at, signed_at, sent_via, contract_data FROM contracts WHERE lead_id = $1
                ORDER BY (status='signed') DESC, created_at DESC LIMIT 1`, [leadId]),
    pool.query('SELECT title, start_time, confirmed_at FROM meetings WHERE lead_id = $1 ORDER BY start_time DESC LIMIT 5', [leadId]),
    pool.query('SELECT title, due_at, completed_at FROM tasks WHERE lead_id = $1 AND completed_at IS NULL ORDER BY due_at ASC NULLS LAST LIMIT 5', [leadId]),
    pool.query(`SELECT v.viewed_at FROM contract_views v JOIN contracts c ON c.id = v.contract_id WHERE c.lead_id = $1 ORDER BY v.viewed_at DESC`, [leadId]).catch(() => ({ rows: [] })),
    pool.query('SELECT u.display_name FROM leads l JOIN users u ON u.id = l.assigned_to WHERE l.id = $1', [leadId]),
  ]);
  if (!lead) return null;

  const timeline = [...messages, ...interactions].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const history = timeline
    .map(r => `[${fmtDate(r.ts)} ${r.direction === 'inbound' ? 'לקוח' : 'שרביה'}${r.kind && r.kind !== 'whatsapp' ? ' · ' + r.kind : ''}]: ${r.body}`)
    .join('\n');

  // Response-time signals: how fast the customer answers us, and who spoke last
  let customerReplyHours = [];
  for (let i = 1; i < timeline.length; i++) {
    if (timeline[i].direction === 'inbound' && timeline[i - 1].direction !== 'inbound') {
      customerReplyHours.push((new Date(timeline[i].ts) - new Date(timeline[i - 1].ts)) / 3600000);
    }
  }
  const last = timeline[timeline.length - 1] || null;
  const signals = {
    avg_customer_reply_hours: customerReplyHours.length ? Math.round(customerReplyHours.reduce((a, b) => a + b, 0) / customerReplyHours.length) : null,
    last_direction: last?.direction || null,
    days_since_last_contact: last ? daysBetween(new Date(), last.ts) : null,
    contract_views: views.length,
    contract_last_viewed_at: views[0]?.viewed_at || null,
  };

  return {
    lead, history, rep: rep?.display_name || null,
    offer: offer ? { ...offer, total: offerTotal(offer.rows, offer.fields) } : null,
    contract: contract ? { ...contract, total: contractTotal(contract.contract_data) } : null,
    meetings, open_tasks: tasks, signals,
  };
}

function daysBetween(a, b) {
  return Math.floor((new Date(a) - new Date(b)) / 86400000);
}

// Money helpers — same arithmetic as the offer/contract PDF renderers
// (routes/priceOffer.js, routes/contracts.js): fixed rows qty×price, % rows on the
// fixed subtotal, VAT 18% unless fields.withVat === false.
function offerTotal(rows, fields) {
  const list = Array.isArray(rows) ? rows : [];
  const fixed = list.filter(r => !r.isPct).reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.price) || 0), 0);
  const subtotal = list.reduce((s, r) => s + (r.isPct ? Math.round(fixed * (Number(r.pct) || 0) / 100) : (Number(r.qty) || 0) * (Number(r.price) || 0)), 0);
  const withVat = !(fields && fields.withVat === false);
  return Math.round(subtotal + (withVat ? Math.round(subtotal * 0.18) : 0));
}
function contractTotal(contractData) {
  const c = contractData?.calculated || {};
  if (c.total != null) return Math.round(Number(c.total)) || 0;
  return offerTotal(contractData?.rows, contractData?.fields);
}
const fmtMoney = n => (n == null ? '' : `₪${Math.round(Number(n)).toLocaleString('he-IL')}`);
const fmtDate  = d => (d ? new Date(d).toLocaleDateString('he-IL') : '');

// Rule-based tier + score. Tier order (dominant): 1 contract awaiting signature,
// 2 price offer sent, 3 urgent/hot. Near events boost within/across tiers.
function classify(row) {
  const now = new Date();
  const stage = row.stage;
  const hasSignedContract = !!row.has_signed_contract;
  const hasUnsignedContract = !!row.has_unsigned_contract;
  const hasOffer = !!row.has_offer;
  const lastTs = row.last_interaction_at ? new Date(row.last_interaction_at) : null;
  const daysSince = lastTs ? daysBetween(now, lastTs) : 999;
  const eventDays = row.event_date ? daysBetween(row.event_date, now) : null;
  const nearEvent = eventDays != null && eventDays >= 0 && eventDays <= NEAR_EVENT_DAYS;

  let tier, reason;
  if ((hasUnsignedContract && !hasSignedContract) || stage === 'contract_sent' || stage === 'process_no_answer') {
    tier = 1; reason = 'חוזה נשלח וטרם נחתם';
  } else if (hasOffer || stage === 'offer_sent' || stage === 'negotiation') {
    tier = 2; reason = 'נשלחה הצעת מחיר';
  } else {
    tier = 3;
    reason = (row.priority === 'דחוף' || row.priority === 'גבוה') ? `עדיפות ${row.priority}` : `אין קשר ${daysSince} ימים`;
  }

  const last_contact = row.last_body != null
    ? { kind: row.last_kind, direction: row.last_direction, body: row.last_body, ts: row.last_interaction_at }
    : null;

  return {
    tier, reason,
    priority: row.priority,
    days_since_contact: daysSince,
    event_days: eventDays,
    near_event: nearEvent,
    contract_sent_at: row.contract_sent_at || null,
    offer_sent_at: row.offer_sent_at || null,
    last_contact,
  };
}

// Ranked active leads for the user's scope (sales → own; admin/manager/sales_manager → all)
async function getWorklist(user) {
  const roles = user.roles?.length ? user.roles : [user.role];
  const isAM = ['admin', 'manager', 'sales_manager'].some(r => roles.includes(r));
  const params = [];
  let scope = '';
  if (!isAM) { params.push(user.id); scope = 'AND l.assigned_to = $1'; }

  const { rows } = await pool.query(`
    SELECT l.id AS lead_id, l.name, l.phone, l.event_date, l.event_type, l.stage, l.priority,
           u.display_name AS rep,
           lc.ts AS last_interaction_at, lc.kind AS last_kind, lc.direction AS last_direction, lc.body AS last_body,
           (SELECT MAX(created_at) FROM contracts    c2 WHERE c2.lead_id = l.id) AS contract_sent_at,
           (SELECT MAX(created_at) FROM price_offers p2 WHERE p2.lead_id = l.id) AS offer_sent_at,
           EXISTS (SELECT 1 FROM price_offers po WHERE po.lead_id = l.id) AS has_offer,
           EXISTS (SELECT 1 FROM contracts c WHERE c.lead_id = l.id AND c.status = 'signed') AS has_signed_contract,
           EXISTS (SELECT 1 FROM contracts c WHERE c.lead_id = l.id AND c.status <> 'signed') AS has_unsigned_contract,
           EXISTS (SELECT 1 FROM lead_ai_advice a WHERE a.lead_id = l.id) AS has_advice,
           (SELECT a.data->>'temperature' FROM lead_ai_advice a WHERE a.lead_id = l.id) AS temperature,
           (SELECT c3.contract_data FROM contracts c3 WHERE c3.lead_id = l.id ORDER BY (c3.status='signed') DESC, c3.created_at DESC LIMIT 1) AS contract_data,
           (SELECT p3.rows FROM price_offers p3 WHERE p3.lead_id = l.id ORDER BY p3.created_at DESC LIMIT 1) AS offer_rows,
           (SELECT p3.fields FROM price_offers p3 WHERE p3.lead_id = l.id ORDER BY p3.created_at DESC LIMIT 1) AS offer_fields
    FROM leads l
    LEFT JOIN users u ON u.id = l.assigned_to
    LEFT JOIN LATERAL (
      -- most recent REAL contact (excludes stage-change 🔄 and [תזכורת אוטומטית] markers)
      SELECT ts, direction, kind, body FROM (
        SELECT timestamp AS ts, direction, channel AS kind, body FROM messages WHERE lead_id = l.id
        UNION ALL
        SELECT created_at AS ts, direction, type AS kind, body FROM lead_interactions
          WHERE lead_id = l.id AND body NOT LIKE '🔄%' AND body NOT LIKE '[תזכורת אוטומטית%'
      ) x ORDER BY ts DESC LIMIT 1
    ) lc ON true
    WHERE l.stage <> ALL($${params.length + 1}::text[]) ${scope}
  `, [...params, ACTIVE_EXCLUDE]);

  const items = rows.map(r => ({
    lead_id: r.lead_id, name: r.name, phone: r.phone, event_date: r.event_date,
    event_type: r.event_type, stage: r.stage, rep: r.rep || null, has_advice: r.has_advice,
    temperature: r.temperature || null,
    deal_value: r.contract_data ? contractTotal(r.contract_data) : (r.offer_rows ? offerTotal(r.offer_rows, r.offer_fields) : null),
    ...classify(r),
  }));

  // Tiers in priority order. Inside a tier (2026-09-13): a near event first, then the
  // advisor's temperature (hot > warm > unknown > cold), then the deal value, and only
  // then freshness (newest first) — so "הכי חם" really is the hottest, biggest deal.
  const TEMP_RANK = { hot: 0, warm: 1, cold: 3 };
  const tempRank = it => (it.temperature in TEMP_RANK ? TEMP_RANK[it.temperature] : 2);
  const freshness = (it) => it.tier === 1 ? it.contract_sent_at
    : it.tier === 2 ? it.offer_sent_at
    : it.last_contact?.ts;
  return items.sort((a, b) =>
    a.tier - b.tier
    || (b.near_event === true) - (a.near_event === true)
    || tempRank(a) - tempRank(b)
    || (b.deal_value || 0) - (a.deal_value || 0)
    || (new Date(freshness(b) || 0) - new Date(freshness(a) || 0))
  );
}

// AI per-lead advice (draft-only). Cached in lead_ai_advice.
// 2026-09-13: the advisor now sees the whole deal — offer amount + lines, contract
// status/age/opens, meetings, open tasks, reply-speed signals, the sales playbook
// (ai_instructions + knowledge text) and what the loss analysis learned — and returns
// evidence, a concrete task suggestion and a meeting flag alongside the draft.
async function analyzeLead(leadId, userId = null) {
  const ctx = await buildLeadContext(leadId);
  if (!ctx) throw new Error('Lead not found');
  const { lead, history, offer, contract, meetings, open_tasks, signals, rep } = ctx;

  const { rows: settingRows } = await pool.query(
    "SELECT key, value FROM settings WHERE key IN ('ai_instructions','ai_knowledge_text','sales_loss_lessons')"
  );
  const setting = k => settingRows.find(r => r.key === k)?.value?.trim() || '';
  const aiInstructions = setting('ai_instructions');
  const knowledge = setting('ai_knowledge_text').slice(0, 4000);
  const lossLessons = setting('sales_loss_lessons').slice(0, 1500);

  const now = new Date();
  const offerLines = (offer?.rows || []).slice(0, 12)
    .map(r => `  · ${r.label || r.description || r.name || 'שורה'}: ${r.isPct ? `${r.pct}%` : `${r.qty} × ${fmtMoney(r.price)}`}`)
    .join('\n');
  const info = [
    lead.name ? `שם: ${lead.name}` : '',
    rep ? `נציג אחראי: ${rep}` : '',
    lead.event_type ? `סוג אירוע: ${lead.event_type}` : '',
    lead.event_date ? `תאריך אירוע: ${fmtDate(lead.event_date)} (בעוד ${daysBetween(lead.event_date, now)} ימים)` : (lead.event_date_text ? `תאריך אירוע (טקסט): ${lead.event_date_text}` : ''),
    lead.guest_count ? `מוזמנים: ${lead.guest_count}` : '',
    lead.budget ? `תקציב שהלקוח ציין: ${lead.budget}` : '',
    lead.source ? `מקור הליד: ${lead.source}` : '',
    `שלב נוכחי: ${lead.stage}` + (lead.priority ? ` · עדיפות ${lead.priority}` : ''),
    lead.created_at ? `הליד נפתח: ${fmtDate(lead.created_at)} (לפני ${daysBetween(now, lead.created_at)} ימים)` : '',
    offer
      ? `הצעת מחיר: נשלחה ${fmtDate(offer.created_at)} (לפני ${daysBetween(now, offer.created_at)} ימים) · סה"כ ${fmtMoney(offer.total)}${offer.offer_type === 'package' ? ' · חבילה' : ''}${offerLines ? '\n' + offerLines : ''}`
      : 'הצעת מחיר: לא נשלחה',
    contract
      ? `חוזה: ${contract.status === 'signed' ? `נחתם ${fmtDate(contract.signed_at)}` : `נשלח ${fmtDate(contract.created_at)} (לפני ${daysBetween(now, contract.created_at)} ימים), טרם נחתם`} · סה"כ ${fmtMoney(contract.total)}${contract.sent_via ? ` · נשלח ב-${contract.sent_via}` : ''}` +
        (contract.status !== 'signed' ? ` · דף החתימה נפתח ${signals.contract_views} פעמים${signals.contract_last_viewed_at ? `, לאחרונה ${fmtDate(signals.contract_last_viewed_at)}` : ''}` : '')
      : 'חוזה: לא נשלח',
    meetings.length
      ? `פגישות: ` + meetings.map(m => `${fmtDate(m.start_time)}${new Date(m.start_time) > now ? ' (עתידית)' : ''}${m.confirmed_at ? ' ✓אושרה' : ''}${m.title ? ' · ' + m.title : ''}`).join(' | ')
      : 'פגישות: לא נקבעו',
    open_tasks.length
      ? `משימות פתוחות: ` + open_tasks.map(t => `${t.title}${t.due_at ? ` (${fmtDate(t.due_at)}${new Date(t.due_at) < now ? ' — עבר המועד' : ''})` : ''}`).join(' | ')
      : 'משימות פתוחות: אין',
    signals.last_direction
      ? `הקשר האחרון: ${signals.last_direction === 'inbound' ? 'הלקוח פנה אחרון (הכדור אצלנו)' : 'אנחנו פנינו אחרונים (הכדור אצל הלקוח)'} לפני ${signals.days_since_last_contact} ימים`
      : 'אין קשר מתועד',
    signals.avg_customer_reply_hours != null ? `זמן תגובה ממוצע של הלקוח: ~${signals.avg_customer_reply_hours} שעות` : '',
  ].filter(Boolean).join('\n');

  const completion = await openai().chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 900,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: `אתה יועץ מכירות מקצועי של אולם אירועים "שרביה" בתל אביב. נתח את הליד והמלץ לנציג המכירות על הצעד הבא.
בסס את ההמלצה על ראיות מהנתונים (מה הלקוח אמר, כמה זמן עבר, מה נשלח, כמה פעמים נפתח החוזה, האם יש פגישה). אל תמציא עובדות.
${aiInstructions ? '\nהנחיות המכירות של שרביה:\n' + aiInstructions + '\n' : ''}${knowledge ? '\nמידע על שרביה:\n' + knowledge + '\n' : ''}${lossLessons ? '\nמה למדנו מעסקאות שלא נסגרו:\n' + lossLessons + '\n' : ''}
פרטי הליד והעסקה:
${info}

היסטוריית השיחה (כרונולוגית):
${history || '(אין היסטוריה)'}

החזר JSON בלבד בפורמט:
{"temperature":"hot|warm|cold",
 "headline":"<שורה אחת ממצה בעברית>",
 "summary":"<2-3 שורות מצב בעברית>",
 "evidence":["<עובדה קצרה מהנתונים שתומכת בניתוח, עד 4 פריטים>"],
 "next_action":"<המלצה קונקרטית לפעולה הבאה בעברית — מה לעשות, מתי, ומה להציע>",
 "suggested_task":{"title":"<כותרת משימה קצרה לנציג, או ריק>","due_in_days":<מספר ימים מהיום, 0=היום>},
 "suggest_meeting":<true אם הצעד הנכון הוא לקבוע פגישה/סיור באולם, אחרת false>,
 "draft_message":"<טיוטת הודעת וואטסאפ חמה ומשכנעת בעברית ללקוח, מוכנה לשליחה, שמתייחסת למה שהלקוח אמר>"}`,
    }],
  });

  let advice;
  try {
    advice = JSON.parse(completion.choices[0].message.content);
  } catch {
    throw new Error('תשובת ה-AI לא תקינה — נסה שוב');
  }
  const taskTitle = String(advice.suggested_task?.title || '').trim();
  const dueDays = Number(advice.suggested_task?.due_in_days);
  const clean = {
    temperature: ['hot', 'warm', 'cold'].includes(advice.temperature) ? advice.temperature : 'warm',
    headline: String(advice.headline || '').trim(),
    summary: String(advice.summary || '').trim(),
    evidence: Array.isArray(advice.evidence) ? advice.evidence.map(e => String(e).trim()).filter(Boolean).slice(0, 4) : [],
    next_action: String(advice.next_action || '').trim(),
    suggested_task: taskTitle ? { title: taskTitle.slice(0, 120), due_in_days: Number.isFinite(dueDays) ? Math.max(0, Math.min(30, Math.round(dueDays))) : 1 } : null,
    suggest_meeting: advice.suggest_meeting === true,
    draft_message: String(advice.draft_message || '').trim(),
    deal_value: contract?.total || offer?.total || null,
  };

  const { rows: [saved] } = await pool.query(`
    INSERT INTO lead_ai_advice (lead_id, data, generated_at, updated_by)
    VALUES ($1, $2, NOW(), $3)
    ON CONFLICT (lead_id) DO UPDATE SET data = $2, generated_at = NOW(), updated_by = $3
    RETURNING data, generated_at
  `, [leadId, JSON.stringify(clean), userId]);

  return { ...saved.data, generated_at: saved.generated_at };
}

async function getCachedAdvice(leadId) {
  const { rows } = await pool.query('SELECT data, generated_at FROM lead_ai_advice WHERE lead_id = $1', [leadId]);
  if (!rows.length) return null;
  return { ...rows[0].data, generated_at: rows[0].generated_at };
}

// AI analysis of lost leads in a date range
async function lossInsights(from, to) {
  const ranged = !!(from && to);
  const params = ranged ? [from, to] : [];
  const where = ranged ? "AND created_at::date BETWEEN $1::date AND $2::date" : '';

  const { rows: lost } = await pool.query(`
    SELECT id, name, event_type, lost_reason, lost_reason_text
    FROM leads WHERE stage = 'lost' ${where}
    ORDER BY updated_at DESC LIMIT 80
  `, params);

  if (!lost.length) return { count: 0, top_reasons: [], patterns: [], recommendations: [] };

  // Attach a short recent-history tail per lead (cap volume)
  const ids = lost.map(l => l.id);
  const { rows: ints } = await pool.query(
    `SELECT lead_id, direction, body FROM lead_interactions
     WHERE lead_id = ANY($1) AND type IN ('note','whatsapp','call','email') ORDER BY created_at DESC`, [ids]
  );
  const byLead = {};
  for (const r of ints) { (byLead[r.lead_id] ||= []).length < 4 && byLead[r.lead_id].push(`[${r.direction === 'inbound' ? 'לקוח' : 'צוות'}] ${r.body}`); }

  const digest = lost.map(l =>
    `- ${l.name || ''} (${l.event_type || ''}) סיבה:${l.lost_reason || 'לא צוין'} ${l.lost_reason_text || ''}\n  ${(byLead[l.id] || []).join(' | ')}`
  ).join('\n');

  const completion = await openai().chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 900,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: `אתה אנליסט מכירות של אולם אירועים "שרביה". להלן לידים שלא נסגרו (אבודים). זהה דפוסים והתנגדויות חוזרות, והמלץ איך לשפר את שיעור הסגירה.

לידים אבודים (${lost.length}):
${digest}

החזר JSON בלבד:
{"top_reasons":[{"reason":"<סיבה בעברית>","count":<מספר>,"insight":"<תובנה קצרה>"}],"patterns":["<דפוס בעברית>"],"recommendations":["<המלצה מעשית בעברית>"]}`,
    }],
  });

  let out;
  try { out = JSON.parse(completion.choices[0].message.content); }
  catch { throw new Error('תשובת ה-AI לא תקינה — נסה שוב'); }
  const result = {
    count: lost.length,
    top_reasons: Array.isArray(out.top_reasons) ? out.top_reasons : [],
    patterns: Array.isArray(out.patterns) ? out.patterns : [],
    recommendations: Array.isArray(out.recommendations) ? out.recommendations : [],
  };
  // Keep the latest lessons so the per-lead advisor can apply them (settings.sales_loss_lessons)
  try {
    const lessons = [...result.patterns.map(p => `- ${p}`), ...result.recommendations.map(r => `- ${r}`)].join('\n').slice(0, 1500);
    if (lessons) {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ('sales_loss_lessons', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [lessons]
      );
    }
  } catch (e) { console.error('[salesAdvisor] loss lessons save failed:', e.message); }
  return result;
}

module.exports = { buildLeadContext, getWorklist, analyzeLead, getCachedAdvice, lossInsights, classify, offerTotal, contractTotal };
