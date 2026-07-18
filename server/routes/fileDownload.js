const router = require('express').Router();
const pool = require('../db/pool');
const { getSignedUrl, storedNameFromUrl } = require('../services/storageService');

// GET /api/files/:fileId/url — general signed URL endpoint (used by timeline [[FILE:id|name]] markers)
router.get('/:fileId/url', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT stored_name, url FROM files WHERE id = $1',
      [req.params.fileId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    // Legacy rows: stored_name is NULL but the old public URL carries the name
    const storedName = rows[0].stored_name || storedNameFromUrl(rows[0].url);
    if (!storedName) return res.status(404).json({ error: 'Not found' });
    const url = await getSignedUrl(storedName);
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
