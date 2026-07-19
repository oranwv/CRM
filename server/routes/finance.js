const router = require('express').Router();
const pool   = require('../db/pool');
const multer = require('multer');
const { reconcile, DEFAULT_EXCLUSIONS } = require('../services/financeReconcile');
const { scanRange, buildConnectUrl } = require('../services/financeInvoiceScanner');

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

    let newCount = 0, knownCount = 0, resolvedCount = 0;
    for (const m of missing) {
      // dd/mm/yyyy → yyyy-mm-dd for the DATE column
      const dm = (m.date || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const entryDate = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : null;
      const { rows } = await pool.query(
        `INSERT INTO finance_missing_expenses (period_id, fingerprint, entry_date, name, description, amount, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (period_id, fingerprint) DO NOTHING
         RETURNING id`,
        [periodId, m.fingerprint, entryDate, m.name || '', m.description || '', m.amount, m.source]
      );
      if (rows.length) newCount++;
      else {
        const { rows: [existing] } = await pool.query(
          'SELECT resolved FROM finance_missing_expenses WHERE period_id = $1 AND fingerprint = $2', [periodId, m.fingerprint]);
        if (existing?.resolved) resolvedCount++; else knownCount++;
      }
    }

    // Auto-resolve: open items of the re-scanned sources that are no longer
    // missing — the updated karteset now covers them. Scoped by source so a
    // bank-only re-run never touches CAL/MAX items. Deferred (carried-over)
    // items are excluded — their charge belongs to a previous period and will
    // never appear in this period's expense files.
    const runSources = [...new Set(entries.map(e => e.source))];
    const missingFps = missing.map(m => m.fingerprint);
    const { rowCount: genericResolved } = await pool.query(
      `UPDATE finance_missing_expenses
       SET resolved = TRUE, resolved_at = NOW(),
           status = COALESCE(NULLIF(status, ''), 'נסגר אוטומטית — נמצא בכרטסת המעודכנת')
       WHERE period_id = $1 AND resolved = FALSE AND deferred_from_period_id IS NULL
         AND source = ANY($2) AND NOT (fingerprint = ANY($3))`,
      [periodId, runSources, missingFps]
    );

    // Carried-over items close when this period's karteset CONTAINS their
    // amount (amount-only — the invoice is dated in this period while the
    // charge is from the previous one, so date windows don't apply).
    const kartesetAmounts = [...new Set(karteset.map(k => k.amount_rounded))];
    const { rowCount: carriedResolved } = await pool.query(
      `UPDATE finance_missing_expenses
       SET resolved = TRUE, resolved_at = NOW(),
           status = COALESCE(NULLIF(status, ''), 'נסגר אוטומטית — נמצא בכרטסת התקופה')
       WHERE period_id = $1 AND resolved = FALSE AND deferred_from_period_id IS NOT NULL
         AND ROUND(amount) = ANY($2)`,
      [periodId, kartesetAmounts]
    );

    res.json({
      newCount, knownCount, resolvedCount,
      autoResolvedCount: genericResolved + carriedResolved,
      totalEntries: entries.length, kartesetCount: karteset.length, sources, warnings,
    });
  } catch (err) {
    console.error('[Finance] reconcile error:', err.message);
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
