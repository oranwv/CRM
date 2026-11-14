import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api';
import { fmtTime, deviceId, getPosition, FLAG_LABEL } from '../../utils/attendance';

// Phase 84 — the page an NFC tag opens: /clock?t=<token>. The punch happens as soon as the page
// loads (Oran: "ההחתמה מיד בהצמדה"); the screen only confirms it and offers "ביטול" for 10 seconds.
// The token is removed from the address right away, so a reload of this tab (Safari reloads
// background tabs on its own) can never punch a second time.
const UNDO_SECONDS = 10;

export default function ClockPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tokenRef = useRef(params.get('t'));
  const started = useRef(false);
  const [state, setState] = useState(tokenRef.current ? 'working' : 'idle'); // working | done | undone | error | idle
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [undoLeft, setUndoLeft] = useState(0);

  async function punch() {
    setState('working'); setError(null);
    const pos = await getPosition();
    try {
      const { data } = await api.post('/attendance/punch', { token: tokenRef.current, device: deviceId(), ...(pos || {}) });
      setResult(data); setState('done');
      setUndoLeft(data.repeated ? 0 : UNDO_SECONDS);
    } catch (err) {
      setError(err.response?.data || { error: 'ההחתמה נכשלה. בדוק את החיבור לאינטרנט ונסה שוב.' });
      setState('error');
    }
  }

  useEffect(() => {
    if (!tokenRef.current || started.current) return;
    started.current = true;
    window.history.replaceState(null, '', '/clock');
    punch();
  }, []);

  useEffect(() => {
    if (undoLeft <= 0) return;
    const t = setTimeout(() => setUndoLeft(n => n - 1), 1000);
    return () => clearTimeout(t);
  }, [undoLeft]);

  async function undo() {
    try {
      await api.post('/attendance/punch/undo', { shift_id: result.shift.id, action: result.action });
      setState('undone'); setUndoLeft(0);
    } catch (err) {
      setError(err.response?.data || { error: 'הביטול נכשל' });
    }
  }

  const isIn = result?.action === 'in';
  const time = result ? fmtTime(isIn ? result.shift.clock_in_at : result.shift.clock_out_at) : '';
  const today = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  return (
    <div className="min-h-screen flex flex-col" dir="rtl" style={{ background: '#fdf8f0' }}>
      <div className="flex items-center justify-between px-5 py-3.5 text-white" style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
        <span className="font-black">ProEvent CRM</span>
        <span className="font-bold text-sm">נוכחות</span>
      </div>
      <div className="flex-1 flex flex-col gap-5 px-5 pt-7 pb-6 max-w-md w-full mx-auto">
        {state === 'working' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
            <div className="w-16 h-16 rounded-full border-4 border-violet-200 border-t-violet-600 animate-spin" />
            <p className="text-xl font-black text-slate-800">מחתים…</p>
            <p className="text-sm text-slate-600">אם הטלפון שואל על מיקום – לאשר.</p>
          </div>
        )}

        {state === 'done' && result && (
          <>
            <div className="text-center">
              <h1 className="text-3xl font-black text-slate-900">שלום {result.name}</h1>
              <p className="text-slate-600 mt-1">{today}</p>
            </div>
            <div className="bg-white rounded-3xl shadow px-5 py-7 flex flex-col items-center gap-3.5">
              <div className={`w-28 h-28 rounded-full flex items-center justify-center ${isIn ? 'bg-emerald-700' : 'bg-slate-700'}`}>
                <svg aria-hidden="true" width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              </div>
              <p className={`text-2xl font-black ${isIn ? 'text-emerald-800' : 'text-slate-800'}`}>
                {result.repeated ? (isIn ? 'כבר נכנסת למשמרת' : 'כבר יצאת מהמשמרת') : (isIn ? 'נכנסת למשמרת' : 'יצאת מהמשמרת')}
              </p>
              <p className="text-6xl font-black leading-none tabular-nums text-slate-900">{time}</p>
              {!isIn && result.shift.minutes !== null && (
                <p className="text-slate-700 font-bold">משך המשמרת: {Math.floor(result.shift.minutes / 60)}:{String(result.shift.minutes % 60).padStart(2, '0')} שעות</p>
              )}
              <div className="flex flex-wrap gap-2 justify-center">
                <span className="bg-violet-100 text-violet-900 text-sm font-bold px-3 py-1.5 rounded-full">נקודת החתמה: {result.tag}</span>
                {result.location_checked && <span className="bg-emerald-100 text-emerald-800 text-sm font-bold px-3 py-1.5 rounded-full">המיקום אומת</span>}
                {result.flag && <span className="bg-amber-100 text-amber-900 text-sm font-bold px-3 py-1.5 rounded-full">{FLAG_LABEL[result.flag]} – ממתין לאישור מנהל</span>}
              </div>
            </div>
            {undoLeft > 0 && (
              <button onClick={undo} className="min-h-12 rounded-2xl border-2 border-slate-300 bg-white text-slate-700 font-bold">
                טעות? ביטול ({undoLeft})
              </button>
            )}
            {error && <p className="text-center text-red-700 font-bold text-sm">{error.error}</p>}
            <div className="flex-1" />
            {isIn && <p className="bg-white rounded-2xl px-4 py-3.5 text-slate-600 text-center">בסוף המשמרת מצמידים שוב את הטלפון.</p>}
            <button onClick={() => navigate('/my-hours')} className="text-violet-700 font-bold py-3">השעות שלי</button>
          </>
        )}

        {state === 'undone' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
            <p className="text-2xl font-black text-slate-800">ההחתמה בוטלה</p>
            <p className="text-slate-600">כדי להחתים – להצמיד שוב את הטלפון.</p>
            <button onClick={() => navigate('/my-hours')} className="text-violet-700 font-bold py-3">השעות שלי</button>
          </div>
        )}

        {state === 'error' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
            <div className="w-24 h-24 rounded-full bg-red-100 flex items-center justify-center">
              <svg aria-hidden="true" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" strokeWidth="3" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </div>
            <p className="text-2xl font-black text-slate-900">לא הוחתם</p>
            <p className="text-slate-700 font-semibold">{error?.error}</p>
            {error?.code !== 'not_enabled' && error?.code !== 'bad_tag' && (
              <button onClick={punch} className="min-h-12 px-8 rounded-2xl bg-violet-600 text-white font-black">נסה שוב</button>
            )}
            <button onClick={() => navigate('/my-hours')} className="text-violet-700 font-bold py-3">השעות שלי</button>
          </div>
        )}

        {state === 'idle' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
            <p className="text-2xl font-black text-slate-800">להחתמה – מצמידים את הטלפון</p>
            <p className="text-slate-600">לנקודת ההחתמה בכניסה או על הבר.</p>
            <button onClick={() => navigate('/my-hours')} className="min-h-12 px-8 rounded-2xl bg-violet-600 text-white font-black">השעות שלי</button>
          </div>
        )}
      </div>
    </div>
  );
}
