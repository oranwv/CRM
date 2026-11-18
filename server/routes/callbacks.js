// Phase 101 — "שיחה חוזרת": the customer asked to be called back at a specific time.
// Stored as a lead task with kind = 'callback' (so it shows in every task list and gets the normal
// WhatsApp reminder at its time), but it behaves differently on screen:
//   - 5 minutes before the time a window pops up for the assignee, over whatever he is doing;
//   - 10 minutes after the time, if nobody dealt with it, the same window pops up for every other
//     sales user as well (Oran: "אם הנציג לא טיפל — תקפיץ גם אצל שאר הנציגים");
//   - an answered call to the lead from the system closes it by itself (see closeAfterCall).
const router = require('express').Router();
const pool = require('../db/pool');
const A = require('../utils/assignees');

const LEAD_MIN = 5;        // pop up this many minutes before the time
const ESCALATE_MIN = 10;   // …and for the other sales users this many minutes after it
const ESCALATE_MAX_H = 24; // an old missed callback stops popping up for others after a day
const SALES_ROLES = ['admin', 'manager', 'sales_manager', 'sales'];
const isSales = u => (u.roles?.length ? u.roles : [u.role]).some(r => SALES_ROLES.includes(r));
const hhmm = d => new Date(d).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
const dayTime = d => new Date(d).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

async function note(leadId, body, userId) {
  await pool.query(
    `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by) VALUES ($1, 'note', 'outbound', $2, $3)`,
    [leadId, body, userId]);
  await pool.query('UPDATE leads SET updated_at = NOW() WHERE id = $1', [leadId]);
}
function parseDue(v) { const d = new Date(v || ''); return isNaN(d.getTime()) ? null : d; }

