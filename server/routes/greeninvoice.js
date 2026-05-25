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
  405: 'חשבונית-מס-קבלה',
};

async function getToken() {
  const { data } = await axios.post(`${GI_BASE}/account/token`, {
    id:     process.env.GREENINVOICE_API_KEY,
    secret: process.env.GREENINVOICE_SECRET,
  });
  return data.token;
}

// POST /api/greeninvoice/document
router.post('/document', async (req, res) => {
  const {
    leadId, type, amount, description, includeVat,
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
    // IncomeVatType: 1=INCLUDED (price has VAT baked in), 2=EXEMPT
    const incomeVatType = includeVat ? 1 : 2;
    const docType       = Number(type);
    const today         = new Date().toISOString().slice(0, 10);
    const needsPmt      = [400, 320].includes(docType);

    const docPayload = {
      description: description || 'שירותי הפקת אירוע',
      type:        docType,
      date:        today,
      lang:        'he',
      currency:    'ILS',
      client: {
        name: lead.orderer_name || lead.name,
        ...(lead.signer_id_number ? { taxId:  lead.signer_id_number } : {}),
        ...(lead.phone            ? { phone:  lead.phone }             : {}),
        ...(lead.email            ? { emails: [lead.email], send: !!sendByEmail } : { send: false }),
      },
      income: [{
        description: description || 'שירותי הפקת אירוע',
        price:       Number(amount),
        quantity:    1,
        vatType:     incomeVatType,
      }],
      ...(needsPmt ? {
        payment: [{
          type:     Number(paymentMethod) || 4,
          date:     today,
          price:    Number(amount),
          currency: 'ILS',
        }],
      } : {}),
    };

    const { data: doc } = await axios.post(`${GI_BASE}/documents`, docPayload, { headers });
    const docId     = doc.id;
    const docUrl    = doc.url || `https://app.greeninvoice.co.il/documents/view/${docId}`;
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
    } catch (pdfErr) {
      console.error('[GreenInvoice] PDF save failed (non-fatal):', pdfErr.message);
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
    console.error('[GreenInvoice] Error:', JSON.stringify(giData), err.message);
    const giMsg = giData?.message || giData?.error || err.message;
    res.status(500).json({ error: giMsg || 'Failed to create document' });
  }
});

module.exports = router;
