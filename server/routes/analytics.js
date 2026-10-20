const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');

// GET /api/analytics/overview?from=YYYY-MM-DD&to=YYYY-MM-DD
// from/to are optional; when both are present, lead-based stats are limited to
// leads created within the range. Absent = all-time (original behavior).
router.get('/overview', async (req, res) => {
  const { from, to } = req.query;
  const ranged = !!(from && to);
  const params = ranged ? [from, to] : [];
  const wDate  = ranged ? 'WHERE created_at::date BETWEEN $1::date AND $2::date' : '';
  const aDate  = ranged ? 'AND created_at::date BETWEEN $1::date AND $2::date'    : '';
  const jDate  = ranged ? 'AND l.created_at::date BETWEEN $1::date AND $2::date'  : '';
  // Range predicates for the sales-activity funnel, on each table's own date column
  const poCreated = ranged ? 'WHERE created_at::date BETWEEN $1::date AND $2::date' : '';
  const ctCreated = ranged ? 'WHERE created_at::date BETWEEN $1::date AND $2::date' : '';
  // Qualified variants for joined contexts (created_at is ambiguous once joined to leads)
  const poCreatedQ = ranged ? 'WHERE po.created_at::date BETWEEN $1::date AND $2::date' : '';
  const ctCreatedQ = ranged ? 'WHERE ct.created_at::date BETWEEN $1::date AND $2::date' : '';
  const ctSigned  = ranged ? "AND signed_at::date BETWEEN $1::date AND $2::date"    : '';
  const closedRange = ranged ? 'WHERE close_date::date BETWEEN $1::date AND $2::date' : '';
  const lostRange   = ranged ? 'WHERE lost_date::date BETWEEN $1::date AND $2::date'  : '';

  // A closing is dated by its close_date (signed contract, else the deposit
  // stage-change note) — identical to the Profit page, so counts agree there.
  const CLOSED_CTE = `
    signed AS (
      SELECT lead_id, MIN(signed_at) AS close_date
      FROM contracts WHERE status = 'signed' GROUP BY lead_id
    ),
    deposit_note AS (
      SELECT lead_id, MIN(created_at) AS close_date
      FROM lead_interactions
      WHERE type = 'note' AND body LIKE '%שינוי שלב%' AND body LIKE '%← התקבלה מקדמה'
      GROUP BY lead_id
    ),
    closed AS (
      SELECT l.id AS lead_id, COALESCE(s.close_date, dn.close_date) AS close_date
      FROM leads l
      LEFT JOIN signed s        ON s.lead_id  = l.id
      LEFT JOIN deposit_note dn ON dn.lead_id = l.id
      WHERE COALESCE(s.close_date, dn.close_date) IS NOT NULL
        AND (s.lead_id IS NOT NULL OR l.stage IN ('deposit','production','completed'))
    )`;

  try {
    const [
      totalLeads,
      activity,
      bySource,
      byMonth,
      staffPerf,
      lostReasons,
      avgTimeInStage,
    ] = await Promise.all([

      // Period totals — received by created_at; closed/lost by when they HAPPENED
      // (close date / lost stage-change note), active = this period's inflow still open
      pool.query(`
        WITH ${CLOSED_CTE},
        lost_note AS (
          SELECT lead_id, MIN(created_at) AS lost_date
          FROM lead_interactions
          WHERE type = 'note' AND body LIKE '%שינוי שלב%' AND body LIKE '%← אבוד'
          GROUP BY lead_id
        )
        SELECT
          (SELECT COUNT(*) FROM leads ${wDate}) AS total,
          (SELECT COUNT(*) FROM closed ${closedRange}) AS closed,
          (SELECT COUNT(*) FROM lost_note ${lostRange}) AS lost,
          (SELECT COUNT(*) FROM leads WHERE stage NOT IN ('deposit','production','completed','lost') ${aDate}) AS active
      `, params),

      // Sales-activity funnel — distinct leads (a lead with multiple offers/contracts counts once)
      pool.query(`
        SELECT
          (SELECT COUNT(DISTINCT lead_id) FROM price_offers ${poCreated}) AS offers_sent,
          (SELECT COUNT(DISTINCT lead_id) FROM contracts ${ctCreated}) AS contracts_sent,
          (SELECT COUNT(DISTINCT lead_id) FROM contracts WHERE status = 'signed' ${ctSigned}) AS contracts_signed
      `, params),

      // By source — period activity attributed to each lead's source, so every
      // column sums to its top-line counterpart (closings counted by close_date)
      pool.query(`
        WITH ${CLOSED_CTE},
        recv AS (SELECT source, COUNT(*) c FROM leads ${wDate} GROUP BY source),
        off  AS (SELECT l.source, COUNT(DISTINCT po.lead_id) c
                 FROM price_offers po JOIN leads l ON l.id = po.lead_id ${poCreatedQ} GROUP BY l.source),
        con  AS (SELECT l.source, COUNT(DISTINCT ct.lead_id) c
                 FROM contracts ct JOIN leads l ON l.id = ct.lead_id ${ctCreatedQ} GROUP BY l.source),
        cls  AS (SELECT l.source, COUNT(*) c
                 FROM closed cl JOIN leads l ON l.id = cl.lead_id ${closedRange} GROUP BY l.source),
        srcs AS (
          SELECT source FROM recv UNION SELECT source FROM off
          UNION SELECT source FROM con UNION SELECT source FROM cls
        )
        SELECT s.source,
               COALESCE(recv.c, 0) AS count,
               COALESCE(off.c, 0)  AS offers,
               COALESCE(con.c, 0)  AS contracts,
               COALESCE(cls.c, 0)  AS closed
        FROM srcs s
        LEFT JOIN recv ON recv.source = s.source
        LEFT JOIN off  ON off.source  = s.source
        LEFT JOIN con  ON con.source  = s.source
        LEFT JOIN cls  ON cls.source  = s.source
        ORDER BY count DESC, closed DESC
      `, params),

      // Leads per month (last 6 months, fixed window): gray = leads received that
      // month (created_at); purple = closings that month (by close_date)
      pool.query(`
        WITH ${CLOSED_CTE},
        months AS (
          SELECT generate_series(
            DATE_TRUNC('month', NOW()) - INTERVAL '5 months',
            DATE_TRUNC('month', NOW()),
            INTERVAL '1 month'
          ) AS m
        ),
        inflow AS (
          SELECT DATE_TRUNC('month', created_at) AS m, COUNT(*) AS total
          FROM leads WHERE created_at > NOW() - INTERVAL '6 months' GROUP BY 1
        ),
        closed_by_month AS (
          SELECT DATE_TRUNC('month', close_date) AS m, COUNT(*) AS won
          FROM closed WHERE close_date > NOW() - INTERVAL '6 months' GROUP BY 1
        )
        SELECT TO_CHAR(months.m, 'MM/YYYY') AS month,
               COALESCE(inflow.total, 0) AS total,
               COALESCE(closed_by_month.won, 0) AS won
        FROM months
        LEFT JOIN inflow          ON inflow.m = months.m
        LEFT JOIN closed_by_month ON closed_by_month.m = months.m
        ORDER BY months.m
      `),

      // Staff performance
      pool.query(`
        SELECT u.display_name, COUNT(l.id) AS total,
               COUNT(l.id) FILTER (WHERE l.stage IN ('deposit','production','completed')) AS won,
               COUNT(l.id) FILTER (WHERE l.stage = 'lost') AS lost
        FROM users u
        LEFT JOIN leads l ON l.assigned_to = u.id ${jDate}
        WHERE u.role IN ('admin','sales') AND NOT COALESCE(u.blocked, false)
        GROUP BY u.id, u.display_name
        ORDER BY total DESC
      `, params),

      // Lost reasons
      pool.query(`
        SELECT lost_reason, COUNT(*) AS count
        FROM leads WHERE stage = 'lost' AND lost_reason IS NOT NULL ${aDate}
        GROUP BY lost_reason ORDER BY count DESC
      `, params),

      // Average days in each stage (based on updated_at vs created_at as rough proxy)
      pool.query(`
        SELECT stage,
               ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400), 1) AS avg_days
        FROM leads
        WHERE stage != 'new' ${aDate}
        GROUP BY stage
      `, params),
    ]);

    res.json({
      overview:      totalLeads.rows[0],
      activity:      activity.rows[0],
      bySource:      bySource.rows,
      byMonth:       byMonth.rows,
      staffPerf:     staffPerf.rows,
      lostReasons:   lostReasons.rows,
      avgTimeInStage: avgTimeInStage.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const METRIC_KEYS = [
  'calls_made', 'call_minutes', 'calls_documented', 'meetings_booked', 'meetings_done', 'meetings_documented',
  'notes', 'wa_sent', 'tasks_created', 'tasks_completed', 'leads_created', 'files_uploaded',
];
const SESSION_GAP_SEC = 2 * 60 * 60; // a gap > 2h ends a work session

// Sum the spans (last−first) of each session, splitting on idle gaps > 2h.
function sessionSeconds(epochs) {
  if (!epochs.length) return 0;
  epochs.sort((a, b) => a - b);
  let total = 0, start = epochs[0], prev = epochs[0];
  for (let i = 1; i < epochs.length; i++) {
    if (epochs[i] - prev > SESSION_GAP_SEC) { total += prev - start; start = epochs[i]; }
    prev = epochs[i];
  }
  return total + (prev - start);
}

// GET /api/analytics/employee-activity?from=YYYY-MM-DD&to=YYYY-MM-DD  (date= also accepted)
// Returns per-user range summary + per-day breakdown, including "connected hours"
// computed from presence heartbeats (tracked) or, for days without heartbeat data,
// estimated from action timestamps with 2h session-gap splitting.
// Shared by the managers' ניהול table and each user's own "הפעילות שלי" page (onlyUid).
async function computeEmployeeActivity(from, to, onlyUid = null) {
    const params = [from, to];

    // Per (user, day, metric) counts.
    const metricsQ = pool.query(`
      SELECT uid, to_char(d, 'YYYY-MM-DD') AS day, metric, COALESCE(SUM(w), 0)::int AS cnt
      FROM (
        -- Answered outbound calls from the system (Twilio): status completed and the customer actually
        -- picked up (duration > 0). Unanswered dials, busy, failed and tel:-link taps are not counted.
        SELECT user_id AS uid, (started_at AT TIME ZONE 'Asia/Jerusalem')::date AS d, 'calls_made'::text AS metric, 1 AS w
          FROM calls WHERE user_id IS NOT NULL AND direction='outbound' AND status='completed' AND COALESCE(duration_sec,0) > 0
        UNION ALL
        -- Talk time: minutes on answered calls (outbound by the dialer, inbound by whoever answered), rounded per call
        SELECT COALESCE(answered_by, user_id), (started_at AT TIME ZONE 'Asia/Jerusalem')::date, 'call_minutes', GREATEST(1, ROUND(duration_sec / 60.0))::int
          FROM calls WHERE COALESCE(answered_by, user_id) IS NOT NULL AND status='completed' AND COALESCE(duration_sec,0) > 0
        UNION ALL
        SELECT created_by, (created_at AT TIME ZONE 'Asia/Jerusalem')::date, 'calls_documented', 1
          FROM lead_interactions WHERE created_by IS NOT NULL AND type='call' AND direction='outbound' AND (source IS NULL OR source NOT IN ('dial','twilio'))
        UNION ALL
        -- Meetings held (Oran's rule, 2026-10-19): a calendar meeting hosted by the user that already
        -- started, not declined by the customer, AND a meeting summary the user wrote on that lead
        -- (type='meeting', not the booking note) from an hour before to 3 days after the start.
        -- Counted on the meeting day. (Until 2026-10-19 this counted the "📅 פגישה נקבעה" booking
        -- note, i.e. bookings, so it always equalled meetings_booked.)
        SELECT m.host_user_id, (m.start_time AT TIME ZONE 'Asia/Jerusalem')::date, 'meetings_done', 1
          FROM meetings m
         WHERE m.host_user_id IS NOT NULL AND m.lead_id IS NOT NULL AND m.start_time < NOW()
           AND COALESCE(m.customer_status, '') <> 'declined'
           AND EXISTS (SELECT 1 FROM lead_interactions li
                        WHERE li.lead_id = m.lead_id AND li.type = 'meeting' AND li.created_by = m.host_user_id
                          AND (li.source IS NULL OR li.source <> 'calendar')
                          AND li.created_at BETWEEN m.start_time - INTERVAL '1 hour' AND m.start_time + INTERVAL '3 days')
        UNION ALL
        SELECT created_by, (created_at AT TIME ZONE 'Asia/Jerusalem')::date, 'meetings_documented', 1
          FROM lead_interactions WHERE created_by IS NOT NULL AND type='meeting' AND (source IS NULL OR source<>'calendar')
        UNION ALL
        SELECT booked_by, (created_at AT TIME ZONE 'Asia/Jerusalem')::date, 'meetings_booked', 1
          FROM meetings WHERE booked_by IS NOT NULL
        UNION ALL
        SELECT created_by, (created_at AT TIME ZONE 'Asia/Jerusalem')::date, 'notes', 1
          FROM lead_interactions WHERE created_by IS NOT NULL AND type='note'
        UNION ALL
        SELECT sent_by, (timestamp AT TIME ZONE 'Asia/Jerusalem')::date, 'wa_sent', 1
          FROM messages WHERE sent_by IS NOT NULL AND direction='outbound'
        UNION ALL
        SELECT created_by, (created_at AT TIME ZONE 'Asia/Jerusalem')::date, 'tasks_created', 1
          FROM tasks WHERE created_by IS NOT NULL
        UNION ALL
        SELECT assigned_to, (completed_at AT TIME ZONE 'Asia/Jerusalem')::date, 'tasks_completed', 1
          FROM tasks WHERE assigned_to IS NOT NULL AND completed_at IS NOT NULL AND cancelled_at IS NULL
        UNION ALL
        SELECT created_by, (created_at AT TIME ZONE 'Asia/Jerusalem')::date, 'leads_created', 1
          FROM leads WHERE created_by IS NOT NULL
        UNION ALL
        SELECT uploaded_by, (created_at AT TIME ZONE 'Asia/Jerusalem')::date, 'files_uploaded', 1
          FROM files WHERE uploaded_by IS NOT NULL
      ) ev
      WHERE d BETWEEN $1::date AND $2::date
      GROUP BY uid, d, metric
    `, params);

    // All per-user action timestamps in range → first/last activity + estimated hours.
    const actionsQ = pool.query(`
      SELECT uid,
             to_char((ts AT TIME ZONE 'Asia/Jerusalem')::date, 'YYYY-MM-DD') AS day,
             to_char(ts AT TIME ZONE 'Asia/Jerusalem', 'HH24:MI') AS hhmm,
             EXTRACT(EPOCH FROM ts)::bigint AS epoch
      FROM (
        SELECT created_by AS uid, created_at AS ts FROM lead_interactions WHERE created_by IS NOT NULL
        UNION ALL SELECT sent_by, timestamp FROM messages WHERE sent_by IS NOT NULL AND direction='outbound'
        UNION ALL SELECT created_by, created_at FROM tasks WHERE created_by IS NOT NULL
        UNION ALL SELECT assigned_to, completed_at FROM tasks WHERE assigned_to IS NOT NULL AND completed_at IS NOT NULL
        UNION ALL SELECT uploaded_by, created_at FROM files WHERE uploaded_by IS NOT NULL
        UNION ALL SELECT created_by, created_at FROM leads WHERE created_by IS NOT NULL
        UNION ALL SELECT created_by, created_at FROM supplier_interactions WHERE created_by IS NOT NULL
        UNION ALL SELECT created_by, created_at FROM op_activity_log WHERE created_by IS NOT NULL
        UNION ALL SELECT created_by, created_at FROM calendar_events WHERE created_by IS NOT NULL
        UNION ALL SELECT checked_by, checked_at FROM production_checklist WHERE checked_by IS NOT NULL
        UNION ALL SELECT updated_by, updated_at FROM event_briefs WHERE updated_by IS NOT NULL
        UNION ALL SELECT created_by, created_at FROM contracts WHERE created_by IS NOT NULL
      ) e
      WHERE ts IS NOT NULL AND (ts AT TIME ZONE 'Asia/Jerusalem')::date BETWEEN $1::date AND $2::date
      ORDER BY uid, epoch
    `, params);

    // Presence heartbeat sessions overlapping range (bucketed by start day).
    const sessionsQ = pool.query(`
      SELECT user_id AS uid,
             to_char((started_at AT TIME ZONE 'Asia/Jerusalem')::date, 'YYYY-MM-DD') AS day,
             EXTRACT(EPOCH FROM started_at)::bigint   AS start_epoch,
             EXTRACT(EPOCH FROM last_ping_at)::bigint AS end_epoch
      FROM user_sessions
      WHERE (started_at AT TIME ZONE 'Asia/Jerusalem')::date BETWEEN $1::date AND $2::date
    `, params);

    const usersQ = onlyUid
      ? pool.query(`SELECT id, display_name, role FROM users WHERE id = $1`, [onlyUid])
      : pool.query(`
      SELECT id, display_name, role FROM users
      WHERE role IN ('admin','manager','sales','production') AND NOT COALESCE(blocked, false) ORDER BY display_name
    `);

    const [metrics, actions, sessions, users] = await Promise.all([metricsQ, actionsQ, sessionsQ, usersQ]);

    // day map per user: uid -> day -> { metrics..., first_activity, last_activity, hours, hours_source }
    const byUser = new Map();
    const dayOf = (uid, day) => {
      if (!byUser.has(uid)) byUser.set(uid, new Map());
      const days = byUser.get(uid);
      if (!days.has(day)) {
        const o = { date: day, first_activity: null, last_activity: null, hours: 0, hours_source: null };
        METRIC_KEYS.forEach(k => { o[k] = 0; });
        days.set(day, o);
      }
      return days.get(day);
    };

    metrics.rows.forEach(r => { dayOf(r.uid, r.day)[r.metric] = r.cnt; });

    // first/last activity + estimated session hours from action timestamps.
    const actByUserDay = new Map(); // "uid|day" -> { epochs:[], first, last }
    actions.rows.forEach(r => {
      const key = `${r.uid}|${r.day}`;
      if (!actByUserDay.has(key)) actByUserDay.set(key, { uid: r.uid, day: r.day, epochs: [], first: r.hhmm, last: r.hhmm });
      const a = actByUserDay.get(key);
      a.epochs.push(Number(r.epoch));
      a.last = r.hhmm; // rows ordered by epoch asc
    });
    actByUserDay.forEach(a => {
      const d = dayOf(a.uid, a.day);
      d.first_activity = a.first;
      d.last_activity  = a.last;
      d.estimated_hours = sessionSeconds(a.epochs) / 3600;
    });

    // tracked hours from heartbeat sessions (also create the day so presence-only
    // days — user connected but logged no actions — still show up).
    const hbByUserDay = new Map(); // "uid|day" -> seconds
    sessions.rows.forEach(r => {
      dayOf(r.uid, r.day);
      const key = `${r.uid}|${r.day}`;
      hbByUserDay.set(key, (hbByUserDay.get(key) || 0) + (Number(r.end_epoch) - Number(r.start_epoch)));
    });

    // resolve hours per (user, day): tracked if heartbeat exists, else estimated.
    byUser.forEach((days, uid) => {
      days.forEach((d, day) => {
        const tracked = hbByUserDay.get(`${uid}|${day}`);
        if (tracked != null) { d.hours = +(tracked / 3600).toFixed(2); d.hours_source = 'tracked'; }
        else { d.hours = +((d.estimated_hours || 0)).toFixed(2); d.hours_source = (d.estimated_hours ? 'estimated' : null); }
        delete d.estimated_hours;
      });
    });

    // assemble per-user response with totals.
    const result = users.rows.map(u => {
      const days = byUser.has(u.id) ? Array.from(byUser.get(u.id).values()) : [];
      days.sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
      const totals = { hours: 0 };
      METRIC_KEYS.forEach(k => { totals[k] = 0; });
      days.forEach(d => {
        METRIC_KEYS.forEach(k => { totals[k] += d[k]; });
        totals.hours += d.hours;
      });
      totals.hours = +totals.hours.toFixed(2);
      return { id: u.id, display_name: u.display_name, role: u.role, totals, days };
    });
    return result;
}

router.get('/employee-activity', async (req, res) => {
  const roles = req.user.roles || [req.user.role];
  if (!roles.some(r => ['admin', 'manager'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
  try {
    const today = new Date().toISOString().slice(0, 10);
    const from = req.query.from || req.query.date || today;
    const to   = req.query.to   || req.query.date || from;
    res.json(await computeEmployeeActivity(from, to));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Who a "my-activity" request is about: the caller, or ?user=<id> for managers (Phase 55).
function activityUser(req, res) {
  const asked = Number(req.query.user || 0);
  if (!asked || asked === req.user.id) return req.user.id;
  const roles = req.user.roles || [req.user.role];
  if (!roles.some(r => ['admin', 'manager', 'sales_manager'].includes(r))) { res.status(403).json({ error: 'Forbidden' }); return null; }
  return asked;
}

// GET /api/analytics/my-activity?from&to[&user=] — the signed-in user's own row (any role)
router.get('/my-activity', async (req, res) => {
  const uid = activityUser(req, res); if (!uid) return;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const from = req.query.from || today;
    const to   = req.query.to   || from;
    const [row] = await computeEmployeeActivity(from, to, uid);
    res.json(row || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/employee-activity/:uid/leads?from=YYYY-MM-DD&to=YYYY-MM-DD
// Phase 51: what one employee did with which customers. Per day (newest first) → per lead
// (latest touch first): answered-call count + minutes, unanswered attempts, and the actions of
// that day (meeting booked, offer, contract, WhatsApp, note, task, file, lead created), plus
// the stage transition of the day (from lead_stage_history; older days fall back to the
// "🔄 שינוי שלב" timeline notes) and the lead's current stage.
async function computeLeadActivity(uid, from, to) {
    const { rows } = await pool.query(`
      WITH ev AS (
        -- answered calls (outbound by the dialer, inbound by whoever picked up)
        SELECT lead_id, started_at AS ts, 'call' AS kind,
               jsonb_build_object('min', GREATEST(1, ROUND(duration_sec / 60.0))::int, 'summary', summary, 'direction', direction) AS data
          FROM calls WHERE COALESCE(answered_by, user_id) = $1 AND lead_id IS NOT NULL
                       AND status = 'completed' AND COALESCE(duration_sec, 0) > 0
        UNION ALL
        -- dials that never became a conversation
        SELECT lead_id, started_at, 'call_attempt', '{}'::jsonb
          FROM calls WHERE user_id = $1 AND direction = 'outbound' AND lead_id IS NOT NULL
                       AND NOT (status = 'completed' AND COALESCE(duration_sec, 0) > 0)
                       AND status NOT IN ('initiated', 'ringing', 'in-progress')
        UNION ALL
        SELECT lead_id, created_at, 'call_attempt', '{}'::jsonb
          FROM lead_interactions WHERE created_by = $1 AND type = 'call_attempt'
        UNION ALL
        -- calls documented by hand (not the dialer's own log)
        SELECT lead_id, created_at, 'call_doc', jsonb_build_object('body', body)
          FROM lead_interactions WHERE created_by = $1 AND type = 'call' AND (source IS NULL OR source NOT IN ('dial', 'twilio'))
        UNION ALL
        SELECT lead_id, created_at, 'meeting_booked', jsonb_build_object('start', start_time)
          FROM meetings WHERE booked_by = $1 AND lead_id IS NOT NULL
        UNION ALL
        -- meetings held: on the calendar (host = this user), already started, customer did not decline.
        -- "documented" = the user wrote a meeting summary on the lead from an hour before the meeting
        -- up to 3 days after; only then does it count as really held (Oran's rule, 2026-10-19).
        SELECT m.lead_id, m.start_time, 'meeting_held',
               jsonb_build_object(
                 'min', GREATEST(1, ROUND(EXTRACT(EPOCH FROM (COALESCE(m.end_time, m.start_time + INTERVAL '1 hour') - m.start_time)) / 60))::int,
                 'documented', EXISTS (
                   SELECT 1 FROM lead_interactions li
                    WHERE li.lead_id = m.lead_id AND li.type = 'meeting' AND li.created_by = $1
                      AND (li.source IS NULL OR li.source <> 'calendar')
                      AND li.created_at BETWEEN m.start_time - INTERVAL '1 hour' AND m.start_time + INTERVAL '3 days'))
          FROM meetings m
         WHERE m.host_user_id = $1 AND m.lead_id IS NOT NULL AND m.start_time < NOW()
           AND COALESCE(m.customer_status, '') <> 'declined'
        UNION ALL
        -- meeting summaries written by hand. (type='meeting' with source='calendar' is the
        -- "📅 פגישה נקבעה" note the booking writes — that is a booking, already covered by
        -- meeting_booked above, so it is excluded here.)
        SELECT lead_id, created_at, 'meeting_doc', jsonb_build_object('body', body)
          FROM lead_interactions WHERE created_by = $1 AND type = 'meeting' AND (source IS NULL OR source <> 'calendar')
        UNION ALL
        SELECT lead_id, created_at, 'note', jsonb_build_object('body', body)
          FROM lead_interactions WHERE created_by = $1 AND type = 'note' AND COALESCE(body, '') NOT LIKE '🔄 שינוי שלב%'
        UNION ALL
        SELECT lead_id, timestamp, 'wa', '{}'::jsonb
          FROM messages WHERE sent_by = $1 AND direction = 'outbound' AND lead_id IS NOT NULL
        UNION ALL
        SELECT lead_id, created_at, 'offer', jsonb_build_object('type', offer_type)
          FROM price_offers WHERE created_by = $1
        UNION ALL
        SELECT lead_id, created_at, 'contract', jsonb_build_object('status', status, 'signed', signed_at IS NOT NULL)
          FROM contracts WHERE created_by = $1
        UNION ALL
        SELECT lead_id, created_at, 'task', jsonb_build_object('title', title)
          FROM tasks WHERE created_by = $1 AND lead_id IS NOT NULL
        UNION ALL
        SELECT lead_id, created_at, 'file', jsonb_build_object('name', filename)
          FROM files WHERE uploaded_by = $1 AND lead_id IS NOT NULL
        UNION ALL
        SELECT id, created_at, 'lead_created', '{}'::jsonb
          FROM leads WHERE created_by = $1
        UNION ALL
        SELECT lead_id, created_at, 'stage', jsonb_build_object('from', from_stage, 'to', to_stage)
          FROM lead_stage_history WHERE changed_by = $1
        UNION ALL
        -- before lead_stage_history existed the only trace was the timeline note
        SELECT lead_id, created_at, 'stage_note', jsonb_build_object('body', body)
          FROM lead_interactions
         WHERE created_by = $1 AND type = 'note' AND body LIKE '🔄 שינוי שלב%'
           AND created_at < (SELECT COALESCE(MIN(created_at), NOW()) FROM lead_stage_history)
      )
      SELECT ev.lead_id, ev.kind, ev.data,
             to_char((ev.ts AT TIME ZONE 'Asia/Jerusalem')::date, 'YYYY-MM-DD') AS day,
             to_char(ev.ts AT TIME ZONE 'Asia/Jerusalem', 'HH24:MI') AS hhmm,
             EXTRACT(EPOCH FROM ev.ts)::bigint AS epoch,
             l.name AS lead_name, l.stage AS current_stage
      FROM ev JOIN leads l ON l.id = ev.lead_id
      WHERE ev.ts IS NOT NULL AND (ev.ts AT TIME ZONE 'Asia/Jerusalem')::date BETWEEN $2::date AND $3::date
      ORDER BY ev.ts DESC
    `, [uid, from, to]);

    // day → lead → summary line
    const days = new Map();
    rows.forEach(r => {
      if (!days.has(r.day)) days.set(r.day, new Map());
      const leads = days.get(r.day);
      if (!leads.has(r.lead_id)) {
        leads.set(r.lead_id, {
          lead_id: r.lead_id, name: r.lead_name, current_stage: r.current_stage,
          last_epoch: Number(r.epoch), last_time: r.hhmm,
          calls: 0, minutes: 0, attempts: 0, call_summary: null, call_doc: null,
          meetings_held: 0, meeting_minutes: 0, meetings_undocumented: 0,
          stage_from: null, stage_to: null, stage_text: null,
          actions: [],   // chronological chips: { kind, time, ...details }
        });
      }
      const L = leads.get(r.lead_id);
      const d = r.data || {};
      switch (r.kind) {
        case 'call':
          L.calls += 1; L.minutes += Number(d.min || 0);
          if (!L.call_summary && d.summary) L.call_summary = d.summary; // rows are newest first → latest summary wins
          break;
        case 'call_attempt': L.attempts += 1; break;
        case 'meeting_held':
          if (d.documented) { L.meetings_held += 1; L.meeting_minutes += Number(d.min || 0); }
          else L.meetings_undocumented += 1;
          break;
        case 'call_doc':
          if (!L.call_doc && d.body) L.call_doc = d.body;
          L.actions.push({ kind: 'call_doc', time: r.hhmm, epoch: Number(r.epoch) });
          break;
        case 'stage':
          // newest first: the last row seen is the earliest change of the day → its "from"
          if (!L.stage_to) L.stage_to = d.to;
          L.stage_from = d.from;
          break;
        case 'stage_note':
          if (!L.stage_text) L.stage_text = String(d.body || '').replace(/^🔄 שינוי שלב:\s*/, '');
          break;
        default:
          L.actions.push({ kind: r.kind, time: r.hhmm, epoch: Number(r.epoch), ...d });
      }
    });

    const result = Array.from(days.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, leads]) => ({
        date: day,
        leads: Array.from(leads.values())
          .sort((a, b) => b.last_epoch - a.last_epoch)
          .map(L => ({ ...L, actions: L.actions.sort((a, b) => a.epoch - b.epoch) })),
      }));
    return result;
}

router.get('/employee-activity/:uid/leads', async (req, res) => {
  const roles = req.user.roles || [req.user.role];
  if (!roles.some(r => ['admin', 'manager'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
  const uid = Number(req.params.uid);
  if (!uid) return res.status(400).json({ error: 'bad user id' });
  try {
    const today = new Date().toISOString().slice(0, 10);
    const from = req.query.from || today;
    const to   = req.query.to   || from;
    res.json(await computeLeadActivity(uid, from, to));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/my-activity/leads?from&to — the signed-in user's own customer lines
router.get('/my-activity/leads', async (req, res) => {
  const uid = activityUser(req, res); if (!uid) return;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const from = req.query.from || today;
    const to   = req.query.to   || from;
    res.json(await computeLeadActivity(uid, from, to));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
