const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const axios   = require('axios');
const { markEventDate, getLeadCalendarStatus, syncLeadToCalendar, createMeeting, sendMeetingInvite, getMeetingRsvpStatus, patchEventDescription, deleteMeeting, updateMeetingTime } = require('../services/calendarService');
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

    const { googleEventId, htmlLink, calendarSynced, syncError } = await markEventDate({
      leadId: lead.id,
      type,
      userId: req.user.id,
    });

    res.json({ ok: true, googleEventId, htmlLink, calendarSynced, syncError });
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

    const confirmToken = crypto.randomUUID();
    await pool.query(
      `INSERT INTO meetings (lead_id, google_event_id, title, start_time, end_time, confirm_token)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [lead.id, eventId, title, start, end, confirmToken]
    );

    const startDt = new Date(start);
    const endDt   = new Date(end);
    const fmtDate = startDt.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jerusalem' });
    const fmtStart = startDt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem', hour12: false });
    const fmtEnd   = endDt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem', hour12: false });
    await pool.query(
      `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by)
       VALUES ($1, 'meeting', 'outbound', $2, $3)`,
      [lead.id, `📅 פגישה נקבעה: ${title} | ${fmtDate} ${fmtStart}–${fmtEnd}`, req.user?.id || null]
    );

    const baseUrl = process.env.SERVER_URL || 'http://localhost:3001';
    const icsUrl    = `${baseUrl}/api/calendar/meetings/${eventId}/ics`;
    const confirmUrl = `${baseUrl}/api/calendar/meetings/${confirmToken}/confirm`;

    res.json({ eventId, eventLink, icsUrl, confirmUrl });
  } catch (err) {
    console.error('[Calendar] createMeeting error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/calendar/meetings/:eventId/ics — public ICS download for leads
router.get('/meetings/:eventId/ics', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM meetings WHERE google_event_id = $1',
      [req.params.eventId]
    );
    const meeting = rows[0];
    if (!meeting) return res.status(404).send('Meeting not found');

    const fmt = (dt) => new Date(dt).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const uid = `${req.params.eventId}@proevent`;
    const location = meeting.location || 'שרביה, פנחס בן יאיר 3, תל אביב';

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ProEvent CRM//EN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${fmt(new Date())}`,
      `DTSTART:${fmt(meeting.start_time)}`,
      `DTEND:${fmt(meeting.end_time)}`,
      `SUMMARY:${meeting.title || 'פגישה'}`,
      `LOCATION:${location}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="meeting.ics"`);
    res.send(ics);
  } catch (err) {
    res.status(500).send('Error generating ICS');
  }
});

// GET /api/calendar/meetings/:token/confirm — public confirmation link for leads
router.get('/meetings/:token/confirm', async (req, res) => {
  const htmlPage = (title, body, color = '#7c3aed') => `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f3ff}div{text-align:center;padding:2rem;background:#fff;border-radius:1rem;box-shadow:0 4px 24px rgba(0,0,0,.1);max-width:360px}h2{color:${color};margin-bottom:.5rem}p{color:#555}</style></head><body><div><h2>${title}</h2><p>${body}</p></div></body></html>`;

  try {
    const { rows } = await pool.query(
      'SELECT * FROM meetings WHERE confirm_token = $1',
      [req.params.token]
    );
    const meeting = rows[0];
    if (!meeting) return res.send(htmlPage('לא נמצאה פגישה', 'הקישור אינו תקין.', '#ef4444'));
    if (meeting.confirmed_at) return res.send(htmlPage('✅ כבר אישרת', 'אישרת את הגעתך לפגישה. נתראה!'));

    await pool.query('UPDATE meetings SET confirmed_at = NOW() WHERE confirm_token = $1', [req.params.token]);

    try {
      await patchEventDescription(meeting.google_event_id, '✅ הלקוח אישר הגעה לפגישה');
    } catch (e) {
      console.error('[Calendar] confirm patch error:', e.message);
    }

    res.send(htmlPage('תודה! ✅', 'אישרת את הגעתך לפגישה. נתראה!'));
  } catch (err) {
    res.status(500).send('שגיאה');
  }
});

