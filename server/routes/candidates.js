// מועמדים (candidate tracker) — ported into the CRM from the standalone candidate-tracker app
// (Oct 2026). Managers/admins only; every call goes through requireManager below.
//
// Tables (created at boot in server/index.js): candidate_jobs, candidates, candidate_interactions.
// Integrations reuse the CRM's own: Google Calendar (calendarService), WhatsApp (Green API via
// reminderService.sendWhatsApp), resumes in the crm-files Supabase bucket (storageService).
const router = require('express').Router();
const multer = require('multer');
const pool   = require('../db/pool');
const { uploadBuffer, getSignedUrl, storedNameFromUrl } = require('../services/storageService');
const { createCandidateMeeting, sendMeetingInvite, getMeetingRsvpStatus } = require('../services/calendarService');
const { sendWhatsApp } = require('../services/reminderService');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const REJECTED_STATUSES = ['נדחה', 'לא רלוונטי'];

function requireManager(req, res, next) {
  const roles = req.user.roles?.length ? req.user.roles : [req.user.role];
  if (['admin', 'manager'].some(r => roles.includes(r))) return next();
  return res.status(403).json({ error: 'מועמדים זמינים למנהלים בלבד' });
}
router.use(requireManager);

function fail(res, err, msg = 'Server error') {
  console.error('[Candidates]', err);
  res.status(500).json({ error: msg });
}

// ── Jobs ────────────────────────────────────────────────────────────────────

