import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

// "תשלומים ללא מסמך" — deposits / full payments an employee marked as received in the
// lead card, with no receipt issued yet. Opened from the amber badge in the header
// (managers + finance). A row opens the lead card, where the banner offers "הפק קבלה".
const KIND = { deposit: 'מקדמה', full_payment: 'תשלום מלא' };
export default function PaymentSignalsModal({ onClose }) {
  const navigate = useNavigate();
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    api.get('/payment-signals')
      .then(r => setItems(r.data || []))
      .catch(err => setError(err.response?.data?.error || 'שגיאה בטעינה'))
      .finally(() => setLoading(false));
  }, []);

  function openLead(id) {
    onClose();
    navigate(`/?lead=${id}`);
  }

  async function dismiss(e, id) {
    e.stopPropagation();
    try {
      await api.post(`/payment-signals/${id}/dismiss`);
      setItems(prev => prev.filter(x => x.id !== id));
    } catch { alert('שגיאה'); }
  }

  const fmt = d => (d ? new Date(d).toLocaleDateString('he-IL') : '');

  return (
    <div className="fixed inset-0 z-[78] flex items-center justify-center bg-black/50 p-4" dir="rtl" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="font-black text-slate-800 text-base">🧾 תשלומים שסומנו כהתקבלו — בלי קבלה</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">מקדמה או תשלום מלא שסומנו בכרטיס הליד ועדיין לא הופקה עליהם קבלה</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading && <p className="text-center text-slate-400 text-sm py-8">טוען...</p>}
          {error && <p className="text-center text-red-500 text-sm py-8">{error}</p>}
          {!loading && !error && items.length === 0 && (
            <p className="text-center text-slate-400 text-sm py-8">כל התשלומים שסומנו מכוסים בקבלה ✅</p>
          )}
          {items.map(it => (
            <div key={it.id} role="button" tabIndex={0} onClick={() => openLead(it.lead_id)}
              onKeyDown={e => { if (e.key === 'Enter') openLead(it.lead_id); }}
              className="w-full text-right border border-amber-200 bg-amber-50/40 rounded-xl p-3 hover:border-amber-400 hover:bg-amber-50 transition cursor-pointer">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-800 truncate">{it.lead_name} <span className="text-[11px] font-bold text-amber-700 bg-amber-100 rounded-full px-1.5 py-0.5 mr-1">{KIND[it.kind] || 'תשלום'}</span></span>
                <span className="font-black text-amber-800 text-sm tabular-nums shrink-0">
                  {it.amount ? `₪${Number(it.amount).toLocaleString('he-IL')}` : 'סכום לא צוין'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {it.event_type || 'אירוע'}{it.event_date ? ` · ${fmt(it.event_date)}` : ''} · סומן {fmt(it.said_at)}
              </p>
              {it.snippet && <p className="text-xs text-slate-500 mt-1">{it.snippet}</p>}
              <div className="flex gap-2 mt-2">
                <span className="text-[11px] font-bold text-amber-800 bg-white border border-amber-300 rounded-lg px-2 py-1">פתח ליד והפק קבלה ←</span>
                <button onClick={e => dismiss(e, it.id)} className="text-[11px] font-bold text-slate-500 border border-slate-200 rounded-lg px-2 py-1 bg-white hover:bg-slate-50">
                  לא רלוונטי
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
