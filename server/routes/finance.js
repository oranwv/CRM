const router = require('express').Router();
const pool   = require('../db/pool');
const multer = require('multer');
const { reconcile, parseKartesetAny, findMissing, fingerprint, DEFAULT_EXCLUSIONS } = require('../services/financeReconcile');
const { scanRange, buildConnectUrl } = require('../services/financeInvoiceScanner');

// Unified status for karteset-driven auto-resolves (full compare + rekarteset)
function kartesetResolvedStatus(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  return `נפתר בכרטסת שהועלתה ב־${fmt.format(now)}`;
}

const toEntryDate = (dateStr) => {
  const dm = (dateStr || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : null;
};

// Shared post-processing for a comparison run: upsert missing items, then
// auto-resolve what the (updated) karteset now covers.
async function applyReconcileResults(periodId, entries, karteset, missing) {
  let newCount = 0, knownCount = 0, resolvedCount = 0;
  const missingFpsAll = missing.map(m => m.fingerprint);
  for (const m of missing) {
    const { rows: [existing] } = await pool.query(
      'SELECT resolved FROM finance_missing_expenses WHERE period_id = $1 AND fingerprint = $2', [periodId, m.fingerprint]);
    if (existing) {
      if (existing.resolved) resolvedCount++; else knownCount++;
      continue;
    }
    // An item's fingerprint can change between runs when its NAME changes —
    // e.g. a bank transfer gains a payee via the transfers-list enrichment.
    // Adopt the matching open item (same source/date/amount, old fingerprint
    // no longer produced) so the user's status and notes are preserved.
    const { rows: [adopted] } = await pool.query(
      `UPDATE finance_missing_expenses
       SET fingerprint = $1, name = $2, description = $3
       WHERE id = (
         SELECT id FROM finance_missing_expenses
         WHERE period_id = $4 AND resolved = FALSE AND source = $5
           AND entry_date IS NOT DISTINCT FROM $6 AND ROUND(amount) = $7
           AND NOT (fingerprint = ANY($8))
         LIMIT 1
       ) RETURNING id`,
      [m.fingerprint, m.name || '', m.description || '', periodId, m.source,
       toEntryDate(m.date), Math.round(m.amount), missingFpsAll]
    );
    if (adopted) { knownCount++; continue; }
    await pool.query(
      `INSERT INTO finance_missing_expenses (period_id, fingerprint, entry_date, name, description, amount, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (period_id, fingerprint) DO NOTHING`,
      [periodId, m.fingerprint, toEntryDate(m.date), m.name || '', m.description || '', m.amount, m.source]
    );
    newCount++;
  }

  const autoStatus = kartesetResolvedStatus();

  // Open items of the re-scanned sources that are no longer missing — the
  // updated karteset covers them. Deferred items are excluded (their charge
  // belongs to a previous period and never re-appears in the expense files).
  const runSources = [...new Set(entries.map(e => e.source))];
  const missingFps = missing.map(m => m.fingerprint);
  const { rowCount: genericResolved } = await pool.query(
    `UPDATE finance_missing_expenses
     SET resolved = TRUE, resolved_at = NOW(),
         status = COALESCE(NULLIF(status, ''), $4)
     WHERE period_id = $1 AND resolved = FALSE AND deferred_from_period_id IS NULL
       AND source = ANY($2) AND NOT (fingerprint = ANY($3))`,
    [periodId, runSources, missingFps, autoStatus]
  );

  // Carried-over items close when this period's karteset CONTAINS their amount
  const kartesetAmounts = [...new Set(karteset.map(k => k.amount_rounded))];
  const { rowCount: carriedResolved } = await pool.query(
    `UPDATE finance_missing_expenses
     SET resolved = TRUE, resolved_at = NOW(),
         status = COALESCE(NULLIF(status, ''), $3)
     WHERE period_id = $1 AND resolved = FALSE AND deferred_from_period_id IS NOT NULL
       AND ROUND(amount) = ANY($2)`,
    [periodId, kartesetAmounts, autoStatus]
  );

  return { newCount, knownCount, resolvedCount, autoResolvedCount: genericResolved + carriedResolved };
}

// Snapshot the parsed expense entries for a period (per source) so a later
// karteset-only upload can re-run the exact comparison without the expense files.
async function snapshotEntries(periodId, entries) {
  const sources = [...new Set(entries.map(e => e.source))];
  if (!sources.length) return;
  await pool.query('DELETE FROM finance_period_entries WHERE period_id = $1 AND source = ANY($2)', [periodId, sources]);
  for (const e of entries) {
    await pool.query(
      `INSERT INTO finance_period_entries (period_id, source, entry_date, name, description, amount, fingerprint)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [periodId, e.source, toEntryDate(e.date), e.name || '', e.description || '', e.amount, e.fingerprint || fingerprint(e)]
    );
  }
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 6 } });

// Access: admins/managers, or users granted the dedicated 'finance' role.
function financeAccess(req, res, next) {
  const roles = req.user.roles || [req.user.role];
  if (['admin', 'manager', 'finance'].some(r => roles.includes(r))) return next();
  return res.status(403).json({ error: 'אין הרשאה' });
}
router.use(financeAccess);

// GET /api/finance/exclusions
router.get('/exclusions', async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'finance_exclusions'");
    res.json({ exclusions: rows[0]?.value ? JSON.parse(rows[0].value) : DEFAULT_EXCLUSIONS });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/finance/exclusions
router.put('/exclusions', async (req, res) => {
  const exclusions = Array.isArray(req.body.exclusions) ? req.body.exclusions.filter(e => e && e.trim()) : [];
  try {
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('finance_exclusions', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(exclusions)]
    );
    res.json({ exclusions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/finance/reconcile — upload karteset files (one or more months) +
// expense files (bank PDF, CAL/MAX xlsx), run comparison, upsert missing
// expenses (fingerprint dedupe keeps resolved items resolved).
router.post('/reconcile', upload.fields([
  { name: 'kartesetFiles', maxCount: 8 },
  { name: 'expenseFiles',  maxCount: 10 },
  { name: 'files',         maxCount: 10 }, // legacy single-dropzone field
]), async (req, res) => {
  const kartesetFiles = (req.files?.kartesetFiles || []).map(f => ({ ...f, forcedType: 'karteset' }));
  const expenseFiles  = [...(req.files?.expenseFiles || []), ...(req.files?.files || [])];
  if (!kartesetFiles.length && !expenseFiles.length) return res.status(400).json({ error: 'לא הועלו קבצים' });
  const periodId = Number(req.body.periodId);
  if (!periodId) return res.status(400).json({ error: 'נא לבחור תקופה לפני ההשוואה' });
  try {
    const { rows: [period] } = await pool.query('SELECT id FROM finance_periods WHERE id = $1', [periodId]);
    if (!period) return res.status(404).json({ error: 'התקופה לא נמצאה' });

    const { rows: exRows } = await pool.query("SELECT value FROM settings WHERE key = 'finance_exclusions'");
    const exclusions = exRows[0]?.value ? JSON.parse(exRows[0].value) : DEFAULT_EXCLUSIONS;

    const { missing, entries, karteset, sources, warnings } = await reconcile([...kartesetFiles, ...expenseFiles], { exclusions });

    const results = await applyReconcileResults(periodId, entries, karteset, missing);
    await snapshotEntries(periodId, entries); // enables karteset-only re-compare later

    res.json({
      ...results,
      totalEntries: entries.length, kartesetCount: karteset.length, sources, warnings,
    });
  } catch (err) {
    console.error('[Finance] reconcile error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/finance/rekarteset — upload ONLY the accountant's updated karteset
// and re-run the exact comparison against the period's stored expense entries.
// Newly-covered items auto-resolve with a timestamped status.
router.post('/rekarteset', upload.fields([{ name: 'kartesetFiles', maxCount: 8 }]), async (req, res) => {
  const periodId = Number(req.body.periodId);
  if (!periodId) return res.status(400).json({ error: 'נא לבחור תקופה' });
  const kFiles = req.files?.kartesetFiles || [];
  if (!kFiles.length) return res.status(400).json({ error: 'לא הועלה קובץ כרטסת' });
  try {
    const { rows: [period] } = await pool.query('SELECT id FROM finance_periods WHERE id = $1', [periodId]);
    if (!period) return res.status(404).json({ error: 'התקופה לא נמצאה' });

    const kartesetItems = [];
    for (const f of kFiles) kartesetItems.push(...await parseKartesetAny(f.buffer));
    if (!kartesetItems.length) return res.status(400).json({ error: 'לא זוהו שורות בקובץ הכרטסת' });

    const { rows: stored } = await pool.query(
      'SELECT source, entry_date, name, description, amount, fingerprint FROM finance_period_entries WHERE period_id = $1',
      [periodId]);
    if (!stored.length) {
      return res.status(400).json({ error: 'אין נתוני הוצאות שמורים לתקופה — בצע קודם השוואה מלאה אחת (עם קבצי ההוצאות)' });
    }

    // Rebuild entry objects exactly as the engine produced them
    const fmtD = (d) => d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : '';
    const entries = stored.map(r => ({
      source: r.source,
      date: r.entry_date ? fmtD(new Date(r.entry_date)) : '',
      name: r.name || '',
      description: r.description || '',
      amount: Number(r.amount),
      amount_rounded: Math.round(Number(r.amount)),
      fingerprint: r.fingerprint,
    }));

    const { rows: exRows } = await pool.query("SELECT value FROM settings WHERE key = 'finance_exclusions'");
    const exclusions = exRows[0]?.value ? JSON.parse(exRows[0].value) : DEFAULT_EXCLUSIONS;

    const missing = findMissing(entries, kartesetItems, exclusions);
    const results = await applyReconcileResults(periodId, entries, kartesetItems, missing);

    res.json({
      ...results,
      totalEntries: entries.length, kartesetCount: kartesetItems.length,
      uploadedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Finance] rekarteset error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/finance/missing?periodId=&resolved=true|false — sorted by amount desc
router.get('/missing', async (req, res) => {
  const resolved = req.query.resolved === 'true';
  const periodId = Number(req.query.periodId);
  if (!periodId) return res.status(400).json({ error: 'חסרה תקופה' });
  try {
    const { rows } = await pool.query(
      `SELECT e.*, COUNT(n.id)::int AS note_count, origin.name AS deferred_from_name
       FROM finance_missing_expenses e
       LEFT JOIN finance_expense_notes n ON n.expense_id = e.id
       LEFT JOIN finance_periods origin ON origin.id = e.deferred_from_period_id
       WHERE e.resolved = $1 AND e.period_id = $2
       GROUP BY e.id, origin.name
       ORDER BY e.amount DESC, e.entry_date DESC NULLS LAST`,
      [resolved, periodId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/finance/missing/:id/move { periodId } — defer an item to another
// period (e.g. the invoice was issued in the next reporting period).
router.post('/missing/:id/move', async (req, res) => {
  const targetId = Number(req.body.periodId);
  if (!targetId) return res.status(400).json({ error: 'נא לבחור תקופת יעד' });
  try {
    const { rows: [target] } = await pool.query('SELECT id FROM finance_periods WHERE id = $1', [targetId]);
    if (!target) return res.status(404).json({ error: 'תקופת היעד לא נמצאה' });
    const { rows: [item] } = await pool.query('SELECT * FROM finance_missing_expenses WHERE id = $1', [req.params.id]);
    if (!item) return res.status(404).json({ error: 'הפריט לא נמצא' });
    if (item.period_id === targetId) return res.status(400).json({ error: 'הפריט כבר בתקופה זו' });
    const { rows: dup } = await pool.query(
      'SELECT 1 FROM finance_missing_expenses WHERE period_id = $1 AND fingerprint = $2', [targetId, item.fingerprint]);
    if (dup.length) return res.status(409).json({ error: 'הפריט כבר קיים בתקופת היעד' });
    // Keep the ORIGINAL period on repeat moves
    const { rows: [updated] } = await pool.query(
      `UPDATE finance_missing_expenses
       SET period_id = $1, deferred_from_period_id = COALESCE(deferred_from_period_id, $2)
       WHERE id = $3 RETURNING *`,
      [targetId, item.period_id, req.params.id]
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/finance/missing/:id — { status?, resolved? }
router.patch('/missing/:id', async (req, res) => {
  const { status, resolved } = req.body;
  const sets = [], vals = [];
  let i = 1;
  if (status !== undefined) { sets.push(`status = $${i++}`, `status_updated_at = NOW()`); vals.push(status); }
  if (resolved !== undefined) {
    sets.push(`resolved = $${i++}`, `resolved_at = ${resolved ? 'NOW()' : 'NULL'}`);
    vals.push(!!resolved);
  }
  if (!sets.length) return res.status(400).json({ error: 'אין מה לעדכן' });
  vals.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE finance_missing_expenses SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ error: 'לא נמצא' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/finance/missing/:id/notes
router.get('/missing/:id/notes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT n.*, u.display_name AS author
       FROM finance_expense_notes n LEFT JOIN users u ON u.id = n.created_by
       WHERE n.expense_id = $1 ORDER BY n.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/finance/missing/:id/notes
router.post('/missing/:id/notes', async (req, res) => {
  const body = (req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'הערה ריקה' });
  try {
    const { rows: [note] } = await pool.query(
      `INSERT INTO finance_expense_notes (expense_id, body, created_by)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, body, req.user.id]
    );
    res.json(note);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Reconciliation periods (saved workspaces, e.g. "מאי-יוני 2026") ──────────

// GET /api/finance/periods — with open/resolved counts
router.get('/periods', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*,
              COUNT(e.id) FILTER (WHERE e.resolved = FALSE)::int AS open_count,
              COUNT(e.id) FILTER (WHERE e.resolved = TRUE)::int  AS resolved_count
       FROM finance_periods p
       LEFT JOIN finance_missing_expenses e ON e.period_id = p.id
       GROUP BY p.id ORDER BY p.created_at DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/finance/periods { name }
router.post('/periods', async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'נא להזין שם לתקופה' });
  try {
    const { rows: [row] } = await pool.query(
      'INSERT INTO finance_periods (name) VALUES ($1) RETURNING *', [name]);
    res.json({ ...row, open_count: 0, resolved_count: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/finance/periods/:id — removes the period and all its items
router.delete('/periods/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM finance_periods WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Invoice email scanning ────────────────────────────────────────────────────

// POST /api/finance/scan { from, to } — scan Gmail accounts for supplier invoices
router.post('/scan', async (req, res) => {
  const { from, to } = req.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) {
    return res.status(400).json({ error: 'טווח תאריכים לא תקין' });
  }
  try {
    const summary = await scanRange(from, to);
    res.json(summary);
  } catch (err) {
    console.error('[Finance] scan error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/finance/invoices — recently saved invoice files
router.get('/invoices', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM finance_invoice_files ORDER BY email_date DESC NULLS LAST, created_at DESC LIMIT 100`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/finance/gmail/accounts
router.get('/gmail/accounts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, active, last_scan_at, created_at FROM finance_gmail_accounts ORDER BY created_at');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/finance/gmail/connect-url — start OAuth for an additional mailbox
router.get('/gmail/connect-url', (req, res) => {
  try {
    res.json({ url: buildConnectUrl(req.user.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/finance/gmail/accounts/:id
router.delete('/gmail/accounts/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM finance_gmail_accounts WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
