// Finance reconciliation engine — port of the Python prototype (~/Downloads/Oran/app.py).
// Compares bank + credit-card expenses against the accountant's karteset (כרטסת)
// and returns expenses that have no matching karteset entry (missing invoices).
//
// Improvements over the prototype:
// - Bank PDF parsed with pdf-parse (cross-platform) instead of macOS Swift/PDFKit.
// - Karteset dates are extracted when available, enabling amount+date-window
//   matching (fallback: amount-only counting, like the prototype).
const crypto = require('crypto');
const XLSX = require('xlsx');
const { PDFParse } = require('pdf-parse'); // v2 API: class, not a callable default

const KNOWN_AMOUNT_HEADERS = ['סכום', 'סכום בש"ח', 'סכום עסקה מקורי', 'כולל מעמ'];
const DEFAULT_EXCLUSIONS = ['משכורת', 'החזר הוצאות', 'חלק משכר'];
const DEFAULT_WINDOW_DAYS = 60;

// ── helpers ──────────────────────────────────────────────────────────────────

const clean = (h) => (h == null ? '' : String(h).trim().replace(/\n/g, ' '));

function detectAmountColumn(headers, hint) {
  if (!headers || !headers.length) return null;
  const cleaned = headers.map(clean);
  for (const target of KNOWN_AMOUNT_HEADERS) {
    const i = cleaned.findIndex(h => h === target);
    if (i !== -1) return i;
  }
  if (hint) {
    const i = cleaned.findIndex(h => h.includes(hint));
    if (i !== -1) return i;
  }
  for (const keyword of ['סכום', 'כולל']) {
    const i = cleaned.findIndex(h => h.includes(keyword));
    if (i !== -1) return i;
  }
  return null;
}

// Parse a date value from xlsx (Date object via cellDates) or dd/mm/yyyy string.
function toDate(val) {
  if (val instanceof Date && !isNaN(val)) return val;
  if (typeof val === 'string') {
    const m = val.trim().match(/(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/);
    if (m) {
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      const d = new Date(y, Number(m[2]) - 1, Number(m[1]), 12);
      if (!isNaN(d)) return d;
    }
  }
  return null;
}

const dateStr = (d) => (d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : '');

function sheetRows(buffer, sheetName) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const name = sheetName || wb.SheetNames[0];
  return { rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null }), sheetNames: wb.SheetNames, wb };
}

function fingerprint(entry) {
  const key = `${entry.source}|${entry.date || ''}|${entry.amount_rounded}|${(entry.name || '').trim()}`;
  return crypto.createHash('sha1').update(key).digest('hex');
}

// ── file-type detection ───────────────────────────────────────────────────────

function detectFileType(buffer, filename = '') {
  if (filename.toLowerCase().endsWith('.pdf') || buffer.slice(0, 4).toString() === '%PDF') return 'bank';
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', bookSheets: true });
  } catch {
    return 'unknown';
  }
  for (const sn of wb.SheetNames) {
    if (sn.includes('כרטסת')) return 'karteset';
    if (sn.includes('פירוט עסקאות')) return 'credit_cal';
    if (sn.includes('עסקאות במועד')) return 'credit_max';
  }
  // Detect by headers in the first sheet's top rows
  const { rows } = sheetRows(buffer);
  for (const row of rows.slice(0, 5)) {
    for (const cell of row || []) {
      const val = clean(cell);
      if (val.includes('סכום עסקה מקורי')) return 'credit_max';
      if (val.includes('סכום בש')) return 'credit_cal';
      if (val.includes('כולל מעמ')) return 'karteset';
    }
  }
  return 'unknown';
}

// ── parsers ──────────────────────────────────────────────────────────────────

