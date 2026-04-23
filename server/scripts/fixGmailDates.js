/**
 * Backfill: for Gmail-sourced leads, set lead_interactions.created_at to the
 * real email received date so "התקבל ב" shows when the email actually arrived.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { google } = require('googleapis');
const fs   = require('fs');
const path = require('path');
const pool = require('../db/pool');

function getGmailAuth() {
  const creds = JSON.parse(fs.readFileSync(path.join(__dirname, '../credentials.json')));
  const { client_id, client_secret } = creds.installed;
  const oauth2 = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3333/callback');
  oauth2.setCredentials(JSON.parse(fs.readFileSync(path.join(__dirname, '../google_token.json'))));
  return oauth2;
}

function decodeBase64(str) {
  return Buffer.from(str.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf-8');
}
function stripHtml(str) {
  return str
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(tr|p|div|li)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#160;/g,' ');
}
function extractBody(payload) {
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decodeBase64(payload.body.data);
  if (payload.mimeType === 'text/html'  && payload.body?.data) return stripHtml(decodeBase64(payload.body.data));
  if (payload.parts) {
    const plain = payload.parts.find(p => p.mimeType === 'text/plain');
    if (plain) return extractBody(plain);
    for (const part of payload.parts) { const t = extractBody(part); if (t) return t; }
  }
  if (payload.body?.data) return decodeBase64(payload.body.data);
  return '';
}
function get(body, label) {
  const m = body.match(new RegExp(`${label}[:\\s]+([^\\n\\r]+)`));
  return m ? m[1].trim() : null;
}

function parseEmail(from, subject, body) {
  if (from.includes('hafakot.co.il') && subject.toUpperCase().includes('CALL EVENT')) {
    const nameMatch = body.match(/להלן פרטי הליד:[^\n]*\n([^\n]+)\s+מתעניין/);
    return { source: 'call_event', name: nameMatch?.[1]?.trim() || null, phone: get(body, 'טלפון') };
  }
  if (subject.includes('הודעה חדשה פופאפ')) {
    const lines = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const idx = lines.findIndex(l => l.includes('אני'));
    if (idx >= 0) return { source: 'website_popup', name: lines[idx+1]||null, phone: lines[idx+2]||null };
    const dashIdx = lines.findIndex(l => l.startsWith('---'));
    const before = dashIdx >= 0 ? lines.slice(0, dashIdx) : lines.slice(0, 3);
    const valid = before.filter(l => !l.includes('תאריך') && !l.includes('זמן') && !l.includes('קישור') && !l.startsWith('http'));
    return { source: 'website_popup', name: valid[0]||null, phone: valid[1]||null };
  }
  if (subject.includes('פנייה חדשה מאתר שרביה')) {
    return { source: 'website_form', name: get(body,'שם מלא'), phone: get(body,'טלפון') };
  }
  if (from.includes('telekol') && subject.includes('טלקול')) {
    const m = body.match(/מספר טלפון לחזרה\s*(\d[\d\-]+)/);
    return { source: 'telekol', name: get(body,'שם הפונה'), phone: m?.[1]?.trim()||null };
  }
  return null;
}

(async () => {
  try {
    const auth  = getGmailAuth();
    const gmail = google.gmail({ version: 'v1', auth });

    const since = Math.floor(new Date('2026-04-01T00:00:00+03:00').getTime() / 1000);
    const res = await gmail.users.messages.list({ userId: 'me', q: `after:${since}`, maxResults: 300 });
    const msgs = res.data.messages || [];
    console.log(`Fetched ${msgs.length} emails since April 1\n`);

    let fixed = 0, notFound = 0;

    for (const msg of msgs) {
      const full    = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
      const emailTs = full.data.internalDate ? Number(full.data.internalDate) : null;
      if (!emailTs) continue;

      const headers = full.data.payload.headers;
      const from    = headers.find(h => h.name === 'From')?.value || '';
      const subject = headers.find(h => h.name === 'Subject')?.value || '';
      const parsed  = parseEmail(from, subject, extractBody(full.data.payload));
      if (!parsed) continue;

      const { name, phone, source } = parsed;
      console.log(`  Email: ${subject.slice(0,50)} | name=${name} phone=${phone}`);

      // Find lead by phone first, then name
      let lead = null;
      if (phone) {
        const { rows } = await pool.query(
          `SELECT id FROM leads WHERE REGEXP_REPLACE(phone,'[^0-9]','','g') = REGEXP_REPLACE($1,'[^0-9]','','g') AND source=$2 LIMIT 1`,
          [phone, source]
        );
        lead = rows[0];
      }
      if (!lead && name) {
        const { rows } = await pool.query(
          `SELECT id FROM leads WHERE name ILIKE $1 AND source=$2 LIMIT 1`,
          [`%${name}%`, source]
        );
        lead = rows[0];
      }

      if (!lead) {
        console.log(`    → [NOT FOUND] no lead matched`);
        notFound++;
        continue;
      }

      const tsSeconds = Math.floor(emailTs / 1000);
      const dateStr   = new Date(emailTs).toLocaleDateString('he-IL');

      // Upsert the inbound interaction with real email date
      const { rows: existing } = await pool.query(
        `SELECT id FROM lead_interactions WHERE lead_id=$1 AND direction='inbound' LIMIT 1`,
        [lead.id]
      );
      if (existing.length) {
        await pool.query(
          `UPDATE lead_interactions SET created_at=to_timestamp($1) WHERE id=$2`,
          [tsSeconds, existing[0].id]
        );
        console.log(`    → [UPDATED] lead ${lead.id} created_at → ${dateStr}`);
      } else {
        await pool.query(
          `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by, is_read, created_at)
           VALUES ($1,'email','inbound',$2,NULL,false,to_timestamp($3))`,
          [lead.id, `[אימייל אוטומטי - ${source}]`, tsSeconds]
        );
        console.log(`    → [INSERTED] lead ${lead.id} with date ${dateStr}`);
      }
      fixed++;
    }

    console.log(`\nDone. Fixed ${fixed} leads. ${notFound} emails had no matching lead.`);
  } catch (err) {
    console.error('Error:', err.message);
    if (err.stack) console.error(err.stack);
  } finally {
    await pool.end();
  }
})();
