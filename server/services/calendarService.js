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

function buildEventTimes(eventDate, eventTime) {
  // eventDate: 'yyyy-mm-dd', eventTime: 'HH:MM' or null
  const startTime = eventTime || '19:00';
  const [sh, sm] = startTime.split(':').map(Number);
  const endH = sh + 2; // 2-hour event
  const endTime = `${String(endH).padStart(2,'0')}:${String(sm).padStart(2,'0')}`;

  return {
    start: { dateTime: `${eventDate}T${startTime}:00`, timeZone: 'Asia/Jerusalem' },
    end:   { dateTime: `${eventDate}T${endTime}:00`,   timeZone: 'Asia/Jerusalem' },
  };
}

function buildEventBody(lead, type) {
  const name      = lead.name || 'ליד חדש';
  const eventType = lead.event_type || '';
  const summary   = eventType ? `${name} - ${eventType}` : name;

  const colorId = type === 'confirmed' ? '2' : '5'; // green : yellow

  const eventDate = (lead.event_date instanceof Date
    ? lead.event_date.toISOString()
    : lead.event_date
  ).split('T')[0];

  const times = buildEventTimes(eventDate, lead.event_time);

  return {
    summary,
    colorId,
    ...times,
    description: `ליד #${lead.id} | ${type === 'confirmed' ? 'סגור ✅' : 'אופציה 🟡'}`,
  };
}

// Create or update calendar event for a lead — NEVER deletes
async function syncLeadToCalendar(leadId, type = 'option', userId = null) {
  try {
    const tokenPath = path.join(__dirname, '../google_token.json');
    if (!fs.existsSync(tokenPath)) return null;

    const auth     = getAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    const { rows } = await pool.query('SELECT * FROM leads WHERE id = $1', [leadId]);
    const lead = rows[0];
    if (!lead || !lead.event_date) return null;

    const existing = await pool.query(
      'SELECT * FROM calendar_events WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1',
      [leadId]
    );

    const eventBody = buildEventBody(lead, type);

    if (existing.rows[0]?.google_event_id) {
      // Update existing event — never delete
      await calendar.events.patch({
        calendarId: 'primary',
        eventId: existing.rows[0].google_event_id,
        requestBody: eventBody,
      });
      await pool.query(
        'UPDATE calendar_events SET type = $1 WHERE lead_id = $2',
        [type, leadId]
      );
      return existing.rows[0].google_event_id;
    } else {
      // Create new event
      const result = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: eventBody,
      });
      const googleEventId = result.data.id;
      await pool.query(
        `INSERT INTO calendar_events (lead_id, google_event_id, type, event_date, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [leadId, googleEventId, type, lead.event_date, userId]
      );
      return googleEventId;
    }
  } catch (err) {
    console.error('[Calendar] syncLeadToCalendar error:', err.message);
    return null;
  }
}

// Called from the UI to change type (option → confirmed or vice versa)
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

module.exports = { syncLeadToCalendar, markEventDate, getLeadCalendarStatus };
