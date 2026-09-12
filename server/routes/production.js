const router = require('express').Router();
const { getUnreadyEvents } = require('../services/eventReadiness');
const { buildProductionBriefing, buildCloseReminderText } = require('../services/productionBriefingService');

const MANAGER_ROLES = ['admin', 'manager'];
function userRoles(u) { return u?.roles?.length ? u.roles : (u?.role ? [u.role] : []); }
function canSee(u) {
  const r = userRoles(u);
  return r.some(x => MANAGER_ROLES.includes(x) || x === 'production');
}

// GET /api/production/unready-events?days=7 — events in the next N days with something still open.
// Visible to production users and managers (everyone's events).
router.get('/unready-events', async (req, res) => {
  if (!canSee(req.user)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 60);
    const events = await getUnreadyEvents({ withinDays: days });
    res.json({ count: events.length, events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/production/briefing-preview?kind=morning|close — the WhatsApp text, nothing sent
router.get('/briefing-preview', async (req, res) => {
  if (!canSee(req.user)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const baseUrl = process.env.SERVER_URL || 'https://www.proevent.co.il';
    const kind = req.query.kind === 'close' ? 'close' : 'morning';
    const text = kind === 'close'
      ? await buildCloseReminderText({ baseUrl })
      : await buildProductionBriefing({ userId: req.user.id, baseUrl });
    res.json({ kind, text: text || '(אין מה לשלוח היום)' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
