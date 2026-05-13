const router = require('express').Router({ mergeParams: true });
const pool   = require('../db/pool');

const ITEMS = [
  'deposit_received',
  'production_meeting_set',
  'production_meeting_done',
  'waiters_closed',
  'bartenders_closed',
  'security_closed',
  'catering_closed',
  'full_payment_received',
];

// GET /api/leads/:id/production-checklist
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pc.item_key, pc.checked_at, u.display_name AS checked_by_name
       FROM production_checklist pc
       LEFT JOIN users u ON u.id = pc.checked_by
       WHERE pc.lead_id = $1`,
      [req.params.id]
    );
    const map = {};
    rows.forEach(r => { map[r.item_key] = r; });
    res.json(ITEMS.map(key => ({
      item_key: key,
      checked_at: map[key]?.checked_at || null,
      checked_by_name: map[key]?.checked_by_name || null,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/:id/production-checklist/:item — toggle checked state
router.post('/:item', async (req, res) => {
  const { id, item } = req.params;
  if (!ITEMS.includes(item)) return res.status(400).json({ error: 'Unknown item' });
  try {
    const { rows } = await pool.query(
      'SELECT checked_at FROM production_checklist WHERE lead_id = $1 AND item_key = $2',
      [id, item]
    );
    if (rows.length && rows[0].checked_at) {
      await pool.query(
        'UPDATE production_checklist SET checked_at = NULL, checked_by = NULL WHERE lead_id = $1 AND item_key = $2',
        [id, item]
      );
    } else {
      await pool.query(
        `INSERT INTO production_checklist (lead_id, item_key, checked_at, checked_by)
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (lead_id, item_key)
         DO UPDATE SET checked_at = NOW(), checked_by = EXCLUDED.checked_by`,
        [id, item, req.user?.id || null]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
