// Contract builder (Phase 114) — build a contract in a conversation, like the
// price-offer builder (services/offerBuilder.js), with one extra step Oran asked
// for: the assistant first decides which template fits (regular / package /
// custom agreement), says so with a short reason and WAITS for the user's answer
// ("כן" / "למה?" / "לא, תעשה חבילה") before it goes on. Then it asks whether to
// look in the lead's WhatsApp messages and call transcripts for more details; if
// yes, the server loads the full history for ONE turn and the assistant reports
// what it found and how it would put it in the contract — nothing from the
// history enters the spec before the user approves it.
//
// As in the offer builder the model only returns a structured spec; the server
// normalizes it and decides on its own whether the type was confirmed and what
// is still missing. The client fills the regular contract template from the
// spec (client/src/utils/contractSpec.js) and opens the normal preview.
const { openai } = require('./openaiClient');
const { MODEL } = require('./contractAssistant');
const { loadLeadContext } = require('./offerBuilder');
const { searchLeadHistory } = require('./leadHistorySearch');

const isStr = (v) => typeof v === 'string';
const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[,₪%\s]/g, ''));
  return Number.isFinite(n) && n >= 0 && n <= 10_000_000 ? n : null;
};
const txt = (v, max = 600) => (isStr(v) ? v.trim().slice(0, max) : '');
const time = (v) => (isStr(v) && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim()) ? v.trim() : null);
const date = (v) => (isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) && !Number.isNaN(Date.parse(v.trim())) ? v.trim() : null);
const strList = (v, max = 8, len = 1500) => (Array.isArray(v) ? v.filter(isStr).map(x => x.trim()).filter(Boolean).slice(0, max).map(x => x.slice(0, len)) : []);

const TYPE_HE = { regular: 'חוזה רגיל', package: 'חוזה חבילה', custom: 'הסכם מותאם' };
const TYPES = Object.keys(TYPE_HE);
const HISTORY_Q = 'לבדוק גם בוואטסאפ ובתמלולי השיחות אם נאמרו פרטים נוספים שכדאי להכניס לחוזה?';

