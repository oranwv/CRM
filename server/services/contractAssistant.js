// Contract assistant (Phase 90) — chat inside the contract preview that drafts,
// adds, rewords or removes clauses and changes numbers.
//
// The model never rewrites the contract. It sees an *outline* (every editable
// piece with an id) and answers with a short reply plus, optionally, a proposal:
// a list of small targeted operations. The server validates each operation
// against the contract it was given and describes it in plain Hebrew (where,
// before, after). Nothing changes until the user approves; the client then
// applies exactly those operations to its own state (client/src/utils/contractOps.js),
// so a clause the user did not ask about cannot change.
//
// The contract shape is the one the modal sends everywhere else:
//   { fields, rows, texts, calculated, offerType, language }
const { openai } = require('./openaiClient');

const MODEL = process.env.CONTRACT_ASSISTANT_MODEL || 'gpt-4.1';
const MAX_TEXT = 3000;

// Lists a line can be added to / removed from. `num` = the numbering the document prints.
const LISTS = {
  eventExtraLines:   { he: 'סעיף 1 (האירוע)',            num: null },
  costExtraLines:    { he: 'סעיף 2 (עלויות)',            num: null },
  includes:          { he: 'סעיף 3 (המחיר כולל)',                        num: '3' },
  paymentExtras:     { he: 'סעיף 4 (תנאי תשלום)', num: null },
  cancellationItems: { he: 'סעיף 5 (ביטול האירוע)',                      num: '5' },
  obligations:       { he: 'סעיף 6 (התחייבויות והצהרות הצדדים)',         num: '6' },
  legalParagraphs:   { he: 'פסקאות הסיום (אחרי סעיף 6)',                 num: null },
};

// Fixed single texts that can be reworded (never deleted — an empty value would
// fall back to a default on the signing page). Order = document order.
const SCALARS = [
  ['title',                'כותרת החוזה'],
  ['whereas1',             'מבוא — "הואיל" ראשון'],
  ['whereas2',             'מבוא — "והואיל" שני'],
  ['therefore',            'מבוא — "לפיכך"'],
  ['preamble',             'מבוא — פסקת המבוא'],
  ['packageCostLine',      'סעיף 2 (עלויות) — שורת מחיר החבילה'],
  ['packageExtraLine',     'סעיף 2 (עלויות) — שורת אורח נוסף בחבילה'],
  ['includesHeader',       'כותרת סעיף 3'],
  ['paymentHeader',        'כותרת סעיף 4'],
  ['depositLine',          'סעיף 4 — שורת המקדמה, הטקסט שלפני הסכום'],
  ['depositSuffix',        'סעיף 4 — שורת המקדמה, הטקסט שבין הסכום לסכום כולל מע"מ'],
  ['finalSettlementIntro', 'סעיף 4 — פסקת "מועד גמר החשבון"'],
  ['securityCheckPre',     'סעיף 4 — המחאת ביטחון, הטקסט שלפני הסכום'],
  ['securityCheckSuf',     'סעיף 4 — המחאת ביטחון, הטקסט שאחרי הסכום'],
  ['reserveCheckPre',      'סעיף 4 — המחאת רזרבה, הטקסט שלפני הסכום'],
  ['reserveCheckSuf',      'סעיף 4 — המחאת רזרבה, הטקסט שאחרי הסכום'],
  ['checksUsageNote',      'סעיף 4 — פסקת השימוש בהמחאות'],
  ['paymentNote',          'סעיף 4 — הערת "חשוב לציין"'],
  ['cancellationHeader',   'כותרת סעיף 5'],
  ['obligationsHeader',    'כותרת סעיף 6'],
];
const SCALAR_LABEL = Object.fromEntries(SCALARS);
// Pieces a custom agreement does not show (see buildContractHtml)
const CUSTOM_HIDDEN = new Set(['packageCostLine', 'packageExtraLine', 'depositLine', 'depositSuffix', 'finalSettlementIntro', 'securityCheckPre', 'securityCheckSuf', 'reserveCheckPre', 'reserveCheckSuf', 'checksUsageNote', 'paymentNote']);

// Fields the assistant may set. type: int | money | date | time | text
const FIELDS = {
  clientName:             { he: 'שם המזמין (לכבוד)',            type: 'text' },
  eventDate:              { he: 'תאריך האירוע',                  type: 'date' },
  startTime:              { he: 'שעת התחלה',                     type: 'time' },
  endTime:                { he: 'שעת סיום',                      type: 'time' },
  guests:                 { he: 'מינימום אורחים',                type: 'int',   only: 'regular' },
  extraGuestPrice:        { he: 'מחיר לאורח נוסף (לפני מע"מ)',   type: 'money', only: 'regular' },
  chefMenu:               { he: 'תפריט שף',                      type: 'text' },
  barMenu:                { he: 'תפריט בר',                      type: 'text' },
  depositPercent:         { he: 'אחוז מקדמה',                    type: 'int',   notIn: 'custom' },
  packageGuests:          { he: 'מספר אורחים בחבילה',            type: 'int',   only: 'package' },
  packageTotal:           { he: 'מחיר החבילה',                   type: 'money', only: 'package' },
  packageExtraGuestPrice: { he: 'מחיר אורח נוסף בחבילה',         type: 'money', only: 'package' },
};

