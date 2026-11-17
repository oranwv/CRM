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

const MODEL = 'gpt-4o';
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
  depositPercent:         { he: 'אחוז מקדמה',                    type: 'int' },
  packageGuests:          { he: 'מספר אורחים בחבילה',            type: 'int',   only: 'package' },
  packageTotal:           { he: 'מחיר החבילה',                   type: 'money', only: 'package' },
  packageExtraGuestPrice: { he: 'מחיר אורח נוסף בחבילה',         type: 'money', only: 'package' },
};

const isStr = (v) => typeof v === 'string';
const clean = (v) => String(v ?? '').replace(/\s+\n/g, '\n').trim();

function parseTarget(target) {
  const m = /^texts\.([A-Za-z0-9_]+)(?:\[(\d+)\])?$/.exec(String(target || ''));
  if (!m) return null;
  return { key: m[1], index: m[2] == null ? null : Number(m[2]) };
}

// Plain-text outline of the contract in document order, every editable piece tagged with its id.
function buildOutline(contract) {
  const { fields = {}, rows = [], texts = {}, calculated = {}, offerType = 'regular', language = 'he' } = contract;
  const isPackage = offerType === 'package';
  const L = [];
  const scalar = (key) => { if (isStr(texts[key]) && texts[key].trim()) L.push(`[texts.${key}] ${texts[key]}`); };
  const list = (key) => {
    const arr = Array.isArray(texts[key]) ? texts[key] : [];
    const num = LISTS[key].num;
    if (!arr.length) L.push(`(list ${key} is empty)`);
    arr.forEach((t, i) => L.push(`[texts.${key}[${i}]] ${num ? `${num}.${i + 1} ` : ''}${t}`));
  };
  const money = (n) => `${Number(n || 0).toLocaleString('en-US')} ₪`;

  L.push(`CONTRACT TYPE: ${isPackage ? 'package' : 'regular'} · DOCUMENT LANGUAGE: ${language === 'en' ? 'English' : 'Hebrew'}`);
  L.push('');
  L.push('== FIELDS (change with set_field) ==');
  for (const [k, def] of Object.entries(FIELDS)) {
    if (def.only && def.only !== (isPackage ? 'package' : 'regular')) continue;
    L.push(`${k} = ${JSON.stringify(fields[k] ?? '')}   (${def.he})`);
  }
  if (!isPackage) {
    L.push('');
    L.push('== COST ROWS (change with set_row; prices are before VAT) ==');
    rows.forEach((r, i) => L.push(r.isPct
      ? `row ${i}: "${r.label}" — ${r.pct || 0}% of the fixed rows (percent row: only label/desc can change)`
      : `row ${i}: "${r.label}"${r.desc ? ` (${r.desc})` : ''} — qty ${r.qty}, price ${r.price}`));
  }
  L.push('');
  L.push(`== COMPUTED (read only) == subtotal before VAT ${money(calculated.subtotal)}, VAT ${money(calculated.vat)}, total ${money(calculated.total)}, deposit ${money(calculated.depositAmount)} before VAT / ${money(calculated.depositAmountVat)} incl. VAT, balance ${money(calculated.remainingBalance)}`);
  L.push('');
  L.push('== DOCUMENT (in order) ==');
  ['title', 'whereas1', 'whereas2', 'therefore', 'preamble'].forEach(scalar);
  L.push('-- 1. The event: date, venue, start and end time (from the fields) --');
  list('eventExtraLines');
  L.push('-- 2. Costs --');
  if (isPackage) { scalar('packageCostLine'); scalar('packageExtraLine'); }
  else L.push('(the cost rows table, totals, minimum guests line and extra-guest line are built from the fields and rows)');
  list('costExtraLines');
  L.push('-- 3. --'); scalar('includesHeader'); list('includes');
  L.push('-- 4. --'); scalar('paymentHeader');
  scalar('depositLine');
  L.push(`   {deposit amount: ${texts.depositAmtLabel ?? money(calculated.depositAmount)} ${texts.depositPctLabel ?? `(${fields.depositPercent}%)`}}`);
  scalar('depositSuffix');
  L.push(`   {deposit incl. VAT: ${texts.depositAmtVatLabel ?? money(calculated.depositAmountVat)}}`);
  scalar('finalSettlementIntro');
  scalar('securityCheckPre'); L.push(`   {balance cheque amount: ${texts.remainderAmtLabel || money(calculated.remainingBalance)}}`); scalar('securityCheckSuf');
  scalar('reserveCheckPre'); L.push(`   {reserve cheque amount: ${texts.reserveAmtLabel || money(Math.round((calculated.total || 0) * 0.1))}}`); scalar('reserveCheckSuf');
  scalar('checksUsageNote'); scalar('paymentNote');
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

Language: write clause text in the DOCUMENT LANGUAGE (formal contract register, consistent with the existing wording and terms — in Hebrew: "המזמין", "הספק"; in English: "the Orderer", "the Vendor"). Always write "reply" in Hebrew, short and plain. You draft wording; you are not a lawyer and you do not give legal advice.

Answer with ONE JSON object and nothing else:
{"reply":"<Hebrew>","proposal":null | {"ops":[...]},"apply_pending":false}`;

// Validate one op against the contract; returns { op, display } or { error }.
function checkOp(raw, contract) {
  const { fields = {}, rows = [], texts = {}, offerType = 'regular' } = contract;
  const isPackage = offerType === 'package';
  const op = raw && raw.op;

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
      if (!SCALAR_LABEL[t.key] || !isStr(texts[t.key]) || !texts[t.key].trim()) return { error: `אי אפשר לשנות את ${raw.target}` };
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
    if (!def || (def.only && def.only !== (isPackage ? 'package' : 'regular'))) return { error: `שדה לא מוכר: ${raw.field}` };
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
    } else if (value.length > 300) return { error: 'הטקסט ארוך מדי' };
    const before = String(fields[raw.field] ?? '');
    if (before === value) return { error: 'אין שינוי' };
    return { op: { op: 'set_field', field: raw.field, before, value }, display: { kind: 'field', where: def.he, before: before || '—', after: value } };
  }

  if (op === 'set_row') {
    if (isPackage) return { error: 'בחוזה חבילה אין טבלת עלויות' };
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
  const touchesMoney = ops.some(o => (o.op === 'set_field' && ['depositPercent', 'packageTotal'].includes(o.field)) || (o.op === 'set_row' && ('qty' in o.patch || 'price' in o.patch)));
  const touchesDate = ops.some(o => o.op === 'set_field' && o.field === 'eventDate');
  const notes = [];
  if (touchesMoney && ['depositAmtLabel', 'depositPctLabel', 'depositAmtVatLabel', 'remainderAmtLabel', 'reserveAmtLabel'].some(k => texts[k] != null && texts[k] !== ''))
    notes.push('סכומים שערכת ידנית בסעיף תנאי התשלום יחושבו מחדש לפי המספרים החדשים.');
  if (touchesDate && texts.cancellationDateLabel) notes.push('התאריך שערכת ידנית בסעיף 5.1 יחושב מחדש לפי תאריך האירוע החדש.');
  return notes;
}

// messages: [{ role: 'user'|'assistant', content }], pending: ops[] | null
async function runContractAssistant({ contract, messages, pending }) {
  const history = (Array.isArray(messages) ? messages : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && isStr(m.content) && m.content.trim())
    .slice(-14)
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!history.length || history[history.length - 1].role !== 'user') throw new Error('no user message');

  const context = `CONTRACT OUTLINE (current state):\n${buildOutline(contract)}\n\nPENDING PROPOSAL: ${pending && pending.length ? JSON.stringify(pending.map(({ before, rowId, ...o }) => o)) : 'none'}`;

  const res = await openai('contract-assistant').chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: SYSTEM }, { role: 'system', content: context }, ...history],
  });
  let out = {};
  try { out = JSON.parse(res.choices?.[0]?.message?.content || '{}'); } catch { out = {}; }

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
    if (errors.length) {
      // All-or-nothing: a half-valid proposal could do something other than what was described.
      reply = `לא הצלחתי להכין את השינוי (${errors[0]}). נסה לנסח את הבקשה שוב, או לציין את מספר הסעיף.`;
    } else {
      const ops = ok.map(r => r.op);
      proposal = { ops, items: ok.map(r => r.display), notes: overrideNote(ops, contract.texts) };
    }
  }
  if (!reply) reply = proposal ? 'הכנתי את השינוי. לאשר?' : applyPending ? 'מבצע.' : 'לא הבנתי את הבקשה, אפשר לנסח שוב?';
  return { reply, proposal, apply_pending: applyPending };
}

module.exports = { runContractAssistant, buildOutline, checkOp, LISTS, FIELDS };