// POST /api/calendar/meetings/:eventId/remind — send reminder WhatsApp to lead (manual)
router.post('/meetings/:eventId/remind', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.*, l.phone, l.name FROM meetings m JOIN leads l ON l.id = m.lead_id WHERE m.google_event_id = $1`,
      [req.params.eventId]
    );
    const meeting = rows[0];
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (!meeting.phone) return res.status(400).json({ error: 'Lead has no phone' });

    const dt = new Date(meeting.start_time);
    const dateStr = dt.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jerusalem' });
    const timeStr = dt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem', hour12: false });

    const baseUrl = process.env.SERVER_URL || 'http://localhost:3001';
    const confirmUrl = `${baseUrl}/api/calendar/meetings/${meeting.confirm_token}/confirm`;

    const message = `היי, זוהי תזכורת על פגישתך בשרביה בתאריך ${dateStr} בשעה ${timeStr}. אנא אשר כי אתה מגיע בלינק הבא:\n${confirmUrl}\n\nבברכה, צוות שרביה`;

    const chatId = meeting.phone.replace(/\D/g, '').replace(/^0/, '972') + '@c.us';
    await axios.post(
      `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/sendMessage/${process.env.GREEN_API_TOKEN}`,
      { chatId, message }
    );

    await pool.query('UPDATE meetings SET reminder_sent_at = NOW() WHERE google_event_id = $1', [req.params.eventId]);

    res.json({ ok: true });
  } catch (err) {
    console.error('[Calendar] remind error:', err.message);
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

// GET /api/calendar/meetings/:eventId/details — fetch meeting details
router.get('/meetings/:eventId/details', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM meetings WHERE google_event_id = $1',
      [req.params.eventId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Meeting not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/calendar/meetings/:eventId — cancel a meeting
router.delete('/meetings/:eventId', async (req, res) => {
  const { reason } = req.body;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM meetings WHERE google_event_id = $1',
      [req.params.eventId]
    );
    const meeting = rows[0];
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    try { await deleteMeeting(req.params.eventId); } catch (e) {
      console.error('[Calendar] deleteMeeting GCal error:', e.message);
    }

    await pool.query(
      `UPDATE leads SET meeting_event_id = NULL, meeting_rsvp_status = NULL, updated_at = NOW()
       WHERE meeting_event_id = $1`,
      [req.params.eventId]
    );
    await pool.query('DELETE FROM meetings WHERE google_event_id = $1', [req.params.eventId]);

    const startDt  = new Date(meeting.start_time);
    const fmtDate  = startDt.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jerusalem' });
    const fmtTime  = startDt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem', hour12: false });
    const body     = `❌ פגישה בוטלה | תאריך שהיה: ${fmtDate} ${fmtTime}${reason ? ` | סיבה: ${reason}` : ''}`;
    await pool.query(
      `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by)
       VALUES ($1, 'note', 'outbound', $2, $3)`,
      [meeting.lead_id, body, req.user?.id || null]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[Calendar] cancelMeeting error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/calendar/meetings/:eventId/reschedule — postpone a meeting
router.patch('/meetings/:eventId/reschedule', async (req, res) => {
  const { date, startTime, endTime, reason } = req.body;
  if (!date || !startTime || !endTime) return res.status(400).json({ error: 'date, startTime and endTime required' });
  try {
    const { rows } = await pool.query(
      'SELECT * FROM meetings WHERE google_event_id = $1',
      [req.params.eventId]
    );
    const meeting = rows[0];
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    const newStart = new Date(`${date}T${startTime}`).toISOString();
    const newEnd   = new Date(`${date}T${endTime}`).toISOString();

    try { await updateMeetingTime(req.params.eventId, newStart, newEnd); } catch (e) {
      console.error('[Calendar] updateMeetingTime GCal error:', e.message);
    }

    await pool.query(
      'UPDATE meetings SET start_time = $1, end_time = $2 WHERE google_event_id = $3',
      [newStart, newEnd, req.params.eventId]
    );

    const startDt  = new Date(newStart);
    const fmtDate  = startDt.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jerusalem' });
    const fmtStart = startDt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem', hour12: false });
    const endDt2   = new Date(newEnd);
    const fmtEnd   = endDt2.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem', hour12: false });
    const body     = `🔄 פגישה נדחתה | תאריך חדש: ${fmtDate} ${fmtStart}–${fmtEnd}${reason ? ` | סיבה: ${reason}` : ''}`;
    await pool.query(
      `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by)
       VALUES ($1, 'note', 'outbound', $2, $3)`,
      [meeting.lead_id, body, req.user?.id || null]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[Calendar] rescheduleMeeting error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar/sync-all — bulk-sync all leads with event dates to Google Calendar
router.post('/sync-all', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT l.id, COALESCE(ce.type, 'option') AS cal_type
      FROM leads l
      LEFT JOIN calendar_events ce ON ce.lead_id = l.id
      WHERE l.event_date IS NOT NULL
      ORDER BY l.event_date
    `);
    let synced = 0, failed = 0;
    const errors = [];
    for (const row of rows) {
      const r = await syncLeadToCalendar(row.id, row.cal_type, req.user.id);
      if (r?.calendarSynced) {
        synced++;
      } else {
        failed++;
        if (r?.syncError) errors.push(`Lead ${row.id}: ${r.syncError}`);
      }
    }
    res.json({ synced, failed, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
