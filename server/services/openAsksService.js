// Open asks — "the ball is with us" extracted from free text (Phase 83, 2026-11-14).
//
// Once a day (before the morning briefing) gpt-4o-mini reads, per active lead with activity in
// the last 7 days, the recent conversation (WhatsApp both ways, notes, call summaries) and
// returns what the customer asked and did not get answered, and what we promised and did
// not do. Stored in lead_open_asks (one row per lead, replaced on each run) and read by
// dayPlanService for section 4 of the day plan.
const pool = require('../db/pool');

const LOOKBACK_DAYS = 7;
const MAX_LEADS_PER_RUN = 60;

async function leadsNeedingRefresh() {
  const { rows } = await pool.query(`
    SELECT l.id, l.name, l.event_type, l.event_date, l.stage,
           (SELECT MAX(x.ts) FROM (
              SELECT timestamp AS ts FROM messages m WHERE m.lead_id = l.id
              UNION ALL SELECT created_at FROM lead_interactions i WHERE i.lead_id = l.id AND i.body NOT LIKE '🔄%' AND i.body NOT LIKE '[תזכורת אוטומטית%'
              UNION ALL SELECT started_at FROM calls c WHERE c.lead_id = l.id AND c.summary IS NOT NULL
            ) x) AS last_activity,
           oa.generated_at
    FROM leads l
    LEFT JOIN lead_open_asks oa ON oa.lead_id = l.id
    WHERE l.stage NOT IN ('deposit','production','completed','lost')
  `);
  const cutoff = Date.now() - LOOKBACK_DAYS * 86400000;
  return rows
    .filter(r => r.last_activity && new Date(r.last_activity).getTime() > cutoff)
    .filter(r => !r.generated_at || new Date(r.generated_at) < new Date(r.last_activity))
    .sort((a, b) => new Date(b.last_activity) - new Date(a.last_activity))
    .slice(0, MAX_LEADS_PER_RUN);
}

async function recentText(leadId) {
  const [{ rows: msgs }, { rows: ints }, { rows: calls }] = await Promise.all([
    pool.query(`SELECT direction, body, timestamp AS ts, 'וואטסאפ' AS kind FROM messages WHERE lead_id = $1 AND timestamp > NOW() - INTERVAL '${LOOKBACK_DAYS} days'`, [leadId]),
    pool.query(`SELECT direction, body, created_at AS ts, type AS kind FROM lead_interactions WHERE lead_id = $1 AND created_at > NOW() - INTERVAL '${LOOKBACK_DAYS} days'
                AND body NOT LIKE '🔄%' AND body NOT LIKE '[תזכורת אוטומטית%'`, [leadId]),
    pool.query(`SELECT direction, summary AS body, started_at AS ts, 'סיכום שיחה' AS kind FROM calls WHERE lead_id = $1 AND summary IS NOT NULL AND started_at > NOW() - INTERVAL '${LOOKBACK_DAYS} days'`, [leadId]),
  ]);
  const KIND = { note: 'הערה פנימית', call: 'שיחה', call_attempt: 'ניסיון שיחה', meeting: 'פגישה', whatsapp: 'וואטסאפ', email: 'אימייל' };
  return [...msgs, ...ints, ...calls]
    .sort((a, b) => new Date(a.ts) - new Date(b.ts))
    .map(r => `[${new Date(r.ts).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' })} ${r.kind === 'note' ? 'הערה פנימית של הנציג' : (r.direction === 'inbound' ? 'לקוח' : 'שרביה')} · ${KIND[r.kind] || r.kind}]: ${String(r.body || '').slice(0, 600)}`)
    .join('\n');
}

