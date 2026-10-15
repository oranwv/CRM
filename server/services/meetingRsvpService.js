// Meeting reminders + customer RSVP (Phase 47).
//
// Customer (WhatsApp via Green API, the venue's regular number):
//   1. Day before at 10:00 Israel — reminder with address, navigation + parking links and two
//      interactive buttons "✅ מגיע/ה" / "❌ לא מגיע/ה" (sendInteractiveButtonsReply, beta).
//      If the buttons call fails, the same text goes out with two confirm/decline links.
//      Booked for today, or for tomorrow after 10:00 → sent right away at booking.
//   2. Morning of the meeting at 09:00 — short reminder, no buttons. Skipped when the customer
//      declined, or when message 1 already went out on the meeting day.
// Customer answers (button click, link, or a plain "מגיע"/"לא אגיע" text in the chat) set
// meetings.customer_status = confirmed | declined, are logged on the lead's timeline, update the
// Google event (✅ in the title / "❌ בוטל –" + grey) and, on decline, ping the host at once.
//
// Host (the staff member holding the meeting):
//   - day-before internal reminder (existing) now carries the customer's status;
//   - 09:00 on the meeting day, if the customer never answered: "לא אישר – להתקשר".
//
// runMeetingReminderTick() runs every 15 minutes from index.js.
const pool  = require('../db/pool');
const axios = require('axios');
const { sendWhatsApp } = require('./reminderService');

const IL = 'Asia/Jerusalem';
const VENUE_ADDRESS = 'רבי פנחס בן יאיר 3, תל אביב-יפו';
const MAPS_URL      = 'https://maps.google.com/?q=Pinhas+Ben+Yair+3,+Tel+Aviv-Yafo';
const PARKING_URL   = 'https://sharabiya.co.il/%D7%97%D7%A0%D7%99%D7%94-%D7%95%D7%93%D7%A8%D7%9B%D7%99-%D7%94%D7%92%D7%A2%D7%94/';
const CUSTOMER_REMINDER_HOUR = 10; // day before
const DAY_OF_HOUR            = 9;  // meeting day (customer + host nudge)

const baseUrl = () => process.env.SERVER_URL || 'http://localhost:3001';

// ---- Israel-time helpers ---------------------------------------------------------------
function ilParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: IL, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(d);
  const g = t => p.find(x => x.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: parseInt(g('hour'), 10) % 24 };
}
function ilDate(d) { return ilParts(new Date(d)).date; }
function addDays(dateStr, n) {
  const dt = new Date(`${dateStr}T12:00:00Z`); dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function fmtDay(d)  { return new Date(d).toLocaleDateString('he-IL', { weekday: 'long', timeZone: IL }); }
function fmtDate(d) { const dt = new Date(d); return `${dt.toLocaleDateString('en-GB', { day: '2-digit', timeZone: IL })}/${dt.toLocaleDateString('en-GB', { month: '2-digit', timeZone: IL })}`; }
function fmtTime(d) { return new Date(d).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: IL, hour12: false }); }
function firstName(name) { return (name || '').trim().split(/\s+/)[0] || ''; }
function chatIdOf(phone) { return phone.replace(/\D/g, '').replace(/^0/, '972') + '@c.us'; }

// ---- Green API senders ------------------------------------------------------------------
function gaUrl(method) {
  return `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/${method}/${process.env.GREEN_API_TOKEN}`;
}
async function sendText(phone, message) {
  await axios.post(gaUrl('sendMessage'), { chatId: chatIdOf(phone), message }, { timeout: 15000 });
}
// Interactive reply buttons (Green API beta). Returns false when the call fails so the caller can fall back.
async function sendButtons(phone, body, buttons, footer) {
  try {
    await axios.post(gaUrl('sendInteractiveButtonsReply'), {
      chatId: chatIdOf(phone),
      body,
      footer: footer || undefined,
      buttons: buttons.map(b => ({ buttonId: b.id, buttonText: b.text })),
    }, { timeout: 15000 });
    return true;
  } catch (err) {
    console.error('[MeetingRSVP] interactive buttons failed, falling back to links:', err.response?.data?.message || err.message);
    return false;
  }
}
async function logOutbound(leadId, text) {
  try {
    await pool.query(
      `INSERT INTO messages (lead_id, channel, direction, body, timestamp, is_read) VALUES ($1,'whatsapp','outbound',$2,NOW(),true)`,
      [leadId, text]
    );
  } catch (e) { console.error('[MeetingRSVP] log outbound failed:', e.message); }
}
async function logNote(leadId, body) {
  try {
    await pool.query(
      `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by, source) VALUES ($1,'note','inbound',$2,NULL,'calendar')`,
      [leadId, body]
    );
  } catch (e) { console.error('[MeetingRSVP] log note failed:', e.message); }
}

