const router = require('express').Router();
const pool = require('../db/pool');
const bcrypt = require('bcryptjs');
const { signToken, appCookie } = require('../middleware/auth');
const { encryptPassword, decryptPassword } = require('../utils/passwordVault');

const ROLE_PRIORITY = ['admin','manager','sales','production','suppliers','rsvp','operations'];

// Phase 136 (security stage 0): failed logins are counted in memory, per user name + IP and per IP.
// Past the limit the login answers 429 until the window passes; a successful login clears the
// user's counter. In memory on purpose: a restart only resets the counters.
const FAIL_WINDOW  = 15 * 60 * 1000;
const MAX_PER_USER = 8;   // wrong passwords for one user name from one IP
const MAX_PER_IP   = 40;  // wrong passwords from one IP (a whole office shares an IP)
const fails = new Map();  // key -> [timestamps]
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim() || 'unknown';
}
function recent(key) {
  const now = Date.now();
  const arr = (fails.get(key) || []).filter(t => now - t < FAIL_WINDOW);
  if (arr.length) fails.set(key, arr); else fails.delete(key);
  return arr;
}
function lockedMinutes(keys) {
  const now = Date.now();
  let wait = 0;
  for (const [key, max] of keys) {
    const arr = recent(key);
    if (arr.length >= max) wait = Math.max(wait, FAIL_WINDOW - (now - arr[arr.length - max]));
  }
  return wait ? Math.max(1, Math.ceil(wait / 60000)) : 0;
}
function noteFail(keys) { for (const [key] of keys) fails.set(key, [...recent(key), Date.now()]); }
setInterval(() => { for (const key of [...fails.keys()]) recent(key); }, 10 * 60 * 1000).unref();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const ip = clientIp(req);
  const userKey = `u:${String(username || '').trim().toLowerCase()}|${ip}`;
  const keys = [[userKey, MAX_PER_USER], [`ip:${ip}`, MAX_PER_IP]];
  const wait = lockedMinutes(keys);
  if (wait) return res.status(429).json({ error: `יותר מדי ניסיונות כניסה. נסו שוב בעוד ${wait} דקות` });
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (!rows.length) { noteFail(keys); return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' }); }
    const valid = await bcrypt.compare(String(password || ''), rows[0].password_hash);
    if (!valid) { noteFail(keys); return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' }); }
    fails.delete(userKey);
    if (rows[0].blocked) return res.status(401).json({ error: 'החשבון שלך חסום, פנה למנהל המערכת' });
    // Keep the admin-readable copy in step with the password actually in use (Phase 104): passwords
    // set before that phase have no copy until their owner logs in.
    if (decryptPassword(rows[0].password_view) !== password) {
      pool.query('UPDATE users SET password_view = $1 WHERE id = $2', [encryptPassword(password), rows[0].id]).catch(() => {});
    }
    const roles = rows[0].roles?.length ? rows[0].roles : [rows[0].role];
    const primaryRole = ROLE_PRIORITY.find(r => roles.includes(r)) || rows[0].role;
    const token = signToken({ id: rows[0].id, username: rows[0].username, display_name: rows[0].display_name, role: primaryRole, roles });
    res.append('Set-Cookie', appCookie(req));
    res.json({ token, user: { id: rows[0].id, username: rows[0].username, display_name: rows[0].display_name, role: primaryRole, roles } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports._loginLimits = { lockedMinutes, noteFail, fails, MAX_PER_USER, MAX_PER_IP };
