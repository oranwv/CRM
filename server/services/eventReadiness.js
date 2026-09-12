// Production readiness — what is still open on upcoming / past events.
// Shared by the header badge (/api/production/unready-events), the production
// WhatsApp briefing and the "event ended, close it" reminder.
const pool = require('../db/pool');
const { ITEMS: CHECKLIST_ITEMS } = require('../routes/productionChecklist');

const IL = 'Asia/Jerusalem';
const ACTIVE_STAGES = ['deposit', 'production'];

// Today's date in Israel as YYYY-MM-DD
function israelToday() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: IL, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return `${p.find(x => x.type === 'year').value}-${p.find(x => x.type === 'month').value}-${p.find(x => x.type === 'day').value}`;
}

// leads.event_date is a DATE column; pg gives it back as a Date at server-local midnight,
// so format it in the server's own zone (not Israel) to get the stored calendar day back.
function eventDateStr(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function daysBetween(fromStr, toStr) {
  const a = new Date(`${fromStr}T00:00:00Z`), b = new Date(`${toStr}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

const MISSING_LABELS = {
  brief:              'בריף אירוע לא מלא',
  checklist:          'צ\'קליסט הפקה לא הושלם',
  deposit:            'מקדמה לא אושרה',
  production_manager: 'אין אחראי הפקה',
  full_payment:       'תשלום מלא לא אושר',
};

// Leads in deposit/production with an event date in [today, today + withinDays].
// Each row: lead fields + days_until + missing[] (keys of MISSING_LABELS) + missing_labels[].
// opts.productionManagerId limits to that person's events (null = everyone's).
async function getUnreadyEvents({ withinDays = 7, productionManagerId = null } = {}) {
  const today = israelToday();
  const { rows } = await pool.query(`
    SELECT l.id, l.name, l.event_type, l.event_date, l.event_time, l.guest_count, l.stage,
           l.deposit_confirmed, l.production_manager_id,
           pm.display_name AS production_manager_name,
           (SELECT COUNT(*) FROM event_briefs eb WHERE eb.lead_id = l.id AND eb.data::text <> '{}') AS brief_count,
           (SELECT COUNT(*) FROM production_checklist pc WHERE pc.lead_id = l.id AND pc.checked_at IS NOT NULL) AS checked_count
    FROM leads l
    LEFT JOIN users pm ON pm.id = l.production_manager_id
    WHERE l.stage = ANY($1::text[])
      AND l.event_date IS NOT NULL
      AND l.event_date BETWEEN $2::date AND ($2::date + $3::int)
      AND ($4::int IS NULL OR l.production_manager_id = $4)
    ORDER BY l.event_date ASC
  `, [ACTIVE_STAGES, today, withinDays, productionManagerId]);

  const out = [];
  for (const r of rows) {
    const missing = [];
    if (Number(r.brief_count) === 0)                          missing.push('brief');
    if (Number(r.checked_count) < CHECKLIST_ITEMS.length)     missing.push('checklist');
    if (!r.deposit_confirmed)                                 missing.push('deposit');
    if (!r.production_manager_id)                             missing.push('production_manager');
    if (!missing.length) continue;
    const ds = eventDateStr(r.event_date);
    out.push({
      ...r,
      event_date_str: ds,
      days_until: daysBetween(today, ds),
      missing,
      missing_labels: missing.map(k => MISSING_LABELS[k]),
    });
  }
  return out;
}

// Events whose date has passed but the lead is still in deposit/production
// (i.e. nobody moved it to "אירוע הסתיים והתקבל תשלום").
async function getPastUnclosedEvents({ productionManagerId = null } = {}) {
  const today = israelToday();
  const { rows } = await pool.query(`
    SELECT l.id, l.name, l.event_type, l.event_date, l.stage,
           l.full_payment_confirmed, l.full_payment_amount, l.production_manager_id,
           pm.display_name AS production_manager_name, pm.phone AS production_manager_phone
    FROM leads l
    LEFT JOIN users pm ON pm.id = l.production_manager_id
    WHERE l.stage = ANY($1::text[])
      AND l.event_date IS NOT NULL
      AND l.event_date < $2::date
      AND ($3::int IS NULL OR l.production_manager_id = $3)
    ORDER BY l.event_date ASC
  `, [ACTIVE_STAGES, today, productionManagerId]);
  return rows.map(r => {
    const ds = eventDateStr(r.event_date);
    return { ...r, event_date_str: ds, days_since: daysBetween(ds, today) };
  });
}

// Deposits not confirmed (any active event) + full payments not confirmed (event already happened)
async function getUnconfirmedPayments({ productionManagerId = null } = {}) {
  const today = israelToday();
  const { rows } = await pool.query(`
    SELECT l.id, l.name, l.event_type, l.event_date,
           l.deposit_amount, l.deposit_confirmed, l.full_payment_amount, l.full_payment_confirmed,
           pm.display_name AS production_manager_name
    FROM leads l
    LEFT JOIN users pm ON pm.id = l.production_manager_id
    WHERE l.stage = ANY($1::text[])
      AND l.event_date IS NOT NULL
      AND ($2::int IS NULL OR l.production_manager_id = $2)
      AND (NOT COALESCE(l.deposit_confirmed, false)
           OR (NOT COALESCE(l.full_payment_confirmed, false)
               AND l.event_date < $3::date))
    ORDER BY l.event_date ASC
  `, [ACTIVE_STAGES, productionManagerId, today]);
  return rows.map(r => {
    const ds = eventDateStr(r.event_date);
    const items = [];
    if (!r.deposit_confirmed) items.push('deposit');
    if (!r.full_payment_confirmed && ds < today) items.push('full_payment');
    return { ...r, event_date_str: ds, items, item_labels: items.map(k => MISSING_LABELS[k]) };
  });
}

// Open production tasks due today or overdue. assignedTo = one user, or null for everyone's
// tasks on active events.
async function getOpenProductionTasks({ assignedTo = null } = {}) {
  const { rows } = await pool.query(`
    SELECT t.id, t.title, t.due_at, t.assigned_to, u.display_name AS assigned_name,
           l.id AS lead_id, l.name AS lead_name, l.event_date
    FROM tasks t
    JOIN leads l ON l.id = t.lead_id
    LEFT JOIN users u ON u.id = t.assigned_to
    WHERE t.completed_at IS NULL
      AND t.due_at IS NOT NULL
      AND (t.due_at AT TIME ZONE 'Asia/Jerusalem')::date <= $1::date
      AND l.stage = ANY($2::text[])
      AND ($3::int IS NULL OR t.assigned_to = $3)
    ORDER BY t.due_at ASC
  `, [israelToday(), [...ACTIVE_STAGES, 'completed'], assignedTo]);
  return rows;
}

module.exports = {
  getUnreadyEvents, getPastUnclosedEvents, getUnconfirmedPayments, getOpenProductionTasks,
  MISSING_LABELS, israelToday,
};
