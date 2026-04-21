require('dotenv').config();
const pool = require('../db/pool');
const bcrypt = require('bcryptjs');

const users = [
  { username: 'oran',  display_name: 'אוראן וייס',     role: 'admin',      phone: '0585656560',  password: 'oran123' },
  { username: 'gili',  display_name: 'גילי שרבי',       role: 'sales',      phone: '0528451196',  password: 'gili123' },
  { username: 'shani', display_name: 'שני קיבוביץ',     role: 'sales',      phone: '0526234124',  password: 'shani123' },
  { username: 'orit',  display_name: 'אורית שרבי',      role: 'sales',      phone: '0528421129',  password: 'orit123' },
];

(async () => {
  try {
    for (const u of users) {
      const hash = await bcrypt.hash(u.password, 10);
      await pool.query(
        `INSERT INTO users (username, display_name, role, phone, password_hash)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (username) DO NOTHING`,
        [u.username, u.display_name, u.role, u.phone, hash]
      );
      console.log(`✓ ${u.display_name} (${u.username} / ${u.password})`);
    }
  } catch (err) {
    console.error('Seed failed:', err.message);
  } finally {
    await pool.end();
  }
})();
