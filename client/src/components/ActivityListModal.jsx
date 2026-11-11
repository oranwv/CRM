import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { openLead } from '../utils/openLead';
import { CallButtons } from './LeadCard';

// Phase 79 — the rows behind a counter on הפעילות שלי: calls made / calls that were not answered /
// meetings booked. Each row: the lead (opens its card), when, what happened, and "התקשר" to call
// back through the app (same button as on the lead card).
const TITLES = { calls: '📞 שיחות שבוצעו', unanswered: '📵 שיחות שלא נענו', meetings_booked: '📅 פגישות שנקבעו' };
const fmtDay = ds => { const [y, m, d] = ds.split('-'); return `${Number(d)}.${Number(m)}.${y.slice(2)}`; };
const fmtDur = s => { const m = Math.floor(s / 60), r = s % 60; return m ? `${m}:${String(r).padStart(2, '0')} דק'` : `${r} שנ'`; };

export default function ActivityListModal({ kind, from, to, userQ, onClose }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get(`/analytics/my-activity/list?kind=${kind}&from=${from}&to=${to}${userQ || ''}`)
      .then(r => setRows(r.data))
      .catch(e => setError(e.response?.data?.error || 'שגיאה בטעינה'));
  }, [kind, from, to, userQ]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3" dir="rtl" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[88vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="min-w-0">
            <h2 className="font-black text-slate-800 text-base">{TITLES[kind]}{rows ? ` · ${rows.length}` : ''}</h2>
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">{from === to ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to)}`}</p>
          </div>
          <button onClick={onClose} className="shrink-0 mr-3 text-slate-400 hover:text-slate-600 text-2xl leading-none" aria-label="סגור">&times;</button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {rows === null && !error && <p className="text-center text-slate-400 text-sm py-8">טוען...</p>}
          {error && <p className="text-center text-red-500 text-sm py-8">{error}</p>}
          {rows && rows.length === 0 && <p className="text-center text-slate-400 text-sm py-8">אין רשומות בטווח הזה</p>}
          {rows?.map((r, i) => (
            <div key={i} className="rounded-xl border border-slate-200 px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  {r.lead_id
                    ? <button onClick={() => openLead(navigate, r.lead_id)} className="font-bold text-violet-700 hover:underline text-sm text-right">{r.lead_name || `ליד #${r.lead_id}`}</button>
                    : <span className="font-bold text-slate-500 text-sm" dir="ltr">{r.phone || 'מספר לא מזוהה'}</span>}
                  <div className="text-xs text-slate-500 flex items-center gap-x-2 gap-y-0.5 flex-wrap mt-0.5">
                    <span className="tabular-nums">{from === to ? r.hhmm : `${fmtDay(r.day)} ${r.hhmm}`}</span>
                    {r.duration_sec > 0 && <span className="tabular-nums font-semibold text-slate-700">{fmtDur(r.duration_sec)}</span>}
                    {kind === 'unanswered' && <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-bold text-[11px]">{r.detail}</span>}
                    {kind === 'meetings_booked' && r.cancelled && <span className="px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600 font-bold text-[11px]">בוטלה</span>}
                  </div>
                </div>
                {r.lead_id && r.phone && <div className="shrink-0"><CallButtons lead={{ id: r.lead_id, name: r.lead_name, phone: r.phone }} /></div>}
              </div>
              {kind === 'meetings_booked' && r.detail && <p className="text-xs text-slate-600 mt-1">{r.detail}</p>}
              {kind === 'calls' && r.summary && <p className="text-xs text-slate-500 mt-1 line-clamp-2" title={r.summary}>{r.summary}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
