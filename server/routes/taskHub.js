// Phase 134 — ניהול משימות (the task hub). A new screen beside the existing משימות tab:
//   GET  /api/task-hub/today              — "היום שלי": the caller's open tasks from every source,
//                                           split into focus / today / soon / later / waiting
//   POST /api/task-hub/focus              — mark a task "בטיפול עכשיו" (at most FOCUS_LIMIT)
//   DELETE /api/task-hub/focus/:kind/:id  — unmark
//   GET  /api/task-hub/board/production   — a column per event, nearest first
// Rows come from the same queries as "המשימות שלי" (routes/myTasks.js), and the actions on a row
// (בוצע / דחייה / לא רלוונטי) are the existing /api/my-tasks/:kind/:id/* endpoints.
const router = require('express').Router();
const pool = require('../db/pool');
const A = require('../utils/assignees');
const { LEAD_TASK_SQL, OP_TASK_SQL, MAINT_SQL, FAULT_SQL, sortRows } = require('./myTasks').SQL;
const { ITEMS: CHECKLIST_ITEMS } = require('./productionChecklist');
const { MISSING_LABELS, israelToday } = require('../services/eventReadiness');

const FOCUS_LIMIT = 3;
const SOON_DAYS = 7;          // "בקרוב" = due within a week
const BOARD_DAYS = 60;        // events further away than this share one "רחוק יותר" column
const CATEGORY = { callbacks: 'מכירות', sales: 'מכירות', production: 'הפקה', operations: 'תפעול', maintenance: 'אחזקה' };
const rolesOf = u => (u.roles?.length ? u.roles : [u.role]).filter(Boolean);
const seesAllEvents = u => rolesOf(u).some(r => ['admin', 'manager', 'production', 'operations'].includes(r));

