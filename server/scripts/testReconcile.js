/**
 * Local sanity test for the finance reconciliation engine, using the real sample
 * files from the Python prototype. Run: node server/scripts/testReconcile.js [dir]
 * Default dir: ~/Downloads/Oran. Compare the output against the prototype's
 * missing_expenses.xlsx.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { reconcile, detectFileType } = require('../services/financeReconcile');

const dir = process.argv[2] || path.join(os.homedir(), 'Downloads', 'Oran');
const CANDIDATES = ['bank.pdf', 'credit_cal.xlsx', 'credit_max.xlsx', 'karteset.xlsx'];

(async () => {
  const files = CANDIDATES
    .map(name => path.join(dir, name))
    .filter(p => fs.existsSync(p))
    .map(p => ({ buffer: fs.readFileSync(p), originalname: path.basename(p) }));

  if (!files.length) {
    console.error(`No sample files found in ${dir}`);
    process.exit(1);
  }

  console.log('Files:');
  for (const f of files) console.log(`  ${f.originalname} → ${detectFileType(f.buffer, f.originalname)}`);

  const { entries, karteset, missing, sources } = await reconcile(files);
  console.log(`\nParsed ${entries.length} expense entries, ${karteset.length} karteset rows`);
  const bySource = entries.reduce((a, e) => { a[e.source] = (a[e.source] || 0) + 1; return a; }, {});
  console.log('Entries by source:', bySource);
  const kartesetDated = karteset.filter(k => k.date).length;
  console.log(`Karteset rows with dates: ${kartesetDated}/${karteset.length} (${kartesetDated ? 'date-window matching' : 'amount-only fallback'})`);

  console.log(`\nMissing (${missing.length}), sorted by amount desc:`);
  for (const m of [...missing].sort((a, b) => b.amount - a.amount)) {
    console.log(`  ${String(m.amount_rounded).padStart(8)} ₪  ${m.source.padEnd(4)}  ${m.date.padEnd(10)}  ${m.name || m.description || ''}`);
  }
})().catch(err => { console.error('FAILED:', err); process.exit(1); });
