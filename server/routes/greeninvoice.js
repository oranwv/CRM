const express = require('express');
const axios   = require('axios');
const pool    = require('../db/pool');
const { uploadBuffer }  = require('../services/storageService');
const { normalizePhone } = require('../utils/phoneUtils');

const router   = express.Router();
const GI_BASE  = 'https://api.greeninvoice.co.il/api/v1';

const DOC_NAMES = {
  300: 'דרישת-תשלום',
  305: 'חשבון-עסקה',
  400: 'קבלה',
  320: 'חשבונית-מס-קבלה',
};

async function getToken() {
  console.log('[GreenInvoice] Authenticating — key prefix:', (process.env.GREENINVOICE_API_KEY || '').slice(0, 8), '— secret prefix:', (process.env.GREENINVOICE_SECRET || '').slice(0, 5));
  let res;
  try {
    res = await axios.post(`${GI_BASE}/account/token`, {
      id:     process.env.GREENINVOICE_API_KEY,
      secret: process.env.GREENINVOICE_SECRET,
    });
  } catch (authErr) {
    console.error('[GreenInvoice] Auth endpoint FAILED — status:', authErr.response?.status, '— body:', JSON.stringify(authErr.response?.data));
    throw authErr;
  }
  const data = res.data;
  console.log('[GreenInvoice] Token response keys:', Object.keys(data || {}));
  const token = data.token || data.accessToken || data.jwt || data.access_token;
  console.log('[GreenInvoice] Token extracted:', token ? token.slice(0, 20) + '...' : 'NONE');
  if (!token) throw new Error('No token in GreenInvoice auth response: ' + JSON.stringify(data));
  return token;
}

// POST /api/greeninvoice/document
router.post('/document', async (req, res) => {
  const {
    leadId, type, items, docDate, dueDate, paymentDate,
    paymentMethod,
    sendByEmail, sendByWhatsApp, whatsappMessage,
  } = req.body;

  try {
    // 1. Fetch lead + latest signed contract
    const { rows } = await pool.query(`
      SELECT l.name, l.phone, l.email, l.deposit_amount, l.remaining_balance_override,
             c.signer_id_number, c.orderer_name
      FROM leads l
      LEFT JOIN LATERAL (
        SELECT signer_id_number, orderer_name
        FROM contracts
        WHERE lead_id = l.id AND status = 'signed'
        ORDER BY signed_at DESC
        LIMIT 1
      ) c ON true
      WHERE l.id = $1
    `, [leadId]);

    if (!rows.length) return res.status(404).json({ error: 'Lead not found' });
    const lead = rows[0];

    // 2. Authenticate with GreenInvoice
    const token   = await getToken();
    const headers = { Authorization: `Bearer ${token}` };

    // 3. Build and POST the document
    const docType     = Number(type);
    const today       = new Date().toISOString().slice(0, 10);
    const needsPmt    = [400, 320].includes(docType);
    const totalAmount = (items || []).reduce((sum, it) => sum + Number(it.price) * Number(it.quantity), 0);

    const docPayload = {
      type:     docType,
      date:     docDate || today,
      lang:     'he',
      currency: 'ILS',
      ...(dueDate ? { dueDate } : {}),
      client: {
        name:   lead.orderer_name || lead.name,
        add:    false,
        ...(lead.signer_id_number ? { taxId:  lead.signer_id_number } : {}),
        ...(lead.phone            ? { phone:  lead.phone }             : {}),
        ...(lead.email            ? { emails: [lead.email] }           : {}),
      },
      income: (items || []).map(it => ({
        description: it.description,
        price:       Number(it.price),
        quantity:    Number(it.quantity),
        vatType:     Number(it.vatType),
      })),
      ...(needsPmt ? {
        payment: [{
          type:     Number(paymentMethod) || 4,
          date:     paymentDate || today,
          price:    totalAmount,
          currency: 'ILS',
        }],
      } : {}),
    };

    console.log('[GreenInvoice] Sending payload:', JSON.stringify(docPayload));

    const { data: doc } = await axios.post(`${GI_BASE}/documents`, docPayload, { headers });
    console.log('[GreenInvoice] Doc response:', JSON.stringify(doc));
    const docId     = doc.id;
    const rawUrl    = doc.url;
    const docUrl    = (typeof rawUrl === 'string' ? rawUrl : rawUrl?.origin || rawUrl?.download || rawUrl?.pdf || Object.values(rawUrl || {})[0])
                   || `https://app.greeninvoice.co.il/documents/view/${docId}`;
    const docNumber = doc.number || docId;
    const filename  = `${DOC_NAMES[type] || 'מסמך'}-${docNumber}.pdf`;

    // 4. Download PDF and save to lead's files (non-fatal)
    try {
      const pdfRes = await axios.get(`${GI_BASE}/documents/${docId}/download`, {
        headers,
        params:       { format: 'pdf' },
        responseType: 'arraybuffer',
        timeout:      20000,
        maxRedirects: 5,
      });
      const buffer = Buffer.from(pdfRes.data);
      const { storedName } = await uploadBuffer(buffer, filename, 'application/pdf');
      await pool.query(
        `INSERT INTO files (lead_id, filename, url, stored_name, file_type, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [leadId, filename, '', storedName, 'application/pdf', req.user.id]
      );
      console.log('[GreenInvoice] PDF saved to files:', filename);
    } catch (pdfErr) {
      console.error('[GreenInvoice] PDF save failed:', pdfErr.message, pdfErr.response?.status, JSON.stringify(pdfErr.response?.data));
    }

    // 5. Send via WhatsApp if requested
    if (sendByWhatsApp && lead.phone) {
      try {
        const phone = normalizePhone(lead.phone);
        if (phone) {
          const msg    = [whatsappMessage, docUrl].filter(Boolean).join('\n');
          const waUrl  = `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/sendMessage/${process.env.GREEN_API_TOKEN}`;
          await axios.post(waUrl, { chatId: `${phone}@c.us`, message: msg });
          await pool.query(
            `INSERT INTO messages (lead_id, channel, direction, body, timestamp, contact_value, sent_by)
             VALUES ($1, 'whatsapp', 'outbound', $2, NOW(), $3, $4)`,
            [leadId, msg, phone, req.user?.id || null]
          );
        }
      } catch (waErr) {
        console.error('[GreenInvoice] WhatsApp send failed:', waErr.message);
      }
    }

    res.json({ success: true, documentId: docId, url: docUrl, filename });
  } catch (err) {
    const giData = err.response?.data;
    const status = err.response?.status;
    console.error('[GreenInvoice] HTTP', status, '— body:', JSON.stringify(giData), '— message:', err.message);
    const giMsg = (typeof giData === 'string' ? giData : (giData?.message || giData?.error || JSON.stringify(giData))) || err.message;
    res.status(500).json({ error: `GreenInvoice ${status || ''}: ${giMsg}` });
  }
});

module.exports = router;
