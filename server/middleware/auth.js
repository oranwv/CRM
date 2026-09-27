const jwt = require('jsonwebtoken');

// Session helpers shared with routes/auth.js.
// - crm_app cookie: tells `GET /` to serve the app instead of the public landing page. Set by
//   the SERVER (Set-Cookie), because Safari wipes JavaScript-written cookies after 7 days, and
//   sessions created before the landing page existed never had it at all.
// - Sliding expiry: a valid token older than REFRESH_AFTER is re-issued for another 30 days in
//   the X-Refresh-Token response header; the client swaps it in. Anyone who uses the CRM at
//   least once a month never has to log in again (a blocked user is still cut off: see below).
const TOKEN_TTL     = '30d';
const REFRESH_AFTER = 24 * 60 * 60; // seconds — refresh at most once a day per client
const APP_COOKIE    = 'crm_app=1; Path=/; Max-Age=31536000; SameSite=Lax';

function signToken(payload) {
  const { iat, exp, ...rest } = payload;
  return jwt.sign(rest, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function appCookie(req) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return secure ? `${APP_COOKIE}; Secure` : APP_COOKIE;
}

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  try {
    if (!/(^|;\s*)crm_app=1/.test(req.headers.cookie || '')) res.append('Set-Cookie', appCookie(req));
    const age = Math.floor(Date.now() / 1000) - (req.user.iat || 0);
    if (age > REFRESH_AFTER) {
      // Re-issue only for users who still exist and are not blocked — the one moment a
      // long-lived session is re-checked against the DB.
      const pool = require('../db/pool');
      const { rows } = await pool.query('SELECT blocked FROM users WHERE id = $1', [req.user.id]);
      if (!rows.length || rows[0].blocked) return res.status(401).json({ error: 'החשבון שלך חסום, פנה למנהל המערכת' });
      res.setHeader('X-Refresh-Token', signToken(req.user));
    }
  } catch { /* best-effort — never block the request */ }
  next();
}

module.exports = requireAuth;
module.exports.signToken = signToken;
module.exports.appCookie = appCookie;
