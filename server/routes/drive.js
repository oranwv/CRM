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
    console.error('[Drive] list error:', JSON.stringify(err.response?.data || err.message));
    res.status(500).json({ error: err.message, detail: err.response?.data });
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

async function debugHandler(req, res) {
  const out = {};

  try {
    const raw = fs.readFileSync(path.join(__dirname, '../credentials.json'), 'utf-8');
    const creds = JSON.parse(raw);
    const inner = creds.installed || creds.web || creds;
    out.credentials = {
      topLevelKeys: Object.keys(creds),
      client_id_prefix: (inner.client_id || '').slice(0, 12),
      has_client_secret: !!(inner.client_secret),
    };
  } catch (e) { out.credentials = { error: e.message }; }

  try {
    const tokenPath = path.join(__dirname, '../google_token.json');
    const raw = fs.readFileSync(tokenPath, 'utf-8');
    const tok = JSON.parse(raw);
    out.token = {
      keys: Object.keys(tok),
      scope: tok.scope || '(none)',
      has_refresh_token: !!tok.refresh_token,
      expired: tok.expiry_date ? tok.expiry_date < Date.now() : 'no expiry_date',
    };
  } catch (e) { out.token = { error: e.message }; }

  try {
    const { getAuth } = require('../services/gmailService');
    const { google } = require('googleapis');
    const auth = getAuth();
    const drive = google.drive({ version: 'v3', auth });
    const r = await drive.about.get({ fields: 'user' });
    out.driveTest = { ok: true, user: r.data?.user?.emailAddress };
  } catch (e) {
    out.driveTest = { error: e.message, detail: e.response?.data };
  }

  res.json(out);
}

module.exports.debugHandler = debugHandler;