const SYSTEM = `You help venue staff build an EVENT CONTRACT (חוזה / הסכם הזמנת אירוע) by conversation in Hebrew. The contract is built from a fixed template; your job is to understand the deal and return it as a structured "spec". The system fills the template. Clause wording you add is written in formal Hebrew contract register ("המזמין", "הספק", "מובהר ומוסכם כי ...").

The three templates:
- "regular" (חוזה רגיל): a price per guest × minimum guests, plus optional service rows (waiters, bartenders, event manager, lighting & sound), in a cost table with totals.
- "package" (חוזה חבילה): one total price for a number of guests.
Both then have: what the price includes, payment terms (a deposit of X% at signing, balance and security cheques before the event), standard cancellation clauses, obligations of the parties.
- "custom" (הסכם מותאם): for a deal that is NOT "the customer pays a price for an event" — a party where the revenue from tickets and the bar is the consideration, a revenue share, a barter, a collaboration, a free or conditional booking. It has no cost table, no price field and no deposit / cheque lines: section 2 (costs / consideration) and section 4 (payment terms) contain only the clauses you write (costAdd, paymentAdd). The list of what the Vendor provides (section 3), the standard cancellation clauses (section 5) and the obligations of the parties (section 6) stay as in the other templates.

STEP 1 — choose the template and stop. The user's first message describes the deal freely (often a pasted summary or a transcribed recording; tolerate informal text and transcription mistakes). Read it together with the LEAD CARD, decide which template fits better, and reply with:
  (a) one line of what you understood ("הבנתי: ..."),
  (b) your recommendation and the reason in one sentence ("זה מתאים יותר לתבנית של חוזה חבילה, כי נקבע מחיר אחד כולל ל-40 איש."),
  (c) the question "להמשיך כך?".
Put your choice in spec.contractType, the reason in spec.typeReason, and set spec.typeConfirmed to false. Ask NOTHING else in this reply — the user must answer first.
If there is no fixed price the customer pays (ticket sales, revenue share, barter...), recommend "custom" and say in the reason that the price table and deposit lines of the other templates would not fit.
- If the user answers yes → typeConfirmed true, go on to step 1b.
- If the user asks why (למה?) → explain in two or three short sentences what in their description points to this template and what the other one would mean, then ask again. typeConfirmed stays false.
- If the user says to use the other template → switch contractType, typeConfirmed true, go on to step 1b.
- If the user's first message already names the template explicitly ("תעשה חוזה חבילה"), you may set typeConfirmed true right away and go on.

STEP 1b — once the template is confirmed, ask exactly this and nothing else: "לבדוק גם בוואטסאפ ובתמלולי השיחות אם נאמרו פרטים נוספים שכדאי להכניס לחוזה?" Record the answer in spec.historyCheck ("yes" / "no"; null until the user answers). You do not have the WhatsApp messages and transcripts until the user says yes — never claim to have checked them before a block named LEAD FULL HISTORY is given to you.

STEP 2 (after the user answered about the history) — ask about what is missing, all open questions together in one short message. Do not ask about what you already know. You must know (ask if not said):
1. Whether the prices are before VAT (לפני מע"מ) or include VAT (כולל מע"מ). Always confirm unless the user said it.
2. Number of guests (use the LEAD CARD if it has one).
3. The price: package → the package price; regular → the price per guest. NEVER invent, estimate or suggest a price; there is no price list. The template's default numbers are not agreed prices.
4. The deposit percent at signing. The usual is 30% — ask "מקדמה 30% כרגיל?" and record the answer in depositPercent.
5. Regular only — the service rows: every TEMPLATE row except id 1 needs a decision. None is in the contract unless the user says so. Ask in one question listing each with its template price; record in serviceRows (include true/false; qty/price only if the user changed them).
6. The event date, if the LEAD CARD has none (eventDate as YYYY-MM-DD).
In a "custom" agreement items 1-5 are not asked at all (there are no prices). Instead you must have at least one clause in costAdd or paymentAdd that says what the consideration is and who pays or receives what — write it from the user's description; ask only if it is unclear. You may set includesHeader to a fitting title for section 3 (e.g. "הספק יעמיד לרשות המזמין:") when "המחיר כולל" does not fit.
Ask once, as optional: the price for each additional guest (answer "אין" → extraGuestPrice 0).

Special terms (anything beyond the template — "אם נכנס אירוע אחר נוכל לדחות", ticket targets, who gets the bar revenue, a second payment date): write each as a full clause and put it where it belongs:
- paymentAdd — payment terms; cancellationAdd — cancellation / postponement terms (these are ADDED after the standard cancellation clauses; you never change or remove the standard ones); obligationsAdd — obligations of the parties; eventAdd — facts about the event (section 1); costAdd — a cost line that is not a table row; includesAdd — things included in the price.
If it is unclear where a term belongs, or what exactly it means in money or dates, ask. Do not add terms the user did not ask for.
Clauses that do not hold together — be sharp about this. Before you say the contract is ready, check the special terms against each other and against the TEMPLATE cancellation and obligations clauses. If two provisions cannot both hold (e.g. the Vendor may postpone the event freely, while a standard clause charges the Orderer for any change of date; cancellation fees that are a percent of "the total sum" when the Orderer pays no sum; a promise of a fixed date next to a right to move it), say it plainly in your reply — which two, and why — and PROPOSE a way out: drop one of them (name it), or reword the added term. Ask the user to decide. Never settle it yourself. Only when the user agrees to drop a standard clause, put its exact text in standardRemove; otherwise the standard clauses are never changed or removed. The first cancellation clause (the one with the free-cancellation date) cannot be removed.
The LEAD CARD and LEAD HISTORY are background. Card facts (name, date, hours, guests) are defaults. Something from the history is NOT agreed until the user says so here — ask about it instead of putting it in the spec.

The spec (always return the FULL current spec; null = not known yet):
{
 "contractType": "regular" | "package" | "custom" | null, "typeReason": string, "typeConfirmed": true | false,
 "historyCheck": "yes" | "no" | null,
 "pricesInclVat": true | false | null,
 "guests": number | null,
 "perGuestPrice": number | null,        // regular only
 "packagePrice": number | null,         // package only
 "extraGuestPrice": number | null,      // 0 = none; null = not discussed
 "depositPercent": number | null,
 "clientName": string | null, "eventDate": "YYYY-MM-DD" | null, "startTime": "HH:MM" | null, "endTime": "HH:MM" | null,   // only when the user changes or adds to what the card says
 "chefMenu": string, "barMenu": string,
 "serviceRows": [{"id": number, "include": true | false, "qty": number, "price": number}],   // regular
 "extraRows": [{"label": string, "desc": string, "qty": number, "price": number}],          // regular: new priced rows
 "includesAdd": [string], "includesRemove": [string — exact lines from TEMPLATE includes],
 "eventAdd": [string], "costAdd": [string], "paymentAdd": [string], "cancellationAdd": [string], "obligationsAdd": [string],
 "standardRemove": [string — exact lines from TEMPLATE cancellation / TEMPLATE obligations the user agreed to drop],
 "includesHeader": string | null          // custom only
}
Prices are numbers exactly as the user said them (the system handles VAT using pricesInclVat).

Answer with ONE JSON object and nothing else:
{"reply": "<Hebrew, short and plain>", "spec": { ... }, "open_questions": true | false}
"open_questions" is true while you are waiting for an answer to anything you asked (including "להמשיך כך?"). When everything needed is known and nothing is open, reply with one short line saying the contract is ready and set it to false.`;

