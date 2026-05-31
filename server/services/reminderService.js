const pool   = require('../db/pool');
const axios  = require('axios');
const jwt    = require('jsonwebtoken');
const { OpenAI } = require('openai');

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
    // 5-second gap between reminder sends to avoid WhatsApp rate limiting
    await new Promise(r => setTimeout(r, 5000));
  } catch (err) {
    console.error(`[Reminder] WhatsApp send failed to ${phone}:`, err.message);
  }
}

async function generateLeadSummary(leadId, leadName, stage) {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return null;
    const client = new OpenAI({ apiKey: key });

    const { rows: interactions } = await pool.query(
      `SELECT direction, body FROM lead_interactions WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [leadId]
    );
    const { rows: messages } = await pool.query(
      `SELECT direction, body FROM messages WHERE lead_id = $1 ORDER BY timestamp DESC LIMIT 3`,
      [leadId]
    );

    const history = [
      ...interactions.map(r => `[${r.direction === 'inbound' ? 'לקוח' : 'צוות'}]: ${r.body}`),
      ...messages.map(r => `[${r.direction === 'inbound' ? 'לקוח' : 'צוות'}]: ${r.body}`),
    ].join('\n');

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: `סכם את מצב הליד "${leadName}" (שלב: ${stage}) ב-3 שורות קצרות בעברית בלבד.\nהיסטוריה:\n${history || '(אין היסטוריה)'}\n\nכתוב בדיוק 3 שורות, כל שורה בשורה חדשה.`,
      }],
    });

    return completion.choices[0].message.content.trim();
  } catch (err) {
    console.error('[Reminder] generateLeadSummary failed:', err.message);
    return null;
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
      SELECT t.id, t.title, t.lead_id, l.name AS lead_name, l.phone AS lead_phone, l.stage AS lead_stage,
             u.phone AS user_phone, u.display_name
      FROM tasks t
      JOIN leads l ON l.id = t.lead_id
      LEFT JOIN users u ON u.id = t.assigned_to
      WHERE t.completed_at IS NULL
        AND t.due_at BETWEEN NOW() - INTERVAL '1 hour' AND NOW() + INTERVAL '2 minutes'
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

      const actionToken = jwt.sign(
        { taskId: task.id, type: 'postpone' },
        process.env.JWT_SECRET,
        { expiresIn: '48h' }
      );
      const actionUrl = `${baseUrl}/task-action/${task.id}?token=${actionToken}`;

      const summary = await generateLeadSummary(task.lead_id, task.lead_name, task.lead_stage);
      const summaryBlock = summary ? `---\n${summary}\n---\n` : '';
      const phoneBlock = task.lead_phone ? `📞 ${task.lead_phone}\n` : '';

      await sendWhatsApp(
        task.user_phone,
        `⏰ תזכורת משימה: "${task.title}" - ${task.lead_name}\n${phoneBlock}${summaryBlock}לפתיחת הליד: ${baseUrl}/?lead=${task.lead_id}\nפעולות (הושלם / דחייה / המשך): ${actionUrl}`
      );
    }

    if (noContact.rows.length + offerStale.rows.length + contractStale.rows.length + dueTasks.rows.length > 0) {
      console.log(`[Reminders] Sent: ${noContact.rows.length} no-contact, ${offerStale.rows.length} offer, ${contractStale.rows.length} contract, ${dueTasks.rows.length} task reminders`);
    }
  } catch (err) {
    console.error('[Reminders] Error:', err.message);
  }

  // Op-reminders: separate try/catch so errors here don't block the main flow
  try {
    // Ensure columns exist (idempotent, runs once per server lifetime via flag)
    await pool.query(`ALTER TABLE op_reminders ADD COLUMN IF NOT EXISTS due_time TEXT`).catch(() => {});
    await pool.query(`ALTER TABLE op_reminders ADD COLUMN IF NOT EXISTS remind_sent_at TIMESTAMPTZ`).catch(() => {});

    const dueOpReminders = await pool.query(`
      SELECT r.id, r.title, r.entity_type, r.due_date, r.due_time,
             COALESCE(ua.phone, uc.phone)               AS user_phone,
             COALESCE(ua.display_name, uc.display_name) AS display_name
      FROM op_reminders r
      LEFT JOIN users ua ON ua.id = r.assigned_to
      LEFT JOIN users uc ON uc.id = r.created_by
      WHERE r.done = false
        AND r.remind_sent_at IS NULL
        AND COALESCE(ua.phone, uc.phone) IS NOT NULL
        AND r.due_date IS NOT NULL
        AND (
          r.due_date < CURRENT_DATE
          OR (
            r.due_date = CURRENT_DATE
            AND (
              r.due_time IS NULL
              OR r.due_time <= TO_CHAR(NOW() AT TIME ZONE 'Asia/Jerusalem', 'HH24:MI')
            )
          )
        )
    `);

    for (const rem of dueOpReminders.rows) {
      const claim = await pool.query(
        `UPDATE op_reminders SET remind_sent_at = NOW()
         WHERE id = $1 AND remind_sent_at IS NULL RETURNING id`,
        [rem.id]
      );
      if (!claim.rows.length) continue;

      const typeLabel = rem.entity_type === 'task' ? 'משימה' : rem.entity_type === 'fault' ? 'תקלה' : 'תחזוקה';
      const timeStr = rem.due_time ? ` בשעה ${rem.due_time}` : '';
      await sendWhatsApp(
        rem.user_phone,
        `⏰ תזכורת תפעול: "${rem.title}"\n${typeLabel}${timeStr}`
      );
    }

    if (dueOpReminders.rows.length > 0) {
      console.log(`[Reminders] Sent: ${dueOpReminders.rows.length} op reminders`);
    }
  } catch (err) {
    console.error('[Reminders] Op-reminders error:', err.message);
  }
}

module.exports = { runReminders, sendWhatsApp };