// ── Price offer (Phase 102): the same assistant on the price-offer preview. Sent with kind: 'offer'. ──
const OFFER_LISTS = {
  venueDescItems:   { he: 'מפרט המקום',            num: null },
  packageCostLines: { he: 'עלויות (שורות החבילה)',  num: null },
  includes:         { he: 'המחיר כולל',             num: null },
  extras:           { he: 'תוספות (אופציונלי)',     num: null },
};
const OFFER_SCALARS = [
  ['title',           'כותרת ההצעה'],
  ['arrival',         'שורת ההגעה'],
  ['venueDescHeader', 'כותרת מפרט המקום'],
  ['venueDescIntro',  'פתיח מפרט המקום'],
  ['costsHeader',     'כותרת העלויות'],
  ['minGuestsPrefix', 'שורת מינימום האורחים — הטקסט שלפני המספר'],
  ['minGuestsSuffix', 'שורת מינימום האורחים — הטקסט שאחרי המספר'],
  ['includesHeader',  'כותרת "המחיר כולל"'],
  ['extrasHeader',    'כותרת התוספות'],
  ['payment',         'תנאי תשלום'],
  ['validity',        'תוקף ההצעה'],
  ['closing',         'שורת הסיום'],
];
const OFFER_FIELDS = {
  name:            { he: 'לכבוד',                         type: 'text' },
  eventDate:       { he: 'תאריך האירוע (טקסט חופשי)',     type: 'text' },
  doorTime:        { he: 'שעת פתיחת דלתות',               type: 'time' },
  endTime:         { he: 'שעת סיום',                      type: 'time' },
  guests:          { he: 'מספר אורחים (מינימום)',         type: 'int',   only: 'regular' },
  extraGuestPrice: { he: 'מחיר לאורח נוסף (לפני מע"מ)',   type: 'money', only: 'regular' },
  chefMenu:        { he: 'תפריט שף',                      type: 'text' },
  barMenu:         { he: 'תפריט בר',                      type: 'text' },
  notes:           { he: 'הערות',                         type: 'longtext' },
};
// A field belongs to the document when its type matches (only) and it is not excluded (notIn).
const fieldAllowed = (def, offerType) => {
  const type = offerType === 'package' || offerType === 'custom' ? offerType : 'regular';
  return !(def.only && def.only !== type) && def.notIn !== type;
};
const CONTRACT_DOC = { LISTS, SCALAR_LABEL, FIELDS, noun: 'חוזה' };
const OFFER_DOC    = { LISTS: OFFER_LISTS, SCALAR_LABEL: Object.fromEntries(OFFER_SCALARS), FIELDS: OFFER_FIELDS, noun: 'הצעת מחיר' };
const docOf = (contract) => (contract && contract.kind === 'offer' ? OFFER_DOC : CONTRACT_DOC);

function buildOfferOutline(offer) {
  const { fields = {}, rows = [], texts = {}, calculated = {}, offerType = 'regular', language = 'he', withVat = true } = offer;
  const isPackage = offerType === 'package';
  const L = [];
  const scalar = (key) => { if (isStr(texts[key]) && texts[key].trim()) L.push(`[texts.${key}] ${texts[key]}`); };
  const list = (key) => {
    const arr = Array.isArray(texts[key]) ? texts[key] : [];
    if (!arr.length) L.push(`(list ${key} is empty)`);
    arr.forEach((t, i) => L.push(`[texts.${key}[${i}]] ${t}`));
  };
  const money = (n) => `${Number(n || 0).toLocaleString('en-US')} ₪`;
  L.push(`PRICE OFFER TYPE: ${isPackage ? 'package' : 'regular'} · DOCUMENT LANGUAGE: ${language === 'en' ? 'English' : 'Hebrew'} · ${withVat ? 'the offer shows VAT (18%)' : 'the offer is shown without VAT'}`);
  L.push('');
  L.push('== FIELDS (change with set_field) ==');
  for (const [k, def] of Object.entries(OFFER_FIELDS)) {
    if (def.only && def.only !== (isPackage ? 'package' : 'regular')) continue;
    L.push(`${k} = ${JSON.stringify(fields[k] ?? '')}   (${def.he})`);
  }
  if (!isPackage) {
    L.push('');
    L.push('== COST ROWS (set_row / add_row / delete_row; prices are before VAT) ==');
    rows.forEach((r, i) => L.push(r.isPct
      ? `row ${i}: "${r.label}" — ${r.pct || 0}% of the fixed rows (percent row: only label/desc can change)`
      : `row ${i}: "${r.label}"${r.desc ? ` (${r.desc})` : ''} — qty ${r.qty}, price ${r.price}`));
    L.push(`== COMPUTED (read only) == subtotal before VAT ${money(calculated.subtotal)}, VAT ${money(calculated.vat)}, total ${money(calculated.total)}`);
  }
  L.push('');
  L.push('== DOCUMENT (in order) ==');
  scalar('title'); scalar('arrival');
  L.push('-- venue description --'); scalar('venueDescHeader'); scalar('venueDescIntro'); list('venueDescItems');
  L.push('-- costs --'); scalar('costsHeader');
  if (isPackage) { L.push('(in a package offer the prices are these plain text lines — change a price by replacing the line text)'); list('packageCostLines'); }
  else { L.push('(cost rows table and totals, built from the rows)'); scalar('minGuestsPrefix'); L.push(`   {guests: ${fields.guests || ''}}`); scalar('minGuestsSuffix'); }
  L.push('-- the price includes --'); scalar('includesHeader'); list('includes');
  L.push('-- optional extras --'); scalar('extrasHeader'); list('extras');
  L.push('-- closing --'); scalar('payment'); scalar('validity'); scalar('closing');
  return L.join('\n');
}

