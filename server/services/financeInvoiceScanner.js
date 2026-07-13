// Finance invoice scanner — scans Gmail accounts for supplier invoices and files
// them into Google Drive, one folder per month ("MM-YYYY") under a "חשבוניות" root.
//
// Pipeline per email: cheap keyword/attachment prefilter → AI confirmation
// (Claude, structured JSON) → download the invoice (attachment or link) →
// upload to the month folder in Drive → record in finance_invoice_files.
// De-dupe: finance_scanned_emails tracks every scanned gmail message id.
const fs     = require('fs');
const path   = require('path');
const stream = require('stream');
const axios  = require('axios');
const jwt    = require('jsonwebtoken');
const { google } = require('googleapis');
const { OpenAI } = require('openai');
const pool = require('../db/pool');

const CREDENTIALS_PATH = path.join(__dirname, '../credentials.json');
const TOKEN_PATH       = path.join(__dirname, '../google_token.json');
const ROOT_FOLDER_NAME = 'חשבוניות';
const KEYWORDS = ['חשבונית', 'קבלה', 'invoice', 'receipt', 'חשבונית מס'];

// ── OAuth helpers ─────────────────────────────────────────────────────────────

function oauthClient(redirectUri = 'http://localhost:3333/callback') {
  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_id, client_secret } = creds.installed || creds.web || creds;
  return new google.auth.OAuth2(client_id, client_secret, redirectUri);
}

function primaryAuth() {
  const auth = oauthClient();
  auth.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH)));
  return auth;
}

function authForToken(tokenJson) {
  const auth = oauthClient();
  auth.setCredentials(typeof tokenJson === 'string' ? JSON.parse(tokenJson) : tokenJson);
  return auth;
}

// Connect-URL + callback for ADDITIONAL mailboxes (gmail.readonly only).
// Redirect URI: `${SERVER_URL}/api/finance/gmail/oauth/callback` — must be
// registered in the Google Cloud Console OAuth client.
function connectRedirectUri() {
  return `${process.env.SERVER_URL || 'http://localhost:3000'}/api/finance/gmail/oauth/callback`;
}

function buildConnectUrl(userId) {
  const auth = oauthClient(connectRedirectUri());
  const state = jwt.sign({ uid: userId, purpose: 'finance-gmail' }, process.env.JWT_SECRET, { expiresIn: '15m' });
  return auth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    state,
  });
}

// Public endpoint (Google redirects the browser here). Validates the signed state.
async function oauthCallbackHandler(req, res) {
  const { code, state, error } = req.query;
  const html = (msg) => res.send(`<html dir="rtl"><body style="font-family:sans-serif;text-align:center;padding-top:80px"><h3>${msg}</h3><p>אפשר לסגור את החלון.</p><script>setTimeout(()=>window.close(),2500)</script></body></html>`);
  try {
    if (error) return html('החיבור בוטל');
    jwt.verify(state, process.env.JWT_SECRET); // throws if forged/expired
    const auth = oauthClient(connectRedirectUri());
    const { tokens } = await auth.getToken(code);
    auth.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth });
    const { data: profile } = await gmail.users.getProfile({ userId: 'me' });
    await pool.query(
      `INSERT INTO finance_gmail_accounts (email, token_json)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET token_json = $2, active = TRUE`,
      [profile.emailAddress, JSON.stringify(tokens)]
    );
    console.log('[FinanceScan] Connected mailbox:', profile.emailAddress);
    return html(`התיבה ${profile.emailAddress} חוברה בהצלחה ✓`);
  } catch (err) {
    console.error('[FinanceScan] OAuth callback error:', err.message);
    return html('שגיאה בחיבור התיבה');
  }
}

// ── Drive: root + monthly folders ─────────────────────────────────────────────

async function ensureFolder(drive, name, parentId = null) {
  const q = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    'trashed = false',
    parentId ? `'${parentId}' in parents` : null,
  ].filter(Boolean).join(' and ');
  const { data } = await drive.files.list({ q, fields: 'files(id)', pageSize: 1 });
  if (data.files?.length) return data.files[0].id;
  const { data: created } = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', ...(parentId ? { parents: [parentId] } : {}) },
    fields: 'id',
  });
  return created.id;
}

