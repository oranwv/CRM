const axios = require('axios');
const fs    = require('fs');
const os    = require('os');
const path  = require('path');
const pool  = require('../db/pool');
const { uploadFile } = require('./storageService');

function mediaMimeToExt(mime) {
  const map = { 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','audio/ogg':'ogg','audio/mpeg':'mp3','application/pdf':'pdf' };
  return map[mime] || 'bin';
}

async function saveInboundMedia(msg, leadId, externalId) {
  const d = msg.imageMessageData || msg.fileMessageData || {};
  const mediaUrl = d.downloadUrl || d.url || null;
  if (!mediaUrl) return { text: d.caption || `[${msg.typeMessage}]` };

  const caption  = d.caption || '';
  const mime     = d.mimeType || 'application/octet-stream';
  const fileName = d.fileName || `media_${externalId}.${mediaMimeToExt(mime)}`;
  const tmpPath  = path.join(os.tmpdir(), `wa_in_${externalId}`);

  try {
    const { data } = await axios.get(mediaUrl, { responseType: 'arraybuffer', timeout: 30000 });
    fs.writeFileSync(tmpPath, Buffer.from(data));
    const { storedName } = await uploadFile(tmpPath, fileName, mime);
    fs.unlinkSync(tmpPath);
    const { rows } = await pool.query(
      `INSERT INTO files (lead_id, filename, url, stored_name, file_type, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,NULL) RETURNING id`,
      [leadId, fileName, '', storedName, mime]
    );
    const marker = `[[FILE:${rows[0].id}|${fileName}]]`;
    return { text: caption ? `${caption}\n${marker}` : marker };
  } catch (err) {
    console.error('[WhatsApp] media download error:', err.message);
    try { fs.unlinkSync(tmpPath); } catch {}
    return { text: caption || `[${msg.typeMessage}]` };
  }
}

const BASE  = () => `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}`;
const TOKEN = () => process.env.GREEN_API_TOKEN;

function formatPhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return '972' + digits.slice(1);
  return digits;
}

async function fetchContactInfo(chatId) {
  try {
    const res = await axios.post(
      `${BASE()}/getContactInfo/${TOKEN()}`,
      { chatId },
      { timeout: 8000 }
    );
    const d = res.data || {};
    const name   = (d.name || d.pushname || '').replace(/@c\.us$/, '').trim() || null;
    const avatar = d.avatar || d.urlAvatar || null;
    return { name, avatar };
  } catch {
    return { name: null, avatar: null };
  }
}

async function findOrCreateLead(phone, senderName, messageBody, chatId) {
  const clean = formatPhone(phone);
  if (!clean) return null;
  const { rows } = await pool.query(
    `SELECT id, avatar_url FROM leads WHERE
      CASE WHEN REGEXP_REPLACE(phone,'[^0-9]','','g') LIKE '0%'
        THEN '972' || SUBSTRING(REGEXP_REPLACE(phone,'[^0-9]','','g'),2)
        ELSE REGEXP_REPLACE(phone,'[^0-9]','','g')
      END = $1 LIMIT 1`,
    [clean]
  );
  if (rows.length) {
    // Backfill avatar if missing
    if (!rows[0].avatar_url && chatId) {
      fetchContactInfo(chatId).then(({ avatar }) => {
        if (avatar) pool.query('UPDATE leads SET avatar_url=$1 WHERE id=$2', [avatar, rows[0].id]).catch(() => {});
      });
    }
    return rows[0].id;
  }
  // New lead — fetch WhatsApp profile
  const { name: profileName, avatar } = chatId ? await fetchContactInfo(chatId) : {};
  const displayName = profileName || senderName || 'ליד וואטסאפ';
  const { rows: newRows } = await pool.query(
    `INSERT INTO leads (name, phone, source, stage, notes, avatar_url, event_name) VALUES ($1,$2,'whatsapp','new',$3,$4,$5) RETURNING id`,
    [displayName, clean, `הודעה ראשונה: ${messageBody}`, avatar || null, displayName]
  );
  return newRows[0].id;
}

async function processNotification(notification) {
  const body = notification.body;
  if (!body || body.typeWebhook !== 'incomingMessageReceived') return;

  const msg = body.messageData;
  if (!msg) return;

  const SUPPORTED = ['textMessage','extendedTextMessage','imageMessage','documentMessage','audioMessage','extendedAudioMessage','videoMessage'];
  if (!SUPPORTED.includes(msg.typeMessage)) return;

  const chatId      = body.senderData?.chatId || body.senderData?.sender || '';
  if (chatId.endsWith('@g.us')) return; // ignore group messages

  const senderPhone = body.senderData?.sender?.replace('@c.us', '');
  const senderName  = body.senderData?.senderName || null;
  const externalId  = body.idMessage;

  // Extract preview text for lead creation
  const previewText = msg.typeMessage === 'textMessage'
    ? (msg.textMessageData?.textMessage || '')
    : msg.typeMessage === 'extendedTextMessage'
      ? (msg.extendedTextMessageData?.text || '')
      : ((msg.imageMessageData || msg.fileMessageData || {}).caption || `[${msg.typeMessage}]`);

  const { rows: dup } = await pool.query('SELECT id FROM messages WHERE external_id = $1', [externalId]);
  if (dup.length) return;

  const leadId = await findOrCreateLead(senderPhone, senderName, previewText, chatId);
  if (!leadId) return;

  // Resolve final message body (download media if needed)
  let text = previewText;
  if (!['textMessage','extendedTextMessage'].includes(msg.typeMessage)) {
    ({ text } = await saveInboundMedia(msg, leadId, externalId));
  }

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