const OFFER_MODE = `OFFER MODE — the document in front of the user is a PRICE OFFER (הצעת מחיר), not a contract. Everything above applies with these differences:
- Lists for "add"/"delete": venueDescItems (venue description), includes ("המחיר כולל" — things included in the price), extras (optional extras, each line usually "<item>: <price> ש"ח לא כולל מע"מ"), packageCostLines (package offers only: the price lines).
- There are no sections 1-6, no deposit computation and no cancellation list; ignore the rules about them.
- Cost rows (regular offers): besides set_row you may use {"op":"add_row","label":"...","desc":"...","qty":<number>,"price":<number>} (price before VAT) and {"op":"delete_row","row":<n>}.
- Register: a price offer is a commercial, inviting document — clear, warm, professional Hebrew; not legal language. The "Drafting quality" rules about legal formulas do not apply; the rules about not repeating a draft and using dictated words do.
- When the user asks to add something and it is not clear whether it is included in the price ("includes") or costs extra (a cost row / an "extras" line), ask.
- Never invent a price. If a price is needed and the user did not say it, ask.`;

const isStr = (v) => typeof v === 'string';
const clean = (v) => String(v ?? '').replace(/\s+\n/g, '\n').trim();

function parseTarget(target) {
  const m = /^texts\.([A-Za-z0-9_]+)(?:\[(\d+)\])?$/.exec(String(target || ''));
  if (!m) return null;
  return { key: m[1], index: m[2] == null ? null : Number(m[2]) };
}