// ---- Message texts ----------------------------------------------------------------------
function dayBeforeText(m) {
  const when = ilDate(m.start_time) === ilParts().date ? 'היום' : 'מחר';
  return [
    `היי ${firstName(m.name)} 🙂`,
    `תזכורת: ${when}, ${fmtDay(m.start_time)} ${fmtDate(m.start_time)} בשעה ${fmtTime(m.start_time)}, יש לנו פגישה בשרביה.`,
    '',
    `📍 ${VENUE_ADDRESS}`,
    `🗺️ ניווט בגוגל מפס: ${MAPS_URL}`,
    `🅿️ חניה ודרכי הגעה: ${PARKING_URL}`,
    '',
    'נשמח שתאשרו הגעה 👇',
    `נתראה ${when}!`,
    'צוות שרביה',
  ].join('\n');
}
function dayBeforeLinksText(m) {
  const b = baseUrl();
  return dayBeforeText(m).replace('נשמח שתאשרו הגעה 👇',
    `נשמח שתאשרו הגעה:\n✅ מגיע/ה – ${b}/api/calendar/meetings/${m.confirm_token}/confirm\n❌ לא מגיע/ה – ${b}/api/calendar/meetings/${m.confirm_token}/decline`);
}
function dayOfText(m) {
  return [
    `בוקר טוב ${firstName(m.name)} 🙂`,
    `תזכורת לפגישה שלנו היום בשעה ${fmtTime(m.start_time)} בשרביה, ${VENUE_ADDRESS}.`,
    `🗺️ ניווט: ${MAPS_URL}`,
    `🅿️ חניה ודרכי הגעה: ${PARKING_URL}`,
    'נתראה!',
    'צוות שרביה',
  ].join('\n');
}
const STATUS_HE = { confirmed: 'הלקוח אישר הגעה ✅', declined: 'הלקוח ביטל ❌' };
function statusLine(m) { return STATUS_HE[m.customer_status] || 'הלקוח עדיין לא אישר הגעה ⏳'; }

// ---- Customer: day-before reminder (also called right after a short-notice booking) ------
async function sendCustomerReminder(meetingId) {
  const { rows } = await pool.query(
    `SELECT m.*, l.name, l.phone FROM meetings m JOIN leads l ON l.id = m.lead_id WHERE m.id = $1`, [meetingId]);
  const m = rows[0];
  if (!m || !m.phone) return false;
  const claim = await pool.query('UPDATE meetings SET reminder_sent_at = NOW() WHERE id = $1 AND reminder_sent_at IS NULL RETURNING id', [m.id]);
  if (!claim.rows.length) return false;
  try {
    const text = dayBeforeText(m);
    const ok = await sendButtons(m.phone, text, [
      { id: `meet_${m.id}_yes`, text: '✅ מגיע/ה' },
      { id: `meet_${m.id}_no`,  text: '❌ לא מגיע/ה' },
    ]);
    if (!ok) await sendText(m.phone, dayBeforeLinksText(m));
    await logOutbound(m.lead_id, ok ? text + '\n[✅ מגיע/ה] [❌ לא מגיע/ה]' : dayBeforeLinksText(m));
    console.log(`[MeetingRSVP] day-before reminder → ${m.name} (${m.phone})${ok ? '' : ' [links]'}`);
    return true;
  } catch (err) {
    console.error(`[MeetingRSVP] customer reminder failed for meeting ${m.id}:`, err.message);
    await pool.query('UPDATE meetings SET reminder_sent_at = NULL WHERE id = $1', [m.id]);
    return false;
  }
}

