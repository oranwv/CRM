// Phase 134 — ניהול משימות (the task hub). A new screen beside the existing משימות tab:
//   GET  /api/task-hub/today              — "היום שלי": the caller's open tasks from every source,
//                                           split into focus / today / soon / later / waiting
//   POST /api/task-hub/focus              — mark a task "בטיפול עכשיו" (at most FOCUS_LIMIT)
//   DELETE /api/task-hub/focus/:kind/:id  — unmark
//   GET  /api/task-hub/board/production   — a column per event, nearest first
// Phase 135 adds:
//   hub tasks (`hub_tasks`) — tasks that belong to no lead: personal ones (only their owner ever
//   sees them) and tasks one user gives another, optionally closing only after the giver approves
//     POST /tasks · POST /tasks/:id/complete|postpone|cancel|approve|reject
//   the team view — "מנהל ישיר" (`users.manager_id`) decides who is under whom
//     GET /team · GET /team/:id · PUT /team/manager
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
const CATEGORY = { callbacks: 'מכירות', sales: 'מכירות', production: 'הפקה', operations: 'תפעול', maintenance: 'אחזקה', finance: 'כספים', general: 'כללי', personal: 'אישי' };
const HUB_CATEGORIES = ['sales', 'production', 'operations', 'maintenance', 'finance', 'general'];
const isAdmin = u => rolesOf(u).includes('admin');
const isManagerRole = u => rolesOf(u).some(r => ['admin', 'manager'].includes(r));
const baseUrl = () => process.env.SERVER_URL || 'https://crm-production-c3df.up.railway.app';
const notify = (userId, text) => { try { require('../services/taskNudgeService').queueNudge(userId, text); } catch (e) { console.error('[TaskHub] notify error:', e.message); } };

