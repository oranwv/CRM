// Post-call pipeline: download the Twilio recording → Supabase storage (files row)
// → Whisper transcript (Hebrew) → GPT summary + sales insights → one `call`
// interaction on the lead. The full transcript is kept on `calls.transcript` and shown
// collapsed on the interaction (Oran asked for it on 2026-09-16 to judge summary quality);
// the summary/insights JSON lives on `calls.analysis`.
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const axios  = require('axios');
const { toFile } = require('openai');
const pool   = require('../db/pool');
const { uploadFile } = require('./storageService');

const MIN_SECONDS_FOR_ANALYSIS = 15;

const openai = () => require('./openaiClient').openai('call-analysis');

function fmtDuration(sec) {
  sec = Number(sec) || 0;
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

async function downloadRecording(recordingUrl) {
  const res = await axios.get(`${recordingUrl}.mp3`, {
    responseType: 'arraybuffer', timeout: 60000,
    auth: { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN },
  });
  const tmp = path.join(os.tmpdir(), `call-${Date.now()}-${Math.round(Math.random() * 1e6)}.mp3`);
  fs.writeFileSync(tmp, Buffer.from(res.data));
  return tmp;
}

async function transcribe(tmpPath, durationSec) {
  const file = await toFile(fs.createReadStream(tmpPath), path.basename(tmpPath), { type: 'audio/mpeg' });
  const t = await openai().audio.transcriptions.create({
    model: 'whisper-1', file, language: 'he', audioSeconds: durationSec,
    prompt: 'שיחת טלפון בעברית בין נציג מכירות של שרביה, מקום אירועים ביפו, ללקוח שמתעניין באירוע: חתונה, בר מצווה, אירוע חברה, מחיר לאורח, תאריך, תפריט, בר.',
  });
  return (t.text || '').trim();
}

async function analyze({ transcript, direction, lead, repName, durationSec }) {
  const prompt = `אתה מאמן מכירות של מקום אירועים (שרביה, יפו). לפניך תמלול של שיחת טלפון ${direction === 'inbound' ? 'נכנסת מלקוח' : 'יוצאת ללקוח'} באורך ${fmtDuration(durationSec)}.
נציג: ${repName || 'לא ידוע'}. ליד: ${lead?.name || 'לא ידוע'}${lead?.event_type ? ', סוג אירוע: ' + lead.event_type : ''}${lead?.stage ? ', שלב: ' + lead.stage : ''}.

החזר JSON בלבד (ללא טקסט נוסף) במבנה:
{
  "summary": "סיכום של 2-4 משפטים — מה קרה בשיחה",
  "customer_needs": ["מה הלקוח צריך / ביקש / חשוב לו"],
  "objections": ["התנגדויות או חששות שעלו (ריק אם אין)"],
  "agreements": ["מה סוכם או הובטח"],
  "next_steps": ["צעדים הבאים מוצעים לנציג"],
  "sentiment": "חיובי|נייטרלי|שלילי",
  "sales_score": 1-10,
  "coaching_tips": ["2-3 טיפים קצרים ומעשיים לשיפור השיחה הבאה"],
  "event_details": { "date": "אם צוין", "guests": "אם צוין", "budget": "אם צוין", "event_type": "אם צוין" }
}
היה תמציתי, בעברית. סכם רק מה שנאמר בפועל — אל תמציא ואל תנחש. אם התמלול לא ברור, קצר מדי, או נראה כמו שיחת בדיקה/ניסיון (אין לקוח אמיתי) — כתוב זאת בסיכום, השאר את המערכים ריקים ותן sales_score = 0.

תמלול:
"""${transcript.slice(0, 24000)}"""`;

  const res = await openai().chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }],
  });
  try { return JSON.parse(res.choices[0].message.content); } catch { return null; }
}

function renderBody({ direction, durationSec, repName, analysis, fileMarker, fromNumber, voicemail, transcript }) {
  const lines = [];
  if (voicemail) {
    lines.push(`🎙️ הודעה קולית מ-${fromNumber || 'לא ידוע'} · ${fmtDuration(durationSec)} (שיחה שלא נענתה)`);
    if (transcript) lines.push('', `"${transcript}"`);
    if (fileMarker) lines.push('', fileMarker);
    return lines.join('\n');
  }
  lines.push(`📞 שיחה ${direction === 'inbound' ? 'נכנסת' : 'יוצאת'} · ${fmtDuration(durationSec)}${repName ? ' · ' + repName : ''}${direction === 'inbound' && fromNumber ? ' · מ-' + fromNumber : ''}`);
  if (analysis) {
    if (analysis.summary) lines.push('', `📝 ${analysis.summary}`);
    const list = (title, arr) => { if (Array.isArray(arr) && arr.length) lines.push('', `${title}`, ...arr.map(x => `• ${x}`)); };
    list('🎯 מה הלקוח צריך:', analysis.customer_needs);
    list('⚠️ התנגדויות:', analysis.objections);
    list('🤝 סוכם:', analysis.agreements);
    list('➡️ צעדים הבאים:', analysis.next_steps);
    const score = Number(analysis.sales_score);
    if (score) {
      lines.push('', `⭐ ציון שיחה: ${score}/10${analysis.sentiment ? ' · ' + analysis.sentiment : ''}`);
      if (Array.isArray(analysis.coaching_tips) && analysis.coaching_tips.length) lines.push(...analysis.coaching_tips.map(x => `💡 ${x}`));
    }
  } else {
    lines.push('(שיחה קצרה — ללא סיכום)');
  }
  if (fileMarker) lines.push('', fileMarker);
  return lines.join('\n');
}