// Plain-text outline of the contract in document order, every editable piece tagged with its id.
function buildOutline(contract) {
  if (contract && contract.kind === 'offer') return buildOfferOutline(contract);
  const { fields = {}, rows = [], texts = {}, calculated = {}, offerType = 'regular', language = 'he' } = contract;
  const isPackage = offerType === 'package';
  const isCustom = offerType === 'custom'; // "הסכם מותאם": no cost table and no standard payment lines
  const L = [];
  const scalar = (key) => { if (isStr(texts[key]) && texts[key].trim()) L.push(`[texts.${key}] ${texts[key]}`); };
  const list = (key) => {
    const arr = Array.isArray(texts[key]) ? texts[key] : [];
    const num = LISTS[key].num;
    if (!arr.length) L.push(`(list ${key} is empty)`);
    arr.forEach((t, i) => L.push(`[texts.${key}[${i}]] ${num ? `${num}.${i + 1} ` : ''}${t}`));
  };
  const money = (n) => `${Number(n || 0).toLocaleString('en-US')} ₪`;

  L.push(`CONTRACT TYPE: ${isCustom ? 'custom agreement (הסכם מותאם) — there is NO cost table, NO price field and NO standard deposit / cheque lines; the costs (section 2) and the payment terms (section 4) are only the free clauses in costExtraLines and paymentExtras' : isPackage ? 'package' : 'regular'} · DOCUMENT LANGUAGE: ${language === 'en' ? 'English' : 'Hebrew'}`);
  L.push('');
  L.push('== FIELDS (change with set_field) ==');
  for (const [k, def] of Object.entries(FIELDS)) {
    if (!fieldAllowed(def, offerType)) continue;
    L.push(`${k} = ${JSON.stringify(fields[k] ?? '')}   (${def.he})`);
  }
  if (!isPackage && !isCustom) {
    L.push('');
    L.push('== COST ROWS (change with set_row; prices are before VAT) ==');
    rows.forEach((r, i) => L.push(r.isPct
      ? `row ${i}: "${r.label}" — ${r.pct || 0}% of the fixed rows (percent row: only label/desc can change)`
      : `row ${i}: "${r.label}"${r.desc ? ` (${r.desc})` : ''} — qty ${r.qty}, price ${r.price}`));
  }
  L.push('');
  if (!isCustom) L.push(`== COMPUTED (read only) == subtotal before VAT ${money(calculated.subtotal)}, VAT ${money(calculated.vat)}, total ${money(calculated.total)}, deposit ${money(calculated.depositAmount)} before VAT / ${money(calculated.depositAmountVat)} incl. VAT, balance ${money(calculated.remainingBalance)}`);
  L.push('');
  L.push('== DOCUMENT (in order) ==');
  ['title', 'whereas1', 'whereas2', 'therefore', 'preamble'].forEach(scalar);
  L.push('-- 1. The event: date, venue, start and end time (from the fields) --');
  list('eventExtraLines');
  L.push('-- 2. Costs --');
  if (isCustom) L.push('(no cost table — only the clauses below)');
  else if (isPackage) { scalar('packageCostLine'); scalar('packageExtraLine'); }
  else L.push('(the cost rows table, totals, minimum guests line and extra-guest line are built from the fields and rows)');
  list('costExtraLines');
  L.push('-- 3. --'); scalar('includesHeader'); list('includes');
  L.push('-- 4. --'); scalar('paymentHeader');
  if (!isCustom) {
  scalar('depositLine');
  L.push(`   {deposit amount: ${texts.depositAmtLabel ?? money(calculated.depositAmount)} ${texts.depositPctLabel ?? `(${fields.depositPercent}%)`}}`);
  scalar('depositSuffix');
  L.push(`   {deposit incl. VAT: ${texts.depositAmtVatLabel ?? money(calculated.depositAmountVat)}}`);
  scalar('finalSettlementIntro');
  scalar('securityCheckPre'); L.push(`   {balance cheque amount: ${texts.remainderAmtLabel || money(calculated.remainingBalance)}}`); scalar('securityCheckSuf');
  scalar('reserveCheckPre'); L.push(`   {reserve cheque amount: ${texts.reserveAmtLabel || money(Math.round((calculated.total || 0) * 0.1))}}`); scalar('reserveCheckSuf');
  scalar('checksUsageNote'); scalar('paymentNote');
  }
  list('paymentExtras');
  L.push('-- 5. --'); scalar('cancellationHeader'); list('cancellationItems');
  L.push(`   (item 5.1 is followed automatically by the date ${texts.cancellationDateLabel || calculated.cancellationDate || ''})`);
  L.push('-- 6. --'); scalar('obligationsHeader'); list('obligations');
  L.push('-- closing paragraphs --'); list('legalParagraphs');
  return L.join('\n');
}

