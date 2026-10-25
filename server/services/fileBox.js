// "File box": one place that knows how to resolve any file shown in the CRM
// (lead files, supplier files, production activity-log files), fetch its
// bytes, convert an HTML document (designed menus etc.) to a PDF that looks
// like the page on screen, and describe who it can be sent to.
//
// A file is addressed by a *ref* string so the client can pass one value
// around no matter where the file lives:
//   lead:<fileId>                  → files table (lead files, contracts, offers)
//   supplier:<supplierId>:<fileId> → supplier_files
//   ops:<activityLogId>            → op_activity_log row of type 'file'
const axios = require('axios');
const path  = require('path');
const pool  = require('../db/pool');
const { getSignedUrl, storedNameFromUrl } = require('./storageService');

const puppeteer = require('puppeteer-core');

function isHtmlFile(filename = '', mime = '') {
  const m = String(mime || '').toLowerCase();
  const ext = path.extname(String(filename || '')).toLowerCase();
  return m.includes('html') || ext === '.html' || ext === '.htm';
}

function normalizeMime(mime, filename) {
  if (!mime || mime === 'contract') return guessMime(filename) || 'application/pdf';
  return mime;
}

function guessMime(filename = '') {
  const ext = path.extname(filename).toLowerCase();
  return {
    '.pdf': 'application/pdf', '.html': 'text/html', '.htm': 'text/html',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
    '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav',
  }[ext] || null;
}

function parseRef(ref) {
  const parts = String(ref || '').split(':');
  if (parts[0] === 'lead' && parts.length === 2 && /^\d+$/.test(parts[1])) return { kind: 'lead', fileId: Number(parts[1]) };
  if (parts[0] === 'supplier' && parts.length === 3 && /^\d+$/.test(parts[1]) && /^\d+$/.test(parts[2])) return { kind: 'supplier', supplierId: Number(parts[1]), fileId: Number(parts[2]) };
  if (parts[0] === 'ops' && parts.length === 2 && /^\d+$/.test(parts[1])) return { kind: 'ops', logId: Number(parts[1]) };
  return null;
}

// → { kind, ref, filename, mime, storedName, isHtml, leadId?, supplierId?, fileId?, logId? } or null
async function resolveRef(ref) {
  const p = parseRef(ref);
  if (!p) return null;
  if (p.kind === 'lead') {
    const { rows } = await pool.query('SELECT id, lead_id, filename, url, stored_name, file_type, is_recording FROM files WHERE id = $1', [p.fileId]);
    const f = rows[0];
    if (!f || f.is_recording) return null;
    const storedName = f.stored_name || storedNameFromUrl(f.url);
    if (!storedName) return null;
    const mime = normalizeMime(f.file_type, f.filename);
    return { kind: 'lead', ref, fileId: f.id, leadId: f.lead_id, filename: f.filename, mime, storedName, isHtml: isHtmlFile(f.filename, mime) };
  }
  if (p.kind === 'supplier') {
    const { rows } = await pool.query('SELECT id, supplier_id, filename, stored_name, file_type FROM supplier_files WHERE id = $1 AND supplier_id = $2', [p.fileId, p.supplierId]);
    const f = rows[0];
    if (!f || !f.stored_name) return null;
    const mime = normalizeMime(f.file_type, f.filename);
    return { kind: 'supplier', ref, fileId: f.id, supplierId: f.supplier_id, filename: f.filename, mime, storedName: f.stored_name, isHtml: isHtmlFile(f.filename, mime) };
  }
  if (p.kind === 'ops') {
    const { rows } = await pool.query("SELECT id, entity_type, entity_id, body FROM op_activity_log WHERE id = $1 AND type = 'file'", [p.logId]);
    const r = rows[0];
    if (!r) return null;
    let meta = {};
    try { meta = JSON.parse(r.body || '{}'); } catch { return null; }
    const storedName = meta.storedName || storedNameFromUrl(meta.url);
    if (!storedName) return null;
    const filename = meta.filename || storedName;
    const mime = normalizeMime(meta.mime_type, filename);
    return { kind: 'ops', ref, logId: r.id, entityType: r.entity_type, entityId: r.entity_id, filename, mime, storedName, isHtml: isHtmlFile(filename, mime) };
  }
  return null;
}

// Name the file would have after export (HTML → .pdf, everything else unchanged)
function exportName(file, format) {
  if (format === 'pdf' && file.isHtml) return file.filename.replace(/\.(html?|HTML?)$/, '') + '.pdf';
  return file.filename;
}

async function fetchBytes(file) {
  const url = await getSignedUrl(file.storedName, 300);
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
  return Buffer.from(res.data);
}

// Render an HTML file to a PDF that looks like the page on screen: one page,
// sized to the document (no A4 cuts through a designed background).
async function htmlToPdf(file) {
  const url = await getSignedUrl(file.storedName, 600);
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      headless: true,
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(45000);
    const width = 820; // CSS px — close to a phone-landscape / narrow-desktop reading width most designed menus target
    await page.setViewport({ width, height: 600, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: ['load', 'networkidle0'] });
    // Let web fonts finish so the measured height matches what gets drawn
    await page.evaluate(() => (document.fonts && document.fonts.ready) ? document.fonts.ready.then(() => null) : null).catch(() => {});
    const height = await page.evaluate(() => Math.ceil(Math.max(
      document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0,
      document.documentElement.offsetHeight, document.body ? document.body.offsetHeight : 0,
    )));
    const pdf = await page.pdf({
      width: `${width}px`,
      height: `${Math.max(height, 200) + 2}px`,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      preferCSSPageSize: false,
    });
    return Buffer.from(pdf);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// → { buffer, filename, mime }
async function exportFile(file, format = 'original') {
  if (format === 'pdf' && file.isHtml) {
    return { buffer: await htmlToPdf(file), filename: exportName(file, 'pdf'), mime: 'application/pdf' };
  }
  return { buffer: await fetchBytes(file), filename: file.filename, mime: file.mime };
}

// Who the file can be sent to from the CRM's own WhatsApp / email
async function contactsFor(file) {
  const out = { phones: [], emails: [], name: '' };
  if (file.kind === 'lead') {
    const { rows: lr } = await pool.query('SELECT name, phone, email FROM leads WHERE id = $1', [file.leadId]);
    const lead = lr[0];
    if (!lead) return out;
    out.name = lead.name || '';
    const { rows: cr } = await pool.query('SELECT type, value, label FROM lead_contacts WHERE lead_id = $1 ORDER BY id', [file.leadId]);
    if (lead.phone) out.phones.push({ value: lead.phone, label: lead.name || '' });
    if (lead.email) out.emails.push({ value: lead.email, label: lead.name || '' });
    for (const c of cr) {
      if (!c.value) continue;
      const entry = { value: c.value, label: c.label || '' };
      if (c.type === 'phone' && !out.phones.some(p => p.value === c.value)) out.phones.push(entry);
      if (c.type === 'email' && !out.emails.some(e => e.value === c.value)) out.emails.push(entry);
    }
  } else if (file.kind === 'supplier') {
    const { rows } = await pool.query('SELECT name, phone, email FROM suppliers WHERE id = $1', [file.supplierId]);
    const s = rows[0];
    if (!s) return out;
    out.name = s.name || '';
    if (s.phone) out.phones.push({ value: s.phone, label: s.name || '' });
    if (s.email) out.emails.push({ value: s.email, label: s.name || '' });
  }
  return out;
}

module.exports = { parseRef, resolveRef, exportFile, exportName, contactsFor, isHtmlFile };
