// Phase 138 — set a new installation's business profile.
//   node server/scripts/setBusiness.js name="ProEvent" kind="חברת תוכנה" city="תל אביב" address="..." email="..."
// Keys: name, kind, city, address, email, maps_url, parking_url. Only the keys given are changed.
require('dotenv').config();
const pool = require('../db/pool');
const ALLOWED = ['name', 'kind', 'city', 'address', 'email', 'maps_url', 'parking_url'];
(async () => {
  try {
    const pairs = process.argv.slice(2).map(a => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; })
      .filter(([k]) => ALLOWED.includes(k));
    if (!pairs.length) { console.error(`usage: node server/scripts/setBusiness.js name="..." kind="..." (${ALLOWED.join(', ')})`); process.exit(1); }
    for (const [k, v] of pairs) {
      await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [`biz_${k}`, v]);
      console.log(`biz_${k} = ${v}`);
    }
  } catch (err) { console.error('failed:', err.message); process.exitCode = 1; }
  finally { await pool.end(); }
})();
