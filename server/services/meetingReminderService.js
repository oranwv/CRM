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

module.exports = { sendMeetingReminders };
