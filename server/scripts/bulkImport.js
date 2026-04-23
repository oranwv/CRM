/**
 * One-time bulk import: last 14 days of Gmail + WhatsApp history.
 * Run: node server/scripts/bulkImport.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { google } = require('googleapis');
const fs   = require('fs');
const path = require('path');
const axios = require('axios');
const pool = require('../db/pool');

const CUTOFF = new Date('2026-04-01T00:00:00+03:00').getTime();

// ── AUTH ──────────────────────────────────────────────────────────────────────

function getGmailAuth() {
  const creds = JSON.parse(fs.readFileSync(path.join(__dirname, '../credentials.json')));
  const { client_id, client_secret } = creds.installed;
  const oauth2 = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3333/callback');
  oauth2.setCredentials(JSON.parse(fs.readFileSync(path.join(__dirname, '../google_token.json'))));
  return oauth2;
}

// ── GMAIL PARSERS (mirror of gmailService.js) ─────────────────────────────────

function parseHebrewDate(str) {
  if (!str) return null;
  const m = str.match(/(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y.length === 2 ? '20' + y : y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

function decodeBase64(str) {
  return Buffer.from(str.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf-8');
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
  if (payload.mimeType === 'text/plain' && payload.body?.data)
    return decodeBase64(payload.body.data);
  if (payload.mimeType === 'text/html' && payload.body?.data)
    return stripHtml(decodeBase64(payload.body.data));
  if (payload.parts) {
    const plain = payload.parts.find(p => p.mimeType === 'text/plain');
    if (plain) return extractBody(plain);
    for (const part of payload.parts) {
      const t = extractBody(part);
      if (t) return t;
    }
  }
  if (payload.body?.data) return decodeBase64(payload.body.data);
  return '';
}

function get(body, label) {
  const m = body.match(new RegExp(`${label}[:\\s]+([^\\n\\r]+)`));
  return m ? m[1].trim() : null;
}

function parseCallEvent(body) {
  const nameMatch = body.match(/להלן פרטי הליד:[^\n]*\n([^\n]+)\s+מתעניין/);
  return {
    source: 'call_event',
    name:        nameMatch ? nameMatch[1].trim() : null,
    phone:       get(body, 'טלפון'),
    email:       get(body, 'מייל'),
    guest_count: get(body, 'כמות מוזמנים'),
    event_type:  get(body, 'סוג האירוע'),
    event_date:  parseHebrewDate(get(body, 'מתי')),
    budget:      get(body, 'תקציב'),
    notes:       get(body, 'הערות'),
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
  return {
    source: 'website_form',
    name:  get(body, 'שם מלא'),
    phone: get(body, 'טלפון'),
    notes: get(body, 'פרטי הפנייה'),
  };
}

function parseTelekol(body) {
  const phoneMatch = body.match(/מספר טלפון לחזרה\s*(\d[\d\-]+)/);
  return {
    source: 'telekol',
    phone:       phoneMatch ? phoneMatch[1].trim() : null,
    name:        get(body, 'שם הפונה'),
    event_type:  get(body, 'סוג אירוע'),
    guest_count: get(body, 'כמות מוזמנים'),
    event_date:  parseHebrewDate(get(body, 'תאריך האירוע')),
    notes:       get(body, 'ההודעה'),
  };
}

// ── GMAIL UPSERT ──────────────────────────────────────────────────────────────

async function upsertLead(parsed, gmailId, emailTs) {
  if (!parsed.phone && !parsed.email && !parsed.name) {
    await pool.query(`INSERT INTO processed_emails (gmail_id) VALUES ($1) ON CONFLICT DO NOTHING`, [gmailId]);
    return 'skipped';
  }

  // emailTs is internalDate in ms from Gmail API
  const tsExpr = emailTs ? `to_timestamp(${Math.floor(emailTs / 1000)})` : 'NOW()';

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
    await pool.query(`INSERT INTO processed_emails (gmail_id) VALUES ($1) ON CONFLICT DO NOTHING`, [gmailId]);
    return 'matched';
  }

  const t = (s, n) => s ? String(s).slice(0, n) : null;
  const fields = ['source','stage','name','phone','email','event_date','event_type','guest_count','budget','notes'];
  const vals   = [t(parsed.source,50),'new',t(parsed.name,255),t(parsed.phone,50),t(parsed.email,255),
                  parsed.event_date||null,t(parsed.event_type,100),t(parsed.guest_count,50),t(parsed.budget,100),t(parsed.notes,5000)];
  const { rows: newRows } = await pool.query(
    `INSERT INTO leads (${fields.join(',')}) VALUES (${fields.map((_,i)=>`$${i+1}`).join(',')}) RETURNING id`,
    vals
  );
  // Insert inbound interaction with real email timestamp so received_at reflects actual email date
  await pool.query(
    `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by, is_read, created_at)
     VALUES ($1, 'email', 'inbound', $2, NULL, false, ${tsExpr})`,
    [newRows[0].id, `[אימייל אוטומטי - ${parsed.source}] ${parsed.notes || ''}`]
  );
  await pool.query(`INSERT INTO processed_emails (gmail_id) VALUES ($1) ON CONFLICT DO NOTHING`, [gmailId]);
  return 'created';
}

// ── GMAIL IMPORT ──────────────────────────────────────────────────────────────

async function importGmail() {
  console.log('\n── Gmail ──────────────────────────────────────────');
  const auth  = getGmailAuth();
  const gmail = google.gmail({ version: 'v1', auth });

  const since = Math.floor(CUTOFF / 1000);
  // No is:unread filter — catch everything from the last 14 days
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: `after:${since}`,
    maxResults: 200,
  });

  const msgs = res.data.messages || [];
  console.log(`Found ${msgs.length} emails since April 1`);

  const counts = { created: 0, matched: 0, skipped: 0, irrelevant: 0 };

  for (const msg of msgs) {
    const already = await pool.query('SELECT 1 FROM processed_emails WHERE gmail_id = $1', [msg.id]);
    if (already.rows.length) { counts.skipped++; continue; }

    const full    = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
    const emailTs = full.data.internalDate ? Number(full.data.internalDate) : null;
    const headers = full.data.payload.headers;
    const from    = headers.find(h => h.name === 'From')?.value || '';
    const subject = headers.find(h => h.name === 'Subject')?.value || '';
    const body    = extractBody(full.data.payload);

    let parsed = null;
    if (from.includes('hafakot.co.il') && subject.toUpperCase().includes('CALL EVENT'))
      parsed = parseCallEvent(body);
    else if (subject.includes('הודעה חדשה פופאפ'))
      parsed = parseWebsitePopup(body);
    else if (subject.includes('פנייה חדשה מאתר שרביה'))
      parsed = parseWebsiteForm(body);
    else if (from.includes('telekol') && subject.includes('טלקול'))
      parsed = parseTelekol(body);

    if (parsed) {
      const result = await upsertLead(parsed, msg.id, emailTs);
      counts[result] = (counts[result] || 0) + 1;
      console.log(`  [${result.toUpperCase()}] ${subject.slice(0,60)} — ${parsed.name || parsed.phone || '?'}`);
    } else {
      await pool.query(`INSERT INTO processed_emails (gmail_id) VALUES ($1) ON CONFLICT DO NOTHING`, [msg.id]);
      counts.irrelevant++;
    }
  }

  console.log(`\nGmail summary: ${counts.created} created | ${counts.matched} matched existing | ${counts.skipped} already processed | ${counts.irrelevant} irrelevant`);
  return counts;
}

// ── WHATSAPP HELPERS ──────────────────────────────────────────────────────────

function formatPhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0'))   return '972' + digits.slice(1);
  return digits;
}

async function findLeadByPhone(formattedPhone) {
  const { rows } = await pool.query(
    `SELECT id, name FROM leads WHERE
      CASE WHEN REGEXP_REPLACE(phone,'[^0-9]','','g') LIKE '0%'
        THEN '972' || SUBSTRING(REGEXP_REPLACE(phone,'[^0-9]','','g'),2)
        ELSE REGEXP_REPLACE(phone,'[^0-9]','','g')
      END = $1 LIMIT 1`,
    [formattedPhone]
  );
  return rows[0] || null;
}

async function fetchContactInfo(chatId) {
  try {
    const BASE  = `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}`;
    const TOKEN = process.env.GREEN_API_TOKEN;
    const res = await axios.post(`${BASE}/getContactInfo/${TOKEN}`, { chatId }, { timeout: 8000 });
    const d = res.data || {};
    const name   = (d.name || d.pushname || '').replace(/@c\.us$/, '').trim() || null;
    const avatar = d.avatar || d.urlAvatar || null;
    return { name, avatar };
  } catch {
    return { name: null, avatar: null };
  }
}

async function createLeadFromWhatsApp(phone, chatName, firstMessage, chatId) {
  const { name: profileName, avatar } = chatId ? await fetchContactInfo(chatId) : {};
  const displayName = profileName || chatName || 'ליד וואטסאפ';
  const { rows } = await pool.query(
    `INSERT INTO leads (name, phone, source, stage, notes, avatar_url)
     VALUES ($1, $2, 'whatsapp', 'new', $3, $4) RETURNING id`,
    [displayName, phone, `הודעה ראשונה: ${firstMessage}`, avatar || null]
  );
  return rows[0].id;
}

function extractMessageText(m) {
  if (m.typeMessage === 'textMessage')         return m.textMessage || '';
  if (m.typeMessage === 'extendedTextMessage') return m.extendedTextMessage?.text || '';
  return '';
}

// ── WHATSAPP IMPORT ───────────────────────────────────────────────────────────

async function importWhatsApp() {
  console.log('\n── WhatsApp ───────────────────────────────────────');
  const BASE  = `${process.env.GREEN_API_URL}/waInstance${process.env.GREEN_API_INSTANCE}`;
  const TOKEN = process.env.GREEN_API_TOKEN;

  const chatsRes = await axios.get(`${BASE}/getChats/${TOKEN}`);
  const chats = (chatsRes.data || []).filter(c => c.id && !c.id.endsWith('@g.us'));
  console.log(`Found ${chats.length} non-group chats`);

  const counts = { matched: 0, created: 0, newMessages: 0, noMessages: 0, failed: 0 };

  for (const chat of chats) {
    const chatId = chat.id;
    const phone  = chatId.replace('@c.us', '');
    const formatted = formatPhone(phone);

    // Fetch history with 800ms delay + retry with exponential backoff
    await new Promise(r => setTimeout(r, 800));
    let history = [];
    let fetchFailed = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await axios.post(`${BASE}/getChatHistory/${TOKEN}`, { chatId, count: 500 }, { timeout: 15000 });
        history = r.data || [];
        break;
      } catch (err) {
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        } else {
          fetchFailed = true;
          console.log(`  [FAILED] ${phone}: ${err.response?.data?.message || err.message}`);
        }
      }
    }
    if (fetchFailed) { counts.failed++; continue; }

    // Filter to last DAYS days
    const recent = history.filter(m => m.timestamp && m.timestamp * 1000 >= CUTOFF);
    if (!recent.length) { counts.noMessages++; continue; }

    // Check for existing lead
    let lead = await findLeadByPhone(formatted);
    let leadId;

    if (lead) {
      leadId = lead.id;
      counts.matched++;
      process.stdout.write(`  [MATCHED] ${lead.name} (${phone}): `);
    } else {
      // Only create a new lead if there's at least one inbound message
      const hasInbound = recent.some(m => m.type === 'incoming');
      if (!hasInbound) { counts.noMessages++; continue; }

      const firstName = recent.find(m => m.type === 'incoming' && extractMessageText(m));
      const firstText = firstName ? extractMessageText(firstName) : '';
      // Use chat.name only if it's not the chatId/phone format
      const chatName = chat.name && !chat.name.includes('@') && !/^\d+$/.test(chat.name) ? chat.name : null;
      leadId = await createLeadFromWhatsApp(formatted, chatName, firstText, null); // skip fetchContactInfo during bulk — run backfill after
      counts.created++;
      process.stdout.write(`  [CREATED] ${chat.name || phone}: `);
    }

    let added = 0;
    for (const m of recent) {
      const text = extractMessageText(m);
      if (!text) continue;

      const externalId = m.idMessage;
      const { rows: dup } = await pool.query('SELECT id FROM messages WHERE external_id = $1', [externalId]);
      if (dup.length) continue;

      const direction = m.type === 'outgoing' ? 'outbound' : 'inbound';
      await pool.query(
        `INSERT INTO messages (lead_id, channel, direction, body, external_id, timestamp, is_read)
         VALUES ($1, 'whatsapp', $2, $3, $4, to_timestamp($5), true)`,
        [leadId, direction, text, externalId, m.timestamp]
      );
      added++;
    }
    counts.newMessages += added;
    console.log(`${added} messages added`);
  }

  console.log(`\nWhatsApp summary: ${counts.matched} matched | ${counts.created} created | ${counts.newMessages} messages added | ${counts.noMessages} skipped | ${counts.failed} failed`);
  return counts;
}

// ── RUN ───────────────────────────────────────────────────────────────────────

(async () => {
  try {
    await importGmail();
    await importWhatsApp();
  } catch (err) {
    console.error('\nFatal error:', err.message);
    if (err.stack) console.error(err.stack);
  } finally {
    await pool.end();
    console.log('\nDone.');
  }
})();
