// In-app calling over Twilio Voice.
//
//   Browser (Voice SDK)  ──►  TwiML App  ──►  POST /twiml/outbound  ──►  <Dial> the lead
//   Customer dials 03-382-3777  ──►  POST /twiml/inbound  ──►  ring plan (owner mobile →
//        owner browser → team queue in order → voicemail), one <Dial> per step, each step's
//        result comes back to POST /twiml/inbound/step
//   Twilio  ──►  POST /status (call ended)  ·  POST /recording (mp3 ready → callAnalysis)
//
// Authenticated routes (JWT) and Twilio webhooks (signature-validated) live in two routers.
const express = require('express');
const pool    = require('../db/pool');
const requireAuth = require('../middleware/auth');
const tw      = require('../services/twilioService');
const { processRecording } = require('../services/callAnalysis');
const { normalizePhone, findLeadByPhone } = require('../utils/phoneUtils');
const { sendTextToPhones } = require('../services/waOutbound');

const MOBILE_TIMEOUT = 20;   // seconds the owner's mobile rings before we move on
const CLIENT_TIMEOUT = 20;   // seconds the browser rings
const QUEUE_TIMEOUT  = 18;   // per teammate in the fallback queue
const RECORDING_ATTRS = () => ({
  record: 'record-from-answer-dual',
  recordingStatusCallback: `${tw.serverUrl()}/api/calls/recording`,
  recordingStatusCallbackEvent: 'completed',
});

const say = (vr, text) => vr.say({ language: 'he-IL', voice: tw.HE_VOICE }, text);
const xml = (res, vr) => res.type('text/xml').send(vr.toString());