// POST /api/callbacks  { lead_id, due_at, note }
router.post('/', async (req, res) => {
  const due = parseDue(req.body.due_at);
  const text = String(req.body.note || '').trim().slice(0, 200);
  if (!req.body.lead_id || !due) return res.status(400).json({ error: 'חסר ליד או שעה' });
  if (due.getTime() < Date.now() - 60_000) return res.status(400).json({ error: 'השעה כבר עברה' });
  try {
    const { rows: [lead] } = await pool.query('SELECT id, name FROM leads WHERE id = $1', [req.body.lead_id]);
    if (!lead) return res.status(404).json({ error: 'הליד לא נמצא' });
    const title = `לחזור ללקוח${text ? ` — ${text}` : ''}`;
    const { rows: [t] } = await pool.query(
      `INSERT INTO tasks (lead_id, title, due_at, remind_via, assigned_to, created_by, kind)
       VALUES ($1, $2, $3, 'app', $4, $4, 'callback') RETURNING *`,
      [lead.id, title, due, req.user.id]);
    await note(lead.id, `📞 ביקש/ה שנחזור ב-${dayTime(due)}${text ? `\n${text}` : ''}`, req.user.id);
    res.status(201).json(t);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/callbacks/mine — the caller's open callbacks, soonest first (header badge + its list)
router.get('/mine', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.due_at, t.lead_id, l.name AS lead_name, l.phone,
              (t.due_at < NOW()) AS late
       FROM tasks t JOIN leads l ON l.id = t.lead_id
       WHERE t.kind = 'callback' AND t.completed_at IS NULL AND t.due_at IS NOT NULL AND ${A.has('t', 'assigned_to', '$1')}
       ORDER BY t.due_at`, [req.user.id]);
    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/callbacks/due — what should be on this user's screen right now
router.get('/due', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.due_at, t.lead_id, l.name AS lead_name, l.phone,
              ${A.names('t', 'assigned_to')} AS assigned_name,
              ${A.has('t', 'assigned_to', '$1')} AS mine,
              GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - t.due_at)) / 60))::int AS late_min
       FROM tasks t JOIN leads l ON l.id = t.lead_id
       WHERE t.kind = 'callback' AND t.completed_at IS NULL AND t.due_at IS NOT NULL
         AND ( (${A.has('t', 'assigned_to', '$1')} AND t.due_at <= NOW() + INTERVAL '${LEAD_MIN} minutes')
            OR ($2 AND t.due_at <= NOW() - INTERVAL '${ESCALATE_MIN} minutes' AND t.due_at > NOW() - INTERVAL '${ESCALATE_MAX_H} hours') )
       ORDER BY t.due_at`,
      [req.user.id, isSales(req.user)]);
    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function loadOpen(req, res) {
  const { rows: [t] } = await pool.query(
    `SELECT t.*, l.name AS lead_name FROM tasks t JOIN leads l ON l.id = t.lead_id WHERE t.id = $1 AND t.kind = 'callback'`, [req.params.id]);
  if (!t) { res.status(404).json({ error: 'לא נמצא' }); return null; }
  if (t.completed_at) { res.status(409).json({ error: 'השיחה החוזרת כבר טופלה' }); return null; }
  const own = t.assigned_to === req.user.id || (t.extra_assignees || []).includes(req.user.id) || t.created_by === req.user.id;
  if (!own && !isSales(req.user)) { res.status(403).json({ error: 'Forbidden' }); return null; }
  return t;
}

// POST /api/callbacks/:id/snooze  { minutes } | { due_at }  — a new time (the WhatsApp reminder fires again)
router.post('/:id/snooze', async (req, res) => {
  try {
    const t = await loadOpen(req, res); if (!t) return;
    const mins = Number(req.body.minutes);
    const due = mins > 0 ? new Date(Date.now() + mins * 60_000) : parseDue(req.body.due_at);
    if (!due || due.getTime() < Date.now() - 60_000) return res.status(400).json({ error: 'שעה לא תקינה' });
    await pool.query(
      `UPDATE tasks SET due_at = $2, remind_sent_at = NULL, callback_escalated_at = NULL, nudge_level = 0, nudge_sent_at = NULL,
              postpone_count = COALESCE(postpone_count, 0) + 1 WHERE id = $1`, [t.id, due]);
    await note(t.lead_id, `⏭ שיחה חוזרת נדחתה ל-${dayTime(due)}${req.body.reason ? `\n${String(req.body.reason).slice(0, 200)}` : ''}`, req.user.id);
    res.json({ ok: true, due_at: due });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/callbacks/:id/done  { outcome: 'talked' | 'cancel', result }
router.post('/:id/done', async (req, res) => {
  try {
    const t = await loadOpen(req, res); if (!t) return;
    const result = String(req.body.result || '').trim().slice(0, 500) || null;
    if (req.body.outcome === 'cancel') {
      await pool.query(`UPDATE tasks SET completed_at = NOW(), cancelled_at = NOW(), cancel_reason = $2, result = $3 WHERE id = $1`,
        [t.id, result, `לא רלוונטי${result ? `: ${result}` : ''}`]);
      await note(t.lead_id, `🚫 שיחה חוזרת בוטלה (לא רלוונטי${result ? `: ${result}` : ''})`, req.user.id);
    } else {
      await pool.query(`UPDATE tasks SET completed_at = NOW(), result = $2 WHERE id = $1`, [t.id, result || 'חזרנו ללקוח']);
      await note(t.lead_id, `✅ חזרנו ללקוח (נקבע ל-${hhmm(t.due_at)})${result ? `\n${result}` : ''}`, req.user.id);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// An answered outbound call to the lead closes his waiting callback (due within the next 30 minutes
// or already late). Called from routes/calls.js when a system call ends.
async function closeAfterCall(leadId, userId) {
  if (!leadId) return;
  try {
    const { rows } = await pool.query(
      `UPDATE tasks SET completed_at = NOW(), result = 'חזרנו ללקוח (שיחה מהמערכת)'
       WHERE kind = 'callback' AND lead_id = $1 AND completed_at IS NULL AND due_at <= NOW() + INTERVAL '30 minutes'
       RETURNING id, due_at`, [leadId]);
    for (const t of rows) await note(leadId, `✅ חזרנו ללקוח (נקבע ל-${hhmm(t.due_at)})`, userId || null);
  } catch (err) { console.error('[Callbacks] closeAfterCall:', err.message); }
}

// ---- WhatsApp (Oran, 2026-11-18: "שזה גם ישלח לוואצאפ") ------------------------------------------
// Runs every minute. Two messages per callback, each sent once (a new time re-arms both):
//   1. to the assignee(s), LEAD_MIN minutes before the time;
//   2. to every other sales user, ESCALATE_MIN minutes after it, if it is still open.
// Everything goes through the task-nudge queue: one message every few seconds, never a burst,
// and never to a blocked user.
const baseUrl = () => process.env.SERVER_URL || 'https://crm-production-c3df.up.railway.app';
async function runCallbackReminders() {
  try {
    const { queueNudge } = require('../services/taskNudgeService');
    const tail = t => `${t.phone ? `\n📞 ${t.phone}` : ''}\nלפתיחת הליד: ${baseUrl()}/?lead=${t.lead_id}`;
    const noteOf = t => { const n = (t.title || '').replace(/^לחזור ללקוח\s*(—\s*)?/, ''); return n ? `\n${n}` : ''; };

    const first = await pool.query(
      `UPDATE tasks t SET remind_sent_at = NOW()
       FROM leads l
       WHERE l.id = t.lead_id AND t.kind = 'callback' AND t.completed_at IS NULL AND t.remind_sent_at IS NULL
         AND t.due_at <= NOW() + INTERVAL '${LEAD_MIN} minutes' AND t.due_at > NOW() - INTERVAL '2 hours'
       RETURNING t.id, t.title, t.due_at, t.lead_id, t.assigned_to, t.extra_assignees, l.name AS lead_name, l.phone`);
    for (const t of first.rows) {
      const early = new Date(t.due_at).getTime() - Date.now() > 60_000;
      const text = `📞 שיחה חוזרת${early ? ` בעוד ${Math.ceil((new Date(t.due_at).getTime() - Date.now()) / 60_000)} דק׳` : ' — עכשיו'}: לחזור ל${t.lead_name} ב-${hhmm(t.due_at)}${noteOf(t)}${tail(t)}`;
      for (const uid of new Set([t.assigned_to, ...(t.extra_assignees || [])].filter(Boolean))) queueNudge(uid, text);
    }

    const late = await pool.query(
      `UPDATE tasks t SET callback_escalated_at = NOW()
       FROM leads l
       WHERE l.id = t.lead_id AND t.kind = 'callback' AND t.completed_at IS NULL AND t.callback_escalated_at IS NULL
         AND t.due_at <= NOW() - INTERVAL '${ESCALATE_MIN} minutes' AND t.due_at > NOW() - INTERVAL '2 hours'
       RETURNING t.id, t.title, t.due_at, t.lead_id, t.assigned_to, t.extra_assignees, l.name AS lead_name, l.phone,
                 ${A.names('t', 'assigned_to')} AS assigned_name`);
    if (late.rows.length) {
      const { rows: users } = await pool.query(`SELECT id, role, roles FROM users WHERE NOT COALESCE(blocked, false) AND phone IS NOT NULL`);
      for (const t of late.rows) {
        const own = new Set([t.assigned_to, ...(t.extra_assignees || [])]);
        const text = `📞 ${t.assigned_name || 'הנציג'} עוד לא חזר/ה ל${t.lead_name} (נקבע ל-${hhmm(t.due_at)}). מי שפנוי — לחזור ללקוח:${noteOf(t)}${tail(t)}`;
        users.filter(u => !own.has(u.id) && isSales(u)).forEach(u => queueNudge(u.id, text));
      }
    }
  } catch (err) { console.error('[Callbacks] reminders:', err.message); }
}

module.exports = router;
module.exports.closeAfterCall = closeAfterCall;
module.exports.runCallbackReminders = runCallbackReminders;
