const pool = require('../db/pool');
const { OpenAI } = require('openai');

// Stage groupings
const ACTIVE_EXCLUDE = ['deposit', 'production', 'completed', 'lost'];
const STALE_DAYS = 3; // no contact for this long → counts as needing attention
const NEAR_EVENT_DAYS = 14;

function openai() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  return new OpenAI({ apiKey: key });
}

// Chronological, labeled conversation for one lead (messages + interactions)
async function buildLeadContext(leadId) {
  const [{ rows: [lead] }, { rows: messages }, { rows: interactions }, { rows: [offer] }, { rows: [contract] }] = await Promise.all([
    pool.query('SELECT * FROM leads WHERE id = $1', [leadId]),
    pool.query('SELECT direction, body, timestamp AS ts FROM messages WHERE lead_id = $1', [leadId]),
    pool.query('SELECT direction, body, created_at AS ts FROM lead_interactions WHERE lead_id = $1', [leadId]),
    pool.query('SELECT created_at FROM price_offers WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1', [leadId]),
    pool.query(`SELECT status, created_at, signed_at FROM contracts WHERE lead_id = $1
                ORDER BY (status='signed') DESC, created_at DESC LIMIT 1`, [leadId]),
  ]);
  if (!lead) return null;

  const history = [...messages, ...interactions]
    .sort((a, b) => new Date(a.ts) - new Date(b.ts))
    .map(r => `[${r.direction === 'inbound' ? 'לקוח' : 'שרביה'}]: ${r.body}`)
    .join('\n');

  return { lead, history, offer: offer || null, contract: contract || null };
}

function daysBetween(a, b) {
  return Math.floor((new Date(a) - new Date(b)) / 86400000);
}

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

  // Higher score = higher in the list. Tier dominates, event proximity + staleness lift.
  const tierWeight = { 1: 300, 2: 200, 3: 100 }[tier];
  const eventBoost = eventDays == null ? 0 : Math.max(0, 90 - Math.max(0, eventDays)); // nearer → bigger
  const staleBoost = Math.min(daysSince, 30);
  const score = tierWeight + eventBoost + staleBoost;

  return { tier, reason, score, days_since_contact: daysSince, event_days: eventDays, near_event: nearEvent };
}

// Ranked active leads for the user's scope (sales → own; manager/admin → all)
async function getWorklist(user) {
  const roles = user.roles?.length ? user.roles : [user.role];
  const isAM = roles.includes('admin') || roles.includes('manager');
  const params = [];
  let scope = '';
  if (!isAM) { params.push(user.id); scope = 'AND l.assigned_to = $1'; }

  const { rows } = await pool.query(`
    SELECT l.id AS lead_id, l.name, l.phone, l.event_date, l.event_type, l.stage, l.priority,
           u.display_name AS rep,
           GREATEST(
             (SELECT MAX(created_at) FROM lead_interactions WHERE lead_id = l.id),
             (SELECT MAX(timestamp)  FROM messages          WHERE lead_id = l.id)
           ) AS last_interaction_at,
           EXISTS (SELECT 1 FROM price_offers po WHERE po.lead_id = l.id) AS has_offer,
           EXISTS (SELECT 1 FROM contracts c WHERE c.lead_id = l.id AND c.status = 'signed') AS has_signed_contract,
           EXISTS (SELECT 1 FROM contracts c WHERE c.lead_id = l.id AND c.status <> 'signed') AS has_unsigned_contract,
           EXISTS (SELECT 1 FROM lead_ai_advice a WHERE a.lead_id = l.id) AS has_advice
    FROM leads l
    LEFT JOIN users u ON u.id = l.assigned_to
    WHERE l.stage <> ALL($${params.length + 1}::text[]) ${scope}
    ORDER BY l.event_date ASC NULLS LAST
  `, [...params, ACTIVE_EXCLUDE]);

  return rows
    .map(r => ({
      lead_id: r.lead_id, name: r.name, phone: r.phone, event_date: r.event_date,
      event_type: r.event_type, stage: r.stage, rep: r.rep || null, has_advice: r.has_advice,
      ...classify(r),
    }))
    .sort((a, b) => b.score - a.score);
}

// AI per-lead advice (draft-only). Cached in lead_ai_advice.
async function analyzeLead(leadId, userId = null) {
  const ctx = await buildLeadContext(leadId);
  if (!ctx) throw new Error('Lead not found');
  const { lead, history, offer, contract } = ctx;

  const { rows: aiRows } = await pool.query("SELECT value FROM settings WHERE key = 'ai_instructions'");
  const aiInstructions = aiRows[0]?.value?.trim() || '';

  const info = [
    lead.name ? `שם: ${lead.name}` : '',
    lead.event_type ? `סוג אירוע: ${lead.event_type}` : '',
    lead.event_date ? `תאריך אירוע: ${String(lead.event_date).slice(0, 10)}` : '',
    lead.guest_count ? `מוזמנים: ${lead.guest_count}` : '',
    lead.budget ? `תקציב: ${lead.budget}` : '',
    `שלב נוכחי: ${lead.stage}`,
    offer ? 'נשלחה הצעת מחיר' : 'לא נשלחה הצעת מחיר',
    contract ? `חוזה: ${contract.status === 'signed' ? 'נחתם' : 'נשלח, טרם נחתם'}` : 'לא נשלח חוזה',
  ].filter(Boolean).join('\n');

  const completion = await openai().chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 700,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: `אתה יועץ מכירות מקצועי של אולם אירועים "שרביה" בתל אביב. נתח את הליד והמלץ לנציג המכירות על הצעד הבא.
${aiInstructions ? aiInstructions + '\n\n' : ''}פרטי הליד:
${info}

היסטוריית השיחה:
${history || '(אין היסטוריה)'}

החזר JSON בלבד בפורמט:
{"temperature":"hot|warm|cold","headline":"<שורה אחת ממצה בעברית>","summary":"<2-3 שורות מצב בעברית>","next_action":"<המלצה קונקרטית לפעולה הבאה בעברית>","draft_message":"<טיוטת הודעת וואטסאפ חמה ומשכנעת בעברית ללקוח, מוכנה לשליחה>"}`,
    }],
  });

  let advice;
  try {
    advice = JSON.parse(completion.choices[0].message.content);
  } catch {
    throw new Error('תשובת ה-AI לא תקינה — נסה שוב');
  }
  const clean = {
    temperature: ['hot', 'warm', 'cold'].includes(advice.temperature) ? advice.temperature : 'warm',
    headline: String(advice.headline || '').trim(),
    summary: String(advice.summary || '').trim(),
    next_action: String(advice.next_action || '').trim(),
    draft_message: String(advice.draft_message || '').trim(),
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
  return {
    count: lost.length,
    top_reasons: Array.isArray(out.top_reasons) ? out.top_reasons : [],
    patterns: Array.isArray(out.patterns) ? out.patterns : [],
    recommendations: Array.isArray(out.recommendations) ? out.recommendations : [],
  };
}

module.exports = { buildLeadContext, getWorklist, analyzeLead, getCachedAdvice, lossInsights, classify };
