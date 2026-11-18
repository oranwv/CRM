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
const { transcribeCall, WHISPER_PROMPT } = require('./callTranscript');

const MIN_SECONDS_FOR_ANALYSIS = 15;

const openai = () => require('./openaiClient').openai('call-analysis');

function fmtDuration(sec) {
  sec = Number(sec) || 0;
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// Twilio sometimes answers 404/5xx for a few seconds after the "completed" callback, and a long
// call is a bigger download — one failed GET used to lose the whole recording (Gili's 13-minute
// call, 2026-11-16). Retry with a pause, and give it more time.
async function downloadRecording(recordingUrl) {
  let res, lastErr;
  for (const waitMs of [0, 4000, 12000]) {
    if (waitMs) await new Promise(r => setTimeout(r, waitMs));
    try {
      res = await axios.get(`${recordingUrl}.mp3`, {
        responseType: 'arraybuffer', timeout: 180000, maxContentLength: Infinity, maxBodyLength: Infinity,
        auth: { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN },
      });
      break;
    } catch (err) { lastErr = err; }
  }
  if (!res) throw new Error('download failed: ' + (lastErr?.response?.status || lastErr?.message || 'unknown'));
  const tmp = path.join(os.tmpdir(), `call-${Date.now()}-${Math.round(Math.random() * 1e6)}.mp3`);
  fs.writeFileSync(tmp, Buffer.from(res.data));
  return tmp;
}

// Speaker-separated transcript (dual-channel WAV) with a plain mp3 fallback
async function transcribe(tmpPath, durationSec, call, recordingUrl) {
  if (call && recordingUrl) {
    try {
      const r = await transcribeCall({ openai: openai(), call, recordingUrl, durationSec });
      if (r.text && r.text.trim()) return r.text.trim();
    } catch (err) {
      console.warn('[Calls] dual-channel transcript failed, falling back to mono:', err.message);
    }
  }
  const file = await toFile(fs.createReadStream(tmpPath), path.basename(tmpPath), { type: 'audio/mpeg' });
  const t = await openai().audio.transcriptions.create({ model: 'whisper-1', file, language: 'he', audioSeconds: durationSec, prompt: WHISPER_PROMPT });
  return (t.text || '').trim();
}

const STAGE_LABELS = {
  new: 'חדש', new_no_answer: 'חדש — אין מענה', contacted: 'נוצר קשר', meeting_scheduled: 'נקבעה פגישה', meeting: 'פגישה',
  offer_sent: 'נשלחה הצעה', negotiation: 'משא ומתן', contract_sent: 'נשלח חוזה', process_no_answer: 'בתהליך — אין מענה',
  deposit: 'מקדמה', production: 'הפקה', completed: 'הסתיים', lost: 'אבוד',
};
const MAX_TRANSCRIPT_CHARS = 60000;       // ~45 minutes of talk; longer calls are cut at the end
const MAX_PREVIOUS_CALLS   = 5;
const MAX_PREVIOUS_CHARS   = 1500;        // per earlier call summary

// What the CRM already knows about the lead — sent as background so the model can tell what was
// said in THIS call from what is on file, and judge a follow-up call fairly (Oran, 2026-11-18).
async function loadBackground(leadId, callId) {
  if (!leadId) return '';
  const lines = [];
  try {
    const { rows: [l] } = await pool.query(
      `SELECT name, event_type, event_name, event_date, event_date_text, event_time, guest_count, guest_count_max,
              budget, stage, source, lost_reason_text, notes FROM leads WHERE id = $1`, [leadId]);
    if (l) {
      const add = (label, v) => { if (v != null && String(v).trim()) lines.push(`${label}: ${String(v).trim()}`); };
      add('שם האירוע', l.event_name);
      add('תאריך אירוע רשום', l.event_date ? new Date(l.event_date).toLocaleDateString('he-IL') : l.event_date_text);
      add('שעת אירוע רשומה', l.event_time);
      add('מספר אורחים רשום', l.guest_count_max && String(l.guest_count_max) !== String(l.guest_count) ? `${l.guest_count || '?'}–${l.guest_count_max}` : l.guest_count);
      add('תקציב רשום', l.budget);
      add('מקור הליד', l.source);
      add('סיבת אובדן רשומה', l.lost_reason_text);
      add('הערות בכרטיס הליד', l.notes ? String(l.notes).slice(0, 800) : '');
    }
    const { rows: prev } = await pool.query(
      `SELECT c.started_at, c.direction, c.duration_sec, c.summary, u.display_name
       FROM calls c LEFT JOIN users u ON u.id = COALESCE(c.answered_by, c.user_id)
       WHERE c.lead_id = $1 AND c.id <> $2 AND c.summary IS NOT NULL AND c.summary <> ''
         AND c.started_at < COALESCE((SELECT started_at FROM calls WHERE id = $2), NOW())
       ORDER BY c.started_at DESC LIMIT $3`, [leadId, callId || 0, MAX_PREVIOUS_CALLS]);
    if (prev.length) {
      lines.push('', 'סיכומי שיחות טלפון קודמות עם הליד (מהחדשה לישנה):');
      for (const p of prev) {
        lines.push(`— ${new Date(p.started_at).toLocaleDateString('he-IL')} · ${p.direction === 'inbound' ? 'נכנסת' : 'יוצאת'} · ${fmtDuration(p.duration_sec)}${p.display_name ? ' · ' + p.display_name : ''}:`,
          String(p.summary).slice(0, MAX_PREVIOUS_CHARS));
      }
    } else {
      lines.push('', 'אין במערכת סיכומים של שיחות טלפון קודמות עם הליד.');
    }
  } catch (err) { console.warn('[Calls] background for analysis failed:', err.message); }
  return lines.join('\n').trim();
}

// instructions: optional override (the "נסה על שיחה" button in settings tests unsaved text)
async function analyze({ transcript, direction, lead, repName, durationSec, background = '', instructions = null, startedAt = null }) {
  const { getInstructions, systemPrompt } = require('./callAnalysisPrompt');
  const inst = instructions || (await getInstructions()).text;
  const system = systemPrompt(inst);
  const header = [
    '# נתוני השיחה הנוכחית', '',
    `כיוון: ${direction === 'inbound' ? 'נכנסת מלקוח' : 'יוצאת ללקוח'}`,
    `תאריך השיחה: ${new Date(startedAt || Date.now()).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'Asia/Jerusalem' })}`,
    `משך: ${fmtDuration(durationSec)}`,
    `נציג: ${repName || 'לא ידוע'}`,
    `ליד: ${lead?.name || 'לא ידוע'}`,
    `סוג אירוע רשום: ${lead?.event_type || 'לא ידוע'}`,
    `שלב ליד רשום: ${STAGE_LABELS[lead?.stage] || lead?.stage || 'לא ידוע'}`,
  ].join('\n');
  const bg = background ? `# מידע רקע ממערכת ה-CRM (לא נאמר בשיחה הנוכחית)\n\n${background}` : '# מידע רקע ממערכת ה-CRM\n\nאין מידע רקע נוסף.';
  const body = `# תמלול\n\n"""${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}"""`;

  const res = await openai().chat.completions.create({
    model: process.env.CALL_ANALYSIS_MODEL || 'gpt-4o',
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: `${header}\n\n${bg}\n\n${body}` }],
    // Not an OpenAI parameter: lets the costs panel split the input cost by what was sent
    usageSplit: { prompt: system.length + header.length, background: bg.length, transcript: body.length },
  });
  try { return JSON.parse(res.choices[0].message.content); } catch { return null; }
}

