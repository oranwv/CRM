// Full history of ONE lead as a single cited document, for the AI assistant's
// `search_lead_history` tool: call transcripts + call summaries, notes, meetings, emails,
// WhatsApp/Facebook/Instagram messages and the lead's own notes field.
//
// Every source gets a header the model must cite ("[מקור 12] שיחה יוצאת · 03.11.2026 14:20 ·
// שיר · 6:40 דק׳"). Transcript lines get an APPROXIMATE time marker ("[~04:10]"): Whisper
// timestamps are not stored, so the position is estimated from the line's character offset
// in the transcript × the call duration. It is labelled as an estimate everywhere.
//
// Small histories are returned whole. Large ones (> DIRECT_BUDGET chars) go through a
// map step: each chunk is scanned by gpt-4o-mini for lines relevant to the question and
// only those lines (verbatim, with their headers) are returned.
const pool = require('../db/pool');

const IL = 'Asia/Jerusalem';
const DIRECT_BUDGET = 60000;  // chars returned to the chat model without a map step
const CHUNK_SIZE    = 45000;  // chars per map-step chunk
const MAX_CHUNKS    = 8;

const TYPE_LABELS = {
  call: 'שיחה', call_attempt: 'ניסיון שיחה', meeting: 'פגישה', note: 'הערה', email: 'אימייל',
  whatsapp: 'וואטסאפ', facebook: 'פייסבוק', instagram: 'אינסטגרם',
};

