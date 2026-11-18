import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { openLead } from '../utils/openLead';
import { CallButtons } from './LeadCard';
import { fmtCallbackTime } from './CallbackTime';

// Phase 102 — the header badge for "שיחות חוזרות" (to the right of the overdue-tasks badge) and
// the list it opens. useMyCallbacks keeps the signed-in user's open callbacks fresh: every minute,
// and at once whenever one is created / moved / closed anywhere in the app ('crm-callbacks' event).
export const callbacksChanged = () => { try { window.dispatchEvent(new Event('crm-callbacks')); } catch {} };

export function useMyCallbacks() {
  const [items, setItems] = useState([]);
  const load = useCallback(() => {
    if (!localStorage.getItem('crm_token')) return;
    api.get('/callbacks/mine').then(r => setItems(r.data.items || [])).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    window.addEventListener('crm-callbacks', load); window.addEventListener('focus', load);
    return () => { clearInterval(t); window.removeEventListener('crm-callbacks', load); window.removeEventListener('focus', load); };
  }, [load]);
  return items;
}

export function CallbackBadge({ items, onClick }) {
  // re-check the clock every 20 s so the badge starts blinking on time, between server refreshes
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 20_000); return () => clearInterval(t); }, []);
  if (!items.length) return null;
  // Oran: no time on the badge — it just starts blinking 5 minutes before a callback (and stays so until handled)
  const now = Date.now() + 5 * 60_000;
  const late = items.some(i => new Date(i.due_at).getTime() <= now);
  return (
    <button onClick={onClick}
      className={`${late ? 'crm-blink bg-red-600 hover:bg-red-700' : 'bg-teal-500 hover:bg-teal-600'} shrink-0 text-white text-xs font-black rounded-full px-3 py-1 leading-none transition cursor-pointer`}>
      📞 {items.length === 1 ? 'שיחה חוזרת' : `${items.length} שיחות חוזרות`}
    </button>
  );
}

export function CallbacksListModal({ items, onClose }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(null);
  async function talked(id) {
    setBusy(id);
    try { await api.post(`/callbacks/${id}/done`, { outcome: 'talked' }); } catch {}
    setBusy(null); callbacksChanged();
  }
  return (
    <div className="fixed inset-0 z-[79] flex items-center justify-center bg-black/60 p-4" dir="rtl" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="min-w-0">
            <h2 className="font-black text-slate-800 text-base">📞 שיחות חוזרות{items.length ? ` (${items.length})` : ''}</h2>
            <p className="text-xs text-slate-500 mt-0.5">לקוחות שביקשו שנחזור אליהם בשעה מסוימת, לפי סדר השעות</p>
          </div>
          <button onClick={onClose} className="shrink-0 mr-3 text-slate-400 hover:text-slate-600 text-2xl leading-none" aria-label="סגור">&times;</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {items.length === 0 && <p className="text-center text-emerald-600 font-bold text-sm py-8">אין שיחות חוזרות פתוחות ✅</p>}
          {items.map(i => {
            const note = (i.title || '').replace(/^לחזור ללקוח\s*(—\s*)?/, '');
            return (
              <div key={i.id} className={`rounded-xl border px-3 py-2 ${i.late ? 'border-red-200 bg-red-50/40' : 'border-slate-200 bg-white'}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-black text-white whitespace-nowrap ${i.late ? 'bg-red-600' : 'bg-teal-600'}`}>📞 {fmtCallbackTime(i.due_at)}{i.late ? ' · באיחור' : ''}</span>
                  <button onClick={() => { onClose(); openLead(navigate, i.lead_id); }} className="font-bold text-violet-700 hover:underline text-sm">{i.lead_name}</button>
                  {note && <span className="text-xs text-slate-500">{note}</span>}
                </div>
                <div className="flex items-center gap-2 flex-wrap mt-2">
                  {i.phone && <CallButtons lead={{ id: i.lead_id, name: i.lead_name, phone: i.phone }} />}
                  <button onClick={() => talked(i.id)} disabled={busy === i.id}
                    className="px-3 py-1 rounded-lg text-xs font-black text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-40">✓ דיברנו</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
