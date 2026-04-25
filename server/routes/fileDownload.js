const router = require('express').Router();
const pool = require('../db/pool');
const { getSignedUrl } = require('../services/storageService');

// GET /api/files/:fileId/url — general signed URL endpoint (used by timeline [[FILE:id|name]] markers)
router.get('/:fileId/url', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT stored_name FROM files WHERE id = $1',
      [req.params.fileId]
    );
    if (!rows.length || !rows[0].stored_name) return res.status(404).json({ error: 'Not found' });
    const url = await getSignedUrl(rows[0].stored_name);
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
