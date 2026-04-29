const pool  = require('../db/pool');
const axios = require('axios');
const { normalizePhone, findLeadByPhone } = require('../utils/phoneUtils');

async function findOrCreateLead(phone, name, previewText) {
  const clean = normalizePhone(phone);
  if (!clean) return null;

  const existing = await findLeadByPhone(pool, clean);
  if (existing) return existing;

  const leadName = name || 'ליד חדש מוואטסאפ';
  const { rows } = await pool.query(
    `INSERT INTO leads (name, phone, source, stage, notes, event_name)
     VALUES ($1, $2, 'whatsapp', 'new', $3, $4) RETURNING id`,
    [leadName, clean, `הודעה ראשונה: ${previewText}`, leadName]
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

      const recipientPhone = normalizePhone((msg.chatId || '').replace('@c.us', ''));
      if (!recipientPhone) continue;

      // Only attach to existing leads — don't create new ones for outgoing
      const leadId = await findLeadByPhone(pool, recipientPhone);
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
