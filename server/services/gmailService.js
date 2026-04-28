const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');

const CREDENTIALS_PATH = path.join(__dirname, '../credentials.json');
const TOKEN_PATH       = path.join(__dirname, '../google_token.json');

function getAuth() {
  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_id, client_secret } = creds.installed;
  const oauth2 = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3333/callback');
  oauth2.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH)));
  return oauth2;
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
  } else {
    const fields = ['source', 'stage', 'name', 'phone', 'email', 'event_date', 'event_type', 'guest_count', 'budget', 'notes', 'event_name'];
    const values = [parsed.source, 'new', parsed.name, parsed.phone, parsed.email,
                    parsed.event_date || null, parsed.event_type, parsed.guest_count, parsed.budget, parsed.notes, parsed.name];
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

    // Fetch unread emails from the last 7 days
    const since = Math.floor((Date.now() - 7 * 24 * 3600 * 1000) / 1000);
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: `after:${since} is:unread`,
      maxResults: 50,
    });

    const messages = res.data.messages || [];
    for (const msg of messages) {
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

      if (from.includes('hafakot.co.il') && subject.toUpperCase().includes('CALL EVENT')) {
        parsed = parseCallEvent(body);
      } else if (subject.includes('הודעה חדשה פופאפ')) {
        parsed = parseWebsitePopup(body);
      } else if (subject.includes('פנייה חדשה מאתר שרביה')) {
        parsed = parseWebsiteForm(body);
      } else if (from.includes('telekol') && subject.includes('טלקול')) {
        parsed = parseTelekol(body);
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
    }
  } catch (err) {
    console.error('[Gmail] Poll error:', err.message);
  }
}

// ── SEND EMAIL ────────────────────────────────────────────────────────────────

function buildRawEmail({ to, subject, body, attachmentBuffer, attachmentName, attachmentMime }) {
  const boundary = `boundary_${Date.now()}`;
  const hasAttachment = attachmentBuffer && attachmentName;

  const headers = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    hasAttachment
      ? `Content-Type: multipart/mixed; boundary="${boundary}"`
      : 'Content-Type: text/plain; charset=utf-8',
  ].join('\r\n');

  if (!hasAttachment) {
    const raw = `${headers}\r\n\r\n${body}`;
    return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  const textPart = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n');

  const attachPart = [
    `--${boundary}`,
    `Content-Type: ${attachmentMime || 'application/octet-stream'}`,
    `Content-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(attachmentName)}`,
    'Content-Transfer-Encoding: base64',
    '',
    attachmentBuffer.toString('base64'),
    `--${boundary}--`,
  ].join('\r\n');

  const raw = `${headers}\r\n\r\n${textPart}\r\n${attachPart}`;
  return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendEmail({ to, subject, body, attachmentBuffer, attachmentName, attachmentMime }) {
  const tokenPath = path.join(__dirname, '../google_token.json');
  if (!fs.existsSync(tokenPath)) throw new Error('Gmail not configured');

  const auth = getAuth();
  const gmail = google.gmail({ version: 'v1', auth });

  const raw = buildRawEmail({ to, subject, body, attachmentBuffer, attachmentName, attachmentMime });
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
}

module.exports = { pollGmail, sendEmail };