function addDays(dayStr, n) {
  const d = new Date(`${dayStr}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
// leads.event_date is a DATE; the queries below return it already formatted (YYYY-MM-DD).
const LEAD_WITH_EVENT = sql => `
  SELECT x.*, to_char(le.event_date, 'YYYY-MM-DD') AS event_date, le.event_type
  FROM (${sql}) x JOIN leads le ON le.id = x.lead_id`;

// Everything open that belongs to the user, plus what he gave to others, with the focus marks.
async function loadToday(uid) {
  const [lead, op, maint, fault, dLead, dOp, dFault, focus] = await Promise.all([
    pool.query(LEAD_WITH_EVENT(`${LEAD_TASK_SQL} WHERE ${A.has('t', 'assigned_to', '$1')} AND t.completed_at IS NULL`), [uid]),
    pool.query(`${OP_TASK_SQL} WHERE ${A.has('t', 'assigned_to', '$1')} AND t.status <> 'done'`, [uid]),
    pool.query(MAINT_SQL, [uid]),
    pool.query(`${FAULT_SQL} WHERE ${A.has('f', 'assignee_id', '$1')} AND f.status <> 'resolved'`, [uid]),
    pool.query(LEAD_WITH_EVENT(`${LEAD_TASK_SQL} WHERE t.created_by = $1 AND ${A.hasNot('t', 'assigned_to', '$1')} AND t.completed_at IS NULL`), [uid]),
    pool.query(`${OP_TASK_SQL} WHERE t.created_by = $1 AND ${A.hasNot('t', 'assigned_to', '$1')} AND t.status <> 'done'`, [uid]),
    pool.query(`${FAULT_SQL} WHERE f.reported_by = $1 AND ${A.hasNot('f', 'assignee_id', '$1')} AND f.status <> 'resolved'`, [uid]),
    pool.query('SELECT kind, task_id FROM task_focus WHERE user_id = $1', [uid]),
  ]);
  const today = israelToday(), soonEnd = addDays(today, SOON_DAYS);
  const focusKeys = new Set(focus.rows.map(r => `${r.kind}-${r.task_id}`));
  const out = { focus: [], today: [], soon: [], later: [], waiting: [] };
  const mine = [...lead.rows, ...op.rows, ...maint.rows, ...fault.rows];
  const liveKeys = new Set();
  for (const r of mine) {
    r.category = CATEGORY[r.group] || 'כללי';
    const key = `${r.kind}-${r.id}`;
    liveKeys.add(key);
    if (focusKeys.has(key)) { r.focus = true; out.focus.push(r); continue; }
    if (r.overdue || (r.due_date && r.due_date <= today)) out.today.push(r);
    // an open fault has no date of its own — it belongs with the near things, not at the bottom
    else if ((r.due_date && r.due_date <= soonEnd) || r.kind === 'fault') out.soon.push(r);
    else out.later.push(r);
  }
  for (const r of [...dLead.rows, ...dOp.rows, ...dFault.rows]) { r.category = CATEGORY[r.group] || 'כללי'; out.waiting.push(r); }
  Object.values(out).forEach(sortRows);
  // marks left on tasks that were closed or handed to someone else
  const stale = focus.rows.filter(r => !liveKeys.has(`${r.kind}-${r.task_id}`));
  for (const r of stale) await pool.query('DELETE FROM task_focus WHERE user_id = $1 AND kind = $2 AND task_id = $3', [uid, r.kind, r.task_id]);
  return out;
}

router.get('/today', async (req, res) => {
  try {
    res.json({ ...(await loadToday(req.user.id)), focus_limit: FOCUS_LIMIT });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/focus', async (req, res) => {
  const kind = String(req.body.kind || ''), id = Number(req.body.id);
  if (!['lead', 'op', 'maintenance', 'fault'].includes(kind) || !Number.isInteger(id)) return res.status(400).json({ error: 'משימה לא תקינה' });
  try {
    const cur = await loadToday(req.user.id);
    const all = [...cur.focus, ...cur.today, ...cur.soon, ...cur.later];
    if (!all.some(r => r.kind === kind && r.id === id)) return res.status(404).json({ error: 'המשימה לא נמצאה ברשימה שלך' });
    if (cur.focus.some(r => r.kind === kind && r.id === id)) return res.json({ ok: true });
    if (cur.focus.length >= FOCUS_LIMIT) return res.status(400).json({ error: `אפשר עד ${FOCUS_LIMIT} משימות בטיפול בו-זמנית. סיים או הוצא אחת קודם.` });
    await pool.query('INSERT INTO task_focus (user_id, kind, task_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [req.user.id, kind, id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/focus/:kind/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM task_focus WHERE user_id = $1 AND kind = $2 AND task_id = $3', [req.user.id, req.params.kind, Number(req.params.id) || 0]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A column per event. Upcoming events (deposit / production) nearest first; events whose date has
// passed, or that were closed with tasks still open, come after them as "לסגירה" and leave the board
// only when nothing is open; events more than BOARD_DAYS away share one list.
// Managers, production and operations users see every event; anyone else sees the events where he
// is the production manager or has an open task.
router.get('/board/production', async (req, res) => {
  const uid = req.user.id, all = seesAllEvents(req.user);
  const today = israelToday();
  try {
    const { rows: leads } = await pool.query(`
      SELECT l.id, l.name, l.event_type, to_char(l.event_date, 'YYYY-MM-DD') AS event_date, l.stage, l.guest_count,
             COALESCE(l.deposit_confirmed, false) AS deposit_confirmed,
             COALESCE(l.full_payment_confirmed, false) AS full_payment_confirmed,
             l.production_manager_id, pm.display_name AS production_manager_name,
             (SELECT COUNT(*) FROM event_briefs eb WHERE eb.lead_id = l.id AND eb.data::text <> '{}')::int AS brief_count,
             (SELECT COUNT(*) FROM production_checklist pc WHERE pc.lead_id = l.id AND pc.checked_at IS NOT NULL)::int AS checked_count,
             (SELECT COUNT(*) FROM tasks t WHERE t.lead_id = l.id AND t.completed_at IS NOT NULL AND t.cancelled_at IS NULL)::int AS tasks_done,
             (SELECT COUNT(*) FROM tasks t WHERE t.lead_id = l.id AND t.completed_at IS NULL)::int AS tasks_open
      FROM leads l
      LEFT JOIN users pm ON pm.id = l.production_manager_id
      WHERE l.event_date IS NOT NULL
        AND (l.stage IN ('deposit', 'production')
             OR (l.stage = 'completed' AND EXISTS (SELECT 1 FROM tasks t WHERE t.lead_id = l.id AND t.completed_at IS NULL)))
        AND ($1::boolean OR l.production_manager_id = $2
             OR EXISTS (SELECT 1 FROM tasks t WHERE t.lead_id = l.id AND t.completed_at IS NULL AND ${A.has('t', 'assigned_to', '$2')}))
      ORDER BY l.event_date ASC, l.id ASC
    `, [all, uid]);
    const ids = leads.map(l => l.id);
    const { rows: tasks } = ids.length
      ? await pool.query(`${LEAD_TASK_SQL} WHERE t.lead_id = ANY($1::int[]) AND t.completed_at IS NULL`, [ids])
      : { rows: [] };
    const byLead = {};
    for (const t of tasks) { t.category = 'הפקה'; (byLead[t.lead_id] = byLead[t.lead_id] || []).push(t); }
    const upcoming = [], closing = [], far = [];
    for (const l of leads) {
      const days = daysBetween(today, l.event_date);
      const past = days < 0 || l.stage === 'completed';
      const missing = [];
      if (l.stage !== 'completed') {
        if (!l.brief_count) missing.push('brief');
        if (l.checked_count < CHECKLIST_ITEMS.length) missing.push('checklist');
        if (!l.deposit_confirmed) missing.push('deposit');
        if (!l.production_manager_id) missing.push('production_manager');
        if (past && !l.full_payment_confirmed) missing.push('full_payment');
      }
      const total = l.tasks_done + l.tasks_open + CHECKLIST_ITEMS.length;
      const col = {
        lead_id: l.id, name: l.name, event_type: l.event_type, event_date: l.event_date, stage: l.stage,
        guest_count: l.guest_count, production_manager_name: l.production_manager_name,
        days_until: days, closing: past,
        done: l.tasks_done + l.checked_count, total,
        missing_labels: missing.map(k => MISSING_LABELS[k]),
        tasks: sortRows(byLead[l.id] || []),
      };
      if (past) closing.push(col);
      else if (days > BOARD_DAYS) far.push({ ...col, tasks: undefined, tasks_open: l.tasks_open });
      else upcoming.push(col);
    }
    res.json({ today, board_days: BOARD_DAYS, upcoming, closing, far });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
