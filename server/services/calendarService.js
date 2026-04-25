const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');

const CREDENTIALS_PATH = path.join(__dirname, '../credentials.json');
const TOKEN_PATH       = path.join(__dirname, '../google_token.json');

function getAuth() {
  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_id, client_secret } = creds.installed;
  const oauth2 = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3333/callback');
  oauth2.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH)));
  return oauth2;
}

function buildEventTimes(eventDate, eventTime, eventEndTime) {
  const startTime = eventTime || '19:00';
  let endTime;
  if (eventEndTime) {
    endTime = eventEndTime;
  } else {
    const [sh, sm] = startTime.split(':').map(Number);
    endTime = `${String(sh + 2).padStart(2,'0')}:${String(sm).padStart(2,'0')}`;
  }
  return {
    start: { dateTime: `${eventDate}T${startTime}:00`, timeZone: 'Asia/Jerusalem' },
    end:   { dateTime: `${eventDate}T${endTime}:00`,   timeZone: 'Asia/Jerusalem' },
  };
}

function buildEventBody(lead, type) {
  const name      = lead.name || 'ליד חדש';
  const eventType = lead.event_type || '';
  const summary   = eventType ? `${name} - ${eventType}` : name;

  const colorId = type === 'confirmed' ? '11' : '5'; // red (Tomato) : yellow (Banana)

  // Convert to Israel date (not UTC) to avoid off-by-one near midnight
  const eventDate = new Date(lead.event_date).toLocaleDateString('sv', { timeZone: 'Asia/Jerusalem' });

  const times = buildEventTimes(eventDate, lead.event_time, lead.event_end_time);

  return {
    summary,
    colorId,
    ...times,
    description: `ליד #${lead.id} | ${type === 'confirmed' ? 'סגור ✅' : 'אופציה 🟡'}\n🔗 פתח בCRM: ${process.env.SERVER_URL || 'http://localhost:3001'}/?lead=${lead.id}`,
  };
}

// Create or update calendar event for a lead — NEVER deletes
async function syncLeadToCalendar(leadId, type = 'option', userId = null) {
  const { rows } = await pool.query('SELECT * FROM leads WHERE id = $1', [leadId]);
  const lead = rows[0];
  if (!lead || !lead.event_date) {
    return { googleEventId: null, htmlLink: null, calendarSynced: false, syncError: 'No event date' };
  }

  const existing = await pool.query(
    'SELECT * FROM calendar_events WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1',
    [leadId]
  );
  const existingEvent = existing.rows[0];

  // Always upsert the DB record first — CRM status always reflects user's intent
  if (existingEvent) {
    await pool.query('UPDATE calendar_events SET type = $1 WHERE lead_id = $2', [type, leadId]);
  } else {
    // Placeholder row (no googleEventId yet); updated below if Calendar sync succeeds
    await pool.query(
      `INSERT INTO calendar_events (lead_id, google_event_id, type, event_date, created_by)
       VALUES ($1, NULL, $2, $3, $4)`,
      [leadId, type, lead.event_date, userId]
    );
  }

  // Google Calendar sync (best-effort — failure is logged but does not block the DB update above)
  const tokenPath = path.join(__dirname, '../google_token.json');
  if (!fs.existsSync(tokenPath)) {
    return { googleEventId: existingEvent?.google_event_id || null, htmlLink: existingEvent?.html_link || null, calendarSynced: false, syncError: 'No Google token file on server' };
  }

  try {
    const auth     = getAuth();
    const calendar = google.calendar({ version: 'v3', auth });
    const eventBody = buildEventBody(lead, type);

    if (existingEvent?.google_event_id) {
      const patchRes = await calendar.events.patch({
        calendarId: 'primary',
        eventId: existingEvent.google_event_id,
        requestBody: eventBody,
      });
      const htmlLink = patchRes.data.htmlLink || existingEvent.html_link || null;
      if (htmlLink && !existingEvent.html_link) {
        await pool.query('UPDATE calendar_events SET html_link = $1 WHERE lead_id = $2', [htmlLink, leadId]);
      }
      return { googleEventId: existingEvent.google_event_id, htmlLink, calendarSynced: true };
    } else {
      const result = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: eventBody,
      });
      const googleEventId = result.data.id;
      const htmlLink = result.data.htmlLink || null;
      // Backfill the googleEventId and htmlLink into the placeholder row
      await pool.query(
        'UPDATE calendar_events SET google_event_id = $1, html_link = $2 WHERE lead_id = $3 AND google_event_id IS NULL',
        [googleEventId, htmlLink, leadId]
      );
      return { googleEventId, htmlLink, calendarSynced: true };
    }
  } catch (err) {
    console.error('[Calendar] Google sync error:', err.message);
    return { googleEventId: existingEvent?.google_event_id || null, htmlLink: existingEvent?.html_link || null, calendarSynced: false, syncError: err.message };
  }
}

// Called from the UI to change type (option → confirmed or vice versa)
// Returns { googleEventId, calendarSynced }
async function markEventDate({ leadId, type, userId }) {
  return syncLeadToCalendar(leadId, type, userId);
}

// Get all leads with event dates (for calendar page)
async function getLeadCalendarStatus(leadId) {
  const { rows } = await pool.query(
    'SELECT * FROM calendar_events WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1',
    [leadId]
  );
  return rows[0] || null;
}

async function createMeeting({ leadId, title, start, end, guestEmail, guestName }) {
  const auth     = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });

  const attendees = [];
  if (guestEmail) attendees.push({ email: guestEmail, displayName: guestName || undefined });

  const result = await calendar.events.insert({
    calendarId: 'primary',
    sendUpdates: 'none',
    requestBody: {
      summary: title,
      location: 'שרביה, פנחס בן יאיר 3, תל אביב',
      start: { dateTime: start, timeZone: 'Asia/Jerusalem' },
      end:   { dateTime: end,   timeZone: 'Asia/Jerusalem' },
      attendees,
    },
  });

  return { eventId: result.data.id, eventLink: result.data.htmlLink };
}

async function sendMeetingInvite(eventId) {
  const auth     = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });
  await calendar.events.patch({
    calendarId: 'primary',
    eventId,
    sendUpdates: 'all',
    requestBody: {},
  });
}

async function getMeetingRsvpStatus(eventId, guestEmail) {
  const auth     = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });
  const result   = await calendar.events.get({ calendarId: 'primary', eventId });
  const attendee = (result.data.attendees || []).find(a => a.email === guestEmail);
  return attendee?.responseStatus || 'needsAction';
}

module.exports = { syncLeadToCalendar, markEventDate, getLeadCalendarStatus, createMeeting, sendMeetingInvite, getMeetingRsvpStatus };
