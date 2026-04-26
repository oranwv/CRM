const pool  = require('../db/pool');
const axios = require('axios');

function formatPhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return '972' + digits.slice(1);
  return digits;
}

async function findLeadByPhone(phone) {
  const clean = formatPhone(phone);
  if (!clean) return null;

  const { rows } = await pool.query(
    'SELECT id FROM leads WHERE REGEXP_REPLACE(phone, $1, $2) = $3 LIMIT 1',
    ['\\D', '', clean]
  );
  if (rows.length) return rows[0].id;

  const { rows: byContact } = await pool.query(
    `SELECT lead_id FROM lead_contacts
     WHERE type = 'phone' AND REGEXP_REPLACE(value, '\\D', '', 'g') = $1
     LIMIT 1`,
    [clean]
  );
  return byContact.length ? byContact[0].lead_id : null;
}

async function findOrCreateLead(phone, name, previewText) {
  const clean = formatPhone(phone);
  if (!clean) return null;

  const existing = await findLeadByPhone(phone);
  if (existing) return existing;

  const { rows } = await pool.query(
    `INSERT INTO leads (name, phone, source, stage, notes)
     VALUES ($1, $2, 'whatsapp', 'new', $3) RETURNING id`,
    [name || 'ליד חדש מוואטסאפ', clean, `הודעה ראשונה: ${previewText}`]
  );
  return rows[0].id;
}

function extractText(msg) {
  if (msg.textMessageData?.textMessage) return msg.textMessageData.textMessage;
  if (msg.extendedTextMessageData?.text) return msg.extendedTextMessageData.text;
  if (msg.imageMessageData?.caption) return msg.imageMessageData.caption;
  if (msg.fileMessageData?.caption) return msg.fileMessageData.caption;
  return `[${msg.typeMessage || 'message'}]`;
}

async function syncWhatsAppMessages() {
  const { GREEN_API_URL, GREEN_API_INSTANCE, GREEN_API_TOKEN } = process.env;
  if (!GREEN_API_URL || !GREEN_API_INSTANCE || !GREEN_API_TOKEN) return;

  const base    = `${GREEN_API_URL}/waInstance${GREEN_API_INSTANCE}`;
  const minutes = 1440; // 24 hours
  let recovered = 0;

  try {
    // --- Incoming ---
    const { data: incoming } = await axios.get(
      `${base}/lastIncomingMessages/${GREEN_API_TOKEN}?minutes=${minutes}`,
      { timeout: 15000 }
    );

    for (const msg of incoming || []) {
      if (msg.chatId?.endsWith('@g.us')) continue; // skip groups

      const { rows: dup } = await pool.query(
        'SELECT id FROM messages WHERE external_id = $1', [msg.idMessage]
      );
      if (dup.length) continue;

      const senderPhone = (msg.senderId || msg.chatId || '').replace('@c.us', '');
      const text        = extractText(msg);
      const ts          = msg.timestamp ? new Date(msg.timestamp * 1000) : new Date();

      const leadId = await findOrCreateLead(senderPhone, msg.senderName, text);
      if (!leadId) continue;

      await pool.query(
        `INSERT INTO messages (lead_id, channel, direction, body, external_id, timestamp, is_read, contact_value)
         VALUES ($1, 'whatsapp', 'inbound', $2, $3, $4, false, $5)`,
        [leadId, text, msg.idMessage, ts, senderPhone]
      );
      await pool.query('UPDATE leads SET updated_at = $1 WHERE id = $2', [ts, leadId]);
      recovered++;
    }

    // --- Outgoing ---
    const { data: outgoing } = await axios.get(
      `${base}/lastOutgoingMessages/${GREEN_API_TOKEN}?minutes=${minutes}`,
      { timeout: 15000 }
    );

    for (const msg of outgoing || []) {
      if (msg.chatId?.endsWith('@g.us')) continue;

      const { rows: dup } = await pool.query(
        'SELECT id FROM messages WHERE external_id = $1', [msg.idMessage]
      );
      if (dup.length) continue;

      const recipientPhone = formatPhone((msg.chatId || '').replace('@c.us', ''));
      if (!recipientPhone) continue;

      // Only attach to existing leads — don't create new ones for outgoing
      const leadId = await findLeadByPhone(recipientPhone);
      if (!leadId) continue;

      const text = extractText(msg);
      const ts   = msg.timestamp ? new Date(msg.timestamp * 1000) : new Date();

      await pool.query(
        `INSERT INTO messages (lead_id, channel, direction, body, external_id, timestamp, contact_value)
         VALUES ($1, 'whatsapp', 'outbound', $2, $3, $4, $5)`,
        [leadId, text, msg.idMessage, ts, recipientPhone]
      );
      recovered++;
    }

    if (recovered > 0) {
      console.log(`[WaSync] Recovered ${recovered} missed WhatsApp message(s)`);
    }
  } catch (err) {
    console.error('[WaSync] Sync error:', err.message);
  }
}

module.exports = { syncWhatsAppMessages };