// Should the day-before reminder go out now? Day before from 10:00, or any time on the meeting day.
function customerReminderDue(start, now = new Date()) {
  const { date: today, hour } = ilParts(now);
  const d = ilDate(start);
  if (new Date(start) <= now) return false;
  if (d === today) return true;
  if (d === addDays(today, 1) && hour >= CUSTOMER_REMINDER_HOUR) return true;
  return false;
}

// ---- Customer status (button / link / text) ---------------------------------------------
async function setCustomerStatus(meetingId, status, source = 'button') {
  const { rows } = await pool.query(
    `SELECT m.*, l.name, l.phone, l.event_type, u.phone AS host_phone, u.id AS host_id
     FROM meetings m JOIN leads l ON l.id = m.lead_id LEFT JOIN users u ON u.id = m.host_user_id
     WHERE m.id = $1`, [meetingId]);
  const m = rows[0];
  if (!m) return null;
  if (m.customer_status === status) return m; // idempotent (button pressed twice / link reopened)

  await pool.query(
    `UPDATE meetings SET customer_status = $1, customer_status_at = NOW(), customer_status_source = $2,
       confirmed_at = CASE WHEN $1 = 'confirmed' THEN COALESCE(confirmed_at, NOW()) ELSE NULL END
     WHERE id = $3`, [status, source, meetingId]);

  const when = `${fmtDay(m.start_time)} ${fmtDate(m.start_time)} ${fmtTime(m.start_time)}`;
  await logNote(m.lead_id, status === 'confirmed'
    ? `✅ הלקוח אישר הגעה לפגישה (${when})`
    : `❌ הלקוח הודיע שלא יגיע לפגישה (${when})`);

  // Google Calendar: ✅ / ❌ in the title, grey when declined
  try {
    const { markMeetingCustomerStatus } = require('./calendarService');
    if (m.google_event_id) await markMeetingCustomerStatus(m.google_event_id, status);
  } catch (e) { console.error('[MeetingRSVP] calendar mark failed:', e.message); }

  // Host: a decline is urgent — tell them now
  if (status === 'declined' && m.host_phone) {
    await sendWhatsApp(m.host_phone,
      `❌ ${m.name || 'הלקוח'} ביטל/ה את הפגישה ${when} – לתאם מועד חדש${m.phone ? `\n📞 ${m.phone}` : ''}\n🔗 ${baseUrl()}/?lead=${m.lead_id}&src=wa`);
  }
  return { ...m, customer_status: status };
}

