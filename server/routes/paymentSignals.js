// /api/payment-signals — "תשלום ללא מסמך": deposit / full payment marked received, no receipt (see services/paymentSignals.js)
const router = require('express').Router();
const pool   = require('../db/pool');

const FIN = ['admin', 'manager', 'finance'];
const rolesOf = u => (u.roles?.length ? u.roles : [u.role]);

// GET /api/payment-signals/count — badge for managers / finance
router.get('/count', async (req, res) => {
  if (!rolesOf(req.user).some(r => FIN.includes(r))) return res.json({ count: 0 });
  try {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM payment_signals WHERE status = 'open'`);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/payment-signals — open list (managers / finance), newest first
router.get('/', async (req, res) => {
  if (!rolesOf(req.user).some(r => FIN.includes(r))) return res.status(403).json({ error: 'אין הרשאה' });
  try {
    const { rows } = await pool.query(`
      SELECT s.id, s.lead_id, l.name AS lead_name, l.event_type, l.event_date, l.stage,
             s.kind, s.amount, s.method, s.snippet, s.said_at, s.detected_at
      FROM payment_signals s JOIN leads l ON l.id = s.lead_id
      WHERE s.status = 'open' ORDER BY s.said_at DESC LIMIT 100
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/payment-signals/lead/:leadId — open signals of one lead (anyone who can open the lead)
router.get('/lead/:leadId', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, lead_id, kind, amount, method, snippet, said_at FROM payment_signals
      WHERE lead_id = $1 AND status = 'open' ORDER BY said_at DESC
    `, [Number(req.params.leadId)]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/payment-signals/:id/dismiss — "לא רלוונטי"
router.post('/:id/dismiss', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE payment_signals SET status = 'dismissed', resolved_at = NOW(), resolved_by = $2 WHERE id = $1 AND status = 'open' RETURNING id`,
      [Number(req.params.id), req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'לא נמצא' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/payment-signals/:id/done — closed by hand (the document was made elsewhere)
router.post('/:id/done', async (req, res) => {
  try {
    await pool.query(
      `UPDATE payment_signals SET status = 'done', resolved_at = NOW(), resolved_by = $2 WHERE id = $1 AND status = 'open'`,
      [Number(req.params.id), req.user.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
