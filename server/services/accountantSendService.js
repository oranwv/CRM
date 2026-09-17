// "שלח לרואה חשבון" — emails the invoice files of chosen months (the MM-YYYY
// folders under the "חשבוניות" Drive root) as attachments, from the business
// Gmail. Gmail caps a message at ~25MB, so files are packed into as many
// emails as needed (~18MB of raw files each, base64 adds ~33%).
const { google } = require('googleapis');
const pool = require('../db/pool');
const { sendEmail } = require('./gmailService');
const { primaryAuth, getRootFolderId } = require('./financeInvoiceScanner');

const BATCH_LIMIT_BYTES = 18 * 1024 * 1024;
const HEB_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

const monthLabel = (key) => { const [mm, yyyy] = key.split('-'); return `${HEB_MONTHS[Number(mm) - 1] || mm} ${yyyy}`; };

async function listAll(drive, q, fields) {
  const out = []; let pageToken;
  do {
    const { data } = await drive.files.list({ q, fields: `nextPageToken, files(${fields})`, pageSize: 200, pageToken, orderBy: 'name' });
    out.push(...(data.files || [])); pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

// Month folders under the invoices root, newest first, with file count + size.
async function listMonths() {
  const drive = google.drive({ version: 'v3', auth: primaryAuth() });
  const rootId = await getRootFolderId(drive);
  const folders = await listAll(drive,
    `'${rootId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`, 'id, name');
  const months = [];
  for (const f of folders) {
    if (!/^\d{2}-\d{4}$/.test(f.name)) continue;
    const files = await listAll(drive, `'${f.id}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`, 'id, size');
    months.push({ key: f.name, label: monthLabel(f.name), folderId: f.id, files: files.length,
      bytes: files.reduce((s, x) => s + Number(x.size || 0), 0) });
  }
  months.sort((a, b) => (b.key.slice(3) + b.key.slice(0, 2)).localeCompare(a.key.slice(3) + a.key.slice(0, 2)));
  return months;
}

const sendStatus = { running: false, startedAt: null, finishedAt: null, progress: null, result: null, error: null };

async function sendToAccountant({ months, email, note, userId }) {
  if (sendStatus.running) throw new Error('שליחה כבר רצה — המתן לסיומה');
  Object.assign(sendStatus, { running: true, startedAt: new Date().toISOString(), finishedAt: null, progress: { downloaded: 0, total: 0, emailsSent: 0 }, result: null, error: null });
  try {
    const drive = google.drive({ version: 'v3', auth: primaryAuth() });
    const all = await listMonths();
    const chosen = months.map(k => all.find(m => m.key === k)).filter(Boolean);
    if (!chosen.length) throw new Error('לא נבחרו חודשים קיימים');

    // Collect files (month by month, so the accountant sees them grouped)
    const files = [];
    for (const m of chosen) {
      const list = await listAll(drive, `'${m.folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`, 'id, name, size, mimeType');
      for (const f of list) files.push({ ...f, month: m.key });
    }
    sendStatus.progress.total = files.length;
    if (!files.length) throw new Error('אין קבצים בחודשים שנבחרו');

    // Pack into email batches by size
    const batches = [[]]; let batchBytes = 0;
    for (const f of files) {
      const size = Number(f.size || 0);
      if (batches[batches.length - 1].length && batchBytes + size > BATCH_LIMIT_BYTES) { batches.push([]); batchBytes = 0; }
      batches[batches.length - 1].push(f); batchBytes += size;
    }

    const period = chosen.length === 1 ? monthLabel(chosen[0].key)
      : `${monthLabel(chosen[chosen.length - 1].key)} – ${monthLabel(chosen[0].key)}`;
    const subjectBase = `חשבוניות שרביה — ${period}`;
    const { rows: srows } = await pool.query("SELECT value FROM settings WHERE key = 'business_name'").catch(() => ({ rows: [] }));
    const businessName = srows[0]?.value || 'שרביה';

    let emailsSent = 0;
    for (let i = 0; i < batches.length; i++) {
      const attachments = [];
      for (const f of batches[i]) {
        const { data } = await drive.files.get({ fileId: f.id, alt: 'media' }, { responseType: 'arraybuffer' });
        attachments.push({ buffer: Buffer.from(data), name: `${f.month} - ${f.name}`, mime: f.mimeType || 'application/pdf' });
        sendStatus.progress.downloaded++;
      }
      const part = batches.length > 1 ? ` (חלק ${i + 1} מתוך ${batches.length})` : '';
      const byMonth = chosen.map(m => `${monthLabel(m.key)}: ${batches[i].filter(f => f.month === m.key).length} קבצים`).filter(s => !/: 0 קבצים$/.test(s)).join('\n');
      const body = [
        'שלום,',
        '',
        `מצורפות חשבוניות הספקים של ${businessName} עבור ${period}${part}.`,
        byMonth,
        '',
        note ? note : null,
        note ? '' : null,
        'בברכה,',
        businessName,
      ].filter(v => v !== null).join('\n');
      await sendEmail({ to: email, subject: subjectBase + part, body, attachments });
      emailsSent++; sendStatus.progress.emailsSent = emailsSent;
    }

    await pool.query(
      `INSERT INTO finance_accountant_sends (email, months, files_count, emails_sent, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [email, chosen.map(m => m.key), files.length, emailsSent, note || null, userId || null]);
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('finance_accountant_email', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`, [email]);

    sendStatus.result = { files: files.length, emailsSent, period };
    return sendStatus.result;
  } catch (err) {
    sendStatus.error = err.message;
    throw err;
  } finally {
    sendStatus.running = false;
    sendStatus.finishedAt = new Date().toISOString();
  }
}

module.exports = { listMonths, sendToAccountant, sendStatus };
