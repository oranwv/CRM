// Invoice previews — the first page of every invoice rendered to JPEG and kept
// in Postgres (finance_invoice_previews), so the review screen and the saved
// list show an image instantly on any device (phones can't render a PDF inline).
// Two sizes: 1000px wide for the viewer, 200px wide for list thumbnails.
// Rendered at scan time; for older files, lazily on the first request.
const jwt  = require('jsonwebtoken');
const pool = require('../db/pool');

const BIG_W = 1000, THUMB_W = 200, JPEG_Q = 82;

async function pdfFirstPagePng(buffer) {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const r = await parser.getScreenshot({ first: 1, desiredWidth: BIG_W, imageBuffer: true });
    const page = r.pages?.[0];
    return page ? Buffer.from(page.data) : null;
  } finally { try { await parser.destroy(); } catch { /* ignore */ } }
}

// Returns { big, thumb, width, height } (JPEG buffers) or null when the file can't be rendered.
async function renderPreview(buffer, mimeType) {
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const isPdf = /pdf/i.test(mimeType || '') || (buffer.length > 4 && buffer.slice(0, 5).toString('latin1') === '%PDF-');
  const src = isPdf ? await pdfFirstPagePng(buffer) : (/^image\//i.test(mimeType || '') ? buffer : null);
  if (!src) return null;
  const img = await loadImage(src);
  const make = (w) => {
    const targetW = Math.min(w, img.width || w);
    const h = Math.max(1, Math.round((img.height || 1) * targetW / (img.width || 1)));
    const c = createCanvas(targetW, h); const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, targetW, h); ctx.drawImage(img, 0, 0, targetW, h);
    return { buf: c.toBuffer('image/jpeg', JPEG_Q), w: targetW, h };
  };
  const big = make(BIG_W), thumb = make(THUMB_W);
  return { big: big.buf, thumb: thumb.buf, width: big.w, height: big.h };
}

async function storePreview(driveFileId, buffer, mimeType) {
  const p = await renderPreview(buffer, mimeType);
  if (!p) return false;
  await pool.query(
    `INSERT INTO finance_invoice_previews (drive_file_id, image, thumb, width, height)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (drive_file_id) DO UPDATE SET image = EXCLUDED.image, thumb = EXCLUDED.thumb,
       width = EXCLUDED.width, height = EXCLUDED.height, created_at = NOW()`,
    [driveFileId, p.big, p.thumb, p.width, p.height]);
  return true;
}

// Best-effort, never throws — used inline by the scanner right after the Drive upload.
async function storePreviewSafe(driveFileId, buffer, mimeType) {
  try { return await storePreview(driveFileId, buffer, mimeType); }
  catch (err) { console.error('[FinancePreview] render failed for', driveFileId, err.message); return false; }
}

// Lazy path: fetch from Drive, render, store. `downloadFile(driveFileId)` → { buffer, mimeType }.
async function getPreview(driveFileId, size, downloadFile) {
  const col = size === 'thumb' ? 'thumb' : 'image';
  const { rows } = await pool.query(`SELECT ${col} AS img FROM finance_invoice_previews WHERE drive_file_id = $1`, [driveFileId]);
  if (rows[0]?.img) return rows[0].img;
  const { buffer, mimeType } = await downloadFile(driveFileId);
  const ok = await storePreview(driveFileId, buffer, mimeType);
  if (!ok) return null;
  const { rows: again } = await pool.query(`SELECT ${col} AS img FROM finance_invoice_previews WHERE drive_file_id = $1`, [driveFileId]);
  return again[0]?.img || null;
}

// <img src> can't send the Authorization header — the client fetches a
// short-lived preview token once and passes it in the query string.
function issuePreviewToken(userId) {
  return jwt.sign({ uid: userId, purpose: 'invoice-preview' }, process.env.JWT_SECRET, { expiresIn: '12h' });
}
function verifyPreviewToken(token) {
  const p = jwt.verify(token, process.env.JWT_SECRET);
  if (p.purpose !== 'invoice-preview') throw new Error('bad token');
  return p;
}

module.exports = { renderPreview, storePreview, storePreviewSafe, getPreview, issuePreviewToken, verifyPreviewToken };
