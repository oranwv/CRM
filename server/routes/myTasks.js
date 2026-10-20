// Phase 55 — "המשימות שלי" (on הפעילות שלי) + the overdue-tasks gate.
// One place that gathers a user's tasks from every source, grouped the way Oran asked:
//   sales       — lead tasks (`tasks`) while the lead is still in the sales pipeline
//   production  — lead tasks once the event is closed (deposit / production / completed)
//   operations  — תפעול tasks (`op_tasks`)
//   maintenance — periodic maintenance that is due (`op_maintenance`) + open faults (`op_faults`)
// "mine" = assigned to the user; "delegated" = created by the user and assigned to someone else.
// Managers may pass ?user=<id> to see another user's page.
const router = require('express').Router();
const pool = require('../db/pool');

const PRODUCTION_STAGES = `('deposit','production','completed')`;
const isManager = u => (u.roles || [u.role]).some(r => ['admin', 'manager', 'sales_manager'].includes(r));

// Which user the request is about: the caller, or ?user= for managers only.
function targetUser(req, res) {
  const asked = Number(req.query.user || 0);
  if (!asked || asked === req.user.id) return req.user.id;
  if (!isManager(req.user)) { res.status(403).json({ error: 'Forbidden' }); return null; }
  return asked;
}

// ---- queries ---------------------------------------------------------------------------------
// Every row is normalised to: { kind, id, title, who (lead/event name), lead_id, due (ISO or null),
// due_date (YYYY-MM-DD Israel), overdue, done, done_at, result, assigned_to, assigned_name,
// created_by, created_by_name, postpone_count, group }
const LEAD_TASK_SQL = `
  SELECT 'lead' AS kind, t.id, t.title, l.name AS who, t.lead_id,
         t.due_at AS due, to_char(t.due_at AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD') AS due_date,
         (t.completed_at IS NULL AND t.due_at IS NOT NULL AND t.due_at < NOW()) AS overdue,
         (t.completed_at IS NOT NULL) AS done, t.completed_at AS done_at, t.result,
         t.cancelled_at IS NOT NULL AS cancelled,
         t.assigned_to, ua.display_name AS assigned_name, t.created_by, uc.display_name AS created_by_name,
         COALESCE(t.postpone_count, 0) AS postpone_count, t.created_at,
         CASE WHEN l.stage IN ${PRODUCTION_STAGES} THEN 'production' ELSE 'sales' END AS "group"
  FROM tasks t
  JOIN leads l ON l.id = t.lead_id
  LEFT JOIN users ua ON ua.id = t.assigned_to
  LEFT JOIN users uc ON uc.id = t.created_by`;

const OP_TASK_SQL = `
  SELECT 'op' AS kind, t.id, t.title, NULL::text AS who, NULL::int AS lead_id,
         t.due_date::timestamptz AS due, to_char(t.due_date, 'YYYY-MM-DD') AS due_date,
         (t.status <> 'done' AND t.due_date IS NOT NULL AND t.due_date < (NOW() AT TIME ZONE 'Asia/Jerusalem')::date) AS overdue,
         (t.status = 'done') AS done, t.completed_at AS done_at, t.notes AS result,
         t.cancelled_at IS NOT NULL AS cancelled,
         t.assigned_to, ua.display_name AS assigned_name, t.created_by, uc.display_name AS created_by_name,
         COALESCE(t.postpone_count, 0) AS postpone_count, t.created_at,
         'operations' AS "group"
  FROM op_tasks t
  LEFT JOIN users ua ON ua.id = t.assigned_to
  LEFT JOIN users uc ON uc.id = t.created_by`;

