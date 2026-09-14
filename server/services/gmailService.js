const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');
const { sendWhatsApp } = require('./reminderService');

const CREDENTIALS_PATH = path.join(__dirname, '../credentials.json');
const TOKEN_PATH       = path.join(__dirname, '../google_token.json');

function getAuth() {
  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_id, client_secret } = creds.installed || creds.web || creds;
  const oauth2 = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3333/callback');
  oauth2.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH)));
  return oauth2;
}

// ── HELPERS ──────────────────────────────────────────────────────────────────

function normalizePhone(phone) {
  if (!phone) return phone;
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('972') && digits.length === 12) return '0' + digits.slice(3);
  return phone;
}

// ── PARSERS ──────────────────────────────────────────────────────────────────

function parseCallEvent(body) {
  const get = (label) => {
    const m = body.match(new RegExp(`${label}[:\\s]+([^\\n\\r]+)`));
    return m ? m[1].trim() : null;
  };
  // Name: text before מתעניין/ת after להלן פרטי הליד:
  const nameMatch = body.match(/להלן פרטי הליד:[^\n]*\n([^\n]+)\s+מתעניין/);
  return {
    source: 'call_event',
    name:        nameMatch ? nameMatch[1].trim() : null,
    phone:       get('טלפון'),
    email:       get('מייל'),
    guest_count: get('כמות מוזמנים'),
    event_type:  get('סוג האירוע'),
    event_date:  parseHebrewDate(get('מתי')),
    budget:      get('תקציב'),
    notes:       get('הערות'),
  };
}

function parseWebsitePopup(body) {
  const lines = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  // Old format: look for 'אני' line
  const idx = lines.findIndex(l => l.includes('אני'));
  if (idx >= 0) {
    return { source: 'website_popup', name: lines[idx + 1] || null, phone: lines[idx + 2] || null };
  }
  // New format: name on line 1, phone on line 2, before '---'
  const dashIdx = lines.findIndex(l => l.startsWith('---'));
  const before = dashIdx >= 0 ? lines.slice(0, dashIdx) : lines.slice(0, 3);
  const valid = before.filter(l => !l.includes('תאריך') && !l.includes('זמן') && !l.includes('קישור') && !l.startsWith('http'));
  return { source: 'website_popup', name: valid[0] || null, phone: valid[1] || null };
}

function parseWebsiteForm(body) {
  const get = (label) => {
    const m = body.match(new RegExp(`${label}[:\\s]+([^\\n\\r]+)`));
    return m ? m[1].trim() : null;
  };
  return {
    source: 'website_form',
    name:  get('שם מלא'),
    phone: get('טלפון'),
    notes: get('פרטי הפנייה'),
  };
}

// New Sharviya website (Sep 2026) — forms are delivered by FormSubmit
// (submissions@formsubmit.co). Body is a list of "label:" / value pairs
// (label on one line, value on the next after HTML stripping — or on the
// same line in the plain-text part). Labels: שם / שם מלא, טלפון,
// פרטי הפנייה, תאריך ("ספטמבר 14, 2026"), זמן ("6:00 am"), קישור לעמוד.
const HEBREW_MONTHS = { 'ינואר': 1, 'פברואר': 2, 'מרץ': 3, 'מרס': 3, 'אפריל': 4, 'מאי': 5, 'יוני': 6,
  'יולי': 7, 'אוגוסט': 8, 'ספטמבר': 9, 'אוקטובר': 10, 'נובמבר': 11, 'דצמבר': 12 };

function parseFormSubmitDate(str) {
  if (!str) return null;
  const numeric = parseHebrewDate(str);
  if (numeric) return numeric;
  // "ספטמבר 14, 2026" / "14 ספטמבר 2026" / "September 14, 2026"
  const m = str.match(/(\d{4})/);
  const d = str.match(/(?:^|[^\d])(\d{1,2})(?:[^\d]|$)/);
  if (!m || !d) return null;
  let month = null;
  for (const [name, num] of Object.entries(HEBREW_MONTHS)) if (str.includes(name)) { month = num; break; }
  if (!month) {
    const en = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const idx = en.findIndex(n => str.toLowerCase().includes(n));
    if (idx >= 0) month = idx + 1;
  }
  if (!month) return null;
  return `${m[1]}-${String(month).padStart(2, '0')}-${d[1].padStart(2, '0')}`;
}

