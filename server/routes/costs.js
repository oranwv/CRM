// Costs panel (ניהול → עלויות): what the CRM's paid services cost per month.
//
//   Twilio   — real billed amounts from Twilio's Usage Records (monthly, by category),
//              with a local estimate from the `calls` table as a fallback / for the
//              current month before Twilio settles it.
//   OpenAI   — metered locally in `ai_usage` (services/openaiClient.js), by feature + model.
//   Fixed    — subscriptions entered by hand (Railway, Supabase, Green API, GreenInvoice…)
//              in `cost_subscriptions`; the same amount every month.
//   FX       — settings.usd_ils_rate (default 3.70) to show everything in ₪ too.
const router = require('express').Router();
const pool   = require('../db/pool');
const tw     = require('../services/twilioService');

function adminOnly(req, res, next) {
  const roles = req.user.roles || [];
  if (!(roles.includes('admin') || roles.includes('manager') || ['admin', 'manager'].includes(req.user.role))) {
    return res.status(403).json({ error: 'אין הרשאה' });
  }
  next();
}
router.use(adminOnly);

// Twilio list prices for Israel (USD) — used for the local estimate only
const TW = { inbound: 0.0107, outMobile: 0.0646, outLandline: 0.0294, client: 0.004, recording: 0.0025, number: 5.5 };
const isMobileIL = (e164) => /^\+9725/.test(e164 || '');

