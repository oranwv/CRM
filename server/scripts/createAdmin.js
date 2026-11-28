// Phase 137 — first user of a new installation.
//   node server/scripts/createAdmin.js <username> "<display name>" [email] [phone]
// Creates an admin with a random password and prints it ONCE. Refuses when the user name exists.
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

(async () => {
  const [username, displayName, email, phone] = process.argv.slice(2);
  if (!username || !displayName) {
    console.error('usage: node server/scripts/createAdmin.js <username> "<display name>" [email] [phone]');
    process.exit(1);
  }
  try {
    const { rows } = await pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
    if (rows.length) { console.error(`user "${username}" already exists`); process.exit(1); }
    const password = crypto.randomBytes(9).toString('base64url');
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO users (username, display_name, email, phone, role, roles, password_hash)
       VALUES ($1, $2, $3, $4, 'admin', ARRAY['admin']::text[], $5)`,
      [username, displayName, email || null, phone || null, hash]);
    console.log(`created admin "${username}" — password (shown once): ${password}`);
  } catch (err) {
    console.error('failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
