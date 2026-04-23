const router = require('express').Router();
const pool = require('../db/pool');
const requireAuth = require('../middleware/auth');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const FormData = require('form-data');

const upload = multer({ dest: os.tmpdir() });

const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

function saveToUploads(tempPath, originalName) {
  const ext = path.extname(originalName);
  const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const storedName = `${unique}${ext}`;
  const destPath = path.join(uploadsDir, storedName);
  fs.copyFileSync(tempPath, destPath);
  return { storedName, url: `/uploads/${storedName}` };
}

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

  const { rows: existing } = await pool.query(
    'SELECT id FROM leads WHERE REGEXP_REPLACE(phone, $1, $2) = $3 LIMIT 1',
    ['\\D', '', clean]
  );
  if (existing.length) return existing[0].id;

  const { rows } = await pool.query(
    `INSERT INTO leads (name, phone, source, stage, notes)
     VALUES ($1, $2, 'whatsapp', 'new', $3) RETURNING id`,
    [name || 'ליד חדש מוואטסאפ', clean, `הודעה ראשונה: ${messageBody}`]
  );
  return rows[0].id;
}

// POST /api/whatsapp/webhook — Green API incoming messages (public)
router.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    if (body.typeWebhook !== 'incomingMessageReceived') return res.sendStatus(200);

    const msg = body.messageData;
    if (!msg || msg.typeMessage !== 'textMessage') return res.sendStatus(200);

    const chatId = body.senderData?.chatId || body.senderData?.sender || '';
    if (chatId.endsWith('@g.us')) return res.sendStatus(200); // ignore group messages

    const senderPhone = body.senderData?.sender?.replace('@c.us', '');
    const senderName = body.senderData?.senderName || null;
    const text = msg.textMessageData?.textMessage || '';
    const externalId = body.idMessage;

    const { rows: dup } = await pool.query('SELECT id FROM messages WHERE external_id = $1', [externalId]);
    if (dup.length) return res.sendStatus(200);

    const leadId = await findOrCreateLead(senderPhone, senderName, text);
    if (!leadId) return res.sendStatus(200);

    await pool.query(
      `INSERT INTO messages (lead_id, channel, direction, body, external_id, timestamp, is_read)
       VALUES ($1, 'whatsapp', 'inbound', $2, $3, NOW(), false)`,
      [leadId, text, externalId]
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
  const { leadId, message } = req.body;
  try {
    const { rows } = await pool.query('SELECT phone FROM leads WHERE id = $1', [leadId]);
    if (!rows.length) return res.status(404).json({ error: 'Lead not found' });

    const phone = formatPhone(rows[0].phone);
    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const url = `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/sendMessage/${process.env.GREEN_API_TOKEN}`;
    await axios.post(url, { chatId: `${phone}@c.us`, message });

    // Green API succeeded — log to DB (non-fatal)
    try {
      await pool.query(
        `INSERT INTO messages (lead_id, channel, direction, body, timestamp) VALUES ($1, 'whatsapp', 'outbound', $2, NOW())`,
        [leadId, message]
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
  const { leadId, message = '' } = req.body;
  try {
    const { rows } = await pool.query('SELECT phone FROM leads WHERE id = $1', [leadId]);
    if (!rows.length) return res.status(404).json({ error: 'Lead not found' });

    const phone = formatPhone(rows[0].phone);
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

      // Step 2: save to CRM uploads before deleting temp
      ({ url: fileUrl } = saveToUploads(req.file.path, fileName));

      // Step 3: send via URL
      const sendUrl = `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/sendFileByUrl/${process.env.GREEN_API_TOKEN}`;
      await axios.post(sendUrl, {
        chatId: `${phone}@c.us`,
        urlFile,
        fileName,
        caption: message,
      });
      fs.unlinkSync(req.file.path);
    } else if (message.trim()) {
      const url = `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/sendMessage/${process.env.GREEN_API_TOKEN}`;
      await axios.post(url, { chatId: `${phone}@c.us`, message });
    }

    // Green API succeeded — log to DB (non-fatal)
    const logBody = fileUrl ? `${message}\n[[FILE:${fileUrl}|${fileName}]]` : message;
    try {
      await pool.query(
        `INSERT INTO messages (lead_id, channel, direction, body, timestamp) VALUES ($1, 'whatsapp', 'outbound', $2, NOW())`,
        [leadId, logBody]
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
