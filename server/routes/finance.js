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
  try {
    const { rows: exRows } = await pool.query("SELECT value FROM settings WHERE key = 'finance_exclusions'");
    const exclusions = exRows[0]?.value ? JSON.parse(exRows[0].value) : DEFAULT_EXCLUSIONS;

    const { missing, entries, karteset, sources, warnings } = await reconcile([...kartesetFiles, ...expenseFiles], { exclusions });

    let newCount = 0, knownCount = 0, resolvedCount = 0;
    for (const m of missing) {
      // dd/mm/yyyy → yyyy-mm-dd for the DATE column
      const dm = (m.date || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const entryDate = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : null;
      const { rows } = await pool.query(
        `INSERT INTO finance_missing_expenses (fingerprint, entry_date, name, description, amount, source)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (fingerprint) DO NOTHING
         RETURNING id`,
        [m.fingerprint, entryDate, m.name || '', m.description || '', m.amount, m.source]
      );
      if (rows.length) newCount++;
      else {
        const { rows: [existing] } = await pool.query(
          'SELECT resolved FROM finance_missing_expenses WHERE fingerprint = $1', [m.fingerprint]);
        if (existing?.resolved) resolvedCount++; else knownCount++;
      }
    }

    res.json({
      newCount, knownCount, resolvedCount,
      totalEntries: entries.length, kartesetCount: karteset.length, sources, warnings,
    });
  } catch (err) {
    console.error('[Finance] reconcile error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/finance/missing?resolved=true|false — sorted by amount desc
router.get('/missing', async (req, res) => {
  const resolved = req.query.resolved === 'true';
  try {
    const { rows } = await pool.query(
      `SELECT e.*, COUNT(n.id)::int AS note_count
       FROM finance_missing_expenses e
       LEFT JOIN finance_expense_notes n ON n.expense_id = e.id
       WHERE e.resolved = $1
       GROUP BY e.id
       ORDER BY e.amount DESC, e.entry_date DESC NULLS LAST`,
      [resolved]
    );
    res.json(rows);
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
