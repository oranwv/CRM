const express = require('express');
const router  = express.Router();
const { markEventDate, getLeadCalendarStatus, createMeeting, sendMeetingInvite, getMeetingRsvpStatus } = require('../services/calendarService');
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

// POST /api/calendar/leads/:leadId/meeting — create a meeting event for a lead
router.post('/leads/:leadId/meeting', async (req, res) => {
  const { title, start, end, guestEmail, guestName } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM leads WHERE id = $1', [req.params.leadId]);
    const lead = rows[0];
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const { eventId, eventLink } = await createMeeting({
      leadId: lead.id,
      title,
      start,
      end,
      guestEmail: guestEmail || lead.email || null,
      guestName:  guestName  || lead.name  || null,
    });

    await pool.query(
      `UPDATE leads SET meeting_event_id = $1, meeting_rsvp_status = 'needsAction', updated_at = NOW() WHERE id = $2`,
      [eventId, lead.id]
    );

    res.json({ eventId, eventLink });
  } catch (err) {
    console.error('[Calendar] createMeeting error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar/meetings/:eventId/notify — send email invite to attendees
router.post('/meetings/:eventId/notify', async (req, res) => {
  try {
    await sendMeetingInvite(req.params.eventId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Calendar] sendMeetingInvite error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/calendar/meetings/:eventId/status?leadId=&guestEmail= — check RSVP status
router.get('/meetings/:eventId/status', async (req, res) => {
  const { leadId, guestEmail } = req.query;
  try {
    const status = await getMeetingRsvpStatus(req.params.eventId, guestEmail);
    if (leadId) {
      await pool.query(
        `UPDATE leads SET meeting_rsvp_status = $1, updated_at = NOW() WHERE id = $2`,
        [status, leadId]
      );
    }
    res.json({ status });
  } catch (err) {
    console.error('[Calendar] getMeetingRsvpStatus error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
