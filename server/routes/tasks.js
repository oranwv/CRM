const router = require('express').Router();
const pool = require('../db/pool');
const requireAuth = require('../middleware/auth');

// GET /api/tasks/users — dropdown list for filters
router.get('/users', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, display_name FROM users ORDER BY display_name'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tasks/overdue-count — badge count for nav
router.get('/overdue-count', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM tasks
       WHERE completed_at IS NULL AND due_at IS NOT NULL AND due_at < NOW()`
    );
    res.json({ count: rows[0].count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tasks — global tasks list across all leads
router.get('/', requireAuth, async (req, res) => {
  const { assigned_to, status, search } = req.query;

  const conditions = ['1=1'];
  const params = [];

  if (assigned_to) {
    params.push(Number(assigned_to));
    conditions.push(`t.assigned_to = $${params.length}`);
  }

  if (status === 'pending') {
    conditions.push('t.completed_at IS NULL');
  } else if (status === 'overdue') {
    conditions.push('t.completed_at IS NULL AND t.due_at IS NOT NULL AND t.due_at < NOW()');
  } else if (status === 'completed') {
    conditions.push('t.completed_at IS NOT NULL');
  }

  if (search?.trim()) {
    params.push(`%${search.trim()}%`);
    conditions.push(`(t.title ILIKE $${params.length} OR l.name ILIKE $${params.length})`);
  }

  const where = conditions.join(' AND ');

  try {
    const { rows } = await pool.query(
      `SELECT
         t.id, t.lead_id, t.title, t.due_at, t.completed_at, t.result,
         t.remind_via, t.created_at, t.assigned_to,
         l.name  AS lead_name,
         l.stage AS lead_stage,
         ua.display_name AS assigned_name,
         uc.display_name AS created_by_name,
         CASE
           WHEN t.completed_at IS NOT NULL                                    THEN 5
           WHEN t.due_at IS NULL                                              THEN 4
           WHEN t.due_at < NOW()                                              THEN 1
           WHEN t.due_at::date = CURRENT_DATE AT TIME ZONE 'Asia/Jerusalem'   THEN 2
           ELSE                                                                    3
         END AS sort_bucket
       FROM tasks t
       JOIN leads l  ON l.id  = t.lead_id
       LEFT JOIN users ua ON ua.id = t.assigned_to
       LEFT JOIN users uc ON uc.id = t.created_by
       WHERE ${where}
       ORDER BY sort_bucket ASC, t.due_at ASC NULLS LAST, t.created_at ASC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
