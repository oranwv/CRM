const express = require('express');
const axios   = require('axios');
const pool    = require('../db/pool');
const { uploadBuffer }  = require('../services/storageService');
const { normalizePhone } = require('../utils/phoneUtils');

const router  = express.Router();
const GI_BASE = 'https://api.greeninvoice.co.il/api/v1';

const DOC_NAMES = {
  300: 'חשבונית-עסקה',
  305: 'חשבונית-מס',
  400: 'קבלה',
  320: 'חשבונית-מס-קבלה',
};
const DOC_LABELS = {
  300: 'חשבונית עסקה',
  305: 'חשבונית מס',
  400: 'קבלה',
  320: 'חשבונית מס קבלה',
};

// Create pending_documents table + update role constraint on startup
pool.query(`
  CREATE TABLE IF NOT EXISTS pending_documents (
    id                SERIAL PRIMARY KEY,
    lead_id           INTEGER REFERENCES leads(id) ON DELETE CASCADE,
    created_by        INTEGER REFERENCES users(id),
    status            VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    rejection_comment TEXT,
    reviewed_by       INTEGER REFERENCES users(id),
    reviewed_at       TIMESTAMPTZ,
    payload           JSONB NOT NULL,
    doc_id            TEXT,
    doc_url           TEXT,
    filename          TEXT,
    created_at        TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(err => console.error('[GreenInvoice] pending_documents init error:', err.message));

// creator_seen: whether the doc creator has seen the approve/reject result (drives the creator banner)
pool.query(`ALTER TABLE pending_documents ADD COLUMN IF NOT EXISTS creator_seen BOOLEAN DEFAULT false`)
  .catch(err => console.error('[GreenInvoice] creator_seen column init error:', err.message));

pool.query(`
  DO $$
  BEGIN
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
    ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('admin','manager','sales','production'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END$$;
`).catch(() => {});

function managerOnly(req, res, next) {
  if (!['admin', 'manager'].includes(req.user.role))
    return res.status(403).json({ error: 'אין הרשאה' });
  next();
}

async function getToken() {
  console.log('[GreenInvoice] Authenticating — key prefix:', (process.env.GREENINVOICE_API_KEY || '').slice(0, 8));
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
  const data  = res.data;
  const token = data.token || data.accessToken || data.jwt || data.access_token;
  if (!token) throw new Error('No token in GreenInvoice auth response: ' + JSON.stringify(data));
  return token;
}

function buildDocPayload(params, lead) {
  const { type, items, docDate, dueDate, paymentDate, paymentMethod } = params;
  const today    = new Date().toISOString().slice(0, 10);
  const docType  = Number(type);
  const needsPmt = [400, 320].includes(docType);
  const total    = (items || []).reduce((sum, it) => sum + Number(it.price) * Number(it.quantity), 0);

  return {
    type:     docType,
    date:     docDate || today,
    lang:     'he',
    currency: 'ILS',
    ...(dueDate ? { dueDate } : {}),
    client: {
      name: lead.orderer_name || lead.name,
      add:  false,
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
        price:    total,
        currency: 'ILS',
      }],
    } : {}),
  };
}

async function createAndSaveDoc(docPayload, leadId, userId) {
  const token   = await getToken();
  const headers = { Authorization: `Bearer ${token}` };

  console.log('[GreenInvoice] Sending payload:', JSON.stringify(docPayload));
  const { data: doc } = await axios.post(`${GI_BASE}/documents`, docPayload, { headers });
  console.log('[GreenInvoice] Doc response:', JSON.stringify(doc));

  const docId     = doc.id;
  const rawUrl    = doc.url;
  const docUrl    = (typeof rawUrl === 'string' ? rawUrl : rawUrl?.origin || rawUrl?.download || rawUrl?.pdf || Object.values(rawUrl || {})[0])
                 || `https://app.greeninvoice.co.il/documents/view/${docId}`;
  const docNumber = doc.number || docId;
  const filename  = `${DOC_NAMES[docPayload.type] || 'מסמך'}-${docNumber}.pdf`;

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
      [leadId, filename, '', storedName, 'application/pdf', userId]
    );
    console.log('[GreenInvoice] PDF saved to files:', filename);
  } catch (pdfErr) {
    console.error('[GreenInvoice] PDF save failed:', pdfErr.message, pdfErr.response?.status, JSON.stringify(pdfErr.response?.data));
  }

  return { docId, docUrl, filename };
}

async function notifyManagers(lead, docType, creatorName) {
  try {
    const { rows: mgrs } = await pool.query(
      `SELECT phone FROM users WHERE role IN ('manager','admin') AND phone IS NOT NULL`
    );
    const label  = DOC_LABELS[docType] || 'מסמך';
    const msg    = `מסמך פיננסי ממתין לאישורך\nסוג: ${label}\nליד: ${lead.name}\nיצר: ${creatorName}`;
    const waUrl  = `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/sendMessage/${process.env.GREEN_API_TOKEN}`;
    for (const { phone } of mgrs) {
      const normalized = normalizePhone(phone);
      if (normalized) await axios.post(waUrl, { chatId: `${normalized}@c.us`, message: msg }).catch(() => {});
    }
    console.log(`[GreenInvoice] Notified ${mgrs.length} manager(s) of pending document`);
  } catch (e) {
    console.error('[GreenInvoice] Manager notification failed:', e.message);
  }
}