function parseFormSubmit(body, source) {
  const lines = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  // A label line is "<text without digits>:" optionally followed by a space and
  // the value. Digits are excluded so "6:00 am" is a value, and the space is
  // required so "https://…" is a value too.
  const LABEL_RE = /^([^:\d]{1,40}):(?:\s+(.*)|\s*)$/;
  const fields = {};
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LABEL_RE);
    if (!m) continue;
    const label = m[1].trim();
    let value = (m[2] || '').trim();
    if (!value && i + 1 < lines.length && !LABEL_RE.test(lines[i + 1])) value = lines[++i];
    if (value && !fields[label]) fields[label] = value;
  }
  const pick = (...labels) => { for (const l of labels) if (fields[l]) return fields[l]; return null; };
  const time = pick('זמן', 'שעה');
  const details = pick('פרטי הפנייה', 'הודעה', 'פרטים');
  const notes = [details, time ? `שעה: ${time}` : null].filter(Boolean).join('\n') || null;
  return {
    source,
    name:       pick('שם מלא', 'שם'),
    phone:      pick('טלפון', 'נייד'),
    email:      pick('מייל', 'אימייל', 'Email', 'email'),
    event_date: parseFormSubmitDate(pick('תאריך', 'תאריך האירוע')),
    event_time: time,
    guest_count: pick('כמות מוזמנים', 'מספר אורחים'),
    event_type:  pick('סוג האירוע', 'סוג אירוע'),
    notes,
  };
}

function parseVonage(body) {
  const phoneMatch = body.match(/מספר\s+טלפון\s+שהתקשרו\s+ממנו[^:\n]*:\s*(\S+)/);
  const phone = phoneMatch ? phoneMatch[1].trim() : null;
  const nameMatch = body.match(/שם\s+בעל\s+האירוע[^:\n]*:\s*(.+)/);
  const rawName = nameMatch ? nameMatch[1].trim() : '';
  const name = rawName || phone || '';
  return { source: 'vonage', phone, name, notes: body.trim() };
}

function parseTelekol(body) {
  const get = (label) => {
    const m = body.match(new RegExp(`${label}\\s*[:\\s]+([^\\n\\r]+)`));
    return m ? m[1].trim() : null;
  };
  const phoneMatch = body.match(/מספר טלפון לחזרה\s*(\d[\d\-]+)/);
  return {
    source: 'telekol',
    phone:       phoneMatch ? phoneMatch[1].trim() : null,
    name:        get('שם הפונה'),
    event_type:  get('סוג אירוע'),
    guest_count: get('כמות מוזמנים'),
    event_date:  parseHebrewDate(get('תאריך האירוע')),
    notes:       get('ההודעה'),
  };
}

function parseHebrewDate(str) {
  if (!str) return null;
  // Try dd/mm/yyyy or dd.mm.yyyy
  const m = str.match(/(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})/);
  if (m) {
    const [, d, mo, y] = m;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  return null;
}

