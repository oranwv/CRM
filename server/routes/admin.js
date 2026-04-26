const router = require('express').Router();
const pool   = require('../db/pool');
const axios  = require('axios');

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

module.exports = router;
