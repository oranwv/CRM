// "פתיחת יום" — the ranked day plan for sales (Phase 83, 2026-11-14).
//
// One query loads every active lead in the user's scope with all the signals the ranking
// needs; everything else is plain JS. Five main sections, each lead appears ONCE (in the
// first section it qualifies for), plus "extras" for the in-app screen where a lead may
// repeat. The WhatsApp morning message is the compact rendering of the same plan.
//
//   1. contracts   — contract sent, not signed. Opened-but-unsigned first, then oldest contract.
//   2. nearEvents  — event within NEAR_EVENT_DAYS, soonest first.
//   3. engaged     — engagement score (offer, meeting, recent contact...) ≥ ENGAGED_MIN, top 20.
//   4. waiting     — the ball is with us: unanswered customer message, overdue task, offer /
//                    contract follow-up, post-meeting silence, call next-steps, AI open asks.
//   5. bigDeals    — top 5 by expected profit (offer/contract subtotal − estimated event costs).
//
// Scoring weights live in WEIGHTS so they can be tuned in one place.
const pool = require('../db/pool');
const { offerAmounts, contractTotal } = require('./salesAdvisor');

const ACTIVE_EXCLUDE   = ['deposit', 'production', 'completed', 'lost'];
const NEAR_EVENT_DAYS  = 60;
const ENGAGED_MIN      = 25;
const LIMITS = { contracts: 10, nearEvents: 8, engaged: 20, waiting: 10, bigDeals: 5 };
const WEIGHTS = {
  offer: 30, meetingDone: 25, meetingFuture: 15,
  perContact14d: 5, perContact14dMax: 25, inbound7d: 10,
  recent3d: 10, stale14d: -15, negotiation: 10,
  temp: { hot: 10, warm: 5, cold: -10 },
};

