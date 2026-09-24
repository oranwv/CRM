// Invoice review — browse the files of a month folder one by one, throw the
// irrelevant ones (private purchases, Sharviya's own outgoing invoices…) into a
// trash folder in Drive ("פח" / MM-YYYY / <mailbox>), and restore from there.
// The Drive folder is the source of truth (manually uploaded files included);
// finance_invoice_files rows are joined for the email context when present.
const { google } = require('googleapis');
const pool = require('../db/pool');
const { primaryAuth, getRootFolderId, ensureFolder } = require('./financeInvoiceScanner');
const { listMonths, listAll, monthLabel, primaryEmail, FILE_Q, FOLDER_Q } = require('./accountantSendService');

const TRASH_FOLDER_NAME = 'פח';
const driveClient = () => google.drive({ version: 'v3', auth: primaryAuth() });
const FILE_FIELDS = 'id, name, mimeType, size, createdTime, webViewLink, thumbnailLink';

async function emailContext(driveIds) {
  if (!driveIds.length) return {};
  const { rows } = await pool.query(
    `SELECT drive_file_id, gmail_message_id, account_email, email_subject, email_from, email_date, status
     FROM finance_invoice_files WHERE drive_file_id = ANY($1)`, [driveIds]);
  return Object.fromEntries(rows.map(r => [r.drive_file_id, r]));
}

// All files of one month, grouped by mailbox (root files = business mailbox).
async function listMonthFiles(monthKey) {
  if (!/^\d{2}-\d{4}$/.test(monthKey)) throw new Error('חודש לא תקין');
  const drive = driveClient();
  const rootId = await getRootFolderId(drive);
  const primary = await primaryEmail();
  const [monthFolder] = await listAll(drive, `'${rootId}' in parents and name = '${monthKey}' and ${FOLDER_Q}`, 'id, name');
  if (!monthFolder) return [];
  const files = [];
  for (const f of await listAll(drive, `'${monthFolder.id}' in parents and ${FILE_Q}`, FILE_FIELDS)) files.push({ ...f, mailbox: primary, folderId: monthFolder.id });
  for (const sf of await listAll(drive, `'${monthFolder.id}' in parents and ${FOLDER_Q}`, 'id, name')) {
    for (const f of await listAll(drive, `'${sf.id}' in parents and ${FILE_Q}`, FILE_FIELDS)) files.push({ ...f, mailbox: sf.name, folderId: sf.id });
  }
  const ctx = await emailContext(files.map(f => f.id));
  return files.map(f => {
    const c = ctx[f.id];
    return {
      driveFileId: f.id, name: f.name, mimeType: f.mimeType, size: Number(f.size || 0), createdTime: f.createdTime,
      driveLink: f.webViewLink, mailbox: f.mailbox, month: monthKey,
      subject: c?.email_subject || null, from: c?.email_from || null, emailDate: c?.email_date || null,
      gmailId: c?.gmail_message_id || null, account: c?.account_email || null,
    };
  }).sort((a, b) => String(b.emailDate || b.createdTime).localeCompare(String(a.emailDate || a.createdTime)));
}

// Stream the file bytes (the client shows them in an <iframe> via a blob URL)
async function fileStream(driveFileId) {
  const drive = driveClient();
  const { data: meta } = await drive.files.get({ fileId: driveFileId, fields: 'name, mimeType' });
  const res = await drive.files.get({ fileId: driveFileId, alt: 'media' }, { responseType: 'stream' });
  return { stream: res.data, name: meta.name, mimeType: meta.mimeType || 'application/pdf' };
}

async function trashFolderFor(drive, monthKey, mailbox) {
  const rootId = await getRootFolderId(drive);
  const trashId = await ensureFolder(drive, TRASH_FOLDER_NAME, rootId);
  const monthId = await ensureFolder(drive, monthKey, trashId);
  return ensureFolder(drive, mailbox, monthId);
}

async function moveFile(drive, fileId, fromId, toId) {
  await drive.files.update({ fileId, addParents: toId, removeParents: fromId, fields: 'id, parents' });
}

async function trashFile({ driveFileId, month, mailbox, userId }) {
  const drive = driveClient();
  const { data: meta } = await drive.files.get({ fileId: driveFileId, fields: 'id, name, parents, size' });
  const fromId = meta.parents?.[0];
  if (!fromId) throw new Error('לא נמצאה תיקיית המקור של הקובץ');
  const toId = await trashFolderFor(drive, month, mailbox);
  await moveFile(drive, driveFileId, fromId, toId);
  const ctx = (await emailContext([driveFileId]))[driveFileId];
  const { rows } = await pool.query(
    `INSERT INTO finance_invoice_trash (drive_file_id, name, month, mailbox, original_folder_id, size, email_subject, email_from, email_date, gmail_message_id, trashed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [driveFileId, meta.name, month, mailbox, fromId, Number(meta.size || 0),
     ctx?.email_subject || null, ctx?.email_from || null, ctx?.email_date || null, ctx?.gmail_message_id || null, userId || null]);
  await pool.query("UPDATE finance_invoice_files SET status = 'trashed' WHERE drive_file_id = $1 AND status = 'saved'", [driveFileId]);
  return { id: rows[0].id };
}

async function listTrash() {
  const { rows } = await pool.query(
    `SELECT t.*, u.name AS trashed_by_name FROM finance_invoice_trash t
     LEFT JOIN users u ON u.id = t.trashed_by
     WHERE t.restored_at IS NULL ORDER BY t.month DESC, t.trashed_at DESC`);
  const byMonth = {};
  for (const r of rows) (byMonth[r.month] = byMonth[r.month] || { key: r.month, label: monthLabel(r.month), items: [] }).items.push(r);
  return Object.values(byMonth).sort((a, b) => (b.key.slice(3) + b.key.slice(0, 2)).localeCompare(a.key.slice(3) + a.key.slice(0, 2)));
}

async function restoreFile(trashId) {
  const { rows } = await pool.query('SELECT * FROM finance_invoice_trash WHERE id = $1 AND restored_at IS NULL', [trashId]);
  const t = rows[0];
  if (!t) throw new Error('הפריט לא נמצא בפח');
  const drive = driveClient();
  const { data: meta } = await drive.files.get({ fileId: t.drive_file_id, fields: 'id, parents' });
  // Original folder may have been deleted meanwhile — recreate month/mailbox
  let toId = t.original_folder_id;
  try { await drive.files.get({ fileId: toId, fields: 'id, trashed' }).then(r => { if (r.data.trashed) throw new Error('gone'); }); }
  catch {
    const rootId = await getRootFolderId(drive);
    const monthId = await ensureFolder(drive, t.month, rootId);
    toId = await ensureFolder(drive, t.mailbox, monthId);
  }
  await moveFile(drive, t.drive_file_id, meta.parents?.[0], toId);
  await pool.query('UPDATE finance_invoice_trash SET restored_at = NOW() WHERE id = $1', [trashId]);
  await pool.query("UPDATE finance_invoice_files SET status = 'saved' WHERE drive_file_id = $1 AND status = 'trashed'", [t.drive_file_id]);
  return { ok: true };
}

module.exports = { listMonths, listMonthFiles, fileStream, trashFile, listTrash, restoreFile };