const SYSTEM = `You are the contract assistant inside the CRM of an event venue. The user (venue staff) is looking at the preview of ONE event contract and talks to you in Hebrew to draft a new clause, add it somewhere, reword or remove an existing clause, or change a number. You are given the contract as an outline in which every editable piece has an id in [brackets].

How you work — a conversation first, never a silent change:
1. When the user asks for a change, write the wording and PROPOSE it: return "proposal" with the operations, and in "reply" say in one or two short Hebrew sentences what you prepared and where it will go, and ask whether to apply it. The interface shows the exact text and location from your operations, so do not repeat the full clause text in "reply".
2. Nothing is applied until the user approves. If a proposal is pending (it is given to you as PENDING PROPOSAL) and the user clearly approves it in words (כן / תוסיף / מאשר / בסדר...), return "apply_pending": true with "proposal": null. If the user asks to adjust it, return a new full proposal that replaces the pending one. If the user declines, return "proposal": null and acknowledge.
3. If the request is unclear (which clause? what exactly should it say? where?), ask ONE short question and return "proposal": null. If it is only a question about the contract, answer it and return "proposal": null.

Hard rule — touch only what was asked:
- A proposal contains ONLY the operations needed for the user's request. Adding a clause = one "add" operation and nothing else. Rewording clause X = one "replace" on X and nothing else.
- Never reword, reorder, renumber, "fix" or "improve" anything the user did not ask about, even if you notice a typo or an inconsistency. If you notice a real conflict with another clause, mention it in "reply" and let the user decide.
- In a "replace", keep every part of the existing text that the user did not ask to change exactly as it is, character for character.

Operations (JSON objects in proposal.ops):
- {"op":"add","list":"<list>","index":<number|null>,"text":"..."} — add a line/clause to a list. Lists: eventExtraLines (section 1), costExtraLines (section 2), includes (section 3), paymentExtras (section 4 — "under payment terms" goes here), cancellationItems (section 5), obligations (section 6), legalParagraphs (closing paragraphs). "index" is the position the new line will have (0 = first); null = at the end. Use null unless the user asked for a specific place. In cancellationItems index 0 is not allowed.
- {"op":"replace","target":"<id>","text":"..."} — new full text for an existing piece, e.g. "texts.cancellationItems[1]" or "texts.paymentNote".
- {"op":"delete","target":"<id>"} — remove a list item (ids ending with [n]). Fixed pieces without [n] cannot be deleted, only reworded; texts.cancellationItems[0] cannot be deleted.
- {"op":"set_field","field":"<name>","value":"..."} — change a field. Dates are YYYY-MM-DD, times HH:MM, numbers are plain digits.
- {"op":"set_row","row":<n>,"qty":<number>,"price":<number>,"label":"...","desc":"..."} — change a cost row (regular contract only; include only the properties that change; price is before VAT).

Numbers: amounts shown in {braces} are computed from the fields and rows — change them by changing the field/row, never by writing a number into a text. If a new clause needs an amount (e.g. a second payment), compute it from the COMPUTED values and write it in the clause text. Do not write clause numbers ("5.5") inside the text of list items in sections 3, 5 and 6 — the document numbers them itself.
In a regular contract the minimum number of guests is the field "guests" and usually also the qty of the per-guest cost row; when the user changes the number of guests and both hold the same number, change both.

Drafting quality — you write like an experienced Israeli commercial-contracts lawyer, not like a chat summary:
- A clause is a complete, self-standing provision. State (a) the condition that triggers it, (b) who owes what to whom, (c) the amount and what it is (and whether it is in addition to, or instead of, sums already paid), (d) when and how it is paid, and (e) the consequence or a clarification that closes the obvious loophole. One or two full sentences; never a bare restatement of the user's request.
- Use the register and terms of this contract: "המזמין", "הספק", "מועד האירוע", "המקדמה", "הסכם זה", and standard formulas where they fit: "מובהר ומוסכם כי", "למען הסר ספק", "מבלי לגרוע מהאמור", "וזאת בנוסף ל...", "לא יאוחר מ-", "כתנאי ל-". Amounts are written as "סך של 12,004 ש"ח" and tied to what they are ("בגובה המקדמה").
- Example. Request: "אם האירוע נדחה צריך לשלם את המקדמה שוב". Weak (do NOT write like this): "במקרה של דחיית האירוע למועד אחר, המזמין יידרש לשלם את עלות המקדמה שוב בסך 12,004 ש"ח." Good: "מובהר ומוסכם כי בכל מקרה של דחיית מועד האירוע לבקשת המזמין, ישלם המזמין לספק מקדמה נוספת בסך של 12,004 ש"ח (בגובה המקדמה ששולמה במעמד חתימת הסכם זה), וזאת בנוסף למקדמה שכבר שולמה. תשלום המקדמה הנוספת יבוצע לא יאוחר מ-7 ימים ממועד אישור הספק לדחייה, ויהווה תנאי לשריון המועד החדש."
- Do not add new substantive terms the user did not ask for (penalties, non-refundability, interest). Filling in mechanics (who, when, how) is fine.
- When details you invented matter (who asked for the postponement, number of days, whether the sum is credited against the balance), say so in one short sentence in "reply" so the user can correct them — but still give a full draft rather than asking, unless the request is truly unclear.
- When the user asks for another version ("יותר משפטי", "נסח אחרת", "תשפר"), the new text MUST be substantively different from the previous one — different structure and fuller legal wording. Returning the same or nearly the same sentence is a failure.
- When the user dictates exact words ("תכתוב במקום זה ..."), use the user's words as they are and only complete them into a proper sentence.
- If the clause the user is talking about was already added to the contract, a new version is a "replace" of that clause, not a second "add".

Language: write clause text in the DOCUMENT LANGUAGE (formal contract register, consistent with the existing wording and terms — in Hebrew: "המזמין", "הספק"; in English: "the Orderer", "the Vendor"). Always write "reply" in Hebrew, short and plain. You draft wording; you are not a lawyer and you do not give legal advice.

Answer with ONE JSON object and nothing else:
{"reply":"<Hebrew>","proposal":null | {"ops":[...]},"apply_pending":false}`;

