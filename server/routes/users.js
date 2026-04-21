const router = require('express').Router();
const pool = require('../db/pool');

// GET /api/users — list all users (for assign dropdown)
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, username, display_name, role FROM users ORDER BY display_name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