// Button click / link / text from the customer. Returns true when it was handled as an RSVP.
// phone: sender phone; text: message text (for plain-text answers); buttonId: Green API button id.
async function handleInboundReply({ phone, text = '', buttonId = null }) {
  try {
    // Button ids carry the meeting id
    let m = buttonId && /^meet_(\d+)_(yes|no)$/.exec(buttonId);
    if (m) {
      const meeting = await setCustomerStatus(Number(m[1]), m[2] === 'yes' ? 'confirmed' : 'declined', 'button');
      if (meeting?.phone) await sendText(meeting.phone, m[2] === 'yes' ? 'מעולה, נתראה! 🙂' : 'חבל 🙁 נחזור אליכם לתיאום מועד חדש.');
      return true;
    }
    // Plain text: only right after a reminder, for a meeting that is still unanswered
    const t = (text || '').trim();
    if (!t || t.length > 60) return false;
    const yes = /^(✅|👍)?\s*(כן|מגיע|מגיעה|מגיעים|אגיע|נגיע|מאשר|מאשרת|מאשרים|בטח|סבבה|יאללה|אוקי|אוקיי|ok|yes)\b/i.test(t) && !/לא/.test(t);
    const no  = /(לא (מגיע|מגיעה|מגיעים|אגיע|נגיע|אוכל|נוכל|יכול|יכולה|נצליח)|לבטל|מבטל|מבטלת|מבטלים|ביטול|❌)/.test(t);
    if (!yes && !no) return false;
    const digits = phone.replace(/\D/g, '').replace(/^972/, '0');
    const { rows } = await pool.query(
      `SELECT m.id FROM meetings m JOIN leads l ON l.id = m.lead_id
       WHERE m.reminder_sent_at >= NOW() - INTERVAL '2 days' AND m.start_time > NOW() - INTERVAL '2 hours'
         AND m.customer_status IS NULL
         AND (REGEXP_REPLACE(l.phone, '[^0-9]', '', 'g') LIKE '%' || $1
              OR EXISTS (SELECT 1 FROM lead_contacts lc WHERE lc.lead_id = l.id AND lc.type = 'phone'
                           AND REGEXP_REPLACE(lc.value, '[^0-9]', '', 'g') LIKE '%' || $1))
       ORDER BY m.start_time ASC LIMIT 1`, [digits.slice(-9)]);
    if (!rows.length) return false;
    const meeting = await setCustomerStatus(rows[0].id, no ? 'declined' : 'confirmed', 'text');
    if (meeting?.phone) await sendText(meeting.phone, no ? 'חבל 🙁 נחזור אליכם לתיאום מועד חדש.' : 'מעולה, נתראה! 🙂');
    return true;
  } catch (err) {
    console.error('[MeetingRSVP] inbound reply error:', err.message);
    return false;
  }
}

