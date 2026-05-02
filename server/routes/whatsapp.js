const router = require('express').Router();
const pool = require('../db/pool');
const requireAuth = require('../middleware/auth');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const FormData = require('form-data');
const { uploadFile } = require('../services/storageService');
const { normalizePhone, findLeadByPhone } = require('../utils/phoneUtils');

const upload = multer({ dest: os.tmpdir() });

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

// Rate limiter: minimum 3 seconds between any two Green API sends
let lastWaSendTime = 0;
async function waitForWaSlot() {
  const gap = 3000 - (Date.now() - lastWaSendTime);
  if (gap > 0) await new Promise(r => setTimeout(r, gap));
  lastWaSendTime = Date.now();
}

async function fetchAvatar(chatId) {
  try {
    const res = await axios.post(
      `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/getContactInfo/${process.env.GREEN_API_TOKEN}`,
      { chatId },
      { timeout: 8000 }
    );
    return res.data?.avatar || res.data?.urlAvatar || null;
  } catch {
    return null;
  }
}

async function findOrCreateLead(phone, name, messageBody, chatId) {
  const clean = normalizePhone(phone);
  if (!clean) return null;

  const existing = await findLeadByPhone(pool, clean);
  if (existing) {
    // Backfill avatar for existing leads that are missing one
    if (chatId) {
      const { rows: cur } = await pool.query('SELECT avatar_url FROM leads WHERE id = $1', [existing]);
      if (!cur[0]?.avatar_url) {
        fetchAvatar(chatId).then(avatar => {
          if (avatar) pool.query('UPDATE leads SET avatar_url = $1 WHERE id = $2', [avatar, existing]).catch(() => {});
        });
      }
    }
    return existing;
  }

  const avatar = chatId ? await fetchAvatar(chatId) : null;
  const leadName = name || 'ליד חדש מוואטסאפ';
  const { rows } = await pool.query(
    `INSERT INTO leads (name, phone, source, stage, notes, event_name, avatar_url)
     VALUES ($1, $2, 'whatsapp', 'new', $3, $4, $5) RETURNING id`,
    [leadName, clean, `הודעה ראשונה: ${messageBody}`, leadName, avatar]
  );
  return rows[0].id;
}

// POST /api/whatsapp/webhook — Green API incoming messages (public)
router.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    if (body.typeWebhook !== 'incomingMessageReceived') return res.sendStatus(200);

    const msg = body.messageData;
    const SUPPORTED = ['textMessage','extendedTextMessage','imageMessage','documentMessage','audioMessage','extendedAudioMessage','videoMessage'];
    if (!msg || !SUPPORTED.includes(msg.typeMessage)) return res.sendStatus(200);

    const chatId = body.senderData?.chatId || body.senderData?.sender || '';
    if (chatId.endsWith('@g.us')) return res.sendStatus(200); // ignore group messages

    const senderPhone = body.senderData?.sender?.replace('@c.us', '');
    const senderName  = body.senderData?.senderName || null;
    const externalId  = body.idMessage;

    // Extract preview text for lead creation (before media download)
    const previewText = msg.typeMessage === 'textMessage'
      ? (msg.textMessageData?.textMessage || '')
      : msg.typeMessage === 'extendedTextMessage'
        ? (msg.extendedTextMessageData?.text || '')
        : ((msg.imageMessageData || msg.fileMessageData || {}).caption || `[${msg.typeMessage}]`);

    const { rows: dup } = await pool.query('SELECT id FROM messages WHERE external_id = $1', [externalId]);
    if (dup.length) return res.sendStatus(200);

    const leadId = await findOrCreateLead(senderPhone, senderName, previewText, chatId);
    if (!leadId) return res.sendStatus(200);

    // Resolve final message body (download media if needed)
    let text = previewText;
    if (!['textMessage','extendedTextMessage'].includes(msg.typeMessage)) {
      ({ text } = await saveInboundMedia(msg, leadId, externalId));
    }

    await pool.query(
      `INSERT INTO messages (lead_id, channel, direction, body, external_id, timestamp, is_read, contact_value)
       VALUES ($1, 'whatsapp', 'inbound', $2, $3, NOW(), false, $4)`,
      [leadId, text, externalId, senderPhone]
    );
    await pool.query('UPDATE leads SET updated_at = NOW() WHERE id = $1', [leadId]);

    console.log(`[WhatsApp] Message from ${senderPhone} → lead ${leadId}`);
    res.sendStatus(200);
  } catch (err) {
    console.error('[WhatsApp] webhook error:', err.message);
    res.sendStatus(200);
  }
});

