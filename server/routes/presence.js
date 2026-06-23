const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');

// POST /api/presence/ping — record a heartbeat for the current user.
// Extends the user's latest session if the previous ping was within the 2-hour
// gap window; otherwise opens a new session. The 2h gap is the work-session
// break threshold (an idle gap longer than that starts a fresh session), and a
// session's span is first_ping → last_ping.
router.post('/ping', async (req, res) => {
  try {
    await pool.query(
      `WITH latest AS (
         SELECT id FROM user_sessions
         WHERE user_id = $1 AND last_ping_at >= NOW() - INTERVAL '2 hours'
         ORDER BY last_ping_at DESC LIMIT 1
       ), upd AS (
         UPDATE user_sessions SET last_ping_at = NOW()
         WHERE id IN (SELECT id FROM latest) RETURNING id
       )
       INSERT INTO user_sessions (user_id, started_at, last_ping_at)
       SELECT $1, NOW(), NOW() WHERE NOT EXISTS (SELECT 1 FROM upd)`,
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