// Validate one op against the contract; returns { op, display } or { error }.
function checkOp(raw, contract) {
  const { fields = {}, rows = [], texts = {}, offerType = 'regular' } = contract;
  const { LISTS, SCALAR_LABEL, FIELDS, noun } = docOf(contract); // contract or price-offer vocabulary
  const isPackage = offerType === 'package';
  const isCustom = contract.kind !== 'offer' && offerType === 'custom';
  const op = raw && raw.op;
  if (contract.kind === 'offer' && (raw?.list === 'packageCostLines' || /^texts\.packageCostLines/.test(String(raw?.target || ''))) && !isPackage)
    return { error: 'אין שורות חבילה בהצעה רגילה' };

  if (isCustom && (op === 'add_row' || op === 'delete_row' || op === 'set_row')) return { error: 'בהסכם מותאם אין טבלת עלויות' };
  if (op === 'add_row' || op === 'delete_row') {
    if (isPackage) return { error: `ב${noun} חבילה אין טבלת עלויות` };
    if (op === 'delete_row') {
      const row = Number.isInteger(raw.row) ? rows[raw.row] : null;
      if (!row) return { error: `שורת עלות לא נמצאה: ${raw.row}` };
      return {
        op: { op: 'delete_row', row: raw.row, rowId: row.id ?? null, before: { label: row.label } },
        display: { kind: 'delete', where: `טבלת העלויות — שורה ${raw.row + 1}`, before: `${row.label}${row.isPct ? '' : ` · כמות ${row.qty} · מחיר ${row.price}`}`, after: null },
      };
    }
    const label = clean(raw.label), desc = clean(raw.desc);
    const qty = raw.qty == null ? 1 : Number(raw.qty), price = Number(raw.price);
    if (!label || label.length > 300 || desc.length > 300) return { error: 'שם פריט לא תקין' };
    if (![qty, price].every(n => Number.isFinite(n) && n >= 0 && n <= 10_000_000)) return { error: 'מספר לא תקין (חסר מחיר?)' };
    return {
      op: { op: 'add_row', label, desc, qty, price },
      display: { kind: 'add', where: 'טבלת העלויות — שורה חדשה בסוף', before: null, after: `${label}${desc ? ` (${desc})` : ''} · כמות ${qty} · מחיר ${price} לפני מע"מ` },
    };
  }

  if (op === 'add') {
    const def = LISTS[raw.list];
    if (!def) return { error: `רשימה לא מוכרת: ${raw.list}` };
    const text = clean(raw.text);
    if (!text) return { error: 'טקסט ריק' };
    if (text.length > MAX_TEXT) return { error: 'הטקסט ארוך מדי' };
    const arr = Array.isArray(texts[raw.list]) ? texts[raw.list] : [];
    let index = Number.isInteger(raw.index) ? Math.max(0, Math.min(raw.index, arr.length)) : arr.length;
    if (raw.list === 'cancellationItems' && index === 0 && arr.length) index = arr.length;
    const where = def.num
      ? `${def.he} — יתווסף כסעיף ${def.num}.${index + 1}${index < arr.length ? ' (הסעיפים שאחריו יזוזו מספר אחד)' : ''}`
      : (index < arr.length ? `${def.he} — לפני "${arr[index].slice(0, 40)}…"` : `${def.he} — שורה חדשה בסוף הסעיף`);
    return { op: { op: 'add', list: raw.list, index, text }, display: { kind: 'add', where, before: null, after: text } };
  }

  if (op === 'replace' || op === 'delete') {
    const t = parseTarget(raw.target);
    if (!t) return { error: `יעד לא תקין: ${raw.target}` };
    let before, where;
    if (t.index == null) {
      if (!SCALAR_LABEL[t.key] || !isStr(texts[t.key]) || !texts[t.key].trim() || (isCustom && CUSTOM_HIDDEN.has(t.key))) return { error: `אי אפשר לשנות את ${raw.target}` };
      if (op === 'delete') return { error: 'אי אפשר למחוק טקסט קבוע, רק לנסח אותו מחדש' };
      before = texts[t.key]; where = SCALAR_LABEL[t.key];
    } else {
      const def = LISTS[t.key];
      const arr = Array.isArray(texts[t.key]) ? texts[t.key] : null;
      if (!def || !arr || t.index >= arr.length) return { error: `הסעיף לא נמצא: ${raw.target}` };
      if (op === 'delete' && t.key === 'cancellationItems' && t.index === 0) return { error: 'אי אפשר למחוק את סעיף 5.1 (התאריך מוצמד אליו)' };
      before = arr[t.index];
      where = def.num ? `${def.he} — סעיף ${def.num}.${t.index + 1}` : `${def.he} — שורה ${t.index + 1}`;
    }
    const target = t.index == null ? `texts.${t.key}` : `texts.${t.key}[${t.index}]`;
    if (op === 'delete') return { op: { op: 'delete', target, before }, display: { kind: 'delete', where, before, after: null } };
    const text = clean(raw.text);
    if (!text) return { error: 'טקסט ריק' };
    if (text.length > MAX_TEXT) return { error: 'הטקסט ארוך מדי' };
    if (text === before) return { error: 'אין שינוי' };
    return { op: { op: 'replace', target, before, text }, display: { kind: 'replace', where, before, after: text } };
  }

  if (op === 'set_field') {
    const def = FIELDS[raw.field];
    if (!def || !fieldAllowed(def, offerType)) return { error: `שדה לא מוכר: ${raw.field}` };
    let value = clean(raw.value);
    if (def.type === 'int' || def.type === 'money') {
      const n = Number(String(value).replace(/[,₪\s]/g, ''));
      if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return { error: `ערך לא תקין ל${def.he}` };
      if (raw.field === 'depositPercent' && n > 100) return { error: 'אחוז מקדמה מעל 100' };
      value = String(def.type === 'int' ? Math.round(n) : n);
    } else if (def.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) return { error: 'תאריך לא תקין' };
    } else if (def.type === 'time') {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return { error: 'שעה לא תקינה' };
    } else if (value.length > (def.type === 'longtext' ? MAX_TEXT : 300)) return { error: 'הטקסט ארוך מדי' };
    const before = String(fields[raw.field] ?? '');
    if (before === value) return { error: 'אין שינוי' };
    return { op: { op: 'set_field', field: raw.field, before, value }, display: { kind: 'field', where: def.he, before: before || '—', after: value } };
  }

  if (op === 'set_row') {
    if (isPackage) return { error: `ב${noun} חבילה אין טבלת עלויות` };
    const i = raw.row;
    const row = Number.isInteger(i) ? rows[i] : null;
    if (!row) return { error: `שורת עלות לא נמצאה: ${raw.row}` };
    const patch = {};
    for (const k of ['qty', 'price']) {
      if (raw[k] == null) continue;
      if (row.isPct) return { error: 'בשורת אחוזים אי אפשר לשנות כמות או מחיר' };
      const n = Number(raw[k]);
      if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return { error: 'מספר לא תקין' };
      if (n !== Number(row[k])) patch[k] = n;
    }
    for (const k of ['label', 'desc']) {
      if (!isStr(raw[k])) continue;
      const v = clean(raw[k]);
      if (v.length > 300) return { error: 'הטקסט ארוך מדי' };
      if (k === 'label' && !v) return { error: 'שם פריט ריק' };
      if (v !== String(row[k] ?? '')) patch[k] = v;
    }
    if (!Object.keys(patch).length) return { error: 'אין שינוי' };
    const show = (r) => r.isPct ? `${r.label}` : `${r.label}${r.desc ? ` (${r.desc})` : ''} · כמות ${r.qty} · מחיר ${r.price}`;
    return {
      op: { op: 'set_row', row: i, rowId: row.id ?? null, before: { qty: row.qty, price: row.price, label: row.label, desc: row.desc || '' }, patch },
      display: { kind: 'field', where: `טבלת העלויות — שורה ${i + 1}`, before: show(row), after: show({ ...row, ...patch }) },
    };
  }

  return { error: `פעולה לא מוכרת: ${op}` };
}

