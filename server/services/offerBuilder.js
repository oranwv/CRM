// Offer builder (Phase 102) — build a whole price offer in a conversation.
//
// The user first says (records or types) what the offer should be; only then the
// assistant asks about what is missing or unclear. Every turn the model returns
// the full *spec* it understood so far; the server normalizes it and decides on
// its own what is still missing. When nothing is missing the client fills the
// regular price-offer template from the spec (client/src/utils/offerSpec.js) and
// opens the normal preview — the model never writes the document itself and
// never invents a price.
const pool = require('../db/pool');
const { openai } = require('./openaiClient');
const { MODEL } = require('./contractAssistant');

const isStr = (v) => typeof v === 'string';
const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[,₪\s]/g, ''));
  return Number.isFinite(n) && n >= 0 && n <= 10_000_000 ? n : null;
};
const txt = (v, max = 600) => (isStr(v) ? v.trim().slice(0, max) : '');
const time = (v) => (isStr(v) && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim()) ? v.trim() : null);
const strList = (v, max = 12) => (Array.isArray(v) ? v.filter(isStr).map(x => x.trim()).filter(Boolean).slice(0, max).map(x => x.slice(0, 400)) : []);

// How to read a lead's history when the same detail was said more than once (shared with the contract builder).
const RECENCY_RULE = `The sources are in time order, oldest first, and each header carries its date. When the same detail (a price, the number of guests, a date, an hour, a condition) appears more than once, the LATEST statement is the one that counts — an earlier figure that was later changed (a discount, an update, a correction) is superseded: use the later one, and mention the earlier one only in brackets so the user sees the change (e.g. "מחיר לאורח: 300 ש"ח (שיחה, 14.11; קודם דובר על 400)"). A later message that only asks about a change, or an offer the other side did not accept, does not supersede what was agreed before it. If you cannot tell which of two statements is the final one, say so and ask.`;

// "הכן עם מה שיש" (Phase 131): the user stops the questions and wants the document built from
// what was settled in the conversation — and from nothing else. The model gets the conversation
// and the spec so far WITHOUT the lead history, and returns the spec with everything the user
// did not state or approve removed. Shared with the contract builder.
const FINALIZE_SYSTEM = `You are closing a conversation in which venue staff built a document (a price offer or an event contract) with an assistant, in Hebrew. The user pressed "prepare it with what there is". You are given the conversation and SPEC SO FAR (the structured data collected so far). Return the final spec.

The rule: the final spec contains ONLY what was settled in this conversation.
- KEEP a value when the user stated it in the conversation, or the assistant stated or proposed it and the user approved it afterwards ("כן", "נכון", "מאשר", "להכניס", choosing it from a list...). An approval covers exactly what it answered; if the user approved only some items ("רק 1 ו-3"), keep only those.
- REMOVE a value (set it to null, or drop it from its list) when it appears in SPEC SO FAR but the user never stated it and never approved it — for example something the assistant found in the lead's history, WhatsApp or call transcripts and listed, that the user did not confirm; or something the assistant assumed.
- The basic details — the customer's name, the event date, the start and end hours, the number of guests — stay exactly as they are in SPEC SO FAR (they may come from the lead card).
- A question the user did not answer stays unanswered: do not fill it with a default, a usual value or a guess. Never invent a price.
- Do not add anything that is not in SPEC SO FAR, unless the user stated it in the conversation and it is plainly missing from the spec.
- Keep the exact wording of every clause and text you keep. Keep the same JSON shape and field names as SPEC SO FAR.

Answer with ONE JSON object and nothing else: {"spec": { ... }}`;
async function finalizeSpec({ feature, messages, prevSpec, model }) {
  const conv = (Array.isArray(messages) ? messages : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && isStr(m.content) && m.content.trim())
    .slice(-30).map(m => ({ role: m.role, content: m.content.slice(0, 8000) }));
  const res = await openai(feature).chat.completions.create({
    model, temperature: 0, response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: FINALIZE_SYSTEM }, ...conv, { role: 'system', content: `SPEC SO FAR: ${JSON.stringify(prevSpec || {})}\n\nReturn the final spec now.` }],
  });
  let out = {};
  try { out = JSON.parse(res.choices?.[0]?.message?.content || '{}'); } catch { out = {}; }
  return out && typeof out.spec === 'object' && out.spec ? out.spec : null;
}