// Main entry — called from the recording webhook. Never throws; logs and marks the call row.
async function processRecording({ callId, recordingSid, recordingUrl, durationSec }) {
  const { rows: [call] } = await pool.query('SELECT * FROM calls WHERE id = $1', [callId]);
  if (!call) return;
  const userId = call.answered_by || call.user_id;
  const [{ rows: [lead] }, { rows: [rep] }] = await Promise.all([
    call.lead_id ? pool.query('SELECT id, name, event_type, stage FROM leads WHERE id = $1', [call.lead_id]) : { rows: [null] },
    userId ? pool.query('SELECT display_name FROM users WHERE id = $1', [userId]) : { rows: [null] },
  ]);
  const repName = rep?.display_name || null;

  const voicemail = call.status === 'voicemail' || call.status === 'missed';
  let tmp = null, fileMarker = null, fileId = null, analysis = null, vmTranscript = null, transcript = null;
  try {
    tmp = await downloadRecording(recordingUrl);
    const fileName = `${voicemail ? 'הודעה קולית' : 'הקלטת שיחה'} ${new Date(call.started_at || Date.now()).toLocaleDateString('he-IL')}.mp3`;
    const { storedName } = await uploadFile(tmp, fileName, 'audio/mpeg');
    const { rows: [f] } = await pool.query(
      `INSERT INTO files (lead_id, filename, url, stored_name, file_type, uploaded_by)
       VALUES ($1, $2, '', $3, 'audio/mpeg', NULL) RETURNING id`,
      [call.lead_id, fileName, storedName]
    );
    fileId = f.id;
    fileMarker = `[[FILE:${fileId}|${fileName}]]`;
    // Our copy is safe in Supabase — drop Twilio's so we don't pay their storage too
    if (recordingSid) {
      require('./twilioService').getClient().recordings(recordingSid).remove()
        .catch(err => console.warn('[Calls] could not delete Twilio recording:', err.message));
    }

    if (voicemail) {
      if (durationSec >= 2 && process.env.OPENAI_API_KEY) vmTranscript = await transcribe(tmp, durationSec).catch(() => null);
      transcript = vmTranscript;
    } else if (durationSec >= MIN_SECONDS_FOR_ANALYSIS && process.env.OPENAI_API_KEY) {
      transcript = await transcribe(tmp, durationSec);
      if (transcript.length > 20) {
        analysis = await analyze({ transcript, direction: call.direction, lead, repName, durationSec });
      }
    }
  } catch (err) {
    console.error('[Calls] recording pipeline error:', err.message);
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp); } catch {} }
  }

  const body = renderBody({
    direction: call.direction, durationSec, repName, analysis, fileMarker, voicemail, transcript: vmTranscript,
    fromNumber: call.direction === 'inbound' ? call.from_number : null,
  }) + (!voicemail && transcript ? `\n\n[[TRANSCRIPT]]\n${transcript}` : '');

  let interactionId = call.interaction_id;
  if (call.lead_id) {
    if (interactionId) {
      await pool.query('UPDATE lead_interactions SET body = $1 WHERE id = $2', [body, interactionId]);
    } else {
      const { rows: [i] } = await pool.query(
        `INSERT INTO lead_interactions (lead_id, type, direction, body, created_by, source, is_read)
         VALUES ($1, $2, $3, $4, $5, 'twilio', $6) RETURNING id`,
        [call.lead_id, voicemail ? 'call_attempt' : 'call', call.direction, body, voicemail ? null : (userId || null), call.direction !== 'inbound']
      );
      interactionId = i.id;
      await pool.query('UPDATE leads SET updated_at = NOW() WHERE id = $1', [call.lead_id]);
    }
  }

  await pool.query(
    `UPDATE calls SET recording_sid = $2, recording_file_id = $3, summary = $4, analysis = $5,
                      interaction_id = $6, duration_sec = COALESCE(duration_sec, $7), transcript = $8 WHERE id = $1`,
    [callId, recordingSid, fileId, analysis?.summary || null, analysis ? JSON.stringify(analysis) : null, interactionId, durationSec, transcript]
  );
}

module.exports = { processRecording, fmtDuration };