// POST /api/whatsapp/send — send text message (authenticated)
router.post('/send', requireAuth, async (req, res) => {
  const { leadId, message, phone: phoneOverride } = req.body;
  try {
    const { rows } = await pool.query('SELECT phone FROM leads WHERE id = $1', [leadId]);
    if (!rows.length) return res.status(404).json({ error: 'Lead not found' });

    const phone = normalizePhone(phoneOverride || rows[0].phone);
    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const url = `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/sendMessage/${process.env.GREEN_API_TOKEN}`;
    await waitForWaSlot();
    await axios.post(url, { chatId: `${phone}@c.us`, message });

    // Green API succeeded — log to DB (non-fatal)
    try {
      await pool.query(
        `INSERT INTO messages (lead_id, channel, direction, body, timestamp, contact_value, sent_by) VALUES ($1, 'whatsapp', 'outbound', $2, NOW(), $3, $4)`,
        [leadId, message, phone, req.user?.id || null]
      );
      await pool.query('UPDATE leads SET updated_at = NOW() WHERE id = $1', [leadId]);
      // Auto-advance new → contacted on first outbound WhatsApp
      await pool.query(
        `UPDATE leads SET stage = 'contacted', updated_at = NOW() WHERE id = $1 AND stage = 'new'`,
        [leadId]
      );
    } catch (dbErr) {
      console.error('[WhatsApp] DB log error (message was sent):', dbErr.message);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[WhatsApp] send error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// POST /api/whatsapp/send-file — send message + file (authenticated)
router.post('/send-file', requireAuth, upload.single('file'), async (req, res) => {
  const { leadId, message = '', phone: phoneOverride } = req.body;
  try {
    const { rows } = await pool.query('SELECT phone FROM leads WHERE id = $1', [leadId]);
    if (!rows.length) return res.status(404).json({ error: 'Lead not found' });

    const phone = normalizePhone(phoneOverride || rows[0].phone);
    if (!phone) return res.status(400).json({ error: 'No phone number' });

    let fileUrl = null;
    let fileName = null;

    if (req.file) {
      // multer reads filename bytes as latin1; re-encode to utf-8
      fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

      // Step 1: upload file to Green API storage → get public URL
      const uploadFd = new FormData();
      uploadFd.append('file', fs.createReadStream(req.file.path), {
        filename: fileName,
        contentType: req.file.mimetype || 'application/octet-stream',
      });
      const uploadUrl = `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/uploadFile/${process.env.GREEN_API_TOKEN}`;
      const uploadRes = await axios.post(uploadUrl, uploadFd, { headers: uploadFd.getHeaders() });
      const urlFile = uploadRes.data.urlFile;

      // Step 2: save to Supabase storage before deleting temp
      const { storedName } = await uploadFile(req.file.path, fileName, req.file.mimetype || 'application/octet-stream');

      // Step 3: send via URL
      const sendUrl = `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/sendFileByUrl/${process.env.GREEN_API_TOKEN}`;
      await waitForWaSlot();
      await axios.post(sendUrl, {
        chatId: `${phone}@c.us`,
        urlFile,
        fileName,
        caption: message,
      });
      fs.unlinkSync(req.file.path);

      // Step 4: insert into files table to get an ID for the timeline marker
      const { rows: fileRows } = await pool.query(
        `INSERT INTO files (lead_id, filename, url, stored_name, file_type, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [leadId, fileName, '', storedName, req.file.mimetype || 'application/octet-stream', req.user.id]
      );
      fileUrl = fileRows[0].id; // reuse variable to carry the file ID
    } else if (message.trim()) {
      const url = `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/sendMessage/${process.env.GREEN_API_TOKEN}`;
      await waitForWaSlot();
      await axios.post(url, { chatId: `${phone}@c.us`, message });
    }

    // Green API succeeded — log to DB (non-fatal)
    const logBody = fileUrl ? `${message}\n[[FILE:${fileUrl}|${fileName}]]` : message;
    try {
      await pool.query(
        `INSERT INTO messages (lead_id, channel, direction, body, timestamp, contact_value, sent_by) VALUES ($1, 'whatsapp', 'outbound', $2, NOW(), $3, $4)`,
        [leadId, logBody, phone, req.user?.id || null]
      );
      await pool.query('UPDATE leads SET updated_at = NOW() WHERE id = $1', [leadId]);
      // Auto-advance new → contacted on first outbound WhatsApp
      await pool.query(
        `UPDATE leads SET stage = 'contacted', updated_at = NOW() WHERE id = $1 AND stage = 'new'`,
        [leadId]
      );
    } catch (dbErr) {
      console.error('[WhatsApp] DB log error (file was sent):', dbErr.message);
    }

    res.json({ success: true });
  } catch (err) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    console.error('[WhatsApp] send-file error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to send file' });
  }
});

module.exports = router;
