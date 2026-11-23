// הערות מנהל (Phase 119) — a code-locked private notes window inside an event's production card.
//
// What is protected and how:
// - Every entry is stored AES-256-GCM encrypted. The key of an event is derived from a server
//   secret AND a random per-event salt that is kept OUTSIDE the database (a small object in
//   Supabase Storage). Deleting an event's notes deletes the rows and the salt — so a copy of the
//   rows that survives in a database backup can no longer be read by anyone ("crypto-shredding").
// - The 4-digit event code and the 6-digit manager PIN are never stored: only a keyed hash
//   (HMAC with the server secret; the PIN additionally through bcrypt). A database leak alone
//   does not reveal them, even though the code has only 10,000 possibilities.
// - Wrong attempts are counted in the database: 5 wrong codes cancel the code, 5 wrong PINs lock
//   the PIN for 15 minutes.
// - Nothing here writes note text, codes or PINs to the log.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');

const CODE_TTL_MS      = 8 * 60 * 60 * 1000; // an event code lives 8 hours
const UNLOCK_TTL_S     = 10 * 60;            // an opened window is trusted by the server for 10 minutes at most
const MAX_CODE_FAILS   = 5;
const MAX_PIN_FAILS    = 5;
const PIN_LOCK_MS      = 15 * 60 * 1000;
const MAX_ENTRY_LENGTH = 20000;
const KEY_FOLDER       = 'manager-notes-keys';
const BUCKET           = 'crm-files';

function secret() {
  const s = process.env.MANAGER_NOTES_KEY || process.env.JWT_SECRET;
  if (!s) throw new Error('MANAGER_NOTES_KEY or JWT_SECRET must be set');
  return s;
}
const hmac = (label, value) => crypto.createHmac('sha256', secret()).update(`crm-manager-notes:${label}:${value}`).digest('hex');

// ── roles / device ───────────────────────────────────────────────────────────
function isGeneralManager(user) {
  const roles = user?.roles?.length ? user.roles : (user?.role ? [user.role] : []);
  return roles.includes('admin') || roles.includes('manager');
}
// The window is for phones only. A browser can lie about what it is, so this is a barrier for
// ordinary use, not a security boundary — the code / PIN is the boundary.
function isPhone(req) {
  return /Mobi|Android|iPhone|iPod/i.test(String(req.headers['user-agent'] || ''));
}

// ── per-event salt, kept outside the database ────────────────────────────────
let keyStore = {
  client() {
    const { createClient } = require('@supabase/supabase-js');
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    return createClient(url, key).storage.from(BUCKET);
  },
  async get(name) {
    const { data, error } = await this.client().download(`${KEY_FOLDER}/${name}`);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  },
  async create(name, buf) { // false when it already exists
    const { error } = await this.client().upload(`${KEY_FOLDER}/${name}`, buf, { contentType: 'application/octet-stream', upsert: false });
    return !error;
  },
  async remove(names) {
    if (!names.length) return;
    const { error } = await this.client().remove(names.map(n => `${KEY_FOLDER}/${n}`));
    if (error) throw error;
  },
  async list() {
    const out = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await this.client().list(KEY_FOLDER, { limit: 1000, offset });
      if (error) throw error;
      out.push(...(data || []).map(o => o.name));
      if (!data || data.length < 1000) return out;
    }
  },
};
function setKeyStore(store) { keyStore = store; } // tests

const saltName = leadId => `${Number(leadId)}-${hmac('salt-name', Number(leadId)).slice(0, 24)}.key`;

async function eventKey(leadId, { create }) {
  const name = saltName(leadId);
  let salt = await keyStore.get(name);
  if (!salt && create) {
    const fresh = crypto.randomBytes(32);
    salt = (await keyStore.create(name, fresh)) ? fresh : await keyStore.get(name);
    if (!salt) throw new Error('could not store the notes key');
  }
  if (!salt || salt.length !== 32) return null;
  return crypto.createHash('sha256').update(`crm-manager-notes:key:${secret()}:${Number(leadId)}:`).update(salt).digest();
}

function encrypt(key, text) {
  const iv = crypto.randomBytes(12);
  const c  = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}
function decrypt(key, stored) {
  try {
    const [v, iv, tag, enc] = String(stored || '').split(':');
    if (v !== 'v1' || !iv || !tag || !enc) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
  } catch { return null; }
}

// ── PIN (personal, 6 digits) ─────────────────────────────────────────────────
const validPin  = pin  => typeof pin === 'string' && /^\d{6}$/.test(pin);
const validCode = code => typeof code === 'string' && /^\d{4}$/.test(code);
const pinDigest = (userId, pin) => hmac(`pin:${userId}`, pin);

