const router = require('express').Router({ mergeParams: true });
const pool   = require('../db/pool');

const DAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

// GET /api/leads/:id/event-brief
router.get('/', async (req, res) => {
  try {
    const { id } = req.params;

    const { rows: leadRows } = await pool.query(
      `SELECT l.name, l.event_date, l.event_time, l.event_end_time,
              l.event_type, l.guest_count, l.event_date_text
       FROM leads l WHERE l.id = $1`,
      [id]
    );
    if (!leadRows.length) return res.status(404).json({ error: 'Not found' });
    const lead = leadRows[0];

    const { rows: contractRows } = await pool.query(
      `SELECT contract_data FROM contracts WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [id]
    );
    const cd = contractRows[0]?.contract_data || null;

    const { rows: briefRows } = await pool.query(
      `SELECT data FROM event_briefs WHERE lead_id = $1`,
      [id]
    );

    let dayOfWeek = '';
    if (lead.event_date) {
      const d = new Date(lead.event_date);
      dayOfWeek = DAYS_HE[d.getDay()];
    }

    res.json({
      brief: briefRows[0]?.data || {},
      auto: {
        client_name:       lead.name || '',
        event_date:        lead.event_date_text || (lead.event_date ? String(lead.event_date).slice(0,10) : ''),
        event_time:        lead.event_time || '',
        event_end_time:    lead.event_end_time || '',
        event_type:        lead.event_type || '',
        guest_count:       lead.guest_count || '',
        day_of_week:       dayOfWeek,
        chef_menu:         cd?.chefMenu || '',
        bar_menu:          cd?.barMenu || '',
        contract_guests:   cd?.guests || cd?.packageGuests || '',
        remaining_balance: cd?.remainingBalance != null ? String(cd.remainingBalance) : '',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/leads/:id/event-brief
router.put('/', async (req, res) => {
  try {
    const { data } = req.body;
    await pool.query(
      `INSERT INTO event_briefs (lead_id, data, updated_at, updated_by)
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (lead_id)
       DO UPDATE SET data = $2, updated_at = NOW(), updated_by = $3`,
      [req.params.id, JSON.stringify(data), req.user?.id || null]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