// Notify the document creator (via WhatsApp) that their pending document was approved/rejected.
async function notifyCreator(createdBy, docType, leadName, status, comment) {
  try {
    const { rows } = await pool.query(`SELECT phone FROM users WHERE id = $1 AND phone IS NOT NULL`, [createdBy]);
    if (!rows.length) return;
    const label  = DOC_LABELS[Number(docType)] || 'מסמך';
    const verb   = status === 'approved' ? 'אושר' : 'נדחה';
    let msg = `המסמך שלך (${label}, ${leadName}) ${verb}`;
    if (status === 'rejected' && comment) msg += `\nסיבה: ${comment}`;
    const waUrl  = `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/sendMessage/${process.env.GREEN_API_TOKEN}`;
    const normalized = normalizePhone(rows[0].phone);
    if (normalized) await axios.post(waUrl, { chatId: `${normalized}@c.us`, message: msg }).catch(() => {});
    console.log(`[GreenInvoice] Notified creator ${createdBy} that document was ${status}`);
  } catch (e) {
    console.error('[GreenInvoice] Creator notification failed:', e.message);
  }
}

// POST /api/greeninvoice/document
router.post('/document', async (req, res) => {
  const {
    leadId, type, items, docDate, dueDate, paymentDate,
    paymentMethod, sendByEmail, sendByWhatsApp, whatsappMessage, whatsappPhone,
  } = req.body;

  try {
    const { rows } = await pool.query(`
      SELECT l.name, l.phone, l.email,
             c.signer_id_number, c.orderer_name
      FROM leads l
      LEFT JOIN LATERAL (
        SELECT signer_id_number, orderer_name
        FROM contracts
        WHERE lead_id = l.id AND status = 'signed'
        ORDER BY signed_at DESC LIMIT 1
      ) c ON true
      WHERE l.id = $1
    `, [leadId]);

    if (!rows.length) return res.status(404).json({ error: 'Lead not found' });
    const lead = rows[0];

    const isManagerOrAdmin = ['admin', 'manager'].includes(req.user.role);

    if (!isManagerOrAdmin) {
      // Save as pending and notify managers
      const payload = { type, items, docDate, dueDate, paymentDate, paymentMethod, sendByEmail, sendByWhatsApp, whatsappMessage, whatsappPhone };
      await pool.query(
        `INSERT INTO pending_documents (lead_id, created_by, payload) VALUES ($1, $2, $3)`,
        [leadId, req.user.id, JSON.stringify(payload)]
      );
      await notifyManagers(lead, Number(type), req.user.display_name || req.user.username);
      return res.json({ pending: true });
    }

    // Manager/admin — create immediately
    const docPayload = buildDocPayload({ type, items, docDate, dueDate, paymentDate, paymentMethod }, lead);
    const { docId, docUrl, filename } = await createAndSaveDoc(docPayload, leadId, req.user.id);

    // Send via WhatsApp if requested
    if (sendByWhatsApp && (whatsappPhone || lead.phone)) {
      try {
        const phone = normalizePhone(whatsappPhone || lead.phone);
        if (phone) {
          const msg   = [whatsappMessage, docUrl].filter(Boolean).join('\n');
          const waUrl = `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/sendMessage/${process.env.GREEN_API_TOKEN}`;
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

// GET /api/greeninvoice/pending/count — manager/admin only
router.get('/pending/count', managerOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT COUNT(*) FROM pending_documents WHERE status = 'pending'`);
    res.json({ count: Number(rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/greeninvoice/pending — list docs for a lead (any auth user) or all pending (manager only)
router.get('/pending', async (req, res) => {
  const { leadId } = req.query;
  try {
    // Client fields mirror what buildDocPayload() sends to GreenInvoice on approval,
    // so the detail view shows exactly what will be submitted (incl. taxId / ח.פ).
    const clientSelect = `
      u.display_name AS creator_name,
      l.name  AS lead_name,
      l.phone AS client_phone,
      l.email AS client_email,
      c.orderer_name      AS orderer_name,
      c.signer_id_number  AS client_tax_id`;
    const clientJoins = `
      LEFT JOIN users u ON u.id = pd.created_by
      LEFT JOIN leads l ON l.id = pd.lead_id
      LEFT JOIN LATERAL (
        SELECT signer_id_number, orderer_name FROM contracts
        WHERE lead_id = pd.lead_id AND status = 'signed'
        ORDER BY signed_at DESC LIMIT 1
      ) c ON true`;

    if (leadId) {
      const { rows } = await pool.query(
        `SELECT pd.*, ${clientSelect} FROM pending_documents pd ${clientJoins}
         WHERE pd.lead_id = $1 ORDER BY pd.created_at DESC`, [leadId]);
      return res.json(rows);
    }
    // No leadId — manager only
    if (!['admin', 'manager'].includes(req.user.role))
      return res.status(403).json({ error: 'אין הרשאה' });
    const { rows } = await pool.query(
      `SELECT pd.*, ${clientSelect} FROM pending_documents pd ${clientJoins}
       WHERE pd.status = 'pending' ORDER BY pd.created_at DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/greeninvoice/pending/:id/approve
router.post('/pending/:id/approve', managerOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pd.*, l.name, l.phone, l.email, c.signer_id_number, c.orderer_name
       FROM pending_documents pd
       JOIN leads l ON l.id = pd.lead_id
       LEFT JOIN LATERAL (
         SELECT signer_id_number, orderer_name FROM contracts
         WHERE lead_id = l.id AND status = 'signed'
         ORDER BY signed_at DESC LIMIT 1
       ) c ON true
       WHERE pd.id = $1 AND pd.status = 'pending'`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Pending document not found' });

    const pending = rows[0];
    const params  = pending.payload;
    const lead    = { name: pending.name, phone: pending.phone, email: pending.email, signer_id_number: pending.signer_id_number, orderer_name: pending.orderer_name };
    const docPayload = buildDocPayload(params, lead);

    const { docId, docUrl, filename } = await createAndSaveDoc(docPayload, pending.lead_id, req.user.id);

    await pool.query(
      `UPDATE pending_documents SET status='approved', doc_id=$1, doc_url=$2, filename=$3, reviewed_by=$4, reviewed_at=NOW(), creator_seen=false WHERE id=$5`,
      [docId, docUrl, filename, req.user.id, req.params.id]
    );

    notifyCreator(pending.created_by, params.type, pending.name, 'approved');

    // Honour original WhatsApp send preference
    if (params.sendByWhatsApp && (params.whatsappPhone || pending.phone)) {
      try {
        const phone = normalizePhone(params.whatsappPhone || pending.phone);
        if (phone) {
          const msg   = [params.whatsappMessage, docUrl].filter(Boolean).join('\n');
          const waUrl = `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/sendMessage/${process.env.GREEN_API_TOKEN}`;
          await axios.post(waUrl, { chatId: `${phone}@c.us`, message: msg });
          await pool.query(
            `INSERT INTO messages (lead_id, channel, direction, body, timestamp, contact_value, sent_by)
             VALUES ($1, 'whatsapp', 'outbound', $2, NOW(), $3, $4)`,
            [pending.lead_id, msg, phone, req.user.id]
          );
        }
      } catch (waErr) {
        console.error('[GreenInvoice] WhatsApp send on approval failed:', waErr.message);
      }
    }

    res.json({ success: true, documentId: docId, url: docUrl, filename });
  } catch (err) {
    const giData = err.response?.data;
    const status = err.response?.status;
    console.error('[GreenInvoice] Approve HTTP', status, '— body:', JSON.stringify(giData), '— message:', err.message);
    const giMsg = (typeof giData === 'string' ? giData : (giData?.message || giData?.error || JSON.stringify(giData))) || err.message;
    res.status(500).json({ error: `GreenInvoice ${status || ''}: ${giMsg}` });
  }
});

// POST /api/greeninvoice/pending/:id/reject
router.post('/pending/:id/reject', managerOnly, async (req, res) => {
  const { comment } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE pending_documents SET status='rejected', rejection_comment=$1, reviewed_by=$2, reviewed_at=NOW(), creator_seen=false
       WHERE id=$3 AND status='pending'
       RETURNING created_by, payload, lead_id`,
      [comment || null, req.user.id, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Pending document not found' });

    const rej = rows[0];
    const { rows: leadRows } = await pool.query(`SELECT name FROM leads WHERE id = $1`, [rej.lead_id]);
    notifyCreator(rej.created_by, rej.payload?.type, leadRows[0]?.name || '', 'rejected', comment);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/greeninvoice/reviewed-for-me — docs the current user created that were
// approved/rejected and not yet acknowledged (drives the creator banner).
router.get('/reviewed-for-me', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT pd.id, pd.payload, pd.status, pd.rejection_comment, pd.lead_id, l.name AS lead_name
      FROM pending_documents pd
      LEFT JOIN leads l ON l.id = pd.lead_id
      WHERE pd.created_by = $1 AND pd.status IN ('approved','rejected') AND pd.creator_seen = false
      ORDER BY pd.reviewed_at DESC
    `, [req.user.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/greeninvoice/reviewed-for-me/seen — acknowledge all reviewed docs for current user.
router.post('/reviewed-for-me/seen', async (req, res) => {
  try {
    await pool.query(
      `UPDATE pending_documents SET creator_seen = true
       WHERE created_by = $1 AND status IN ('approved','rejected') AND creator_seen = false`,
      [req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
