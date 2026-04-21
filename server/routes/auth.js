const router = require('express').Router();
const pool = require('../db/pool');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (!rows.length) return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
    const token = jwt.sign(
      { id: rows[0].id, username: rows[0].username, display_name: rows[0].display_name, role: rows[0].role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ token, user: { id: rows[0].id, username: rows[0].username, display_name: rows[0].display_name, role: rows[0].role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