async function getRootFolderId(drive) {
  const { rows } = await pool.query(
    "SELECT key, value FROM settings WHERE key IN ('finance_drive_root_id', 'finance_drive_root_link')");
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  if (settings.finance_drive_root_id) {
    try {
      await drive.files.get({ fileId: settings.finance_drive_root_id, fields: 'id', supportsAllDrives: true });
      return settings.finance_drive_root_id;
    } catch {
      // Admin explicitly configured a folder (link saved) — fail loudly rather
      // than silently filing into a new auto-created folder.
      if (settings.finance_drive_root_link) {
        throw new Error('תיקיית הדרייב שהוגדרה בפאנל הניהול אינה נגישה — בדוק את הקישור וההרשאות');
      }
      /* auto-created folder was deleted — recreate below */
    }
  }
  const id = await ensureFolder(drive, ROOT_FOLDER_NAME);
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('finance_drive_root_id', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`, [id]);
  return id;
}

async function uploadToDrive(drive, folderId, filename, buffer, mimeType) {
  const body = new stream.PassThrough();
  body.end(buffer);
  const { data } = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType: mimeType || 'application/pdf', body },
    fields: 'id, webViewLink',
  });
  return data; // { id, webViewLink }
}

// ── Gmail message parsing ─────────────────────────────────────────────────────

const b64urlDecode = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function walkParts(payload, out) {
  if (!payload) return;
  if (payload.filename && payload.body?.attachmentId) {
    out.attachments.push({ filename: payload.filename, attachmentId: payload.body.attachmentId, mimeType: payload.mimeType });
  }
  if (payload.mimeType === 'text/plain' && payload.body?.data) out.text += b64urlDecode(payload.body.data).toString('utf-8') + '\n';
  if (payload.mimeType === 'text/html' && payload.body?.data) out.html += b64urlDecode(payload.body.data).toString('utf-8') + '\n';
  (payload.parts || []).forEach(p => walkParts(p, out));
}

function extractLinks(text, html) {
  const links = new Set();
  const re = /https?:\/\/[^\s"'<>)\]]+/g;
  for (const m of (text.match(re) || [])) links.add(m);
  for (const m of (html.match(re) || [])) links.add(m);
  return [...links].slice(0, 30);
}

// ── AI classification (OpenAI, JSON mode — same provider as the chat) ─────────

async function classifyEmail({ subject, from, snippet, attachments, links }) {
  if (!process.env.OPENAI_API_KEY) return null; // caller falls back to keyword-only
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prompt = `אתה מסווג מיילים עבור עסק אירועים בשם "שרביה". קבע האם המייל הבא הוא חשבונית/קבלה שספק שלח לעסק (הוצאה של העסק).

חשוב: חשבוניות שהעסק עצמו הוציא ללקוחות שלו (למשל דרך GreenInvoice של שרביה, או מיילים שנשלחו על ידי שרביה) הן לא חשבוניות ספק — סווג אותן כ-false. מיילים שיווקיים שמזכירים "חשבונית" הם false.

מאת: ${from}
נושא: ${subject}
תקציר: ${snippet}
קבצים מצורפים: ${attachments.map(a => a.filename).join(', ') || 'אין'}
קישורים בגוף: ${links.join('\n') || 'אין'}

אם זו חשבונית ספק שמגיעה כקישור (ולא כקובץ מצורף) — החזר ב-invoice_links את הקישור/ים שכנראה מובילים להורדת החשבונית עצמה (לא קישורי הרשמה/שיווק). אם החשבונית מצורפת כקובץ, החזר invoice_links ריק.

השב JSON בלבד במבנה: {"is_supplier_invoice": boolean, "invoice_links": string[], "reason": string}`;

  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    });
    const parsed = JSON.parse(resp.choices[0]?.message?.content || '{}');
    return {
      is_supplier_invoice: !!parsed.is_supplier_invoice,
      invoice_links: Array.isArray(parsed.invoice_links) ? parsed.invoice_links : [],
      reason: parsed.reason || '',
    };
  } catch (err) {
    console.error('[FinanceScan] AI classify error:', err.message);
    return null; // fall back to keyword-only
  }
}

// ── Invoice download (links) ──────────────────────────────────────────────────

async function downloadFromLink(url) {
  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000, maxRedirects: 5 });
  const type = (resp.headers['content-type'] || '').toLowerCase();
  if (type.includes('pdf')) return { buffer: Buffer.from(resp.data), mimeType: 'application/pdf' };
  if (type.includes('html')) {
    // Landing page — look for a direct PDF link inside it
    const html = Buffer.from(resp.data).toString('utf-8');
    const pdfLinks = (html.match(/https?:\/\/[^\s"'<>)\]]+\.pdf[^\s"'<>)\]]*/gi) || []).slice(0, 3);
    for (const l of pdfLinks) {
      try {
        const r2 = await axios.get(l, { responseType: 'arraybuffer', timeout: 20000, maxRedirects: 5 });
        if ((r2.headers['content-type'] || '').includes('pdf')) return { buffer: Buffer.from(r2.data), mimeType: 'application/pdf' };
      } catch { /* try next */ }
    }
  }
  throw new Error(`לא נמצא PDF בקישור (content-type: ${type})`);
}

// ── Main scan ─────────────────────────────────────────────────────────────────

async function listScanAccounts() {
  const accounts = [{ email: 'primary', auth: primaryAuth() }];
  const { rows } = await pool.query('SELECT email, token_json FROM finance_gmail_accounts WHERE active = TRUE');
  for (const r of rows) accounts.push({ email: r.email, auth: authForToken(r.token_json) });
  return accounts;
}

// from/to: 'YYYY-MM-DD' inclusive. Returns a summary.
async function scanRange(from, to) {
  const afterEpoch  = Math.floor(new Date(`${from}T00:00:00`).getTime() / 1000);
  const beforeEpoch = Math.floor(new Date(`${to}T00:00:00`).getTime() / 1000) + 86400;

  const summary = { scanned: 0, candidates: 0, invoices: 0, filesSaved: 0, failures: [], aiUsed: !!process.env.OPENAI_API_KEY, accounts: [] };
  const primaryDriveAuth = primaryAuth(); // Drive uploads always go to the business account
  const drive = google.drive({ version: 'v3', auth: primaryDriveAuth });
  const rootId = await getRootFolderId(drive);
  const monthFolders = {};

  for (const account of await listScanAccounts()) {
    const gmail = google.gmail({ version: 'v1', auth: account.auth });
    summary.accounts.push(account.email);
    let pageToken;
    do {
      let list;
      try {
        ({ data: list } = await gmail.users.messages.list({
          userId: 'me', q: `after:${afterEpoch} before:${beforeEpoch}`, maxResults: 100, pageToken,
        }));
      } catch (err) {
        summary.failures.push({ account: account.email, error: `Gmail: ${err.message}` });
        break;
      }
      pageToken = list.nextPageToken;

      for (const m of list.messages || []) {
        const { rows: seen } = await pool.query('SELECT 1 FROM finance_scanned_emails WHERE gmail_id = $1', [m.id]);
        if (seen.length) continue;
        summary.scanned++;

        let isInvoice = false;
        try {
          const { data: msg } = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
          const headers = Object.fromEntries((msg.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value]));
          const subject = headers.subject || '';
          const fromH   = headers.from || '';
          const emailDate = new Date(Number(msg.internalDate));
          const parts = { attachments: [], text: '', html: '' };
          walkParts(msg.payload, parts);
          const pdfAttachments = parts.attachments.filter(a => /\.pdf$/i.test(a.filename) || (a.mimeType || '').includes('pdf'));
          const links = extractLinks(parts.text, parts.html);

          // Stage 1 — cheap prefilter
          const haystack = `${subject} ${msg.snippet || ''} ${parts.text.slice(0, 2000)}`.toLowerCase();
          const keywordHit = KEYWORDS.some(k => haystack.includes(k.toLowerCase()));
          if (!keywordHit && !pdfAttachments.length) {
            await markScanned(m.id, account.email, false);
            continue;
          }
          summary.candidates++;

          // Stage 2 — AI confirmation (falls back to keyword-only when unavailable)
          const verdict = await classifyEmail({
            subject, from: fromH, snippet: (msg.snippet || '') + '\n' + parts.text.slice(0, 1500),
            attachments: pdfAttachments, links,
          });
          isInvoice = verdict ? verdict.is_supplier_invoice : keywordHit;
          const invoiceLinks = verdict?.invoice_links || [];

          if (isInvoice) {
            summary.invoices++;
            const monthKey = `${String(emailDate.getMonth() + 1).padStart(2, '0')}-${emailDate.getFullYear()}`;
            if (!monthFolders[monthKey]) monthFolders[monthKey] = await ensureFolder(drive, monthKey, rootId);
            const folderId = monthFolders[monthKey];
            const datePrefix = emailDate.toISOString().slice(0, 10);
            const files = [];

            for (const att of pdfAttachments) {
              try {
                const { data: attData } = await gmail.users.messages.attachments.get({ userId: 'me', messageId: m.id, id: att.attachmentId });
                files.push({ name: `${datePrefix} ${att.filename}`, buffer: b64urlDecode(attData.data), mimeType: att.mimeType || 'application/pdf', kind: 'attachment' });
              } catch (err) {
                summary.failures.push({ subject, error: `צרופה: ${err.message}` });
              }
            }
            for (const link of invoiceLinks.slice(0, 3)) {
              try {
                const dl = await downloadFromLink(link);
                files.push({ name: `${datePrefix} ${sanitize(subject) || 'חשבונית'}.pdf`, buffer: dl.buffer, mimeType: dl.mimeType, kind: 'link' });
              } catch (err) {
                summary.failures.push({ subject, error: `קישור: ${err.message}` });
                await recordFile(m.id, account.email, { subject, from: fromH, emailDate, filename: link, kind: 'link', status: 'failed', error: err.message });
              }
            }

            for (const f of files) {
              try {
                const uploaded = await uploadToDrive(drive, folderId, f.name, f.buffer, f.mimeType);
                await recordFile(m.id, account.email, {
                  subject, from: fromH, emailDate, filename: f.name, kind: f.kind,
                  status: 'saved', driveFileId: uploaded.id, driveLink: uploaded.webViewLink, driveFolder: monthKey,
                });
                summary.filesSaved++;
              } catch (err) {
                summary.failures.push({ subject, error: `דרייב: ${err.message}` });
                await recordFile(m.id, account.email, { subject, from: fromH, emailDate, filename: f.name, kind: f.kind, status: 'failed', error: err.message });
              }
            }
          }
          await markScanned(m.id, account.email, isInvoice);
        } catch (err) {
          summary.failures.push({ account: account.email, error: err.message });
          await markScanned(m.id, account.email, false).catch(() => {});
        }
      }
    } while (pageToken);
    await pool.query('UPDATE finance_gmail_accounts SET last_scan_at = NOW() WHERE email = $1', [account.email]).catch(() => {});
  }
  console.log(`[FinanceScan] ${from}..${to}: scanned ${summary.scanned}, invoices ${summary.invoices}, saved ${summary.filesSaved}, failures ${summary.failures.length}`);
  return summary;
}

const sanitize = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 80);

async function markScanned(gmailId, account, isInvoice) {
  await pool.query(
    `INSERT INTO finance_scanned_emails (gmail_id, account_email, is_invoice) VALUES ($1, $2, $3)
     ON CONFLICT (gmail_id) DO NOTHING`, [gmailId, account, isInvoice]);
}

async function recordFile(gmailId, account, f) {
  await pool.query(
    `INSERT INTO finance_invoice_files
       (gmail_message_id, account_email, email_subject, email_from, email_date, filename, source_kind, status, error, drive_file_id, drive_link, drive_folder)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (gmail_message_id, filename) DO NOTHING`,
    [gmailId, account, f.subject || '', f.from || '', f.emailDate || null, f.filename, f.kind, f.status, f.error || null,
     f.driveFileId || null, f.driveLink || null, f.driveFolder || null]);
}

// ── Daily automatic scan (today's emails), runs once a day at ~20:00 ─────────
function startDailyInvoiceScan() {
  setInterval(async () => {
    try {
      if (new Date().getHours() !== 20) return;
      const today = new Date().toISOString().slice(0, 10);
      const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'finance_last_auto_scan'");
      if (rows[0]?.value === today) return;
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ('finance_last_auto_scan', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`, [today]);
      console.log('[FinanceScan] Daily auto-scan starting');
      await scanRange(today, today);
    } catch (err) {
      console.error('[FinanceScan] Daily scan error:', err.message);
    }
  }, 60 * 60 * 1000);
}

module.exports = { scanRange, startDailyInvoiceScan, buildConnectUrl, oauthCallbackHandler };
