const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../db/pool');

const router = express.Router({ mergeParams: true });

const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

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
  const url = `/uploads/${req.file.filename}`;
  const fileType = req.file.mimetype;
  try {
    const { rows } = await pool.query(
      `INSERT INTO files (lead_id, filename, url, file_type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.leadId, Buffer.from(req.file.originalname, 'latin1').toString('utf8'), url, fileType, req.user.id]
    );
    res.status(201).json(rows[0]);
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
    if (rows[0]) {
      const filePath = path.join(__dirname, '../../', rows[0].url);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