// What the assistant may know about the lead: the card fields + recent notes / call summaries (capped).
async function loadLeadContext(leadId) {
  const { rows } = await pool.query(
    `SELECT name, event_name, event_type, event_date, event_date_text, event_time, event_end_time,
            guest_count, guest_count_max, budget, notes FROM leads WHERE id = $1`, [leadId]);
  const l = rows[0];
  if (!l) return null;
  const { rows: ints } = await pool.query(
    `SELECT type, direction, body, created_at FROM lead_interactions
     WHERE lead_id = $1 AND type IN ('note','call','meeting') AND body IS NOT NULL AND body <> ''
     ORDER BY created_at DESC LIMIT 8`, [leadId]);
  const history = [];
  let budget = 2500;
  for (const i of ints) {
    // drop file / recording markers and full transcripts — the summary is enough
    const body = String(i.body).split('[[TRANSCRIPT]]')[0].replace(/\[\[[A-Z]+:[^\]]*\]\]/g, '').trim();
    if (!body) continue;
    const line = `${new Date(i.created_at).toISOString().slice(0, 10)} ${i.type}: ${body.slice(0, 500)}`;
    if (line.length > budget) break;
    budget -= line.length;
    history.push(line);
  }
  const date = l.event_date_text || (l.event_date ? new Date(l.event_date).toISOString().slice(0, 10) : '');
  return {
    card: {
      name: l.name || '', eventName: l.event_name || '', eventType: l.event_type || '', eventDate: date,
      startTime: l.event_time || '', endTime: l.event_end_time || '',
      guests: l.guest_count ? (l.guest_count_max ? `${l.guest_count}-${l.guest_count_max}` : String(l.guest_count)) : '',
      budget: l.budget || '', notes: txt(l.notes, 800),
    },
    history,
  };
}