// ---- The 15-minute tick -----------------------------------------------------------------
async function runMeetingReminderTick() {
  const now = new Date();
  const { date: today, hour } = ilParts(now);
  const b = baseUrl();

  // 1. Customer day-before (or short-notice) reminder
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.start_time FROM meetings m JOIN leads l ON l.id = m.lead_id
       WHERE m.reminder_sent_at IS NULL AND l.phone IS NOT NULL
         AND m.start_time > NOW() AND m.start_time <= NOW() + INTERVAL '2 days'`);
    for (const r of rows) {
      if (!customerReminderDue(r.start_time, now)) continue;
      await sendCustomerReminder(r.id);
      await new Promise(res => setTimeout(res, 4000));
    }
  } catch (err) { console.error('[MeetingRSVP] tick/customer error:', err.message); }

  // 2. Customer day-of reminder (09:00+, no buttons; not if declined; not if message 1 was sent today)
  if (hour >= DAY_OF_HOUR) {
    try {
      const { rows } = await pool.query(
        `SELECT m.*, l.name, l.phone FROM meetings m JOIN leads l ON l.id = m.lead_id
         WHERE m.dayof_reminder_sent_at IS NULL AND l.phone IS NOT NULL
           AND m.start_time > NOW() AND m.start_time <= NOW() + INTERVAL '1 day'
           AND COALESCE(m.customer_status, '') <> 'declined'`);
      for (const m of rows) {
        if (ilDate(m.start_time) !== today) continue;
        if (m.reminder_sent_at && ilDate(m.reminder_sent_at) === today) {
          await pool.query('UPDATE meetings SET dayof_reminder_sent_at = NOW() WHERE id = $1', [m.id]);
          continue;
        }
        const claim = await pool.query('UPDATE meetings SET dayof_reminder_sent_at = NOW() WHERE id = $1 AND dayof_reminder_sent_at IS NULL RETURNING id', [m.id]);
        if (!claim.rows.length) continue;
        try {
          await sendText(m.phone, dayOfText(m));
          await logOutbound(m.lead_id, dayOfText(m));
        } catch (err) {
          console.error(`[MeetingRSVP] day-of reminder failed for meeting ${m.id}:`, err.message);
          await pool.query('UPDATE meetings SET dayof_reminder_sent_at = NULL WHERE id = $1', [m.id]);
        }
        await new Promise(res => setTimeout(res, 4000));
      }
    } catch (err) { console.error('[MeetingRSVP] tick/day-of error:', err.message); }
  }

  // 3. Host day-before reminder (within 24h), with the customer's status
  try {
    const { rows } = await pool.query(
      `SELECT m.*, l.name, l.event_type, l.phone AS lead_phone, u.phone AS host_phone
       FROM meetings m JOIN leads l ON l.id = m.lead_id JOIN users u ON u.id = m.host_user_id
       WHERE m.host_reminder_sent_at IS NULL
         AND m.start_time > NOW() AND m.start_time <= NOW() + INTERVAL '1 day'
         AND u.phone IS NOT NULL AND NOT COALESCE(u.blocked, false)`);
    for (const m of rows) {
      const claim = await pool.query('UPDATE meetings SET host_reminder_sent_at = NOW() WHERE id = $1 AND host_reminder_sent_at IS NULL RETURNING id', [m.id]);
      if (!claim.rows.length) continue;
      const when = ilDate(m.start_time) === today ? 'היום' : `${fmtDay(m.start_time)} ${fmtDate(m.start_time)}`;
      await sendWhatsApp(m.host_phone,
        `⏰ תזכורת: ${when} בשעה ${fmtTime(m.start_time)} יש לך פגישה עם ${m.name || 'לקוח'}${m.event_type ? ` (${m.event_type})` : ''} בשרביה\n${statusLine(m)}${m.lead_phone ? `\n📞 ${m.lead_phone}` : ''}\n🔗 ${b}/?lead=${m.lead_id}&src=wa`);
    }
  } catch (err) { console.error('[MeetingRSVP] tick/host error:', err.message); }

  // 4. Host nudge on the meeting day (09:00+) when the customer never answered
  if (hour >= DAY_OF_HOUR) {
    try {
      const { rows } = await pool.query(
        `SELECT m.*, l.name, l.phone AS lead_phone, u.phone AS host_phone
         FROM meetings m JOIN leads l ON l.id = m.lead_id JOIN users u ON u.id = m.host_user_id
         WHERE m.host_nudge_sent_at IS NULL AND m.customer_status IS NULL AND m.reminder_sent_at IS NOT NULL
           AND m.start_time > NOW() AND m.start_time <= NOW() + INTERVAL '1 day'
           AND u.phone IS NOT NULL AND NOT COALESCE(u.blocked, false)`);
      for (const m of rows) {
        if (ilDate(m.start_time) !== today) continue;
        const claim = await pool.query('UPDATE meetings SET host_nudge_sent_at = NOW() WHERE id = $1 AND host_nudge_sent_at IS NULL RETURNING id', [m.id]);
        if (!claim.rows.length) continue;
        await sendWhatsApp(m.host_phone,
          `📞 ${m.name || 'הלקוח'} לא אישר/ה הגעה לפגישה היום ב-${fmtTime(m.start_time)} – כדאי להתקשר ולהזכיר${m.lead_phone ? `\n📞 ${m.lead_phone}` : ''}\n🔗 ${b}/?lead=${m.lead_id}&src=wa`);
      }
    } catch (err) { console.error('[MeetingRSVP] tick/nudge error:', err.message); }
  }
}

// After a (re)booking: send the customer reminder now when the meeting is today / tomorrow-after-10:00
async function maybeSendShortNoticeReminder(meetingId) {
  const { rows } = await pool.query('SELECT start_time, reminder_sent_at FROM meetings WHERE id = $1', [meetingId]);
  const m = rows[0];
  if (!m || m.reminder_sent_at || !customerReminderDue(m.start_time)) return false;
  return sendCustomerReminder(meetingId);
}

// Reschedule: the flow starts over for the new date
async function resetForReschedule(googleEventId) {
  await pool.query(
    `UPDATE meetings SET reminder_sent_at = NULL, dayof_reminder_sent_at = NULL, host_reminder_sent_at = NULL,
       host_nudge_sent_at = NULL, customer_status = NULL, customer_status_at = NULL, customer_status_source = NULL,
       confirmed_at = NULL
     WHERE google_event_id = $1`, [googleEventId]);
}

module.exports = {
  runMeetingReminderTick, sendCustomerReminder, maybeSendShortNoticeReminder, resetForReschedule,
  setCustomerStatus, handleInboundReply, dayBeforeText, dayOfText, STATUS_HE,
};