const MAINT_SQL = `
  SELECT 'maintenance' AS kind, m.id, m.name AS title, NULL::text AS who, NULL::int AS lead_id,
         m.next_due::timestamptz AS due, to_char(m.next_due, 'YYYY-MM-DD') AS due_date,
         (m.next_due IS NOT NULL AND m.next_due < (NOW() AT TIME ZONE 'Asia/Jerusalem')::date) AS overdue,
         false AS done, NULL::timestamptz AS done_at, NULL::text AS result, false AS cancelled,
         m.assignee_id AS assigned_to, ua.display_name AS assigned_name, NULL::int AS created_by, NULL::text AS created_by_name,
         0 AS postpone_count, m.created_at,
         'maintenance' AS "group"
  FROM op_maintenance m
  LEFT JOIN users ua ON ua.id = m.assignee_id
  WHERE m.assignee_id = $1 AND m.next_due IS NOT NULL
    AND m.next_due <= (NOW() AT TIME ZONE 'Asia/Jerusalem')::date + 7`;

const FAULT_SQL = `
  SELECT 'fault' AS kind, f.id, f.title, NULL::text AS who, NULL::int AS lead_id,
         NULL::timestamptz AS due, NULL::text AS due_date,
         false AS overdue,
         (f.status = 'resolved') AS done, f.resolved_at AS done_at, f.notes AS result, false AS cancelled,
         f.assignee_id AS assigned_to, ua.display_name AS assigned_name, f.reported_by AS created_by, ur.display_name AS created_by_name,
         0 AS postpone_count, f.created_at,
         'maintenance' AS "group"
  FROM op_faults f
  LEFT JOIN users ua ON ua.id = f.assignee_id
  LEFT JOIN users ur ON ur.id = f.reported_by`;

const EMPTY = () => ({ sales: [], production: [], operations: [], maintenance: [] });
const sortRows = rows => rows.sort((a, b) => {
  if (a.done !== b.done) return a.done ? 1 : -1;           // open first
  if (!a.done && a.overdue !== b.overdue) return a.overdue ? -1 : 1; // overdue first among open
  const ad = a.due ? new Date(a.due).getTime() : Infinity, bd = b.due ? new Date(b.due).getTime() : Infinity;
  if (ad !== bd) return ad - bd;
  return new Date(b.created_at) - new Date(a.created_at);
});

