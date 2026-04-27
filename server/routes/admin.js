const router = require('express').Router();
const pool   = require('../db/pool');
const axios  = require('axios');
const bcrypt = require('bcryptjs');

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'אין הרשאה' });
  next();
}

// GET /api/admin/settings
router.get('/settings', adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM settings ORDER BY key');
    const result = {};
    rows.forEach(r => { result[r.key] = r.value; });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/settings/:key
router.put('/settings/:key', adminOnly, async (req, res) => {
  const { value } = req.body;
  try {
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [req.params.key, value ?? '']
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/whatsapp-status
router.get('/whatsapp-status', adminOnly, async (req, res) => {
  const { GREEN_API_URL, GREEN_API_INSTANCE, GREEN_API_TOKEN } = process.env;
  if (!GREEN_API_URL || !GREEN_API_INSTANCE || !GREEN_API_TOKEN) {
    return res.json({ state: 'notConfigured' });
  }
  try {
    const url = `${GREEN_API_URL}/waInstance${GREEN_API_INSTANCE}/getStateInstance/${GREEN_API_TOKEN}`;
    const { data } = await axios.get(url, { timeout: 8000 });
    res.json({ state: data.stateInstance, accountInfo: data.accountInfo || null });
  } catch (err) {
    res.json({ state: 'error', error: err.message });
  }
});

// GET /api/admin/users
router.get('/users', adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, display_name, email, phone, role, created_at FROM users ORDER BY display_name'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users
router.post('/users', adminOnly, async (req, res) => {
  const { username, display_name, email, phone, role, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'שם משתמש וסיסמה הם שדות חובה' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (username, display_name, email, phone, role, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username, display_name, email, phone, role, created_at`,
      [username, display_name || null, email || null, phone || null, role || 'sales', hash]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'שם משתמש כבר קיים' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/users/:id
router.put('/users/:id', adminOnly, async (req, res) => {
  const { username, display_name, email, phone, role, password } = req.body;
  try {
    if (password && password.trim()) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query(
        `UPDATE users SET username=$1, display_name=$2, email=$3, phone=$4, role=$5, password_hash=$6 WHERE id=$7`,
        [username, display_name || null, email || null, phone || null, role || 'sales', hash, req.params.id]
      );
    } else {
      await pool.query(
        `UPDATE users SET username=$1, display_name=$2, email=$3, phone=$4, role=$5 WHERE id=$6`,
        [username, display_name || null, email || null, phone || null, role || 'sales', req.params.id]
      );
    }
    const { rows } = await pool.query(
      'SELECT id, username, display_name, email, phone, role, created_at FROM users WHERE id=$1',
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'שם משתמש כבר קיים' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', adminOnly, async (req, res) => {
  if (String(req.user.id) === String(req.params.id))
    return res.status(400).json({ error: 'לא ניתן למחוק את המשתמש שלך' });
  try {
    await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
