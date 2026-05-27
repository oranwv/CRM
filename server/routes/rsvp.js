const router    = require('express').Router();
const pool      = require('../db/pool');
const requireAuth = require('../middleware/auth');
const multer    = require('multer');
const os        = require('os');
const fs        = require('fs');
const { normalizePhone } = require('../utils/phoneUtils');
const { configured, sendTemplate, sendText } = require('../services/metaWhatsapp');

const upload = multer({ dest: os.tmpdir() });

// ── Webhook ──────────────────────────────────────────────────────────────────

router.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === process.env.META_RSVP_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

router.post('/webhook', async (req, res) => {
  res.sendStatus(200); // ack immediately

  try {
    const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!entry?.messages?.length) return;

    for (const msg of entry.messages) {
      const from   = msg.from; // E.164 without +
      const type   = msg.type; // text | button
      const text   = type === 'text'   ? msg.text?.body        : null;
      const payload = type === 'button' ? msg.button?.payload   : null;

      await processIncoming(from, text, payload);
    }
  } catch (err) {
    console.error('[RSVP webhook]', err.message);
  }
});

async function logOutbound(campaignId, guestId, body) {
  await pool.query(
    `INSERT INTO rsvp_messages (campaign_id, guest_id, direction, body) VALUES ($1,$2,'outbound',$3)`,
    [campaignId, guestId, body]
  );
}

async function processIncoming(from, text, buttonPayload) {
  const { rows } = await pool.query(
    `SELECT g.*, c.event_date, c.event_time, c.name AS campaign_name
     FROM rsvp_guests g
     JOIN rsvp_campaigns c ON g.campaign_id = c.id
     WHERE g.phone = $1
       AND g.state NOT IN ('confirmed','declined')
       AND c.status = 'active'
     ORDER BY g.invited_at DESC NULLS LAST, g.created_at DESC
     LIMIT 1`,
    [from]
  );
  if (!rows.length) return;

  const guest = rows[0];
  const raw   = (text || buttonPayload || '').trim();

  // Log inbound
  await pool.query(
    `INSERT INTO rsvp_messages (campaign_id, guest_id, direction, body) VALUES ($1,$2,'inbound',$3)`,
    [guest.campaign_id, guest.id, raw]
  );

  const isYes = buttonPayload === 'yes_attending' || /כן|yes|מגיע|אגיע|בא|באה/i.test(raw);
  const isNo  = buttonPayload === 'no_attending'  || /^לא$|^no$|לא מגיע|לא נגיע|לא יכול|לא יכולה/i.test(raw);

  if (guest.state === 'invited' || guest.state === 'not_sent') {
    if (isYes) {
      await pool.query(
        `UPDATE rsvp_guests SET state='awaiting_count', responded_at=NOW() WHERE id=$1`,
        [guest.id]
      );
      const reply = 'כמה אורחים יגיעו בסך הכל? (כולל אותך)\nענה במספר בלבד.';
      await sendText(from, reply);
      await logOutbound(guest.campaign_id, guest.id, reply);
    } else if (isNo) {
      await pool.query(
        `UPDATE rsvp_guests SET state='declined', responded_at=NOW() WHERE id=$1`,
        [guest.id]
      );
      const reply = 'תודה על הידיעה. נתראה באירועים הבאים!';
      await sendText(from, reply);
      await logOutbound(guest.campaign_id, guest.id, reply);
    }
  } else if (guest.state === 'awaiting_count') {
    const match = raw.match(/\d+/);
    const num   = match ? parseInt(match[0]) : NaN;
    if (!isNaN(num) && num >= 1 && num <= 500) {
      const d = guest.event_date
        ? new Date(guest.event_date).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : '';
      await pool.query(
        `UPDATE rsvp_guests SET state='confirmed', guest_count=$1, responded_at=NOW() WHERE id=$2`,
        [num, guest.id]
      );
      const reply = `תודה! רשמנו ${num} ${num === 1 ? 'אורח' : 'אורחים'}.${d ? ` נתראה ב${d}!` : ''}`;
      await sendText(from, reply);
      await logOutbound(guest.campaign_id, guest.id, reply);
    } else {
      const retry = 'אנא ענה במספר בלבד. כמה אורחים יגיעו?';
      await sendText(from, retry);
      await logOutbound(guest.campaign_id, guest.id, retry);
    }
  }
}

// ── Auth for all routes below ─────────────────────────────────────────────────
router.use(requireAuth);

// ── Campaigns ─────────────────────────────────────────────────────────────────

