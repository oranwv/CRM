// Fills the regular price-offer template from an offer-builder spec (Phase 102).
// Pure: takes the modal's untouched template state { fields, rows, texts } and the
// normalized spec from the server (server/services/offerBuilder.js) and returns
// what to set. Prices in the spec are as the user said them; `pricesInclVat`
// says on which basis. Cost rows are stored before VAT, package prices as typed
// with an incl./excl. flag — the same conventions the wizard uses.
const VAT = 1.18;
const toNet   = (v) => Math.round((Number(v) || 0) / VAT);
const toGross = (v) => Math.round((Number(v) || 0) * VAT);
const fmt = (n) => Number(n || 0).toLocaleString();

export function applyOfferSpec({ fields, rows, texts }, spec) {
  const incl = spec.pricesInclVat === true;
  const isPackage = spec.offerType === 'package';
  const net = (v) => (incl ? toNet(v) : Number(v) || 0);
  const f = { ...fields };
  const t = { ...texts };
  let r = rows.map(x => ({ ...x }));

  if (spec.name) f.name = spec.name;
  if (spec.eventDate) f.eventDate = spec.eventDate;
  if (spec.doorTime) f.doorTime = spec.doorTime;
  if (spec.endTime) f.endTime = spec.endTime;
  if (spec.chefMenu) f.chefMenu = spec.chefMenu;
  if (spec.barMenu) f.barMenu = spec.barMenu;
  if (spec.notes) f.notes = spec.notes;

  const removed = new Set(spec.includesRemove || []);
  t.includes = [...(texts.includes || []).filter(x => !removed.has(x)), ...(spec.includesAdd || [])];

  if (isPackage) {
    f.packageGuests = spec.guests ? String(spec.guests) : '';
    f.packagePrice = spec.packagePrice ? String(spec.packagePrice) : '';
    f.packageExtraGuestPrice = spec.extraGuestPrice ? String(spec.extraGuestPrice) : '';
    f.packagePriceIncl = incl; f.packageExtraIncl = incl;
    // Same wording the wizard generates on reaching the preview (it only generates when the list is empty).
    const amt = (n) => incl
      ? `${fmt(n)} ש"ח כולל מע"מ`
      : `${fmt(n)} ש"ח לא כולל מע"מ (${fmt(toGross(n))} ש"ח כולל מע"מ)`;
    const lines = [];
    if (spec.guests && spec.packagePrice) lines.push(`עלות החבילה עבור ${spec.guests} אורחים - ${amt(spec.packagePrice)}`);
    if (spec.guests && spec.extraGuestPrice) lines.push(`כל אורח נוסף מעל ${spec.guests} אורחים בתוספת של - ${amt(spec.extraGuestPrice)}`);
    t.packageCostLines = [...lines, ...(spec.extraCostLines || [])];
  } else {
    f.guests = spec.guests ? String(spec.guests) : '';
    f.extraGuestPrice = spec.extraGuestPrice ? String(net(spec.extraGuestPrice)) : '';
    r = r.map(row => (row.id === 1 ? { ...row, qty: spec.guests || 0, price: spec.perGuestPrice ? net(spec.perGuestPrice) : row.price } : row));
    for (const e of spec.rowEdits || []) {
      if (e.remove) { r = r.filter(row => row.id !== e.id); continue; }
      r = r.map(row => (row.id === e.id ? { ...row, ...(e.qty != null ? { qty: e.qty } : {}), ...(e.price != null ? { price: net(e.price) } : {}) } : row));
    }
    let nextId = Math.max(0, ...rows.map(x => x.id)) + 1; // above every template id, so a removed row's id is never reused (labels are matched by id)
    for (const x of spec.extraRows || []) r.push({ id: nextId++, label: x.label, desc: x.desc || '', qty: x.qty ?? 1, price: net(x.price) });
  }

  // One line for the "check before sending" bar in the preview.
  const vatWord = incl ? 'כולל מע"מ' : 'לפני מע"מ';
  const parts = [isPackage ? 'חבילה' : 'הצעה רגילה עם פירוט', spec.guests ? `${spec.guests} אורחים` : 'חסר מספר אורחים'];
  if (isPackage) parts.push(spec.packagePrice ? `${fmt(spec.packagePrice)} ש"ח ${vatWord}${incl ? '' : ` (${fmt(toGross(spec.packagePrice))} כולל)`}` : 'חסר מחיר חבילה');
  else parts.push(spec.perGuestPrice ? `${fmt(spec.perGuestPrice)} ש"ח לאורח ${vatWord}` : 'חסר מחיר לאורח');
  parts.push(spec.extraGuestPrice ? `אורח נוסף ${fmt(spec.extraGuestPrice)} ש"ח ${vatWord}` : 'בלי אורח נוסף');

  return { offerType: isPackage ? 'package' : 'regular', fields: f, rows: r, texts: t, summary: parts.join(' · ') };
}
