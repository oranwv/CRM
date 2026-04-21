const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');

// GET /api/analytics/overview
router.get('/overview', async (req, res) => {
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
          COUNT(*) FILTER (WHERE stage = 'new') AS new_leads,
          COUNT(*) FILTER (WHERE stage IN ('contacted','meeting','offer_sent','negotiation','contract_sent')) AS in_process,
          COUNT(*) FILTER (WHERE stage IN ('deposit','production')) AS closed,
          COUNT(*) FILTER (WHERE stage = 'lost') AS lost,
          COUNT(*) AS total
        FROM leads
      `),

      // By stage
      pool.query(`
        SELECT stage, COUNT(*) AS count
        FROM leads GROUP BY stage ORDER BY count DESC
      `),

      // By source
      pool.query(`
        SELECT source, COUNT(*) AS count,
               COUNT(*) FILTER (WHERE stage IN ('deposit','production')) AS won
        FROM leads
        GROUP BY source ORDER BY count DESC
      `),

      // Leads per month (last 6 months)
      pool.query(`
        SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'MM/YYYY') AS month,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE stage IN ('deposit','production')) AS won
        FROM leads
        WHERE created_at > NOW() - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY DATE_TRUNC('month', created_at)
      `),

      // Staff performance
      pool.query(`
        SELECT u.display_name, COUNT(l.id) AS total,
               COUNT(l.id) FILTER (WHERE l.stage IN ('deposit','production')) AS won,
               COUNT(l.id) FILTER (WHERE l.stage = 'lost') AS lost
        FROM users u
        LEFT JOIN leads l ON l.assigned_to = u.id
        WHERE u.role IN ('admin','sales')
        GROUP BY u.id, u.display_name
        ORDER BY total DESC
      `),

      // Lost reasons
      pool.query(`
        SELECT lost_reason, COUNT(*) AS count
        FROM leads WHERE stage = 'lost' AND lost_reason IS NOT NULL
        GROUP BY lost_reason ORDER BY count DESC
      `),

      // Average days in each stage (based on updated_at vs created_at as rough proxy)
      pool.query(`
        SELECT stage,
               ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400), 1) AS avg_days
        FROM leads
        WHERE stage != 'new'
        GROUP BY stage
      `),
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

module.exports = router;
