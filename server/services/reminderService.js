const pool = require('../db/pool');
const axios = require('axios');
const jwt   = require('jsonwebtoken');

const GREEN_API_URL      = process.env.GREEN_API_URL;
const GREEN_API_INSTANCE = process.env.GREEN_API_INSTANCE;
const GREEN_API_TOKEN    = process.env.GREEN_API_TOKEN;

async function sendWhatsApp(phone, message) {
  try {
    const chatId = phone.replace(/\D/g, '').replace(/^0/, '972') + '@c.us';
    await axios.post(
      `${GREEN_API_URL}/waInstance${GREEN_API_INSTANCE}/sendMessage/${GREEN_API_TOKEN}`,
      { chatId, message }
    );
  } catch (err) {
    console.error(`[Reminder] WhatsApp send failed to ${phone}:`, err.message);
  }
}

async function runReminders() {
  try {
    const now = new Date();

    // 1. New lead — no interaction in 24h → remind assigned user
    const noContact = await pool.query(`
      SELECT l.id, l.name, l.phone, l.source, u.phone AS user_phone, u.display_name
      FROM leads l
      LEFT JOIN users u ON u.id = l.assigned_to
      WHERE l.stage = 'new'
        AND l.created_at < NOW() - INTERVAL '24 hours'
        AND NOT EXISTS (
          SELECT 1 FROM lead_interactions li WHERE li.lead_id = l.id
        )
        AND u.phone IS NOT NULL
    `);

    for (const lead of noContact.rows) {
      await sendWhatsApp(
        lead.user_phone,
        `🔔 תזכורת: הליד "${lead.name}" (${lead.phone || lead.source}) נכנס לפני יותר מ-24 שעות ועדיין לא טופל.`
      );
      // Log reminder as interaction so it doesn't fire again
      await pool.query(
        `INSERT INTO lead_interactions (lead_id, type, direction, body) VALUES ($1, 'note', 'outbound', $2)`,
        [lead.id, '[תזכורת אוטומטית] נשלחה תזכורת לאחראי - אין קשר ב-24 שעות']
      );
    }

    // 2. Offer sent — no interaction in 3 days
    const offerStale = await pool.query(`
      SELECT l.id, l.name, l.phone, u.phone AS user_phone
      FROM leads l
      LEFT JOIN users u ON u.id = l.assigned_to
      WHERE l.stage = 'offer_sent'
        AND l.updated_at < NOW() - INTERVAL '3 days'
        AND NOT EXISTS (
          SELECT 1 FROM lead_interactions li
          WHERE li.lead_id = l.id AND li.created_at > NOW() - INTERVAL '3 days'
        )
        AND u.phone IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM lead_interactions li
          WHERE li.lead_id = l.id
            AND li.body LIKE '%תזכורת אוטומטית%הצעת מחיר%'
            AND li.created_at > NOW() - INTERVAL '3 days'
        )
    `);

    for (const lead of offerStale.rows) {
      await sendWhatsApp(
        lead.user_phone,
        `📋 תזכורת: הצעת מחיר נשלחה ללקוח "${lead.name}" לפני 3 ימים ועדיין אין מענה.`
      );
      await pool.query(
        `INSERT INTO lead_interactions (lead_id, type, direction, body) VALUES ($1, 'note', 'outbound', $2)`,
        [lead.id, '[תזכורת אוטומטית] הצעת מחיר - אין מענה 3 ימים']
      );
    }

    // 3. Contract sent — no response in 5 days
    const contractStale = await pool.query(`
      SELECT l.id, l.name, l.phone, u.phone AS user_phone
      FROM leads l
      LEFT JOIN users u ON u.id = l.assigned_to
      WHERE l.stage = 'contract_sent'
        AND l.updated_at < NOW() - INTERVAL '5 days'
        AND u.phone IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM lead_interactions li
          WHERE li.lead_id = l.id
            AND li.body LIKE '%תזכורת אוטומטית%חוזה%'
            AND li.created_at > NOW() - INTERVAL '5 days'
        )
    `);

    for (const lead of contractStale.rows) {
      await sendWhatsApp(
        lead.user_phone,
        `📝 תזכורת: חוזה נשלח ל"${lead.name}" לפני 5 ימים ועדיין לא נחתם.`
      );
      await pool.query(
        `INSERT INTO lead_interactions (lead_id, type, direction, body) VALUES ($1, 'note', 'outbound', $2)`,
        [lead.id, '[תזכורת אוטומטית] חוזה - אין חתימה 5 ימים']
      );
    }

    // 4. Due tasks — notify assigned user
    const baseUrl = process.env.SERVER_URL || 'https://crm-production-c3df.up.railway.app';
    console.log('[Reminders] baseUrl:', baseUrl);

    const dueTasks = await pool.query(`
      SELECT t.id, t.title, t.lead_id, l.name AS lead_name,
             u.phone AS user_phone, u.display_name
      FROM tasks t
      JOIN leads l ON l.id = t.lead_id
      LEFT JOIN users u ON u.id = t.assigned_to
      WHERE t.completed_at IS NULL
        AND t.due_at BETWEEN NOW() - INTERVAL '1 hour' AND NOW() + INTERVAL '30 minutes'
        AND t.remind_via = 'whatsapp'
        AND t.remind_sent_at IS NULL
        AND u.phone IS NOT NULL
    `);

    for (const task of dueTasks.rows) {
      // Atomically claim the task — prevents duplicates if multiple instances run simultaneously
      const claim = await pool.query(
        `UPDATE tasks SET remind_sent_at = NOW()
         WHERE id = $1 AND remind_sent_at IS NULL
         RETURNING id`,
        [task.id]
      );
      if (!claim.rows.length) continue; // another instance already claimed it

      const postponeToken = jwt.sign(
        { taskId: task.id, type: 'postpone' },
        process.env.JWT_SECRET,
        { expiresIn: '48h' }
      );
      const postponeUrl = `${baseUrl}/postpone/${task.id}?token=${postponeToken}`;

      await sendWhatsApp(
        task.user_phone,
        `⏰ תזכורת משימה: "${task.title}" עבור הליד "${task.lead_name}" - עכשיו!\n🔗 ${baseUrl}/?lead=${task.lead_id}\n⏩ דחה משימה: ${postponeUrl}`
      );
    }

    if (noContact.rows.length + offerStale.rows.length + contractStale.rows.length + dueTasks.rows.length > 0) {
      console.log(`[Reminders] Sent: ${noContact.rows.length} no-contact, ${offerStale.rows.length} offer, ${contractStale.rows.length} contract, ${dueTasks.rows.length} task reminders`);
    }
  } catch (err) {
    console.error('[Reminders] Error:', err.message);
  }
}

module.exports = { runReminders };