function monthKey(d) { const x = new Date(d); return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`; }
function lastMonths(n) {
  const out = []; const now = new Date();
  for (let i = 0; i < n; i++) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); out.push(monthKey(d)); }
  return out;
}

// Estimate each call's Twilio cost from what we know about its legs.
function estimateCallUsd(c) {
  const min = Math.ceil((c.duration_sec || 0) / 60);
  if (!min) return 0;
  if (c.direction === 'outbound') {
    const leadLeg = isMobileIL(c.to_number) ? TW.outMobile : TW.outLandline;
    const repLeg  = c.mode === 'bridge' ? TW.outMobile : TW.client;
    return min * (leadLeg + repLeg + TW.recording);
  }
  const step = Array.isArray(c.ring_plan) ? c.ring_plan[c.ring_step || 0] : null;
  const answeredOn = c.status === 'completed' ? (step?.kind === 'client' ? TW.client : TW.outMobile) : 0;
  return min * (TW.inbound + answeredOn + (c.status === 'completed' ? TW.recording : 0));
}

let twilioCache = { at: 0, data: null };
async function twilioMonthly() {
  if (!tw.isEnabled()) return null;
  if (Date.now() - twilioCache.at < 60 * 60 * 1000 && twilioCache.data) return twilioCache.data;
  try {
    const records = await tw.getClient().usage.records.monthly.list({ limit: 400 });
    const byMonth = {};
    for (const r of records) {
      const key = monthKey(r.startDate);
      byMonth[key] = byMonth[key] || { total: 0, categories: {} };
      const price = Number(r.price) || 0;
      if (r.category === 'totalprice') byMonth[key].total = price;
      else if (price > 0 && ['calls', 'calls-inbound', 'calls-outbound', 'calls-client', 'recordings', 'phonenumbers', 'transcriptions', 'calls-recordings'].includes(r.category)) {
        byMonth[key].categories[r.category] = price;
      }
    }
    twilioCache = { at: Date.now(), data: byMonth };
    return byMonth;
  } catch (err) {
    console.error('[Costs] Twilio usage fetch failed:', err.message);
    return null;
  }
}

// GET /api/costs?months=6
router.get('/', async (req, res) => {
  const n = Math.min(24, Math.max(1, Number(req.query.months) || 6));
  const months = lastMonths(n);
  const since = `${months[months.length - 1]}-01`;
  try {
    const [{ rows: ai }, { rows: calls }, { rows: subs }, { rows: [rateRow] }, twilio] = await Promise.all([
      pool.query(
        `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month, feature, model,
                SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
                SUM(audio_seconds) AS audio_seconds, SUM(cost_usd) AS cost_usd, COUNT(*) AS calls
         FROM ai_usage WHERE created_at >= $1 GROUP BY 1, 2, 3 ORDER BY 1 DESC, 7 DESC`, [since]),
      pool.query(
        `SELECT id, direction, mode, status, duration_sec, to_number, ring_plan, ring_step, started_at
         FROM calls WHERE started_at >= $1`, [since]),
      pool.query('SELECT * FROM cost_subscriptions WHERE active = TRUE ORDER BY amount DESC'),
      pool.query(`SELECT value FROM settings WHERE key = 'usd_ils_rate'`),
      twilioMonthly(),
    ]);
    const rate = Number(rateRow?.value) || 3.7;

    const out = months.map(month => {
      const aiRows = ai.filter(r => r.month === month);
      const aiTotal = aiRows.reduce((s, r) => s + Number(r.cost_usd || 0), 0);
      const monthCalls = calls.filter(c => monthKey(c.started_at) === month);
      const callsEstimate = monthCalls.reduce((s, c) => s + estimateCallUsd(c), 0);
      const callMinutes = monthCalls.reduce((s, c) => s + (c.duration_sec || 0), 0) / 60;
      const twBilled = twilio?.[month] || null;
      const numberFee = tw.isEnabled() ? TW.number : 0;
      const twilioTotal = twBilled ? twBilled.total : callsEstimate + numberFee;
      const subsTotalUsd = subs.reduce((s, x) => s + (x.currency === 'ILS' ? Number(x.amount) / rate : Number(x.amount)), 0);
      return {
        month,
        ai: { total_usd: aiTotal, rows: aiRows.map(r => ({ ...r, cost_usd: Number(r.cost_usd || 0), input_tokens: Number(r.input_tokens), output_tokens: Number(r.output_tokens), audio_seconds: Number(r.audio_seconds), calls: Number(r.calls) })) },
        twilio: {
          total_usd: twilioTotal, billed: !!twBilled, categories: twBilled?.categories || null,
          estimate_usd: callsEstimate + numberFee, number_fee_usd: numberFee,
          calls: monthCalls.length, minutes: Math.round(callMinutes),
          answered: monthCalls.filter(c => c.status === 'completed').length,
        },
        subscriptions_usd: subsTotalUsd,
        total_usd: aiTotal + twilioTotal + subsTotalUsd,
      };
    });

    res.json({ rate, months: out, subscriptions: subs, twilio_live: !!twilio, prices: TW });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/costs/rate { rate }
router.put('/rate', async (req, res) => {
  const rate = Number(req.body.rate);
  if (!rate || rate < 1 || rate > 10) return res.status(400).json({ error: 'שער לא תקין' });
  await pool.query(`INSERT INTO settings (key, value, updated_at) VALUES ('usd_ils_rate', $1, NOW())
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [String(rate)]);
  res.json({ ok: true, rate });
});

// Subscriptions CRUD
router.post('/subscriptions', async (req, res) => {
  const { name, amount, currency = 'USD', note } = req.body;
  if (!name?.trim() || !(Number(amount) >= 0)) return res.status(400).json({ error: 'שם וסכום נדרשים' });
  const { rows } = await pool.query(
    `INSERT INTO cost_subscriptions (name, amount, currency, note) VALUES ($1, $2, $3, $4) RETURNING *`,
    [name.trim(), Number(amount), currency === 'ILS' ? 'ILS' : 'USD', note || null]);
  res.status(201).json(rows[0]);
});
router.patch('/subscriptions/:id', async (req, res) => {
  const { name, amount, currency, note, active } = req.body;
  const { rows } = await pool.query(
    `UPDATE cost_subscriptions SET name = COALESCE($2, name), amount = COALESCE($3, amount), currency = COALESCE($4, currency),
            note = COALESCE($5, note), active = COALESCE($6, active) WHERE id = $1 RETURNING *`,
    [req.params.id, name, amount != null ? Number(amount) : null, currency, note, active]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});
router.delete('/subscriptions/:id', async (req, res) => {
  await pool.query('DELETE FROM cost_subscriptions WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
