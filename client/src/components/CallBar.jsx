// Floating softphone UI: incoming-call prompt, active-call bar, error toast.
// Rendered once in App; state comes from CallContext.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCalls } from '../context/CallContext';

// The active-call bar can be dragged anywhere (like the AI assistant button) so it does not
// cover the calendar or whatever the user needs to see mid-call. Position persists per browser
// as FRACTIONS of the viewport ({fx, fy} in 0..1) so a saved spot can never land off-screen on a
// different screen size / orientation / zoom level. null = default spot (top centre).
// Pointer events (not touch/mouse pairs) — reliable on iOS Safari. Double-tap the grip resets.
const POS_KEY = 'call-bar-pos-v2';
function useDraggableBar() {
  const [pos, setPos] = useState(() => {
    try {
      const s = localStorage.getItem(POS_KEY); const p = s ? JSON.parse(s) : null;
      return p && Number.isFinite(p.fx) && Number.isFinite(p.fy) ? p : null;
    } catch { return null; }
  });
  const ref = useRef(null);
  const posRef = useRef(pos);
  useEffect(() => { posRef.current = pos; }, [pos]);

  // On a phone the bar is nearly as wide as the screen, so there are only a few px of sideways
  // room: any finger wobble threw it to an edge. Below this much slack the bar stays centred and
  // only moves up/down; on wider screens it moves freely.
  const MIN_SIDEWAYS = 80;
  // px position for the current viewport; always keeps the whole bar inside the screen
  function toPx(p, el) {
    const r = el?.getBoundingClientRect();
    const w = r?.width || 0, h = r?.height || 0;
    const maxL = Math.max(0, window.innerWidth - w), maxT = Math.max(0, window.innerHeight - h);
    const left = maxL < MIN_SIDEWAYS ? maxL / 2 : Math.min(maxL, Math.max(0, p.fx * maxL));
    return { left: Math.round(left), top: Math.round(Math.min(maxT, Math.max(0, p.fy * maxT))) };
  }
  const [, force] = useState(0);
  useEffect(() => {
    const re = () => force(n => n + 1);
    window.addEventListener('resize', re);
    window.addEventListener('orientationchange', re);
    return () => { window.removeEventListener('resize', re); window.removeEventListener('orientationchange', re); };
  }, []);

  const lastTap = useRef(0);
  function onDragStart(e) {
    if (e.target.closest('button')) return;          // buttons keep their own taps
    const el = ref.current; if (!el) return;
    // double-tap/click on the bar body → back to the default spot
    const now = Date.now();
    if (now - lastTap.current < 350) { lastTap.current = 0; setPos(null); try { localStorage.removeItem(POS_KEY); } catch {} return; }
    lastTap.current = now;
    if (e.cancelable) e.preventDefault();
    const r = el.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    const origin = { left: r.left, top: r.top };
    const id = e.pointerId;
    try { el.setPointerCapture(id); } catch {}
    function onMove(ev) {
      if (ev.pointerId !== id) return;
      if (ev.cancelable) ev.preventDefault();          // no page scroll while dragging
      const maxL = Math.max(0, window.innerWidth - r.width), maxT = Math.max(0, window.innerHeight - r.height);
      const left = Math.min(maxL, Math.max(0, origin.left + (ev.clientX - start.x)));
      const top = Math.min(maxT, Math.max(0, origin.top + (ev.clientY - start.y)));
      const next = { fx: maxL < MIN_SIDEWAYS ? 0.5 : (maxL ? left / maxL : 0.5), fy: maxT ? top / maxT : 0 };
      posRef.current = next;
      setPos(next);
    }
    function onUp(ev) {
      if (ev.pointerId !== id) return;
      try { if (posRef.current) localStorage.setItem(POS_KEY, JSON.stringify(posRef.current)); } catch {}
      try { el.releasePointerCapture(id); } catch {}
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    }
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }

  const px = pos && ref.current ? toPx(pos, ref.current) : null;
  const style = px
    ? { left: px.left, top: px.top, transform: 'none' }
    : { top: 60 };
  return { ref, style, onDragStart, dragged: !!pos };
}

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