// Numbers that were edited by hand in the preview override the calculation; when the
// assistant changes a number those overrides are cleared so the document recalculates.
function overrideNote(ops, texts = {}) {
  const touchesMoney = ops.some(o => (o.op === 'set_field' && ['depositPercent', 'packageTotal'].includes(o.field)) || (o.op === 'set_row' && ('qty' in o.patch || 'price' in o.patch)) || o.op === 'add_row' || o.op === 'delete_row');
  const touchesDate = ops.some(o => o.op === 'set_field' && o.field === 'eventDate');
  const notes = [];
  if (touchesMoney && ['depositAmtLabel', 'depositPctLabel', 'depositAmtVatLabel', 'remainderAmtLabel', 'reserveAmtLabel'].some(k => texts[k] != null && texts[k] !== ''))
    notes.push('סכומים שערכת ידנית בסעיף תנאי התשלום יחושבו מחדש לפי המספרים החדשים.');
  if (touchesDate && texts.cancellationDateLabel) notes.push('התאריך שערכת ידנית בסעיף 5.1 יחושב מחדש לפי תאריך האירוע החדש.');
  return notes;
}

// messages: [{ role: 'user'|'assistant', content }], pending: ops[] | null
const norm = (t) => String(t || '').replace(/[\s"'״׳.,:;\-–—()]/g, '');
// Word-level similarity (0..1) — catches "another version" that is the same sentence again.
function similar(a, b) {
  const A = new Set(String(a).split(/\s+/).filter(Boolean)), B = new Set(String(b).split(/\s+/).filter(Boolean));
  if (!A.size || !B.size) return 0;
  let common = 0; A.forEach(w => { if (B.has(w)) common++; });
  return common / Math.max(A.size, B.size);
}

// Contradiction check (Phase 114) — the one case where the assistant proposes changes nobody named.
const REVIEW_MODE = `REVIEW MODE — the user pressed "בדוק סתירות". For this reply the "touch only what was asked" rule is replaced by the instructions here. Read the WHOLE contract and look for:
(a) two provisions that cannot both hold (e.g. one clause lets the Vendor postpone the event freely and another promises a fixed date with compensation; two different payment dates for the same sum);
(b) a provision that does not fit this deal (e.g. cancellation fees defined as a percent of "the total sum" / "סך העסקה" when the Orderer pays no sum; a deposit or cheque clause when nothing is paid; an "included in the price" item the deal does not include);
(c) a provision that refers to something that does not exist in the contract (an amount, a date, a section).
Do not report style, typos or things that are merely unusual. Do not invent a problem: if you find none, say so in one sentence and return "proposal": null.
For every finding write a numbered line in "reply": which provisions (by their section numbers), why they do not hold together in one short sentence, and what you suggest — remove one of them, or reword one. Then return ONE proposal with one operation per finding, in the same order (a "delete" of the list item you suggest dropping, or a "replace" with the corrected wording). The user approves or drops each one separately, so each operation must stand on its own. Prefer changing an ADDED clause; suggest removing or rewording a standard clause only when it truly cannot apply to this deal, and say so. When the right fix depends on a business decision you cannot know (which of two terms the parties meant), do not guess: describe the finding in "reply", ask, and leave it out of the proposal. At most 6 findings, the most serious first. End "reply" with "אפשר לאשר הכול, או להסיר מההצעה את מה שלא רוצים."`;

// recentTexts: clause texts the assistant already offered in this conversation (client keeps the last few)
// review: true → the contradiction check (contracts only)
async function runContractAssistant({ contract, messages, pending, recentTexts, review }) {
  const history = (Array.isArray(messages) ? messages : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && isStr(m.content) && m.content.trim())
    .slice(-14)
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!history.length || history[history.length - 1].role !== 'user') throw new Error('no user message');

  const isOffer = contract.kind === 'offer';
  const reviewing = review === true && !isOffer;
  const context = `${reviewing ? REVIEW_MODE + '\n\n' : ''}${isOffer ? OFFER_MODE + '\n\nPRICE OFFER' : 'CONTRACT'} OUTLINE (current state):\n${buildOutline(contract)}\n\nPENDING PROPOSAL: ${pending && pending.length ? JSON.stringify(pending.map(({ before, rowId, ...o }) => o)) : 'none'}`;

  const ask = async (extra, temperature) => {
    const res = await openai(isOffer ? 'offer-assistant' : 'contract-assistant').chat.completions.create({
      model: MODEL,
      temperature,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'system', content: context }, ...history, ...(extra ? [{ role: 'system', content: extra }] : [])],
    });
    try { return JSON.parse(res.choices?.[0]?.message?.content || '{}'); } catch { return {}; }
  };
  let out = await ask(null, reviewing ? 0.1 : 0.4);

  // The user asked for a change and got (almost) the same wording as before → one retry that says so.
  const recent = (Array.isArray(recentTexts) ? recentTexts : []).filter(isStr).slice(-6);
  const newTexts = (o) => (o.proposal && Array.isArray(o.proposal.ops) ? o.proposal.ops : []).map(x => x && x.text).filter(isStr);
  const repeats = (o) => newTexts(o).some(t => recent.some(r => norm(r) === norm(t) || similar(r, t) > 0.8));
  if (recent.length && out.apply_pending !== true && repeats(out)) {
    const again = await ask('Your draft is the same (or nearly the same) as a version you already offered: ' + JSON.stringify(recent[recent.length - 1]) + '. The user asked for a change. Write a substantively different version now — fuller, formal legal wording as described under "Drafting quality" — unless the user dictated exact words, in which case use exactly those.', 0.7);
    if (newTexts(again).length) out = again;
  }

  let reply = isStr(out.reply) ? out.reply.trim() : '';
  const applyPending = out.apply_pending === true && !!(pending && pending.length);
  let proposal = null;

  const rawOps = !applyPending && out.proposal && Array.isArray(out.proposal.ops) ? out.proposal.ops.slice(0, 12) : [];
  if (rawOps.length) {
    const ok = [], errors = [];
    for (const raw of rawOps) {
      const r = checkOp(raw, contract);
      if (r.error) errors.push(r.error); else ok.push(r);
    }
    if (reviewing && ok.length) {
      // A review is a list of separate suggestions — keep the valid ones.
      const ops = ok.map(r => r.op);
      proposal = { ops, items: ok.map(r => r.display), notes: overrideNote(ops, contract.texts), review: true };
    } else if (errors.length) {
      // All-or-nothing: a half-valid proposal could do something other than what was described.
      reply = `לא הצלחתי להכין את השינוי (${errors[0]}). נסה לנסח את הבקשה שוב, או לציין את מספר הסעיף.`;
    } else {
      const ops = ok.map(r => r.op);
      proposal = { ops, items: ok.map(r => r.display), notes: isOffer ? [] : overrideNote(ops, contract.texts) };
    }
  }
  if (!reply) reply = proposal ? 'הכנתי את השינוי. לאשר?' : applyPending ? 'מבצע.' : 'לא הבנתי את הבקשה, אפשר לנסח שוב?';
  return { reply, proposal, apply_pending: applyPending };
}

module.exports = { runContractAssistant, buildOutline, checkOp, LISTS, FIELDS, MODEL };
