// Phase 55 — task nudges ("נודניק"). Until now a task got exactly one WhatsApp at its due time.
// Now, once a day (09:30 Israel):
//   1. every user with overdue tasks (lead tasks + תפעול tasks, due date passed) gets ONE digest
//      listing them, with a link to הפעילות שלי where each must be completed / postponed / cancelled;
//   2. tasks overdue 3+ days are escalated ONCE a week to whoever gave the task (or to the managers
//      when the giver is the assignee or unknown) — again one digest per recipient.
// Nothing is sent in bulk: every message goes through a single queue that sends one WhatsApp
// every few seconds, so a busy morning spreads over a few minutes instead of a burst.
const pool  = require('../db/pool');
const axios = require('axios');

const GREEN_API_URL      = process.env.GREEN_API_URL;
const GREEN_API_INSTANCE = process.env.GREEN_API_INSTANCE;
const GREEN_API_TOKEN    = process.env.GREEN_API_TOKEN;
const GAP_MS = 6000;                  // gap between two sends
const ESCALATE_AFTER_DAYS = 3;
const RE_ESCALATE_DAYS = 7;
const MAX_LINES = 8;                  // tasks listed per digest; the rest is "ועוד N"

// ---- the queue ----------------------------------------------------------------------------
const queue = [];
let draining = false;
async function drain() {
  if (draining) return; draining = true;
  try {
    while (queue.length) {
      const { userId, text } = queue.shift();
      try {
        const { rows: [u] } = await pool.query(`SELECT phone, display_name FROM users WHERE id = $1 AND NOT COALESCE(blocked, false)`, [userId]);
        if (u?.phone && GREEN_API_URL) {
          const chatId = u.phone.replace(/\D/g, '').replace(/^0/, '972') + '@c.us';
          await axios.post(`${GREEN_API_URL}/waInstance${GREEN_API_INSTANCE}/sendMessage/${GREEN_API_TOKEN}`, { chatId, message: text });
          console.log(`[TaskNudge] sent to ${u.display_name}`);
        }
      } catch (err) {
        console.error('[TaskNudge] send failed:', err.message);
      }
      await new Promise(r => setTimeout(r, GAP_MS));
    }
  } finally { draining = false; }
}
function queueNudge(userId, text) {
  if (!userId || !text) return;
  queue.push({ userId, text });
  drain().catch(err => console.error('[TaskNudge] drain error:', err.message));
}

// ---- the daily run -------------------------------------------------------------------------
const baseUrl = () => process.env.SERVER_URL || 'https://crm-production-c3df.up.railway.app';
const israelNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
const dayStr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Overdue lead + תפעול tasks with how many days late, assignee and creator.
const OVERDUE_SQL = `
  SELECT 'lead' AS kind, t.id, t.title, l.name AS who, t.assigned_to, t.created_by,
         ((NOW() AT TIME ZONE 'Asia/Jerusalem')::date - (t.due_at AT TIME ZONE 'Asia/Jerusalem')::date) AS days_late,
         t.escalated_at
  FROM tasks t JOIN leads l ON l.id = t.lead_id
  WHERE t.completed_at IS NULL AND t.assigned_to IS NOT NULL AND t.due_at IS NOT NULL
    AND (t.due_at AT TIME ZONE 'Asia/Jerusalem')::date < (NOW() AT TIME ZONE 'Asia/Jerusalem')::date
  UNION ALL
  SELECT 'op', t.id, t.title, NULL, t.assigned_to, t.created_by,
         ((NOW() AT TIME ZONE 'Asia/Jerusalem')::date - t.due_date), t.escalated_at
  FROM op_tasks t
  WHERE t.status <> 'done' AND t.assigned_to IS NOT NULL AND t.due_date IS NOT NULL
    AND t.due_date < (NOW() AT TIME ZONE 'Asia/Jerusalem')::date`;

function listLines(rows, withWho = true) {
  const lines = rows.slice(0, MAX_LINES).map(r =>
    `• ${r.title}${r.who ? ` – ${r.who}` : ''}${withWho && r.assigned_name ? ` (${r.assigned_name})` : ''} · באיחור ${r.days_late} ${r.days_late === 1 ? 'יום' : 'ימים'}`);
  if (rows.length > MAX_LINES) lines.push(`…ועוד ${rows.length - MAX_LINES}`);
  return lines.join('\n');
}

async function runTaskNudges() {
  try {
    const now = israelNow();
    if (now.getHours() !== 9 || now.getMinutes() < 30) return;   // one window a day, 09:30–09:59
    const today = dayStr(now);
    const { rows: [flag] } = await pool.query(`SELECT value FROM settings WHERE key = 'task_nudge_last_day'`);
    if (flag?.value === today) return;
    await pool.query(`INSERT INTO settings (key, value) VALUES ('task_nudge_last_day', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [today]);

    const { rows } = await pool.query(OVERDUE_SQL);
    if (!rows.length) return;
    const { rows: users } = await pool.query(`SELECT id, display_name, phone, role, roles FROM users WHERE NOT COALESCE(blocked, false)`);
    const byId = new Map(users.map(u => [u.id, u]));
    rows.forEach(r => { r.assigned_name = byId.get(r.assigned_to)?.display_name || null; });
    const managers = users.filter(u => (u.roles?.length ? u.roles : [u.role]).some(x => ['admin', 'manager'].includes(x)));

    // 1. one digest per assignee
    const perAssignee = new Map();
    rows.forEach(r => { if (!perAssignee.has(r.assigned_to)) perAssignee.set(r.assigned_to, []); perAssignee.get(r.assigned_to).push(r); });
    for (const [uid, list] of perAssignee) {
      list.sort((a, b) => b.days_late - a.days_late);
      queueNudge(uid,
        `⏰ יש לך ${list.length} ${list.length === 1 ? 'משימה' : 'משימות'} באיחור:\n${listLines(list, false)}\n\n` +
        `לכל אחת צריך לבחור: בוצע / דחייה / לא רלוונטי 👇\n${baseUrl()}/my-activity`);
    }

    // 2. escalation to the giver (or the managers) for tasks 3+ days late, at most once a week per task
    const toEscalate = rows.filter(r => r.days_late >= ESCALATE_AFTER_DAYS &&
      (!r.escalated_at || (Date.now() - new Date(r.escalated_at).getTime()) > RE_ESCALATE_DAYS * 86400000));
    const perRecipient = new Map();
    for (const r of toEscalate) {
      const giver = r.created_by && r.created_by !== r.assigned_to ? [r.created_by] : managers.map(m => m.id).filter(id => id !== r.assigned_to);
      for (const rid of giver) { if (!perRecipient.has(rid)) perRecipient.set(rid, []); perRecipient.get(rid).push(r); }
    }
    for (const [rid, list] of perRecipient) {
      list.sort((a, b) => b.days_late - a.days_late);
      queueNudge(rid,
        `🔔 ${list.length} ${list.length === 1 ? 'משימה שנתת' : 'משימות שנתת'} באיחור של ${ESCALATE_AFTER_DAYS}+ ימים:\n${listLines(list, true)}\n\n` +
        `לפירוט: ${baseUrl()}/my-activity`);
    }
    for (const r of toEscalate) {
      await pool.query(`UPDATE ${r.kind === 'lead' ? 'tasks' : 'op_tasks'} SET escalated_at = NOW() WHERE id = $1`, [r.id]);
    }
    console.log(`[TaskNudge] digests: ${perAssignee.size} assignees, ${perRecipient.size} escalations`);
  } catch (err) {
    console.error('[TaskNudge] error:', err.message);
  }
}

module.exports = { runTaskNudges, queueNudge };
