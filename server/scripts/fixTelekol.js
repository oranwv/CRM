/**
 * Backfill phone numbers for telekol leads that were imported without one.
 * Re-fetches telekol emails from Gmail, re-parses phone, and UPDATEs the lead.
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
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#160;/g, ' ');
}
function extractBody(payload) {
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decodeBase64(payload.body.data);
  if (payload.mimeType === 'text/html' && payload.body?.data) return stripHtml(decodeBase64(payload.body.data));
  if (payload.parts) {
    const plain = payload.parts.find(p => p.mimeType === 'text/plain');
    if (plain) return extractBody(plain);
    for (const part of payload.parts) { const t = extractBody(part); if (t) return t; }
  }
  if (payload.body?.data) return decodeBase64(payload.body.data);
  return '';
}

function parseTelekolPhone(body) {
  const m = body.match(/מספר טלפון לחזרה\s*(\d[\d\-]+)/);
  return m ? m[1].trim() : null;
}
function parseTelekolName(body) {
  const m = body.match(/שם הפונה\s*[:\s]+([^\n\r]+)/);
  return m ? m[1].trim() : null;
}

(async () => {
  try {
    const auth  = getGmailAuth();
    const gmail = google.gmail({ version: 'v1', auth });

    const since = Math.floor(new Date('2026-04-01T00:00:00+03:00').getTime() / 1000);
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: `after:${since} subject:טלקול`,
      maxResults: 100,
    });

    const msgs = res.data.messages || [];
    console.log(`Found ${msgs.length} telekol emails`);

    let updated = 0;
    for (const msg of msgs) {
      const full = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
      const body = extractBody(full.data.payload);
      const phone = parseTelekolPhone(body);
      const name  = parseTelekolName(body);

      if (!phone) { console.log(`  [SKIP] no phone parsed — name: ${name}`); continue; }

      // Find lead by name (telekol leads have no email/phone to match on)
      const { rows } = await pool.query(
        `SELECT id, phone FROM leads WHERE source = 'telekol' AND (phone IS NULL OR phone = '') AND name ILIKE $1 LIMIT 1`,
        [name ? `%${name}%` : '____NOMATCH____']
      );
      if (!rows.length) { console.log(`  [SKIP] no phone-less telekol lead found for name: ${name}`); continue; }

      await pool.query('UPDATE leads SET phone = $1, updated_at = NOW() WHERE id = $2', [phone, rows[0].id]);
      console.log(`  [UPDATED] ${name} → ${phone} (lead ${rows[0].id})`);
      updated++;
    }

    console.log(`\nDone. Updated ${updated} telekol leads with phone numbers.`);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
})();