function decodeBase64(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function stripHtml(str) {
  return str
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(tr|p|div|li)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#160;/g, ' ');
}

function extractBody(payload) {
  // Prefer plain text part
  if (payload.mimeType === 'text/plain' && payload.body?.data)
    return decodeBase64(payload.body.data);
  if (payload.mimeType === 'text/html' && payload.body?.data)
    return stripHtml(decodeBase64(payload.body.data));
  if (payload.parts) {
    const plain = payload.parts.find(p => p.mimeType === 'text/plain');
    if (plain) return extractBody(plain);
    for (const part of payload.parts) {
      const text = extractBody(part);
      if (text) return text;
    }
  }
  if (payload.body?.data) return decodeBase64(payload.body.data);
  return '';
}

// ── MATCH & UPSERT LEAD ───────────────────────────────────────────────────────

async function upsertLead(parsed, emailId, emailTs) {
  if (!parsed.phone && !parsed.email && !parsed.name) return;
  if (parsed.phone) parsed.phone = normalizePhone(parsed.phone);

  const tsExpr = emailTs ? `to_timestamp(${Math.floor(emailTs / 1000)})` : 'NOW()';

  // Check if lead already exists by phone or email
  let existing = null;
  if (parsed.phone) {
    const r = await pool.query('SELECT id FROM leads WHERE phone = $1 LIMIT 1', [parsed.phone]);
    existing = r.rows[0];
  }
  if (!existing && parsed.email) {
    const r = await pool.query('SELECT id FROM leads WHERE email = $1 LIMIT 1', [parsed.email]);
    existing = r.rows[0];
  }

  if (existing) {
    await pool.query(
      `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by, is_read, created_at)
       VALUES ($1, 'email', 'inbound', $2, NULL, false, ${tsExpr})`,
      [existing.id, `[אימייל אוטומטי - ${parsed.source}] ${parsed.notes || ''}`]
    );

    // A fresh inquiry on a lost lead should reopen it so it resurfaces in "new"
    const { rows: stageRows } = await pool.query('SELECT stage FROM leads WHERE id = $1', [existing.id]);
    if (stageRows[0]?.stage === 'lost') {
      await pool.query(`UPDATE leads SET stage = 'new' WHERE id = $1`, [existing.id]);
      await pool.query(
        `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by, is_read, created_at)
         VALUES ($1, 'note', 'outbound', $2, NULL, true, ${tsExpr})`,
        [existing.id, '🔄 הליד חזר לחדשים בעקבות פנייה חדשה במייל']
      );
    }

    // Notify assigned user about inbound email (non-blocking)
    const _eid = existing.id;
    const _src = parsed.source;
    const _preview = (parsed.notes || '').slice(0, 200);
    pool.query(
      `SELECT u.phone, l.name FROM leads l JOIN users u ON u.id = l.assigned_to WHERE l.id = $1 AND u.phone IS NOT NULL`,
      [_eid]
    ).then(async ({ rows }) => {
      if (!rows[0]) return;
      const baseUrl = process.env.SERVER_URL || 'https://crm-production-c3df.up.railway.app';
      await sendWhatsApp(rows[0].phone,
        `אימייל חדש מ${rows[0].name} (${_src}):\n"${_preview}"\nלפתיחת הליד: ${baseUrl}/?lead=${_eid}`
      );
    }).catch(() => {});
  } else {
    const fields = ['source', 'stage', 'name', 'phone', 'email', 'event_date', 'event_time', 'event_type', 'guest_count', 'budget', 'notes', 'event_name'];
    const values = [parsed.source, 'new', parsed.name, parsed.phone, parsed.email,
                    parsed.event_date || null, parsed.event_time || null, parsed.event_type, parsed.guest_count, parsed.budget, parsed.notes, parsed.name];
    const cols = fields.join(', ');
    const placeholders = fields.map((_, i) => `$${i+1}`).join(', ');
    const { rows: newRows } = await pool.query(`INSERT INTO leads (${cols}) VALUES (${placeholders}) RETURNING *`, values);
    // Insert inbound interaction with real email timestamp so received_at reflects actual email date
    await pool.query(
      `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by, is_read, created_at)
       VALUES ($1, 'email', 'inbound', $2, NULL, false, ${tsExpr})`,
      [newRows[0].id, `[אימייל אוטומטי - ${parsed.source}] ${parsed.notes || ''}`]
    );
    if (newRows[0]?.event_date) {
      try {
        const { syncLeadToCalendar } = require('./calendarService');
        syncLeadToCalendar(newRows[0].id, 'option', null).catch(() => {});
      } catch {}
    }
  }

  await pool.query(
    `INSERT INTO processed_emails (gmail_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [emailId]
  );
}

// ── MAIN POLL FUNCTION ────────────────────────────────────────────────────────

async function pollGmail() {
  try {
    const auth  = getAuth();
    const gmail = google.gmail({ version: 'v1', auth });

    // Ensure processed_emails table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS processed_emails (
        gmail_id TEXT PRIMARY KEY,
        processed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Fetch ALL emails from the last 7 days (read or unread) — the processed_emails
    // table dedups, so relying on is:unread only caused reads to be missed.
    const since = Math.floor((Date.now() - 7 * 24 * 3600 * 1000) / 1000);
    const messages = [];
    let pageToken = null;
    do {
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: `after:${since}`,
        maxResults: 100,
        ...(pageToken ? { pageToken } : {}),
      });
      messages.push(...(res.data.messages || []));
      pageToken = res.data.nextPageToken || null;
    } while (pageToken);

    for (const msg of messages) {
      try {
        // Skip already processed
        const already = await pool.query('SELECT 1 FROM processed_emails WHERE gmail_id = $1', [msg.id]);
        if (already.rows.length > 0) continue;

        const full = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
        const emailTs = full.data.internalDate ? Number(full.data.internalDate) : null;
        const headers = full.data.payload.headers;
        const from    = headers.find(h => h.name === 'From')?.value || '';
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const body    = extractBody(full.data.payload);

        let parsed = null;

        if (from.includes('hafakot.co.il') && (subject.toUpperCase().includes('CALL EVENT') || body.includes('להלן פרטי הליד:'))) {
          parsed = parseCallEvent(body);
        } else if (from.includes('formsubmit.co') && subject.includes('פופאפ')) {
          parsed = parseFormSubmit(body, 'website_popup');           // new site (FormSubmit)
        } else if (from.includes('formsubmit.co') && subject.includes('פנייה חדשה')) {
          parsed = parseFormSubmit(body, 'website_form');            // new site (FormSubmit)
        } else if (subject.includes('הודעה חדשה פופאפ')) {
          parsed = parseWebsitePopup(body);                          // old site
        } else if (subject.includes('פנייה חדשה מאתר שרביה')) {
          parsed = parseWebsiteForm(body);                           // old site
        } else if (from.includes('telekol') && subject.includes('טלקול')) {
          parsed = parseTelekol(body);
        } else if (from.includes('dont-reply@ai.vonage.com')) {
          parsed = parseVonage(body);
        }

        if (parsed) {
          await upsertLead(parsed, msg.id, emailTs);
          console.log(`[Gmail] Processed: ${subject} → ${parsed.source} lead`);
        } else {
          // Mark as processed so we don't re-check irrelevant emails
          await pool.query(
            `INSERT INTO processed_emails (gmail_id) VALUES ($1) ON CONFLICT DO NOTHING`,
            [msg.id]
          );
        }
      } catch (err) {
        // Do NOT mark processed on error — that would permanently drop a lead
        // whose email hit a transient failure. Leave it to retry next poll.
        console.error(`[Gmail] Error processing message ${msg.id} (will retry next poll):`, err.message);
      }
    }
  } catch (err) {
    console.error('[Gmail] Poll error:', err.message);
  }
}

// ── SEND EMAIL ────────────────────────────────────────────────────────────────

function buildRawEmail({ to, subject, body, attachments }) {
  const boundary = `boundary_${Date.now()}`;
  const hasAttachments = attachments && attachments.length > 0;

  const headers = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    hasAttachments
      ? `Content-Type: multipart/mixed; boundary="${boundary}"`
      : 'Content-Type: text/plain; charset=utf-8',
  ].join('\r\n');

  if (!hasAttachments) {
    const raw = `${headers}\r\n\r\n${body}`;
    return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  const textPart = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n');

  const attachParts = attachments.map(({ buffer, name, mime }) => [
    `--${boundary}`,
    `Content-Type: ${mime || 'application/octet-stream'}`,
    `Content-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Content-Transfer-Encoding: base64',
    '',
    buffer.toString('base64'),
  ].join('\r\n'));

  const raw = `${headers}\r\n\r\n${textPart}\r\n${attachParts.join('\r\n')}\r\n--${boundary}--`;
  return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendEmail({ to, subject, body, attachments, attachmentBuffer, attachmentName, attachmentMime }) {
  const tokenPath = path.join(__dirname, '../google_token.json');
  if (!fs.existsSync(tokenPath)) throw new Error('Gmail not configured');

  // backwards compat: single attachment fields → attachments array
  let allAttachments = attachments || [];
  if (!allAttachments.length && attachmentBuffer && attachmentName) {
    allAttachments = [{ buffer: attachmentBuffer, name: attachmentName, mime: attachmentMime }];
  }

  const auth = getAuth();
  const gmail = google.gmail({ version: 'v1', auth });

  const raw = buildRawEmail({ to, subject, body, attachments: allAttachments });
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
}

module.exports = { pollGmail, sendEmail, getAuth, parseFormSubmit, parseFormSubmitDate };
