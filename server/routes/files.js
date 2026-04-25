const express = require('express');
const multer  = require('multer');
const os      = require('os');
const fs      = require('fs');
const pool    = require('../db/pool');
const { uploadFile, deleteFile, getSignedUrl } = require('../services/storageService');

const router = express.Router({ mergeParams: true });
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 20 * 1024 * 1024 } });

// GET /api/leads/:leadId/files
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.*, u.display_name AS uploaded_by_name
       FROM files f LEFT JOIN users u ON u.id = f.uploaded_by
       WHERE f.lead_id = $1 ORDER BY f.created_at DESC`,
      [req.params.leadId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/:leadId/files
router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'לא נשלח קובץ' });
  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  try {
    const { storedName } = await uploadFile(req.file.path, originalName, req.file.mimetype);
    fs.unlinkSync(req.file.path);

    const { rows } = await pool.query(
      `INSERT INTO files (lead_id, filename, url, stored_name, file_type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.leadId, originalName, '', storedName, req.file.mimetype, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leads/:leadId/files/:fileId/url — returns a 60-second signed URL
router.get('/:fileId/url', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT stored_name FROM files WHERE id = $1 AND lead_id = $2',
      [req.params.fileId, req.params.leadId]
    );
    if (!rows.length || !rows[0].stored_name) return res.status(404).json({ error: 'Not found' });
    const url = await getSignedUrl(rows[0].stored_name);
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/leads/:leadId/files/:fileId
router.delete('/:fileId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM files WHERE id = $1 AND lead_id = $2 RETURNING *',
      [req.params.fileId, req.params.leadId]
    );
    if (rows[0]?.stored_name) {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      await supabase.storage.from('crm-files').remove([rows[0].stored_name]);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
