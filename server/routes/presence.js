const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');

// POST /api/presence/ping — record a heartbeat for the current user.
// Extends the user's latest session if the previous ping was within the 30-minute
// gap window; otherwise opens a new session. 30 min is the work-session break threshold
// (Oran, 2026-11-10 — it was 2 hours, which turned scattered glances at the phone into one
// long "work day": 210 h in a month). A session's span is first_ping → last_ping.
router.post('/ping', async (req, res) => {
  try {
    await pool.query(
      `WITH latest AS (
         SELECT id FROM user_sessions
         WHERE user_id = $1 AND last_ping_at >= NOW() - INTERVAL '30 minutes'
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
