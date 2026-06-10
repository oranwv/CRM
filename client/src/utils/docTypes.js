// GreenInvoice document types — single source of truth (client side).
// Type codes verified against the live GreenInvoice account:
//   300 = חשבונית עסקה (proforma), 305 = חשבונית מס (tax invoice),
//   320 = חשבונית מס קבלה, 400 = קבלה.
export const DOC_TYPES = [
  { type: 300, label: 'חשבונית עסקה' },
  { type: 305, label: 'חשבונית מס' },
  { type: 400, label: 'קבלה' },
  { type: 320, label: 'חשבונית מס קבלה' },
];

const LABELS = DOC_TYPES.reduce((m, d) => { m[d.type] = d.label; return m; }, {});

export function docTypeLabel(type) {
  return LABELS[Number(type)] || 'מסמך';
}

// Types that require payment info (date + method) — receipt-style documents.
export const PAYMENT_DOC_TYPES = [400, 320];

export const PAYMENT_METHODS = [
  { value: 4,  label: 'העברה בנקאית' },
  { value: 3,  label: 'כרטיס אשראי' },
  { value: 1,  label: 'מזומן' },
  { value: 2,  label: "צ'ק" },
  { value: 10, label: 'ביט / אפליקציה' },
  { value: 11, label: 'אחר' },
];

export const VAT_OPTIONS = [
  { value: 1, label: 'כולל מע"מ' },
  { value: 0, label: 'הוסף מע"מ' },
  { value: 2, label: 'פטור' },
];

export function paymentMethodLabel(value) {
  return PAYMENT_METHODS.find(m => m.value === Number(value))?.label || '—';
}

export function vatLabel(value) {
  return VAT_OPTIONS.find(v => v.value === Number(value))?.label || '—';
}
