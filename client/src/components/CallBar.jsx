// Floating softphone UI: incoming-call prompt, active-call bar, error toast.
// Rendered once in App; state comes from CallContext.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCalls } from '../context/CallContext';

function useTimer(startedAt) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  if (!startedAt) return null;
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function CallBar() {
  const { enabled, incoming, active, muted, error, clearError, acceptIncoming, rejectIncoming, hangup, toggleMute } = useCalls();
  const navigate = useNavigate();
  const timer = useTimer(active?.startedAt);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 6000);
    return () => clearTimeout(t);
  }, [error, clearError]);

  if (!enabled && !error) return null;

  return (
    <>
      {incoming && (
        <div className="fixed left-1/2 -translate-x-1/2 z-[90] w-[92%] max-w-sm" style={{ top: 60 }} dir="rtl">
          <div className="rounded-2xl shadow-2xl bg-slate-900 text-white px-5 py-4 border border-white/10 animate-pulse-slow">
            <div className="text-xs text-emerald-300 font-bold mb-1">📞 שיחה נכנסת</div>
            <div className="text-lg font-black truncate">{incoming.leadName || 'מספר לא מזוהה'}</div>
            <div className="text-sm text-slate-300" dir="ltr">{incoming.from}</div>
            <div className="flex gap-2 mt-3">
              <button onClick={acceptIncoming}
                className="flex-1 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 font-black text-white">ענה</button>
              <button onClick={rejectIncoming}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-400 font-black text-white">דחה</button>
            </div>
          </div>
        </div>
      )}

      {active && (
        <div className="fixed left-1/2 -translate-x-1/2 z-[90] w-[92%] max-w-md" style={{ top: 60 }} dir="rtl">
          <div className="rounded-2xl shadow-2xl bg-slate-900 text-white px-4 py-3 border border-white/10 flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <div className="flex-1 min-w-0">
              <button
                onClick={() => active.leadId && navigate(`/?lead=${active.leadId}`)}
                className={`block text-right font-black truncate ${active.leadId ? 'hover:underline' : ''}`}>
                {active.leadName || 'שיחה'}
              </button>
              <div className="text-xs text-slate-300">
                {active.direction === 'inbound' ? 'שיחה נכנסת' : 'שיחה יוצאת'} · {timer || 'מתקשר…'} · מוקלט
              </div>
            </div>
            <button onClick={toggleMute} title={muted ? 'בטל השתקה' : 'השתק'}
              className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${muted ? 'bg-amber-400 text-slate-900' : 'bg-white/15 hover:bg-white/25'}`}>
              {muted ? '🔇' : '🎙️'}
            </button>
            <button onClick={hangup} title="נתק"
              className="w-10 h-10 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center text-lg">📵</button>
          </div>
        </div>
      )}

      {error && (
        <div className="fixed left-1/2 -translate-x-1/2 z-[95] w-[92%] max-w-md" style={{ top: 60 }} dir="rtl">
          <div className="rounded-2xl shadow-lg bg-red-500 text-white px-4 py-3 text-sm font-bold flex items-start gap-2">
            <span className="flex-1">שגיאת שיחה: {error}</span>
            <button onClick={clearError} className="text-white/80 hover:text-white text-lg leading-none">&times;</button>
          </div>
        </div>
      )}
    </>
  );
}