async function hasPin(pool, userId) {
  const { rows } = await pool.query('SELECT 1 FROM manager_note_pins WHERE user_id = $1', [userId]);
  return rows.length > 0;
}
async function storePin(pool, userId, pin) {
  const hash = await bcrypt.hash(pinDigest(userId, pin), 10);
  await pool.query(
    `INSERT INTO manager_note_pins (user_id, pin_hash, failed_count, locked_until, updated_at)
     VALUES ($1, $2, 0, NULL, NOW())
     ON CONFLICT (user_id) DO UPDATE SET pin_hash = $2, failed_count = 0, locked_until = NULL, updated_at = NOW()`,
    [userId, hash]);
}
// → { ok: true } | { ok: false, error }
// The attempt is counted BEFORE the PIN is compared, in one atomic statement, so firing many
// guesses at once cannot get more than MAX_PIN_FAILS comparisons.
async function checkPin(pool, userId, pin) {
  const { rows: cur } = await pool.query('SELECT locked_until FROM manager_note_pins WHERE user_id = $1', [userId]);
  if (!cur.length) return { ok: false, error: 'עוד לא הגדרת קוד PIN. מגדירים אותו בהגדרות.' };
  if (cur[0].locked_until && new Date(cur[0].locked_until) > new Date()) {
    const mins = Math.ceil((new Date(cur[0].locked_until) - Date.now()) / 60000);
    return { ok: false, error: `יותר מדי ניסיונות שגויים. ה-PIN נעול לעוד ${mins} דקות.` };
  }
  const { rows } = await pool.query(
    `UPDATE manager_note_pins SET failed_count = failed_count + 1, locked_until = NULL
     WHERE user_id = $1 AND (locked_until IS NULL OR locked_until <= NOW())
     RETURNING pin_hash, failed_count`, [userId]);
  if (!rows.length) return { ok: false, error: 'ה-PIN נעול כרגע. נסה שוב מאוחר יותר.' };
  const fails = rows[0].failed_count;
  if (fails <= MAX_PIN_FAILS && validPin(pin) && await bcrypt.compare(pinDigest(userId, pin), rows[0].pin_hash)) {
    await pool.query('UPDATE manager_note_pins SET failed_count = 0, locked_until = NULL WHERE user_id = $1', [userId]);
    return { ok: true };
  }
  if (fails >= MAX_PIN_FAILS) {
    await pool.query('UPDATE manager_note_pins SET failed_count = 0, locked_until = $2 WHERE user_id = $1', [userId, new Date(Date.now() + PIN_LOCK_MS)]);
    return { ok: false, error: 'PIN שגוי. ה-PIN נעול ל-15 דקות.' };
  }
  return { ok: false, error: `PIN שגוי. נשארו ${MAX_PIN_FAILS - fails} ניסיונות.` };
}

// ── event code (random, 4 digits, 8 hours) ───────────────────────────────────
const codeDigest = (leadId, code) => hmac(`code:${Number(leadId)}`, code);

async function createCode(pool, leadId, userId) {
  const code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await pool.query(
    `INSERT INTO manager_note_codes (lead_id, code_hash, expires_at, failed_count, created_by, created_at)
     VALUES ($1, $2, $3, 0, $4, NOW())
     ON CONFLICT (lead_id) DO UPDATE SET code_hash = $2, expires_at = $3, failed_count = 0, created_by = $4, created_at = NOW()`,
    [leadId, codeDigest(leadId, code), expiresAt, userId]);
  return { code, expires_at: expiresAt };
}
async function activeCode(pool, leadId) {
  await pool.query('DELETE FROM manager_note_codes WHERE lead_id = $1 AND expires_at <= NOW()', [leadId]);
  const { rows } = await pool.query('SELECT code_hash, expires_at, failed_count FROM manager_note_codes WHERE lead_id = $1', [leadId]);
  return rows[0] || null;
}
// → { ok: true, expires_at, code_hash } | { ok: false, error }
// Counted before it is compared, atomically (see checkPin): at most MAX_CODE_FAILS guesses per code.
async function checkCode(pool, leadId, code) {
  const wrong = 'קוד שגוי או שאינו בתוקף';
  const { rows } = await pool.query(
    `UPDATE manager_note_codes SET failed_count = failed_count + 1
     WHERE lead_id = $1 AND expires_at > NOW()
     RETURNING code_hash, expires_at, failed_count`, [leadId]);
  if (!rows.length) return { ok: false, error: wrong };
  const row = rows[0];
  const given = Buffer.from(codeDigest(leadId, validCode(code) ? code : 'x'), 'hex');
  if (row.failed_count <= MAX_CODE_FAILS && validCode(code) && crypto.timingSafeEqual(given, Buffer.from(row.code_hash, 'hex'))) {
    await pool.query('UPDATE manager_note_codes SET failed_count = 0 WHERE lead_id = $1 AND code_hash = $2', [leadId, row.code_hash]);
    return { ok: true, expires_at: row.expires_at, code_hash: row.code_hash };
  }
  if (row.failed_count >= MAX_CODE_FAILS) {
    await pool.query('DELETE FROM manager_note_codes WHERE lead_id = $1 AND code_hash = $2', [leadId, row.code_hash]);
    return { ok: false, error: 'יותר מדי ניסיונות שגויים. הקוד בוטל, צריך לבקש קוד חדש.' };
  }
  return { ok: false, error: wrong };
}

