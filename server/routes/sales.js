const router = require('express').Router();
const pool   = require('../db/pool');
const { OpenAI } = require('openai');

// Sales-performance data (closed events + per-event profit) — visible to sales too
router.use((req, res, next) => {
  const roles = req.user.roles?.length ? req.user.roles : [req.user.role];
  if (['admin', 'manager', 'sales'].some(r => roles.includes(r))) return next();
  return res.status(403).json({ error: 'אין הרשאה' });
});

function sumLines(lines) {
  return (Array.isArray(lines) ? lines : []).reduce((s, l) => s + (Number(l.amount) || 0), 0);
}

// GET /api/sales/closed-events?year=YYYY&month=M
// An event "closes" in the month its contract was signed; closed-stage leads
// without a signed contract fall back to the deposit stage-change note time.
router.get('/closed-events', async (req, res) => {
  try {
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
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

    const events = rows.map(r => {
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
      .filter(l => (l.label || '').trim() || l.amount)
      .map((l, i) => ({ id: l.id || i + 1, label: (l.label || '').trim(), amount: Number(l.amount) || 0 }));
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

// POST /api/sales/costs/:leadId/generate — compute cost lines with AI from the
// cost-model document(s) in the assistant's knowledge base
router.post('/costs/:leadId/generate', async (req, res) => {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(500).json({ error: 'OPENAI_API_KEY is not set' });

    const [{ rows: kbFiles }, { rows: [lead] }, { rows: contractRows }] = await Promise.all([
      pool.query('SELECT filename, content_text FROM ai_knowledge_files ORDER BY created_at DESC'),
      pool.query('SELECT name, event_type, guest_count, event_date FROM leads WHERE id = $1', [req.params.leadId]),
      pool.query(`SELECT contract_data FROM contracts WHERE lead_id = $1
                  ORDER BY (status = 'signed') DESC, created_at DESC LIMIT 1`, [req.params.leadId]),
    ]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (!kbFiles.length) {
      return res.status(400).json({ error: 'אין מסמכים במאגר הידע של העוזר — העלה את מסמך מודל העלויות בהגדרות' });
    }

    const cd     = contractRows[0]?.contract_data || null;
    const f      = cd?.fields || {};
    const guests = f.guests || f.packageGuests || lead.guest_count || '';
    const eventInfo = [
      `שם האירוע/לקוח: ${lead.name || ''}`,
      `סוג אירוע: ${lead.event_type || ''}`,
      `מספר אורחים: ${guests}`,
      `תאריך אירוע: ${lead.event_date ? String(lead.event_date).slice(0, 10) : ''}`,
      cd?.calculated?.subtotal != null ? `סכום החוזה לפני מע"מ: ${cd.calculated.subtotal} ש"ח` : '',
      f.chefMenu ? `תפריט שף: ${f.chefMenu}` : '',
      f.barMenu  ? `תפריט בר: ${f.barMenu}`  : '',
    ].filter(Boolean).join('\n');

    const docs = kbFiles.map(k => `## מסמך: ${k.filename}\n${k.content_text}`).join('\n\n');
    const openai = new OpenAI({ apiKey: key });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1024,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `אתה מחשב עלויות הפקה לאירוע באולם אירועים לפי מודל העלויות של העסק.

המסמכים של העסק (כולל מודל העלויות):
${docs}

פרטי האירוע:
${eventInfo}

חשב את שורות העלות של האירוע לפי המודל שבמסמכים (למשל: מלצרים, ברמנים, שף/קייטרינג, אבטחה, ניקיון וכו' — לפי הכללים והתעריפים שבמודל, בהתאם למספר האורחים).
החזר JSON בלבד בפורמט: {"lines":[{"label":"<שם העלות בעברית>","amount":<סכום בש"ח כמספר>}]}
אם אין במסמכים מודל עלויות ברור — החזר {"lines":[]}.`,
      }],
    });

    let lines = [];
    try {
      const parsed = JSON.parse(completion.choices[0].message.content);
      lines = (parsed.lines || [])
        .filter(l => (l.label || '').trim())
        .map((l, i) => ({ id: i + 1, label: String(l.label).trim(), amount: Number(l.amount) || 0 }));
    } catch {
      return res.status(500).json({ error: 'תשובת ה-AI לא תקינה — נסה שוב' });
    }
    if (!lines.length) {
      return res.status(400).json({ error: 'ה-AI לא מצא מודל עלויות ישים במסמכי מאגר הידע' });
    }

    const { rows: [row] } = await pool.query(`
      INSERT INTO event_costs (lead_id, lines, ai_generated_at, updated_by, updated_at)
      VALUES ($1, $2, NOW(), $3, NOW())
      ON CONFLICT (lead_id) DO UPDATE SET lines = $2, ai_generated_at = NOW(), updated_by = $3, updated_at = NOW()
      RETURNING lines, ai_generated_at
    `, [req.params.leadId, JSON.stringify(lines), req.user.id]);

    res.json({ lines: row.lines, ai_generated_at: row.ai_generated_at });
  } catch (err) {
    console.error('[Sales] generate costs error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
