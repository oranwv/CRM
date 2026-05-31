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
const OpenAI = require('openai');

let _oaiClient;
function getOAI() {
  if (!_oaiClient) _oaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _oaiClient;
}

async function extractLeadDetails(text) {
  const completion = await getOAI().chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 300,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'אתה עוזר שמחלץ פרטי אירוע מהודעות וואטסאפ בעברית. החזר JSON עם: name (שם מלא), event_type (סוג האירוע, לדוגמה: חתונה/מסיבה/חברה/בר מצווה), event_date_text (תאריך כטקסט, לדוגמה: "סוף אוגוסט 2026"), guest_count (מספר אורחים, לדוגמה: "60-80"). השתמש ב-null עבור שדות שלא הוזכרו.'
      },
      { role: 'user', content: text }
    ]
  });
  return JSON.parse(completion.choices[0].message.content);
}

async function updateLeadFromChatbot(leadId, extracted, fullText) {
  const { rows: [lead] } = await pool.query('SELECT * FROM leads WHERE id=$1', [leadId]);
  if (!lead) return;

  const sets = [];
  const vals = [];
  let i = 1;

  if (extracted.name) {
    sets.push(`name=$${i++}`, `event_name=$${i++}`);
    vals.push(extracted.name, extracted.name);
  }
  if (extracted.event_type && !lead.event_type)           { sets.push(`event_type=$${i++}`);       vals.push(extracted.event_type); }
  if (extracted.event_date_text && !lead.event_date_text) { sets.push(`event_date_text=$${i++}`);  vals.push(extracted.event_date_text); }
  if (extracted.guest_count && !lead.guest_count)         { sets.push(`guest_count=$${i++}`);      vals.push(String(extracted.guest_count)); }

  sets.push(`notes=$${i++}`);
  vals.push(fullText);

  vals.push(leadId);
  await pool.query(`UPDATE leads SET ${sets.join(', ')} WHERE id=$${i}`, vals);
  console.log(`[WhatsApp] AI extracted lead ${leadId}:`, extracted);
}

const upload = multer({ dest: os.tmpdir() });

function mediaMimeToExt(mime) {
  const map = { 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','audio/ogg':'ogg','audio/mpeg':'mp3','application/pdf':'pdf' };
  return map[mime] || 'bin';
}

async function saveInboundMedia(msg, leadId, externalId) {
  const d = msg.imageMessageData || msg.fileMessageData || {};
  const mediaUrl = d.downloadUrl || d.url || null;
  if (!mediaUrl) return { text: d.fileName ? `📎 ${d.fileName}` : (d.caption || `[${msg.typeMessage}]`) };

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
    return { text: d.fileName ? `📎 ${d.fileName}` : (caption || `[${msg.typeMessage}]`) };
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

async function sendWhatsAppRaw(phone, message) {
  if (!phone || !message) return;
  const url = `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/sendMessage/${process.env.GREEN_API_TOKEN}`;
  await waitForWaSlot();
  await axios.post(url, { chatId: `${phone}@c.us`, message });
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

    // Chatbot auto-reply (non-blocking)
    ;(async () => {
      try {
        const { rows: cfgRows } = await pool.query(
          "SELECT key, value FROM settings WHERE key IN ('wa_chatbot_enabled','wa_chatbot_greeting','wa_chatbot_followup')"
        );
        const cfg = Object.fromEntries(cfgRows.map(r => [r.key, r.value]));
        if (cfg.wa_chatbot_enabled !== 'true') return;
        const { rows: cntRows } = await pool.query(
          "SELECT COUNT(*) FROM messages WHERE lead_id=$1 AND direction='inbound'",
          [leadId]
        );
        const count = parseInt(cntRows[0].count);
        if (count === 1 && cfg.wa_chatbot_greeting) {
          await sendWhatsAppRaw(senderPhone, cfg.wa_chatbot_greeting);
        } else if (count === 2 && cfg.wa_chatbot_followup) {
          await sendWhatsAppRaw(senderPhone, cfg.wa_chatbot_followup);
          try {
            const extracted = await extractLeadDetails(text);
            await updateLeadFromChatbot(leadId, extracted, text);
          } catch (e) {
            console.error('[WhatsApp] AI extraction error:', e.message);
          }
        }
      } catch (e) {
        console.error('[WhatsApp] chatbot error:', e.message);
      }
    })();

    // Notify assigned user about inbound message (non-blocking)
    const _notifyText = text;
    const _notifyLeadId = leadId;
    pool.query(
      `SELECT u.phone, l.name FROM leads l JOIN users u ON u.id = l.assigned_to WHERE l.id = $1 AND u.phone IS NOT NULL`,
      [_notifyLeadId]
    ).then(async ({ rows }) => {
      if (!rows[0]) return;
      const { sendWhatsApp } = require('../services/reminderService');
      const baseUrl = process.env.SERVER_URL || 'https://crm-production-c3df.up.railway.app';
      const preview = _notifyText.slice(0, 200);
      await sendWhatsApp(rows[0].phone,
        `הודעת וואטסאפ חדשה מ${rows[0].name}:\n"${preview}"\nלפתיחת הליד: ${baseUrl}/?lead=${_notifyLeadId}`
      );
    }).catch(() => {});

    console.log(`[WhatsApp] Message from ${senderPhone} → lead ${leadId}`);
    res.sendStatus(200);
  } catch (err) {
    console.error('[WhatsApp] webhook error:', err.message);
    res.sendStatus(200);
  }
});

