// Fills the contract template from a contract-builder spec (Phase 114).
// Pure, the contract twin of utils/offerSpec.js: takes the modal's untouched
// template state { fields, rows, texts } and the normalized spec from the server
// (server/services/contractBuilder.js) and returns what to set.
// Conventions are the wizard's: cost rows and the regular extra-guest price are
// stored before VAT; package prices keep the typed number with an incl. flag
// (the modal generates the package cost lines itself on reaching the preview).
// Special terms are only ADDED to their lists. A standard cancellation / obligations
// clause leaves only when the user agreed to drop it in the conversation (standardRemove).
// A "custom" agreement has no prices: its costs and payment sections are the added clauses.
const VAT = 1.18;
const toNet   = (v) => Math.round((Number(v) || 0) / VAT);
const toGross = (v) => Math.round((Number(v) || 0) * VAT);
const fmt = (n) => Number(n || 0).toLocaleString();

// `en` = { texts, rows }: the English template (CONTRACT_TEXTS_EN / CONTRACT_ROWS_EN) for an English contract.
export function applyContractSpec({ fields, rows, texts }, spec, en = null) {
  const incl = spec.pricesInclVat === true;
  const isPackage = spec.contractType === 'package';
  const isCustom  = spec.contractType === 'custom';
  const net = (v) => (incl ? toNet(v) : Number(v) || 0);
  const f = { ...fields };
  const t = en ? { ...en.texts } : { ...texts };
  let r = rows.map(x => { const d = en && en.rows.find(e => e.id === x.id); return d ? { ...x, label: d.label, desc: d.desc } : { ...x }; });

  if (spec.clientName) f.clientName = spec.clientName;
  if (spec.eventDate) f.eventDate = spec.eventDate;
  if (spec.startTime) f.startTime = spec.startTime;
  if (spec.endTime) f.endTime = spec.endTime;
  if (spec.chefMenu) f.chefMenu = spec.chefMenu;
  if (spec.barMenu) f.barMenu = spec.barMenu;
  if (!isCustom && spec.depositPercent != null) f.depositPercent = String(spec.depositPercent);

  const removed = new Set(spec.includesRemove || []);
  const keep = (texts.includes || []).map(x => !removed.has(x));
  const base = (k) => (Array.isArray(t[k]) ? t[k] : []);
  t.includes = [...base('includes').filter((_, i) => keep[i] !== false), ...(spec.includesAdd || [])];
  t.eventExtraLines   = [...base('eventExtraLines'),   ...(spec.eventAdd || [])];
  t.costExtraLines    = [...base('costExtraLines'),    ...(spec.costAdd || [])];
  t.paymentExtras     = [...base('paymentExtras'),     ...(spec.paymentAdd || [])];
  // standard clauses the user agreed to drop — matched on the Hebrew template, removed by position
  const dropped = new Set(spec.standardRemove || []);
  const stay = (k) => (texts[k] || []).map((x, i) => !(dropped.has(x) && !(k === 'cancellationItems' && i === 0)));
  const stayC = stay('cancellationItems'), stayO = stay('obligations');
  t.cancellationItems = [...base('cancellationItems').filter((_, i) => stayC[i] !== false), ...(spec.cancellationAdd || [])];
  t.obligations       = [...base('obligations').filter((_, i) => stayO[i] !== false),       ...(spec.obligationsAdd || [])];
  if (isCustom && spec.includesHeader) t.includesHeader = spec.includesHeader;

  if (isCustom) {
    // no prices at all — the modal shows only the clauses
  } else if (isPackage) {
    f.packageGuests = spec.guests ? String(spec.guests) : '';
    f.packageTotal = spec.packagePrice ? String(spec.packagePrice) : '';
    f.packageExtraGuestPrice = spec.extraGuestPrice ? String(spec.extraGuestPrice) : '';
    f.packageTotalIncl = incl; f.packageExtraIncl = incl;
  } else {
    f.guests = spec.guests ? String(spec.guests) : (fields.guests ? String(fields.guests) : '');
    f.extraGuestPrice = spec.extraGuestPrice ? String(net(spec.extraGuestPrice)) : '';
    // a price that was not settled stays 0 — never the template's placeholder; guests fall back to what the card gave
    r = r.map(row => (row.id === 1 ? { ...row, qty: spec.guests || Number(fields.guests) || 0, price: spec.perGuestPrice ? net(spec.perGuestPrice) : 0 } : row));
    // service rows are in the contract only when the user said so
    const decided = new Map((spec.serviceRows || []).map(e => [e.id, e]));
    r = r.filter(row => row.id === 1 || decided.get(row.id)?.include === true)
      .map(row => { const e = decided.get(row.id); return e ? { ...row, ...(e.qty != null ? { qty: e.qty } : {}), ...(e.price != null ? { price: net(e.price) } : {}) } : row; });
    let nextId = Math.max(0, ...rows.map(x => x.id)) + 1; // never reuse a template id (labels are matched by id)
    for (const x of spec.extraRows || []) r.push({ id: nextId++, label: x.label, desc: x.desc || '', qty: x.qty ?? 1, price: net(x.price) });
  }

  // One line for the "check before sending" bar in the preview.
  const vatWord = incl ? 'כולל מע"מ' : 'לפני מע"מ';
  const parts = [];
  if (isCustom) {
    parts.push('הסכם מותאם', 'בלי טבלת מחירים ובלי שורות מקדמה והמחאות');
  } else {
    parts.push(isPackage ? 'חוזה חבילה' : 'חוזה רגיל', spec.guests ? `${spec.guests} אורחים` : 'חסר מספר אורחים');
    if (isPackage) parts.push(spec.packagePrice ? `${fmt(spec.packagePrice)} ש"ח ${vatWord}${incl ? '' : ` (${fmt(toGross(spec.packagePrice))} כולל)`}` : 'חסר מחיר חבילה');
    else parts.push(spec.perGuestPrice ? `${fmt(spec.perGuestPrice)} ש"ח לאורח ${vatWord}` : 'חסר מחיר לאורח');
    parts.push(spec.extraGuestPrice ? `אורח נוסף ${fmt(spec.extraGuestPrice)} ש"ח ${vatWord}` : 'בלי אורח נוסף');
    parts.push(spec.depositPercent != null ? `מקדמה ${spec.depositPercent}%` : 'מקדמה לא נקבעה (נשאר 30%)');
    if (!isPackage) {
      const services = r.filter(row => row.id !== 1 && rows.some(x => x.id === row.id)).map(row => row.label);
      parts.push(services.length ? `שירותים: ${services.join(', ')}` : 'בלי שורות שירות');
    }
  }
  const added = (spec.eventAdd?.length || 0) + (spec.costAdd?.length || 0) + (spec.paymentAdd?.length || 0) + (spec.cancellationAdd?.length || 0) + (spec.obligationsAdd?.length || 0);
  if (added) parts.push(`${added === 1 ? 'סעיף אחד שנוסף' : `${added} סעיפים שנוספו`} — כדאי לקרוא, ולהריץ "בדוק סתירות" למטה`);
  const gone = stayC.filter(x => x === false).length + stayO.filter(x => x === false).length;
  if (gone) parts.push(gone === 1 ? 'סעיף רגיל אחד הוסר לפי מה שאישרת' : `${gone} סעיפים רגילים הוסרו לפי מה שאישרת`);

  return { contractType: isCustom ? 'custom' : isPackage ? 'package' : 'regular', fields: f, rows: r, texts: t, summary: parts.join(' · ') };
}
