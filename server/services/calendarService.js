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

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}

function buildEventTimes(eventDate, eventTime, eventEndTime) {
  const startTime = eventTime || '19:00';
  let endDateStr = eventDate;
  let endTime;

  if (eventEndTime) {
    endTime = eventEndTime;
    // If end <= start assume it wraps to next day (e.g. midnight show)
    if (endTime <= startTime) endDateStr = addDays(eventDate, 1);
  } else {
    const [sh, sm] = startTime.split(':').map(Number);
    const totalMin = sh * 60 + sm + 120;
    endTime = `${String(Math.floor(totalMin / 60) % 24).padStart(2,'0')}:${String(totalMin % 60).padStart(2,'0')}`;
    if (totalMin >= 1440) endDateStr = addDays(eventDate, 1);
  }

  return {
    start: { dateTime: `${eventDate}T${startTime}:00`, timeZone: 'Asia/Jerusalem' },
    end:   { dateTime: `${endDateStr}T${endTime}:00`,   timeZone: 'Asia/Jerusalem' },
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
    // Lets the CRM find this event again if the stored google_event_id ever goes stale
    extendedProperties: { private: { crmLeadId: String(lead.id) } },
  };
}

// Google returns 404 (deleted) or 410 (gone) when the stored event no longer exists
function isEventGone(err) {
  const code = err?.code || err?.response?.status;
  return code === 404 || code === 410 || /not found|requested event/i.test(err?.message || '');
}

// Look for an existing Google event that belongs to this lead, after the stored id went stale.
// First by the private crmLeadId property, then by the "ליד #<id> |" text the CRM writes in the description.
async function findLeadEventOnGoogle(calendar, lead) {
  const eventDate = new Date(lead.event_date).toLocaleDateString('sv', { timeZone: 'Asia/Jerusalem' });
  const timeMin = new Date(`${addDays(eventDate, -1)}T00:00:00+02:00`).toISOString();
  const timeMax = new Date(`${addDays(eventDate, 2)}T00:00:00+02:00`).toISOString();
  const marker  = new RegExp(`ליד #${lead.id}(?!\\d)`);

  const byProp = await calendar.events.list({
    calendarId: 'primary', timeMin, timeMax, singleEvents: true, maxResults: 10,
    privateExtendedProperty: `crmLeadId=${lead.id}`,
  });
  const propHit = (byProp.data.items || []).find(e => e.status !== 'cancelled');
  if (propHit) return propHit;

  const byText = await calendar.events.list({
    calendarId: 'primary', timeMin, timeMax, singleEvents: true, maxResults: 50,
    q: `ליד #${lead.id}`,
  });
  return (byText.data.items || []).find(e => e.status !== 'cancelled' && marker.test(e.description || '')) || null;
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
      try {
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
      } catch (err) {
        if (!isEventGone(err)) throw err;
        // The stored event was deleted from Google — fall through and relink/recreate below
        console.warn(`[Calendar] Lead ${leadId}: stored event ${existingEvent.google_event_id} no longer exists on Google, relinking`);
      }
    }

    // No usable event id: try to relink to an event of this lead that still exists, otherwise create one
    let eventData;
    const found = await findLeadEventOnGoogle(calendar, lead);
    if (found) {
      const patchRes = await calendar.events.patch({ calendarId: 'primary', eventId: found.id, requestBody: eventBody });
      eventData = patchRes.data;
      console.log(`[Calendar] Lead ${leadId}: relinked to existing Google event ${found.id}`);
    } else {
      const result = await calendar.events.insert({ calendarId: 'primary', requestBody: eventBody });
      eventData = result.data;
    }
    const googleEventId = eventData.id;
    const htmlLink = eventData.htmlLink || null;
    await pool.query(
      'UPDATE calendar_events SET google_event_id = $1, html_link = $2 WHERE lead_id = $3',
      [googleEventId, htmlLink, leadId]
    );
    return { googleEventId, htmlLink, calendarSynced: true };
  } catch (err) {
    console.error('[Calendar] Google sync error:', err.message);
    return { googleEventId: existingEvent?.google_event_id || null, htmlLink: existingEvent?.html_link || null, calendarSynced: false, syncError: err.message };
  }
}

