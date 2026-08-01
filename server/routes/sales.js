const router = require('express').Router();
const pool   = require('../db/pool');
const { generateEventCosts, normalizeLine } = require('../services/eventCostService');

// Sales-performance data (closed events + per-event profit) — visible to sales too
router.use((req, res, next) => {
  const roles = req.user.roles?.length ? req.user.roles : [req.user.role];
  if (['admin', 'manager', 'sales'].some(r => roles.includes(r))) return next();
  return res.status(403).json({ error: 'אין הרשאה' });
});

function sumLines(lines) {
  return (Array.isArray(lines) ? lines : []).reduce((s, l) => s + (Number(l.amount) || 0), 0);
}

// An event "closes" in the month its contract was signed; closed-stage leads
// without a signed contract fall back to the deposit stage-change note time.
async function fetchClosedEvents(year, month) {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd   = new Date(year, month, 1);
  const { rows } = await pool.query(`
      WITH signed AS (
        SELECT lead_id, MIN(signed_at) AS close_date
        FROM contracts WHERE status = 'signed'
        GROUP BY lead_id
      ),
      deposit_note AS (
        SELECT lead_id, MIN(created_at) AS close_date
        FROM lead_interactions
        WHERE type = 'note' AND body LIKE '%שינוי שלב%' AND body LIKE '%התקבלה מקדמה%'
        GROUP BY lead_id
      ),
      closed AS (
        SELECT l.id AS lead_id, COALESCE(s.close_date, dn.close_date) AS close_date
        FROM leads l
        LEFT JOIN signed s        ON s.lead_id  = l.id
        LEFT JOIN deposit_note dn ON dn.lead_id = l.id
        WHERE COALESCE(s.close_date, dn.close_date) IS NOT NULL
          AND (s.lead_id IS NOT NULL OR l.stage IN ('deposit','production','completed'))
      ),
      latest_contract AS (
        SELECT DISTINCT ON (lead_id) lead_id, contract_data
        FROM contracts
        ORDER BY lead_id, (status = 'signed') DESC, created_at DESC
      )
      SELECT c.lead_id, c.close_date,
             l.name, l.event_date, l.event_type, l.stage,
             u.display_name AS salesperson,
             lc.contract_data,
             ec.lines AS cost_lines, ec.ai_generated_at
      FROM closed c
      JOIN leads l ON l.id = c.lead_id
      LEFT JOIN users u ON u.id = l.assigned_to
      LEFT JOIN latest_contract lc ON lc.lead_id = c.lead_id
      LEFT JOIN event_costs ec ON ec.lead_id = c.lead_id
      WHERE c.close_date >= $1 AND c.close_date < $2
      ORDER BY c.close_date ASC
    `, [monthStart.toISOString(), monthEnd.toISOString()]);

  return rows.map(r => {
    const amount     = r.contract_data?.calculated?.subtotal != null ? Number(r.contract_data.calculated.subtotal) : null;
    const costsTotal = sumLines(r.cost_lines);
    return {
      lead_id:         r.lead_id,
      name:            r.name,
      event_date:      r.event_date,
      event_type:      r.event_type,
      stage:           r.stage,
      close_date:      r.close_date,
      salesperson:     r.salesperson || null,
      amount,
      lines:           r.cost_lines || [],
      ai_generated_at: r.ai_generated_at || null,
      costs_total:     costsTotal,
      profit:          amount != null ? amount - costsTotal : null,
    };
  });
}

// GET /api/sales/closed-events?year=YYYY&month=M
router.get('/closed-events', async (req, res) => {
  try {
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const events = await fetchClosedEvents(year, month);
    res.json({
      events,
      summary: {
        count:        events.length,
        total_amount: events.reduce((s, e) => s + (e.amount || 0), 0),
        total_profit: events.reduce((s, e) => s + (e.profit ?? 0), 0),
      },
    });
  } catch (err) {
    console.error('[Sales] closed-events error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/sales/costs/:leadId — save edited cost lines
router.put('/costs/:leadId', async (req, res) => {
  const { lines } = req.body;
  if (!Array.isArray(lines)) return res.status(400).json({ error: 'lines required' });
  try {
    const clean = lines
      .filter(l => (l.label || '').trim() || l.amount || l.qty || l.unit_price)
      .map((l, i) => normalizeLine(l, i));
    const { rows: [row] } = await pool.query(`
      INSERT INTO event_costs (lead_id, lines, updated_by, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (lead_id) DO UPDATE SET lines = $2, updated_by = $3, updated_at = NOW()
      RETURNING lines
    `, [req.params.leadId, JSON.stringify(clean), req.user.id]);
    res.json({ lines: row.lines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sales/costs/generate-missing?year&month — backfill: compute costs
// for every closed event of the month that has none yet (never overwrites)
router.post('/costs/generate-missing', async (req, res) => {
  try {
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const events  = await fetchClosedEvents(year, month);
    const missing = events.filter(e => e.amount != null && (!e.lines || e.lines.length === 0));

    let generated = 0;
    const errors = [];
    // Sequential on purpose — avoid hammering the OpenAI API
    for (const ev of missing) {
      try {
        const r = await generateEventCosts(ev.lead_id, req.user.id, { onlyIfEmpty: true });
        if (r) generated += 1;
      } catch (err) {
        errors.push({ lead_id: ev.lead_id, name: ev.name, error: err.message });
      }
    }
    res.json({ generated, failed: errors.length, errors });
  } catch (err) {
    console.error('[Sales] generate-missing error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sales/costs/:leadId/generate — compute cost lines with AI from the
// cost-model document(s) in the assistant's knowledge base (explicit recompute)
router.post('/costs/:leadId/generate', async (req, res) => {
  try {
    const result = await generateEventCosts(req.params.leadId, req.user.id);
    res.json(result);
  } catch (err) {
    console.error('[Sales] generate costs error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