async function extractForLead(lead) {
  const text = await recentText(lead.id);
  if (!text.trim()) return [];
  const openai = require('./openaiClient').openai('open-asks');
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 400,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: `אתה עוזר מכירות באולם אירועים "שרביה". לפניך התכתבות/שיחות/הערות של 7 הימים האחרונים עם ליד (${lead.name || ''}, ${lead.event_type || ''}).
מצא רק דברים ש"הכדור אצלנו" — כלומר פעולה שאנחנו (שרביה) צריכים לעשות ועדיין לא עשינו:
- שאלה שהלקוח שאל ולא קיבלה מענה (למשל: אפשר הנחה? אפשר תפריט אחר? התאריך פנוי?)
- דבר שהבטחנו לעשות ולא נראה שנעשה (לשלוח הצעה/חוזה/תמונות, לחזור אליו, לבדוק משהו)
- בקשה בהערה פנימית של הנציג שעדיין פתוחה (למשל "לשלוח לו הצעה ביום ראשון")
אל תמציא. אם שרביה כבר ענתה/עשתה — לא לכלול. עד 3 פריטים, כל אחד משפט קצר בעברית.

הטקסט:
${text}

החזר JSON בלבד: {"asks":[{"text":"<מה צריך לעשות, קצר>","source":"<וואטסאפ|שיחה|הערה>","asked_on":"<תאריך DD.MM או ריק>"}]}`,
    }],
  });
  try {
    const parsed = JSON.parse(completion.choices[0].message.content);
    return (parsed.asks || []).filter(a => a && String(a.text || '').trim()).slice(0, 3)
      .map(a => ({ text: String(a.text).trim(), source: String(a.source || 'AI').trim(), asked_on: a.asked_on || null }));
  } catch { return []; }
}

// Refresh open asks for leads whose activity is newer than their last extraction.
async function refreshOpenAsks() {
  if (!process.env.OPENAI_API_KEY) return { refreshed: 0 };
  const leads = await leadsNeedingRefresh();
  let n = 0;
  for (const lead of leads) {
    try {
      const items = await extractForLead(lead);
      await pool.query(
        `INSERT INTO lead_open_asks (lead_id, items, generated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (lead_id) DO UPDATE SET items = $2, generated_at = NOW()`,
        [lead.id, JSON.stringify(items)]
      );
      n++;
    } catch (e) { console.error('[OpenAsks] lead', lead.id, e.message); }
  }
  if (n) console.log(`[OpenAsks] refreshed ${n} leads`);
  return { refreshed: n };
}

// Estimated event costs for the biggest open deals that have none yet (so "expected profit"
// in the day plan has something to work with). Uses the same cost model + AI as the
// sales-performance panel (eventCostService), from the contract or, failing that, the offer.
async function estimateCostsForOpenDeals(limit = 15) {
  if (!process.env.OPENAI_API_KEY) return { estimated: 0 };
  const { generateEventCosts } = require('./eventCostService');
  const { rows } = await pool.query(`
    SELECT l.id
    FROM leads l
    LEFT JOIN event_costs ec ON ec.lead_id = l.id
    WHERE l.stage NOT IN ('deposit','production','completed','lost')
      AND (ec.lead_id IS NULL OR ec.lines = '[]'::jsonb)
      AND (EXISTS (SELECT 1 FROM price_offers p WHERE p.lead_id = l.id) OR EXISTS (SELECT 1 FROM contracts c WHERE c.lead_id = l.id))
    ORDER BY l.updated_at DESC NULLS LAST, l.id DESC
    LIMIT $1`, [limit]);
  let n = 0;
  for (const r of rows) {
    try { await generateEventCosts(r.id, null, { onlyIfEmpty: true }); n++; }
    catch (e) { if (!/מודל עלויות|מאגר הידע/.test(e.message)) console.error('[OpenAsks] costs lead', r.id, e.message); else return { estimated: n, skipped: 'no cost model' }; }
  }
  if (n) console.log(`[OpenAsks] estimated costs for ${n} open deals`);
  return { estimated: n };
}

module.exports = { refreshOpenAsks, estimateCostsForOpenDeals, extractForLead };
