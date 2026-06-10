import { useState } from 'react';
import api from '../api';
import { docTypeLabel, paymentMethodLabel, vatLabel, PAYMENT_DOC_TYPES } from '../utils/docTypes';

// Detail view of a pending financial document — shows everything that was filled
// in, plus approve/reject controls for managers. Shared by PendingDocsModal
// (global list) and LeadCard (per-lead section).
export default function PendingDocDetail({ doc, isManager, onClose, onActionDone }) {
  const [rejecting, setRejecting] = useState(false);
  const [comment,   setComment]   = useState('');
  const [busy,      setBusy]      = useState(false);
  const [error,     setError]     = useState(null);

  const p     = doc.payload || {};
  const items = p.items || [];
  const total = items.reduce((s, it) => s + Number(it.price || 0) * Number(it.quantity || 0), 0);
  const needsPmt = PAYMENT_DOC_TYPES.includes(Number(p.type));
  const fmtDate = d => (d ? new Date(d).toLocaleDateString('he-IL') : '—');

  async function approve() {
    setBusy(true); setError(null);
    try {
      await api.post(`/greeninvoice/pending/${doc.id}/approve`);
      onActionDone?.();
      onClose?.();
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה באישור המסמך');
    } finally { setBusy(false); }
  }

  async function reject() {
    setBusy(true); setError(null);
    try {
      await api.post(`/greeninvoice/pending/${doc.id}/reject`, { comment });
      onActionDone?.();
      onClose?.();
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה בדחיית המסמך');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" dir="rtl"
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="font-black text-slate-800 text-base">{docTypeLabel(p.type)}</h2>
            {doc.status === 'pending'  && <span className="bg-amber-100 text-amber-700 text-[11px] font-bold px-2 py-0.5 rounded-full">ממתין לאישור</span>}
            {doc.status === 'approved' && <span className="bg-emerald-100 text-emerald-700 text-[11px] font-bold px-2 py-0.5 rounded-full">אושר</span>}
            {doc.status === 'rejected' && <span className="bg-red-100 text-red-700 text-[11px] font-bold px-2 py-0.5 rounded-full">נדחה</span>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">

          <div className="text-xs text-slate-500">
            יצר: {doc.creator_name || 'לא ידוע'}
            {doc.lead_name ? ` · ליד: ${doc.lead_name}` : ''}
            {doc.created_at ? ` · ${new Date(doc.created_at).toLocaleDateString('he-IL')}` : ''}
          </div>

          {/* Items */}
          <div>
            <p className="text-xs font-bold text-slate-500 mb-1">פריטים</p>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="text-right px-2 py-1.5 font-bold">תיאור</th>
                    <th className="text-center px-2 py-1.5 font-bold">כמות</th>
                    <th className="text-center px-2 py-1.5 font-bold">מחיר</th>
                    <th className="text-center px-2 py-1.5 font-bold">מע"מ</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-2 py-1.5 text-slate-700">{it.description}</td>
                      <td className="px-2 py-1.5 text-center text-slate-600">{it.quantity}</td>
                      <td className="px-2 py-1.5 text-center text-slate-600">{Number(it.price).toLocaleString('he-IL')} ₪</td>
                      <td className="px-2 py-1.5 text-center text-slate-500">{vatLabel(it.vatType)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-left mt-1 text-slate-700 font-bold">סה"כ: {total.toLocaleString('he-IL')} ₪</p>
          </div>

          {/* Dates + payment */}
          <div className="grid grid-cols-2 gap-2 bg-slate-50 rounded-xl p-3 text-xs text-slate-600">
            <p>תאריך מסמך: {fmtDate(p.docDate)}</p>
            {needsPmt
              ? <p>תאריך תשלום: {fmtDate(p.paymentDate)}</p>
              : <p>לתשלום עד: {fmtDate(p.dueDate)}</p>}
            {needsPmt && <p>אמצעי תשלום: {paymentMethodLabel(p.paymentMethod)}</p>}
            <p>שליחה: {[p.sendByEmail && 'מייל', p.sendByWhatsApp && 'וואטסאפ'].filter(Boolean).join(' + ') || 'לא'}</p>
          </div>

          {p.whatsappMessage && (
            <div className="text-xs text-slate-600">
              <span className="font-bold text-slate-500">הודעת וואטסאפ: </span>{p.whatsappMessage}
            </div>
          )}

          {doc.status === 'rejected' && doc.rejection_comment && (
            <p className="text-xs text-red-600">סיבת הדחייה: {doc.rejection_comment}</p>
          )}
          {doc.status === 'approved' && doc.doc_url && (
            <a href={doc.doc_url} target="_blank" rel="noreferrer" className="text-xs text-violet-600 underline">פתח מסמך בגרין אינוויס</a>
          )}

          {error && <p className="text-xs text-red-500 font-semibold">{error}</p>}
        </div>

        {/* Footer — manager actions on pending docs */}
        {doc.status === 'pending' && isManager && (
          <div className="shrink-0 border-t border-slate-200 px-5 py-3 space-y-2">
            {!rejecting ? (
              <div className="flex gap-3">
                <button onClick={() => { setRejecting(true); setComment(''); }} disabled={busy}
                  className="flex-1 py-2 rounded-xl bg-red-100 text-red-600 font-bold text-sm hover:bg-red-200 disabled:opacity-50 transition">דחה</button>
                <button onClick={approve} disabled={busy}
                  className="flex-1 py-2 rounded-xl bg-emerald-500 text-white font-bold text-sm hover:bg-emerald-600 disabled:opacity-50 transition">
                  {busy ? 'מאשר...' : 'אשר וצור מסמך'}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <textarea value={comment} onChange={e => setComment(e.target.value)}
                  placeholder="סיבת הדחייה (אופציונלי)" rows={2}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-red-400 resize-none" />
                <div className="flex gap-3">
                  <button onClick={() => setRejecting(false)} disabled={busy}
                    className="flex-1 py-2 rounded-xl border border-slate-300 text-slate-600 font-bold text-sm hover:bg-slate-50 disabled:opacity-50 transition">ביטול</button>
                  <button onClick={reject} disabled={busy}
                    className="flex-1 py-2 rounded-xl bg-red-500 text-white font-bold text-sm hover:bg-red-600 disabled:opacity-50 transition">
                    {busy ? 'דוחה...' : 'אשר דחייה'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