// Bank PDF: RTL column-by-column layout. Amounts as ₪X,XXX.XX lines, dates as
// dd/mm/yyyy lines, with שם / תיאור / תאריך section markers per page.
// pdf-parse text order may differ from the prototype's PDFKit — the parser is
// tolerant: if section markers are missing it still pairs amounts with dates.
function parseBankText(pageText) {
  const lines = pageText.split('\n').map(l => l.trim()).filter(Boolean);

  const amounts = [];
  const dates = [];
  for (const line of lines) {
    const am = line.match(/^₪([\d,]+\.\d+)$/);
    if (am) { amounts.push(parseFloat(am[1].replace(/,/g, ''))); continue; }
    const dm = line.match(/^(\d{2}\/\d{2}\/\d{4})$/);
    if (dm) dates.push(dm[1]);
  }

  let nameIdx = null, descIdx = null, dateIdx = null;
  lines.forEach((line, i) => {
    if (line === 'שם') nameIdx = i;
    else if (line === 'תיאור') descIdx = i;
    else if (line === 'תאריך' && i > lines.length / 2) dateIdx = i;
  });

  const isDataLine = (l) => !/^₪|^\d{2}\/\d{2}\/\d{4}$|^\d+$/.test(l);
  const collect = (from, to) => {
    const out = [];
    if (from == null || to == null || to <= from) return out;
    for (let i = from + 1; i < to; i++) {
      const l = lines[i].replace(/^‏+/, '');
      if (l && isDataLine(l)) out.push(l);
    }
    return out;
  };
  const descriptions = collect(descIdx, nameIdx);
  const names = collect(nameIdx, dateIdx);

  return amounts.map((amount, i) => ({
    date: dates[i] || '',
    name: names[i] || '',
    description: descriptions[i] || '',
    amount,
    amount_rounded: Math.round(amount),
    source: 'bank',
  }));
}

async function parseBankPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const pages = (result.pages && result.pages.length)
      ? result.pages.map(p => p.text || '')
      : String(result.text || '').split('\f');
    return pages.flatMap(parseBankText);
  } finally {
    await parser.destroy();
  }
}

function parseCreditCal(buffer) {
  const { rows } = sheetRows(buffer);
  let headers = rows[1] || [];
  let amountCol = detectAmountColumn(headers, 'סכום');
  if (amountCol == null) { headers = rows[0] || []; amountCol = detectAmountColumn(headers, 'סכום'); }
  if (amountCol == null) amountCol = 2; // column C fallback

  const startRow = (rows[1] && clean(rows[1][0]).includes('תאריך')) ? 2 : 1;
  const entries = [];
  for (const row of rows.slice(startRow)) {
    if (!row) continue;
    const amount = row[amountCol];
    if (typeof amount !== 'number' || amount <= 0) continue;
    const d = toDate(row[0]);
    entries.push({
      date: d ? dateStr(d) : (row[0] ? String(row[0]) : ''),
      name: row[1] != null ? String(row[1]) : '',
      description: '',
      amount,
      amount_rounded: Math.round(amount),
      source: 'cal',
    });
  }
  return entries;
}

function parseCreditMax(buffer) {
  const { sheetNames, wb } = sheetRows(buffer);
  // Domestic sheet: skip foreign-currency sheets
  const target = sheetNames.find(sn => !sn.includes('חו"ל') && !sn.includes('חול') && !sn.includes('מט')) || sheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[target], { header: 1, defval: null });

  let headerRow = 3; // 0-based (prototype: row 4)
  for (let r = 0; r < 5 && r < rows.length; r++) {
    if (clean((rows[r] || [])[0]).includes('תאריך')) { headerRow = r; break; }
  }
  const headers = rows[headerRow] || [];
  let amountCol = detectAmountColumn(headers, 'סכום עסקה מקורי');
  if (amountCol == null) amountCol = detectAmountColumn(headers, 'סכום');
  if (amountCol == null) amountCol = 7; // column H fallback
  const chargeCol = detectAmountColumn(headers, 'סכום חיוב');
  const notesCol = headers.findIndex(h => clean(h).includes('הערות'));

  const entries = [];
  for (const row of rows.slice(headerRow + 1)) {
    if (!row) continue;
    const amount = row[amountCol];
    if (typeof amount !== 'number' || amount <= 0) continue;
    // Skip cancellations/refunds (negative charge)
    if (chargeCol != null && chargeCol !== -1 && typeof row[chargeCol] === 'number' && row[chargeCol] < 0) continue;
    // Installments: the accountant enters ONE invoice for the full amount, so the
    // full original amount is counted once — at the first installment only.
    const notes = notesCol !== -1 ? row[notesCol] : null;
    if (notes && typeof notes === 'string' && notes.includes('מתוך') && !notes.includes('תשלום 1 מתוך')) continue;

    const d = toDate(row[0]);
    entries.push({
      date: d ? dateStr(d) : (row[0] ? String(row[0]) : ''),
      name: row[1] != null ? String(row[1]) : '',
      description: notes ? String(notes) : '',
      amount,
      amount_rounded: Math.round(amount),
      source: 'max',
    });
  }
  return entries;
}

