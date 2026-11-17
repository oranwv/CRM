// Applies an approved contract-assistant proposal (Phase 90) to the contract
// state of the modal. Pure: takes { fields, rows, texts } and the validated ops
// from the server (server/services/contractAssistant.js) and returns the next
// state, touching only what each op names. If the contract changed since the
// proposal was made (the text an op expects is no longer there), nothing is
// applied and { error } is returned.

const MONEY_LABELS = ['depositAmtLabel', 'depositPctLabel', 'depositAmtVatLabel', 'remainderAmtLabel', 'reserveAmtLabel'];
const STALE = 'החוזה השתנה מאז ההצעה. בקש מהעוזר להכין אותה שוב.';

function parseTarget(target) {
  const m = /^texts\.([A-Za-z0-9_]+)(?:\[(\d+)\])?$/.exec(String(target || ''));
  return m ? { key: m[1], index: m[2] == null ? null : Number(m[2]) } : null;
}

export function applyContractOps({ fields, rows, texts }, ops) {
  const f = { ...fields };
  const r = rows.map(x => ({ ...x }));
  const t = { ...texts };
  const cloned = new Set();
  const list = (key) => {
    if (!cloned.has(key)) { t[key] = Array.isArray(t[key]) ? [...t[key]] : []; cloned.add(key); }
    return t[key];
  };
  let moneyChanged = false, dateChanged = false;

  // Deletes and inserts shift positions, so list ops run in a safe order:
  // replaces first (positions as proposed), then deletes from the end, then adds from the end.
  const replaces = ops.filter(o => o.op === 'replace');
  const deletes  = ops.filter(o => o.op === 'delete').sort((a, b) => parseTarget(b.target).index - parseTarget(a.target).index);
  // Add positions are relative to the list as proposed: shift them by the deletes
  // before them, and insert from the end (ties: later op first) so order is kept.
  const adds = ops.map((o, i) => ({ o, i })).filter(x => x.o.op === 'add')
    .map(({ o, i }) => ({ ...o, i, index: o.index - deletes.filter(d => { const g = parseTarget(d.target); return g.key === o.list && g.index < o.index; }).length }))
    .sort((a, b) => (b.index - a.index) || (b.i - a.i));

  for (const o of [...replaces, ...deletes]) {
    const tg = parseTarget(o.target);
    if (!tg) return { error: STALE };
    if (tg.index == null) {
      if (t[tg.key] !== o.before) return { error: STALE };
      t[tg.key] = o.text;
    } else {
      const arr = list(tg.key);
      if (arr[tg.index] !== o.before) return { error: STALE };
      if (o.op === 'replace') arr[tg.index] = o.text; else arr.splice(tg.index, 1);
    }
  }
  for (const o of adds) {
    const arr = list(o.list);
    arr.splice(Math.max(0, Math.min(o.index, arr.length)), 0, o.text);
  }
  for (const o of ops) {
    if (o.op === 'set_field') {
      if (String(f[o.field] ?? '') !== o.before) return { error: STALE };
      f[o.field] = o.value;
      if (o.field === 'depositPercent' || o.field === 'packageTotal') moneyChanged = true;
      if (o.field === 'eventDate') dateChanged = true;
    } else if (o.op === 'set_row') {
      const row = r[o.row];
      if (!row || (o.rowId != null && row.id !== o.rowId) || row.label !== o.before.label || Number(row.qty) !== Number(o.before.qty) || Number(row.price) !== Number(o.before.price)) return { error: STALE };
      Object.assign(row, o.patch);
      if ('qty' in o.patch || 'price' in o.patch) moneyChanged = true;
    }
  }
  // Hand-edited amounts override the calculation — clear them so the new numbers show.
  if (moneyChanged) MONEY_LABELS.forEach(k => { if (t[k] != null) t[k] = null; });
  if (dateChanged && t.cancellationDateLabel != null) t.cancellationDateLabel = null;

  return { fields: f, rows: r, texts: t };
}
