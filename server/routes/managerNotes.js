// הערות מנהל (Phase 119) — see services/managerNotes.js for what is protected and how.
// Mounted at /api/manager-notes behind requireAuth. Note text, codes and PINs are never logged,
// and errors are answered with a fixed message (an error object could carry query parameters).
const router = require('express').Router();
const pool   = require('../db/pool');
const mn     = require('../services/managerNotes');

const fail = (res, where, err) => { console.error(`[ManagerNotes] ${where}:`, err.code || err.name || 'error'); res.status(500).json({ error: 'שגיאה, נסה שוב' }); };
const leadIdOf = req => { const n = Number(req.params.leadId); return Number.isInteger(n) && n > 0 ? n : null; };
const gmOnly = (req, res, next) => mn.isGeneralManager(req.user) ? next() : res.status(403).json({ error: 'אין הרשאה' });
const phoneOnly = (req, res, next) => mn.isPhone(req) ? next() : res.status(403).json({ error: 'הערות מנהל נפתחות רק מהטלפון' });
const unlocked = async (req, res, next) => {
  try {
    const leadId = leadIdOf(req);
    if (!leadId || !(await mn.verifyUnlock(pool, req.headers['x-notes-unlock'], leadId, req.user))) return res.status(423).json({ error: 'החלון נעול' });
    next();
  } catch (err) { fail(res, 'unlock check', err); }
};

// ── settings: my PIN ─────────────────────────────────────────────────────────
router.get('/pin', gmOnly, async (req, res) => {
  try { res.json({ has_pin: await mn.hasPin(pool, req.user.id) }); } catch (err) { fail(res, 'pin status', err); }
});

// Set my PIN (first time) or change it (needs the current one).
router.post('/pin', gmOnly, async (req, res) => {
  try {
    const { pin, current_pin } = req.body || {};
    if (!mn.validPin(pin)) return res.status(400).json({ error: 'ה-PIN חייב להיות 6 ספרות' });
    if (await mn.hasPin(pool, req.user.id)) {
      const chk = await mn.checkPin(pool, req.user.id, current_pin);
      if (!chk.ok) return res.status(403).json({ error: chk.error });
    }
    await mn.storePin(pool, req.user.id, pin);
    res.json({ ok: true });
  } catch (err) { fail(res, 'pin save', err); }
});

// A system admin clears another manager's forgotten PIN (with his own PIN); that manager then sets a new one.
router.delete('/pin/:userId', async (req, res) => {
  try {
    const isAdmin = req.user.roles?.includes('admin') || req.user.role === 'admin';
    if (!isAdmin) return res.status(403).json({ error: 'אין הרשאה' });
    const chk = await mn.checkPin(pool, req.user.id, req.body?.pin);
    if (!chk.ok) return res.status(403).json({ error: chk.error });
    await pool.query('DELETE FROM manager_note_pins WHERE user_id = $1', [Number(req.params.userId) || 0]);
    res.json({ ok: true });
  } catch (err) { fail(res, 'pin reset', err); }
});

// Settings: delete the notes of every event.
router.post('/wipe-all', gmOnly, async (req, res) => {
  try {
    const chk = await mn.checkPin(pool, req.user.id, req.body?.pin);
    if (!chk.ok) return res.status(403).json({ error: chk.error });
    res.json({ ok: true, events: await mn.wipeAll(pool) });
  } catch (err) { fail(res, 'wipe all', err); }
});

// ── per event ────────────────────────────────────────────────────────────────
// What the card needs to draw itself. A user who is not a general manager learns nothing —
// not whether a code exists and not whether anything is written.
router.get('/:leadId/status', async (req, res) => {
  try {
    const leadId = leadIdOf(req);
    if (!leadId) return res.status(400).json({ error: 'bad id' });
    const out = { is_manager: mn.isGeneralManager(req.user), phone: mn.isPhone(req) };
    if (out.is_manager) {
      out.has_pin = await mn.hasPin(pool, req.user.id);
      const code = await mn.activeCode(pool, leadId);
      out.code_expires_at = code ? code.expires_at : null;
      out.entries = await mn.countEntries(pool, leadId);
    }
    res.json(out);
  } catch (err) { fail(res, 'status', err); }
});

// "ייצר קוד" — the manager's PIN → a random 4-digit code for this event, good for 8 hours.
// Shown once; a new code replaces the previous one.
router.post('/:leadId/code', gmOnly, async (req, res) => {
  try {
    const leadId = leadIdOf(req);
    if (!leadId) return res.status(400).json({ error: 'bad id' });
    const chk = await mn.checkPin(pool, req.user.id, req.body?.pin);
    if (!chk.ok) return res.status(403).json({ error: chk.error });
    const { rows } = await pool.query('SELECT 1 FROM leads WHERE id = $1', [leadId]);
    if (!rows.length) return res.status(404).json({ error: 'האירוע לא נמצא' });
    res.json(await mn.createCode(pool, leadId, req.user.id));
  } catch (err) { fail(res, 'code', err); }
});

// Open the window: 4 digits = the event code (anyone who holds it), 6 digits = a general manager's own PIN.
router.post('/:leadId/unlock', phoneOnly, async (req, res) => {
  try {
    const leadId = leadIdOf(req);
    const key = String(req.body?.key || '');
    if (!leadId) return res.status(400).json({ error: 'bad id' });
    if (key.length === 6 && mn.isGeneralManager(req.user)) {
      const chk = await mn.checkPin(pool, req.user.id, key);
      if (!chk.ok) return res.status(403).json({ error: chk.error });
      return res.json(mn.signUnlock({ leadId, userId: req.user.id, via: 'pin' }));
    }
    const chk = await mn.checkCode(pool, leadId, key);
    if (!chk.ok) return res.status(403).json({ error: chk.error });
    res.json(mn.signUnlock({ leadId, userId: req.user.id, via: 'code', codeHash: chk.code_hash, codeExpiresAt: chk.expires_at }));
  } catch (err) { fail(res, 'unlock', err); }
});

// Read what is written (the client asks for it only while a finger is held on the screen).
// ?outline=1 → only how much is written, for the blurred view; no text leaves the server.
router.get('/:leadId/entries', phoneOnly, unlocked, async (req, res) => {
  try {
    const leadId = leadIdOf(req);
    res.json(req.query.outline ? await mn.outlineEntries(pool, leadId) : await mn.listEntries(pool, leadId));
  } catch (err) { fail(res, 'read', err); }
});

// Write: every save is a new entry, signed with the writer's name and the time.
router.post('/:leadId/entries', phoneOnly, unlocked, async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) return res.status(400).json({ error: 'אין מה לשמור' });
    if (text.length > mn.MAX_ENTRY_LENGTH) return res.status(400).json({ error: 'הטקסט ארוך מדי' });
    await mn.addEntry(pool, leadIdOf(req), req.user.id, text);
    res.json({ ok: true });
  } catch (err) { fail(res, 'write', err); }
});

// "מחק" — everything written for this event, its code, and its key. Not recoverable.
router.post('/:leadId/wipe', gmOnly, async (req, res) => {
  try {
    const leadId = leadIdOf(req);
    if (!leadId) return res.status(400).json({ error: 'bad id' });
    const chk = await mn.checkPin(pool, req.user.id, req.body?.pin);
    if (!chk.ok) return res.status(403).json({ error: chk.error });
    await mn.wipeEvent(pool, leadId);
    res.json({ ok: true });
  } catch (err) { fail(res, 'wipe', err); }
});

module.exports = router;