// GET /api/my-tasks?user=&from=&to=
// Open items are always returned (they are not date-bound); completed ones only inside [from, to].
router.get('/', async (req, res) => {
  const uid = targetUser(req, res); if (!uid) return;
  const today = new Date().toISOString().slice(0, 10);
  const from = req.query.from || today, to = req.query.to || from;
  const inRange = col => `(${col} AT TIME ZONE 'Asia/Jerusalem')::date BETWEEN $2::date AND $3::date`;
  try {
    const [mineLead, mineOp, mineMaint, mineFault, delLead, delOp, delFault] = await Promise.all([
      pool.query(`${LEAD_TASK_SQL} WHERE t.assigned_to = $1 AND (t.completed_at IS NULL OR ${inRange('t.completed_at')})`, [uid, from, to]),
      pool.query(`${OP_TASK_SQL} WHERE t.assigned_to = $1 AND (t.status <> 'done' OR ${inRange('t.completed_at')})`, [uid, from, to]),
      pool.query(MAINT_SQL, [uid]),
      pool.query(`${FAULT_SQL} WHERE f.assignee_id = $1 AND (f.status <> 'resolved' OR ${inRange('f.resolved_at')})`, [uid, from, to]),
      pool.query(`${LEAD_TASK_SQL} WHERE t.created_by = $1 AND t.assigned_to IS DISTINCT FROM $1 AND (t.completed_at IS NULL OR ${inRange('t.completed_at')})`, [uid, from, to]),
      pool.query(`${OP_TASK_SQL} WHERE t.created_by = $1 AND t.assigned_to IS DISTINCT FROM $1 AND (t.status <> 'done' OR ${inRange('t.completed_at')})`, [uid, from, to]),
      pool.query(`${FAULT_SQL} WHERE f.reported_by = $1 AND f.assignee_id IS DISTINCT FROM $1 AND (f.status <> 'resolved' OR ${inRange('f.resolved_at')})`, [uid, from, to]),
    ]);
    const mine = EMPTY(), delegated = EMPTY();
    [...mineLead.rows, ...mineOp.rows, ...mineMaint.rows, ...mineFault.rows].forEach(r => mine[r.group].push(r));
    [...delLead.rows, ...delOp.rows, ...delFault.rows].forEach(r => delegated[r.group].push(r));
    Object.values(mine).forEach(sortRows); Object.values(delegated).forEach(sortRows);
    const { rows: [u] } = await pool.query('SELECT id, display_name FROM users WHERE id = $1', [uid]);
    res.json({ user: u || { id: uid }, mine, delegated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/my-tasks/overdue — the caller's own overdue items (lead tasks, תפעול tasks, due maintenance).
// Feeds the header badge and the blocking "טפל במשימות" window.
router.get('/overdue', async (req, res) => {
  const uid = req.user.id;
  try {
    const [a, b, c] = await Promise.all([
      pool.query(`${LEAD_TASK_SQL} WHERE t.assigned_to = $1 AND t.completed_at IS NULL AND t.due_at IS NOT NULL AND t.due_at < NOW()`, [uid]),
      pool.query(`${OP_TASK_SQL} WHERE t.assigned_to = $1 AND t.status <> 'done' AND t.due_date IS NOT NULL AND t.due_date < (NOW() AT TIME ZONE 'Asia/Jerusalem')::date`, [uid]),
      pool.query(`${MAINT_SQL} AND m.next_due < (NOW() AT TIME ZONE 'Asia/Jerusalem')::date`, [uid]),
    ]);
    const items = sortRows([...a.rows, ...b.rows, ...c.rows]);
    res.json({ count: items.length, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- actions ---------------------------------------------------------------------------------
// The assignee, the creator, or a manager may act on an item.
async function loadItem(kind, id) {
  if (kind === 'lead') return (await pool.query('SELECT t.*, l.name AS lead_name FROM tasks t JOIN leads l ON l.id = t.lead_id WHERE t.id = $1', [id])).rows[0];
  if (kind === 'op') return (await pool.query('SELECT * FROM op_tasks WHERE id = $1', [id])).rows[0];
  if (kind === 'maintenance') return (await pool.query('SELECT *, assignee_id AS assigned_to FROM op_maintenance WHERE id = $1', [id])).rows[0];
  return null;
}
function mayAct(user, item) {
  return isManager(user) || item.assigned_to === user.id || item.created_by === user.id;
}

// POST /api/my-tasks/:kind/:id/complete  { result }
router.post('/:kind/:id/complete', async (req, res) => {
  const { kind, id } = req.params; const result = (req.body.result || '').trim() || null;
  try {
    const item = await loadItem(kind, id);
    if (!item) return res.status(404).json({ error: 'לא נמצא' });
    if (!mayAct(req.user, item)) return res.status(403).json({ error: 'Forbidden' });
    if (kind === 'lead') {
      await pool.query('UPDATE tasks SET completed_at = NOW(), result = $2 WHERE id = $1', [id, result]);
      await pool.query(
        `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by) VALUES ($1, 'note', 'outbound', $2, $3)`,
        [item.lead_id, `✅ משימה הושלמה: ${item.title}${result ? `\nתוצאה: ${result}` : ''}`, req.user.id]);
      await pool.query('UPDATE leads SET updated_at = NOW() WHERE id = $1', [item.lead_id]);
    } else if (kind === 'op') {
      await pool.query(`UPDATE op_tasks SET status = 'done', completed_at = NOW(), notes = COALESCE($2, notes) WHERE id = $1`, [id, result]);
    } else if (kind === 'maintenance') {
      const next = new Date(); next.setDate(next.getDate() + (item.interval_days || 30));
      const todayStr = new Date().toISOString().slice(0, 10), nextStr = next.toISOString().slice(0, 10);
      await pool.query(`INSERT INTO op_maintenance_history (maintenance_id, done_date, notes, done_by) VALUES ($1, $2, $3, $4)`, [id, todayStr, result, req.user.id]);
      await pool.query(`UPDATE op_maintenance SET last_done = $1, next_due = $2, status = 'open' WHERE id = $3`, [todayStr, nextStr, id]);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/my-tasks/:kind/:id/postpone  { due_at, reason }
// Counts postponements; from the third one on, the person who gave the task is told (queued, not bulk).
router.post('/:kind/:id/postpone', async (req, res) => {
  const { kind, id } = req.params; const { due_at, reason } = req.body;
  const newDue = new Date(due_at || '');
  if (isNaN(newDue.getTime())) return res.status(400).json({ error: 'תאריך לא תקין' });
  try {
    const item = await loadItem(kind, id);
    if (!item) return res.status(404).json({ error: 'לא נמצא' });
    if (!mayAct(req.user, item)) return res.status(403).json({ error: 'Forbidden' });
    let count = 0;
    if (kind === 'lead') {
      const { rows } = await pool.query(
        `UPDATE tasks SET due_at = $2, remind_sent_at = NULL, nudge_level = 0, nudge_sent_at = NULL,
                postpone_count = COALESCE(postpone_count, 0) + 1, postpone_reason = $3
         WHERE id = $1 RETURNING postpone_count`, [id, newDue, reason || null]);
      count = rows[0].postpone_count;
      await pool.query(
        `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by) VALUES ($1, 'note', 'outbound', $2, $3)`,
        [item.lead_id, `⏭ משימה נדחתה: ${item.title} → ${newDue.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' })}${reason ? `\nסיבה: ${reason}` : ''}`, req.user.id]);
    } else if (kind === 'op') {
      const { rows } = await pool.query(
        `UPDATE op_tasks SET due_date = $2, nudge_level = 0, nudge_sent_at = NULL,
                postpone_count = COALESCE(postpone_count, 0) + 1, postpone_reason = $3
         WHERE id = $1 RETURNING postpone_count`, [id, newDue.toISOString().slice(0, 10), reason || null]);
      count = rows[0].postpone_count;
    } else if (kind === 'maintenance') {
      await pool.query(`UPDATE op_maintenance SET next_due = $2 WHERE id = $1`, [id, newDue.toISOString().slice(0, 10)]);
    }
    if (count >= 3 && item.created_by && item.created_by !== req.user.id) {
      const { queueNudge } = require('../services/taskNudgeService');
      queueNudge(item.created_by,
        `⏭ המשימה "${item.title}"${item.lead_name ? ` (${item.lead_name})` : ''} נדחתה בפעם ה-${count} על ידי ${req.user.display_name || 'העובד'}` +
        `${reason ? ` — ${reason}` : ''}. מועד חדש: ${newDue.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' })}`);
    }
    res.json({ ok: true, postpone_count: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/my-tasks/:kind/:id/cancel  { reason }  — "לא רלוונטי"
router.post('/:kind/:id/cancel', async (req, res) => {
  const { kind, id } = req.params; const reason = (req.body.reason || '').trim() || null;
  try {
    const item = await loadItem(kind, id);
    if (!item) return res.status(404).json({ error: 'לא נמצא' });
    if (!mayAct(req.user, item)) return res.status(403).json({ error: 'Forbidden' });
    const note = `לא רלוונטי${reason ? `: ${reason}` : ''}`;
    if (kind === 'lead') {
      await pool.query(`UPDATE tasks SET completed_at = NOW(), cancelled_at = NOW(), cancel_reason = $2, result = $3 WHERE id = $1`, [id, reason, note]);
      await pool.query(
        `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by) VALUES ($1, 'note', 'outbound', $2, $3)`,
        [item.lead_id, `🚫 משימה בוטלה (${note}): ${item.title}`, req.user.id]);
    } else if (kind === 'op') {
      await pool.query(`UPDATE op_tasks SET status = 'done', completed_at = NOW(), cancelled_at = NOW(), cancel_reason = $2, notes = $3 WHERE id = $1`, [id, reason, note]);
    } else {
      return res.status(400).json({ error: 'תחזוקה תקופתית אי אפשר לבטל מכאן' });
    }
    if (item.created_by && item.created_by !== req.user.id) {
      const { queueNudge } = require('../services/taskNudgeService');
      queueNudge(item.created_by, `🚫 ${req.user.display_name || 'העובד'} סימן/ה את המשימה "${item.title}"${item.lead_name ? ` (${item.lead_name})` : ''} כלא רלוונטית${reason ? `: ${reason}` : ''}`);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
