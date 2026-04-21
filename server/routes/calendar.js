const express = require('express');
const router  = express.Router();
const { markEventDate, getLeadCalendarStatus } = require('../services/calendarService');
const pool = require('../db/pool');

// GET /api/calendar/leads — all leads with event dates (for calendar view)
router.get('/leads', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT l.id, l.name, l.event_date, l.event_type, l.stage,
             ce.type AS calendar_type, ce.google_event_id
      FROM leads l
      LEFT JOIN calendar_events ce ON ce.lead_id = l.id
      WHERE l.event_date IS NOT NULL
      ORDER BY l.event_date ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar/leads/:leadId/mark
router.post('/leads/:leadId/mark', async (req, res) => {
  const { type } = req.body; // 'option' or 'confirmed'
  try {
    const { rows } = await pool.query('SELECT * FROM leads WHERE id = $1', [req.params.leadId]);
    const lead = rows[0];
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (!lead.event_date) return res.status(400).json({ error: 'No event date set' });

    const googleEventId = await markEventDate({
      leadId: lead.id,
      type,
      userId: req.user.id,
    });

    res.json({ ok: true, googleEventId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/calendar/leads/:leadId/status
router.get('/leads/:leadId/status', async (req, res) => {
  try {
    const status = await getLeadCalendarStatus(req.params.leadId);
    res.json(status || { type: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