const DAY = 86400000;
const daysBetween = (a, b) => Math.floor((new Date(a) - new Date(b)) / DAY);
const daysAgo = d => (d ? daysBetween(new Date(), d) : null);
const fmtDate  = d => {
  if (!d) return '';
  const x = new Date(d);
  const sameYear = x.toLocaleDateString('en-US', { year: 'numeric', timeZone: 'Asia/Jerusalem' }) === new Date().toLocaleDateString('en-US', { year: 'numeric', timeZone: 'Asia/Jerusalem' });
  return x.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', ...(sameYear ? {} : { year: '2-digit' }), timeZone: 'Asia/Jerusalem' });
};
const fmtDateY = d => (d ? new Date(d).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' }) : '');
const agoText = n => (n == null ? '' : n <= 0 ? 'היום' : n === 1 ? 'אתמול' : `לפני ${n} ימים`);
const fmtK = n => (n == null ? '' : n >= 1000 ? `₪${Math.round(n / 1000)}K` : `₪${Math.round(n)}`);
const snip = (s, n = 60) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// Pre-VAT amount of the deal: contract first, else the latest price offer
function dealSubtotal(r) {
  if (r.contract_data) {
    const c = r.contract_data.calculated || {};
    if (c.subtotal != null) return Math.round(Number(c.subtotal)) || 0;
    return offerAmounts(r.contract_data.rows, r.contract_data.fields, r.contract_data.offerType).subtotal;
  }
  if (r.offer_rows || r.offer_fields) return offerAmounts(r.offer_rows, r.offer_fields, r.offer_type).subtotal;
  return null;
}
function dealTotal(r) {
  if (r.contract_data) return contractTotal(r.contract_data);
  if (r.offer_rows || r.offer_fields) return offerAmounts(r.offer_rows, r.offer_fields, r.offer_type).total;
  return null;
}
const sumLines = lines => (Array.isArray(lines) ? lines : []).reduce((s, l) => s + (Number(l.amount) || 0), 0);

async function loadLeads(user) {
  const roles = user.roles?.length ? user.roles : [user.role];
  const isAM = ['admin', 'manager', 'sales_manager'].some(r => roles.includes(r));
  const params = [ACTIVE_EXCLUDE];
  let scope = '';
  if (!isAM) { params.push(user.id); scope = 'AND l.assigned_to = $2'; }
  const { rows } = await pool.query(`
    SELECT l.id AS lead_id, l.name, l.phone, l.event_date, l.event_type, l.stage, l.priority,
           l.guest_count, l.created_at, l.assigned_to,
           u.display_name AS rep,
           lc.ts AS last_ts, lc.kind AS last_kind, lc.direction AS last_direction, lc.body AS last_body,
           (SELECT COUNT(*) FROM (
              SELECT timestamp AS ts FROM messages m WHERE m.lead_id = l.id AND m.timestamp > NOW() - INTERVAL '14 days'
              UNION ALL
              SELECT created_at FROM lead_interactions i WHERE i.lead_id = l.id AND i.created_at > NOW() - INTERVAL '14 days'
                AND i.body NOT LIKE '🔄%' AND i.body NOT LIKE '[תזכורת אוטומטית%'
            ) c14) AS contacts_14d,
           EXISTS (SELECT 1 FROM messages m WHERE m.lead_id = l.id AND m.direction = 'inbound' AND m.timestamp > NOW() - INTERVAL '7 days') AS inbound_7d,
           (SELECT MAX(x.ts) FROM (
              SELECT timestamp AS ts FROM messages m WHERE m.lead_id = l.id AND m.direction <> 'inbound'
              UNION ALL
              SELECT created_at FROM lead_interactions i WHERE i.lead_id = l.id AND i.direction <> 'inbound'
                AND i.body NOT LIKE '🔄%' AND i.body NOT LIKE '[תזכורת אוטומטית%'
            ) x) AS last_outbound_ts,
           (SELECT MAX(start_time) FROM meetings mt WHERE mt.lead_id = l.id AND mt.start_time < NOW()) AS last_meeting_at,
           (SELECT MIN(start_time) FROM meetings mt WHERE mt.lead_id = l.id AND mt.start_time >= NOW()) AS next_meeting_at,
           EXISTS (SELECT 1 FROM lead_interactions i WHERE i.lead_id = l.id AND i.type = 'meeting') AS has_meeting_note,
           (SELECT MAX(created_at) FROM contracts c2 WHERE c2.lead_id = l.id AND c2.status <> 'signed') AS contract_sent_at,
           EXISTS (SELECT 1 FROM contracts c WHERE c.lead_id = l.id AND c.status = 'signed') AS has_signed_contract,
           (SELECT MAX(v.viewed_at) FROM contract_views v JOIN contracts c ON c.id = v.contract_id WHERE c.lead_id = l.id AND c.status <> 'signed') AS contract_viewed_at,
           (SELECT MAX(created_at) FROM price_offers p2 WHERE p2.lead_id = l.id) AS offer_sent_at,
           (SELECT c3.contract_data FROM contracts c3 WHERE c3.lead_id = l.id ORDER BY (c3.status='signed') DESC, c3.created_at DESC LIMIT 1) AS contract_data,
           (SELECT p3.rows   FROM price_offers p3 WHERE p3.lead_id = l.id ORDER BY p3.created_at DESC LIMIT 1) AS offer_rows,
           (SELECT p3.fields FROM price_offers p3 WHERE p3.lead_id = l.id ORDER BY p3.created_at DESC LIMIT 1) AS offer_fields,
           (SELECT p3.offer_type FROM price_offers p3 WHERE p3.lead_id = l.id ORDER BY p3.created_at DESC LIMIT 1) AS offer_type,
           (SELECT json_agg(json_build_object('id', t.id, 'title', t.title, 'due_at', t.due_at) ORDER BY t.due_at)
              FROM tasks t WHERE t.lead_id = l.id AND t.completed_at IS NULL
               AND t.due_at < (date_trunc('day', NOW() AT TIME ZONE 'Asia/Jerusalem') + INTERVAL '1 day') AT TIME ZONE 'Asia/Jerusalem') AS due_tasks,
           a.data->>'temperature' AS temperature, a.data->>'next_action' AS advice_next, a.generated_at AS advice_at,
           (SELECT json_build_object('at', ca.started_at, 'next_steps', ca.analysis->'next_steps', 'objections', ca.analysis->'objections')
              FROM calls ca WHERE ca.lead_id = l.id AND ca.analysis IS NOT NULL ORDER BY ca.started_at DESC LIMIT 1) AS last_call,
           (SELECT MAX(created_at) FROM lead_stage_history h WHERE h.lead_id = l.id) AS stage_since,
           oa.items AS open_asks, oa.generated_at AS open_asks_at,
           ec.lines AS cost_lines
    FROM leads l
    LEFT JOIN users u ON u.id = l.assigned_to
    LEFT JOIN lead_ai_advice a ON a.lead_id = l.id
    LEFT JOIN lead_open_asks oa ON oa.lead_id = l.id
    LEFT JOIN event_costs ec ON ec.lead_id = l.id
    LEFT JOIN LATERAL (
      SELECT ts, direction, kind, body FROM (
        SELECT timestamp AS ts, direction, channel AS kind, body FROM messages WHERE lead_id = l.id
        UNION ALL
        SELECT created_at AS ts, direction, type AS kind, body FROM lead_interactions
          WHERE lead_id = l.id AND body NOT LIKE '🔄%' AND body NOT LIKE '[תזכורת אוטומטית%'
      ) x ORDER BY ts DESC LIMIT 1
    ) lc ON true
    WHERE l.stage <> ALL($1::text[]) ${scope}
  `, params);
  return rows;
}

// ── per-lead derivations ────────────────────────────────────────────────────
function engagementScore(r, f) {
  const parts = [];
  let s = 0;
  const add = (v, label) => { if (v) { s += v; parts.push(label); } };
  if (f.has_offer) add(WEIGHTS.offer, 'הצעה נשלחה');
  if (f.meeting_done) add(WEIGHTS.meetingDone, 'פגישה התקיימה');
  else if (f.next_meeting_at) add(WEIGHTS.meetingFuture, 'פגישה קבועה');
  const c = Math.min(Number(r.contacts_14d) || 0, Math.floor(WEIGHTS.perContact14dMax / WEIGHTS.perContact14d));
  if (c) add(c * WEIGHTS.perContact14d, `${Number(r.contacts_14d)} מגעים ב-14 יום`);
  if (r.inbound_7d) add(WEIGHTS.inbound7d, 'הלקוח פנה השבוע');
  if (f.days_since != null && f.days_since <= 3) add(WEIGHTS.recent3d, 'קשר ב-3 הימים האחרונים');
  else if (f.days_since == null || f.days_since > 14) add(WEIGHTS.stale14d, 'ללא קשר מעל 14 יום');
  if (r.stage === 'negotiation') add(WEIGHTS.negotiation, 'משא ומתן');
  if (r.temperature && WEIGHTS.temp[r.temperature] != null) add(WEIGHTS.temp[r.temperature], `AI: ${r.temperature === 'hot' ? 'חם' : r.temperature === 'warm' ? 'פושר' : 'קר'}`);
  return { score: s, parts };
}

// Everything that says "the ball is with us", most urgent first. Each: { kind, text, source }.
function waitingReasons(r, f) {
  const out = [];
  const lastInbound = r.last_direction === 'inbound' && r.last_kind !== 'note';
  if (lastInbound) {
    const what = r.last_kind === 'call' || r.last_kind === 'call_attempt' ? 'התקשר' : 'כתב';
    const q = /\?/.test(r.last_body || '') ? ' (שאלה)' : '';
    out.push({ kind: 'unanswered', text: `הלקוח ${what} ${agoText(f.days_since)} ולא ענינו${q}: "${snip(r.last_body, 70)}"`, source: 'שיחה/הודעה' });
  }
  for (const t of (r.due_tasks || [])) {
    const late = daysAgo(t.due_at);
    out.push({ kind: 'task', text: `משימה: ${snip(t.title, 50)}${late > 0 ? ` (באיחור ${late} ימים)` : ' (היום)'}`, source: 'משימות', task_id: t.id });
  }
  if (r.contract_sent_at && r.contract_viewed_at && daysAgo(r.contract_viewed_at) >= 1
      && (!r.last_outbound_ts || new Date(r.last_outbound_ts) < new Date(r.contract_viewed_at))) {
    out.push({ kind: 'contract_viewed', text: `הלקוח פתח את החוזה ${agoText(daysAgo(r.contract_viewed_at))} ולא חתם — לחזור אליו`, source: 'צפיות בחוזה' });
  }
  if (f.meeting_done && !f.has_offer && !r.contract_sent_at) {
    out.push({ kind: 'send_offer', text: `הייתה פגישה ${fmtDate(r.last_meeting_at)} ואין הצעת מחיר — לשלוח הצעה`, source: 'פגישות' });
  } else if (['meeting', 'negotiation'].includes(r.stage) && !f.has_offer && !r.contract_sent_at) {
    out.push({ kind: 'send_offer', text: 'בשלב פגישה/מו"מ ואין הצעת מחיר — לשלוח הצעה', source: 'שלב' });
  }
  if (r.stage === 'meeting_scheduled' && !r.next_meeting_at && !f.meeting_done) {
    out.push({ kind: 'book_meeting', text: 'מסומן "נקבעה פגישה" אבל אין פגישה ביומן — לקבוע בפועל', source: 'שלב/יומן' });
  }
  if (f.meeting_done && daysAgo(r.last_meeting_at) <= 10 && (!r.last_outbound_ts || new Date(r.last_outbound_ts) < new Date(r.last_meeting_at))) {
    out.push({ kind: 'post_meeting', text: `אין מגע מאז הפגישה ${fmtDate(r.last_meeting_at)} — סיכום/הצעה`, source: 'פגישות' });
  }
  if (f.has_offer && !r.contract_sent_at && daysAgo(r.offer_sent_at) >= 7 && (f.days_since == null || f.days_since >= 3)) {
    out.push({ kind: 'offer_stale', text: `הצעה נשלחה ${agoText(daysAgo(r.offer_sent_at))} בלי התקדמות — לבדוק / לשלוח חוזה`, source: 'הצעות מחיר' });
  }
  if (r.last_call && daysAgo(r.last_call.at) <= 14 && Array.isArray(r.last_call.next_steps)) {
    for (const step of r.last_call.next_steps.slice(0, 2)) {
      if (String(step || '').trim()) out.push({ kind: 'call_step', text: `משיחה ${fmtDate(r.last_call.at)}: ${snip(step, 70)}`, source: 'תמלול שיחה' });
    }
  }
  if (Array.isArray(r.open_asks)) {
    for (const ask of r.open_asks.slice(0, 3)) {
      if (ask && ask.text) out.push({ kind: 'open_ask', text: snip(ask.text, 90), source: ask.source || 'AI' });
    }
  }
  return out;
}

const WAIT_RANK = { unanswered: 0, task: 1, contract_viewed: 2, open_ask: 3, call_step: 4, send_offer: 5, post_meeting: 6, book_meeting: 7, offer_stale: 8 };

function derive(r) {
  const now = new Date();
  const days_since = r.last_ts ? daysBetween(now, r.last_ts) : null;
  const event_days = r.event_date ? daysBetween(r.event_date, now) : null;
  const f = {
    has_offer: !!r.offer_sent_at,
    meeting_done: !!r.last_meeting_at || !!r.has_meeting_note,
    next_meeting_at: r.next_meeting_at,
    days_since,
    event_days,
  };
  const eng = engagementScore(r, f);
  const subtotal = dealSubtotal(r);
  const costs = r.cost_lines ? sumLines(r.cost_lines) : null;
  const profit = subtotal != null && costs != null && costs > 0 ? subtotal - costs : null;
  const waiting = waitingReasons(r, f).sort((a, b) => WAIT_RANK[a.kind] - WAIT_RANK[b.kind]);
  return {
    lead_id: r.lead_id, name: r.name, phone: r.phone, rep: r.rep || null, assigned_to: r.assigned_to,
    event_type: r.event_type, event_date: r.event_date, event_days, near_event: event_days != null && event_days >= 0 && event_days <= NEAR_EVENT_DAYS,
    stage: r.stage, priority: r.priority, guest_count: r.guest_count, created_at: r.created_at,
    temperature: r.temperature || null,
    contract_sent_at: r.contract_sent_at, contract_viewed_at: r.contract_viewed_at, has_signed_contract: r.has_signed_contract,
    offer_sent_at: r.offer_sent_at,
    meeting_done: f.meeting_done, last_meeting_at: r.last_meeting_at, next_meeting_at: r.next_meeting_at,
    last_contact: r.last_body != null ? { ts: r.last_ts, kind: r.last_kind, direction: r.last_direction, body: r.last_body } : null,
    days_since_contact: days_since, contacts_14d: Number(r.contacts_14d) || 0, inbound_7d: !!r.inbound_7d,
    engagement: eng.score, engagement_parts: eng.parts,
    deal_value: dealTotal(r), deal_subtotal: subtotal, est_costs: costs, expected_profit: profit,
    waiting,
    due_tasks: r.due_tasks || [],
    stage_since: r.stage_since,
    advice_next: r.advice_next || null,
  };
}

// ── the plan ────────────────────────────────────────────────────────────────
async function buildDayPlan(user) {
  const rows = await loadLeads(user);
  const leads = rows.map(derive);
  const shown = new Map(); // lead_id → section key
  const overflow = {}; // leads past a section's limit (NOT the ones already shown elsewhere)
  const take = (key, list, limit) => {
    const picked = [];
    overflow[key] = 0;
    for (const it of list) {
      if (shown.has(it.lead_id)) continue;
      if (picked.length >= limit) { overflow[key]++; continue; }
      picked.push(it);
      shown.set(it.lead_id, key);
    }
    return picked;
  };
  const byDate = (a, b) => new Date(a) - new Date(b);

  // 1. contracts — opened-but-unsigned first, then oldest contract first
  const contractsAll = leads.filter(l => l.contract_sent_at && !l.has_signed_contract)
    .sort((a, b) => (!!b.contract_viewed_at - !!a.contract_viewed_at) || byDate(a.contract_sent_at, b.contract_sent_at));
  const contracts = take('contracts', contractsAll, LIMITS.contracts);

  // 2. near events
  const nearAll = leads.filter(l => l.near_event).sort((a, b) => byDate(a.event_date, b.event_date));
  const nearEvents = take('nearEvents', nearAll, LIMITS.nearEvents);

  // 3. engaged
  const engagedAll = leads.filter(l => l.engagement >= ENGAGED_MIN)
    .sort((a, b) => b.engagement - a.engagement || (b.deal_value || 0) - (a.deal_value || 0));
  const engaged = take('engaged', engagedAll, LIMITS.engaged);

  // 4. waiting for us — the to-do list: NOT deduped (a lead listed above still needs its
  // action done today); marked with the section it already appears in
  const waitingAll = leads.filter(l => l.waiting.length)
    .sort((a, b) => WAIT_RANK[a.waiting[0].kind] - WAIT_RANK[b.waiting[0].kind] || b.engagement - a.engagement);
  const waiting = waitingAll.slice(0, LIMITS.waiting).map(l => ({ ...l, also_in: shown.get(l.lead_id) || null }));
  overflow.waiting = Math.max(0, waitingAll.length - waiting.length);
  for (const l of waiting) if (!shown.has(l.lead_id)) shown.set(l.lead_id, 'waiting');

  // 5. big deals — top 5 by expected profit (then by amount for deals without a cost estimate);
  // may repeat leads already shown (marked with their section)
  const bigAll = leads.filter(l => l.deal_value > 0)
    .sort((a, b) => (b.expected_profit ?? -1) - (a.expected_profit ?? -1) || b.deal_value - a.deal_value);
  const bigDeals = bigAll.slice(0, LIMITS.bigDeals).map(l => ({ ...l, also_in: shown.get(l.lead_id) || null }));
  for (const l of bigDeals) if (!shown.has(l.lead_id)) shown.set(l.lead_id, 'bigDeals');

  // extras for the screen (leads may repeat here)
  const now = Date.now();
  const extras = {
    newUntouched: leads.filter(l => ['new', 'new_no_answer'].includes(l.stage) && (!l.last_contact || l.last_contact.direction === 'inbound'))
      .sort((a, b) => byDate(b.created_at, a.created_at)),
    vanished: leads.filter(l => l.days_since_contact == null || l.days_since_contact > 14)
      .filter(l => !['new', 'new_no_answer'].includes(l.stage))
      .sort((a, b) => (b.deal_value || 0) - (a.deal_value || 0)),
    meetingsSoon: leads.filter(l => l.next_meeting_at && new Date(l.next_meeting_at) - now < 2 * DAY)
      .sort((a, b) => byDate(a.next_meeting_at, b.next_meeting_at)),
    contractViewed: leads.filter(l => l.contract_sent_at && !l.has_signed_contract && l.contract_viewed_at)
      .sort((a, b) => byDate(b.contract_viewed_at, a.contract_viewed_at)),
    overdueTasks: leads.filter(l => l.due_tasks.some(t => daysAgo(t.due_at) > 0)),
    staleOffers: leads.filter(l => l.offer_sent_at && !l.contract_sent_at && daysAgo(l.offer_sent_at) >= 10)
      .sort((a, b) => byDate(a.offer_sent_at, b.offer_sent_at)),
  };

  return {
    generated_at: new Date().toISOString(),
    counts: { active: leads.length, contracts: contractsAll.length, nearEvents: nearAll.length, engaged: engagedAll.length, waiting: waitingAll.length },
    sections: { contracts, nearEvents, engaged, waiting, bigDeals },
    more: overflow,
    extras,
    leads,
  };
}

// ── WhatsApp text (morning) — one fact line + link per lead ─────────────────
const SECTION_TITLES = {
  contracts: '📝 חוזים שנשלחו וטרם נחתמו', nearEvents: '📅 אירועים קרובים', engaged: '🤝 הכי בתהליך',
  waiting: '⏳ הכדור אצלנו', bigDeals: '💰 העסקאות הגדולות',
};
const israelDayName = () => new Date().toLocaleDateString('he-IL', { weekday: 'long', timeZone: 'Asia/Jerusalem' });

function factLine(l, section) {
  const p = [];
  if (l.event_type) p.push(l.event_type);
  if (l.event_date) p.push(`אירוע ${fmtDate(l.event_date)}${l.event_days != null && l.event_days >= 0 && l.event_days <= 14 ? ' 🔴' : ''}`);
  if (section === 'contracts') {
    p.push(l.contract_viewed_at ? `פתח/ה את החוזה ${agoText(daysAgo(l.contract_viewed_at))} ולא חתם/ה` : `חוזה נשלח ${agoText(daysAgo(l.contract_sent_at))}`);
  } else {
    if (l.offer_sent_at) p.push(`הצעה ${fmtDate(l.offer_sent_at)}`);
    if (l.meeting_done) p.push('פגישה ✓'); else if (l.next_meeting_at) p.push(`פגישה ${fmtDate(l.next_meeting_at)}`);
  }
  if (l.last_contact) {
    const d = l.last_contact.direction === 'inbound' && l.last_contact.kind !== 'note' ? 'הלקוח כתב' : 'קשר';
    p.push(`${d} ${agoText(l.days_since_contact)}`);
  } else p.push('אין קשר מתועד');
  if (l.deal_value > 0) p.push(fmtK(l.deal_value));
  return p.join(' · ');
}

function buildDayOpenerText(plan, baseUrl, scopeLabel = '') {
  const c = plan.counts;
  const head = [
    `☀️ פתיחת יום — שרביה · ${israelDayName()} ${fmtDate(new Date())}`,
    scopeLabel,
    [c.contracts ? (c.contracts === 1 ? '📝 חוזה אחד ממתין' : `📝 ${c.contracts} חוזים ממתינים`) : null,
     c.nearEvents ? (c.nearEvents === 1 ? '📅 אירוע אחד ב-60 יום' : `📅 ${c.nearEvents} אירועים ב-60 יום`) : null,
     c.waiting ? (c.waiting === 1 ? '⏳ פעולה אחת ממתינה לנו' : `⏳ ${c.waiting} ממתינים לפעולה שלנו`) : null].filter(Boolean).join(' · '),
    `הרשימה המלאה עם הסיבות: ${baseUrl}/sales-worklist`,
  ].filter(Boolean).join('\n');

  const blocks = [head];
  const S = plan.sections;
  const link = l => `${baseUrl}/?lead=${l.lead_id}`;
  const render = (key, list, lineFn) => {
    if (!list.length) return;
    const lines = [`*${SECTION_TITLES[key]}* (${list.length + (plan.more[key] || 0)})`];
    list.forEach((l, i) => lines.push(`${i + 1}. *${l.name || 'ללא שם'}*${l.rep && scopeLabel === 'כל הנציגים' ? ` · ${l.rep}` : ''} · ${lineFn(l)}\n${link(l)}`));
    if (plan.more[key]) lines.push(`… ועוד ${plan.more[key]} במסך`);
    blocks.push(lines.join('\n'));
  };
  render('contracts',  S.contracts,  l => factLine(l, 'contracts'));
  render('nearEvents', S.nearEvents, l => factLine(l, 'nearEvents'));
  render('engaged',    S.engaged,    l => `${factLine(l, 'engaged')} · ציון ${l.engagement}`);
  render('waiting',    S.waiting,    l => l.waiting[0].text + (l.waiting.length > 1 ? ` (+${l.waiting.length - 1} במסך)` : ''));
  render('bigDeals',   S.bigDeals,   l => [
    l.event_type, l.event_date ? `אירוע ${fmtDate(l.event_date)}` : null,
    `${fmtK(l.deal_value)}${l.expected_profit != null ? ` · רווח צפוי ${fmtK(l.expected_profit)}` : ' · אין הערכת עלויות'}`,
    l.also_in ? `(${SECTION_TITLES[l.also_in].slice(3)})` : null,
  ].filter(Boolean).join(' · '));
  return blocks.join('\n\n');
}

module.exports = { buildDayPlan, buildDayOpenerText, NEAR_EVENT_DAYS, ENGAGED_MIN, WEIGHTS, LIMITS, fmtDateY };
