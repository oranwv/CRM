const { Pool } = require('pg');

// Supabase's session-mode pooler allows 15 clients for the whole project. During a Railway
// deploy the old and the new instance run side by side, so each one is capped well below half
// of that, and idle connections are handed back quickly instead of being held open.
module.exports = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.DB_POOL_MAX) || 6,
  idleTimeoutMillis: 10000,
});
