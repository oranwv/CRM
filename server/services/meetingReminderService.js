const pool  = require('../db/pool');
const axios = require('axios');

async function sendMeetingReminders() {
  try {
    const { rows } = await pool.query(`
      SELECT m.*, l.phone, l.name
      FROM meetings m
      JOIN leads l ON l.id = m.lead_id
      WHERE m.reminder_sent_at IS NULL
        AND m.confirmed_at IS NULL
        AND m.start_time > NOW() + INTERVAL '1 day'
        AND m.start_time <= NOW() + INTERVAL '2 days'
        AND l.phone IS NOT NULL
    `);

    if (!rows.length) return;

    const baseUrl = process.env.SERVER_URL || 'http://localhost:3001';

    for (const meeting of rows) {
      // Atomic claim — prevents duplicate sends
      const claim = await pool.query(
        `UPDATE meetings SET reminder_sent_at = NOW() WHERE id = $1 AND reminder_sent_at IS NULL RETURNING id`,
        [meeting.id]
      );
      if (!claim.rows.length) continue;

      const dt      = new Date(meeting.start_time);
      const dateStr = dt.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jerusalem' });
      const timeStr = dt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem', hour12: false });

      const confirmUrl = `${baseUrl}/api/calendar/meetings/${meeting.confirm_token}/confirm`;
      const message = `היי, זוהי תזכורת על פגישתך בשרביה בתאריך ${dateStr} בשעה ${timeStr}. אנא אשר כי אתה מגיע בלינק הבא:\n${confirmUrl}\n\nבברכה, צוות שרביה`;

      const chatId = meeting.phone.replace(/\D/g, '').replace(/^0/, '972') + '@c.us';
      try {
        await axios.post(
          `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/sendMessage/${process.env.GREEN_API_TOKEN}`,
          { chatId, message }
        );
        console.log(`[MeetingReminder] Sent reminder to ${meeting.name} (${meeting.phone})`);
      } catch (err) {
        console.error(`[MeetingReminder] WhatsApp failed for meeting ${meeting.id}:`, err.message);
        // Roll back reminder_sent_at so it retries next hour
        await pool.query('UPDATE meetings SET reminder_sent_at = NULL WHERE id = $1', [meeting.id]);
      }

      await new Promise(r => setTimeout(r, 5000));
    }
  } catch (err) {
    console.error('[MeetingReminder] Error:', err.message);
  }
}

// Internal reminder to the staff member who holds the meeting (host), the day before.
// Independent of the customer's reminder/confirmation.
async function sendHostMeetingReminders() {
  try {
    const { rows } = await pool.query(`
      SELECT m.id, m.start_time, m.end_time, l.id AS lead_id, l.name, l.event_type, l.phone AS lead_phone,
             u.phone AS host_phone
      FROM meetings m
      JOIN leads l ON l.id = m.lead_id
      JOIN users u ON u.id = m.host_user_id
      WHERE m.host_reminder_sent_at IS NULL
        AND m.start_time > NOW()
        AND m.start_time <= NOW() + INTERVAL '1 day'
        AND u.phone IS NOT NULL AND NOT COALESCE(u.blocked, false)
    `);
    if (!rows.length) return;
    const baseUrl = process.env.SERVER_URL || 'http://localhost:3001';
    for (const m of rows) {
      const claim = await pool.query(
        'UPDATE meetings SET host_reminder_sent_at = NOW() WHERE id = $1 AND host_reminder_sent_at IS NULL RETURNING id', [m.id]);
      if (!claim.rows.length) continue;
      const s = new Date(m.start_time);
      const day  = s.toLocaleDateString('he-IL', { weekday: 'long', timeZone: 'Asia/Jerusalem' });
      const date = s.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Jerusalem' });
      const time = s.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem', hour12: false });
      const message = `⏰ תזכורת: ${day} ${date} בשעה ${time} יש לך פגישה עם ${m.name || 'לקוח'}${m.event_type ? ` (${m.event_type})` : ''} בשרביה${m.lead_phone ? `\n📞 ${m.lead_phone}` : ''}\n🔗 ${baseUrl}/?lead=${m.lead_id}&src=wa`;
      const chatId = m.host_phone.replace(/\D/g, '').replace(/^0/, '972') + '@c.us';
      try {
        await axios.post(
          `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/sendMessage/${process.env.GREEN_API_TOKEN}`,
          { chatId, message }
        );
      } catch (err) {
        console.error(`[MeetingReminder] host WhatsApp failed for meeting ${m.id}:`, err.message);
        await pool.query('UPDATE meetings SET host_reminder_sent_at = NULL WHERE id = $1', [m.id]);
      }
      await new Promise(r => setTimeout(r, 5000));
    }
  } catch (err) {
    console.error('[MeetingReminder] host reminders error:', err.message);
  }
}

module.exports = { sendMeetingReminders, sendHostMeetingReminders };