function normalizeSpec(raw, template, { mayConfirm, historyCheck = null, historyDone = false }) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const tplRows = Array.isArray(template?.rows) ? template.rows : [];
  const tplIncludes = Array.isArray(template?.includes) ? template.includes.filter(isStr) : [];
  const contractType = TYPES.includes(s.contractType) ? s.contractType : null;
  const isCustom = contractType === 'custom';
  const tplStandard = [...(Array.isArray(template?.cancellation) ? template.cancellation.slice(1) : []), ...(Array.isArray(template?.obligations) ? template.obligations : [])].filter(isStr);
  const dep = num(s.depositPercent);
  const spec = {
    contractType,
    typeReason: txt(s.typeReason, 400),
    // the server only accepts a confirmation when the user had a chance to answer (see runContractBuilder)
    typeConfirmed: !!contractType && s.typeConfirmed === true && mayConfirm,
    historyCheck, historyDone, // decided by the server (see runContractBuilder)
    pricesInclVat: s.pricesInclVat === true ? true : s.pricesInclVat === false ? false : null,
    guests: num(s.guests) ? Math.round(num(s.guests)) : null,
    perGuestPrice: contractType === 'regular' ? (num(s.perGuestPrice) || null) : null,
    packagePrice: contractType === 'package' ? (num(s.packagePrice) || null) : null,
    extraGuestPrice: isCustom ? null : num(s.extraGuestPrice),
    depositPercent: !isCustom && dep != null && dep <= 100 ? Math.round(dep) : null,
    clientName: txt(s.clientName, 200) || null, eventDate: date(s.eventDate),
    startTime: time(s.startTime), endTime: time(s.endTime),
    chefMenu: txt(s.chefMenu, 300), barMenu: txt(s.barMenu, 300),
    serviceRows: [], extraRows: [],
    includesAdd: strList(s.includesAdd, 12, 400),
    includesRemove: strList(s.includesRemove, 20, 400).filter(x => tplIncludes.includes(x)),
    eventAdd: strList(s.eventAdd), costAdd: strList(s.costAdd), paymentAdd: strList(s.paymentAdd),
    cancellationAdd: strList(s.cancellationAdd), obligationsAdd: strList(s.obligationsAdd),
    standardRemove: strList(s.standardRemove, 20, 3000).filter(x => tplStandard.includes(x)),
    includesHeader: isCustom ? (txt(s.includesHeader, 120) || null) : null,
  };
  if (contractType === 'regular' || !contractType) {
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
  return spec;
}

function missingOf(spec, tplRows = [], hasEventDate = true) {
  const m = [];
  if (!spec.contractType) m.push('חוזה רגיל, חוזה חבילה או הסכם מותאם');
  else if (!spec.typeConfirmed) m.push(`אישור שלך לתבנית (${TYPE_HE[spec.contractType]})`);
  else if (spec.historyCheck == null) m.push('האם לבדוק גם בוואטסאפ ובשיחות');
  if (spec.contractType === 'custom') {
    if (!spec.costAdd.length && !spec.paymentAdd.length) m.push('מה התמורה בעסקה (מי משלם או מקבל מה)');
    if (!hasEventDate && !spec.eventDate) m.push('תאריך האירוע');
    return m;
  }
  if (spec.pricesInclVat == null) m.push('המחירים לפני מע"מ או כולל מע"מ');
  if (!spec.guests) m.push('מספר אורחים');
  if (spec.contractType === 'package' && !spec.packagePrice) m.push('מחיר החבילה');
  if (spec.contractType === 'regular' && !spec.perGuestPrice) m.push('מחיר לאורח');
  if (spec.depositPercent == null) m.push('אחוז המקדמה');
  if (!hasEventDate && !spec.eventDate) m.push('תאריך האירוע');
  if (spec.contractType === 'regular') {
    const undecided = tplRows.filter(r => r.id !== 1 && !spec.serviceRows.some(x => x.id === r.id));
    if (undecided.length) m.push(`האם להוסיף: ${undecided.map(r => r.label).join(', ')}`);
  }
  return m;
}

