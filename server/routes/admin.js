const router = require('express').Router();
const pool   = require('../db/pool');
const axios  = require('axios');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const sigUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

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

// POST /api/admin/settings/staff-signature  — upload signature image
router.post('/settings/staff-signature', adminOnly, sigUpload.single('signature'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'לא נשלח קובץ' });
  const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  try {
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('staff_signature',$1,NOW())
       ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
      [dataUrl]
    );
    res.json({ success: true, dataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/settings/staff-signature
router.delete('/settings/staff-signature', adminOnly, async (req, res) => {
  try {
    await pool.query(`UPDATE settings SET value='', updated_at=NOW() WHERE key='staff_signature'`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/settings/floorplan/:section — upload venue floor plan image
const fpUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
router.post('/settings/floorplan/:section', adminOnly, fpUpload.single('file'), async (req, res) => {
  const sec = req.params.section;
  if (!['inside', 'outside'].includes(sec)) return res.status(400).json({ error: 'Invalid section' });
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const { widthM, heightM } = req.body;
  const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  const value = JSON.stringify({ image: dataUrl, widthM: parseFloat(widthM) || 20, heightM: parseFloat(heightM) || 15 });
  try {
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [`floorplan_${sec}`, value]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/seating/custom-items — save global custom palette items
router.put('/seating/custom-items', adminOnly, async (req, res) => {
  try {
    const { items } = req.body;
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('seating_custom_items', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(items || [])]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/seating/element-overrides — save built-in element overrides
router.put('/seating/element-overrides', adminOnly, async (req, res) => {
  try {
    const { overrides } = req.body;
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('seating_element_overrides', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(overrides || {})]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/google-token — update stored Google OAuth token
router.post('/google-token', adminOnly, async (req, res) => {
  try {
    const { token } = req.body;
    const parsed = JSON.parse(token);
    if (!parsed.refresh_token) return res.status(400).json({ error: 'Missing refresh_token' });
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('google_token', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [token]
    );
    fs.writeFileSync(path.join(__dirname, '../google_token.json'), token);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: 'Invalid token JSON' });
  }
});

module.exports = router;
