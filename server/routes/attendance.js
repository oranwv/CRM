// Phase 84 — נוכחות: NFC clock-in/out + vacation & sick days.
//
// A passive NFC tag at the entrance / on the bar holds `https://<site>/clock?t=<token>`. Tapping
// the phone opens that page, which calls POST /punch right away: no open shift → clock-in, open
// shift → clock-out (Oran: "ההחתמה מיד בהצמדה"). Because the URL can be saved and opened from
// anywhere, a punch carries the phone's GPS position and a per-browser device id:
//   - outside the venue radius            → refused
//   - no position (permission refused…)   → saved, flagged 'no_location', waits for a manager
//   - a phone the user never punched from → saved, flagged 'new_device', waits for a manager
// Vacation and sick days are entered by the employee and BOTH need a manager's approval (his
// decision, 2026-11-14). Any admin / manager user approves.
// Nothing here is ever hard-deleted: a cancelled punch is status 'void', every manual change is
// kept in attendance_edits (attendance records must be kept for years).
const router = require('express').Router();
const crypto = require('crypto');
const multer = require('multer');
const pool   = require('../db/pool');
const { uploadBuffer, getSignedUrl } = require('../services/storageService');
const { queueNudge } = require('../services/taskNudgeService');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS attendance_tags (
    id SERIAL PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS attendance_shifts (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    clock_in_at TIMESTAMPTZ NOT NULL,
    clock_out_at TIMESTAMPTZ,
    in_tag_id INT REFERENCES attendance_tags(id) ON DELETE SET NULL,
    out_tag_id INT REFERENCES attendance_tags(id) ON DELETE SET NULL,
    in_lat DOUBLE PRECISION, in_lng DOUBLE PRECISION, in_accuracy_m REAL,
    out_lat DOUBLE PRECISION, out_lng DOUBLE PRECISION, out_accuracy_m REAL,
    in_device TEXT, out_device TEXT,
    in_flag TEXT, out_flag TEXT,
    status TEXT NOT NULL DEFAULT 'ok',
    source TEXT NOT NULL DEFAULT 'nfc',
    missing_out BOOLEAN DEFAULT FALSE,
    missing_alerted_at TIMESTAMPTZ,
    last_punch_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS attendance_shifts_user_in ON attendance_shifts (user_id, clock_in_at);
  CREATE TABLE IF NOT EXISTS attendance_edits (
    id SERIAL PRIMARY KEY,
    shift_id INT NOT NULL REFERENCES attendance_shifts(id) ON DELETE CASCADE,
    edited_by INT REFERENCES users(id) ON DELETE SET NULL,
    edited_at TIMESTAMPTZ DEFAULT NOW(),
    reason TEXT,
    old_in TIMESTAMPTZ, old_out TIMESTAMPTZ, new_in TIMESTAMPTZ, new_out TIMESTAMPTZ,
    old_status TEXT, new_status TEXT
  );
  CREATE TABLE IF NOT EXISTS attendance_fix_requests (
    id SERIAL PRIMARY KEY,
    shift_id INT NOT NULL REFERENCES attendance_shifts(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    proposed_in TIMESTAMPTZ, proposed_out TIMESTAMPTZ,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    decided_by INT REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS attendance_absences (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    days NUMERIC NOT NULL,
    half_day BOOLEAN DEFAULT FALSE,
    note TEXT,
    file_name TEXT, file_stored TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    decided_by INT REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ,
    decide_note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS attendance_devices (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    approved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, device_id)
  );
  ALTER TABLE users ADD COLUMN IF NOT EXISTS attendance_enabled BOOLEAN DEFAULT FALSE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS vacation_quota_days NUMERIC DEFAULT 0;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS vacation_opening NUMERIC DEFAULT 0;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS sick_opening NUMERIC DEFAULT 0;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS balance_date DATE;
`;

// ---- helpers ---------------------------------------------------------------------------------
const IL = 'Asia/Jerusalem';
const DOUBLE_TAP_SEC = 120;   // a second tap this soon after a punch changes nothing
const UNDO_SEC       = 20;    // the client shows 10 s; a little slack for a slow network
const SICK_PER_MONTH = 1.5;   // חוק דמי מחלה: 1.5 days per full month…
const SICK_CAP       = 90;    // …up to 90
const DEFAULTS = { att_radius_m: '150', att_open_shift_h: '14' };

const rolesOf   = u => (u.roles?.length ? u.roles : [u.role]).filter(Boolean);
const isManager = u => rolesOf(u).some(r => r === 'admin' || r === 'manager');
function managerOnly(req, res, next) {
  if (!isManager(req.user)) return res.status(403).json({ error: 'אין הרשאה' });
  next();
}
const baseUrl = () => process.env.SERVER_URL || 'https://www.proevent.co.il';
const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
const hhmm = d => new Intl.DateTimeFormat('he-IL', { timeZone: IL, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));
const dmy  = d => new Intl.DateTimeFormat('he-IL', { timeZone: IL, day: 'numeric', month: 'numeric' }).format(new Date(d));
const validMonth = m => (/^\d{4}-(0[1-9]|1[0-2])$/.test(m || '') ? m : null);
const validDate  = d => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') && !isNaN(Date.parse(d)) ? d : null);

async function getSettings() {
  const { rows } = await pool.query(`SELECT key, value FROM settings WHERE key LIKE 'att\\_%'`);
  const s = { ...DEFAULTS };
  rows.forEach(r => { s[r.key] = r.value; });
  return {
    lat: num(s.att_venue_lat), lng: num(s.att_venue_lng),
    radius_m: num(s.att_radius_m) || 150,
    open_shift_h: num(s.att_open_shift_h) || 14,
  };
}

// Metres between two positions (haversine).
function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function managerIds() {
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE NOT COALESCE(blocked, false) AND (roles && ARRAY['admin','manager']::text[] OR role = 'admin')`);
  return rows.map(r => r.id);
}
async function notifyManagers(text, exceptId) {
  try { (await managerIds()).filter(id => id !== exceptId).forEach(id => queueNudge(id, `${text}\n${baseUrl()}/attendance`)); }
  catch (err) { console.error('[Attendance] notifyManagers:', err.message); }
}
const notifyUser = (userId, text) => queueNudge(userId, `${text}\n${baseUrl()}/my-hours`);

// Full months between a date and today (Israel), never negative.
const MONTHS_SINCE = `GREATEST(0, (DATE_PART('year', AGE((NOW() AT TIME ZONE '${IL}')::date, u.balance_date)) * 12
                                 + DATE_PART('month', AGE((NOW() AT TIME ZONE '${IL}')::date, u.balance_date)))::int)`;
// Balances: opening balance (true on balance_date) + accrual per full month since − approved days since.
async function balancesFor(userIds) {
  if (!userIds.length) return {};
  const { rows } = await pool.query(
    `SELECT u.id, u.vacation_quota_days, u.vacation_opening, u.sick_opening, u.balance_date,
            CASE WHEN u.balance_date IS NULL THEN 0 ELSE ${MONTHS_SINCE} END AS months,
            COALESCE((SELECT SUM(a.days) FROM attendance_absences a WHERE a.user_id = u.id AND a.status = 'approved' AND a.type = 'vacation'
                       AND (u.balance_date IS NULL OR a.from_date >= u.balance_date)), 0) AS vac_used,
            COALESCE((SELECT SUM(a.days) FROM attendance_absences a WHERE a.user_id = u.id AND a.status = 'approved' AND a.type = 'sick'
                       AND (u.balance_date IS NULL OR a.from_date >= u.balance_date)), 0) AS sick_used
     FROM users u WHERE u.id = ANY($1::int[])`, [userIds]);
  const out = {};
  rows.forEach(r => {
    const months = Number(r.months) || 0;
    const vacation = Number(r.vacation_opening || 0) + months * Number(r.vacation_quota_days || 0) / 12 - Number(r.vac_used);
    const sick = Math.min(SICK_CAP, Number(r.sick_opening || 0) + months * SICK_PER_MONTH) - Number(r.sick_used);
    out[r.id] = { vacation: Math.round(vacation * 100) / 100, sick: Math.round(sick * 100) / 100, set: !!r.balance_date };
  });
  return out;
}

const SHIFT_COLS = `s.id, s.user_id, s.clock_in_at, s.clock_out_at, s.in_flag, s.out_flag, s.status, s.source, s.missing_out,
  (s.clock_in_at AT TIME ZONE '${IL}')::date::text AS day,
  ti.label AS in_tag, tx.label AS out_tag,
  CASE WHEN s.clock_out_at IS NOT NULL THEN ROUND(EXTRACT(EPOCH FROM (s.clock_out_at - s.clock_in_at)) / 60) END AS minutes`;
const SHIFT_JOIN = `attendance_shifts s LEFT JOIN attendance_tags ti ON ti.id = s.in_tag_id LEFT JOIN attendance_tags tx ON tx.id = s.out_tag_id`;

async function shiftById(id) {
  const { rows } = await pool.query(`SELECT ${SHIFT_COLS} FROM ${SHIFT_JOIN} WHERE s.id = $1`, [id]);
  return rows[0] || null;
}
async function openShift(userId) {
  const { rows } = await pool.query(
    `SELECT ${SHIFT_COLS}, s.last_punch_at FROM ${SHIFT_JOIN}
     WHERE s.user_id = $1 AND s.clock_out_at IS NULL AND s.status <> 'void' AND NOT s.missing_out
     ORDER BY s.clock_in_at DESC LIMIT 1`, [userId]);
  return rows[0] || null;
}
async function userRow(id) {
  const { rows } = await pool.query(`SELECT id, display_name, username, attendance_enabled FROM users WHERE id = $1 AND NOT COALESCE(blocked, false)`, [id]);
  return rows[0] || null;
}
const nameOf = u => u?.display_name || u?.username || 'עובד';

// ---- employee --------------------------------------------------------------------------------

// GET /status — what the nav needs: does this user clock, is he a manager, how much is waiting.
router.get('/status', async (req, res) => {
  try {
    const me = await userRow(req.user.id);
    const manager = isManager(req.user);
    let pending = 0;
    if (manager) pending = (await pendingItems()).length;
    const open = me?.attendance_enabled ? await openShift(req.user.id) : null;
    res.json({ enabled: !!me?.attendance_enabled, manager, pending, open_since: open?.clock_in_at || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /punch { token, lat, lng, accuracy, device } — the NFC tap.
router.post('/punch', async (req, res) => {
  try {
    const { token, device } = req.body || {};
    const lat = num(req.body?.lat), lng = num(req.body?.lng), accuracy = num(req.body?.accuracy);
    const me = await userRow(req.user.id);
    if (!me?.attendance_enabled) return res.status(403).json({ error: 'המשתמש שלך לא מוגדר להחתמת נוכחות. פנה למנהל.', code: 'not_enabled' });
    const { rows: [tag] } = await pool.query(`SELECT id, label FROM attendance_tags WHERE token = $1 AND active`, [String(token || '')]);
    if (!tag) return res.status(404).json({ error: 'נקודת ההחתמה לא מוכרת. פנה למנהל.', code: 'bad_tag' });

    const open = await openShift(me.id);
    const settings = await getSettings();

    // Double tap: a second tap right after a punch must not close (or reopen) the shift.
    const { rows: [last] } = await pool.query(
      `SELECT id, EXTRACT(EPOCH FROM (NOW() - last_punch_at)) AS ago FROM attendance_shifts
       WHERE user_id = $1 AND status <> 'void' ORDER BY last_punch_at DESC LIMIT 1`, [me.id]);
    if (last && Number(last.ago) < DOUBLE_TAP_SEC) {
      const s = await shiftById(last.id);
      return res.json({ action: s.clock_out_at ? 'out' : 'in', repeated: true, shift: s, tag: tag.label, name: nameOf(me) });
    }

    // Location
    let flag = null;
    if (settings.lat !== null && settings.lng !== null) {
      if (lat === null || lng === null) flag = 'no_location';
      else {
        const d = distanceM(lat, lng, settings.lat, settings.lng);
        const slack = Math.min(accuracy || 0, 200); // a poor GPS fix must not lock out someone who is there
        if (d - slack > settings.radius_m) {
          return res.status(400).json({ error: `ההחתמה אפשרית רק במקום העבודה (המיקום שלך רחוק כ-${Math.round(d)} מ׳).`, code: 'too_far', distance_m: Math.round(d) });
        }
      }
    }
    // Device: the first phone is registered; another one waits for a manager.
    const dev = String(device || '').slice(0, 80) || null;
    if (dev) {
      const { rows: devs } = await pool.query(`SELECT device_id, approved FROM attendance_devices WHERE user_id = $1`, [me.id]);
      const known = devs.find(d => d.device_id === dev);
      if (!devs.some(d => d.approved)) {
        await pool.query(`INSERT INTO attendance_devices (user_id, device_id, approved) VALUES ($1, $2, TRUE)
                          ON CONFLICT (user_id, device_id) DO UPDATE SET approved = TRUE`, [me.id, dev]);
      } else if (!known?.approved) {
        await pool.query(`INSERT INTO attendance_devices (user_id, device_id, approved) VALUES ($1, $2, FALSE) ON CONFLICT (user_id, device_id) DO NOTHING`, [me.id, dev]);
        flag = flag || 'new_device';
      }
    }

    let shift, action;
    // A shift left open past the limit is not closed by today's tap — it becomes "חסרה יציאה"
    // and today's tap starts a new shift.
    const stale = open && (Date.now() - new Date(open.clock_in_at).getTime()) > settings.open_shift_h * 3600 * 1000;
    if (stale) await pool.query(`UPDATE attendance_shifts SET missing_out = TRUE WHERE id = $1`, [open.id]);

    if (!open || stale) {
      const { rows: [r] } = await pool.query(
        `INSERT INTO attendance_shifts (user_id, clock_in_at, in_tag_id, in_lat, in_lng, in_accuracy_m, in_device, in_flag, status)
         VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [me.id, tag.id, lat, lng, accuracy, dev, flag, flag ? 'pending' : 'ok']);
      shift = await shiftById(r.id); action = 'in';
    } else {
      await pool.query(
        `UPDATE attendance_shifts SET clock_out_at = NOW(), out_tag_id = $2, out_lat = $3, out_lng = $4, out_accuracy_m = $5,
                out_device = $6, out_flag = $7, status = CASE WHEN $7::text IS NOT NULL THEN 'pending' ELSE status END, last_punch_at = NOW()
         WHERE id = $1`, [open.id, tag.id, lat, lng, accuracy, dev, flag]);
      shift = await shiftById(open.id); action = 'out';
    }
    if (flag) {
      notifyManagers(`🕒 נוכחות: ${nameOf(me)} — ${action === 'in' ? 'כניסה' : 'יציאה'} ${hhmm(new Date())} ${flag === 'no_location' ? 'בלי מיקום' : 'ממכשיר חדש'}, ממתין לאישור.`);
    }
    res.json({ action, shift, tag: tag.label, name: nameOf(me), flag, location_checked: settings.lat !== null && !flag });
  } catch (err) {
    console.error('[Attendance] punch:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /punch/undo { shift_id, action } — "טעות? ביטול", only right after the punch.
router.post('/punch/undo', async (req, res) => {
  try {
    const { rows: [s] } = await pool.query(
      `SELECT id, clock_out_at, EXTRACT(EPOCH FROM (NOW() - last_punch_at)) AS ago FROM attendance_shifts
       WHERE id = $1 AND user_id = $2 AND status <> 'void'`, [req.body?.shift_id, req.user.id]);
    if (!s) return res.status(404).json({ error: 'לא נמצא' });
    if (Number(s.ago) > UNDO_SEC) return res.status(400).json({ error: 'עבר הזמן לביטול. אפשר לבקש תיקון ב"השעות שלי".' });
    if (req.body?.action === 'out' && s.clock_out_at) {
      await pool.query(`UPDATE attendance_shifts SET clock_out_at = NULL, out_tag_id = NULL, out_lat = NULL, out_lng = NULL, out_accuracy_m = NULL,
                               out_device = NULL, out_flag = NULL, status = CASE WHEN in_flag IS NULL THEN 'ok' ELSE status END,
                               last_punch_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [s.id]);
    } else if (req.body?.action === 'in' && !s.clock_out_at) {
      await pool.query(`UPDATE attendance_shifts SET status = 'void', last_punch_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [s.id]);
      await pool.query(`INSERT INTO attendance_edits (shift_id, edited_by, reason, old_status, new_status) VALUES ($1, $2, 'ביטול מיידי של העובד', 'ok', 'void')`, [s.id, req.user.id]);
    } else return res.status(400).json({ error: 'אין מה לבטל' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// One user's month: shifts, absences, fix requests, balances, totals.
async function monthOf(userId, month) {
  const { rows: shifts } = await pool.query(
    `SELECT ${SHIFT_COLS},
            (SELECT json_build_object('id', f.id, 'proposed_in', f.proposed_in, 'proposed_out', f.proposed_out, 'note', f.note)
               FROM attendance_fix_requests f WHERE f.shift_id = s.id AND f.status = 'pending' ORDER BY f.id DESC LIMIT 1) AS fix
     FROM ${SHIFT_JOIN}
     WHERE s.user_id = $1 AND s.status <> 'void' AND TO_CHAR(s.clock_in_at AT TIME ZONE '${IL}', 'YYYY-MM') = $2
     ORDER BY s.clock_in_at DESC`, [userId, month]);
  const { rows: absences } = await pool.query(
    `SELECT id, type, from_date::text, to_date::text, days, half_day, note, status, decide_note, (file_stored IS NOT NULL) AS has_file, created_at
     FROM attendance_absences
     WHERE user_id = $1 AND TO_CHAR(from_date, 'YYYY-MM') <= $2 AND TO_CHAR(to_date, 'YYYY-MM') >= $2
     ORDER BY from_date DESC`, [userId, month]);
  const minutes = shifts.reduce((n, s) => n + (Number(s.minutes) || 0), 0);
  const balances = (await balancesFor([userId]))[userId] || { vacation: 0, sick: 0, set: false };
  return { month, shifts, absences, minutes, work_days: new Set(shifts.map(s => s.day)).size, balances };
}
const thisMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: IL, year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);

// GET /me?month=YYYY-MM
router.get('/me', async (req, res) => {
  try {
    const me = await userRow(req.user.id);
    const data = await monthOf(req.user.id, validMonth(req.query.month) || thisMonth());
    const open = await openShift(req.user.id);
    res.json({ ...data, enabled: !!me?.attendance_enabled, name: nameOf(me), open });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /absences (multipart: type, from_date, to_date, half_day, days, note, file)
router.post('/absences', upload.single('file'), async (req, res) => {
  try {
    const me = await userRow(req.user.id);
    if (!me?.attendance_enabled) return res.status(403).json({ error: 'המשתמש שלך לא מוגדר לנוכחות.' });
    const type = req.body.type === 'sick' ? 'sick' : req.body.type === 'vacation' ? 'vacation' : null;
    const from = validDate(req.body.from_date), to = validDate(req.body.to_date) || from;
    if (!type || !from) return res.status(400).json({ error: 'חסר סוג או תאריך' });
    if (to < from) return res.status(400).json({ error: 'תאריך הסיום לפני תאריך ההתחלה' });
    const half = req.body.half_day === 'true' || req.body.half_day === true;
    const span = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
    if (span > 60) return res.status(400).json({ error: 'טווח ארוך מדי' });
    let days = num(req.body.days);
    if (days === null || days <= 0 || days > span) days = half && span === 1 ? 0.5 : span;
    let file_name = null, file_stored = null;
    if (req.file) {
      const up = await uploadBuffer(req.file.buffer, req.file.originalname || 'ishur.jpg', req.file.mimetype);
      file_name = req.file.originalname || 'אישור'; file_stored = up.storedName;
    }
    const { rows: [a] } = await pool.query(
      `INSERT INTO attendance_absences (user_id, type, from_date, to_date, days, half_day, note, file_name, file_stored)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [me.id, type, from, to, days, half && span === 1, (req.body.note || '').trim() || null, file_name, file_stored]);
    notifyManagers(`🕒 נוכחות: ${nameOf(me)} ביקש/ה ${type === 'sick' ? 'ימי מחלה' : 'חופשה'} — ${dmy(from)}${to !== from ? '–' + dmy(to) : ''} (${days} ימים). ממתין לאישור.`, me.id);
    res.json({ id: a.id });
  } catch (err) {
    console.error('[Attendance] absence:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /absences/:id — the employee withdraws a request that was not decided yet.
router.delete('/absences/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE attendance_absences SET status = 'cancelled', decided_at = NOW() WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
      [req.params.id, req.user.id]);
    if (!rowCount) return res.status(400).json({ error: 'אפשר לבטל רק בקשה שעוד לא טופלה' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /fix-requests { shift_id, proposed_in?, proposed_out?, note }
router.post('/fix-requests', async (req, res) => {
  try {
    const { rows: [s] } = await pool.query(`SELECT id, clock_in_at FROM attendance_shifts WHERE id = $1 AND user_id = $2 AND status <> 'void'`, [req.body?.shift_id, req.user.id]);
    if (!s) return res.status(404).json({ error: 'לא נמצא' });
    const pin = req.body.proposed_in ? new Date(req.body.proposed_in) : null;
    const pout = req.body.proposed_out ? new Date(req.body.proposed_out) : null;
    if ((!pin && !pout) || (pin && isNaN(pin)) || (pout && isNaN(pout))) return res.status(400).json({ error: 'חסרה שעה' });
    const inAt = pin || new Date(s.clock_in_at);
    if (pout && pout <= inAt) return res.status(400).json({ error: 'שעת היציאה חייבת להיות אחרי הכניסה' });
    await pool.query(`UPDATE attendance_fix_requests SET status = 'replaced', decided_at = NOW() WHERE shift_id = $1 AND status = 'pending'`, [s.id]);
    await pool.query(`INSERT INTO attendance_fix_requests (shift_id, user_id, proposed_in, proposed_out, note) VALUES ($1, $2, $3, $4, $5)`,
      [s.id, req.user.id, pin, pout, (req.body.note || '').trim() || null]);
    const me = await userRow(req.user.id);
    notifyManagers(`🕒 נוכחות: ${nameOf(me)} ביקש/ה תיקון שעות ליום ${dmy(s.clock_in_at)}. ממתין לאישור.`, req.user.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- managers --------------------------------------------------------------------------------

// Everything waiting for a manager, oldest first.
async function pendingItems() {
  const items = [];
  const { rows: abs } = await pool.query(
    `SELECT a.id, a.user_id, COALESCE(u.display_name, u.username) AS name, a.type, a.from_date::text, a.to_date::text, a.days, a.half_day, a.note,
            (a.file_stored IS NOT NULL) AS has_file, a.created_at
     FROM attendance_absences a JOIN users u ON u.id = a.user_id WHERE a.status = 'pending' ORDER BY a.created_at`);
  const bal = await balancesFor([...new Set(abs.map(a => a.user_id))]);
  abs.forEach(a => items.push({ kind: 'absence', ...a, balance: bal[a.user_id]?.[a.type === 'sick' ? 'sick' : 'vacation'] ?? null }));
  const { rows: fixes } = await pool.query(
    `SELECT f.id, f.user_id, COALESCE(u.display_name, u.username) AS name, f.shift_id, f.proposed_in, f.proposed_out, f.note, f.created_at,
            s.clock_in_at, s.clock_out_at, (s.clock_in_at AT TIME ZONE '${IL}')::date::text AS day
     FROM attendance_fix_requests f JOIN users u ON u.id = f.user_id JOIN attendance_shifts s ON s.id = f.shift_id
     WHERE f.status = 'pending' AND s.status <> 'void' ORDER BY f.created_at`);
  fixes.forEach(f => items.push({ kind: 'fix', ...f }));
  const { rows: flagged } = await pool.query(
    `SELECT s.id, s.user_id, COALESCE(u.display_name, u.username) AS name, s.clock_in_at, s.clock_out_at, s.in_flag, s.out_flag,
            (s.clock_in_at AT TIME ZONE '${IL}')::date::text AS day, s.created_at
     FROM attendance_shifts s JOIN users u ON u.id = s.user_id WHERE s.status = 'pending' ORDER BY s.clock_in_at`);
  flagged.forEach(s => items.push({ kind: 'flag', ...s }));
  const { rows: missing } = await pool.query(
    `SELECT s.id, s.user_id, COALESCE(u.display_name, u.username) AS name, s.clock_in_at, (s.clock_in_at AT TIME ZONE '${IL}')::date::text AS day, s.created_at
     FROM attendance_shifts s JOIN users u ON u.id = s.user_id
     WHERE s.missing_out AND s.clock_out_at IS NULL AND s.status <> 'void'
       AND NOT EXISTS (SELECT 1 FROM attendance_fix_requests f WHERE f.shift_id = s.id AND f.status = 'pending')
     ORDER BY s.clock_in_at`);
  missing.forEach(s => items.push({ kind: 'missing', ...s }));
  return items;
}

// GET /now — who is clocked in right now
router.get('/now', managerOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.user_id, COALESCE(u.display_name, u.username) AS name, s.clock_in_at, ti.label AS tag, s.status
       FROM attendance_shifts s JOIN users u ON u.id = s.user_id LEFT JOIN attendance_tags ti ON ti.id = s.in_tag_id
       WHERE s.clock_out_at IS NULL AND s.status <> 'void' AND NOT s.missing_out ORDER BY s.clock_in_at`);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/pending', managerOnly, async (req, res) => {
  try { res.json(await pendingItems()); } catch (err) { res.status(500).json({ error: err.message }); }
});

// Apply a manual change to a shift and keep the old values.
async function editShift(shiftId, by, { clock_in_at, clock_out_at, status }, reason) {
  const { rows: [old] } = await pool.query(`SELECT clock_in_at, clock_out_at, status FROM attendance_shifts WHERE id = $1`, [shiftId]);
  if (!old) throw Object.assign(new Error('לא נמצא'), { http: 404 });
  const nin  = clock_in_at  !== undefined ? (clock_in_at  ? new Date(clock_in_at)  : null) : old.clock_in_at;
  const nout = clock_out_at !== undefined ? (clock_out_at ? new Date(clock_out_at) : null) : old.clock_out_at;
  const nst  = status || (old.status === 'pending' ? 'ok' : old.status);
  if (!nin || isNaN(nin) || (nout && isNaN(nout))) throw Object.assign(new Error('שעה לא תקינה'), { http: 400 });
  if (nout && nout <= nin) throw Object.assign(new Error('שעת היציאה חייבת להיות אחרי הכניסה'), { http: 400 });
  await pool.query(
    `UPDATE attendance_shifts SET clock_in_at = $2, clock_out_at = $3, status = $4,
            missing_out = CASE WHEN $3::timestamptz IS NOT NULL THEN FALSE ELSE missing_out END,
            in_flag = CASE WHEN $4 = 'ok' THEN NULL ELSE in_flag END, out_flag = CASE WHEN $4 = 'ok' THEN NULL ELSE out_flag END
     WHERE id = $1`, [shiftId, nin, nout, nst]);
  await pool.query(
    `INSERT INTO attendance_edits (shift_id, edited_by, reason, old_in, old_out, new_in, new_out, old_status, new_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [shiftId, by, reason || null, old.clock_in_at, old.clock_out_at, nin, nout, old.status, nst]);
}

// POST /pending/:kind/:id/decide { approve, clock_in_at?, clock_out_at?, days?, note? }
router.post('/pending/:kind/:id/decide', managerOnly, async (req, res) => {
  const { kind, id } = req.params;
  const approve = !!req.body?.approve;
  try {
    if (kind === 'absence') {
      const days = num(req.body.days);
      const { rows: [a] } = await pool.query(
        `UPDATE attendance_absences SET status = $2, decided_by = $3, decided_at = NOW(), decide_note = $4, days = COALESCE($5, days)
         WHERE id = $1 AND status = 'pending' RETURNING user_id, type, from_date::text, to_date::text, days`,
        [id, approve ? 'approved' : 'rejected', req.user.id, (req.body.note || '').trim() || null, approve && days > 0 ? days : null]);
      if (!a) return res.status(400).json({ error: 'הבקשה כבר טופלה' });
      notifyUser(a.user_id, `🕒 ${a.type === 'sick' ? 'ימי המחלה' : 'החופשה'} ${dmy(a.from_date)}${a.to_date !== a.from_date ? '–' + dmy(a.to_date) : ''} ${approve ? 'אושרו ✅' : 'לא אושרו ❌'}${req.body.note ? ` (${req.body.note})` : ''}`);
    } else if (kind === 'fix') {
      const { rows: [f] } = await pool.query(`SELECT * FROM attendance_fix_requests WHERE id = $1 AND status = 'pending'`, [id]);
      if (!f) return res.status(400).json({ error: 'הבקשה כבר טופלה' });
      if (approve) {
        const change = {};
        const pin = req.body.clock_in_at || f.proposed_in, pout = req.body.clock_out_at || f.proposed_out;
        if (pin) change.clock_in_at = pin;
        if (pout) change.clock_out_at = pout;
        await editShift(f.shift_id, req.user.id, change, `בקשת תיקון של העובד${f.note ? ': ' + f.note : ''}`);
      }
      await pool.query(`UPDATE attendance_fix_requests SET status = $2, decided_by = $3, decided_at = NOW() WHERE id = $1`, [id, approve ? 'approved' : 'rejected', req.user.id]);
      notifyUser(f.user_id, `🕒 בקשת תיקון השעות שלך ${approve ? 'אושרה ✅' : 'לא אושרה ❌'}`);
    } else if (kind === 'flag') {
      const { rows: [s] } = await pool.query(`SELECT id, user_id, in_device, out_device, in_flag, out_flag FROM attendance_shifts WHERE id = $1 AND status = 'pending'`, [id]);
      if (!s) return res.status(400).json({ error: 'כבר טופל' });
      if (approve) {
        await editShift(s.id, req.user.id, { status: 'ok' }, 'אישור החתמה חריגה');
        // approving a punch from a new phone registers that phone
        const devs = [s.in_flag === 'new_device' ? s.in_device : null, s.out_flag === 'new_device' ? s.out_device : null].filter(Boolean);
        for (const d of devs) await pool.query(`UPDATE attendance_devices SET approved = TRUE WHERE user_id = $1 AND device_id = $2`, [s.user_id, d]);
      } else {
        await editShift(s.id, req.user.id, { status: 'void' }, (req.body.note || '').trim() || 'החתמה חריגה בוטלה');
        notifyUser(s.user_id, '🕒 החתמת נוכחות שלך בוטלה על ידי מנהל. אפשר לפנות אליו לבירור.');
      }
    } else if (kind === 'missing') {
      if (approve) {
        if (!req.body.clock_out_at) return res.status(400).json({ error: 'חסרה שעת יציאה' });
        await editShift(id, req.user.id, { clock_out_at: req.body.clock_out_at }, 'השלמת יציאה חסרה');
      } else {
        await editShift(id, req.user.id, { status: 'void' }, (req.body.note || '').trim() || 'משמרת בלי יציאה בוטלה');
      }
    } else return res.status(400).json({ error: 'סוג לא מוכר' });
    res.json({ ok: true });
  } catch (err) {
    if (!err.http) console.error('[Attendance] decide:', err.message);
    res.status(err.http || 500).json({ error: err.message });
  }
});

// GET /month?month=YYYY-MM — one row per clocking employee
router.get('/month', managerOnly, async (req, res) => {
  try {
    const month = validMonth(req.query.month) || thisMonth();
    const { rows } = await pool.query(
      `SELECT u.id, COALESCE(u.display_name, u.username) AS name, COALESCE(u.blocked, false) AS blocked,
              COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (s.clock_out_at - s.clock_in_at)) / 60) FROM attendance_shifts s
                         WHERE s.user_id = u.id AND s.status <> 'void' AND s.clock_out_at IS NOT NULL
                           AND TO_CHAR(s.clock_in_at AT TIME ZONE '${IL}', 'YYYY-MM') = $1), 0)::int AS minutes,
              (SELECT COUNT(DISTINCT (s.clock_in_at AT TIME ZONE '${IL}')::date) FROM attendance_shifts s
                 WHERE s.user_id = u.id AND s.status <> 'void' AND TO_CHAR(s.clock_in_at AT TIME ZONE '${IL}', 'YYYY-MM') = $1)::int AS work_days,
              (SELECT COUNT(*) FROM attendance_shifts s WHERE s.user_id = u.id AND s.status <> 'void' AND s.clock_out_at IS NULL AND s.missing_out
                 AND TO_CHAR(s.clock_in_at AT TIME ZONE '${IL}', 'YYYY-MM') = $1)::int AS missing,
              COALESCE((SELECT SUM(a.days) FROM attendance_absences a WHERE a.user_id = u.id AND a.status = 'approved' AND a.type = 'vacation'
                         AND TO_CHAR(a.from_date, 'YYYY-MM') = $1), 0) AS vacation_days,
              COALESCE((SELECT SUM(a.days) FROM attendance_absences a WHERE a.user_id = u.id AND a.status = 'approved' AND a.type = 'sick'
                         AND TO_CHAR(a.from_date, 'YYYY-MM') = $1), 0) AS sick_days
       FROM users u
       WHERE u.attendance_enabled OR EXISTS (SELECT 1 FROM attendance_shifts s WHERE s.user_id = u.id AND s.status <> 'void'
                                               AND TO_CHAR(s.clock_in_at AT TIME ZONE '${IL}', 'YYYY-MM') = $1)
       ORDER BY name`, [month]);
    res.json({ month, rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /user/:id?month= — an employee's month, for the manager
router.get('/user/:id', managerOnly, async (req, res) => {
  try {
    const u = await pool.query(`SELECT id, COALESCE(display_name, username) AS name FROM users WHERE id = $1`, [req.params.id]);
    if (!u.rows[0]) return res.status(404).json({ error: 'לא נמצא' });
    const data = await monthOf(Number(req.params.id), validMonth(req.query.month) || thisMonth());
    const { rows: edits } = await pool.query(
      `SELECT e.shift_id, e.edited_at, e.reason, e.old_in, e.old_out, e.new_in, e.new_out, e.old_status, e.new_status, COALESCE(m.display_name, m.username) AS by_name
       FROM attendance_edits e LEFT JOIN users m ON m.id = e.edited_by WHERE e.shift_id = ANY($1::int[]) ORDER BY e.edited_at`, [data.shifts.map(s => s.id)]);
    res.json({ ...data, name: u.rows[0].name, edits });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /shifts/:id { clock_in_at, clock_out_at, void, reason } — manual correction, reason required
router.put('/shifts/:id', managerOnly, async (req, res) => {
  try {
    const reason = (req.body.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'חובה לכתוב סיבה לשינוי' });
    const change = {};
    if (req.body.clock_in_at !== undefined) change.clock_in_at = req.body.clock_in_at;
    if (req.body.clock_out_at !== undefined) change.clock_out_at = req.body.clock_out_at;
    if (req.body.void) change.status = 'void';
    await editShift(req.params.id, req.user.id, change, reason);
    res.json({ ok: true });
  } catch (err) { res.status(err.http || 500).json({ error: err.message }); }
});

// POST /shifts { user_id, clock_in_at, clock_out_at, reason } — a shift typed in by a manager
router.post('/shifts', managerOnly, async (req, res) => {
  try {
    const reason = (req.body.reason || '').trim();
    const nin = new Date(req.body.clock_in_at), nout = req.body.clock_out_at ? new Date(req.body.clock_out_at) : null;
    if (!reason) return res.status(400).json({ error: 'חובה לכתוב סיבה' });
    if (!req.body.user_id || isNaN(nin) || (nout && isNaN(nout))) return res.status(400).json({ error: 'חסר עובד או שעה' });
    if (nout && nout <= nin) return res.status(400).json({ error: 'שעת היציאה חייבת להיות אחרי הכניסה' });
    const { rows: [s] } = await pool.query(
      `INSERT INTO attendance_shifts (user_id, clock_in_at, clock_out_at, source, status, last_punch_at) VALUES ($1, $2, $3, 'manual', 'ok', NOW() - INTERVAL '1 hour') RETURNING id`,
      [req.body.user_id, nin, nout]);
    await pool.query(`INSERT INTO attendance_edits (shift_id, edited_by, reason, new_in, new_out, new_status) VALUES ($1, $2, $3, $4, $5, 'ok')`,
      [s.id, req.user.id, `הוספה ידנית: ${reason}`, nin, nout]);
    res.json({ id: s.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /absences/:id/file — signed link to the attached certificate (managers, or the owner)
router.get('/absences/:id/file', async (req, res) => {
  try {
    const { rows: [a] } = await pool.query(`SELECT user_id, file_stored, file_name FROM attendance_absences WHERE id = $1`, [req.params.id]);
    if (!a?.file_stored) return res.status(404).json({ error: 'אין קובץ' });
    if (a.user_id !== req.user.id && !isManager(req.user)) return res.status(403).json({ error: 'אין הרשאה' });
    res.json({ url: await getSignedUrl(a.file_stored, 300) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- setup (managers): employees, tags, venue ------------------------------------------------

router.get('/employees', managerOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, COALESCE(display_name, username) AS name, roles, COALESCE(attendance_enabled, false) AS attendance_enabled,
              vacation_quota_days, vacation_opening, sick_opening, balance_date::text,
              (SELECT COUNT(*) FROM attendance_devices d WHERE d.user_id = users.id AND d.approved)::int AS devices
       FROM users WHERE NOT COALESCE(blocked, false) ORDER BY name`);
    const bal = await balancesFor(rows.map(r => r.id));
    res.json(rows.map(r => ({ ...r, balances: bal[r.id] })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/employees/:id', managerOnly, async (req, res) => {
  try {
    const b = req.body || {};
    await pool.query(
      `UPDATE users SET attendance_enabled = $2, vacation_quota_days = $3, vacation_opening = $4, sick_opening = $5, balance_date = $6 WHERE id = $1`,
      [req.params.id, !!b.attendance_enabled, num(b.vacation_quota_days) || 0, num(b.vacation_opening) || 0, num(b.sick_opening) || 0, validDate(b.balance_date)]);
    if (b.reset_devices) await pool.query(`DELETE FROM attendance_devices WHERE user_id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/tags', managerOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT id, token, label, active, created_at FROM attendance_tags ORDER BY id`);
    res.json(rows.map(t => ({ ...t, url: `${baseUrl()}/clock?t=${t.token}` })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/tags', managerOnly, async (req, res) => {
  try {
    const label = (req.body?.label || '').trim();
    if (!label) return res.status(400).json({ error: 'חסר שם לנקודה' });
    const token = crypto.randomBytes(12).toString('base64url');
    const { rows: [t] } = await pool.query(`INSERT INTO attendance_tags (token, label) VALUES ($1, $2) RETURNING id, token, label, active`, [token, label]);
    res.json({ ...t, url: `${baseUrl()}/clock?t=${t.token}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/tags/:id', managerOnly, async (req, res) => {
  try {
    await pool.query(`UPDATE attendance_tags SET label = COALESCE($2, label), active = COALESCE($3, active) WHERE id = $1`,
      [req.params.id, (req.body?.label || '').trim() || null, typeof req.body?.active === 'boolean' ? req.body.active : null]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/settings', managerOnly, async (req, res) => {
  try { res.json(await getSettings()); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/settings', managerOnly, async (req, res) => {
  try {
    const b = req.body || {};
    const set = async (key, value) => pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, value === null ? null : String(value)]);
    if (b.lat !== undefined && b.lng !== undefined) {
      const lat = num(b.lat), lng = num(b.lng);
      if (lat !== null && (Math.abs(lat) > 90 || Math.abs(lng) > 180)) return res.status(400).json({ error: 'מיקום לא תקין' });
      await set('att_venue_lat', lat); await set('att_venue_lng', lng);
    }
    if (num(b.radius_m) >= 30) await set('att_radius_m', Math.round(num(b.radius_m)));
    if (num(b.open_shift_h) >= 1) await set('att_open_shift_h', num(b.open_shift_h));
    res.json(await getSettings());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- background check: shifts left open ------------------------------------------------------
// Every 30 minutes: a shift open longer than the limit is marked "חסרה יציאה" (never closed
// automatically) and the employee + managers are told once.
async function runOpenShiftCheck() {
  try {
    const { open_shift_h } = await getSettings();
    const { rows } = await pool.query(
      `UPDATE attendance_shifts s SET missing_out = TRUE, missing_alerted_at = NOW()
       FROM users u
       WHERE u.id = s.user_id AND s.clock_out_at IS NULL AND s.status <> 'void' AND s.missing_alerted_at IS NULL
         AND s.clock_in_at < NOW() - ($1 || ' hours')::interval
       RETURNING s.id, s.user_id, s.clock_in_at, COALESCE(u.display_name, u.username) AS name`, [String(open_shift_h)]);
    for (const s of rows) {
      notifyUser(s.user_id, `🕒 לא הוחתמה יציאה מהמשמרת שהתחילה ב-${dmy(s.clock_in_at)} ${hhmm(s.clock_in_at)}. היכנס/י ל"שעות" ושלח/י בקשת תיקון עם שעת היציאה.`);
      notifyManagers(`🕒 נוכחות: ${s.name} — חסרה יציאה מהמשמרת של ${dmy(s.clock_in_at)} ${hhmm(s.clock_in_at)}.`, s.user_id);
    }
  } catch (err) { console.error('[Attendance] open-shift check:', err.message); }
}

module.exports = router;
module.exports.SCHEMA_SQL = SCHEMA_SQL;
module.exports.runOpenShiftCheck = runOpenShiftCheck;
