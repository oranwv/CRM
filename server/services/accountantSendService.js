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

const FILE_Q = "trashed = false and mimeType != 'application/vnd.google-apps.folder'";
const FOLDER_Q = "trashed = false and mimeType = 'application/vnd.google-apps.folder'";

async function primaryEmail() {
  const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'finance_primary_email'").catch(() => ({ rows: [] }));
  return rows[0]?.value || 'primary';
}

// Month folders under the invoices root, newest first. Each month lists its
// mailboxes: one entry per mailbox sub-folder, plus files lying directly in
// the month folder (pre-2026-09-22 layout) which belong to the business mailbox.
async function listMonths() {
  const drive = google.drive({ version: 'v3', auth: primaryAuth() });
  const rootId = await getRootFolderId(drive);
  const primary = await primaryEmail();
  const folders = await listAll(drive, `'${rootId}' in parents and ${FOLDER_Q}`, 'id, name');
  const months = [];
  for (const f of folders) {
    if (!/^\d{2}-\d{4}$/.test(f.name)) continue;
    const sum = (files) => files.reduce((s, x) => s + Number(x.size || 0), 0);
    const rootFiles = await listAll(drive, `'${f.id}' in parents and ${FILE_Q}`, 'id, size');
    const boxes = {};
    if (rootFiles.length) boxes[primary] = { email: primary, folderIds: [f.id], files: rootFiles.length, bytes: sum(rootFiles) };
    const subs = await listAll(drive, `'${f.id}' in parents and ${FOLDER_Q}`, 'id, name');
    for (const sf of subs) {
      const files = await listAll(drive, `'${sf.id}' in parents and ${FILE_Q}`, 'id, size');
      const b = boxes[sf.name] || (boxes[sf.name] = { email: sf.name, folderIds: [], files: 0, bytes: 0 });
      b.folderIds.push(sf.id); b.files += files.length; b.bytes += sum(files);
    }
    const mailboxes = Object.values(boxes).map(b => ({ ...b, isPrimary: b.email === primary }))
      .sort((a, b) => (b.isPrimary - a.isPrimary) || a.email.localeCompare(b.email));
    months.push({ key: f.name, label: monthLabel(f.name), folderId: f.id, mailboxes,
      files: mailboxes.reduce((n, b) => n + b.files, 0), bytes: mailboxes.reduce((n, b) => n + b.bytes, 0) });
  }
  months.sort((a, b) => (b.key.slice(3) + b.key.slice(0, 2)).localeCompare(a.key.slice(3) + a.key.slice(0, 2)));
  return { months, primaryEmail: primary };
}

const sendStatus = { running: false, startedAt: null, finishedAt: null, progress: null, result: null, error: null };

// mailboxes: 'all' (default) or an array of mailbox addresses to include.
async function sendToAccountant({ months, email, note, userId, mailboxes = 'all' }) {
  if (sendStatus.running) throw new Error('שליחה כבר רצה — המתן לסיומה');
  Object.assign(sendStatus, { running: true, startedAt: new Date().toISOString(), finishedAt: null, progress: { downloaded: 0, total: 0, emailsSent: 0 }, result: null, error: null });
  try {
    const drive = google.drive({ version: 'v3', auth: primaryAuth() });
    const { months: all } = await listMonths();
    const chosen = months.map(k => all.find(m => m.key === k)).filter(Boolean);
    if (!chosen.length) throw new Error('לא נבחרו חודשים קיימים');
    const wanted = (b) => mailboxes === 'all' || (Array.isArray(mailboxes) && mailboxes.includes(b.email));

    // Collect files (month by month, mailbox by mailbox, so the accountant sees them grouped)
    const files = [];
    for (const m of chosen) {
      for (const b of m.mailboxes.filter(wanted)) {
        for (const folderId of b.folderIds) {
          const list = await listAll(drive, `'${folderId}' in parents and ${FILE_Q}`, 'id, name, size, mimeType');
          for (const f of list) files.push({ ...f, month: m.key, mailbox: b.email });
        }
      }
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
      const boxesInBatch = [...new Set(batches[i].map(f => f.mailbox))];
      const byMailbox = boxesInBatch.length > 1
        ? boxesInBatch.map(b => `${b}: ${batches[i].filter(f => f.mailbox === b).length} קבצים`).join('\n') : null;
      const body = [
        'שלום,',
        '',
        `מצורפות חשבוניות הספקים של ${businessName} עבור ${period}${part}.`,
        byMonth,
        byMailbox ? '' : null,
        byMailbox ? 'לפי תיבת מייל:' : null,
        byMailbox,
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
      `INSERT INTO finance_accountant_sends (email, months, files_count, emails_sent, note, created_by, mailboxes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [email, chosen.map(m => m.key), files.length, emailsSent, note || null, userId || null,
       mailboxes === 'all' ? null : mailboxes]);
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
