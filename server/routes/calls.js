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

async function currentUser(id) {
  const { rows } = await pool.query('SELECT id, display_name, phone, abroad_mode, roles, role FROM users WHERE id = $1', [id]);
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
    res.json({ enabled: true, number: process.env.TWILIO_PHONE_NUMBER, abroad_mode: !!u?.abroad_mode, has_phone: !!u?.phone });
  } catch (err) {
    console.error('[Calls] config error:', err.message);
    res.status(500).json({ enabled: false, error: err.message });
  }
});

// GET /api/calls/token — browser SDK access token
api.get('/token', async (req, res) => {
  if (!tw.isEnabled()) return res.status(503).json({ error: 'שיחות אינן מופעלות' });
  try { res.json({ token: await tw.accessToken(req.user.id), identity: tw.identityFor(req.user.id) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
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
  if (!lead?.phone) return res.status(400).json({ error: 'לליד אין מספר טלפון' });
  if (!user?.phone) return res.status(400).json({ error: 'אין לך מספר נייד במערכת' });
  try {
    const { rows: [call] } = await pool.query(
      `INSERT INTO calls (direction, lead_id, user_id, from_number, to_number, status, mode)
       VALUES ('outbound', $1, $2, $3, $4, 'initiated', 'bridge') RETURNING id`,
      [lead.id, user.id, process.env.TWILIO_PHONE_NUMBER, tw.toE164(lead.phone)]
    );
    const c = await tw.getClient().calls.create({
      to: tw.toE164(user.phone), from: process.env.TWILIO_PHONE_NUMBER,
      url: `${tw.serverUrl()}/api/calls/twiml/bridge?callId=${call.id}`, method: 'POST',
      statusCallback: `${tw.serverUrl()}/api/calls/status?callId=${call.id}`, statusCallbackEvent: ['completed'],
      timeout: 25,
    });
    await pool.query('UPDATE calls SET call_sid = $2 WHERE id = $1', [call.id, c.sid]);
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

/* ═══════════════════════ Twilio webhooks ═══════════════════════ */
const hooks = express.Router();
const HOOK_PATH = /^\/(twiml(\/|$)|status$|recording$)/;
hooks.use((req, res, next) => (HOOK_PATH.test(req.path) ? express.urlencoded({ extended: false })(req, res, next) : next()));
hooks.use((req, res, next) => (HOOK_PATH.test(req.path) ? tw.validateWebhook(req, res, next) : next()));

// Browser → lead. The SDK passes our custom params (To, LeadId) as form fields.
hooks.post('/twiml/outbound', async (req, res) => {
  const vr = new tw.VoiceResponse();
  const userId = tw.userIdFromIdentity(req.body.From);
  const to = tw.toE164(req.body.To);
  const leadId = Number(req.body.LeadId) || (await findLeadByPhone(pool, normalizePhone(req.body.To)));
  if (!to || !userId) { say(vr, 'לא ניתן לבצע את השיחה'); return xml(res, vr); }

  const { rows: [call] } = await pool.query(
    `INSERT INTO calls (call_sid, direction, lead_id, user_id, from_number, to_number, status, mode)
     VALUES ($1, 'outbound', $2, $3, $4, $5, 'ringing', 'browser')
     ON CONFLICT (call_sid) DO UPDATE SET status = 'ringing' RETURNING id`,
    [req.body.CallSid, leadId, userId, process.env.TWILIO_PHONE_NUMBER, to]
  );
  const dial = vr.dial({
    callerId: process.env.TWILIO_PHONE_NUMBER, answerOnBridge: true, timeout: 40,
    action: `${tw.serverUrl()}/api/calls/twiml/outbound/done?callId=${call.id}`, method: 'POST',
    ...RECORDING_ATTRS(),
  });
  dial.number(to);
  xml(res, vr);
});

hooks.post('/twiml/outbound/done', async (req, res) => {
  const vr = new tw.VoiceResponse();
  await finishFromDial(req.query.callId, req.body);
  vr.hangup();
  xml(res, vr);
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
    `SELECT id, display_name, phone, abroad_mode, call_queue_order FROM users
     WHERE blocked = false AND (role IN ('admin','manager','sales') OR roles && ARRAY['admin','manager','sales','sales_manager']::text[])
     ORDER BY call_queue_order NULLS LAST, id`);
  const owner = lead?.assigned_to ? users.find(u => u.id === lead.assigned_to) : null;
  if (owner) {
    if (owner.phone && !owner.abroad_mode) steps.push({ kind: 'number', userId: owner.id, phone: tw.toE164(owner.phone), timeout: MOBILE_TIMEOUT, label: owner.display_name });
    steps.push({ kind: 'client', userId: owner.id, timeout: CLIENT_TIMEOUT, label: owner.display_name });
  }
  for (const u of users) {
    if (owner && u.id === owner.id) continue;
    steps.push({ kind: 'both', userId: u.id, phone: (u.phone && !u.abroad_mode) ? tw.toE164(u.phone) : null, timeout: QUEUE_TIMEOUT, label: u.display_name });
  }
  return steps;
}

function dialStep(vr, step, callId, index, callerNumber, leadName) {
  const dial = vr.dial({
    timeout: step.timeout, answerOnBridge: true,
    callerId: callerNumber,                       // the rep sees the customer's real number
    action: `${tw.serverUrl()}/api/calls/twiml/inbound/step?callId=${callId}&i=${index + 1}`, method: 'POST',
    ...RECORDING_ATTRS(),
  });
  if ((step.kind === 'number' || step.kind === 'both') && step.phone) dial.number(step.phone);
  if (step.kind === 'client' || step.kind === 'both') {
    const client = dial.client();
    client.identity(tw.identityFor(step.userId));
    client.parameter({ name: 'leadName', value: leadName || '' });
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
    dialStep(vr, plan[i], callId, i, call.from_number, call.lead_name);
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

// Missed inbound → interaction + WhatsApp to the owner (or the admins). Runs once per call
// (`notified` flag) — the recording webhook may already have written the voicemail interaction.
async function notifyMissedInbound(callId) {
  const { rows: [call] } = await pool.query(
    `UPDATE calls SET notified = TRUE WHERE id = $1 AND notified = FALSE
     RETURNING *, (SELECT name FROM leads WHERE id = calls.lead_id) AS lead_name,
                  (SELECT assigned_to FROM leads WHERE id = calls.lead_id) AS assigned_to`, [callId]);
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
    const { rows: targets } = call.assigned_to
      ? await pool.query('SELECT phone FROM users WHERE id = $1 AND phone IS NOT NULL', [call.assigned_to])
      : await pool.query(`SELECT phone FROM users WHERE (role = 'admin' OR roles @> ARRAY['admin']::text[]) AND blocked = false AND phone IS NOT NULL AND phone <> ''`);
    const phones = [...new Set(targets.map(t => normalizePhone(t.phone)).filter(Boolean))];
    if (phones.length) {
      const link = call.lead_id ? `${tw.serverUrl()}/?lead=${call.lead_id}` : '';
      await sendTextToPhones(phones,
        `📵 שיחה שלא נענתה${call.lead_name ? ` מ-${call.lead_name}` : ''} (${call.from_number})${hadVoicemail ? '\n🎙️ הושארה הודעה קולית — ההקלטה תופיע על הליד' : ''}${link ? `\n${link}` : ''}`);
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
