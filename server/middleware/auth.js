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

// A blocked user is cut off on his next request, not only at the daily token refresh
// (2026-11-18). One small query per user per minute; a DB error never blocks a request.
// The cache holds the in-flight promise, so the ~25 requests of one page load share ONE query
// instead of each running its own against a 6-connection pool (Phase 107).
const blockedCache = new Map(); // user id → { at, state: Promise<'ok' | 'blocked' | 'missing'> }
function userState(userId) {
  const hit = blockedCache.get(userId);
  if (hit && Date.now() - hit.at < 60_000) return hit.state;
  const state = (async () => {
    try {
      const pool = require('../db/pool');
      const { rows } = await pool.query('SELECT blocked FROM users WHERE id = $1', [userId]);
      return !rows.length ? 'missing' : rows[0].blocked ? 'blocked' : 'ok';
    } catch {
      blockedCache.delete(userId); // do not remember a failed lookup
      return 'ok';
    }
  })();
  blockedCache.set(userId, { at: Date.now(), state });
  return state;
}

// Every session failure goes through here (Phase 107): the response is marked (X-Auth-Failed +
// `auth` in the body) so the client logs out ONLY for these and never for some other 401, and
// the reason is logged — "why was I thrown out" can be answered from the Railway log.
const AUTH_MESSAGES = {
  no_token:  'Unauthorized',
  bad_token: 'Invalid token',
  expired:   'Session expired',
  blocked:   'החשבון שלך חסום, פנה למנהל המערכת',
  missing:   'החשבון שלך חסום, פנה למנהל המערכת',
};
function authFail(req, res, reason, detail) {
  const who = req.user?.username || req.user?.id || '-';
  console.warn(`[Auth] 401 ${reason}${detail ? ` (${detail})` : ''} user=${who} ${req.method} ${req.originalUrl.split('?')[0]}`);
  res.setHeader('X-Auth-Failed', reason);
  return res.status(401).json({ error: AUTH_MESSAGES[reason] || 'Unauthorized', auth: reason });
}

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return authFail(req, res, 'no_token');
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return authFail(req, res, err.name === 'TokenExpiredError' ? 'expired' : 'bad_token', err.message);
  }
  if (req.user?.id) {
    const state = await userState(req.user.id);
    if (state !== 'ok') return authFail(req, res, state);
  }
  // Phase 84: a clock-only user (roles = ['attendance']) may use the attendance API and nothing else.
  const roles = req.user.roles?.length ? req.user.roles : [];
  if (roles.length && roles.every(r => r === 'attendance') && !req.originalUrl.startsWith('/api/attendance')) {
    return res.status(403).json({ error: 'אין הרשאה' });
  }
  try {
    if (!/(^|;\s*)crm_app=1/.test(req.headers.cookie || '')) res.append('Set-Cookie', appCookie(req));
    const age = Math.floor(Date.now() / 1000) - (req.user.iat || 0);
    if (age > REFRESH_AFTER) {
      // Re-issue only for users who still exist and are not blocked — the one moment a
      // long-lived session is re-checked against the DB.
      const pool = require('../db/pool');
      const { rows } = await pool.query('SELECT blocked FROM users WHERE id = $1', [req.user.id]);
      if (!rows.length || rows[0].blocked) return authFail(req, res, rows.length ? 'blocked' : 'missing', 'at token refresh');
      res.setHeader('X-Refresh-Token', signToken(req.user));
    }
  } catch { /* best-effort — never block the request */ }
  next();
}

module.exports = requireAuth;
module.exports.signToken = signToken;
module.exports.appCookie = appCookie;
