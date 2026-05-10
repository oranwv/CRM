const router = require('express').Router();
const pool = require('../db/pool');
const { listFilesInFolder, getFileMeta } = require('../services/driveService');
const fs = require('fs');
const path = require('path');

// GET /api/drive/folders — list configured folders from settings
router.get('/folders', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'drive_folders'`);
    const folders = rows[0]?.value ? JSON.parse(rows[0].value) : [];
    res.json(folders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/drive/folders/:folderId/files — list files in a folder
router.get('/folders/:folderId/files', async (req, res) => {
  const tokenPath = path.join(__dirname, '../google_token.json');
  if (!fs.existsSync(tokenPath)) return res.status(503).json({ error: 'Google Drive not authorized' });
  try {
    const files = await listFilesInFolder(req.params.folderId);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/drive/files/:fileId/meta — get file metadata
router.get('/files/:fileId/meta', async (req, res) => {
  const tokenPath = path.join(__dirname, '../google_token.json');
  if (!fs.existsSync(tokenPath)) return res.status(503).json({ error: 'Google Drive not authorized' });
  try {
    const meta = await getFileMeta(req.params.fileId);
    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
