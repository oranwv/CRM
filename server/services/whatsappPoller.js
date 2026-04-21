const axios = require('axios');
const pool  = require('../db/pool');

const BASE  = () => `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}`;
const TOKEN = () => process.env.GREEN_API_TOKEN;

function formatPhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return '972' + digits.slice(1);
  return digits;
}

async function findOrCreateLead(phone, name, messageBody) {
  const clean = formatPhone(phone);
  if (!clean) return null;
  const { rows } = await pool.query(
    `SELECT id FROM leads WHERE
      CASE WHEN REGEXP_REPLACE(phone,'[^0-9]','','g') LIKE '0%'
        THEN '972' || SUBSTRING(REGEXP_REPLACE(phone,'[^0-9]','','g'),2)
        ELSE REGEXP_REPLACE(phone,'[^0-9]','','g')
      END = $1 LIMIT 1`,
    [clean]
  );
  if (rows.length) return rows[0].id;
  const { rows: newRows } = await pool.query(
    `INSERT INTO leads (name, phone, source, stage, notes) VALUES ($1,$2,'whatsapp','new',$3) RETURNING id`,
    [name || 'ליד חדש מוואטסאפ', clean, `הודעה ראשונה: ${messageBody}`]
  );
  return newRows[0].id;
}

async function processNotification(notification) {
  const body = notification.body;
  if (!body || body.typeWebhook !== 'incomingMessageReceived') return;

  const msg = body.messageData;
  if (!msg) return;

  let text = '';
  if (msg.typeMessage === 'textMessage') {
    text = msg.textMessageData?.textMessage || '';
  } else if (msg.typeMessage === 'extendedTextMessage') {
    text = msg.extendedTextMessageData?.text || '';
  } else {
    return; // ignore media/other for now
  }

  const chatId      = body.senderData?.chatId || body.senderData?.sender || '';
  if (chatId.endsWith('@g.us')) return; // ignore group messages

  const senderPhone = body.senderData?.sender?.replace('@c.us', '');
  const senderName  = body.senderData?.senderName || null;
  const externalId  = body.idMessage;

  const { rows: dup } = await pool.query('SELECT id FROM messages WHERE external_id = $1', [externalId]);
  if (dup.length) return;

  const leadId = await findOrCreateLead(senderPhone, senderName, text);
  if (!leadId) return;

  await pool.query(
    `INSERT INTO messages (lead_id, channel, direction, body, external_id, timestamp, is_read)
     VALUES ($1,'whatsapp','inbound',$2,$3,NOW(),false)`,
    [leadId, text, externalId]
  );
  await pool.query('UPDATE leads SET updated_at = NOW() WHERE id = $1', [leadId]);
  console.log(`[WhatsApp] Inbound from ${senderPhone} → lead ${leadId}: ${text.slice(0, 50)}`);
}

async function pollWhatsApp() {
  while (true) {
    try {
      const res = await axios.get(`${BASE()}/receiveNotification/${TOKEN()}`, { timeout: 25000 });
      const notification = res.data;
      if (!notification || !notification.receiptId) continue; // null = no queued messages, long-poll again

      try {
        await processNotification(notification);
      } catch (err) {
        console.error('[WhatsApp] processNotification error:', err.message);
      }

      await axios.delete(`${BASE()}/deleteNotification/${TOKEN()}/${notification.receiptId}`);
    } catch (err) {
      if (err.code !== 'ECONNABORTED') {
        console.error('[WhatsApp] poll error:', err.message);
      }
      await new Promise(r => setTimeout(r, 2000)); // brief pause before retrying on error
    }
  }
}

module.exports = { pollWhatsApp };
