// /api/public — endpoints the marketing landing page calls without a login.
// Only the demo-request form for now. Honeypot + a small per-IP rate limit.
const router = require('express').Router();
const pool   = require('../db/pool');
const { normalizePhone, findLeadByPhone } = require('../utils/phoneUtils');

const hits = new Map(); // ip -> [timestamps]
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60 * 60 * 1000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 5;
}

// POST /api/public/demo-request  { name, phone, business, website (honeypot), page, ref }
router.post('/demo-request', async (req, res) => {
  const { name = '', phone = '', business = '', website = '', page = '', ref = '' } = req.body || {};
  if (website) return res.json({ ok: true });                       // bot filled the hidden field
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
  if (limited(ip)) return res.status(429).json({ error: 'יותר מדי בקשות' });

  const cleanName  = String(name).trim().slice(0, 120);
  const normalized = normalizePhone(String(phone));
  if (cleanName.length < 2 || !normalized || !/^972\d{8,9}$/.test(normalized)) {
    return res.status(400).json({ error: 'שם וטלפון ישראלי תקין נדרשים' });
  }
  const biz = String(business).trim().slice(0, 160);

  try {
    const note = [
      '🌐 פנייה מדף הנחיתה של ProEvent — בקשה לדמו',
      biz ? `שם העסק: ${biz}` : '',
      ref ? `הגיע מ: ${String(ref).slice(0, 200)}` : '',
      page ? `עמוד: ${String(page).slice(0, 200)}` : '',
    ].filter(Boolean).join('\n');

    let leadId = await findLeadByPhone(pool, normalized);
    if (leadId) {
      await pool.query(
        `INSERT INTO lead_interactions (lead_id, type, direction, body, source) VALUES ($1, 'note', 'inbound', $2, 'landing')`,
        [leadId, note]
      );
      await pool.query(`UPDATE leads SET updated_at = NOW() WHERE id = $1`, [leadId]).catch(() => {});
    } else {
      const { rows } = await pool.query(
        `INSERT INTO leads (name, phone, event_type, event_name, stage, source, priority, notes)
         VALUES ($1, $2, 'דמו ProEvent', $3, 'new', 'landing', 'hot', $4) RETURNING id`,
        [cleanName, String(phone).trim(), biz ? `${cleanName} · ${biz}` : cleanName, note]
      );
      leadId = rows[0].id;
      await pool.query(
        `INSERT INTO lead_interactions (lead_id, type, direction, body, source) VALUES ($1, 'note', 'inbound', $2, 'landing')`,
        [leadId, note]
      ).catch(() => {});
    }

    // Tell the admins right away (Green API, same channel as the reminders)
    try {
      const { sendTextToPhones } = require('../services/waOutbound');
      const { rows: admins } = await pool.query(
        `SELECT phone FROM users WHERE (role = 'admin' OR roles @> ARRAY['admin']::text[]) AND blocked = false AND phone IS NOT NULL AND phone <> ''`
      );
      const phones = [...new Set(admins.map(a => normalizePhone(a.phone)).filter(Boolean))];
      const baseUrl = process.env.SERVER_URL || 'https://www.proevent.co.il';
      const msg = `🌐 *ליד חדש מדף הנחיתה של ProEvent*\n${cleanName}${biz ? ` · ${biz}` : ''}\n📞 ${String(phone).trim()}\nרוצה דמו — הבטחנו לחזור עוד היום.\n${baseUrl}/?lead=${leadId}`;
      if (phones.length) sendTextToPhones(phones, msg).catch(() => {});
    } catch (e) { console.error('[public] demo notify failed:', e.message); }

    res.json({ ok: true });
  } catch (err) {
    console.error('[public] demo-request error:', err.message);
    res.status(500).json({ error: 'שגיאה' });
  }
});

module.exports = router;