// Hub tasks in the same normalised shape as the other kinds (see routes/myTasks.js).
const HUB_TASK_SQL = `
  SELECT 'hub' AS kind, h.id, h.title, NULL::text AS who, h.lead_id,
         h.due_date::timestamptz AS due, to_char(h.due_date, 'YYYY-MM-DD') AS due_date,
         (h.status = 'open' AND h.due_date IS NOT NULL AND h.due_date < (NOW() AT TIME ZONE 'Asia/Jerusalem')::date) AS overdue,
         (h.status IN ('done', 'cancelled')) AS done, h.completed_at AS done_at, h.result,
         (h.status = 'cancelled') AS cancelled,
         h.assigned_to, ARRAY[h.assigned_to] AS assignee_ids, ua.display_name AS assigned_name,
         h.created_by, uc.display_name AS created_by_name,
         COALESCE(h.postpone_count, 0) AS postpone_count, h.created_at,
         h.category AS "group", h.is_private, h.requires_approval, h.status, h.notes
  FROM hub_tasks h
  LEFT JOIN users ua ON ua.id = h.assigned_to
  LEFT JOIN users uc ON uc.id = h.created_by`;
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
// `own` = the user is looking at his own list. A manager looking at someone (own = false) never
// gets that person's personal tasks.
async function loadToday(uid, { own = true } = {}) {
  const priv = own ? '' : ' AND NOT h.is_private';
  const [lead, op, maint, fault, dLead, dOp, dFault, focus, hub, dHub, approve] = await Promise.all([
    pool.query(LEAD_WITH_EVENT(`${LEAD_TASK_SQL} WHERE ${A.has('t', 'assigned_to', '$1')} AND t.completed_at IS NULL`), [uid]),
    pool.query(`${OP_TASK_SQL} WHERE ${A.has('t', 'assigned_to', '$1')} AND t.status <> 'done'`, [uid]),
    pool.query(MAINT_SQL, [uid]),
    pool.query(`${FAULT_SQL} WHERE ${A.has('f', 'assignee_id', '$1')} AND f.status <> 'resolved'`, [uid]),
    pool.query(LEAD_WITH_EVENT(`${LEAD_TASK_SQL} WHERE t.created_by = $1 AND ${A.hasNot('t', 'assigned_to', '$1')} AND t.completed_at IS NULL`), [uid]),
    pool.query(`${OP_TASK_SQL} WHERE t.created_by = $1 AND ${A.hasNot('t', 'assigned_to', '$1')} AND t.status <> 'done'`, [uid]),
    pool.query(`${FAULT_SQL} WHERE f.reported_by = $1 AND ${A.hasNot('f', 'assignee_id', '$1')} AND f.status <> 'resolved'`, [uid]),
    pool.query('SELECT kind, task_id FROM task_focus WHERE user_id = $1', [uid]),
    pool.query(`${HUB_TASK_SQL} WHERE h.assigned_to = $1 AND h.status = 'open'${priv}`, [uid]),
    pool.query(`${HUB_TASK_SQL} WHERE h.created_by = $1 AND h.assigned_to <> $1 AND h.status = 'open'`, [uid]),
    pool.query(`${HUB_TASK_SQL} WHERE h.created_by = $1 AND h.status = 'pending_approval'`, [uid]),
  ]);
  const today = israelToday(), soonEnd = addDays(today, SOON_DAYS);
  const focusKeys = new Set(focus.rows.map(r => `${r.kind}-${r.task_id}`));
  const out = { focus: [], today: [], soon: [], later: [], waiting: [], approve: [] };
  const mine = [...lead.rows, ...op.rows, ...maint.rows, ...fault.rows, ...hub.rows];
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
  for (const r of [...dLead.rows, ...dOp.rows, ...dFault.rows, ...dHub.rows]) { r.category = CATEGORY[r.group] || 'כללי'; out.waiting.push(r); }
  for (const r of approve.rows) { r.category = CATEGORY[r.group] || 'כללי'; out.approve.push(r); }
  Object.values(out).forEach(sortRows);
  if (!own) return out;   // a manager's look changes nothing
  // marks left on tasks that were closed or handed to someone else
  const stale = focus.rows.filter(r => !liveKeys.has(`${r.kind}-${r.task_id}`));
  for (const r of stale) await pool.query('DELETE FROM task_focus WHERE user_id = $1 AND kind = $2 AND task_id = $3', [uid, r.kind, r.task_id]);
  return out;
}

