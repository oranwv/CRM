// Phase 138 — who this installation belongs to. Texts that used to say "שרביה" ask biz() instead.
//
// Sharviya's installation (no INSTANCE_ID) gets exactly the values that were hard-coded before,
// and ignores the settings table — nothing it sends or tells the AI changes.
// A new installation (INSTANCE_ID set) reads its own profile from settings (keys biz_*; the name
// falls back to business_name) and refreshes it every minute. Set it with scripts/setBusiness.js.
const pool = require('../db/pool');

const LEGACY = {
  name: 'שרביה',
  kind: 'אולם אירועים',
  city: 'תל אביב',
  address: 'פנחס בן יאיר 3, תל אביב',
  venueAddress: 'רבי פנחס בן יאיר 3, תל אביב-יפו',
  mapsUrl: 'https://maps.google.com/?q=Pinhas+Ben+Yair+3,+Tel+Aviv-Yafo',
  parkingUrl: 'https://sharabiya.co.il/%D7%97%D7%A0%D7%99%D7%94-%D7%95%D7%93%D7%A8%D7%9B%D7%99-%D7%94%D7%92%D7%A2%D7%94/',
  email: 'sharabiyajaffa@gmail.com',
};
const BLANK = { name: 'העסק', kind: 'עסק', city: '', address: '', venueAddress: '', mapsUrl: '', parkingUrl: '', email: '' };

const isLegacy = () => !(process.env.INSTANCE_ID || '').trim();
let current = withLocation(isLegacy() ? LEGACY : BLANK);

function withLocation(p) {
  return { ...p, location: [p.name, p.address].filter(Boolean).join(', ') };
}

async function refresh() {
  if (isLegacy()) return current;
  try {
    const { rows } = await pool.query("SELECT key, value FROM settings WHERE key LIKE 'biz\\_%' OR key = 'business_name'");
    const s = Object.fromEntries(rows.map(r => [r.key, (r.value || '').trim()]));
    current = withLocation({
      name: s.biz_name || s.business_name || BLANK.name,
      kind: s.biz_kind || BLANK.kind,
      city: s.biz_city || '',
      address: s.biz_address || '',
      venueAddress: s.biz_address || '',
      mapsUrl: s.biz_maps_url || '',
      parkingUrl: s.biz_parking_url || '',
      email: s.biz_email || '',
    });
  } catch { /* table not there yet on a first boot — keep what we have */ }
  return current;
}

if (!isLegacy()) {
  refresh();
  setInterval(refresh, 60 * 1000).unref();
}

const biz = () => current;
module.exports = { biz, refresh };
