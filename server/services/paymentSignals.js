// "תשלום ללא מסמך" — a customer (or a staff note) says money was transferred, and no
// receipt / invoice followed. Added 2026-09-13 (landing-page roadmap, item 6).
//
// Runs on a cron (every 15 min). Cheap keyword prefilter over new inbound WhatsApp
// messages and lead notes → gpt-4o-mini JSON confirms "this is a report of a payment
// made" and extracts amount + method → one row per message in payment_signals.
// A signal auto-closes when a financial document (קבלה / חשבונית) or a pending
// document is created on the lead after the message; a user can also dismiss it.
const pool = require('../db/pool');
const { OpenAI } = require('openai');

const KEYWORDS = /(העברתי|העברנו|שילמתי|שילמנו|הועבר|העברה\s*בנקאית|העברה|מקדמה|\bביט\b|\bbit\b|פייבוקס|paybox|תשלום|שילם|שילמה|העביר|העבירה|הפקדתי|הפקדנו|צ'ק|צ׳ק|המחאה|מזומן)/i;
// Things that are clearly NOT a payment report even though they mention money
const NEGATIVE = /(אשלח|נשלח|אעביר|נעביר|יועבר|כמה עולה|מה המחיר|מחיר|הצעת מחיר|חשבונית עסקה|קישור לתשלום|לתשלום עד|נא להעביר|יש להעביר|צריך להעביר|מתי לשלם|איך משלמים|אפשר לשלם)/i;

function openai() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  return new OpenAI({ apiKey: key });
}

async function getSetting(key) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}
async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, String(value)]
  );
}

const METHODS = ['העברה בנקאית', 'ביט', 'פייבוקס', 'אשראי', 'מזומן', "צ'ק", 'אחר'];

async function classify(text, who) {
  const completion = await openai().chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 200,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: `ההודעה הבאה נכתבה ${who === 'inbound' ? 'על ידי לקוח של אולם אירועים' : 'על ידי עובד האולם כהערה בתיק הלקוח'}.
האם היא מדווחת שתשלום/מקדמה כבר בוצע בפועל (כסף כבר הועבר)? שאלות על מחיר, הבטחות לשלם בעתיד, בקשות תשלום שלנו — אינן דיווח על תשלום.

הודעה:
"""${String(text).slice(0, 600)}"""

החזר JSON בלבד: {"is_payment_report": true|false, "amount": <מספר בשקלים או null>, "method": <אחד מ: ${METHODS.map(m => `"${m}"`).join(', ')} או null>}`,
    }],
  });
  try {
    const out = JSON.parse(completion.choices[0].message.content);
    const amount = Number(out.amount);
    return {
      is_payment_report: out.is_payment_report === true,
      amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount) : null,
      method: METHODS.includes(out.method) ? out.method : null,
    };
  } catch {
    return { is_payment_report: false, amount: null, method: null };
  }
}

// Has a financial document been produced on this lead since `since`?
async function documentSince(leadId, since) {
  const { rows } = await pool.query(`
    SELECT 1 FROM files WHERE lead_id = $1 AND created_at > $2
      AND (filename LIKE 'קבלה%' OR filename LIKE 'חשבונית%')
    UNION ALL
    SELECT 1 FROM pending_documents WHERE lead_id = $1 AND created_at > $2 AND status <> 'rejected'
    LIMIT 1
  `, [leadId, since]);
  return rows.length > 0;
}

async function scanPaymentSignals() {
  if (!process.env.OPENAI_API_KEY) return;
  try {
    const lastMsg = Number(await getSetting('payment_signal_last_message_id')) || 0;
    const lastInt = Number(await getSetting('payment_signal_last_interaction_id')) || 0;

    // New inbound WhatsApp messages (bounded to the last 7 days on the first run)
    const { rows: msgs } = await pool.query(`
      SELECT m.id, m.lead_id, m.body, m.timestamp AS ts, 'inbound' AS who
      FROM messages m
      WHERE m.id > $1 AND m.direction = 'inbound' AND m.lead_id IS NOT NULL
        AND m.timestamp > NOW() - INTERVAL '7 days' AND m.body IS NOT NULL
      ORDER BY m.id ASC LIMIT 500
    `, [lastMsg]);
    // New staff notes / documented calls ("הלקוח העביר מקדמה")
    const { rows: ints } = await pool.query(`
      SELECT i.id, i.lead_id, i.body, i.created_at AS ts, i.direction AS who
      FROM lead_interactions i
      WHERE i.id > $1 AND i.type IN ('note','call','whatsapp') AND i.lead_id IS NOT NULL
        AND i.created_at > NOW() - INTERVAL '7 days' AND i.body IS NOT NULL
        AND i.body NOT LIKE '🔄%' AND i.body NOT LIKE '[תזכורת אוטומטית%' AND i.body NOT LIKE '✅ משימה הושלמה%'
      ORDER BY i.id ASC LIMIT 500
    `, [lastInt]);

    let created = 0;
    for (const row of [...msgs.map(m => ({ ...m, kind: 'message' })), ...ints.map(i => ({ ...i, kind: 'interaction' }))]) {
      const text = String(row.body || '');
      if (!KEYWORDS.test(text) || NEGATIVE.test(text) || text.length < 4) continue;
      if (await documentSince(row.lead_id, row.ts)) continue;          // already handled
      const { rows: open } = await pool.query(
        `SELECT 1 FROM payment_signals WHERE lead_id = $1 AND status = 'open' AND said_at > $2::timestamptz - INTERVAL '3 days' LIMIT 1`,
        [row.lead_id, row.ts]
      );
      if (open.length) continue;                                         // one open signal per payment episode
      let verdict;
      try { verdict = await classify(text, row.kind === 'message' ? 'inbound' : (row.who === 'inbound' ? 'inbound' : 'staff')); }
      catch (e) { console.error('[paymentSignals] classify failed:', e.message); continue; }
      if (!verdict.is_payment_report) continue;
      await pool.query(`
        INSERT INTO payment_signals (lead_id, message_id, interaction_id, said_at, amount, method, snippet)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT DO NOTHING
      `, [row.lead_id, row.kind === 'message' ? row.id : null, row.kind === 'interaction' ? row.id : null,
          row.ts, verdict.amount, verdict.method, text.replace(/\s+/g, ' ').trim().slice(0, 200)]);
      created++;
    }

    if (msgs.length) await setSetting('payment_signal_last_message_id', msgs[msgs.length - 1].id);
    if (ints.length) await setSetting('payment_signal_last_interaction_id', ints[ints.length - 1].id);

    // Auto-close signals that got their document since
    const { rows: opens } = await pool.query(`SELECT id, lead_id, said_at FROM payment_signals WHERE status = 'open'`);
    for (const s of opens) {
      if (await documentSince(s.lead_id, s.said_at)) {
        await pool.query(`UPDATE payment_signals SET status = 'done', resolved_at = NOW() WHERE id = $1`, [s.id]);
      }
    }
    if (created) console.log(`[paymentSignals] ${created} new payment report(s) without a document`);
  } catch (err) {
    console.error('[paymentSignals] scan error:', err.message);
  }
}

module.exports = { scanPaymentSignals, KEYWORDS };