function renderBody({ direction, durationSec, repName, analysis, fileMarker, fromNumber, voicemail, transcript, failed }) {
  const lines = [];
  if (voicemail) {
    lines.push(`🎙️ הודעה קולית מ-${fromNumber || 'לא ידוע'} · ${fmtDuration(durationSec)} (שיחה שלא נענתה)`);
    if (transcript) lines.push('', `"${transcript}"`);
    if (fileMarker) lines.push('', fileMarker);
    return lines.join('\n');
  }
  lines.push(`📞 שיחה ${direction === 'inbound' ? 'נכנסת' : 'יוצאת'} · ${fmtDuration(durationSec)}${repName ? ' · ' + repName : ''}${direction === 'inbound' && fromNumber ? ' · מ-' + fromNumber : ''}`);
  if (analysis) {
    if (analysis.summary) {
      const mins = Math.round((Number(durationSec) || 0) / 60);
      const minsText = mins < 1 ? 'פחות מדקה' : `${mins} דק'`;
      const summary = String(analysis.summary).trim();
      // The v2 guidelines return a bulleted, multi-line summary — it gets its own block
      if (summary.includes('\n')) lines.push('', `📝 סיכום השיחה (${minsText}):`, summary);
      else lines.push('', `📝 שיחה של ${minsText} · ${summary}`);
    }
    const list = (title, arr) => { if (Array.isArray(arr) && arr.length) lines.push('', `${title}`, ...arr.map(x => `• ${x}`)); };
    list('📅 תאריכים שדוברו:', analysis.dates_mentioned);
    list('💰 מחירים ותקציב:', analysis.prices_mentioned);
    list('🎯 מה הלקוח צריך:', analysis.customer_needs);
    list('⚠️ התנגדויות:', analysis.objections);
    list('🤝 סוכם:', analysis.agreements);
    list('➡️ צעדים הבאים:', analysis.next_steps);
    const score = Number(analysis.sales_score);
    // Score 0 = "no score" (not a sales call / nothing to judge). Tips may still exist: the
    // guidelines also use them for information worth finding out next time.
    const tips = Array.isArray(analysis.coaching_tips) ? analysis.coaching_tips.filter(Boolean) : [];
    if (score) lines.push('', `⭐ מיצוי השיחה: ${score}/10${analysis.sentiment ? ' · ' + analysis.sentiment : ''}`);
    if (tips.length) lines.push(...(score ? [] : ['']), ...tips.map(x => `💡 ${x}`));
  } else if (failed) {
    // The recording exists at Twilio but our copy/summary failed — say so instead of the
    // misleading "short call"; the retry sweep fills this entry in when it succeeds.
    lines.push(/quota|restricted|storage/i.test(failed === true ? '' : failed)
      ? '⚠️ ההקלטה לא נשמרה — אחסון הקבצים של המערכת מלא. היא שמורה זמנית ותיכנס אוטומטית כשהאחסון יתפנה'
      : '⚠️ ההקלטה עוד לא עובדה — המערכת תנסה שוב אוטומטית');
  } else if ((Number(durationSec) || 0) >= MIN_SECONDS_FOR_ANALYSIS) {
    lines.push('(לא נוצר סיכום לשיחה)');
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
  let tmp = null, fileMarker = null, fileId = null, analysis = null, vmTranscript = null, transcript = null, pipelineError = null;
  try {
    tmp = await downloadRecording(recordingUrl);
    const fileName = `${voicemail ? 'הודעה קולית' : 'הקלטת שיחה'} ${new Date(call.started_at || Date.now()).toLocaleDateString('he-IL')}.mp3`;
    const { storedName } = await uploadFile(tmp, fileName, 'audio/mpeg');
    // Recording files are NOT lead files: lead_id stays NULL and is_recording marks them so the
    // generic /files endpoints refuse them. Access goes only through /api/calls/:id/recording
    // (managers for lead calls; the owner for private calls) — Oran's policy, 2026-09-29.
    const { rows: [f] } = await pool.query(
      `INSERT INTO files (lead_id, filename, url, stored_name, file_type, uploaded_by, is_recording)
       VALUES (NULL, $1, '', $2, 'audio/mpeg', NULL, TRUE) RETURNING id`,
      [fileName, storedName]
    );
    fileId = f.id;
    fileMarker = `[[REC:${callId}]]`;

    if (!call.lead_id) {
      // Private call (number not in the CRM): recording only — no transcript, no AI (Oran's choice)
    } else if (voicemail) {
      if (durationSec >= 2 && process.env.OPENAI_API_KEY) vmTranscript = await transcribe(tmp, durationSec, null, null).catch(() => null);
      transcript = vmTranscript;
    } else if (durationSec >= MIN_SECONDS_FOR_ANALYSIS && process.env.OPENAI_API_KEY) {
      transcript = await transcribe(tmp, durationSec, call, recordingUrl);
      if (transcript.length > 20) {
        const background = await loadBackground(call.lead_id, callId);
        analysis = await analyze({ transcript, direction: call.direction, lead, repName, durationSec, background, startedAt: call.started_at });
      }
    }
  } catch (err) {
    pipelineError = String(err.message || err).slice(0, 300);
    console.error('[Calls] recording pipeline error:', err.message);
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp); } catch {} }
  }
  // Our copy is safe in Supabase and the transcript is done — drop Twilio's copy so we
  // don't pay their storage too
  if (fileId && recordingSid) {
    require('./twilioService').getClient().recordings(recordingSid).remove()
      .catch(err => console.warn('[Calls] could not delete Twilio recording:', err.message));
  }

  const body = renderBody({
    direction: call.direction, durationSec, repName, analysis, fileMarker, voicemail, transcript: vmTranscript,
    fromNumber: call.direction === 'inbound' ? call.from_number : null,
    failed: fileId ? false : (pipelineError || true),
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
                      interaction_id = $6, duration_sec = COALESCE(duration_sec, $7), transcript = $8,
                      recording_attempts = COALESCE(recording_attempts, 0) + $10, recording_error = $9 WHERE id = $1`,
    // A full/restricted file storage (Supabase quota, 2026-11-16) is not this call's fault and
    // can last days: such failures do not use up the retry budget, so every recording waiting
    // at Twilio is picked up once storage works again.
    [callId, recordingSid, fileId, analysis?.summary || null, analysis ? JSON.stringify(analysis) : null, interactionId, durationSec, transcript,
     fileId ? null : (pipelineError || 'unknown'), /quota|restricted|storage/i.test(pipelineError || '') ? 0 : 1]
  );
}

// Recordings whose pipeline failed keep their Twilio copy (we only delete it after our own copy
// is stored). Every few minutes, retry the recent ones — up to 5 attempts each.
let sweeping = false;
async function retryFailedRecordings() {
  if (sweeping || !process.env.TWILIO_ACCOUNT_SID) return;
  sweeping = true;
  try {
    const { rows } = await pool.query(
      `SELECT id, recording_sid, duration_sec FROM calls
       WHERE recording_sid IS NOT NULL AND recording_file_id IS NULL AND recording_deleted_at IS NULL
         AND COALESCE(recording_attempts, 0) < 5 AND started_at > NOW() - INTERVAL '14 days'
       ORDER BY started_at DESC LIMIT 5`);
    for (const c of rows) {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${c.recording_sid}`;
      let dur = Number(c.duration_sec) || 0;
      try {
        const rec = await require('./twilioService').getClient().recordings(c.recording_sid).fetch();
        dur = Number(rec.duration) || dur;
      } catch (err) {
        // Gone from Twilio as well → nothing left to retry
        if (err.status === 404) { await pool.query(`UPDATE calls SET recording_attempts = 5, recording_error = 'recording no longer at Twilio' WHERE id = $1`, [c.id]); continue; }
      }
      await processRecording({ callId: c.id, recordingSid: c.recording_sid, recordingUrl: url, durationSec: dur })
        .catch(err => console.error('[Calls] recording retry error:', err.message));
    }
  } catch (err) { console.error('[Calls] recording sweep error:', err.message); }
  finally { sweeping = false; }
}

module.exports = { processRecording, retryFailedRecordings, fmtDuration, analyze, loadBackground, renderBody };
