const router = require('express').Router();
const pool   = require('../db/pool');
const fs     = require('fs');
const path   = require('path');
const multer = require('multer');

const os = require('os');
const emailUpload = multer({ dest: os.tmpdir() });

const { uploadFile } = require('../services/storageService');
const { normalizePhone } = require('../utils/phoneUtils');

const hasGoogle = () => fs.existsSync(path.join(__dirname, '../google_token.json'));
function syncCalendar(leadId, type = 'option', userId = null) {
  if (!hasGoogle()) return Promise.resolve();
  const { syncLeadToCalendar } = require('../services/calendarService');
  return syncLeadToCalendar(leadId, type, userId).catch(() => {});
}

const STAGE_TABS = {
  new: ['new'],
  in_process: ['contacted','meeting','offer_sent','negotiation','contract_sent'],
  closed: ['deposit','production'],
  lost: ['lost'],
};

// GET /api/leads?tab=new|in_process|closed|lost
router.get('/', async (req, res) => {
  const { tab = 'new', search } = req.query;
  const stages = STAGE_TABS[tab] || STAGE_TABS.new;
  const placeholders = stages.map((_, i) => `$${i + 1}`).join(',');
  let query = `
    SELECT l.*, u.display_name AS assigned_name,
           (SELECT COUNT(*) FROM tasks t WHERE t.lead_id = l.id AND t.completed_at IS NULL) AS open_tasks,
           (SELECT COUNT(*) FROM tasks t WHERE t.lead_id = l.id AND t.completed_at IS NULL AND t.due_at IS NOT NULL AND t.due_at <= NOW()) AS overdue_tasks,
           GREATEST(
             (SELECT MAX(created_at) FROM lead_interactions WHERE lead_id = l.id),
             (SELECT MAX(timestamp)  FROM messages           WHERE lead_id = l.id)
           ) AS last_interaction_at,
           COALESCE(
             LEAST(
               (SELECT MIN(timestamp)  FROM messages           WHERE lead_id = l.id AND direction='inbound'),
               (SELECT MIN(created_at) FROM lead_interactions  WHERE lead_id = l.id AND direction='inbound')
             ),
             l.created_at
           ) AS received_at,
           (SELECT COUNT(*) FROM messages WHERE lead_id = l.id AND direction='inbound' AND is_read=false) +
           (SELECT COUNT(*) FROM lead_interactions WHERE lead_id = l.id AND direction='inbound' AND is_read=false) AS unread_count
    FROM leads l
    LEFT JOIN users u ON u.id = l.assigned_to
    WHERE l.stage IN (${placeholders})
  `;
  const params = [...stages];
  if (search) {
    params.push(`%${search}%`);
    const likeIdx = params.length;
    const normalizedSearch = normalizePhone(search);
    let phoneNormCondition = '';
    if (normalizedSearch) {
      params.push(`%${normalizedSearch}%`);
      const normIdx = params.length;
      phoneNormCondition = ` OR (
        CASE
          WHEN REGEXP_REPLACE(l.phone,'[^0-9]','','g') LIKE '972%'
            THEN REGEXP_REPLACE(l.phone,'[^0-9]','','g')
          WHEN REGEXP_REPLACE(l.phone,'[^0-9]','','g') LIKE '0%'
            THEN '972' || SUBSTRING(REGEXP_REPLACE(l.phone,'[^0-9]','','g'), 2)
          ELSE REGEXP_REPLACE(l.phone,'[^0-9]','','g')
        END LIKE $${normIdx}
      )`;
    }
    query += ` AND (l.name ILIKE $${likeIdx} OR l.phone ILIKE $${likeIdx} OR l.email ILIKE $${likeIdx}${phoneNormCondition})`;
  }
  query += ' ORDER BY received_at DESC';
  try {
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leads/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.*, u.display_name AS assigned_name, c.display_name AS created_by_name
       FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_to
       LEFT JOIN users c ON c.id = l.created_by
       WHERE l.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads — manual creation
router.post('/', async (req, res) => {
  const { name, phone, email, event_name, event_date, event_time, event_end_time, event_type, guest_count, budget, source = 'manual', notes, assigned_to, priority = 'normal' } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO leads (name, phone, email, event_name, event_date, event_time, event_end_time, event_type, guest_count, budget, source, notes, assigned_to, priority, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [name, phone, email, event_name || name, event_date || null, event_time || null, event_end_time || null, event_type, guest_count, budget, source, notes, assigned_to || null, priority, req.user.id]
    );
    const lead = rows[0];
    // Auto-create Google Calendar event as "option" if event_date set
    if (lead.event_date) syncCalendar(lead.id, 'option', req.user.id);
    res.status(201).json(lead);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/leads/:id
router.patch('/:id', async (req, res) => {
  const allowed = ['name','phone','email','event_name','event_date','event_time','event_end_time','event_date_text','event_type','guest_count','budget','stage','lost_reason','lost_reason_text','priority','assigned_to','notes','deposit_amount','deposit_date','deposit_confirmed','production_notes'];
  const fields = Object.keys(req.body).filter(k => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ error: 'No valid fields' });
  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
  const vals = fields.map(f => req.body[f]);
  try {
    // Capture old stage before update so we can log the transition
    let oldStage = null;
    if (fields.includes('stage')) {
      const { rows: cur } = await pool.query('SELECT stage FROM leads WHERE id = $1', [req.params.id]);
      oldStage = cur[0]?.stage || null;
    }

    const { rows } = await pool.query(
      `UPDATE leads SET ${sets}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id, ...vals]
    );
    const lead = rows[0];

    // Re-sync calendar if event date/time/name/type changed (awaited so calStatus is fresh on reload)
    const calendarFields = ['event_date','event_time','event_end_time','event_type','name'];
    if (lead.event_date && fields.some(f => calendarFields.includes(f))) {
      const existing = await pool.query('SELECT type FROM calendar_events WHERE lead_id = $1 LIMIT 1', [lead.id]);
      const currentType = existing.rows[0]?.type || 'option';
      await syncCalendar(lead.id, currentType, req.user.id);
    }

    // Log stage change to timeline
    if (oldStage && lead.stage !== oldStage) {
      const STAGE_NAMES = {
        new:'חדש', contacted:'ביצירת קשר', meeting:'פגישה', offer_sent:'הצעה נשלחה',
        negotiation:'מו"מ', contract_sent:'חוזה נשלח', deposit:'מקדמה', production:'הפקה', lost:'אבוד'
      };
      const from = STAGE_NAMES[oldStage]  || oldStage;
      const to   = STAGE_NAMES[lead.stage] || lead.stage;
      await pool.query(
        `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by)
         VALUES ($1, 'note', 'outbound', $2, $3)`,
        [req.params.id, `🔄 שינוי שלב: ${from} ← ${to}`, req.user.id]
      );

      // Auto-clear hot/urgent priority when lead is closed (deposit or production)
      if (lead.stage === 'deposit' || lead.stage === 'production') {
        await pool.query(
          `UPDATE leads SET priority = 'normal' WHERE id = $1 AND priority != 'normal'`,
          [req.params.id]
        );
        lead.priority = 'normal';
      }
    }

    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/:id/read — mark all inbound messages as read
router.post('/:id/read', async (req, res) => {
  try {
    await pool.query(`UPDATE messages SET is_read=true WHERE lead_id=$1 AND direction='inbound'`, [req.params.id]);
    await pool.query(`UPDATE lead_interactions SET is_read=true WHERE lead_id=$1 AND direction='inbound'`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/leads/:id — admin only
router.delete('/:id', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'אין הרשאה' });
  try {
    await pool.query('DELETE FROM leads WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leads/:id/interactions
router.get('/:id/interactions', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.*, u.display_name AS created_by_name
       FROM lead_interactions i LEFT JOIN users u ON u.id = i.created_by
       WHERE i.lead_id = $1 ORDER BY i.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/:id/interactions
router.post('/:id/interactions', async (req, res) => {
  const { type, direction = 'outbound', body } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, type, direction, body, req.user.id]
    );
    await pool.query('UPDATE leads SET updated_at = NOW() WHERE id = $1', [req.params.id]);
    // Auto-advance new → contacted on first outbound interaction
    if (direction === 'outbound') {
      await pool.query(
        `UPDATE leads SET stage = 'contacted', updated_at = NOW() WHERE id = $1 AND stage = 'new'`,
        [req.params.id]
      );
    }
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/leads/:id/interactions/:interactionId — edit body text
router.patch('/:id/interactions/:interactionId', async (req, res) => {
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'body required' });
  try {
    const { rows } = await pool.query(
      'UPDATE lead_interactions SET body = $1 WHERE id = $2 AND lead_id = $3 RETURNING *',
      [body.trim(), req.params.interactionId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leads/:id/tasks
router.get('/:id/tasks', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.*, u.display_name AS assigned_name
       FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.lead_id = $1 ORDER BY t.due_at ASC NULLS LAST`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/:id/tasks
router.post('/:id/tasks', async (req, res) => {
  const { title, due_at, remind_via = 'app', assigned_to } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO tasks (lead_id, title, due_at, remind_via, assigned_to, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, title, due_at || null, remind_via, assigned_to || req.user.id, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/leads/:id/tasks/:taskId/complete
router.patch('/:id/tasks/:taskId/complete', async (req, res) => {
  const { result } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE tasks SET completed_at = NOW(), result = $3 WHERE id = $1 AND lead_id = $2 RETURNING *',
      [req.params.taskId, req.params.id, result || null]
    );
    const task = rows[0];
    // Log result as interaction if provided
    if (result) {
      await pool.query(
        `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by)
         VALUES ($1, 'note', 'outbound', $2, $3)`,
        [req.params.id, `✅ משימה הושלמה: ${task.title}\nתוצאה: ${result}`, req.user.id]
      );
      await pool.query('UPDATE leads SET updated_at = NOW() WHERE id = $1', [req.params.id]);
    }
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/leads/:id/tasks/:taskId/reschedule
router.patch('/:id/tasks/:taskId/reschedule', async (req, res) => {
  const { due_at, note } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE tasks SET due_at = $3 WHERE id = $1 AND lead_id = $2 RETURNING *',
      [req.params.taskId, req.params.id, due_at || null]
    );
    const task = rows[0];
    if (note) {
      await pool.query(
        `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by)
         VALUES ($1, 'note', 'outbound', $2, $3)`,
        [req.params.id, `🔁 משימה נדחתה: ${task.title}\n${note}`, req.user.id]
      );
      await pool.query('UPDATE leads SET updated_at = NOW() WHERE id = $1', [req.params.id]);
    }
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/:id/email/send
router.post('/:id/email/send', emailUpload.single('file'), async (req, res) => {
  const { to, subject, body } = req.body;
  if (!to || !body) return res.status(400).json({ error: 'to and body are required' });
  try {
    const { sendEmail } = require('../services/gmailService');
    let attachmentBuffer, attachmentName, attachmentMime;
    let fileMarker = '';
    if (req.file) {
      attachmentBuffer = fs.readFileSync(req.file.path);
      attachmentName   = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      attachmentMime   = req.file.mimetype;
      const { storedName } = await uploadFile(req.file.path, attachmentName, req.file.mimetype);
      fs.unlinkSync(req.file.path);
      const { rows: fileRows } = await pool.query(
        `INSERT INTO files (lead_id, filename, url, stored_name, file_type, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [req.params.id, attachmentName, '', storedName, attachmentMime, req.user.id]
      );
      fileMarker = `\n[[FILE:${fileRows[0].id}|${attachmentName}]]`;
    }
    await sendEmail({ to, subject: subject || '(ללא נושא)', body, attachmentBuffer, attachmentName, attachmentMime });
    const interactionBody = `נשלח ל: ${to} | נושא: ${subject || ''}\n${body}${fileMarker}`;
    await pool.query(
      `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by)
       VALUES ($1, 'email', 'outbound', $2, $3)`,
      [req.params.id, interactionBody, req.user.id]
    );
    await pool.query('UPDATE leads SET updated_at = NOW() WHERE id = $1', [req.params.id]);
    // Auto-advance new → contacted on first outbound email
    await pool.query(
      `UPDATE leads SET stage = 'contacted', updated_at = NOW() WHERE id = $1 AND stage = 'new'`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leads/:id/messages
router.get('/:id/messages', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.*, u.display_name AS sent_by_name
       FROM messages m LEFT JOIN users u ON u.id = m.sent_by
       WHERE m.lead_id = $1 ORDER BY m.timestamp ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leads/:id/contacts
router.get('/:id/contacts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM lead_contacts WHERE lead_id = $1 ORDER BY created_at',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/:id/contacts
router.post('/:id/contacts', async (req, res) => {
  try {
    const { type, value } = req.body;
    if (!type || !value) return res.status(400).json({ error: 'type and value required' });
    const { rows } = await pool.query(
      'INSERT INTO lead_contacts (lead_id, type, value) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, type, value.trim()]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/leads/:id/contacts/:cid
router.delete('/:id/contacts/:cid', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM lead_contacts WHERE id = $1 AND lead_id = $2',
      [req.params.cid, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