// Blocked CRM users are blocked from calling too (Oran, 2026-11-14): no softphone token, no
// config, no place in the inbound ring plan — the dialer app logs itself out on this answer.
const BLOCKED_MSG = 'החשבון שלך חסום, פנה למנהל המערכת';
async function currentUser(id) {
  const { rows } = await pool.query('SELECT id, display_name, phone, abroad_mode, roles, role, app_registered_at, blocked FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function leadSummary(leadId) {
  if (!leadId) return null;
  const { rows } = await pool.query(
    `SELECT l.id, l.name, l.phone, l.assigned_to, u.display_name AS owner_name
     FROM leads l LEFT JOIN users u ON u.id = l.assigned_to WHERE l.id = $1`, [leadId]);
  return rows[0] || null;
}

/* ═══════════════════════ Authenticated API ═══════════════════════ */
const api = express.Router();
api.use(requireAuth);

// GET /api/calls/config — is calling available for this user, and their prefs
api.get('/config', async (req, res) => {
  if (!tw.isEnabled()) return res.json({ enabled: false });
  try {
    const u = await currentUser(req.user.id);
    if (!u || u.blocked) return res.status(403).json({ enabled: false, blocked: true, error: BLOCKED_MSG });
    // app_registered: this user has the ProEvent Dialer app → on Android the web dials through it
    // only (no browser fallback race). Users without the app keep the browser softphone.
    res.json({ enabled: true, number: process.env.TWILIO_PHONE_NUMBER, abroad_mode: !!u?.abroad_mode, has_phone: !!u?.phone, app_registered: !!u?.app_registered_at,
      // iPhone: show the lead name in Apple's incoming-call banner. Off by default — a Hebrew
      // name as a CallKit handle is untested; switch on in Railway (CALLKIT_CALLER_NAME=1) to try.
      callkit_name: process.env.CALLKIT_CALLER_NAME === '1' });
  } catch (err) {
    console.error('[Calls] config error:', err.message);
    res.status(500).json({ enabled: false, error: err.message });
  }
});

// GET /api/calls/token?platform=web|android|ios — Voice SDK access token
api.get('/token', async (req, res) => {
  if (!tw.isEnabled()) return res.status(503).json({ error: 'שיחות אינן מופעלות' });
  const platform = ['android', 'ios'].includes(req.query.platform) ? req.query.platform : 'web';
  try {
    const u = await currentUser(req.user.id);
    if (!u || u.blocked) return res.status(403).json({ blocked: true, error: BLOCKED_MSG });
    res.json({ token: await tw.accessToken(req.user.id, platform), identity: tw.identityFor(req.user.id) });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/calls/device { platform, version, registered } — the mobile app reports its
// registration so the admin users screen can show who has the app.
api.post('/device', async (req, res) => {
  const { platform, version, registered } = req.body || {};
  if (!['android', 'ios'].includes(platform)) return res.status(400).json({ error: 'platform' });
  await pool.query(
    `UPDATE users SET app_platform = $2, app_version = $3, app_registered_at = CASE WHEN $4 THEN NOW() ELSE NULL END WHERE id = $1`,
    [req.user.id, platform, String(version || '').slice(0, 20), registered !== false]
  );
  res.json({ ok: true });
});

// GET /api/calls/app-version — the app checks this on start (APK link + minimum version)
api.get('/app-version', async (req, res) => {
  const { rows } = await pool.query(`SELECT key, value FROM settings WHERE key IN ('dialer_android_version','dialer_android_min_version','dialer_android_apk_url')`);
  const m = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json({ android: { version: m.dialer_android_version || null, minVersion: m.dialer_android_min_version || null, apkUrl: m.dialer_android_apk_url || null } });
});

const isManagerUser = (u) => u.roles?.includes('admin') || u.roles?.includes('manager') || ['admin', 'manager'].includes(u.role);

// GET /api/calls/mine — the caller's own calls (for the app's history). Private calls
// (no lead) are visible only to their owner; lead calls show the lead name.
api.get('/mine', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.direction, c.status, c.started_at, c.duration_sec, c.from_number, c.to_number, c.lead_id,
            c.recording_file_id IS NOT NULL AS has_recording, c.summary, l.name AS lead_name
     FROM calls c LEFT JOIN leads l ON l.id = c.lead_id
     WHERE (c.user_id = $1 OR c.answered_by = $1) AND c.status IN ('completed','missed','voicemail','no-answer','busy','failed','canceled')
     ORDER BY c.started_at DESC LIMIT 200`, [req.user.id]);
  res.json(rows);
});

// GET /api/calls/:id/recording — 60s signed URL for playback.
//   Lead calls: every logged-in user may listen; only managers get a download link
//   (Oran, 2026-10-05 — replaces the managers-only listening rule of 2026-09-29).
//   Private calls (no lead): only the user who made/answered it; download allowed.
// Express 5 (path-to-regexp v8) has no inline regex params, so validate the id here.
api.get('/:id/recording', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'אין הקלטה' });
  const { rows: [call] } = await pool.query(
    `SELECT c.id, c.lead_id, c.user_id, c.answered_by, f.stored_name, f.filename
     FROM calls c JOIN files f ON f.id = c.recording_file_id WHERE c.id = $1`, [req.params.id]);
  if (!call) return res.status(404).json({ error: 'אין הקלטה' });
  const mine = call.user_id === req.user.id || call.answered_by === req.user.id;
  if (!call.lead_id && !mine) return res.status(403).json({ error: 'אין הרשאה' });
  const downloadable = !call.lead_id || isManagerUser(req.user);
  try {
    const { getSignedUrl } = require('../services/storageService');
    const url = await getSignedUrl(call.stored_name, 60);
    // A second signed URL that makes the browser save the file (Supabase `download` option)
    const downloadUrl = downloadable ? await getSignedUrl(call.stored_name, 60, call.filename) : null;
    res.json({ url, downloadUrl, filename: call.filename, downloadable });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/calls/me — { abroad_mode }
api.patch('/me', async (req, res) => {
  const { abroad_mode } = req.body;
  await pool.query('UPDATE users SET abroad_mode = $2 WHERE id = $1', [req.user.id, !!abroad_mode]);
  res.json({ ok: true, abroad_mode: !!abroad_mode });
});

// POST /api/calls/bridge { leadId } — "call my mobile first": Twilio rings the rep's phone,
// and when answered dials the lead. Whole thing is recorded like a browser call.
api.post('/bridge', async (req, res) => {
  if (!tw.isEnabled()) return res.status(503).json({ error: 'שיחות אינן מופעלות' });
  const lead = await leadSummary(req.body.leadId);
  const user = await currentUser(req.user.id);
  if (!lead) return res.status(404).json({ error: 'ליד לא נמצא' });
  // Optional: one of the lead's extra numbers (lead_contacts) instead of the main phone
  let target = lead.phone;
  if (req.body.phone) {
    const { rows: extra } = await pool.query(`SELECT value FROM lead_contacts WHERE lead_id = $1 AND type = 'phone'`, [lead.id]);
    const ok = [lead.phone, ...extra.map(e => e.value)].some(v => v && normalizePhone(v) === normalizePhone(req.body.phone));
    if (!ok) return res.status(400).json({ error: 'המספר לא שייך לליד' });
    target = req.body.phone;
  }
  if (!target) return res.status(400).json({ error: 'לליד אין מספר טלפון' });
  if (!user?.phone) return res.status(400).json({ error: 'אין לך מספר נייד במערכת' });
  try {
    const { rows: [call] } = await pool.query(
      `INSERT INTO calls (direction, lead_id, user_id, from_number, to_number, status, mode)
       VALUES ('outbound', $1, $2, $3, $4, 'initiated', 'bridge') RETURNING id`,
      [lead.id, user.id, process.env.TWILIO_PHONE_NUMBER, tw.toE164(target)]
    );
    const c = await tw.getClient().calls.create({
      to: tw.toE164(user.phone), from: process.env.TWILIO_PHONE_NUMBER,
      url: `${tw.serverUrl()}/api/calls/twiml/bridge?callId=${call.id}`, method: 'POST',
      statusCallback: `${tw.serverUrl()}/api/calls/status?callId=${call.id}`, statusCallbackEvent: ['completed'],
      timeout: 25,
    });
    await pool.query('UPDATE calls SET call_sid = $2 WHERE id = $1', [call.id, c.sid]);
    await claimLead(lead.id, user.id);
    res.json({ ok: true, callId: call.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/calls/lead/:leadId — call log for a lead (used later by analytics; cheap to expose now)
api.get('/lead/:leadId', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.direction, c.status, c.started_at, c.duration_sec, c.summary, c.analysis, c.recording_file_id,
            u.display_name AS user_name
     FROM calls c LEFT JOIN users u ON u.id = COALESCE(c.answered_by, c.user_id)
     WHERE c.lead_id = $1 ORDER BY c.started_at DESC LIMIT 50`, [req.params.leadId]);
  res.json(rows);
});

/* ── Dialer-app call, seen and controlled from the CRM (Oran, 2026-11-16) ──
   On a phone the call runs in the ProEvent Dialer app while the rep keeps working in the CRM:
   the CRM shows a small call bar (name, timer, speaker / mute / hang up). The app reports its
   call state here and long-polls for commands; the CRM reads the state and posts commands.
   Kept in memory — a single web instance, and the state is only meaningful for seconds. */
const appCalls = new Map();   // userId → { state, at, queue: [], waiter: null }
const appSlot = (uid) => { let x = appCalls.get(uid); if (!x) { x = { state: null, at: 0, queue: [], waiter: null }; appCalls.set(uid, x); } return x; };
const APP_STATE_TTL = 70 * 1000;   // the app re-reports at least every long-poll round (~25s)

// App → server: current call state ({ active:false } when the call ended)
api.post('/app/state', (req, res) => {
  const slot = appSlot(req.user.id);
  const b = req.body || {};
  slot.state = b.active ? {
    active: true, name: String(b.name || '').slice(0, 120), number: String(b.number || '').slice(0, 30),
    leadId: Number(b.leadId) || null, direction: b.direction === 'inbound' ? 'inbound' : 'outbound',
    connectedAt: Number(b.connectedAt) || null, muted: !!b.muted, speaker: !!b.speaker,
  } : null;
  slot.at = Date.now();
  if (slot.state) slot.ended = null;
  else {
    slot.queue = [];
    // The call is over. If it never reached the customer, the CRM bar shows why for a moment.
    const p = slot.progress;
    if (p && FAILED_PROGRESS.includes(p.status) && Date.now() - p.at < 20000) {
      slot.ended = { status: p.status, name: slot.lastName || '', leadId: slot.lastLeadId || null, until: Date.now() + 6000 };
    }
    slot.progress = null;
  }
  if (slot.state) { slot.lastName = slot.state.name; slot.lastLeadId = slot.state.leadId; }
  res.json({ ok: true });
});

// Where an outbound call stands, as Twilio reports it for the customer's leg (Oran, 2026-11-17:
// "it is not clear whether it is dialing"): dialing → ringing → answered, or why it failed.
//   dialing    the call left us, the customer's phone is not ringing yet   → "מתחבר לקו…"
//   ringing    the customer's phone is ringing                             → "מצלצל…"
//   answered                                                               → timer
//   busy / no-answer / failed / canceled                                   → "תפוס" / "אין מענה" / "לא זמין"
// Pushed to the dialer app through its long-poll (as "progress:<status>") and shown in the CRM bar.
const FAILED_PROGRESS = ['busy', 'no-answer', 'failed'];
function pushProgress(userId, status) {
  if (!userId || !status) return;
  const slot = appSlot(userId);
  if (slot.progress?.status === status) return;
  slot.progress = { status, at: Date.now() };
  if (FAILED_PROGRESS.includes(status)) slot.outcome = { status, at: Date.now() };
  const cmd = `progress:${status}`;
  if (slot.waiter) { const w = slot.waiter; slot.waiter = null; w([cmd]); } else slot.queue.push(cmd);
}

// App → server, right after an outbound call ended without connecting: why? (the app may have
// been disconnected before the last progress message reached it)
api.get('/app/outcome', (req, res) => {
  const o = appCalls.get(req.user.id)?.outcome;
  res.json({ status: o && Date.now() - o.at < 30000 ? o.status : null });
});

// App → server: wait (up to 25s) for the next commands from the CRM bar
api.get('/app/poll', (req, res) => {
  const slot = appSlot(req.user.id);
  if (slot.queue.length) { const commands = slot.queue; slot.queue = []; return res.json({ commands }); }
  if (slot.waiter) slot.waiter([]);                       // only one waiter per user
  const timer = setTimeout(() => { if (slot.waiter === done) { slot.waiter = null; res.json({ commands: [] }); } }, 25000);
  const done = (commands) => { clearTimeout(timer); if (!res.headersSent) res.json({ commands }); };
  slot.waiter = done;
  req.on('close', () => { clearTimeout(timer); if (slot.waiter === done) slot.waiter = null; });
});

// CRM → server: the call the app is on right now (null when none / stale)
api.get('/app/state', (req, res) => {
  const slot = appCalls.get(req.user.id);
  const fresh = slot && slot.state && Date.now() - slot.at < APP_STATE_TTL;
  const ended = slot?.ended && Date.now() < slot.ended.until ? { status: slot.ended.status, name: slot.ended.name, leadId: slot.ended.leadId } : null;
  res.json({ call: fresh ? { ...slot.state, progress: slot.progress?.status || null } : null, ended: fresh ? null : ended });
});

// CRM → server → app: mute / unmute / speaker_on / speaker_off / hangup
api.post('/app/command', async (req, res) => {
  const action = String(req.body?.action || '');
  if (!['mute', 'unmute', 'speaker_on', 'speaker_off', 'hangup'].includes(action)) return res.status(400).json({ error: 'action' });
  const slot = appSlot(req.user.id);
  if (slot.waiter) { const w = slot.waiter; slot.waiter = null; w([action]); } else slot.queue.push(action);
  // Optimistic echo so the bar reacts at once; the app's next report is the truth
  if (slot.state) {
    if (action === 'mute') slot.state.muted = true;
    if (action === 'unmute') slot.state.muted = false;
    if (action === 'speaker_on') slot.state.speaker = true;
    if (action === 'speaker_off') slot.state.speaker = false;
  }
  if (action === 'hangup') {
    // Do not depend on the app being reachable: end the live call at Twilio as well
    try {
      const { rows: [c] } = await pool.query(
        `SELECT call_sid FROM calls WHERE (user_id = $1 OR answered_by = $1) AND status IN ('ringing','in-progress')
           AND started_at > NOW() - INTERVAL '4 hours' ORDER BY started_at DESC LIMIT 1`, [req.user.id]);
      if (c?.call_sid) await tw.getClient().calls(c.call_sid).update({ status: 'completed' });
    } catch (err) { console.warn('[Calls] app hangup via Twilio failed:', err.message); }
    if (slot.state) { slot.state = null; slot.at = Date.now(); }
  }
  res.json({ ok: true });
});

/* ═══════════════════════ Twilio webhooks ═══════════════════════ */
const hooks = express.Router();
const HOOK_PATH = /^\/(twiml(\/|$)|status$|recording$|progress$)/;
hooks.use((req, res, next) => (HOOK_PATH.test(req.path) ? express.urlencoded({ extended: false })(req, res, next) : next()));
hooks.use((req, res, next) => (HOOK_PATH.test(req.path) ? tw.validateWebhook(req, res, next) : next()));

// Browser → lead. The SDK passes our custom params (To, LeadId) as form fields.
hooks.post('/twiml/outbound', async (req, res) => {
  const vr = new tw.VoiceResponse();
  const userId = tw.userIdFromIdentity(req.body.From);
  const to = tw.toE164(req.body.To);
  // LeadId comes from the CRM button; the app's free dialing sends none → match by phone, and
  // if nothing matches this is a private call (lead_id NULL, visible only to the caller).
  const leadId = Number(req.body.LeadId) || (await findLeadByPhone(pool, normalizePhone(req.body.To))) || null;
  const mode = req.body.Platform === 'app' ? 'app' : 'browser';
  if (!to || !userId) { say(vr, 'לא ניתן לבצע את השיחה'); return xml(res, vr); }

  const { rows: [call] } = await pool.query(
    `INSERT INTO calls (call_sid, direction, lead_id, user_id, from_number, to_number, status, mode)
     VALUES ($1, 'outbound', $2, $3, $4, $5, 'ringing', $6)
     ON CONFLICT (call_sid) DO UPDATE SET status = 'ringing' RETURNING id`,
    [req.body.CallSid, leadId, userId, process.env.TWILIO_PHONE_NUMBER, to, mode]
  );
  await claimLead(leadId, userId);
  const dial = vr.dial({
    callerId: process.env.TWILIO_PHONE_NUMBER, answerOnBridge: true, timeout: 40,
    action: `${tw.serverUrl()}/api/calls/twiml/outbound/done?callId=${call.id}`, method: 'POST',
    ...RECORDING_ATTRS(),
    ringTone: 'il',                               // Israeli ringback instead of Twilio's default US tone (Oran, 2026-10-13)
  });
  // Progress of the customer's leg → /progress (dialing, ringing, answered, or how it failed)
  dial.number({
    statusCallback: `${tw.serverUrl()}/api/calls/progress?callId=${call.id}`, statusCallbackMethod: 'POST',
    statusCallbackEvent: 'initiated ringing answered completed',
  }, to);
  xml(res, vr);
});

hooks.post('/progress', async (req, res) => {
  res.sendStatus(204);
  try {
    const map = { initiated: 'dialing', queued: 'dialing', ringing: 'ringing', 'in-progress': 'answered', busy: 'busy', 'no-answer': 'no-answer', failed: 'failed', canceled: 'canceled' };
    const status = map[req.body.CallStatus];
    if (!status) return;                                   // 'completed' = a normal end, nothing to say
    const { rows: [call] } = await pool.query('SELECT user_id FROM calls WHERE id = $1', [req.query.callId]);
    if (call?.user_id) pushProgress(call.user_id, status);
  } catch (err) { console.error('[Calls] progress webhook error:', err.message); }
});

hooks.post('/twiml/outbound/done', async (req, res) => {
  const vr = new tw.VoiceResponse();
  await finishFromDial(req.query.callId, req.body);
  const s = req.body.DialCallStatus;
  if (s && s !== 'completed') {
    try {
      const { rows: [call] } = await pool.query('SELECT user_id FROM calls WHERE id = $1', [req.query.callId]);
      if (call?.user_id) pushProgress(call.user_id, ['busy', 'no-answer', 'canceled'].includes(s) ? s : 'failed');
    } catch {}
  }
  // Busy line → the caller hears a busy tone (through the call itself, so it works the same in
  // the app and in the browser). No answer / unavailable → no tone, the call just ends.
  if (s === 'busy') vr.play(`${tw.serverUrl()}/api/calls/tone/busy.wav`);
  vr.hangup();
  xml(res, vr);
});

// Israeli busy tone: 400 Hz, half a second on / half a second off, three times (8 kHz mono PCM)
let BUSY_WAV = null;
function busyWav() {
  if (BUSY_WAV) return BUSY_WAV;
  const sr = 8000, total = sr * 3, pcm = Buffer.alloc(total * 2);
  for (let i = 0; i < total; i++) {
    const inBeep = (i % sr) < sr / 2;
    const k = i % sr, edge = Math.min(1, k / 80, (sr / 2 - k) / 80);     // soften the edges
    const v = inBeep ? Math.round(0.35 * 32767 * Math.sin(2 * Math.PI * 400 * i / sr) * Math.max(0, edge)) : 0;
    pcm.writeInt16LE(v, i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  BUSY_WAV = Buffer.concat([h, pcm]);
  return BUSY_WAV;
}
hooks.get('/tone/busy.wav', (req, res) => {
  res.set({ 'Content-Type': 'audio/wav', 'Cache-Control': 'public, max-age=86400' });
  res.send(busyWav());
});

// Rep's mobile answered → now connect the lead
hooks.post('/twiml/bridge', async (req, res) => {
  const vr = new tw.VoiceResponse();
  const { rows: [call] } = await pool.query('SELECT c.*, l.name AS lead_name FROM calls c LEFT JOIN leads l ON l.id = c.lead_id WHERE c.id = $1', [req.query.callId]);
  if (!call) { vr.hangup(); return xml(res, vr); }
  await pool.query(`UPDATE calls SET status = 'in-progress', started_at = NOW() WHERE id = $1`, [call.id]);
  say(vr, `מחבר אותך ל${call.lead_name || 'לקוח'}`);
  const dial = vr.dial({
    callerId: process.env.TWILIO_PHONE_NUMBER, timeout: 40,
    action: `${tw.serverUrl()}/api/calls/twiml/outbound/done?callId=${call.id}`, method: 'POST',
    ...RECORDING_ATTRS(),
    ringTone: 'il',                               // Israeli ringback instead of Twilio's default US tone (Oran, 2026-10-13)
  });
  dial.number(call.to_number);
  xml(res, vr);
});

/* ── Inbound ── */

// Build the ring plan for a call once; stored as JSON on the call row so every step
// webhook reads the same list. Steps: {kind:'number'|'client'|'both', userId, phone}
async function buildRingPlan(lead) {
  const steps = [];
  const { rows: users } = await pool.query(
    `SELECT id, display_name, phone, abroad_mode, call_queue_order, app_registered_at FROM users
     WHERE COALESCE(blocked, false) = false AND (role IN ('admin','manager','sales') OR roles && ARRAY['admin','manager','sales','sales_manager']::text[])
     ORDER BY call_queue_order NULLS LAST, id`);
  // A user with the ProEvent Dialer app rings in the app first (Oran, 2026-11-14): the call is
  // then recognisably a business call and the app shows the lead. If the app does not answer
  // (phone off / registration dropped), the same person's mobile rings as a plain call before
  // the next teammate (Oran's backup rule). Users without the app keep mobile + browser.
  const inApp = (u) => !!u.app_registered_at;
  const mobile = (u) => (u.phone && !u.abroad_mode) ? tw.toE164(u.phone) : null;
  const owner = lead?.assigned_to ? users.find(u => u.id === lead.assigned_to) : null;
  if (owner) {
    if (inApp(owner)) {
      steps.push({ kind: 'client', userId: owner.id, timeout: CLIENT_TIMEOUT, label: owner.display_name });
      if (mobile(owner)) steps.push({ kind: 'number', userId: owner.id, phone: mobile(owner), timeout: MOBILE_TIMEOUT, label: owner.display_name, backup: true });
    } else {
      if (mobile(owner)) steps.push({ kind: 'number', userId: owner.id, phone: mobile(owner), timeout: MOBILE_TIMEOUT, label: owner.display_name });
      steps.push({ kind: 'client', userId: owner.id, timeout: CLIENT_TIMEOUT, label: owner.display_name });
    }
  }
  for (const u of users) {
    if (owner && u.id === owner.id) continue;
    if (inApp(u)) {
      steps.push({ kind: 'client', userId: u.id, timeout: QUEUE_TIMEOUT, label: u.display_name });
      if (mobile(u)) steps.push({ kind: 'number', userId: u.id, phone: mobile(u), timeout: QUEUE_TIMEOUT, label: u.display_name, backup: true });
    } else {
      steps.push({ kind: 'both', userId: u.id, phone: mobile(u), timeout: QUEUE_TIMEOUT, label: u.display_name });
    }
  }
  return steps;
}

// First staff call on a lead claims it (same rule as manual interactions in routes/leads.js:
// never overwrite an existing owner). Oran, 2026-10-09: outbound calls did not claim leads.
async function claimLead(leadId, userId) {
  if (!leadId || !userId) return;
  await pool.query('UPDATE leads SET assigned_to = COALESCE(assigned_to, $2) WHERE id = $1', [leadId, userId]).catch(() => {});
}

function dialStep(vr, step, callId, index, callerNumber, leadName, leadId) {
  const dial = vr.dial({
    timeout: step.timeout, answerOnBridge: true,
    callerId: callerNumber,                       // the rep sees the customer's real number
    action: `${tw.serverUrl()}/api/calls/twiml/inbound/step?callId=${callId}&i=${index + 1}`, method: 'POST',
    ...RECORDING_ATTRS(),
    ringTone: 'il',                               // Israeli ringback instead of Twilio's default US tone (Oran, 2026-10-13)
  });
  if ((step.kind === 'number' || step.kind === 'both') && step.phone) dial.number(step.phone);
  if (step.kind === 'client' || step.kind === 'both') {
    const client = dial.client();
    client.identity(tw.identityFor(step.userId));
    client.parameter({ name: 'leadName', value: leadName || '' });
    // displayName is always present (lead name or the local-format number) so the app may use it
    // as the CallKit caller name when CALLKIT_CALLER_NAME=1 (see /config).
    client.parameter({ name: 'displayName', value: leadName || String(callerNumber || '').replace(/^\+972/, '0') || 'שיחה נכנסת' });
    client.parameter({ name: 'leadId', value: leadId ? String(leadId) : '' });   // app: "פתח כרטיס ליד"
    client.parameter({ name: 'callId', value: String(callId) });
  }
}

async function continueInbound(res, callId, fromIndex) {
  const vr = new tw.VoiceResponse();
  const { rows: [call] } = await pool.query('SELECT c.*, l.name AS lead_name FROM calls c LEFT JOIN leads l ON l.id = c.lead_id WHERE c.id = $1', [callId]);
  if (!call) { vr.hangup(); return xml(res, vr); }
  const plan = call.ring_plan || [];
  // Skip steps that cannot ring anything (no phone and abroad, etc.)
  let i = fromIndex;
  while (i < plan.length && plan[i].kind === 'number' && !plan[i].phone) i++;
  if (i < plan.length) {
    await pool.query('UPDATE calls SET ring_step = $2 WHERE id = $1', [callId, i]);
    dialStep(vr, plan[i], callId, i, call.from_number, call.lead_name, call.lead_id);
    return xml(res, vr);
  }
  // Nobody answered → voicemail
  await pool.query(`UPDATE calls SET status = 'voicemail' WHERE id = $1`, [callId]);
  say(vr, 'הגעתם לשרביה. כרגע אין מי שיענה. השאירו הודעה ונחזור אליכם בהקדם.');
  vr.record({
    maxLength: 120, playBeep: true, timeout: 5,
    action: `${tw.serverUrl()}/api/calls/twiml/inbound/voicemail-done?callId=${callId}`, method: 'POST',
    recordingStatusCallback: `${tw.serverUrl()}/api/calls/recording`, recordingStatusCallbackEvent: 'completed',
  });
  vr.hangup();
  xml(res, vr);
}

hooks.post('/twiml/inbound', async (req, res) => {
  const from = req.body.From;
  const fromNorm = normalizePhone(from);
  let leadId = await findLeadByPhone(pool, fromNorm);
  if (!leadId && fromNorm && fromNorm.length >= 9) {
    // Unknown caller → new lead so the call (and any voicemail) has a home
    const { rows: [l] } = await pool.query(
      `INSERT INTO leads (name, phone, source, stage, notes) VALUES ($1, $2, 'phone_call', 'new', 'נוצר אוטומטית משיחה נכנסת') RETURNING id`,
      [`שיחה נכנסת ${from}`, from]
    ).catch(() => ({ rows: [null] }));
    leadId = l?.id || null;
  }
  const lead = await leadSummary(leadId);
  const plan = await buildRingPlan(lead);
  const { rows: [call] } = await pool.query(
    `INSERT INTO calls (call_sid, direction, lead_id, from_number, to_number, status, mode, ring_plan, ring_step)
     VALUES ($1, 'inbound', $2, $3, $4, 'ringing', 'inbound', $5, 0)
     ON CONFLICT (call_sid) DO UPDATE SET status = 'ringing' RETURNING id`,
    [req.body.CallSid, leadId, from, req.body.To, JSON.stringify(plan)]
  );
  await continueInbound(res, call.id, 0);
});

// After each <Dial>: DialCallStatus completed = someone answered and the call is over.
hooks.post('/twiml/inbound/step', async (req, res) => {
  const callId = Number(req.query.callId);
  const nextIndex = Number(req.query.i) || 0;
  const status = req.body.DialCallStatus;
  if (status === 'completed') {
    const { rows: [call] } = await pool.query('SELECT ring_plan, ring_step FROM calls WHERE id = $1', [callId]);
    const step = call?.ring_plan?.[call.ring_step];
    await pool.query(
      `UPDATE calls SET status = 'completed', answered_by = $2, ended_at = NOW(), duration_sec = $3 WHERE id = $1`,
      [callId, step?.userId || null, Number(req.body.DialCallDuration) || 0]
    );
    const { rows: [answered] } = await pool.query('SELECT lead_id FROM calls WHERE id = $1', [callId]);
    await claimLead(answered?.lead_id, step?.userId);
    const vr = new tw.VoiceResponse(); vr.hangup(); return xml(res, vr);
  }
  await continueInbound(res, callId, nextIndex);
});

hooks.post('/twiml/inbound/voicemail-done', async (req, res) => {
  const vr = new tw.VoiceResponse();
  say(vr, 'תודה, להתראות');
  vr.hangup();
  xml(res, vr);
});

/* ── Lifecycle callbacks ── */

async function finishFromDial(callId, body) {
  const s = body.DialCallStatus;
  const status = s === 'completed' ? 'completed' : (s || 'failed');
  await pool.query(
    `UPDATE calls SET status = $2, ended_at = NOW(), duration_sec = COALESCE($3, duration_sec) WHERE id = $1`,
    [callId, status, s === 'completed' ? Number(body.DialCallDuration) || 0 : null]
  );
  if (status !== 'completed') await logUnansweredOutbound(callId);
}

// Outbound that never connected → a call_attempt on the lead (like the old tel: link did)
async function logUnansweredOutbound(callId) {
  const { rows: [call] } = await pool.query('SELECT * FROM calls WHERE id = $1', [callId]);
  if (!call?.lead_id || call.interaction_id) return;
  const { rows: [i] } = await pool.query(
    `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by, source)
     VALUES ($1, 'call_attempt', 'outbound', $2, $3, 'twilio') RETURNING id`,
    [call.lead_id, `📲 ניסיון חיוג מהמערכת — ${call.status === 'busy' ? 'תפוס' : 'אין מענה'}`, call.user_id]
  );
  await pool.query('UPDATE calls SET interaction_id = $2 WHERE id = $1', [callId, i.id]);
}

// Missed inbound → interaction + WhatsApp. Recipients (Oran, 2026-10-09): the lead's owner
// plus every sales manager (they see all missed calls); with no owner, the admins too. The
// message names the owner and links to /call/<lead>, which dials through the dialer app when
// installed and otherwise from the browser. Runs once per call (`notified` flag) — the
// recording webhook may already have written the voicemail interaction.
async function notifyMissedInbound(callId) {
  const { rows: [call] } = await pool.query(
    `UPDATE calls SET notified = TRUE WHERE id = $1 AND notified = FALSE
     RETURNING *, (SELECT name FROM leads WHERE id = calls.lead_id) AS lead_name,
                  (SELECT assigned_to FROM leads WHERE id = calls.lead_id) AS assigned_to,
                  (SELECT u.display_name FROM leads l JOIN users u ON u.id = l.assigned_to WHERE l.id = calls.lead_id) AS owner_name`, [callId]);
  if (!call) return;
  const hadVoicemail = call.status === 'voicemail';
  if (call.lead_id && !call.interaction_id) {
    const { rows: [i] } = await pool.query(
      `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by, source, is_read)
       VALUES ($1, 'call_attempt', 'inbound', $2, NULL, 'twilio', FALSE) RETURNING id`,
      [call.lead_id, `📵 שיחה נכנסת שלא נענתה מ-${call.from_number}${hadVoicemail ? ' · הושארה הודעה קולית' : ''}`]
    );
    await pool.query('UPDATE calls SET interaction_id = $2 WHERE id = $1', [callId, i.id]);
    await pool.query('UPDATE leads SET updated_at = NOW() WHERE id = $1', [call.lead_id]);
  }
  try {
    const { rows: targets } = await pool.query(
      `SELECT phone FROM users
       WHERE blocked = false AND phone IS NOT NULL AND phone <> ''
         AND ( id = $1
               OR role = 'sales_manager' OR roles @> ARRAY['sales_manager']::text[]
               OR ($1::int IS NULL AND (role = 'admin' OR roles @> ARRAY['admin']::text[])) )`,
      [call.assigned_to || null]);
    const phones = [...new Set(targets.map(t => normalizePhone(t.phone)).filter(Boolean))];
    if (phones.length) {
      const link = call.lead_id ? `${tw.serverUrl()}/call/${call.lead_id}` : '';
      await sendTextToPhones(phones,
        `📵 שיחה שלא נענתה${call.lead_name ? ` מ-${call.lead_name}` : ''} (${call.from_number})` +
        `\n👤 אחראי: ${call.owner_name || 'ללא אחראי'}` +
        `${hadVoicemail ? '\n🎙️ הושארה הודעה קולית — ההקלטה תופיע על הליד' : ''}` +
        `${link ? `\n📞 להתקשר חזרה דרך המערכת:\n${link}` : ''}`);
    }
  } catch (err) { console.error('[Calls] missed-call WhatsApp failed:', err.message); }
}

// Parent-call status (from the number / TwiML app / REST call). Fires once on completion.
hooks.post('/status', async (req, res) => {
  res.sendStatus(204);
  try {
    const sid = req.body.CallSid;
    const { rows: [call] } = req.query.callId
      ? await pool.query('SELECT * FROM calls WHERE id = $1', [req.query.callId])
      : await pool.query('SELECT * FROM calls WHERE call_sid = $1', [sid]);
    if (!call) return;
    const twStatus = req.body.CallStatus; // completed | busy | no-answer | failed | canceled
    let newStatus = call.status;
    if (call.direction === 'inbound') {
      // 'completed' is only set by the step handler when a rep actually answered;
      // anything else at hangup time means the customer was not reached by a person.
      if (call.status !== 'completed') newStatus = call.status === 'voicemail' ? 'voicemail' : 'missed';
    } else if (call.mode === 'bridge' && ['initiated', 'ringing'].includes(call.status)) {
      newStatus = twStatus === 'completed' ? 'no-answer' : (twStatus || 'failed'); // rep never picked up
    } else if (['initiated', 'ringing', 'in-progress'].includes(call.status)) {
      newStatus = twStatus || call.status;
    }
    await pool.query(
      `UPDATE calls SET status = $2, ended_at = COALESCE(ended_at, NOW()),
              duration_sec = COALESCE(duration_sec, $3) WHERE id = $1`,
      [call.id, newStatus, Number(req.body.CallDuration) || null]
    );
    if (call.direction === 'inbound' && newStatus !== 'completed') await notifyMissedInbound(call.id);
    if (call.direction === 'outbound' && newStatus !== 'completed') await logUnansweredOutbound(call.id);
  } catch (err) { console.error('[Calls] status webhook error:', err.message); }
});

// Recording ready (both the <Dial record> and the voicemail <Record>)
hooks.post('/recording', async (req, res) => {
  res.sendStatus(204);
  try {
    if (req.body.RecordingStatus && req.body.RecordingStatus !== 'completed') return;
    const { rows: [call] } = await pool.query('SELECT id FROM calls WHERE call_sid = $1', [req.body.CallSid]);
    if (!call) return;
    await processRecording({
      callId: call.id, recordingSid: req.body.RecordingSid, recordingUrl: req.body.RecordingUrl,
      durationSec: Number(req.body.RecordingDuration) || 0,
    });
  } catch (err) { console.error('[Calls] recording webhook error:', err.message); }
});

module.exports = { callsApiRouter: api, callsHooksRouter: hooks };