router.get('/campaigns', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*,
        COUNT(g.id)                                          AS total_guests,
        COUNT(g.id) FILTER (WHERE g.state = 'confirmed')    AS confirmed,
        COUNT(g.id) FILTER (WHERE g.state = 'declined')     AS declined,
        COUNT(g.id) FILTER (WHERE g.state IN ('invited','awaiting_count')) AS pending,
        COUNT(g.id) FILTER (WHERE g.state = 'not_sent')     AS not_sent
      FROM rsvp_campaigns c
      LEFT JOIN rsvp_guests g ON g.campaign_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('[RSVP]', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/campaigns', async (req, res) => {
  const { name, host_name, event_date, event_time, venue_address, template_name, reminder_template_name, event_id } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO rsvp_campaigns (name, host_name, event_date, event_time, venue_address, template_name, reminder_template_name, event_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, host_name, event_date || null, event_time || null, venue_address, template_name || 'rsvp_invitation', reminder_template_name || 'rsvp_reminder', event_id || null, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('[RSVP]', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/campaigns/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*,
        COUNT(g.id)                                          AS total_guests,
        COUNT(g.id) FILTER (WHERE g.state = 'confirmed')    AS confirmed,
        COUNT(g.id) FILTER (WHERE g.state = 'declined')     AS declined,
        COUNT(g.id) FILTER (WHERE g.state IN ('invited','awaiting_count')) AS pending,
        COUNT(g.id) FILTER (WHERE g.state = 'not_sent')     AS not_sent
      FROM rsvp_campaigns c
      LEFT JOIN rsvp_guests g ON g.campaign_id = c.id
      WHERE c.id = $1
      GROUP BY c.id
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/campaigns/:id', async (req, res) => {
  const { name, host_name, event_date, event_time, venue_address, template_name, reminder_template_name, status } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE rsvp_campaigns
       SET name=$1, host_name=$2, event_date=$3, event_time=$4, venue_address=$5,
           template_name=$6, reminder_template_name=$7, status=COALESCE($8, status)
       WHERE id=$9 RETURNING *`,
      [name, host_name, event_date || null, event_time || null, venue_address, template_name, reminder_template_name, status, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Guests ────────────────────────────────────────────────────────────────────

router.get('/campaigns/:id/guests', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM rsvp_guests WHERE campaign_id=$1 ORDER BY created_at`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/campaigns/:id/guests', async (req, res) => {
  const { name, phone } = req.body;
  const normalized = normalizePhone(phone);
  if (!normalized) return res.status(400).json({ error: 'טלפון לא תקין' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO rsvp_guests (campaign_id, name, phone)
       VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING RETURNING *`,
      [req.params.id, name || '', normalized]
    );
    res.json(rows[0] || { skipped: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/campaigns/:id/guests/:guestId', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM rsvp_guests WHERE id=$1 AND campaign_id=$2`,
      [req.params.guestId, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/campaigns/:id/guests/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  let xlsx;
  try {
    xlsx = require('xlsx');
  } catch {
    fs.unlinkSync(req.file.path);
    return res.status(500).json({ error: 'xlsx library not installed — run npm install' });
  }
  try {
    const wb   = xlsx.readFile(req.file.path);
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(ws, { defval: '' });
    fs.unlinkSync(req.file.path);

    const findCol = (row, candidates) => {
      for (const c of candidates) if (row[c] !== undefined) return c;
      return null;
    };

    if (!data.length) return res.json({ imported: 0, skipped: 0 });

    const nameKey  = findCol(data[0], ['שם', 'name', 'שם אורח', 'שם מלא']) || Object.keys(data[0])[0];
    const phoneKey = findCol(data[0], ['טלפון', 'phone', 'מספר טלפון', 'נייד']) || Object.keys(data[0])[1];

    let imported = 0, skipped = 0;
    for (const row of data) {
      const name  = String(row[nameKey]  || '').trim();
      const phone = String(row[phoneKey] || '').trim();
      const normalized = normalizePhone(phone);
      if (!normalized) { skipped++; continue; }

      const { rowCount } = await pool.query(
        `INSERT INTO rsvp_guests (campaign_id, name, phone)
         VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING`,
        [req.params.id, name, normalized]
      );
      rowCount > 0 ? imported++ : skipped++;
    }
    res.json({ imported, skipped });
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch {}
    console.error('[RSVP import]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Bulk actions ──────────────────────────────────────────────────────────────

router.post('/campaigns/:id/send', async (req, res) => {
  if (!configured()) return res.status(503).json({ error: 'Meta WhatsApp credentials not configured' });

  const { rows: campaign } = await pool.query(`SELECT * FROM rsvp_campaigns WHERE id=$1`, [req.params.id]);
  if (!campaign.length) return res.status(404).json({ error: 'not found' });
  const c = campaign[0];

  const { rows: guests } = await pool.query(
    `SELECT * FROM rsvp_guests WHERE campaign_id=$1 AND state='not_sent'`,
    [req.params.id]
  );

  let sent = 0, failed = 0;
  const templateName = c.template_name || process.env.META_RSVP_INVITATION_TEMPLATE || 'rsvp_invitation';
  const dateStr = c.event_date ? new Date(c.event_date).toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit', year:'numeric' }) : '';

  for (const g of guests) {
    try {
      await sendTemplate(g.phone, templateName, [
        g.name || 'אורח',
        c.host_name || '',
        dateStr,
        c.event_time || '',
        c.venue_address || '',
      ]);
      await pool.query(
        `UPDATE rsvp_guests SET state='invited', invited_at=NOW() WHERE id=$1`,
        [g.id]
      );
      const logBody = `[הזמנה] ${templateName} → ${g.phone}`;
      await pool.query(
        `INSERT INTO rsvp_messages (campaign_id, guest_id, direction, body) VALUES ($1,$2,'outbound',$3)`,
        [c.id, g.id, logBody]
      );
      sent++;
      // Small delay to respect rate limits
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.error(`[RSVP send] guest ${g.id}:`, err.message);
      failed++;
    }
  }

  // Mark campaign active if it was draft
  if (c.status === 'draft' && sent > 0) {
    await pool.query(`UPDATE rsvp_campaigns SET status='active' WHERE id=$1`, [c.id]);
  }

  res.json({ sent, failed });
});

router.post('/campaigns/:id/remind', async (req, res) => {
  if (!configured()) return res.status(503).json({ error: 'Meta WhatsApp credentials not configured' });

  const { rows: campaign } = await pool.query(`SELECT * FROM rsvp_campaigns WHERE id=$1`, [req.params.id]);
  if (!campaign.length) return res.status(404).json({ error: 'not found' });
  const c = campaign[0];

  const { rows: guests } = await pool.query(
    `SELECT * FROM rsvp_guests WHERE campaign_id=$1 AND state='invited'`,
    [req.params.id]
  );

  let sent = 0, failed = 0;
  const templateName = c.reminder_template_name || process.env.META_RSVP_REMINDER_TEMPLATE || 'rsvp_reminder';
  const dateStr = c.event_date ? new Date(c.event_date).toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit', year:'numeric' }) : '';

  for (const g of guests) {
    try {
      await sendTemplate(g.phone, templateName, [
        g.name || 'אורח',
        c.host_name || '',
        dateStr,
      ]);
      const logBody = `[תזכורת] ${templateName} → ${g.phone}`;
      await pool.query(
        `INSERT INTO rsvp_messages (campaign_id, guest_id, direction, body) VALUES ($1,$2,'outbound',$3)`,
        [c.id, g.id, logBody]
      );
      sent++;
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.error(`[RSVP remind] guest ${g.id}:`, err.message);
      failed++;
    }
  }

  res.json({ sent, failed });
});

// ── Export ────────────────────────────────────────────────────────────────────

router.get('/campaigns/:id/export', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.name, g.phone, g.state, g.guest_count, g.invited_at, g.responded_at
       FROM rsvp_guests g
       WHERE g.campaign_id=$1
       ORDER BY g.state, g.name`,
      [req.params.id]
    );

    const STATE_HE = {
      not_sent: 'לא נשלח',
      invited: 'ממתין',
      awaiting_count: 'ממתין למספר',
      confirmed: 'אישר',
      declined: 'לא מגיע',
    };

    const formatDate = d => d ? new Date(d).toLocaleString('he-IL', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '';

    const lines = [
      ['שם', 'טלפון', 'סטטוס', 'מגיעים', 'נשלח ב', 'עדכון אחרון'].join(','),
      ...rows.map(r => [
        `"${(r.name || '').replace(/"/g, '""')}"`,
        r.phone,
        STATE_HE[r.state] || r.state,
        r.guest_count || '',
        formatDate(r.invited_at),
        formatDate(r.responded_at),
      ].join(',')),
    ];

    const csv = '﻿' + lines.join('\n'); // BOM for Hebrew in Excel
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rsvp-${req.params.id}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Message log ───────────────────────────────────────────────────────────────

router.get('/campaigns/:id/messages', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.*, g.name AS guest_name, g.phone AS guest_phone
       FROM rsvp_messages m
       LEFT JOIN rsvp_guests g ON m.guest_id = g.id
       WHERE m.campaign_id=$1
       ORDER BY m.created_at DESC
       LIMIT 200`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
