// Twilio Voice — account client, one-time self-setup and helpers shared by
// routes/calls.js. Everything is driven by three env vars:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER (E.164, e.g. +97233823777)
// The API Key (for browser access tokens) and the TwiML App (the "voice URL" the
// browser SDK dials into) are created by ensureSetup() on the first boot and kept
// in the `settings` table, so nothing else has to be configured in the console.
const twilio = require('twilio');
const pool   = require('../db/pool');

const SETTINGS = {
  keySid:    'twilio_api_key_sid',
  keySecret: 'twilio_api_key_secret',
  appSid:    'twilio_twiml_app_sid',
};

function isEnabled() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
}

function serverUrl() {
  return (process.env.SERVER_URL || '').replace(/\/+$/, '');
}

let _client = null;
function getClient() {
  if (!isEnabled()) throw new Error('Twilio is not configured');
  if (!_client) _client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return _client;
}

async function getSetting(key) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0]?.value || null;
}
async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value]
  );
}

// Idempotent. Safe to run on every boot; only talks to Twilio when something is missing
// or the webhooks point somewhere else (e.g. SERVER_URL changed).
async function ensureSetup() {
  if (!isEnabled()) { console.log('[Twilio] not configured — calling disabled'); return; }
  const base = serverUrl();
  if (!base) { console.log('[Twilio] SERVER_URL missing — skipping webhook setup'); return; }
  const client = getClient();

  // 1. API key for browser access tokens (secret is only returned on creation)
  let keySid = await getSetting(SETTINGS.keySid);
  let keySecret = await getSetting(SETTINGS.keySecret);
  if (!keySid || !keySecret) {
    const key = await client.newKeys.create({ friendlyName: 'ProEvent CRM browser calling' });
    keySid = key.sid; keySecret = key.secret;
    await setSetting(SETTINGS.keySid, keySid);
    await setSetting(SETTINGS.keySecret, keySecret);
    console.log('[Twilio] API key created');
  }

  // 2. TwiML app — outbound calls from the browser SDK land here
  const outboundUrl = `${base}/api/calls/twiml/outbound`;
  const statusUrl   = `${base}/api/calls/status`;
  let appSid = await getSetting(SETTINGS.appSid);
  let app = null;
  if (appSid) {
    try { app = await client.applications(appSid).fetch(); } catch { app = null; appSid = null; }
  }
  if (!app) {
    app = await client.applications.create({
      friendlyName: 'ProEvent CRM', voiceUrl: outboundUrl, voiceMethod: 'POST',
      statusCallback: statusUrl, statusCallbackMethod: 'POST',
    });
    appSid = app.sid;
    await setSetting(SETTINGS.appSid, appSid);
    console.log('[Twilio] TwiML app created');
  } else if (app.voiceUrl !== outboundUrl || app.statusCallback !== statusUrl) {
    await client.applications(appSid).update({ voiceUrl: outboundUrl, voiceMethod: 'POST', statusCallback: statusUrl, statusCallbackMethod: 'POST' });
    console.log('[Twilio] TwiML app webhooks updated');
  }

  // 3. The Israeli number — inbound calls + status events go to our server
  const inboundUrl = `${base}/api/calls/twiml/inbound`;
  const numbers = await client.incomingPhoneNumbers.list({ phoneNumber: process.env.TWILIO_PHONE_NUMBER, limit: 1 });
  if (!numbers.length) {
    console.error('[Twilio] TWILIO_PHONE_NUMBER is not on this account:', process.env.TWILIO_PHONE_NUMBER);
    return;
  }
  const n = numbers[0];
  if (n.voiceUrl !== inboundUrl || n.statusCallback !== statusUrl || n.voiceApplicationSid) {
    await client.incomingPhoneNumbers(n.sid).update({
      voiceUrl: inboundUrl, voiceMethod: 'POST',
      voiceFallbackUrl: '', voiceApplicationSid: '',
      statusCallback: statusUrl, statusCallbackMethod: 'POST',
    });
    console.log('[Twilio] phone number webhooks updated');
  }
  console.log('[Twilio] ready —', process.env.TWILIO_PHONE_NUMBER);
}

const identityFor = (userId) => `user_${userId}`;
const userIdFromIdentity = (identity) => {
  const m = /^(?:client:)?user_(\d+)$/.exec(identity || '');
  return m ? Number(m[1]) : null;
};

// JWT the browser SDK registers with. Twilio allows up to 24h; 4 hours keeps phones that
// sleep through a refresh from waking up to an expired token (the client also refreshes).
const TOKEN_TTL = 4 * 60 * 60;
async function accessToken(userId) {
  const [keySid, keySecret, appSid] = await Promise.all([
    getSetting(SETTINGS.keySid), getSetting(SETTINGS.keySecret), getSetting(SETTINGS.appSid),
  ]);
  if (!keySid || !keySecret || !appSid) throw new Error('Twilio setup incomplete — check server logs');
  const { AccessToken } = twilio.jwt;
  const token = new AccessToken(process.env.TWILIO_ACCOUNT_SID, keySid, keySecret, { identity: identityFor(userId), ttl: TOKEN_TTL });
  token.addGrant(new AccessToken.VoiceGrant({ outgoingApplicationSid: appSid, incomingAllow: true }));
  return token.toJwt();
}

// Express middleware: reject webhook calls that were not signed by Twilio.
// Railway terminates TLS, so the URL Twilio signed is rebuilt from SERVER_URL.
function validateWebhook(req, res, next) {
  if (process.env.TWILIO_SKIP_VALIDATION === '1') return next();
  const signature = req.headers['x-twilio-signature'];
  const url = `${serverUrl()}${req.originalUrl}`;
  const ok = signature && twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, signature, url, req.body || {});
  if (!ok) {
    console.warn('[Twilio] rejected unsigned webhook', req.originalUrl);
    return res.status(403).send('Forbidden');
  }
  next();
}

// E.164 for dialing: "050-1234567" → "+972501234567"; already-international numbers kept.
function toE164(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = '972' + digits.slice(1);
  return '+' + digits;
}

// Google's Hebrew voice for the short prompts (voicemail); falls back to plain <Say>.
const HE_VOICE = 'Google.he-IL-Wavenet-A';

module.exports = {
  isEnabled, getClient, ensureSetup, accessToken, validateWebhook,
  identityFor, userIdFromIdentity, toE164, serverUrl, HE_VOICE,
  VoiceResponse: twilio.twiml.VoiceResponse,
};