router.get('/today', async (req, res) => {
  try {
    const { rows: [t] } = await pool.query('SELECT EXISTS (SELECT 1 FROM users WHERE manager_id = $1 AND NOT COALESCE(blocked, false)) AS has', [req.user.id]);
    res.json({ ...(await loadToday(req.user.id)), focus_limit: FOCUS_LIMIT, has_team: isAdmin(req.user) || !!t?.has, me: req.user.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/focus', async (req, res) => {
  const kind = String(req.body.kind || ''), id = Number(req.body.id);
  if (!['lead', 'op', 'maintenance', 'fault', 'hub'].includes(kind) || !Number.isInteger(id)) return res.status(400).json({ error: 'משימה לא תקינה' });
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

// ---- hub tasks -------------------------------------------------------------------------------
const dayOk = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const fmtDay = s => { const [y, m, d] = s.split('-'); return `${Number(d)}.${Number(m)}.${y.slice(2)}`; };
const nameOf = u => u.display_name || u.username || 'משתמש';

// A personal task exists only for its owner: to anyone else it is "not found".
async function loadHub(id, user) {
  const { rows: [t] } = await pool.query('SELECT * FROM hub_tasks WHERE id = $1', [Number(id) || 0]);
  if (!t || (t.is_private && t.created_by !== user.id)) return null;
  return t;
}
const mayActHub = (user, t) => t.assigned_to === user.id || t.created_by === user.id || (!t.is_private && isManagerRole(user));

// POST /api/task-hub/tasks  { title, notes, category, assigned_to, due_date, is_private, requires_approval }
// Anyone may give a task to anyone. A personal task is always the creator's own.
router.post('/tasks', async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  if (!title) return res.status(400).json({ error: 'צריך לכתוב מה המשימה' });
  const isPrivate = !!b.is_private;
  const assignee = isPrivate ? req.user.id : (Number(b.assigned_to) || req.user.id);
  const category = isPrivate ? 'personal' : (HUB_CATEGORIES.includes(b.category) ? b.category : 'general');
  const due = dayOk(b.due_date) ? b.due_date : null;
  const needsApproval = !isPrivate && assignee !== req.user.id && !!b.requires_approval;
  try {
    if (assignee !== req.user.id) {
      const { rows: [u] } = await pool.query('SELECT id FROM users WHERE id = $1 AND NOT COALESCE(blocked, false)', [assignee]);
      if (!u) return res.status(400).json({ error: 'המשתמש לא נמצא' });
    }
    const { rows: [t] } = await pool.query(
      `INSERT INTO hub_tasks (title, notes, category, is_private, assigned_to, created_by, due_date, requires_approval)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [title, String(b.notes || '').trim() || null, category, isPrivate, assignee, req.user.id, due, needsApproval]);
    if (assignee !== req.user.id) {
      notify(assignee, `📝 משימה חדשה מאת ${nameOf(req.user)}: "${title}"${due ? ` — עד ${fmtDay(due)}` : ''}${needsApproval ? '\n(תיסגר אחרי אישור)' : ''}\n${baseUrl()}/task-hub`);
    }
    res.json({ ok: true, id: t.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/task-hub/tasks/:id/complete  { result }
// A task that needs approval, finished by someone other than the giver, goes back to the giver.
router.post('/tasks/:id/complete', async (req, res) => {
  const result = String(req.body?.result || '').trim() || null;
  try {
    const t = await loadHub(req.params.id, req.user);
    if (!t) return res.status(404).json({ error: 'לא נמצא' });
    if (!mayActHub(req.user, t)) return res.status(403).json({ error: 'Forbidden' });
    if (t.status !== 'open') return res.status(400).json({ error: 'המשימה כבר לא פתוחה' });
    const pending = t.requires_approval && req.user.id !== t.created_by;
    await pool.query(`UPDATE hub_tasks SET status = $2, completed_at = NOW(), result = $3 WHERE id = $1`, [t.id, pending ? 'pending_approval' : 'done', result]);
    if (t.created_by !== req.user.id && !t.is_private) {
      notify(t.created_by, pending
        ? `🔎 ${nameOf(req.user)} סימן/ה שבוצע: "${t.title}"${result ? ` — ${result}` : ''}\nמחכה לאישור שלך: ${baseUrl()}/task-hub`
        : `✅ ${nameOf(req.user)} סיים/ה: "${t.title}"${result ? ` — ${result}` : ''}`);
    }
    res.json({ ok: true, pending });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/task-hub/tasks/:id/approve — the giver confirms; /reject { reason } reopens it.
router.post('/tasks/:id/approve', async (req, res) => {
  try {
    const t = await loadHub(req.params.id, req.user);
    if (!t) return res.status(404).json({ error: 'לא נמצא' });
    if (t.created_by !== req.user.id) return res.status(403).json({ error: 'רק מי שנתן את המשימה מאשר אותה' });
    if (t.status !== 'pending_approval') return res.status(400).json({ error: 'המשימה לא מחכה לאישור' });
    await pool.query(`UPDATE hub_tasks SET status = 'done' WHERE id = $1`, [t.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.post('/tasks/:id/reject', async (req, res) => {
  const reason = String(req.body?.reason || '').trim() || null;
  try {
    const t = await loadHub(req.params.id, req.user);
    if (!t) return res.status(404).json({ error: 'לא נמצא' });
    if (t.created_by !== req.user.id) return res.status(403).json({ error: 'רק מי שנתן את המשימה מחזיר אותה' });
    if (t.status !== 'pending_approval') return res.status(400).json({ error: 'המשימה לא מחכה לאישור' });
    await pool.query(`UPDATE hub_tasks SET status = 'open', completed_at = NULL WHERE id = $1`, [t.id]);
    notify(t.assigned_to, `↩️ ${nameOf(req.user)} החזיר/ה את המשימה "${t.title}"${reason ? `: ${reason}` : ''}\n${baseUrl()}/task-hub`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/task-hub/tasks/:id/postpone  { due_at, reason } — from the third time the giver is told.
router.post('/tasks/:id/postpone', async (req, res) => {
  const day = String(req.body?.due_at || '').slice(0, 10);
  if (!dayOk(day)) return res.status(400).json({ error: 'תאריך לא תקין' });
  const reason = String(req.body?.reason || '').trim() || null;
  try {
    const t = await loadHub(req.params.id, req.user);
    if (!t) return res.status(404).json({ error: 'לא נמצא' });
    if (!mayActHub(req.user, t)) return res.status(403).json({ error: 'Forbidden' });
    if (t.status !== 'open') return res.status(400).json({ error: 'המשימה כבר לא פתוחה' });
    const { rows: [u] } = await pool.query(
      `UPDATE hub_tasks SET due_date = $2, postpone_count = COALESCE(postpone_count, 0) + 1, postpone_reason = $3 WHERE id = $1 RETURNING postpone_count`,
      [t.id, day, reason]);
    if (u.postpone_count >= 3 && t.created_by !== req.user.id && !t.is_private) {
      notify(t.created_by, `⏭ המשימה "${t.title}" נדחתה בפעם ה-${u.postpone_count} על ידי ${nameOf(req.user)}${reason ? ` — ${reason}` : ''}. מועד חדש: ${fmtDay(day)}`);
    }
    res.json({ ok: true, postpone_count: u.postpone_count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/task-hub/tasks/:id/cancel  { reason } — "לא רלוונטי" (for a personal task: simply removes it)
router.post('/tasks/:id/cancel', async (req, res) => {
  const reason = String(req.body?.reason || '').trim() || null;
  try {
    const t = await loadHub(req.params.id, req.user);
    if (!t) return res.status(404).json({ error: 'לא נמצא' });
    if (!mayActHub(req.user, t)) return res.status(403).json({ error: 'Forbidden' });
    if (!['open', 'pending_approval'].includes(t.status)) return res.status(400).json({ error: 'המשימה כבר לא פתוחה' });
    await pool.query(`UPDATE hub_tasks SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = $2 WHERE id = $1`, [t.id, reason]);
    if (t.created_by !== req.user.id && !t.is_private) {
      notify(t.created_by, `🚫 ${nameOf(req.user)} סימן/ה את המשימה "${t.title}" כלא רלוונטית${reason ? `: ${reason}` : ''}`);
    } else if (t.assigned_to !== req.user.id && !t.is_private) {
      notify(t.assigned_to, `🚫 ${nameOf(req.user)} ביטל/ה את המשימה "${t.title}"${reason ? `: ${reason}` : ''}`);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- the team (מנהל ישיר) --------------------------------------------------------------------
// Everyone below the user in the manager tree; an admin sees every active user.
async function teamOf(user) {
  if (isAdmin(user)) {
    return (await pool.query(`SELECT id, display_name, manager_id FROM users WHERE id <> $1 AND NOT COALESCE(blocked, false) ORDER BY display_name`, [user.id])).rows;
  }
  return (await pool.query(`
    WITH RECURSIVE sub AS (
      SELECT id, display_name, manager_id, 1 AS depth FROM users WHERE manager_id = $1 AND NOT COALESCE(blocked, false)
      UNION ALL
      SELECT u.id, u.display_name, u.manager_id, s.depth + 1 FROM users u JOIN sub s ON u.manager_id = s.id
      WHERE NOT COALESCE(u.blocked, false) AND s.depth < 6 AND u.id <> $1
    )
    SELECT DISTINCT id, display_name, manager_id FROM sub ORDER BY display_name`, [user.id])).rows;
}

// GET /api/task-hub/team — a line per person (open / late / closed this week / postponed again and
// again) and, above them, only the things that need the manager. Personal tasks are never counted.
router.get('/team', async (req, res) => {
  try {
    const people = await teamOf(req.user);
    const today = israelToday();
    const ids = people.map(p => p.id);
    const doneWeek = {};
    if (ids.length) {
      const { rows } = await pool.query(`
        SELECT uid, COUNT(*)::int AS n FROM (
          SELECT assigned_to AS uid FROM tasks WHERE completed_at > NOW() - INTERVAL '7 days' AND cancelled_at IS NULL
          UNION ALL SELECT assigned_to FROM op_tasks WHERE status = 'done' AND completed_at > NOW() - INTERVAL '7 days' AND cancelled_at IS NULL
          UNION ALL SELECT assigned_to FROM hub_tasks WHERE status = 'done' AND completed_at > NOW() - INTERVAL '7 days' AND NOT is_private
        ) x WHERE uid = ANY($1::int[]) GROUP BY uid`, [ids]);
      rows.forEach(r => { doneWeek[r.uid] = r.n; });
    }
    const exceptions = [], out = [];
    for (const p of people) {
      const d = await loadToday(p.id, { own: false });
      const open = [...d.focus, ...d.today, ...d.soon, ...d.later];
      const late = open.filter(t => t.overdue);
      const postponed = open.filter(t => t.postpone_count >= 3);
      out.push({ id: p.id, name: p.display_name, manager_id: p.manager_id, open: open.length, overdue: late.length,
                 done_week: doneWeek[p.id] || 0, postponed: postponed.length, in_focus: d.focus.length });
      for (const t of late) {
        const n = t.due_date ? daysBetween(t.due_date, today) : 0;
        if (n >= 3) exceptions.push({ weight: n, text: `באיחור של ${n} ימים: ${t.title}`, sub: [p.display_name, t.who].filter(Boolean).join(' · '), user_id: p.id });
      }
      for (const t of postponed) exceptions.push({ weight: t.postpone_count, text: `נדחתה ${t.postpone_count} פעמים: ${t.title}`, sub: [p.display_name, t.who].filter(Boolean).join(' · '), user_id: p.id });
    }
    exceptions.sort((a, b) => b.weight - a.weight);
    const body = { people: out, exceptions: exceptions.slice(0, 12), can_edit: isAdmin(req.user) };
    if (isAdmin(req.user)) {
      body.users = (await pool.query(`SELECT id, display_name, manager_id FROM users WHERE NOT COALESCE(blocked, false) ORDER BY display_name`)).rows;
    }
    res.json(body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/task-hub/team/:id — one person's open tasks (without his personal ones)
router.get('/team/:id', async (req, res) => {
  const id = Number(req.params.id) || 0;
  try {
    const people = await teamOf(req.user);
    const p = people.find(x => x.id === id);
    if (!p) return res.status(403).json({ error: 'Forbidden' });
    const d = await loadToday(id, { own: false });
    res.json({ user: { id: p.id, name: p.display_name }, focus: d.focus, today: d.today, soon: d.soon, later: d.later });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/task-hub/team/manager  { user_id, manager_id | null } — admins set who manages whom
router.put('/team/manager', async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
  const userId = Number(req.body?.user_id) || 0, managerId = Number(req.body?.manager_id) || null;
  if (!userId || userId === managerId) return res.status(400).json({ error: 'בחירה לא תקינה' });
  try {
    // no loops: walking up from the new manager must never reach the user
    let cur = managerId;
    for (let i = 0; cur && i < 20; i++) {
      if (cur === userId) return res.status(400).json({ error: 'אי אפשר: המשתמש הזה כבר נמצא מעל המנהל שבחרת' });
      cur = (await pool.query('SELECT manager_id FROM users WHERE id = $1', [cur])).rows[0]?.manager_id || null;
    }
    await pool.query('UPDATE users SET manager_id = $2 WHERE id = $1', [userId, managerId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
