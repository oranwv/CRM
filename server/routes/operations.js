const router  = require('express').Router();
const pool    = require('../db/pool');
const multer  = require('multer');
const os      = require('os');
const fs      = require('fs');
const { uploadFile, getSignedUrl } = require('../services/storageService');
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 20 * 1024 * 1024 } });

const STATUS_LABELS = { open: 'פתוח', in_progress: 'בטיפול', done: 'הושלם', resolved: 'נפתר' };

async function logActivity(entityType, entityId, type, body, userId) {
  await pool.query(
    `INSERT INTO op_activity_log (entity_type, entity_id, type, body, created_by) VALUES ($1,$2,$3,$4,$5)`,
    [entityType, entityId, type, body, userId || null]
  );
}

// GET /api/operations/users — team member list for assignee pickers
router.get('/users', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, display_name FROM users ORDER BY display_name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/operations/summary — dashboard stat cards
router.get('/summary', async (req, res) => {
  try {
    const [tasksRes, maintenanceRes, faultsRes, runsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM op_tasks WHERE status != 'done'`),
      pool.query(`SELECT COUNT(*) FROM op_maintenance WHERE next_due IS NOT NULL AND next_due < CURRENT_DATE`),
      pool.query(`SELECT COUNT(*) FROM op_faults WHERE status != 'resolved'`),
      pool.query(`SELECT items_state FROM op_checklist_runs WHERE completed_at IS NULL`),
    ]);
    let pendingMissing = 0;
    for (const row of runsRes.rows) {
      const items = Array.isArray(row.items_state) ? row.items_state : [];
      for (const item of items) {
        if ((item.missing_qty || 0) > 0) pendingMissing++;
      }
    }
    res.json({
      openTasks:         parseInt(tasksRes.rows[0].count),
      pendingMissing,
      overdueMaintenace: parseInt(maintenanceRes.rows[0].count),
      openFaults:        parseInt(faultsRes.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── OP TASKS ──────────────────────────────────────────────────────────
router.get('/tasks', async (req, res) => {
  const done = req.query.done === '1';
  try {
    const { rows } = await pool.query(`
      SELECT t.*, u1.display_name AS assigned_to_name, u2.display_name AS created_by_name
      FROM op_tasks t
      LEFT JOIN users u1 ON t.assigned_to = u1.id
      LEFT JOIN users u2 ON t.created_by = u2.id
      WHERE ${done ? "t.status = 'done'" : "t.status != 'done'"}
      ORDER BY ${done ? 't.completed_at DESC NULLS LAST' :
        `CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        t.due_date ASC NULLS LAST, t.created_at DESC`}
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tasks', async (req, res) => {
  const { title, description, assigned_to, priority, due_date } = req.body;
  if (!title) return res.status(400).json({ error: 'כותרת חובה' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO op_tasks (title, description, assigned_to, created_by, priority, due_date)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, description || null, assigned_to || null, req.user.id, priority || 'normal', due_date || null]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/tasks/:id', async (req, res) => {
  const { title, description, assigned_to, priority, due_date, status, notes } = req.body;
  try {
    const { rows: existing } = await pool.query('SELECT status FROM op_tasks WHERE id=$1', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Not found' });
    const oldStatus = existing[0].status;
    const { rows } = await pool.query(
      `UPDATE op_tasks SET title=$1, description=$2, assigned_to=$3, priority=$4, due_date=$5, status=$6,
       notes=$7, completed_at = CASE WHEN $6='done' THEN COALESCE(completed_at, NOW()) ELSE NULL END
       WHERE id=$8 RETURNING *`,
      [title, description || null, assigned_to || null, priority || 'normal', due_date || null, status || 'open', notes || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (status && status !== oldStatus) {
      await logActivity('task', req.params.id, 'status_change',
        `סטטוס שונה ל-${STATUS_LABELS[status] || status}`, req.user.id);
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/tasks/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM op_tasks WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CHECKLISTS ────────────────────────────────────────────────────────
router.get('/checklists', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*,
        (SELECT row_to_json(r) FROM (
          SELECT * FROM op_checklist_runs
          WHERE checklist_id = c.id
          ORDER BY created_at DESC LIMIT 1
        ) r) AS latest_run
      FROM op_checklists c ORDER BY c.name
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/checklists', async (req, res) => {
  const { name, items } = req.body;
  if (!name) return res.status(400).json({ error: 'שם חובה' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO op_checklists (name, items, created_by) VALUES ($1, $2, $3) RETURNING *`,
      [name, JSON.stringify(items || []), req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/checklists/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM op_checklists WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const { rows: runs } = await pool.query(
      `SELECT r.*, u.display_name AS created_by_name FROM op_checklist_runs r
       LEFT JOIN users u ON r.created_by = u.id
       WHERE r.checklist_id = $1 ORDER BY r.created_at DESC LIMIT 1`,
      [req.params.id]
    );
    res.json({ ...rows[0], latest_run: runs[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/checklists/:id', async (req, res) => {
  const { name, items } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE op_checklists SET name=$1, items=$2 WHERE id=$3 RETURNING *`,
      [name, JSON.stringify(items || []), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/checklists/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM op_checklists WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CHECKLIST RUNS ────────────────────────────────────────────────────
router.post('/checklist-runs', async (req, res) => {
  const { checklist_id } = req.body;
  if (!checklist_id) return res.status(400).json({ error: 'checklist_id חובה' });
  try {
    const { rows: cl } = await pool.query('SELECT * FROM op_checklists WHERE id=$1', [checklist_id]);
    if (!cl.length) return res.status(404).json({ error: 'Not found' });
    const items_state = (cl[0].items || []).map(item => ({
      name: item.name, unit: item.unit || '', expected_qty: item.expected_qty || 0,
      actual_qty: null, missing_qty: 0, assigned_to: null,
    }));
    const { rows } = await pool.query(
      `INSERT INTO op_checklist_runs (checklist_id, created_by, items_state) VALUES ($1, $2, $3) RETURNING *`,
      [checklist_id, req.user.id, JSON.stringify(items_state)]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/checklist-runs/:id', async (req, res) => {
  const { items_state, completed } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE op_checklist_runs SET items_state=$1,
       completed_at = CASE WHEN $2 THEN NOW() ELSE NULL END
       WHERE id=$3 RETURNING *`,
      [JSON.stringify(items_state), !!completed, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MAINTENANCE ───────────────────────────────────────────────────────
router.get('/maintenance', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.*, u.display_name AS assignee_name
       FROM op_maintenance m LEFT JOIN users u ON m.assignee_id = u.id
       ORDER BY m.next_due ASC NULLS LAST`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/maintenance/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.*, u.display_name AS assignee_name FROM op_maintenance m
       LEFT JOIN users u ON m.assignee_id = u.id WHERE m.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const { rows: hist } = await pool.query(
      `SELECT h.*, u.display_name AS done_by_name FROM op_maintenance_history h
       LEFT JOIN users u ON h.done_by = u.id
       WHERE h.maintenance_id = $1 ORDER BY h.done_date DESC`,
      [req.params.id]
    );
    res.json({ ...rows[0], history: hist });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/maintenance', async (req, res) => {
  const { name, interval_days, assignee_id } = req.body;
  if (!name || !interval_days) return res.status(400).json({ error: 'שם ומרווח זמן חובה' });
  const next_due = new Date();
  next_due.setDate(next_due.getDate() + parseInt(interval_days));
  try {
    const { rows } = await pool.query(
      `INSERT INTO op_maintenance (name, interval_days, assignee_id, next_due) VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, parseInt(interval_days), assignee_id || null, next_due.toISOString().split('T')[0]]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/maintenance/:id', async (req, res) => {
  const { name, interval_days, assignee_id, status } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE op_maintenance SET name=COALESCE($1, name), interval_days=COALESCE($2, interval_days),
       assignee_id=$3, status=COALESCE($4, status) WHERE id=$5 RETURNING *`,
      [name || null, interval_days ? parseInt(interval_days) : null, assignee_id || null, status || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/maintenance/:id/complete', async (req, res) => {
  const { notes, done_by } = req.body;
  try {
    const { rows: existing } = await pool.query('SELECT * FROM op_maintenance WHERE id=$1', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Not found' });
    const today = new Date();
    const next  = new Date(today);
    next.setDate(next.getDate() + existing[0].interval_days);
    const todayStr = today.toISOString().split('T')[0];
    const nextStr  = next.toISOString().split('T')[0];
    await pool.query(
      `INSERT INTO op_maintenance_history (maintenance_id, done_date, notes, done_by) VALUES ($1, $2, $3, $4)`,
      [req.params.id, todayStr, notes || null, done_by || req.user.id]
    );
    const { rows } = await pool.query(
      `UPDATE op_maintenance SET last_done=$1, next_due=$2, status='open' WHERE id=$3 RETURNING *`,
      [todayStr, nextStr, req.params.id]
    );
    await logActivity('maintenance', req.params.id, 'completion',
      'תחזוקה בוצעה' + (notes ? ': ' + notes : ''), req.user.id);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/maintenance/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM op_maintenance WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── FAULTS ────────────────────────────────────────────────────────────
router.get('/faults', async (req, res) => {
  const all = req.query.all === 'true';
  try {
    const { rows } = await pool.query(
      `SELECT f.*, u1.display_name AS reported_by_name, u2.display_name AS assignee_name
       FROM op_faults f
       LEFT JOIN users u1 ON f.reported_by = u1.id
       LEFT JOIN users u2 ON f.assignee_id = u2.id
       ${all ? '' : "WHERE f.status != 'resolved'"}
       ORDER BY f.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/faults/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.*, u1.display_name AS reported_by_name, u2.display_name AS assignee_name
       FROM op_faults f
       LEFT JOIN users u1 ON f.reported_by = u1.id
       LEFT JOIN users u2 ON f.assignee_id = u2.id
       WHERE f.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/faults', async (req, res) => {
  const { title, description, assignee_id } = req.body;
  if (!title) return res.status(400).json({ error: 'כותרת חובה' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO op_faults (title, description, reported_by, assignee_id) VALUES ($1, $2, $3, $4) RETURNING *`,
      [title, description || null, req.user.id, assignee_id || null]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/faults/:id', async (req, res) => {
  const { status, assignee_id, title, description, notes } = req.body;
  try {
    const { rows: existing } = await pool.query('SELECT status FROM op_faults WHERE id=$1', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Not found' });
    const oldStatus = existing[0].status;
    const { rows } = await pool.query(
      `UPDATE op_faults SET status=$1, assignee_id=$2, title=COALESCE($3, title), description=$4,
       notes=$5, resolved_at = CASE WHEN $1='resolved' THEN NOW() ELSE NULL END
       WHERE id=$6 RETURNING *`,
      [status || 'open', assignee_id || null, title || null, description || null, notes || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (status && status !== oldStatus) {
      await logActivity('fault', req.params.id, 'status_change',
        `סטטוס שונה ל-${STATUS_LABELS[status] || status}`, req.user.id);
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/faults/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM op_faults WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ACTIVITY LOG ──────────────────────────────────────────────────────
router.get('/activity/:entityType/:entityId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, u.display_name AS created_by_name FROM op_activity_log a
       LEFT JOIN users u ON a.created_by = u.id
       WHERE a.entity_type=$1 AND a.entity_id=$2 ORDER BY a.created_at DESC`,
      [req.params.entityType, req.params.entityId]
    );
    for (const row of rows) {
      if (row.type === 'file') {
        try {
          const meta = JSON.parse(row.body);
          if (meta.storedName) {
            meta.signed_url = await getSignedUrl(meta.storedName, 3600);
            row.body = JSON.stringify(meta);
          }
        } catch {}
      }
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/activity/:entityType/:entityId', async (req, res) => {
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'תוכן חובה' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO op_activity_log (entity_type, entity_id, type, body, created_by) VALUES ($1,$2,'note',$3,$4) RETURNING *`,
      [req.params.entityType, req.params.entityId, body, req.user.id]
    );
    const { rows: full } = await pool.query(
      `SELECT a.*, u.display_name AS created_by_name FROM op_activity_log a
       LEFT JOIN users u ON a.created_by = u.id WHERE a.id=$1`,
      [rows[0].id]
    );
    res.json(full[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/activity/:entityType/:entityId/file', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'לא נשלח קובץ' });
  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  try {
    const { url, storedName } = await uploadFile(req.file.path, originalName, req.file.mimetype);
    fs.unlinkSync(req.file.path);
    const body = JSON.stringify({ url, storedName, filename: originalName, mime_type: req.file.mimetype });
    const { rows } = await pool.query(
      `INSERT INTO op_activity_log (entity_type, entity_id, type, body, created_by) VALUES ($1,$2,'file',$3,$4) RETURNING *`,
      [req.params.entityType, req.params.entityId, body, req.user.id]
    );
    const { rows: full } = await pool.query(
      `SELECT a.*, u.display_name AS created_by_name FROM op_activity_log a
       LEFT JOIN users u ON a.created_by = u.id WHERE a.id=$1`,
      [rows[0].id]
    );
    res.json(full[0]);
  } catch (err) {
    if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch {} }
    res.status(500).json({ error: err.message });
  }
});

// ── REMINDERS ─────────────────────────────────────────────────────────
router.get('/reminders/:entityType/:entityId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, u.display_name AS assigned_to_name FROM op_reminders r
       LEFT JOIN users u ON r.assigned_to = u.id
       WHERE r.entity_type=$1 AND r.entity_id=$2
       ORDER BY r.done ASC, r.due_date ASC NULLS LAST, r.created_at ASC`,
      [req.params.entityType, req.params.entityId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/reminders/:entityType/:entityId', async (req, res) => {
  const { title, due_date, due_time, assigned_to } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'כותרת חובה' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO op_reminders (entity_type, entity_id, title, due_date, due_time, assigned_to, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.entityType, req.params.entityId, title, due_date || null, due_time || null, assigned_to || null, req.user.id]
    );
    const { rows: full } = await pool.query(
      `SELECT r.*, u.display_name AS assigned_to_name FROM op_reminders r
       LEFT JOIN users u ON r.assigned_to = u.id WHERE r.id=$1`,
      [rows[0].id]
    );
    res.json(full[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/reminders/:id', async (req, res) => {
  const { done } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE op_reminders SET done=$1, done_at = CASE WHEN $1 THEN NOW() ELSE NULL END WHERE id=$2 RETURNING *`,
      [!!done, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/reminders/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM op_reminders WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
