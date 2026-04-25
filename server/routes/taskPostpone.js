const router = require('express').Router();
const pool = require('../db/pool');
const jwt  = require('jsonwebtoken');

function verifyToken(token, taskId) {
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  if (payload.type !== 'postpone' || Number(payload.taskId) !== Number(taskId))
    throw new Error('token mismatch');
  return payload;
}

// GET /api/tasks/:taskId/postpone-info?token=xxx — public
router.get('/:taskId/postpone-info', async (req, res) => {
  try {
    verifyToken(req.query.token, req.params.taskId);
    const { rows } = await pool.query(
      `SELECT t.title, t.due_at, l.name AS lead_name
       FROM tasks t JOIN leads l ON l.id = t.lead_id
       WHERE t.id = $1`,
      [req.params.taskId]
    );
    if (!rows.length) return res.status(404).json({ error: 'משימה לא נמצאה' });
    res.json(rows[0]);
  } catch {
    res.status(401).json({ error: 'קישור לא תקין או פג תוקף' });
  }
});

// POST /api/tasks/:taskId/postpone — public
router.post('/:taskId/postpone', async (req, res) => {
  const { token, minutes, dueAt } = req.body;
  try {
    verifyToken(token, req.params.taskId);
    let newDueAt;
    if (dueAt) {
      newDueAt = new Date(dueAt);
    } else if (minutes) {
      newDueAt = new Date(Date.now() + Number(minutes) * 60 * 1000);
    } else {
      return res.status(400).json({ error: 'minutes or dueAt required' });
    }
    if (isNaN(newDueAt.getTime())) return res.status(400).json({ error: 'invalid date' });

    await pool.query(
      `UPDATE tasks SET due_at = $1, remind_sent_at = NULL WHERE id = $2`,
      [newDueAt, req.params.taskId]
    );
    res.json({ success: true, newDueAt });
  } catch {
    res.status(401).json({ error: 'קישור לא תקין או פג תוקף' });
  }
});

module.exports = router;