// Remove a lead's event(s) from Google Calendar. Deletes the stored event id and, in case that id
// went stale, any other event of this lead found by crmLeadId / the "ליד #<id>" marker.
// Never throws — returns how many events were actually removed from Google.
async function removeLeadEventsFromGoogle(lead, storedEventId = null) {
  if (!fs.existsSync(TOKEN_PATH)) return 0;
  let removed = 0;
  try {
    const calendar = google.calendar({ version: 'v3', auth: getAuth() });
    const ids = new Set();
    if (storedEventId) ids.add(storedEventId);
    if (lead?.event_date) {
      // findLeadEventOnGoogle returns one event; loop in case several were created over time
      for (let i = 0; i < 5; i++) {
        const found = await findLeadEventOnGoogle(calendar, lead).catch(() => null);
        if (!found || ids.has(found.id)) break;
        ids.add(found.id);
        await calendar.events.delete({ calendarId: 'primary', eventId: found.id }).catch(() => {});
        removed++;
      }
    }
    if (storedEventId) {
      try {
        await calendar.events.delete({ calendarId: 'primary', eventId: storedEventId });
        removed++;
      } catch (err) {
        if (!isEventGone(err)) console.error('[Calendar] delete error:', err.message);
      }
    }
  } catch (err) {
    console.error('[Calendar] removeLeadEventsFromGoogle error:', err.message);
  }
  return removed;
}

// Called from the UI when the active button (אופציה/סגור) is clicked again: take the lead off the calendar
async function unmarkEventDate(leadId) {
  const { rows } = await pool.query('SELECT * FROM leads WHERE id = $1', [leadId]);
  const lead = rows[0];
  const existingEvent = await getLeadCalendarStatus(leadId);
  const removed = await removeLeadEventsFromGoogle(lead, existingEvent?.google_event_id || null);
  await pool.query('DELETE FROM calendar_events WHERE lead_id = $1', [leadId]);
  return { removedFromGoogle: removed };
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

// Same as getLeadCalendarStatus, but also checks that the linked Google event still exists.
// If it was deleted on Google, re-sync (relink or recreate) so the lead card never shows a dead link
// or a wrong colour. Best-effort: any Google error just returns the DB row as-is.
async function getLeadCalendarStatusVerified(leadId) {
  const row = await getLeadCalendarStatus(leadId);
  if (!row?.google_event_id || !fs.existsSync(TOKEN_PATH)) return row;
  try {
    const calendar = google.calendar({ version: 'v3', auth: getAuth() });
    const { data } = await calendar.events.get({ calendarId: 'primary', eventId: row.google_event_id });
    if (data.status !== 'cancelled') return row;
  } catch (err) {
    if (!isEventGone(err)) return row;
  }
  console.warn(`[Calendar] Lead ${leadId}: linked Google event missing, re-syncing`);
  const r = await syncLeadToCalendar(leadId, row.type, row.created_by || null);
  return r.calendarSynced ? await getLeadCalendarStatus(leadId) : row;
}

async function createMeeting({ leadId, title, start, end, guestEmail, guestName, sendInvite }) {
  const auth     = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });

  const attendees = [];
  if (guestEmail) attendees.push({ email: guestEmail, displayName: guestName || undefined });

  const baseUrl = process.env.SERVER_URL || 'http://localhost:3001';
  const result = await calendar.events.insert({
    calendarId: 'primary',
    sendUpdates: sendInvite ? 'all' : 'none',
    requestBody: {
      summary: title,
      colorId: '3',
      location: 'שרביה, פנחס בן יאיר 3, תל אביב',
      description: `🔗 פתח ליד ב-CRM: ${baseUrl}/?lead=${leadId}`,
      start: { dateTime: start, timeZone: 'Asia/Jerusalem' },
      end:   { dateTime: end,   timeZone: 'Asia/Jerusalem' },
      attendees,
    },
  });

  return { eventId: result.data.id, eventLink: result.data.htmlLink };
}

