const router  = require('express').Router();
const multer  = require('multer');
const os      = require('os');
const fs      = require('fs');
const axios   = require('axios');
const FormData = require('form-data');
const pool    = require('../db/pool');
const { uploadFile, getSignedUrl } = require('../services/storageService');
const { normalizePhone } = require('../utils/phoneUtils');

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 20 * 1024 * 1024 } });

// GET /api/suppliers/categories
router.get('/categories', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM supplier_categories ORDER BY sort_order, name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/suppliers/categories
router.post('/categories', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'שם קטגוריה חסר' });
    const { rows } = await pool.query(
      `INSERT INTO supplier_categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING *`,
      [name.trim()]
    );
    res.status(201).json(rows[0] || { name: name.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/suppliers/categories/:id
router.delete('/categories/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM supplier_categories WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/suppliers
router.get('/', async (req, res) => {
  try {
    const { category } = req.query;
    const params = [];
    let where = '';
    if (category) { params.push(category); where = `WHERE s.category = $1`; }
    const { rows } = await pool.query(
      `SELECT s.*, u.display_name AS created_by_name
       FROM suppliers s LEFT JOIN users u ON u.id = s.created_by
       ${where} ORDER BY s.name`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/suppliers/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM suppliers WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/suppliers
router.post('/', async (req, res) => {
  try {
    const { name, phone, email, description, category } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'שם ספק חסר' });
    const { rows } = await pool.query(
      `INSERT INTO suppliers (name, phone, email, description, category, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name.trim(), phone || null, email || null, description || null, category || 'כללי', req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/suppliers/:id
router.put('/:id', async (req, res) => {
  try {
    const { name, phone, email, description, category } = req.body;
    const { rows } = await pool.query(
      `UPDATE suppliers SET name=$1, phone=$2, email=$3, description=$4, category=$5, updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [name, phone || null, email || null, description || null, category || 'כללי', req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/suppliers/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM suppliers WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/suppliers/:id/events — linked leads
router.get('/:id/events', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.id, l.name, l.event_date, l.event_type, l.stage
       FROM lead_suppliers ls JOIN leads l ON l.id = ls.lead_id
       WHERE ls.supplier_id = $1 ORDER BY l.event_date DESC NULLS LAST`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/suppliers/:id/interactions
router.get('/:id/interactions', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT si.*, u.display_name AS created_by_name,
              sf.filename AS file_name, sf.file_type AS file_mime, sf.id AS file_id
       FROM supplier_interactions si
       LEFT JOIN users u ON u.id = si.created_by
       LEFT JOIN supplier_files sf ON sf.id = si.file_id
       WHERE si.supplier_id = $1 ORDER BY si.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/suppliers/:id/interactions
router.post('/:id/interactions', upload.single('file'), async (req, res) => {
  try {
    const { type, body, direction } = req.body;
    if (!type || !body?.trim()) return res.status(400).json({ error: 'סוג ותוכן נדרשים' });

    let file_id = null;
    let fileRow = null;

    if (req.file) {
      const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      const source = type === 'call' ? 'שיחה' : 'הערה';
      const { storedName } = await uploadFile(req.file.path, originalName, req.file.mimetype);
      fs.unlinkSync(req.file.path);
      const { rows: fRows } = await pool.query(
        `INSERT INTO supplier_files (supplier_id, filename, stored_name, file_type, uploaded_by, source)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [req.params.id, originalName, storedName, req.file.mimetype, req.user.id, source]
      );
      fileRow = fRows[0];
      file_id = fileRow.id;
    }

    const { rows } = await pool.query(
      `INSERT INTO supplier_interactions (supplier_id, type, direction, body, created_by, file_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.id, type, direction || 'outbound', body.trim(), req.user.id, file_id]
    );
    res.status(201).json({
      ...rows[0],
      created_by_name: req.user.display_name,
      file_name: fileRow?.filename || null,
      file_mime: fileRow?.file_type || null,
      file_id: file_id,
    });
  } catch (err) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/suppliers/:id/interactions/:intId
router.delete('/:id/interactions/:intId', async (req, res) => {
  try {
    await pool.query('DELETE FROM supplier_interactions WHERE id = $1 AND supplier_id = $2', [req.params.intId, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/suppliers/:id/files
router.get('/:id/files', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT sf.*, u.display_name AS uploaded_by_name
       FROM supplier_files sf LEFT JOIN users u ON u.id = sf.uploaded_by
       WHERE sf.supplier_id = $1 ORDER BY sf.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/suppliers/:id/files
router.post('/:id/files', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'לא נשלח קובץ' });
  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  try {
    const { storedName } = await uploadFile(req.file.path, originalName, req.file.mimetype);
    fs.unlinkSync(req.file.path);
    const { rows } = await pool.query(
      `INSERT INTO supplier_files (supplier_id, filename, stored_name, file_type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.id, originalName, storedName, req.file.mimetype, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: err.message });
  }
});

// GET /api/suppliers/:id/files/:fileId/url
router.get('/:id/files/:fileId/url', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT stored_name FROM supplier_files WHERE id = $1 AND supplier_id = $2',
      [req.params.fileId, req.params.id]
    );
    if (!rows.length || !rows[0].stored_name) return res.status(404).json({ error: 'Not found' });
    const url = await getSignedUrl(rows[0].stored_name);
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/suppliers/:id/files/:fileId
router.delete('/:id/files/:fileId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM supplier_files WHERE id = $1 AND supplier_id = $2 RETURNING *',
      [req.params.fileId, req.params.id]
    );
    if (rows[0]?.stored_name) {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      await supabase.storage.from('crm-files').remove([rows[0].stored_name]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/suppliers/:id/whatsapp-file
router.post('/:id/whatsapp-file', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'לא נשלח קובץ' });
  const { message = '' } = req.body;
  try {
    const { rows: sRows } = await pool.query('SELECT phone FROM suppliers WHERE id = $1', [req.params.id]);
    if (!sRows.length) return res.status(404).json({ error: 'ספק לא נמצא' });
    const phone = normalizePhone(sRows[0].phone);
    if (!phone) return res.status(400).json({ error: 'אין מספר טלפון לספק' });

    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const mime = req.file.mimetype;

    // Upload to Green API first (while temp file still exists)
    const uploadFd = new FormData();
    uploadFd.append('file', fs.createReadStream(req.file.path), { filename: originalName, contentType: mime });
    const uploadUrl = `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/uploadFile/${process.env.GREEN_API_TOKEN}`;
    const uploadRes = await axios.post(uploadUrl, uploadFd, { headers: uploadFd.getHeaders() });
    const urlFile = uploadRes.data.urlFile;

    // Save to Supabase
    const { storedName } = await uploadFile(req.file.path, originalName, mime);
    fs.unlinkSync(req.file.path);

    // Send via WhatsApp
    const sendUrl = `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}/sendFileByUrl/${process.env.GREEN_API_TOKEN}`;
    await new Promise(r => setTimeout(r, 300));
    await axios.post(sendUrl, { chatId: `${phone}@c.us`, urlFile, fileName: originalName, caption: message });

    // Persist file
    const { rows: fRows } = await pool.query(
      `INSERT INTO supplier_files (supplier_id, filename, stored_name, file_type, uploaded_by, source)
       VALUES ($1, $2, $3, $4, $5, 'whatsapp') RETURNING *`,
      [req.params.id, originalName, storedName, mime, req.user.id]
    );
    const fileRow = fRows[0];

    // Log interaction
    const body = message ? `${message} [${originalName}]` : originalName;
    const { rows: iRows } = await pool.query(
      `INSERT INTO supplier_interactions (supplier_id, type, direction, body, created_by, file_id)
       VALUES ($1, 'whatsapp', 'outbound', $2, $3, $4) RETURNING *`,
      [req.params.id, body, req.user.id, fileRow.id]
    );

    res.status(201).json({
      interaction: { ...iRows[0], created_by_name: req.user.display_name, file_name: originalName, file_mime: mime, file_id: fileRow.id },
      file: fileRow,
    });
  } catch (err) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
