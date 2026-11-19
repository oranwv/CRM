// Readable copy of user passwords for the admin "show password" eye in הגדרות (Phase 104).
// Login still checks the bcrypt hash only; this copy exists solely so an admin can look a password
// up. It is stored AES-256-GCM encrypted (never plain text in the DB) with a key derived from
// PASSWORD_VIEW_KEY, or JWT_SECRET when that is not set — changing that secret makes the stored
// copies unreadable until each password is set or used again.
const crypto = require('crypto');

function key() {
  const secret = process.env.PASSWORD_VIEW_KEY || process.env.JWT_SECRET;
  if (!secret) return null;
  return crypto.createHash('sha256').update(`crm-password-view:${secret}`).digest();
}

function encryptPassword(plain) {
  const k = key();
  if (!k || typeof plain !== 'string' || !plain) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

function decryptPassword(stored) {
  try {
    const k = key();
    const [v, iv, tag, enc] = String(stored || '').split(':');
    if (!k || v !== 'v1' || !iv || !tag || !enc) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
  } catch { return null; }
}

module.exports = { encryptPassword, decryptPassword };