// ── "window is open" token ───────────────────────────────────────────────────
// Short-lived and bound to one user and one event. A window opened with an event code also dies
// the moment that code expires, is replaced or is cancelled; one opened with a PIN dies when the
// user is no longer a manager.
const tokenSecret = () => `${secret()}:manager-notes-unlock`;
function signUnlock({ leadId, userId, via, codeHash, codeExpiresAt }) {
  let ttl = UNLOCK_TTL_S;
  if (via === 'code') ttl = Math.max(1, Math.min(ttl, Math.floor((new Date(codeExpiresAt) - Date.now()) / 1000)));
  const token = jwt.sign({ lead: Number(leadId), uid: userId, via, ch: via === 'code' ? codeHash.slice(0, 16) : undefined }, tokenSecret(), { expiresIn: ttl });
  return { token, expires_in: ttl };
}
async function verifyUnlock(pool, token, leadId, user) {
  let p;
  try { p = jwt.verify(String(token || ''), tokenSecret()); } catch { return false; }
  if (p.lead !== Number(leadId) || p.uid !== user.id) return false;
  if (p.via === 'pin') return isGeneralManager(user);
  if (p.via !== 'code') return false;
  const row = await activeCode(pool, leadId);
  return !!row && row.code_hash.slice(0, 16) === p.ch;
}

// ── entries ──────────────────────────────────────────────────────────────────
async function addEntry(pool, leadId, userId, text) {
  const key = await eventKey(leadId, { create: true });
  await pool.query('INSERT INTO manager_note_entries (lead_id, author_id, body_enc) VALUES ($1, $2, $3)', [leadId, userId, encrypt(key, text)]);
}
async function listEntries(pool, leadId) {
  const { rows } = await pool.query(
    `SELECT e.id, e.created_at, e.body_enc, u.display_name, u.username
     FROM manager_note_entries e LEFT JOIN users u ON u.id = e.author_id
     WHERE e.lead_id = $1 ORDER BY e.created_at, e.id`, [leadId]);
  if (!rows.length) return [];
  const key = await eventKey(leadId, { create: false });
  return rows.map(r => ({
    id: r.id,
    created_at: r.created_at,
    author: r.display_name || r.username || 'משתמש שנמחק',
    body: key ? decrypt(key, r.body_enc) : null, // null = cannot be read any more
  }));
}
// The shape of what is written without any of it: one item per entry with a rough length, worked
// out from the size of the ciphertext (nothing is decrypted). The phone draws blurred filler of
// that size, so the real text is on the device only while a finger is held on it.
async function outlineEntries(pool, leadId) {
  const { rows } = await pool.query('SELECT id, body_enc FROM manager_note_entries WHERE lead_id = $1 ORDER BY created_at, id', [leadId]);
  return rows.map(r => ({ id: r.id, length: Math.max(1, Math.round((String(r.body_enc).length - 45) * 0.75 / 1.7)) }));
}
async function countEntries(pool, leadId) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM manager_note_entries WHERE lead_id = $1', [leadId]);
  return rows[0].n;
}

// ── deletion: rows first, then the salt ──────────────────────────────────────
async function wipeEvent(pool, leadId) {
  await pool.query('DELETE FROM manager_note_entries WHERE lead_id = $1', [leadId]);
  await pool.query('DELETE FROM manager_note_codes WHERE lead_id = $1', [leadId]);
  await keyStore.remove([saltName(leadId)]);
}
async function wipeAll(pool) {
  const { rows } = await pool.query('SELECT COUNT(DISTINCT lead_id)::int AS events FROM manager_note_entries');
  await pool.query('DELETE FROM manager_note_entries');
  await pool.query('DELETE FROM manager_note_codes');
  await keyStore.remove(await keyStore.list());
  return rows[0].events;
}

const MIGRATION = `
  CREATE TABLE IF NOT EXISTS manager_note_pins (
    user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    pin_hash TEXT NOT NULL,
    failed_count INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS manager_note_codes (
    lead_id INT PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    failed_count INT NOT NULL DEFAULT 0,
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS manager_note_entries (
    id SERIAL PRIMARY KEY,
    lead_id INT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    author_id INT REFERENCES users(id) ON DELETE SET NULL,
    body_enc TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS manager_note_entries_lead ON manager_note_entries(lead_id);
  ALTER TABLE manager_note_pins    ENABLE ROW LEVEL SECURITY;
  ALTER TABLE manager_note_codes   ENABLE ROW LEVEL SECURITY;
  ALTER TABLE manager_note_entries ENABLE ROW LEVEL SECURITY;
`;

module.exports = {
  MIGRATION, MAX_ENTRY_LENGTH,
  isGeneralManager, isPhone, validPin, validCode,
  hasPin, storePin, checkPin,
  createCode, activeCode, checkCode,
  signUnlock, verifyUnlock,
  addEntry, listEntries, outlineEntries, countEntries,
  wipeEvent, wipeAll, setKeyStore,
};