function fmtWhen(d) {
  if (!d) return '';
  const dt = new Date(d);
  const date = dt.toLocaleDateString('he-IL', { timeZone: IL, day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = dt.toLocaleTimeString('he-IL', { timeZone: IL, hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} ${time}`;
}
function mmss(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function dirLabel(type, direction) {
  if (type === 'note' || type === 'meeting') return '';
  return direction === 'inbound' ? ' נכנס' : ' יוצא';
}

// "נציג: …\nלקוח: …" → same lines, each prefixed with an estimated [~mm:ss]
function annotateTranscript(transcript, durationSec) {
  const lines = String(transcript || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  const total = lines.reduce((n, l) => n + l.length, 0) || 1;
  let seen = 0;
  return lines.map(l => {
    const mark = durationSec > 0 ? `[~${mmss((seen / total) * durationSec)}] ` : '';
    seen += l.length;
    return mark + l;
  }).join('\n');
}

// Collect every source of the lead, oldest first. Returns [{ n, header, text }]
async function collectSources(leadId) {
  const [{ rows: interactions }, { rows: messages }, { rows: calls }, { rows: meetings }] = await Promise.all([
    pool.query(`
      SELECT li.id, li.type, li.direction, li.body, li.created_at, u.display_name AS by_name
      FROM lead_interactions li LEFT JOIN users u ON u.id = li.created_by
      WHERE li.lead_id = $1 AND COALESCE(li.body, '') <> ''
        AND li.body NOT LIKE '🔄%' AND li.body NOT LIKE '[תזכורת אוטומטית%'`, [leadId]), // skip stage-change / auto-reminder markers
    pool.query(`
      SELECT m.id, m.channel, m.direction, m.body, m.timestamp AS ts, u.display_name AS by_name
      FROM messages m LEFT JOIN users u ON u.id = m.sent_by
      WHERE m.lead_id = $1 AND COALESCE(m.body, '') <> ''`, [leadId]),
    pool.query(`
      SELECT c.id, c.direction, c.status, c.started_at, c.duration_sec, c.summary, c.transcript, c.interaction_id,
             COALESCE(ua.display_name, uu.display_name) AS rep
      FROM calls c LEFT JOIN users uu ON uu.id = c.user_id LEFT JOIN users ua ON ua.id = c.answered_by
      WHERE c.lead_id = $1`, [leadId]),
    pool.query(`
      SELECT m.id, m.title, m.start_time, m.customer_status, u.display_name AS host
      FROM meetings m LEFT JOIN users u ON u.id = m.host_user_id
      WHERE m.lead_id = $1`, [leadId]),
  ]);

  const callByInteraction = new Map(calls.filter(c => c.interaction_id).map(c => [c.interaction_id, c]));
  const items = [];

  for (const li of interactions) {
    const call = callByInteraction.get(li.id);
    // The call interaction body = summary + "[[TRANSCRIPT]]" + transcript; split them
    const [bodyPart, embedded] = String(li.body).split('[[TRANSCRIPT]]');
    const body = bodyPart.trim();
    if (call || (li.type === 'call' && embedded)) {
      const dur = call?.duration_sec || 0;
      const ts = call?.started_at || li.created_at;
      const transcript = (call?.transcript || embedded || '').trim();
      const head = `שיחה${li.direction === 'inbound' ? ' נכנסת' : ' יוצאת'} · ${fmtWhen(ts)}${(call?.rep || li.by_name) ? ` · ${call?.rep || li.by_name}` : ''}${dur ? ` · משך ${mmss(dur)}` : ''}`;
      const parts = [];
      if (body) parts.push(`סיכום השיחה:\n${body}`);
      if (transcript) parts.push(`תמלול (הזמנים בסוגריים הם הערכה):\n${annotateTranscript(transcript, dur)}`);
      items.push({ ts, header: head, text: parts.join('\n\n') });
    } else {
      const label = TYPE_LABELS[li.type] || li.type;
      items.push({
        ts: li.created_at,
        header: `${label}${dirLabel(li.type, li.direction)} · ${fmtWhen(li.created_at)}${li.by_name ? ` · ${li.by_name}` : ''}`,
        text: body,
      });
    }
  }

  // Calls with a transcript that never got an interaction row
  const usedCalls = new Set(interactions.map(li => callByInteraction.get(li.id)?.id).filter(Boolean));
  for (const c of calls) {
    if (usedCalls.has(c.id) || !(c.transcript || c.summary)) continue;
    const parts = [];
    if (c.summary) parts.push(`סיכום השיחה:\n${c.summary}`);
    if (c.transcript) parts.push(`תמלול (הזמנים בסוגריים הם הערכה):\n${annotateTranscript(c.transcript, c.duration_sec || 0)}`);
    items.push({
      ts: c.started_at,
      header: `שיחה${c.direction === 'inbound' ? ' נכנסת' : ' יוצאת'} · ${fmtWhen(c.started_at)}${c.rep ? ` · ${c.rep}` : ''}${c.duration_sec ? ` · משך ${mmss(c.duration_sec)}` : ''}`,
      text: parts.join('\n\n'),
    });
  }

  for (const m of messages) {
    const who = m.direction === 'inbound' ? 'מהלקוח' : `מאיתנו${m.by_name ? ` (${m.by_name})` : ''}`;
    items.push({ ts: m.ts, header: `הודעת ${TYPE_LABELS[m.channel] || m.channel} ${who} · ${fmtWhen(m.ts)}`, text: String(m.body).trim() });
  }

  for (const m of meetings) {
    items.push({
      ts: m.start_time,
      header: `פגישה ביומן · ${fmtWhen(m.start_time)}${m.host ? ` · מקיים/ת: ${m.host}` : ''}`,
      text: `${m.title || 'פגישה'}${m.customer_status ? ` (סטטוס לקוח: ${m.customer_status})` : ''}`,
    });
  }

  items.sort((a, b) => new Date(a.ts || 0) - new Date(b.ts || 0));
  return items.map((it, i) => ({ n: i + 1, header: `[מקור ${i + 1}] ${it.header}`, text: it.text }));
}

function render(sources) {
  return sources.map(s => `${s.header}\n${s.text}`).join('\n\n———\n\n');
}

// Split the rendered sources into chunks ≤ CHUNK_SIZE. A single oversized source (a very
// long call) is cut on line boundaries and every piece repeats the source header.
function chunkSources(sources) {
  const pieces = [];
  for (const s of sources) {
    if (s.text.length + s.header.length <= CHUNK_SIZE) { pieces.push(`${s.header}\n${s.text}`); continue; }
    let buf = '';
    for (const line of s.text.split('\n')) {
      if (buf.length + line.length + 1 > CHUNK_SIZE - s.header.length - 20) { pieces.push(`${s.header} (המשך)\n${buf}`); buf = ''; }
      buf += (buf ? '\n' : '') + line.slice(0, CHUNK_SIZE - 500);
    }
    if (buf) pieces.push(`${s.header} (המשך)\n${buf}`);
  }
  const chunks = [];
  let cur = '';
  for (const p of pieces) {
    if (cur && cur.length + p.length + 10 > CHUNK_SIZE) { chunks.push(cur); cur = ''; }
    cur += (cur ? '\n\n———\n\n' : '') + p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

async function extractRelevant(openai, chunk, question, leadName) {
  const r = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 1500,
    temperature: 0,
    messages: [{
      role: 'user',
      content: `להלן חלק מההיסטוריה של הליד "${leadName || ''}" במערכת CRM (שיחות מתומללות, הערות, הודעות). כל מקור מתחיל בכותרת "[מקור N] …".
השאלה של המשתמש: "${question}"

העתק מילה במילה כל שורה או משפט שרלוונטיים לשאלה — גם אזכורים עקיפים. לכל ציטוט כתוב קודם את כותרת המקור המלאה שלו (השורה שמתחילה ב-"[מקור N]"), ואם זו שורת תמלול — השאר את סימון הזמן [~דד:שש] שבתחילתה.
אל תסכם, אל תפרש ואל תוסיף דבר משלך. אם אין שום דבר רלוונטי בחלק הזה — החזר רק את המילה: אין

${chunk}`,
    }],
  });
  const out = (r.choices[0]?.message?.content || '').trim();
  return out && out !== 'אין' ? out : '';
}

// Main entry. Returns { lead_name, source_count, mode, text } or { error }
async function searchLeadHistory({ leadId, question, openai, leadName }) {
  const sources = await collectSources(leadId);
  if (!sources.length) return { lead_name: leadName, source_count: 0, mode: 'empty', text: '' };

  const full = render(sources);
  if (full.length <= DIRECT_BUDGET || !question || !openai) {
    return { lead_name: leadName, source_count: sources.length, mode: 'full', text: full.slice(0, DIRECT_BUDGET * 2) };
  }

  let chunks = chunkSources(sources);
  let truncated = false;
  if (chunks.length > MAX_CHUNKS) { chunks = chunks.slice(-MAX_CHUNKS); truncated = true; } // keep the most recent
  const parts = await Promise.all(chunks.map(c => extractRelevant(openai, c, question, leadName).catch(() => '')));
  const text = parts.filter(Boolean).join('\n\n———\n\n');
  return { lead_name: leadName, source_count: sources.length, mode: 'extract', truncated, text };
}

module.exports = { searchLeadHistory, collectSources, annotateTranscript, chunkSources, render };
