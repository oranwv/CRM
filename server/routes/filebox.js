// /api/filebox — download / view / send for any file shown in the CRM.
// Files are addressed by a ref (see services/fileBox.js): lead:<id>,
// supplier:<sid>:<id>, ops:<logId>. Mounted behind requireAuth.
const router = require('express').Router();
const pool   = require('../db/pool');
const { resolveRef, exportFile, exportName, contactsFor } = require('../services/fileBox');
const { getSignedUrl } = require('../services/storageService');
const { sendFileToPhones } = require('../services/waOutbound');
const { normalizePhone } = require('../utils/phoneUtils');

async function loadOr404(req, res) {
  const file = await resolveRef(req.query.ref || req.body?.ref);
  if (!file) { res.status(404).json({ error: 'הקובץ לא נמצא' }); return null; }
  return file;
}

// RFC 5987 Content-Disposition for Hebrew file names
function attachmentHeader(filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// GET /api/filebox/info?ref= — what the viewer / send sheet need to know
router.get('/info', async (req, res) => {
  try {
    const file = await loadOr404(req, res);
    if (!file) return;
    const contacts = await contactsFor(file);
    res.json({
      ref: file.ref, kind: file.kind, filename: file.filename, mime: file.mime, isHtml: file.isHtml,
      leadId: file.leadId || null, supplierId: file.supplierId || null,
      pdfName: exportName(file, 'pdf'),
      contacts,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/filebox/url?ref= — signed URL for in-app viewing (10 minutes)
router.get('/url', async (req, res) => {
  try {
    const file = await loadOr404(req, res);
    if (!file) return;
    const url = await getSignedUrl(file.storedName, 600);
    res.json({ url, filename: file.filename, mime: file.mime, isHtml: file.isHtml });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/filebox/download?ref=&format=pdf|original — the bytes, as an attachment.
// format=pdf turns an HTML document into a PDF that looks like the page; other
// files come back unchanged whatever the format.
router.get('/download', async (req, res) => {
  try {
    const file = await loadOr404(req, res);
    if (!file) return;
    const format = req.query.format === 'pdf' ? 'pdf' : 'original';
    const out = await exportFile(file, format);
    res.setHeader('Content-Type', out.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', attachmentHeader(out.filename));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(out.buffer);
  } catch (err) {
    console.error('[filebox] download error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'ההורדה נכשלה: ' + err.message });
  }
});

// POST /api/filebox/send
// { ref, via: 'whatsapp'|'email', to: [phone|email,...], message?, subject?, format?: 'pdf'|'original' }
// Sends through Sharabiya's WhatsApp (Green API) or Gmail and logs it where that
// entity keeps its history (lead → messages / lead_interactions, supplier →
// supplier_interactions). Production-log files are sent without a history row.
router.post('/send', async (req, res) => {
  try {
    const file = await loadOr404(req, res);
    if (!file) return;
    const { via, message = '', subject } = req.body || {};
    const format = req.body?.format === 'pdf' ? 'pdf' : 'original';
    const toList = (Array.isArray(req.body?.to) ? req.body.to : String(req.body?.to || '').split(','))
      .map(x => String(x || '').trim()).filter(Boolean);
    if (!toList.length) return res.status(400).json({ error: 'לא נבחר נמען' });

    const out = await exportFile(file, format);
    const marker = file.kind === 'lead' ? `[[FILE:${file.fileId}|${file.filename}]]` : '';

    if (via === 'whatsapp') {
      const phones = [...new Set(toList.map(normalizePhone).filter(Boolean))];
      if (!phones.length) return res.status(400).json({ error: 'מספר טלפון לא תקין' });
      const sent = await sendFileToPhones(phones, { buffer: out.buffer, fileName: out.filename, mime: out.mime, caption: message });
      if (!sent.length) return res.status(500).json({ error: 'השליחה בוואטסאפ נכשלה' });
      try {
        if (file.kind === 'lead') {
          const body = message ? `${message}\n${marker}` : marker;
          for (const phone of sent) {
            await pool.query(
              `INSERT INTO messages (lead_id, channel, direction, body, timestamp, contact_value, sent_by, external_id)
               VALUES ($1, 'whatsapp', 'outbound', $2, NOW(), $3, $4, $5) ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO NOTHING`,
              [file.leadId, body, phone, req.user?.id || null, sent.msgIds?.[phone] || null]
            );
          }
          await pool.query('UPDATE leads SET updated_at = NOW() WHERE id = $1', [file.leadId]);
        } else if (file.kind === 'supplier') {
          await pool.query(
            `INSERT INTO supplier_interactions (supplier_id, type, direction, body, created_by, file_id)
             VALUES ($1, 'whatsapp', 'outbound', $2, $3, $4)`,
            [file.supplierId, message ? `${message}\n📎 ${out.filename}` : `📎 ${out.filename}`, req.user?.id || null, file.fileId]
          );
        }
      } catch (dbErr) { console.error('[filebox] history log error (file was sent):', dbErr.message); }
      return res.json({ success: true, sentTo: sent, failed: phones.filter(p => !sent.includes(p)) });
    }

    if (via === 'email') {
      const emails = [...new Set(toList.filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];
      if (!emails.length) return res.status(400).json({ error: 'כתובת מייל לא תקינה' });
      const { sendEmail } = require('../services/gmailService');
      const subj = (subject && String(subject).trim()) || out.filename.replace(/\.[^.]+$/, '');
      await sendEmail({ to: emails.join(', '), subject: subj, body: message || '', attachments: [{ buffer: out.buffer, name: out.filename, mime: out.mime }] });
      try {
        if (file.kind === 'lead') {
          await pool.query(
            `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by) VALUES ($1, 'email', 'outbound', $2, $3)`,
            [file.leadId, `נשלח ל: ${emails.join(', ')} | נושא: ${subj}\n${message || ''}\n${marker}`.trim(), req.user?.id || null]
          );
          await pool.query('UPDATE leads SET updated_at = NOW() WHERE id = $1', [file.leadId]);
        } else if (file.kind === 'supplier') {
          await pool.query(
            `INSERT INTO supplier_interactions (supplier_id, type, direction, body, created_by, file_id)
             VALUES ($1, 'email', 'outbound', $2, $3, $4)`,
            [file.supplierId, `נשלח במייל ל: ${emails.join(', ')} | נושא: ${subj}${message ? `\n${message}` : ''}`, req.user?.id || null, file.fileId]
          );
        }
      } catch (dbErr) { console.error('[filebox] history log error (email was sent):', dbErr.message); }
      return res.json({ success: true, sentTo: emails });
    }

    res.status(400).json({ error: 'ערוץ שליחה לא מוכר' });
  } catch (err) {
    console.error('[filebox] send error:', err.response?.data || err.message);
    if (!res.headersSent) res.status(500).json({ error: 'השליחה נכשלה: ' + err.message });
  }
});

module.exports = router;