const SYSTEM = `You help venue staff build a PRICE OFFER (הצעת מחיר) for an event, by conversation in Hebrew. The offer is built from a fixed template; your job is only to understand what the user wants and return it as a structured "spec". The system fills the template.

Flow:
- The user's FIRST message describes the offer freely (often a voice recording that was transcribed — tolerate transcription mistakes and informal speech). Extract everything you can from it and from the LEAD CARD.
- Then, and only then, ask about what is missing or unclear — all open questions together in one short message (a short list is fine). Do not ask about things you already know. Do not ask about optional things the user did not bring up, except the one noted below.
- Start your reply with a one-line summary of what you understood ("הבנתי: ..."), so the user can catch a mistake.

You must know these before the offer can be prepared (ask if not said):
1. Offer type: "package" (חבילה — one total price for N guests) or "regular" (הצעה רגילה עם פירוט — a price per guest plus service rows). If the user says "חבילה" / gives one total price → package. If they give a price per guest → regular. If unclear, ask.
2. Whether the prices the user gave are before VAT (לפני מע"מ) or include VAT (כולל מע"מ). Always confirm this unless the user said it.
3. Number of guests.
4. The price: package → the package price; regular → the price per guest. NEVER invent, estimate or suggest a price. There is no price list. If a price was not said, ask for it. The template's default numbers are not a price the user gave.
5. Regular offers only — the service rows. The TEMPLATE has optional service rows (every TEMPLATE row except id 1: waiters, bartenders, event manager, lighting & sound...). NONE of them is in the offer unless the user says so. You must get a decision for EVERY one of them: ask in one question, listing each row with its template price ("להוסיף להצעה גם: שירות מלצרים (500 ש"ח), שירות ברמנים (550 ש"ח), מנהל אירוע (900 ש"ח), תאורה והגברה? אפשר לבחור חלק, ולשנות מחיר או כמות"). Record the answer in serviceRows — one entry per template row id with include true/false; "כן לכולם" → all true, "בלי" / "רק מלצרים" → the rest false. If the user gives a different price or quantity for a row, record it; otherwise leave qty/price out (the template values are used). The price the user gives for a service row is on the same VAT basis as the other prices. Do not ask this for package offers.
Ask once, as optional: the price for each additional guest above the number (the user may answer "אין" / "בלי" → extraGuestPrice 0).

Things that are not part of the template (e.g. "they also get the next-door space for yoga", a DJ, special equipment): ask WHERE to put each one unless the user already said — inside "המחיר כולל" (included in the price → includesAdd), or as a separate item with its own price (regular → extraRows with a price the user gives; package → extraCostLines, a text line with the price). Ask for the price if it is a separate item.
Menus: "תפריט צהריים", "בר יין ובירה" etc. go to chefMenu / barMenu as short descriptions. If the user says the offer has no bar / no food, put the matching template line ("תפריט בר" / "תפריט שף") in includesRemove.
The LEAD CARD and LEAD HISTORY are background. Use card facts (name, date, hours, guests) as defaults without asking. Something from the history (a price mentioned in a call, a request) is NOT agreed until the user says so in this conversation — if it is relevant, ask about it ("בשיחה מה-12.3 דובר על ..., לכלול?") instead of putting it in the spec.

The spec (always return the FULL current spec, including what was understood in earlier turns; null = not known yet):
{
 "offerType": "regular" | "package" | null,
 "pricesInclVat": true | false | null,
 "guests": number | null,
 "perGuestPrice": number | null,        // regular only, as the user said it
 "packagePrice": number | null,         // package only, as the user said it
 "extraGuestPrice": number | null,      // 0 = no extra-guest line; null = not discussed
 "name": string | null, "eventDate": string | null, "doorTime": "HH:MM" | null, "endTime": "HH:MM" | null,   // only when the user changes what the card says
 "chefMenu": string, "barMenu": string, "notes": string,
 "includesAdd": [string], "includesRemove": [string — exact lines from TEMPLATE includes],
 "serviceRows": [{"id": number, "include": true | false, "qty": number, "price": number}],   // regular: the user's decision for each TEMPLATE row other than id 1; leave a row out while it is undecided; qty/price only if the user changed them
 "extraRows": [{"label": string, "desc": string, "qty": number, "price": number}],   // regular: new priced rows
 "extraCostLines": [string]                                                      // package: extra priced lines as text
}
Prices are numbers exactly as the user said them (the system handles VAT using pricesInclVat). Text you write into the spec (includesAdd, labels, menus) is short, clean, customer-facing Hebrew — not the user's spoken phrasing.

Answer with ONE JSON object and nothing else:
{"reply": "<Hebrew, short and plain>", "spec": { ... }, "open_questions": true | false}
"open_questions" is true while you are still waiting for an answer to something you asked. When everything needed is known and nothing is open, reply with one short line saying the offer is ready and set it to false.`;

// Normalize the model's spec against the template; never trust shapes.
function normalizeSpec(raw, template) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const tplRows = Array.isArray(template?.rows) ? template.rows : [];
  const tplIncludes = Array.isArray(template?.includes) ? template.includes.filter(isStr) : [];
  const offerType = s.offerType === 'package' || s.offerType === 'regular' ? s.offerType : null;
  const spec = {
    offerType,
    pricesInclVat: s.pricesInclVat === true ? true : s.pricesInclVat === false ? false : null,
    guests: num(s.guests) ? Math.round(num(s.guests)) : null,
    perGuestPrice: offerType === 'package' ? null : (num(s.perGuestPrice) || null),
    packagePrice: offerType === 'regular' ? null : (num(s.packagePrice) || null),
    extraGuestPrice: num(s.extraGuestPrice),
    name: txt(s.name, 200) || null, eventDate: txt(s.eventDate, 100) || null,
    doorTime: time(s.doorTime), endTime: time(s.endTime),
    chefMenu: txt(s.chefMenu, 300), barMenu: txt(s.barMenu, 300), notes: txt(s.notes, 1500),
    includesAdd: strList(s.includesAdd),
    includesRemove: strList(s.includesRemove, 20).filter(x => tplIncludes.includes(x)),
    serviceRows: [], extraRows: [], extraCostLines: [],
  };
  if (offerType !== 'package') {
    // One decision per template service row (row 1, the per-guest row, comes from guests / perGuestPrice).
    for (const e of Array.isArray(s.serviceRows) ? s.serviceRows.slice(0, 30) : []) {
      if (!e || e.id === 1 || !tplRows.some(r => r.id === e.id) || typeof e.include !== 'boolean') continue;
      if (spec.serviceRows.some(x => x.id === e.id)) continue;
      const out = { id: e.id, include: e.include };
      if (e.include && num(e.qty) != null) out.qty = num(e.qty);
      if (e.include && num(e.price) != null) out.price = num(e.price);
      spec.serviceRows.push(out);
    }
    for (const r of Array.isArray(s.extraRows) ? s.extraRows.slice(0, 10) : []) {
      const label = txt(r?.label, 200);
      if (!label || num(r?.price) == null) continue;
      spec.extraRows.push({ label, desc: txt(r.desc, 300), qty: num(r.qty) == null ? 1 : num(r.qty), price: num(r.price) });
    }
  }
  if (offerType === 'package') spec.extraCostLines = strList(s.extraCostLines, 8);
  return spec;
}

