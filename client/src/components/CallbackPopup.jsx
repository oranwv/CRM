import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../api';
import { openLead } from '../utils/openLead';
import { CallButtons } from './LeadCard';
import { CallbackTimePicker, fmtCallbackTime } from './CallbackTime';

// Phase 101 — the window that jumps up when it is time to call a customer back.
// Mounted once in App. Asks the server every 30 s what should be on this user's screen:
// his own callbacks from 5 minutes before their time, and — 10 minutes after the time, if nobody
// dealt with them — other people's callbacks too. × only hides it for 5 minutes; it goes away for
// good when the callback is done, moved to a new time, or marked not relevant.
const POLL_MS = 30_000, HIDE_MS = 5 * 60_000;
const readHidden = () => { try { return JSON.parse(sessionStorage.getItem('crm_callback_hidden') || '{}'); } catch { return {}; } };
const writeHidden = h => { try { sessionStorage.setItem('crm_callback_hidden', JSON.stringify(h)); } catch {} };

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.22].forEach((at, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = i ? 1047 : 784;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.2);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.22);
    });
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch {}
}

export default function CallbackPopup() {
  const navigate = useNavigate();
  const location = useLocation();
  const [items, setItems] = useState([]);
  const [hidden, setHidden] = useState(readHidden);
  const [, setTick] = useState(0);
  const [view, setView] = useState('main'); // main | time | cancel
  const [due, setDue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const shownRef = useRef(null);

  const load = useCallback(() => {
    if (!localStorage.getItem('crm_token')) return;
    api.get('/callbacks/due').then(r => setItems(r.data.items || [])).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    const tick = setInterval(() => setTick(n => n + 1), 15_000);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis); window.addEventListener('focus', load);
    return () => { clearInterval(t); clearInterval(tick); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', load); };
  }, [load]);

  const now = Date.now();
  const cur = items.find(i => !(hidden[i.id] > now)) || null;
  useEffect(() => {
    if (cur && shownRef.current !== cur.id) { shownRef.current = cur.id; setView('main'); setDue(''); setReason(''); setErr(''); beep(); }
    if (!cur) shownRef.current = null;
  }, [cur?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cur || location.pathname.startsWith('/login')) return null;

  const hide = () => { const h = { ...hidden, [cur.id]: Date.now() + HIDE_MS }; setHidden(h); writeHidden(h); };
  const gone = () => { setItems(list => list.filter(i => i.id !== cur.id)); load(); };
  async function act(fn) {
    setBusy(true); setErr('');
    try { await fn(); gone(); }
    catch (e) { if (e.response?.status === 409) gone(); else setErr(e.response?.data?.error || 'שגיאה'); }
    finally { setBusy(false); }
  }
  const snooze = body => act(() => api.post(`/callbacks/${cur.id}/snooze`, body));
  const finish = body => act(() => api.post(`/callbacks/${cur.id}/done`, body));

  const minsTo = Math.ceil((new Date(cur.due_at).getTime() - now) / 60_000);
  const note = (cur.title || '').replace(/^לחזור ללקוח\s*(—\s*)?/, '');
  const late = cur.late_min > 0;
  const head = !cur.mine ? `${cur.assigned_name || 'הנציג'} עוד לא חזר/ה ל${cur.lead_name}`
    : minsTo > 0 ? `בעוד ${minsTo} דק׳ — לחזור ל${cur.lead_name}` : `הגיע הזמן לחזור ל${cur.lead_name}`;
  const tone = !cur.mine || late ? 'bg-red-600' : 'bg-teal-600';
  const btn = 'px-3 py-2 rounded-xl text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40';

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className={`${tone} text-white px-5 py-4 flex items-start gap-3`}>
          <span className="text-2xl leading-none animate-pulse">📞</span>
          <div className="flex-1 min-w-0">
            <h2 className="font-black text-lg leading-snug">{head}</h2>
            <p className="text-sm opacity-90 mt-0.5">
              ביקש/ה שנחזור ב-{fmtCallbackTime(cur.due_at)}{late ? ` · באיחור של ${cur.late_min} דק׳` : ''}
            </p>
          </div>
          <button onClick={hide} className="shrink-0 text-white/80 hover:text-white text-2xl leading-none" aria-label="הסתר ל-5 דקות" title="הסתר ל-5 דקות">&times;</button>
        </div>

        <div className="p-5 space-y-3">
          {note && <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">{note}</p>}
          {cur.phone && <p className="text-sm text-slate-500" dir="ltr" style={{ textAlign: 'right' }}>{cur.phone}</p>}
          {err && <p className="text-xs font-bold text-red-600">{err}</p>}

          {view === 'main' && <>
            <div className="flex items-center gap-2 flex-wrap">
              {cur.phone && <CallButtons lead={{ id: cur.lead_id, name: cur.lead_name, phone: cur.phone }} />}
              <button onClick={() => finish({ outcome: 'talked' })} disabled={busy}
                className="px-3 py-1.5 rounded-lg text-xs font-black text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-40">✓ דיברנו</button>
              <button onClick={() => { hide(); openLead(navigate, cur.lead_id); }} className="px-3 py-1.5 rounded-lg text-xs font-black text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200">פתח ליד</button>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1">
              <button className={btn} disabled={busy} onClick={() => snooze({ minutes: 10 })}>דחה ב-10 דק׳</button>
              <button className={btn} disabled={busy} onClick={() => setView('time')}>שעה אחרת</button>
              <button className={btn} disabled={busy} onClick={() => setView('cancel')}>לא רלוונטי</button>
            </div>
            <p className="text-[11px] text-slate-400">לא ענה? בחר "שעה אחרת". ה-× מסתיר ל-5 דקות בלבד.</p>
          </>}

          {view === 'time' && <>
            <p className="text-xs font-black text-slate-500">מתי לחזור?</p>
            <CallbackTimePicker value={due} onChange={setDue} />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setView('main')} className="text-sm text-slate-500 px-3 py-2">חזרה</button>
              <button onClick={() => snooze({ due_at: due })} disabled={busy || !due}
                className="text-sm font-black px-5 py-2 rounded-xl text-white bg-teal-600 disabled:opacity-40">קבע</button>
            </div>
          </>}

          {view === 'cancel' && <>
            <input value={reason} onChange={e => setReason(e.target.value)} placeholder="למה לא רלוונטי?" autoFocus
              className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-teal-400 bg-white" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setView('main')} className="text-sm text-slate-500 px-3 py-2">חזרה</button>
              <button onClick={() => finish({ outcome: 'cancel', result: reason })} disabled={busy || !reason.trim()}
                className="text-sm font-black px-5 py-2 rounded-xl text-white bg-slate-600 disabled:opacity-40">סמן לא רלוונטי</button>
            </div>
          </>}
        </div>
      </div>
    </div>
  );
}
