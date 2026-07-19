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
// Bank-row exclusions. The card names prevent double counting: the checking
// account shows each card's monthly charge, while the CAL/MAX files carry the
// individual transactions.
const DEFAULT_EXCLUSIONS = ['משכורת', 'החזר הוצאות', 'חלק משכר', 'מקס איט פיננס', 'לאומי קארד', 'ישראכרט', 'כאל', 'כא"ל', 'דינרס'];
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

// Parse a date value from xlsx (Date object via cellDates) or a dd/mm/yyyy,
// dd.mm.yyyy or dd-mm-yyyy string (MAX exports use dashes).
function toDate(val) {
  if (val instanceof Date && !isNaN(val)) return val;
  if (typeof val === 'string') {
    const m = val.trim().match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
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
  // Detect by cell contents in the first sheet's top rows
  const { rows } = sheetRows(buffer);
  for (const row of rows.slice(0, 6)) {
    for (const cell of row || []) {
      const val = clean(cell).replace(/\s+/g, ' ');
      if (val.includes('סכום עסקה מקורי')) return 'credit_max';
      if (val.includes('סכום בש')) return 'credit_cal';
      if (val.includes('כולל מעמ')) return 'karteset';
      // New CAL/Visa export: title cell "פירוט עסקאות לחשבון..." or the
      // "שם בית עסק" column header (sheet is named after the bank account)
      if (val.includes('פירוט עסקאות') || val.includes('פירוט חיובים') || val.includes('שם בית עסק')) return 'credit_cal';
    }
  }
  return 'unknown';
}

// ── parsers ──────────────────────────────────────────────────────────────────

// Bank PDF. pdf-parse extracts the bank transfers list as TAB-SEPARATED rows,
// one transaction per line:
//   "26/02/2026\tאלי זרמון\tשף\t90 - 136743910 בנק דיסקונט...\t31871\t₪1,000.00"
// (date, name, description, account, reference, ₪amount). Parse those directly;
// fall back to the legacy column-by-column layout (macOS PDFKit prototype) if a
// page has no tab rows.
function parseBankText(pageText) {
  const lines = pageText.split('\n').map(l => l.trim()).filter(Boolean);

  // ── Primary: tab-separated transaction rows ──
  // Two known layouts share the date-first tab-row shape:
  //  A. Transfers list ("רשימת ההעברות"):
  //     dd/mm/yyyy \t name \t description \t account \t ref \t ₪amount
  //  B. Checking-account statement ("יתרה ותנועות בחשבון עו"ש"):
  //     dd/mm/yy \t description \t signedAmount \t [balance] \t ref
  //     Negative amount = expense (חובה), positive = income (זכות) → skipped.
  const rowEntries = [];
  for (const line of lines) {
    if (!/^\d{2}\/\d{2}\/\d{2,4}\t/.test(line)) continue;
    const fields = line.split('\t').map(f => f.trim());
    const normDate = (() => { const d = toDate(fields[0]); return d ? dateStr(d) : fields[0]; })();

    const shekelMatch = line.match(/₪\s*(-?[\d,]+\.\d+)/);
    if (shekelMatch) {
      // Layout A — transfers list (all rows are outgoing expenses, with payee name)
      const amount = parseFloat(shekelMatch[1].replace(/,/g, ''));
      if (amount <= 0) continue;
      rowEntries.push({
        date: normDate,
        name: fields[1] || '',
        description: fields[2] || '',
        amount,
        amount_rounded: Math.round(amount),
        source: 'bank',
        bankKind: 'transfers',
      });
      continue;
    }

    // Layout B — checking-account row: signed amount in the 3rd field
    if (fields.length >= 3 && /^-?[\d,]+\.\d{2}$/.test(fields[2])) {
      const signed = parseFloat(fields[2].replace(/,/g, ''));
      if (signed >= 0) continue; // income (זכות) — expenses only
      const amount = Math.abs(signed);
      const desc = (fields[1] || '').replace(/\)\s*[יפ]\s*\(/g, '').replace(/^[<>]\s*/, '').trim();
      rowEntries.push({
        date: normDate,
        name: desc,
        description: desc,
        amount,
        amount_rounded: Math.round(amount),
        source: 'bank',
        bankKind: 'checking',
      });
    }
  }
  if (rowEntries.length) return rowEntries;

  // ── Fallback: legacy column-by-column layout ──
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

// CAL exports — two known layouts, both handled by header-based column mapping:
//  - Classic: headers on row 1/2, amount column "סכום בש"ח".
//  - Visa-via-bank ("פירוט חיובים לכרטיס ויזה"): title rows, then a header row
//    with "תאריך עסקה / שם בית עסק / סכום עסקה / סכום חיוב / ... / הערות"
//    (multi-line header cells) and installments noted as "תשלום X מתוך Y".
function parseCreditCal(buffer) {
  const { rows } = sheetRows(buffer);
  const norm = (h) => clean(h).replace(/\s+/g, ' ');

  // Locate the header row: has a date header and an amount header
  let headerRow = -1;
  for (let r = 0; r < 10 && r < rows.length; r++) {
    const hs = (rows[r] || []).map(norm);
    if (hs.some(h => h.includes('תאריך')) && hs.some(h => h.includes('סכום'))) { headerRow = r; break; }
  }
  const headers = headerRow === -1 ? [] : (rows[headerRow] || []).map(norm);

  const dateCol = (() => { const i = headers.findIndex(h => h.includes('תאריך')); return i === -1 ? 0 : i; })();
  const nameCol = (() => { const i = headers.findIndex(h => h.includes('שם בית עסק')); return i === -1 ? 1 : i; })();
  const amountCol = (() => {
    let i = headers.findIndex(h => h.includes('סכום בש'));   // classic: charged amount in ILS
    if (i === -1) i = headers.findIndex(h => h.includes('סכום עסקה')); // Visa layout: full transaction amount
    if (i === -1) { const d = detectAmountColumn(headers, 'סכום'); i = d == null ? -1 : d; }
    return i === -1 ? 2 : i; // column C fallback
  })();
  const notesCol = headers.findIndex(h => h.includes('הערות'));

  const entries = [];
  for (const row of rows.slice(headerRow === -1 ? 1 : headerRow + 1)) {
    if (!row) continue;
    const amount = row[amountCol];
    if (typeof amount !== 'number' || amount <= 0) continue;
    const d = toDate(row[dateCol]);
    // Summary/title rows carry an amount but no date — skip
    if (!d) continue;
    // Installments: the accountant enters ONE invoice for the full amount, so
    // the full transaction amount is counted once — at the first installment.
    const notes = notesCol !== -1 ? row[notesCol] : null;
    if (notes && typeof notes === 'string' && notes.includes('מתוך') && !notes.includes('תשלום 1 מתוך')) continue;
    entries.push({
      date: dateStr(d),
      name: row[nameCol] != null ? String(row[nameCol]) : '',
      description: notes ? String(notes) : '',
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
    // Summary/total rows carry an amount but no date — skip
    if (!d) continue;
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

// When BOTH bank reports are uploaded — the checking-account statement (all
// debits, but transfers show only "העברה באינטרנט") and the transfers list
// (which names the payee) — enrich each checking transfer with the payee name
// from the matching transfers-list row (same rounded amount, dates within 4
// days), and drop the matched transfers-list row so the transfer isn't counted
// twice. Unmatched transfers-list rows are kept (e.g. outside the statement's
// date range).
function enrichBankEntries(entries) {
  const checking  = entries.filter(e => e.bankKind === 'checking');
  const transfers = entries.filter(e => e.bankKind === 'transfers');
  if (!checking.length || !transfers.length) return entries;

  const windowMs = 4 * 86400000;
  const pool = transfers.map(t => ({ entry: t, used: false, date: toDate(t.date) }));

  for (const c of checking) {
    const cDate = toDate(c.date);
    const candidates = pool
      .filter(p => !p.used && p.entry.amount_rounded === c.amount_rounded &&
        (!cDate || !p.date || Math.abs(p.date - cDate) <= windowMs))
      .sort((a, b) => (cDate && a.date && b.date) ? Math.abs(a.date - cDate) - Math.abs(b.date - cDate) : 0);
    if (candidates.length) {
      candidates[0].used = true;
      c.name = candidates[0].entry.name || c.name;
      c.description = [candidates[0].entry.description, c.description].filter(Boolean).join(' · ');
    }
  }

  const unusedTransfers = pool.filter(p => !p.used).map(p => p.entry);
  return [...entries.filter(e => e.source !== 'bank'), ...checking, ...unusedTransfers];
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
  const warnings = [];

  for (const f of files) {
    const type = f.forcedType || detectFileType(f.buffer, f.originalname || '');
    let count = 0;
    if (type === 'bank') { const e = await parseBankPdf(f.buffer); count = e.length; entries.push(...e); }
    else if (type === 'credit_cal') { const e = parseCreditCal(f.buffer); count = e.length; entries.push(...e); }
    else if (type === 'credit_max') { const e = parseCreditMax(f.buffer); count = e.length; entries.push(...e); }
    else if (type === 'karteset') { const k = parseKarteset(f.buffer); count = k.length; kartesetItems.push(...k); }
    sources.push({ filename: f.originalname, type, count });
    if (type === 'bank' && count === 0) {
      warnings.push(`"${f.originalname}": קובץ ה-PDF לא מכיל טקסט קריא (כנראה יוצא כתמונה) — הורד מהבנק את דוח התנועות המלא ונסה שוב`);
    }
  }

  if (!kartesetItems.length) throw new Error('לא זוהה קובץ כרטסת בין הקבצים שהועלו');
  if (!entries.length) {
    throw new Error(warnings.length
      ? warnings.join(' · ')
      : 'לא זוהו קבצי בנק/אשראי בין הקבצים שהועלו');
  }

  const enriched = enrichBankEntries(entries);
  const missing = findMissing(enriched, kartesetItems, exclusions, windowDays);
  return { entries: enriched, karteset: kartesetItems, missing, sources, warnings };
}

module.exports = {
  reconcile, detectFileType, parseBankPdf, parseCreditCal, parseCreditMax,
  parseKarteset, findMissing, fingerprint, enrichBankEntries, DEFAULT_EXCLUSIONS,
};
