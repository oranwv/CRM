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

// Israeli holidays imported from a bundled JSON (built from the Google "חגים בישראל"
// ICS export, filtered to Jewish/Israeli holidays and translated to Hebrew).
const HOLIDAYS_PATH = path.join(__dirname, '../data/holidays.json');

async function importHolidays() {
  try {
    if (!fs.existsSync(HOLIDAYS_PATH)) return;
    const holidays = JSON.parse(fs.readFileSync(HOLIDAYS_PATH, 'utf8'));
    for (const h of holidays) {
      await pool.query(`
        INSERT INTO google_calendar_cache
          (google_event_id, title, description, start_time, end_time, all_day, color_id, html_link, source, fetched_at)
        VALUES ($1,$2,'',$3,$4,TRUE,NULL,NULL,'holiday',NOW())
        ON CONFLICT (google_event_id) DO UPDATE SET
          title=$2, start_time=$3, end_time=$4, all_day=TRUE, source='holiday', fetched_at=NOW()
      `, [h.id, h.title, h.start, h.end]);
    }
    if (holidays.length > 0) {
      await pool.query(
        `DELETE FROM google_calendar_cache WHERE source = 'holiday' AND google_event_id != ALL($1::text[])`,
        [holidays.map(h => h.id)]
      );
    }
    console.log(`[CalendarPoll] Imported ${holidays.length} Israeli holidays`);
  } catch (err) {
    console.error('[CalendarPoll] Holiday import error:', err.message);
  }
}

async function listAllEvents(calendar, calendarId, timeMin, timeMax) {
  const events = [];
  let pageToken = null;
  do {
    const res = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
      ...(pageToken ? { pageToken } : {}),
    });
    events.push(...(res.data.items || []));
    pageToken = res.data.nextPageToken || null;
  } while (pageToken);
  return events;
}

async function upsertEvent(ev, source) {
  const allDay   = !ev.start?.dateTime;
  const startRaw = ev.start?.dateTime || ev.start?.date;
  const endRaw   = ev.end?.dateTime   || ev.end?.date;
  await pool.query(`
    INSERT INTO google_calendar_cache
      (google_event_id, title, description, start_time, end_time, all_day, color_id, html_link, source, fetched_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
    ON CONFLICT (google_event_id) DO UPDATE SET
      title=$2, description=$3, start_time=$4, end_time=$5,
      all_day=$6, color_id=$7, html_link=$8, source=$9, fetched_at=NOW()
  `, [ev.id, ev.summary || '', ev.description || '', startRaw, endRaw, allDay, ev.colorId || null, ev.htmlLink || null, source]);
}

async function pollGoogleCalendar() {
  if (!fs.existsSync(TOKEN_PATH)) return;
  try {
    const auth     = getAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    const now     = new Date();
    const timeMin = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString();
    const timeMax = new Date(now.getFullYear(), now.getMonth() + 13, 1).toISOString();

    const events = await listAllEvents(calendar, 'primary', timeMin, timeMax);
    for (const ev of events) {
      // CRM-created manual events carry a private marker so they keep their brown styling
      const source = ev.extendedProperties?.private?.crmManual === '1' ? 'manual' : 'google';
      await upsertEvent(ev, source);
    }

    // Remove primary-calendar events in the fetched window that were deleted from Google Calendar
    if (events.length > 0) {
      const ids = events.map(e => e.id);
      await pool.query(`
        DELETE FROM google_calendar_cache
        WHERE start_time >= $1 AND start_time < $2
          AND source != 'holiday'
          AND google_event_id != ALL($3::text[])
      `, [timeMin, timeMax, ids]);
    }

    console.log(`[CalendarPoll] Synced ${events.length} events`);
  } catch (err) {
    console.error('[CalendarPoll] Error:', err.message);
  }
}

module.exports = { pollGoogleCalendar, importHolidays };