function missingOf(spec, tplRows = []) {
  const m = [];
  if (!spec.offerType) m.push('חבילה או הצעה רגילה עם פירוט');
  if (spec.pricesInclVat == null) m.push('המחירים לפני מע"מ או כולל מע"מ');
  if (!spec.guests) m.push('מספר אורחים');
  if (spec.offerType === 'package' && !spec.packagePrice) m.push('מחיר החבילה');
  if (spec.offerType === 'regular' && !spec.perGuestPrice) m.push('מחיר לאורח');
  if (spec.offerType === 'regular') {
    const undecided = tplRows.filter(r => r.id !== 1 && !spec.serviceRows.some(x => x.id === r.id));
    if (undecided.length) m.push(`האם להוסיף: ${undecided.map(r => r.label).join(', ')}`);
  }
  return m;
}

// messages: [{ role: 'user'|'assistant', content }], prevSpec: last normalized spec, template: { rows, includes }
// fromCard: true on the first turn = "start from what the lead card already holds" (Phase 117)
async function runOfferBuilder({ leadId, messages, prevSpec, template, language, fromCard, finalize }) {
  if (finalize === true) {
    // "הכן את ההצעה עם מה שיש": only what was settled in the conversation (see FINALIZE_SYSTEM)
    const tplF = { rows: (Array.isArray(template?.rows) ? template.rows : []).slice(0, 30), includes: (Array.isArray(template?.includes) ? template.includes : []).filter(isStr).slice(0, 40) };
    const raw = await finalizeSpec({ feature: 'offer-builder', messages, prevSpec, model: MODEL });
    const spec = normalizeSpec(raw || prevSpec, tplF);
    return { reply: '', spec, missing: missingOf(spec, tplF.rows), ready: true, quickReplies: [] };
  }
  const history = (Array.isArray(messages) ? messages : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && isStr(m.content) && m.content.trim())
    .slice(-20)
    .map(m => ({ role: m.role, content: m.content.slice(0, 6000) }));
  if (!history.length || history[history.length - 1].role !== 'user') throw new Error('no user message');

  const lead = await loadLeadContext(leadId);
  const tpl = {
    rows: (Array.isArray(template?.rows) ? template.rows : []).slice(0, 30).map(r => ({ id: r.id, label: r.label, desc: r.desc || '', qty: r.qty, price: r.price })),
    includes: (Array.isArray(template?.includes) ? template.includes : []).filter(isStr).slice(0, 40),
  };
  const context = [
    `LEAD CARD: ${JSON.stringify(lead?.card || {})}`,
    `LEAD HISTORY (background only, newest first):\n${(lead?.history || []).join('\n') || '(none)'}`,
    `TEMPLATE rows (regular offer; row id 1 is the per-guest row and its default price is a placeholder, never an agreed price; the other rows are the optional service rows with their usual prices before VAT): ${JSON.stringify(tpl.rows)}`,
    `TEMPLATE includes ("המחיר כולל"): ${JSON.stringify(tpl.includes)}`,
    `SPEC SO FAR: ${JSON.stringify(prevSpec || null)}`,
    language === 'en'
      ? 'DOCUMENT LANGUAGE: English. The conversation with the user stays in Hebrew, but every customer-facing text you put in the spec (includesAdd, extraRows label/desc, chefMenu, barMenu, notes, extraCostLines, name if you change it) must be written in English. includesRemove still quotes the Hebrew TEMPLATE lines exactly.'
      : 'DOCUMENT LANGUAGE: Hebrew.',
  ].join('\n\n');

  const ask = async (extra) => {
    const res = await openai('offer-builder').chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'system', content: context }, ...history, ...(extra ? [{ role: 'system', content: extra }] : [])],
    });
    try { return JSON.parse(res.choices?.[0]?.message?.content || '{}'); } catch { return {}; }
  };

  // Start from the lead card (Phase 117): the user did not describe the offer — the assistant reads
  // the card and the whole history (WhatsApp, call transcripts and summaries, notes), says what it
  // understood (the latest statement winning), asks about what is missing and waits for the user to
  // confirm. Nothing enters the spec before that.
  const cardStart = fromCard === true && !prevSpec && history.length === 1;
  let out, cardNote = '';
  if (cardStart) {
    let found = null;
    try {
      found = await require('./leadHistorySearch').searchLeadHistory({
        leadId, leadName: lead?.card?.name || '', openai: openai('offer-builder'),
        question: 'כל מה שנאמר או סוכם לגבי האירוע וההצעה: סוג האירוע, מחירים, מספר אורחים, תאריכים ושעות, תפריט ובר, מה כלול, תוספות ובקשות מיוחדות',
      });
    } catch (e) { console.error('[OfferBuilder] history load failed:', e.message); }
    const text = found && found.text ? found.text.trim() : '';
    if (!found) cardNote = 'לא הצלחתי לקרוא כרגע את הוואטסאפ והשיחות, אז זה רק לפי הפרטים הכלליים בכרטיס.';
    out = await ask(
      `The user asked you to START FROM THE LEAD CARD instead of describing the offer. Work only from the LEAD CARD above and from this LEAD FULL HISTORY (WhatsApp messages, call transcripts and summaries, notes; every source starts with a header "[מקור N] <kind> · <date>"${found && found.truncated ? '; only the most recent part is included' : ''}):\n\n${text || '(the card has no WhatsApp messages, call transcripts or notes)'}\n\n` +
      `${RECENCY_RULE}
Now, in one reply:
1. Start with "זה מה שהבנתי מהכרטיס:" and a numbered list of what the offer should be as things stand now: the customer, the kind of event, date and hours, number of guests, package or price per guest, the price and its VAT basis if it was said, menu and bar, what is included, extras and special requests. For each item say where it comes from (kind of source and date; "כרטיס הליד" for card fields). Leave out what was only asked about and not settled. Do not fill gaps with guesses and never invent a price — what was not said is simply not in the list.
2. If nothing useful is there, say so in one line and ask the user to describe the offer.
3. Then ask, in the same reply, about everything that is still missing or unclear for the offer (the usual required items), as a short list.
4. End with: "זה נכון? אפשר לתקן, ולענות על השאלות באותה הודעה."
5. Do NOT put the listed details into the spec in this reply — return the spec with nulls. When the user confirms or corrects in the next message, put the (corrected) details and their answers into the spec and continue as usual.
"open_questions" is true.`);
  } else {
    out = await ask(null);
  }

  const spec = normalizeSpec(out.spec, tpl);
  const missing = missingOf(spec, tpl.rows);
  const ready = !cardStart && missing.length === 0 && out.open_questions !== true; // a card start always waits for the user's confirmation
  let reply = isStr(out.reply) ? out.reply.trim() : '';
  if (cardNote) reply = `${cardNote}${reply ? '\n' + reply : ''}`;
  // The model says "ready" but something required is missing → say so, the server decides.
  if (!cardStart && out.open_questions !== true && missing.length) reply = `${reply ? reply + '\n' : ''}חסר לי עוד: ${missing.join(' · ')}.`;
  if (!reply) reply = ready ? 'יש לי הכול, מכין את ההצעה.' : 'לא הבנתי, אפשר לנסח שוב?';
  return { reply, spec: cardStart ? normalizeSpec({}, tpl) : spec, missing, ready, lead: lead?.card || null, quickReplies: cardStart ? ['כן, זה נכון'] : [] };
}

module.exports = { runOfferBuilder, normalizeSpec, missingOf, loadLeadContext, RECENCY_RULE, finalizeSpec };
