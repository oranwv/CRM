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
 "rowEdits": [{"id": number, "qty": number, "price": number, "remove": true}],   // regular: changes to TEMPLATE rows the user asked for (only the properties that change)
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
    rowEdits: [], extraRows: [], extraCostLines: [],
  };
  if (offerType !== 'package') {
    for (const e of Array.isArray(s.rowEdits) ? s.rowEdits.slice(0, 20) : []) {
      if (!e || !tplRows.some(r => r.id === e.id) || e.id === 1) continue; // row 1 (per guest) comes from guests / perGuestPrice
      const out = { id: e.id };
      if (e.remove === true) out.remove = true;
      if (num(e.qty) != null) out.qty = num(e.qty);
      if (num(e.price) != null) out.price = num(e.price);
      if (Object.keys(out).length > 1) spec.rowEdits.push(out);
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

function missingOf(spec) {
  const m = [];
  if (!spec.offerType) m.push('חבילה או הצעה רגילה עם פירוט');
  if (spec.pricesInclVat == null) m.push('המחירים לפני מע"מ או כולל מע"מ');
  if (!spec.guests) m.push('מספר אורחים');
  if (spec.offerType === 'package' && !spec.packagePrice) m.push('מחיר החבילה');
  if (spec.offerType === 'regular' && !spec.perGuestPrice) m.push('מחיר לאורח');
  return m;
}

// messages: [{ role: 'user'|'assistant', content }], prevSpec: last normalized spec, template: { rows, includes }
async function runOfferBuilder({ leadId, messages, prevSpec, template, language }) {
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
    `TEMPLATE rows (regular offer; row id 1 is the per-guest row; these default prices are placeholders, not agreed prices): ${JSON.stringify(tpl.rows)}`,
    `TEMPLATE includes ("המחיר כולל"): ${JSON.stringify(tpl.includes)}`,
    `SPEC SO FAR: ${JSON.stringify(prevSpec || null)}`,
    language === 'en'
      ? 'DOCUMENT LANGUAGE: English. The conversation with the user stays in Hebrew, but every customer-facing text you put in the spec (includesAdd, extraRows label/desc, chefMenu, barMenu, notes, extraCostLines, name if you change it) must be written in English. includesRemove still quotes the Hebrew TEMPLATE lines exactly.'
      : 'DOCUMENT LANGUAGE: Hebrew.',
  ].join('\n\n');

  const res = await openai('offer-builder').chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: SYSTEM }, { role: 'system', content: context }, ...history],
  });
  let out = {};
  try { out = JSON.parse(res.choices?.[0]?.message?.content || '{}'); } catch { out = {}; }

  const spec = normalizeSpec(out.spec, tpl);
  const missing = missingOf(spec);
  const ready = missing.length === 0 && out.open_questions !== true;
  let reply = isStr(out.reply) ? out.reply.trim() : '';
  // The model says "ready" but something required is missing → say so, the server decides.
  if (out.open_questions !== true && missing.length) reply = `${reply ? reply + '\n' : ''}חסר לי עוד: ${missing.join(' · ')}.`;
  if (!reply) reply = ready ? 'יש לי הכול, מכין את ההצעה.' : 'לא הבנתי, אפשר לנסח שוב?';
  return { reply, spec, missing, ready, lead: lead?.card || null };
}

module.exports = { runOfferBuilder, normalizeSpec, missingOf, loadLeadContext };