// Round button with a phone-dialer style caption under it
function CallBtn({ onClick, label, icon, active, activeCls = '', className = '', title }) {
  return (
    <button onClick={onClick} title={title} className="flex flex-col items-center gap-0.5 shrink-0">
      <span className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${className || (active ? activeCls : 'bg-white/15 hover:bg-white/25')}`}>{icon}</span>
      <span className="text-[10px] text-slate-300 leading-none">{label}</span>
    </button>
  );
}

export default function CallBar() {
  const { enabled, incoming, active, muted, error, clearError, acceptIncoming, rejectIncoming, hangup, toggleMute, outputs, setOutput, micLost, fixMic } = useCalls();
  const navigate = useNavigate();
  const timer = useTimer(active?.startedAt);
  const [pickOut, setPickOut] = useState(false);
  const drag = useDraggableBar();

  // "Speaker" = the loud output (built-in speakers) vs a headset. One tap toggles when there are
  // exactly two options; more options open a small picker.
  const speakerish = (d) => /speaker|רמקול|built-in|internal|default/i.test(d.label);
  const activeOut = outputs.devices.find(d => d.id === outputs.activeId);
  const onSpeaker = activeOut ? speakerish(activeOut) : false;
  function tapSpeaker() {
    if (!outputs.supported || outputs.devices.length < 2) return;
    if (outputs.devices.length === 2) {
      const other = outputs.devices.find(d => d.id !== outputs.activeId);
      if (other) setOutput(other.id);
    } else setPickOut(v => !v);
  }

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
        <div ref={drag.ref} className="fixed left-1/2 -translate-x-1/2 z-[90] w-[92%] max-w-md" style={{ ...drag.style, touchAction: 'none' }} dir="rtl"
          onPointerDown={drag.onDragStart} title="אפשר לגרור את החלון · לחיצה כפולה מחזירה למקום">
          <div className="rounded-2xl shadow-2xl bg-slate-900 text-white px-4 py-3 border border-white/10 flex items-center gap-3 cursor-grab active:cursor-grabbing select-none" style={{ touchAction: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}>
            <span className="text-slate-500 text-base leading-none shrink-0" aria-hidden="true">⋮⋮</span>
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
              {micLost && (
                <button onClick={fixMic} className="mt-1 text-[11px] font-black text-amber-300 bg-amber-500/20 border border-amber-400/40 rounded-lg px-2 py-0.5">
                  ⚠️ המיקרופון נותק על ידי הטלפון — הקש לחידוש
                </button>
              )}
              {!(outputs.supported && outputs.devices.length > 1) && (
                <div className="text-[10px] text-slate-400 truncate" title="יציאות שמע שהדפדפן מאפשר">
                  {outputs.supported ? (outputs.devices.length ? `יציאה: ${outputs.devices.map(d => d.label).join(' / ')}` : 'הדפדפן לא מציג יציאות שמע') : 'הדפדפן לא מאפשר בחירת רמקול'}
                </div>
              )}
            </div>
            {outputs.supported && outputs.devices.length > 1 && (
              <div className="relative">
                <CallBtn onClick={tapSpeaker} label={onSpeaker ? 'רמקול' : 'אוזנייה'} icon="🔊"
                  active={onSpeaker} activeCls="bg-sky-400 text-slate-900" title={activeOut ? `יציאת שמע: ${activeOut.label}` : 'רמקול'} />
                {pickOut && (
                  <div className="absolute top-full mt-1 right-0 bg-white text-slate-800 rounded-xl shadow-xl border border-slate-200 overflow-hidden min-w-[200px] z-10">
                    {outputs.devices.map(d => (
                      <button key={d.id} onClick={() => { setOutput(d.id); setPickOut(false); }}
                        className={`block w-full text-right px-3 py-2 text-sm hover:bg-slate-50 ${d.id === outputs.activeId ? 'font-black text-violet-700' : ''}`}>
                        {speakerish(d) ? '🔊 ' : '🎧 '}{d.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <CallBtn onClick={toggleMute} label={muted ? 'מושתק' : 'השתק'} icon={muted ? '🔇' : '🎙️'} active={muted} activeCls="bg-amber-400 text-slate-900" title={muted ? 'בטל השתקה' : 'השתק'} />
            <CallBtn onClick={hangup} label="נתק" icon="📵" className="bg-red-500 hover:bg-red-400" title="נתק" />
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
