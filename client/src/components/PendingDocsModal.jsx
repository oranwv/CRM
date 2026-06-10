import { useState, useEffect, useCallback } from 'react';
import api from '../api';
import { docTypeLabel } from '../utils/docTypes';
import PendingDocDetail from './PendingDocDetail';

// Global list of all pending financial documents awaiting manager approval.
// Opened from the red "ממתינים" banner. Clicking a row opens PendingDocDetail.
export default function PendingDocsModal({ onClose, onChanged }) {
  const [docs,     setDocs]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [selected, setSelected] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/greeninvoice/pending')
      .then(r => setDocs(r.data))
      .catch(err => setError(err.response?.data?.error || 'שגיאה בטעינת המסמכים'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const sumOf = p => (p?.items || []).reduce((s, it) => s + Number(it.price || 0) * Number(it.quantity || 0), 0);

  return (
    <div className="fixed inset-0 z-[78] flex items-center justify-center bg-black/50 p-4" dir="rtl"
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 className="font-black text-slate-800 text-base">מסמכים ממתינים לאישור</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading && <p className="text-center text-slate-400 text-sm py-8">טוען...</p>}
          {error && <p className="text-center text-red-500 text-sm py-8">{error}</p>}
          {!loading && !error && docs.length === 0 && (
            <p className="text-center text-slate-400 text-sm py-8">אין מסמכים ממתינים</p>
          )}
          {docs.map(doc => (
            <button key={doc.id} onClick={() => setSelected(doc)}
              className="w-full text-right border border-slate-200 rounded-xl p-3 hover:border-violet-300 hover:bg-violet-50 transition">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-700 text-sm">{docTypeLabel(doc.payload?.type)}</span>
                <span className="text-slate-700 font-bold text-sm">{sumOf(doc.payload).toLocaleString('he-IL')} ₪</span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {doc.lead_name || 'ללא ליד'} · {doc.creator_name || 'לא ידוע'} · {new Date(doc.created_at).toLocaleDateString('he-IL')}
              </p>
            </button>
          ))}
        </div>
      </div>

      {selected && (
        <PendingDocDetail
          doc={selected}
          isManager={true}
          onClose={() => setSelected(null)}
          onActionDone={() => { load(); onChanged?.(); }}
        />
      )}
    </div>
  );
}
