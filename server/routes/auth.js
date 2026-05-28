const router = require('express').Router();
const pool = require('../db/pool');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const ROLE_PRIORITY = ['admin','manager','sales','production','suppliers','rsvp','operations'];

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (!rows.length) return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
    if (rows[0].blocked) return res.status(401).json({ error: 'החשבון שלך חסום, פנה למנהל המערכת' });
    const roles = rows[0].roles?.length ? rows[0].roles : [rows[0].role];
    const primaryRole = ROLE_PRIORITY.find(r => roles.includes(r)) || rows[0].role;
    const token = jwt.sign(
      { id: rows[0].id, username: rows[0].username, display_name: rows[0].display_name, role: primaryRole, roles },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ token, user: { id: rows[0].id, username: rows[0].username, display_name: rows[0].display_name, role: primaryRole, roles } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
