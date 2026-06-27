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

  try {
    const [
      totalLeads,
      byStage,
      bySource,
      byMonth,
      staffPerf,
      lostReasons,
      avgTimeInStage,
    ] = await Promise.all([

      // Total leads by status group
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE stage IN ('new','new_no_answer')) AS new_leads,
          COUNT(*) FILTER (WHERE stage IN ('contacted','meeting','offer_sent','negotiation','contract_sent','process_no_answer')) AS in_process,
          COUNT(*) FILTER (WHERE stage IN ('deposit','production','completed')) AS closed,
          COUNT(*) FILTER (WHERE stage = 'lost') AS lost,
          COUNT(*) AS total
        FROM leads ${wDate}
      `, params),

      // By stage
      pool.query(`
        SELECT stage, COUNT(*) AS count
        FROM leads ${wDate} GROUP BY stage ORDER BY count DESC
      `, params),

      // By source — quality split: progressed (reached price offer or deeper)
      // and paid (deposit/production/completed)
      pool.query(`
        SELECT source, COUNT(*) AS count,
               COUNT(*) FILTER (WHERE stage IN ('offer_sent','negotiation','contract_sent','deposit','production','completed')) AS progressed,
               COUNT(*) FILTER (WHERE stage IN ('deposit','production','completed')) AS paid
        FROM leads ${wDate}
        GROUP BY source ORDER BY count DESC
      `, params),

      // Leads per month (last 6 months — own window, not range-filtered)
      pool.query(`
        SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'MM/YYYY') AS month,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE stage IN ('deposit','production','completed')) AS won
        FROM leads
        WHERE created_at > NOW() - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY DATE_TRUNC('month', created_at)
      `),

      // Staff performance
      pool.query(`
        SELECT u.display_name, COUNT(l.id) AS total,
               COUNT(l.id) FILTER (WHERE l.stage IN ('deposit','production','completed')) AS won,
               COUNT(l.id) FILTER (WHERE l.stage = 'lost') AS lost
        FROM users u
        LEFT JOIN leads l ON l.assigned_to = u.id ${jDate}
        WHERE u.role IN ('admin','sales')
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
      byStage:       byStage.rows,
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
  'calls_made', 'calls_documented', 'meetings_done', 'meetings_documented',
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
router.get('/employee-activity', async (req, res) => {
  const roles = req.user.roles || [req.user.role];
  if (!roles.some(r => ['admin', 'manager'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
  try {
    const today = new Date().toISOString().slice(0, 10);
    const from = req.query.from || req.query.date || today;
    const to   = req.query.to   || req.query.date || from;
    const params = [from, to];

    // Per (user, day, metric) counts.
    const metricsQ = pool.query(`
      SELECT uid, to_char(d, 'YYYY-MM-DD') AS day, metric, COUNT(*)::int AS cnt
      FROM (
        SELECT created_by AS uid, (created_at AT TIME ZONE 'Asia/Jerusalem')::date AS d, 'calls_made'::text AS metric
          FROM lead_interactions WHERE created_by IS NOT NULL AND type='call' AND direction='outbound' AND source='dial'
        UNION ALL
        SELECT created_by, (created_at AT TIME ZONE 'Asia/Jerusalem')::date, 'calls_documented'
          FROM lead_interactions WHERE created_by IS NOT NULL AND type='call' AND direction='outbound' AND (source IS NULL OR source<>'dial')
        UNION ALL
        SELECT created_by, (created_at AT TIME ZONE 'Asia/Jerusalem')::date, 'meetings_done'
          FROM lead_interactions WHERE created_by IS NOT NULL AND type='meeting' AND source='calendar'
        UNION ALL
        SELECT created_by, (created_at AT TIME ZONE 'Asia/Jerusalem')::date, 'meetings_documented'
          FROM lead_interactions WHERE created_by IS NOT NULL AND type='meeting' AND (source IS NULL OR source<>'calendar')
        UNION ALL
        SELECT created_by, (created_at AT TIME ZONE 'Asia/Jerusalem')::date, 'notes'
          FROM lead_interactions WHERE created_by IS NOT NULL AND type='note'
        UNION ALL
        SELECT sent_by, (timestamp AT TIME ZONE 'Asia/Jerusalem')::date, 'wa_sent'
          FROM messages WHERE sent_by IS NOT NULL AND direction='outbound'
        UNION ALL
        SELECT created_by, (created_at AT TIME ZONE 'Asia/Jerusalem')::date, 'tasks_created'
          FROM tasks WHERE created_by IS NOT NULL
        UNION ALL
        SELECT assigned_to, (completed_at AT TIME ZONE 'Asia/Jerusalem')::date, 'tasks_completed'
          FROM tasks WHERE assigned_to IS NOT NULL AND completed_at IS NOT NULL
        UNION ALL
        SELECT created_by, (created_at AT TIME ZONE 'Asia/Jerusalem')::date, 'leads_created'
          FROM leads WHERE created_by IS NOT NULL
        UNION ALL
        SELECT uploaded_by, (created_at AT TIME ZONE 'Asia/Jerusalem')::date, 'files_uploaded'
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

    const usersQ = pool.query(`
      SELECT id, display_name, role FROM users
      WHERE role IN ('admin','manager','sales','production') ORDER BY display_name
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

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
