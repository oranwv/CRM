import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

// Events in the next 7 days with something still open (brief / checklist / deposit / אחראי הפקה).
// Opened from the red "אירועים לא מוכנים" badge in the header. Clicking a row opens the lead.
const TAG_COLORS = {
  brief:              'bg-violet-100 text-violet-700 border-violet-200',
  checklist:          'bg-amber-100 text-amber-700 border-amber-200',
  deposit:            'bg-red-100 text-red-600 border-red-200',
  production_manager: 'bg-slate-100 text-slate-600 border-slate-200',
};

function inDays(n) {
  if (n === 0) return 'היום';
  if (n === 1) return 'מחר';
  return `בעוד ${n} ימים`;
}
function fmtDate(ds) {
  if (!ds) return '';
  const [y, m, d] = ds.split('-');
  return `${Number(d)}/${Number(m)}/${y.slice(2)}`;
}

export default function UnreadyEventsModal({ onClose }) {
  const navigate = useNavigate();
  const [events,  setEvents]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    api.get('/production/unready-events')
      .then(r => setEvents(r.data.events || []))
      .catch(err => setError(err.response?.data?.error || 'שגיאה בטעינת האירועים'))
      .finally(() => setLoading(false));
  }, []);

  function openLead(id) {
    onClose();
    navigate(`/?lead=${id}`);
  }

  return (
    <div className="fixed inset-0 z-[78] flex items-center justify-center bg-black/50 p-4" dir="rtl" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 className="font-black text-slate-800 text-base">אירועים לא מוכנים – 7 הימים הקרובים</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading && <p className="text-center text-slate-400 text-sm py-8">טוען...</p>}
          {error && <p className="text-center text-red-500 text-sm py-8">{error}</p>}
          {!loading && !error && events.length === 0 && (
            <p className="text-center text-slate-400 text-sm py-8">כל האירועים הקרובים מוכנים ✅</p>
          )}
          {events.map(ev => (
            <button key={ev.id} onClick={() => openLead(ev.id)}
              className="w-full text-right border border-slate-200 rounded-xl p-3 hover:border-violet-300 hover:bg-violet-50 transition">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-700 text-sm truncate">
                  {ev.name}{ev.event_type ? ` – ${ev.event_type}` : ''}
                </span>
                <span className={`text-xs font-black whitespace-nowrap ${ev.days_until <= 2 ? 'text-red-600' : 'text-slate-600'}`}>
                  {inDays(ev.days_until)}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {fmtDate(ev.event_date_str)}{ev.event_time ? ` · ${ev.event_time}` : ''} · אחראי: {ev.production_manager_name || 'לא נבחר'}
              </p>
              <div className="flex flex-wrap gap-1 mt-2">
                {ev.missing.map((k, i) => (
                  <span key={k} className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${TAG_COLORS[k] || TAG_COLORS.production_manager}`}>
                    {ev.missing_labels[i]}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