// GET /api/candidates/jobs — jobs with active-candidate count
router.get('/jobs', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT j.*,
             COUNT(c.id)::int AS candidate_count,
             COUNT(c.id) FILTER (WHERE c.status != ALL($1))::int AS active_count
      FROM candidate_jobs j
      LEFT JOIN candidates c ON c.job_id = j.id
      GROUP BY j.id
      ORDER BY j.created_at DESC`, [REJECTED_STATUSES]);
    res.json(rows);
  } catch (err) { fail(res, err); }
});

router.post('/jobs', async (req, res) => {
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Title required' });
  try {
    const { rows } = await pool.query('INSERT INTO candidate_jobs (title) VALUES ($1) RETURNING *', [title]);
    res.status(201).json(rows[0]);
  } catch (err) { fail(res, err); }
});

router.delete('/jobs/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM candidate_jobs WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) { fail(res, err); }
});

// ── Interactions (by interaction id) ────────────────────────────────────────

router.patch('/interactions/:id', async (req, res) => {
  const { date_time, notes } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE candidate_interactions SET date_time = $1, notes = $2 WHERE id = $3 RETURNING *',
      [date_time || null, notes || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { fail(res, err); }
});

router.delete('/interactions/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM candidate_interactions WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) { fail(res, err); }
});

// ── Candidates ──────────────────────────────────────────────────────────────

// GET /api/candidates?tab=active|rejected&job_id=X
router.get('/', async (req, res) => {
  try {
    const { job_id, tab } = req.query;
    const conditions = [];
    const params = [];
    conditions.push(`status ${tab === 'rejected' ? '= ANY' : '!= ALL'}($${params.length + 1})`);
    params.push(REJECTED_STATUSES);
    if (job_id) { conditions.push(`job_id = $${params.length + 1}`); params.push(job_id); }
    const { rows } = await pool.query(
      `SELECT id, name, phone, email, status, status_reason, status_updated_at, arrival_time, job_id, meeting_rsvp_status
       FROM candidates WHERE ${conditions.join(' AND ')} ORDER BY arrival_time DESC`, params);
    res.json(rows);
  } catch (err) { fail(res, err); }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM candidates WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { fail(res, err); }
});

// POST /api/candidates — manual add (multipart, optional `resume` file)
router.post('/', upload.single('resume'), async (req, res) => {
  const { name, phone, email, address, ai_summary, arrival_time, job_id } = req.body;
  try {
    let resume_path = null;
    if (req.file) {
      const { storedName } = await uploadBuffer(req.file.buffer, `resume-${req.file.originalname}`, req.file.mimetype);
      resume_path = storedName;
    }
    const { rows } = await pool.query(
      `INSERT INTO candidates (name, phone, email, address, ai_summary, resume_path, arrival_time, status, job_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'חדש', $8, $9) RETURNING *`,
      [name || null, phone || null, email || null, address || null, ai_summary || null, resume_path,
       arrival_time || new Date(), job_id || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { fail(res, err); }
});

router.patch('/:id/status', async (req, res) => {
  const { status, status_reason } = req.body;
  if (!status) return res.status(400).json({ error: 'Status required' });
  try {
    const { rows } = await pool.query(
      'UPDATE candidates SET status = $1, status_reason = $2, status_updated_at = NOW() WHERE id = $3 RETURNING *',
      [status, status_reason || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { fail(res, err); }
});

router.patch('/:id/job', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE candidates SET job_id = $1 WHERE id = $2 RETURNING *',
      [req.body.job_id || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { fail(res, err); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM candidates WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) { fail(res, err); }
});

// GET /api/candidates/:id/resume/url — 5-minute signed URL for the resume
router.get('/:id/resume/url', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT resume_path FROM candidates WHERE id = $1', [req.params.id]);
    if (!rows[0]?.resume_path) return res.status(404).json({ error: 'No resume' });
    const storedName = storedNameFromUrl(rows[0].resume_path) || rows[0].resume_path;
    const url = await getSignedUrl(storedName, 60 * 5);
    res.json({ url });
  } catch (err) { fail(res, err, 'לא ניתן לפתוח את קורות החיים'); }
});

// ── Interactions (by candidate) ─────────────────────────────────────────────

router.get('/:id/interactions', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM candidate_interactions WHERE candidate_id = $1 ORDER BY date_time DESC NULLS FIRST, created_at DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { fail(res, err); }
});

router.post('/:id/interactions', async (req, res) => {
  const { type, date_time, notes } = req.body;
  if (!['call', 'meeting', 'note'].includes(type)) return res.status(400).json({ error: 'type required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO candidate_interactions (candidate_id, type, date_time, notes, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.params.id, type, date_time || null, notes || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { fail(res, err); }
});

// ── Interview meeting (Google Calendar + invite) ────────────────────────────

// POST /api/candidates/:id/meeting — create the calendar event (guest not notified yet)
router.post('/:id/meeting', async (req, res) => {
  const { title, start, end } = req.body;
  if (!title || !start || !end) return res.status(400).json({ error: 'title, start and end are required' });
  try {
    const { rows } = await pool.query('SELECT * FROM candidates WHERE id = $1', [req.params.id]);
    const c = rows[0];
    if (!c) return res.status(404).json({ error: 'Not found' });
    const result = await createCandidateMeeting({ candidateId: c.id, title, start, end, guestEmail: c.email, guestName: c.name });
    await pool.query(
      `UPDATE candidates SET calendar_event_id = $1, meeting_rsvp_status = 'needsAction', meeting_start = $2 WHERE id = $3`,
      [result.eventId, start, c.id]
    );
    await pool.query(
      `INSERT INTO candidate_interactions (candidate_id, type, date_time, notes, created_by) VALUES ($1, 'meeting', $2, $3, $4)`,
      [c.id, start, `נקבעה פגישה ביומן: ${title}`, req.user.id]
    );
    res.json(result);
  } catch (err) { fail(res, err, 'שגיאה ביצירת הפגישה ביומן'); }
});

// POST /api/candidates/:id/meeting/notify — Google sends the official invite email
router.post('/:id/meeting/notify', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT calendar_event_id FROM candidates WHERE id = $1', [req.params.id]);
    if (!rows[0]?.calendar_event_id) return res.status(400).json({ error: 'אין פגישה ביומן למועמד' });
    await sendMeetingInvite(rows[0].calendar_event_id);
    res.json({ success: true });
  } catch (err) { fail(res, err, 'שגיאה בשליחת ההזמנה'); }
});

// POST /api/candidates/:id/meeting/whatsapp — plain-text WhatsApp via the CRM's Green API line
router.post('/:id/meeting/whatsapp', async (req, res) => {
  const { eventLink, title, startTime } = req.body;
  try {
    const { rows } = await pool.query('SELECT name, phone FROM candidates WHERE id = $1', [req.params.id]);
    const c = rows[0];
    if (!c) return res.status(404).json({ error: 'Not found' });
    if (!c.phone) return res.status(400).json({ error: 'למועמד אין מספר טלפון' });
    const when = startTime
      ? new Date(startTime).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';
    const msg =
      `היי ${c.name || ''},\n` +
      `נשמח להיפגש איתך${title ? ` — ${title}` : ''}${when ? ` ב-${when}` : ''}.\n` +
      `הפגישה בשרביה, פנחס בן יאיר 3, תל אביב.\n` +
      (eventLink ? `פרטי הפגישה: ${eventLink}\n` : '') +
      `נא לאשר הגעה. תודה!`;
    await sendWhatsApp(c.phone, msg);
    res.json({ success: true });
  } catch (err) { fail(res, err, 'שגיאה בשליחת WhatsApp'); }
});

// GET /api/candidates/:id/meeting/status — refresh the guest's RSVP from Google
router.get('/:id/meeting/status', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT email, calendar_event_id FROM candidates WHERE id = $1', [req.params.id]);
    const c = rows[0];
    if (!c?.calendar_event_id) return res.status(400).json({ error: 'אין פגישה ביומן למועמד' });
    const status = await getMeetingRsvpStatus(c.calendar_event_id, c.email);
    await pool.query('UPDATE candidates SET meeting_rsvp_status = $1 WHERE id = $2', [status, req.params.id]);
    res.json({ status });
  } catch (err) { fail(res, err, 'שגיאה בבדיקת הסטטוס'); }
});

module.exports = router;
