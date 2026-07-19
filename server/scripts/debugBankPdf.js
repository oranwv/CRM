/**
 * Debug: show how pdf-parse extracts text from a bank statement PDF, and what
 * the bank parser currently finds in it. Used to adapt parseBankText to the
 * real pdf-parse layout (which differs from the macOS PDFKit prototype).
 *
 * Run: node server/scripts/debugBankPdf.js [path-to-pdf]
 * Default: ~/Downloads/Oran/bank.pdf
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFParse } = require('pdf-parse');
const { parseBankPdf } = require('../services/financeReconcile');

const pdfPath = process.argv[2] || path.join(os.homedir(), 'Downloads', 'Oran', 'bank.pdf');

(async () => {
  if (!fs.existsSync(pdfPath)) {
    console.error(`File not found: ${pdfPath}`);
    process.exit(1);
  }
  const buffer = fs.readFileSync(pdfPath);

  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();

  const pages = (result.pages && result.pages.length)
    ? result.pages.map(p => p.text || '')
    : String(result.text || '').split('\f');

  console.log(`pages: ${pages.length}`);
  const page1 = pages[0] || '';
  const lines = page1.split('\n').map(l => l.trim()).filter(Boolean);
  console.log(`page 1: ${lines.length} non-empty lines\n`);

  console.log('── first 60 lines of page 1 (JSON-escaped) ──');
  lines.slice(0, 60).forEach((l, i) => console.log(`${String(i).padStart(3)}: ${JSON.stringify(l)}`));

  // What the current line-anchored regexes find
  const strictAmounts = lines.filter(l => /^₪([\d,]+\.\d+)$/.test(l)).length;
  const looseAmounts  = page1.match(/₪\s*[\d,]+\.\d+/g) || [];
  const strictDates   = lines.filter(l => /^(\d{2}\/\d{2}\/\d{4})$/.test(l)).length;
  const looseDates    = page1.match(/\d{2}\/\d{2}\/\d{4}/g) || [];
  const markers = ['שם', 'תיאור', 'תאריך'].map(m => `${m}: ${lines.filter(l => l === m).length}`);

  console.log('\n── pattern stats (page 1) ──');
  console.log(`strict amount lines (^₪X.XX$): ${strictAmounts}`);
  console.log(`loose ₪ amounts anywhere: ${looseAmounts.length}  e.g. ${JSON.stringify(looseAmounts.slice(0, 5))}`);
  console.log(`strict date lines: ${strictDates}`);
  console.log(`loose dates anywhere: ${looseDates.length}  e.g. ${JSON.stringify(looseDates.slice(0, 5))}`);
  console.log(`exact marker lines — ${markers.join(', ')}`);

  const entries = await parseBankPdf(buffer);
  console.log(`\ncurrent parseBankPdf result: ${entries.length} entries`);
  entries.slice(0, 5).forEach(e => console.log(`  ${e.date} | ${e.amount} | ${e.name} | ${e.description}`));
})().catch(err => { console.error('FAILED:', err); process.exit(1); });