// POST /api/whatsapp/send — send text message (authenticated)
router.post('/send', requireAuth, async (req, res) => {
  const { leadId, supplierId, message, phone: phoneOverride } = req.body;

  if (supplierId) {
    try {
      const { rows } = await pool.query('SELECT phone FROM suppliers WHERE id = $1', [supplierId]);
      if (!rows.length) return res.status(404).json({ error: 'Supplier not found' });
      const phone = normalizePhone(phoneOverride || rows[0].phone);
      if (!phone) return res.status(400).json({ error: 'No phone number' });
      const url = `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/sendMessage/${process.env.GREEN_API_TOKEN}`;
      await waitForWaSlot();
      await axios.post(url, { chatId: `${phone}@c.us`, message });
      try {
        await pool.query(
          `INSERT INTO supplier_interactions (supplier_id, type, direction, body, created_by) VALUES ($1, 'whatsapp', 'outbound', $2, $3)`,
          [supplierId, message, req.user?.id || null]
        );
      } catch (dbErr) { console.error('[WhatsApp] DB log error:', dbErr.message); }
      return res.json({ success: true });
    } catch (err) {
      console.error('[WhatsApp] send error:', err.response?.data || err.message);
      return res.status(500).json({ error: 'Failed to send message' });
    }
  }

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
// Accepts multipart `file`, `driveFileId`, or `leadFileId` (existing lead file)
router.post('/send-file', requireAuth, upload.single('file'), async (req, res) => {
  const { leadId, message = '', phone: phoneOverride, driveFileId, leadFileId } = req.body;
  try {
    const { rows } = await pool.query('SELECT phone FROM leads WHERE id = $1', [leadId]);
    if (!rows.length) return res.status(404).json({ error: 'Lead not found' });

    const phone = normalizePhone(phoneOverride || rows[0].phone);
    if (!phone) return res.status(400).json({ error: 'No phone number' });

    let fileUrl = null;
    let fileName = null;
    let fileMime = 'application/octet-stream';
    let tmpPath = null;

    if (driveFileId && !req.file) {
      // Download from Drive to a temp file
      const { downloadFile } = require('../services/driveService');
      const { buffer, mimeType, name } = await downloadFile(driveFileId);
      fileName = name;
      fileMime = mimeType;
      tmpPath = path.join(os.tmpdir(), `drive_wa_${Date.now()}_${name}`);
      fs.writeFileSync(tmpPath, buffer);
      req.file = { path: tmpPath, originalname: name, mimetype: mimeType };
    }

    if (leadFileId && !req.file && !driveFileId) {
      // Use a file already stored on this lead — download from Supabase and send without creating a duplicate DB row
      const { rows: fRows } = await pool.query(
        'SELECT id, filename, stored_name, file_type FROM files WHERE id = $1 AND lead_id = $2',
        [leadFileId, leadId]
      );
      if (!fRows.length) return res.status(404).json({ error: 'File not found' });
      const { id: existingId, filename: fName, stored_name: sName, file_type: fType } = fRows[0];

      const { getSignedUrl } = require('../services/storageService');
      const signedUrl = await getSignedUrl(sName, 300);
      const fileRes = await axios.get(signedUrl, { responseType: 'arraybuffer' });
      const lTmpPath = path.join(os.tmpdir(), `leadfile_wa_${Date.now()}_${fName}`);
      fs.writeFileSync(lTmpPath, Buffer.from(fileRes.data));

      const uploadFd = new FormData();
      uploadFd.append('file', fs.createReadStream(lTmpPath), { filename: fName, contentType: fType || 'application/octet-stream' });
      const uploadUrl = `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/uploadFile/${process.env.GREEN_API_TOKEN}`;
      const uploadRes = await axios.post(uploadUrl, uploadFd, { headers: uploadFd.getHeaders() });
      const urlFile = uploadRes.data.urlFile;

      const sendUrl = `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/sendFileByUrl/${process.env.GREEN_API_TOKEN}`;
      await waitForWaSlot();
      await axios.post(sendUrl, { chatId: `${phone}@c.us`, urlFile, fileName: fName, caption: message });
      fs.unlinkSync(lTmpPath);

      const logBody = message ? `${message}\n[[FILE:${existingId}|${fName}]]` : `[[FILE:${existingId}|${fName}]]`;
      try {
        await pool.query(
          `INSERT INTO messages (lead_id, channel, direction, body, timestamp, contact_value, sent_by)
           VALUES ($1, 'whatsapp', 'outbound', $2, NOW(), $3, $4)`,
          [leadId, logBody, phone, req.user?.id || null]
        );
        await pool.query('UPDATE leads SET updated_at = NOW() WHERE id = $1', [leadId]);
      } catch (dbErr) {
        console.error('[WhatsApp] DB log error (file was sent):', dbErr.message);
      }
      return res.json({ success: true });
    }

    if (req.file) {
      // multer reads filename bytes as latin1; re-encode to utf-8 (skip for Drive files which already have correct name)
      fileName = fileName || Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      fileMime = fileMime !== 'application/octet-stream' ? fileMime : (req.file.mimetype || 'application/octet-stream');

      // Step 1: upload file to Green API storage → get public URL
      const uploadFd = new FormData();
      uploadFd.append('file', fs.createReadStream(req.file.path), {
        filename: fileName,
        contentType: fileMime,
      });
      const uploadUrl = `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/uploadFile/${process.env.GREEN_API_TOKEN}`;
      const uploadRes = await axios.post(uploadUrl, uploadFd, { headers: uploadFd.getHeaders() });
      const urlFile = uploadRes.data.urlFile;

      // Step 2: save to Supabase storage before deleting temp
      const { storedName } = await uploadFile(req.file.path, fileName, fileMime);

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
        [leadId, fileName, '', storedName, fileMime, req.user.id]
      );
      fileUrl = fileRows[0].id;
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