// Create a free-form event on the business calendar, marked so the CRM
// renders it as a manual (brown) event even after re-sync.
async function createManualEvent({ title, description, date, startTime, endTime, allDay }) {
  const auth     = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });

  let start, end;
  if (allDay) {
    const next = new Date(date + 'T12:00:00');
    next.setDate(next.getDate() + 1);
    const nextStr = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    start = { date };
    end   = { date: nextStr }; // Google all-day end date is exclusive
  } else {
    let endT = endTime;
    if (!endT) { // default duration: one hour
      const s = new Date(`${date}T${startTime}:00`);
      s.setHours(s.getHours() + 1);
      endT = `${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}`;
    }
    let endDate = date;
    if (endT <= startTime) { // crosses midnight
      const next = new Date(date + 'T12:00:00');
      next.setDate(next.getDate() + 1);
      endDate = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    }
    start = { dateTime: `${date}T${startTime}:00`,  timeZone: 'Asia/Jerusalem' };
    end   = { dateTime: `${endDate}T${endT}:00`,    timeZone: 'Asia/Jerusalem' };
  }

  const result = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: title,
      description: description || '',
      start,
      end,
      extendedProperties: { private: { crmManual: '1' } },
    },
  });
  return result.data;
}

async function deleteManualEvent(eventId) {
  const auth     = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });
  await calendar.events.delete({ calendarId: 'primary', eventId });
}

async function sendMeetingInvite(eventId) {
  const auth     = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });
  const { data: event } = await calendar.events.get({ calendarId: 'primary', eventId });
  await calendar.events.update({
    calendarId: 'primary',
    eventId,
    sendUpdates: 'all',
    requestBody: event,
  });
}

async function getMeetingRsvpStatus(eventId, guestEmail) {
  const auth     = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });
  const result   = await calendar.events.get({ calendarId: 'primary', eventId });
  const attendee = (result.data.attendees || []).find(a => a.email === guestEmail);
  return attendee?.responseStatus || 'needsAction';
}

async function patchEventDescription(eventId, prependText) {
  const auth     = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });
  const existing = await calendar.events.get({ calendarId: 'primary', eventId });
  const oldDesc  = existing.data.description || '';
  const newDesc  = prependText + (oldDesc ? '\n' + oldDesc : '');
  await calendar.events.patch({
    calendarId: 'primary',
    eventId,
    requestBody: { description: newDesc },
  });
}

async function deleteMeeting(googleEventId) {
  const auth     = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });
  await calendar.events.delete({ calendarId: 'primary', eventId: googleEventId });
}

async function updateMeetingTime(googleEventId, start, end) {
  const auth     = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });
  await calendar.events.patch({
    calendarId: 'primary',
    eventId: googleEventId,
    requestBody: {
      start: { dateTime: start, timeZone: 'Asia/Jerusalem' },
      end:   { dateTime: end,   timeZone: 'Asia/Jerusalem' },
    },
  });
}

const CALENDAR_ID = 'sharabiyajaffa@gmail.com';

async function listCalendarAcl() {
  const auth = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });
  const { data } = await calendar.acl.list({ calendarId: CALENDAR_ID });
  return data.items || [];
}

async function addCalendarViewer(email) {
  const auth = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });
  const { data } = await calendar.acl.insert({
    calendarId: CALENDAR_ID,
    requestBody: { role: 'reader', scope: { type: 'user', value: email } },
  });
  return data;
}

async function removeCalendarAcl(ruleId) {
  const auth = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });
  await calendar.acl.delete({ calendarId: CALENDAR_ID, ruleId });
}

module.exports = { syncLeadToCalendar, markEventDate, unmarkEventDate, removeLeadEventsFromGoogle, getLeadCalendarStatus, getLeadCalendarStatusVerified, createMeeting, createManualEvent, deleteManualEvent, sendMeetingInvite, getMeetingRsvpStatus, patchEventDescription, deleteMeeting, updateMeetingTime, listCalendarAcl, addCalendarViewer, removeCalendarAcl };