// Karteset: rows where column A is numeric; amount from the "כולל מעמ" column.
// Also extracts a date per row when a date column exists (for window matching).
function parseKarteset(buffer) {
  const { rows } = sheetRows(buffer);
  let headerRow = null, amountCol = null;
  for (let r = 0; r < 9 && r < rows.length; r++) {
    const col = detectAmountColumn(rows[r] || [], 'כולל');
    if (col != null) { headerRow = r; amountCol = col; break; }
  }
  if (amountCol == null) { amountCol = 6; headerRow = 3; } // column G fallback

  // Date column: header containing תאריך, else first column with date-typed cells
  const headers = rows[headerRow] || [];
  let dateCol = headers.findIndex(h => clean(h).includes('תאריך'));
  if (dateCol === -1) {
    const sample = rows.slice(headerRow + 1, headerRow + 20);
    for (let c = 0; c < 8; c++) {
      if (sample.some(row => row && toDate(row[c]))) { dateCol = c; break; }
    }
  }

  const items = [];
  for (const row of rows.slice(headerRow + 1)) {
    if (!row) continue;
    const colA = row[0];
    const amount = row[amountCol];
    if (typeof colA !== 'number' || typeof amount !== 'number') continue;
    items.push({
      amount_rounded: Math.round(amount),
      date: dateCol !== -1 ? toDate(row[dateCol]) : null,
    });
  }
  return items;
}

// ── matching ─────────────────────────────────────────────────────────────────

// Match each expense entry to an unused karteset item with the same rounded
// amount; when both sides have dates, require |diff| <= windowDays and prefer the
// nearest. Entries left unmatched are the missing invoices.
function findMissing(entries, kartesetItems, exclusions = DEFAULT_EXCLUSIONS, windowDays = DEFAULT_WINDOW_DAYS) {
  const included = entries.filter(e => {
    if (e.source !== 'bank') return true;
    const desc = e.description || '';
    return !exclusions.some(ex => ex.trim() && desc.includes(ex));
  });

  const pool = kartesetItems.map(k => ({ ...k, used: false }));
  const windowMs = windowDays * 86400000;
  const missing = [];

  for (const e of included) {
    const eDate = toDate(e.date);
    const candidates = pool.filter(k => !k.used && k.amount_rounded === e.amount_rounded);
    let match = null;
    if (candidates.length) {
      if (eDate) {
        const dated = candidates
          .filter(k => k.date && Math.abs(k.date - eDate) <= windowMs)
          .sort((a, b) => Math.abs(a.date - eDate) - Math.abs(b.date - eDate));
        match = dated[0] || candidates.find(k => !k.date) || null;
      } else {
        match = candidates[0];
      }
    }
    if (match) match.used = true;
    else missing.push({ ...e, fingerprint: fingerprint(e) });
  }
  return missing;
}

// ── orchestration ────────────────────────────────────────────────────────────

// files: [{ buffer, originalname, forcedType? }] → { entries, karteset, missing, sources }
// forcedType lets the UI's dedicated upload slots override auto-detection.
// Multiple karteset files (e.g. May + June) are merged into one item pool.
async function reconcile(files, { exclusions = DEFAULT_EXCLUSIONS, windowDays = DEFAULT_WINDOW_DAYS } = {}) {
  const entries = [];
  const kartesetItems = [];
  const sources = [];

  for (const f of files) {
    const type = f.forcedType || detectFileType(f.buffer, f.originalname || '');
    sources.push({ filename: f.originalname, type });
    if (type === 'bank') entries.push(...await parseBankPdf(f.buffer));
    else if (type === 'credit_cal') entries.push(...parseCreditCal(f.buffer));
    else if (type === 'credit_max') entries.push(...parseCreditMax(f.buffer));
    else if (type === 'karteset') kartesetItems.push(...parseKarteset(f.buffer));
  }

  if (!kartesetItems.length) throw new Error('לא זוהה קובץ כרטסת בין הקבצים שהועלו');
  if (!entries.length) throw new Error('לא זוהו קבצי בנק/אשראי בין הקבצים שהועלו');

  const missing = findMissing(entries, kartesetItems, exclusions, windowDays);
  return { entries, karteset: kartesetItems, missing, sources };
}

module.exports = {
  reconcile, detectFileType, parseBankPdf, parseCreditCal, parseCreditMax,
  parseKarteset, findMissing, fingerprint, DEFAULT_EXCLUSIONS,
};