// messages: [{ role, content }], prevSpec: last normalized spec, template: { rows, includes, eventDate }
async function runContractBuilder({ leadId, messages, prevSpec, template, language }) {
  const history = (Array.isArray(messages) ? messages : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && isStr(m.content) && m.content.trim())
    .slice(-20)
    .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }));
  if (!history.length || history[history.length - 1].role !== 'user') throw new Error('no user message');

  const lead = await loadLeadContext(leadId);
  const tpl = {
    rows: (Array.isArray(template?.rows) ? template.rows : []).slice(0, 30).map(r => ({ id: r.id, label: r.label, desc: r.desc || '', qty: r.qty, price: r.price })),
    includes: (Array.isArray(template?.includes) ? template.includes : []).filter(isStr).slice(0, 40),
  };
  tpl.cancellation = (Array.isArray(template?.cancellation) ? template.cancellation : []).filter(isStr).slice(0, 30);
  tpl.obligations  = (Array.isArray(template?.obligations)  ? template.obligations  : []).filter(isStr).slice(0, 40);
  const hasEventDate = !!(template?.eventDate || lead?.card?.eventDate);
  const context = [
    `LEAD CARD: ${JSON.stringify(lead?.card || {})}`,
    `LEAD HISTORY (background only, newest first — short notes; this is NOT the WhatsApp / transcripts check):\n${(lead?.history || []).join('\n') || '(none)'}`,
    `TEMPLATE rows (regular contract; row id 1 is the per-guest row and its default price is a placeholder, never an agreed price; the other rows are the optional service rows with their usual prices before VAT): ${JSON.stringify(tpl.rows)}`,
    `TEMPLATE includes ("המחיר כולל"): ${JSON.stringify(tpl.includes)}`,
    `TEMPLATE cancellation (section 5, standard clauses): ${JSON.stringify(tpl.cancellation)}`,
    `TEMPLATE obligations (section 6, standard clauses): ${JSON.stringify(tpl.obligations)}`,
    `SPEC SO FAR: ${JSON.stringify(prevSpec || null)}`,
    language === 'en'
      ? 'DOCUMENT LANGUAGE: English. The conversation stays in Hebrew, but every text you put in the spec for the document (clauses in eventAdd / costAdd / paymentAdd / cancellationAdd / obligationsAdd, includesAdd, includesHeader, extraRows label/desc, chefMenu, barMenu) must be written in English contract register ("the Orderer", "the Vendor"). includesRemove and standardRemove still quote the Hebrew TEMPLATE lines exactly.'
      : 'DOCUMENT LANGUAGE: Hebrew.',
  ].join('\n\n');

  const ask = async (extra) => {
    const res = await openai('contract-builder').chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'system', content: context }, ...history, ...(extra ? [{ role: 'system', content: extra }] : [])],
    });
    try { return JSON.parse(res.choices?.[0]?.message?.content || '{}'); } catch { return {}; }
  };
  let out = await ask(null);

  // A confirmation counts only if the template was already proposed in an earlier turn (so the
  // user's last message is an answer to it), or the user named the template themselves.
  const userText = history.filter(m => m.role === 'user').map(m => m.content).join('\n');
  const lastUser = history[history.length - 1].content;
  const namedType = /חביל|חוזה רגיל|תבנית רגיל|הסכם מותאם|\bpackage\b|\bregular\b|\bcustom\b/i.test(userText);
  const mayConfirm = !!(prevSpec && prevSpec.contractType) || namedType;

  // The history question: the answer counts only once the question could have been asked
  // (the template was confirmed in an earlier turn) or the user brought it up themselves.
  const prevHC = prevSpec && (prevSpec.historyCheck === 'yes' || prevSpec.historyCheck === 'no') ? prevSpec.historyCheck : null;
  const mentionsHistory = /וו?אטסאפ|וו?א?צ.?אפ|ווטסאפ|שיחות|שיחה|תמלול|היסטורי/.test(lastUser);
  const modelHC = out.spec && (out.spec.historyCheck === 'yes' || out.spec.historyCheck === 'no') ? out.spec.historyCheck : null;
  let historyCheck = prevHC;
  if (!prevHC && modelHC && ((prevSpec && prevSpec.typeConfirmed) || mentionsHistory)) historyCheck = modelHC;
  else if (prevHC === 'no' && modelHC === 'yes' && mentionsHistory) historyCheck = 'yes'; // changed their mind
  let historyDone = !!(prevSpec && prevSpec.historyDone);
  let historyNote = '';

  // The user said yes → load the whole history for this one turn and answer again with it.
  // Later turns do not get it again: the findings stay in the conversation itself.
  if (historyCheck === 'yes' && !historyDone) {
    historyDone = true;
    let found = null;
    try {
      found = await searchLeadHistory({
        leadId, leadName: lead?.card?.name || '', openai: openai('contract-builder'),
        question: 'כל מה שסוכם או נאמר לגבי העסקה: מחירים, מספר אורחים, תאריכים ושעות, מה כלול, תשלומים ומקדמה, תנאים מיוחדים, ביטול ודחייה, הבטחות והתחייבויות של כל צד',
      });
    } catch (e) { console.error('[ContractBuilder] history load failed:', e.message); }
    if (found && found.text && found.text.trim()) {
      const again = await ask(
        `LEAD FULL HISTORY — the user asked you to check the WhatsApp messages and call transcripts. Here they are (every source starts with a header "[מקור N] <kind> · <date>"${found.truncated ? '; only the most recent part is included' : ''}):\n\n${found.text}\n\n` +
        `Now do this, in one reply:
1. Find details relevant to the contract that are NOT already in the user's description or in SPEC SO FAR: agreed prices, number of guests, dates and hours, what is included, payment arrangements, special conditions, promises made by either side. Something the customer only asked about, or that was offered and not accepted, is not agreed — leave it out, or mention it as unsure.
2. Report them: start with "מצאתי בוואטסאפ ובשיחות:" and a numbered list. For each: the detail, where it was said (kind of source and date, e.g. "וואטסאפ מהלקוח, 12.11" / "שיחה, 14.11"), and how you would put it in the contract — which section and the wording in short, or which field it fills. If something contradicts what the user wrote, say so explicitly and ask which is right.
3. Ask: "להכניס את כולם? אפשר גם לבחור (למשל: רק 1 ו-3) או לתקן."
4. Do NOT put any of these details into the spec in this reply. They enter the spec only after the user approves them in the next message.
5. If you found nothing new, say so in one line ("בדקתי בוואטסאפ ובשיחות, לא מצאתי פרטים נוספים מעבר למה שכתבת.").
6. Then continue with STEP 2: ask what is still missing and that the findings do not answer.
Set spec.historyCheck to "yes". "open_questions" is true if you listed findings or asked anything.`);
      if (again && (isStr(again.reply) || again.spec)) out = again;
    } else {
      historyNote = found ? 'בדקתי: אין בכרטיס הודעות וואטסאפ או תמלולי שיחות.' : 'לא הצלחתי לקרוא כרגע את הוואטסאפ והשיחות, ממשיך בלעדיהם.';
    }
  }

  const spec = normalizeSpec(out.spec, tpl, { mayConfirm, historyCheck, historyDone });

  const missing = missingOf(spec, tpl.rows, hasEventDate);
  const awaitingType = !!spec.contractType && !spec.typeConfirmed;
  const awaitingHistory = spec.typeConfirmed && spec.historyCheck == null;
  const ready = missing.length === 0 && out.open_questions !== true;
  let reply = isStr(out.reply) ? out.reply.trim() : '';
  if (historyNote) reply = `${historyNote}${reply ? '\n' + reply : ''}`;
  if (awaitingType && !/להמשיך/.test(reply)) reply = `${reply ? reply + '\n' : ''}זה מתאים יותר לתבנית של ${TYPE_HE[spec.contractType]}${spec.typeReason ? ` (${spec.typeReason})` : ''}. להמשיך כך?`;
  else if (awaitingHistory && !/וו?אטסאפ/.test(reply)) reply = `${reply ? reply + '\n' : ''}${HISTORY_Q}`;
  else if (!awaitingType && !awaitingHistory && out.open_questions !== true && missing.length) reply = `${reply ? reply + '\n' : ''}חסר לי עוד: ${missing.join(' · ')}.`;
  if (!reply) reply = ready ? 'יש לי הכול, מכין את החוזה.' : 'לא הבנתי, אפשר לנסח שוב?';

  // Quick answers under the template / history questions
  let quickReplies = [];
  if (awaitingType) quickReplies = ['כן, להמשיך', 'למה?', ...TYPES.filter(t => t !== spec.contractType).map(t => `לא, תעשה ${TYPE_HE[t]}`)];
  else if (awaitingHistory) quickReplies = ['כן, תבדוק', 'לא צריך'];
  return { reply, spec, missing, ready, quickReplies };
}

module.exports = { runContractBuilder, normalizeSpec, missingOf };
