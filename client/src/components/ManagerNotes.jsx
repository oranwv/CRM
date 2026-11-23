import { useEffect, useRef, useState } from 'react';
import api from '../api';

// הערות מנהל (Phase 119) — a code-locked private notes window inside an event's production card.
// The server is the lock (routes/managerNotes.js); this file only draws it. What the screen does
// on top of the lock, all of it deterrence and not a guarantee — a browser cannot stop a screenshot:
// - phones only (the server refuses a desktop browser too);
// - while writing you see only what you are typing now, never what is already saved;
// - saved entries are fetched and shown only while a finger is held on "החזק לקריאה", with the
//   reader's name and the time printed across them, and are dropped from memory on release;
// - the window locks itself after 2 minutes without typing, and the moment the screen is left.
const IDLE_SECONDS = 120;
const me = () => { try { return JSON.parse(localStorage.getItem('crm_user') || '{}'); } catch { return {}; } };
const errText = (e, fallback) => e?.response?.data?.error || fallback;
const fmt = d => new Date(d).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const noSelect = { WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' };

// One PIN field + confirm button, used by "ייצר קוד", "מחק" and the settings card.
export function PinPrompt({ label, confirmLabel, danger, busy, error, onConfirm, onCancel, children }) {
  const [pin, setPin] = useState('');
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
      <p className="text-sm font-bold text-slate-700 text-right">{label}</p>
      {children}
      <div className="flex gap-2">
        <input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          type="password" inputMode="numeric" autoComplete="off" placeholder="PIN" dir="ltr"
          className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-2 text-base text-center tracking-widest" />
        <button onClick={() => onConfirm(pin)} disabled={busy || pin.length !== 6}
          className={`text-sm font-bold px-3 py-2 rounded-xl text-white disabled:opacity-50 ${danger ? 'bg-red-600' : 'bg-violet-600'}`}>
          {busy ? '...' : confirmLabel}
        </button>
        {onCancel && <button onClick={onCancel} className="text-sm font-bold px-3 py-2 rounded-xl border border-slate-200 text-slate-500">ביטול</button>}
      </div>
      {error && <p className="text-sm text-red-600 text-right">{error}</p>}
    </div>
  );
}

export default function ManagerNotes({ leadId }) {
  const [status, setStatus]   = useState(null);
  const [key, setKey]         = useState('');
  const [error, setError]     = useState('');
  const [busy, setBusy]       = useState(false);
  const [panel, setPanel]     = useState(null);   // null | 'code' | 'wipe'
  const [newCode, setNewCode] = useState(null);   // { code, expires_at } — shown once
  const [token, setToken]     = useState(null);   // the window is open while this is set
  const [text, setText]       = useState('');
  const [note, setNote]       = useState('');
  const [left, setLeft]       = useState(IDLE_SECONDS);
  const [holding, setHolding] = useState(false);
  const [entries, setEntries] = useState(null);
  const tokenRef = useRef(null), textRef = useRef(''), holdRef = useRef(false);
  tokenRef.current = token; textRef.current = text;

  const loadStatus = () => api.get(`/manager-notes/${leadId}/status`).then(r => setStatus(r.data)).catch(() => setStatus(null));
  useEffect(() => { loadStatus(); }, [leadId]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = (t, body) => api.post(`/manager-notes/${leadId}/entries`, { text: body }, { headers: { 'X-Notes-Unlock': t } });

  // Close the window. Text that was typed and not saved yet is saved on the way out (best effort)
  // so an automatic lock never throws work away.
  function lock(message) {
    const t = tokenRef.current, pending = textRef.current.trim();
    if (!t) return;
    if (pending) send(t, pending).catch(() => {});
    holdRef.current = false;
    setToken(null); setText(''); setEntries(null); setHolding(false); setKey('');
    setNote(message || ''); setError('');
    loadStatus();
  }

  // Lock on leaving: another tab or app, the screen turning off, the card closing.
  useEffect(() => {
    if (!token) return;
    const away = () => lock('החלון ננעל');
    const vis  = () => { if (document.hidden) away(); };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('blur', away);
    window.addEventListener('pagehide', away);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('blur', away);
      window.removeEventListener('pagehide', away);
    };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => lock(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Lock after 2 minutes without typing or reading.
  useEffect(() => {
    if (!token) return;
    setLeft(IDLE_SECONDS);
    const id = setInterval(() => setLeft(s => (holdRef.current ? IDLE_SECONDS : s - 1)), 1000);
    return () => clearInterval(id);
  }, [token]);
  useEffect(() => { if (token && left <= 0) lock('החלון ננעל אחרי 2 דקות בלי פעילות'); }, [left]); // eslint-disable-line react-hooks/exhaustive-deps

  async function unlock() {
    setBusy(true); setError(''); setNote('');
    try {
      const { data } = await api.post(`/manager-notes/${leadId}/unlock`, { key });
      setKey(''); setNewCode(null); setPanel(null); setToken(data.token);
    } catch (e) { setError(errText(e, 'לא הצלחתי לפתוח')); setKey(''); }
    setBusy(false);
  }

  async function save() {
    const body = text.trim();
    if (!body) return;
    setBusy(true); setError('');
    try { await send(token, body); setText(''); setNote('נשמר'); setLeft(IDLE_SECONDS); }
    catch (e) { if (e?.response?.status === 423) lock('החלון ננעל. הקוד כבר לא בתוקף.'); else setError(errText(e, 'השמירה נכשלה')); }
    setBusy(false);
  }

  async function startHold(e) {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
    holdRef.current = true; setHolding(true); setLeft(IDLE_SECONDS);
    try {
      const { data } = await api.get(`/manager-notes/${leadId}/entries`, { headers: { 'X-Notes-Unlock': token } });
      if (holdRef.current) setEntries(data);
    } catch (err) { if (err?.response?.status === 423) lock('החלון ננעל. הקוד כבר לא בתוקף.'); }
  }
  function endHold() { holdRef.current = false; setHolding(false); setEntries(null); }

  async function makeCode(pin) {
    setBusy(true); setError('');
    try { const { data } = await api.post(`/manager-notes/${leadId}/code`, { pin }); setNewCode(data); setPanel(null); loadStatus(); }
    catch (e) { setError(errText(e, 'לא הצלחתי לייצר קוד')); }
    setBusy(false);
  }
  async function wipe(pin) {
    setBusy(true); setError('');
    try { await api.post(`/manager-notes/${leadId}/wipe`, { pin }); setPanel(null); setNewCode(null); setNote('ההערות של האירוע נמחקו'); loadStatus(); }
    catch (e) { setError(errText(e, 'המחיקה נכשלה')); }
    setBusy(false);
  }

  if (!status) return null;
  const isManager = status.is_manager;
  const keyLength = key.length;
  const canOpen = keyLength === 4 || (isManager && keyLength === 6);
  const user = me();
  const stamp = `${user.display_name || user.username || ''} · ${fmt(Date.now())}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex gap-1.5">
          {isManager && !token && (
            <>
              <button onClick={() => { setPanel(panel === 'code' ? null : 'code'); setError(''); setNote(''); }}
                className="text-xs font-bold px-2.5 py-1 rounded-full bg-white border border-violet-200 text-violet-700">🔑 ייצר קוד</button>
              <button onClick={() => { setPanel(panel === 'wipe' ? null : 'wipe'); setError(''); setNote(''); }}
                className="text-xs font-bold px-2.5 py-1 rounded-full bg-white border border-red-200 text-red-600">🗑 מחק</button>
            </>
          )}
          {token && <span className="text-xs text-slate-400">ננעל בעוד {Math.floor(left / 60)}:{String(Math.max(left, 0) % 60).padStart(2, '0')}</span>}
        </div>
        <h3 className="text-base font-black text-slate-700">הערות מנהל</h3>
      </div>

      <div className="bg-violet-50/30 rounded-2xl p-3 space-y-2" onContextMenu={e => e.preventDefault()}>
        {isManager && !status.has_pin && !token && (
          <p className="text-sm text-slate-500 text-right">כדי לייצר קוד או למחוק צריך קודם להגדיר PIN אישי במסך ההגדרות.</p>
        )}

        {panel === 'code' && (
          <PinPrompt label="ייצור קוד לאירוע הזה, תקף ל-8 שעות" confirmLabel="ייצר" busy={busy} error={error}
            onConfirm={makeCode} onCancel={() => { setPanel(null); setError(''); }} />
        )}
        {panel === 'wipe' && (
          <PinPrompt label="מחיקת כל מה שכתוב בהערות המנהל של האירוע הזה" confirmLabel="מחק לצמיתות" danger busy={busy} error={error}
            onConfirm={wipe} onCancel={() => { setPanel(null); setError(''); }}>
            <p className="text-xs text-red-600 text-right">אי אפשר לשחזר אחרי המחיקה.</p>
          </PinPrompt>
        )}

        {newCode && !token && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-center">
            <p className="text-xs text-emerald-700">הקוד לאירוע הזה. הוא מוצג רק עכשיו.</p>
            <p className="text-3xl font-black tracking-[0.4em] text-emerald-800 my-1" dir="ltr" style={noSelect}>{newCode.code}</p>
            <p className="text-xs text-emerald-700">תקף עד {fmt(newCode.expires_at)}</p>
            <button onClick={() => setNewCode(null)} className="mt-2 text-xs font-bold text-emerald-800 underline">הסתר</button>
          </div>
        )}
        {isManager && !newCode && !token && status.code_expires_at && (
          <p className="text-xs text-slate-500 text-right">יש קוד פעיל לאירוע, תקף עד {fmt(status.code_expires_at)}.</p>
        )}

        {!token && panel === null && (
          status.phone ? (
            <div className="flex items-center gap-2">
              <button onClick={unlock} disabled={busy || !canOpen}
                className="text-sm font-bold px-3 py-2 rounded-xl bg-violet-600 text-white disabled:opacity-50">פתח</button>
              <input value={key} onChange={e => { setKey(e.target.value.replace(/\D/g, '').slice(0, isManager ? 6 : 4)); setError(''); }}
                onKeyDown={e => { if (e.key === 'Enter' && canOpen) unlock(); }}
                type="password" inputMode="numeric" autoComplete="off" dir="ltr"
                placeholder={isManager ? 'קוד או PIN' : 'קוד'}
                className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-2 text-base text-center tracking-widest bg-white" />
              <span className="text-lg">🔒</span>
            </div>
          ) : (
            <p className="text-sm text-slate-500 text-right">🔒 נעול. נפתח רק מהטלפון.</p>
          )
        )}

        {token && (
          <>
            <textarea value={text} onChange={e => { setText(e.target.value); setLeft(IDLE_SECONDS); setNote(''); }}
              rows={4} placeholder="כתיבה חופשית..." autoComplete="off" autoCorrect="off" spellCheck={false}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-base bg-white resize-none" />
            <div className="flex gap-2">
              <button onClick={save} disabled={busy || !text.trim()}
                className="flex-1 bg-violet-600 text-white font-bold py-2 rounded-xl text-base disabled:opacity-50">{busy ? 'שומר...' : 'שמור'}</button>
              <button onClick={() => lock('החלון ננעל')}
                className="flex-1 bg-white border border-slate-300 text-slate-700 font-bold py-2 rounded-xl text-base">🔒 סיים ונעל</button>
            </div>
            {/* Right under the buttons: after a save the field empties on purpose, so say what happened where the eye is. */}
            {note === 'נשמר' && (
              <p className="text-sm font-bold text-emerald-700 text-right">✓ נשמר. מה שנכתב מוסתר, וכדי לראות אותו מחזיקים את הכפתור למטה.</p>
            )}
            {error && <p className="text-sm text-red-600 text-right">{error}</p>}

            {/* The reading box keeps its place and size whether or not it is showing, so nothing moves under the finger. */}
            <div className="relative rounded-xl border border-slate-200 bg-white p-3 h-[40vh] overflow-y-auto" style={noSelect}>
              {!holding ? (
                <p className="text-sm text-slate-400 text-center mt-[15vh]">מה שכבר נכתב מוסתר</p>
              ) : (
                <>
                  <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-10 text-slate-900 text-sm font-bold leading-10 text-center" aria-hidden="true">
                    {Array.from({ length: 12 }, (_, i) => <div key={i} className="-rotate-12 whitespace-nowrap">{stamp} · {stamp}</div>)}
                  </div>
                  {!entries ? <p className="text-sm text-slate-400 text-center">טוען...</p>
                    : !entries.length ? <p className="text-sm text-slate-400 text-center">עוד לא נכתב כאן כלום</p>
                    : entries.map(en => (
                      <div key={en.id} className="relative mb-3 last:mb-0 text-right">
                        <p className="text-xs font-bold text-violet-700">{en.author} · {fmt(en.created_at)}</p>
                        <p className="text-base text-slate-800 whitespace-pre-wrap break-words">{en.body ?? '(לא ניתן לקריאה)'}</p>
                      </div>
                    ))}
                </>
              )}
            </div>
            <button onPointerDown={startHold} onPointerUp={endHold} onPointerCancel={endHold} onLostPointerCapture={endHold}
              onContextMenu={e => e.preventDefault()} style={{ ...noSelect, touchAction: 'none' }}
              className={`w-full font-bold py-3 rounded-xl text-base border ${holding ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-300'}`}>
              👁 החזק לקריאת מה שכבר נכתב
            </button>
          </>
        )}

        {!token && panel === null && error && <p className="text-sm text-red-600 text-right">{error}</p>}
        {!token && note && <p className="text-sm text-slate-500 text-right">{note}</p>}
      </div>
    </div>
  );
}

// Settings card (הגדרות): my personal PIN + "delete all".
export function ManagerNotesSettings() {
  const [hasPin, setHasPin]   = useState(null);
  const [pin, setPin]         = useState('');
  const [current, setCurrent] = useState('');
  const [busy, setBusy]       = useState(false);
  const [msg, setMsg]         = useState('');
  const [error, setError]     = useState('');
  const [wiping, setWiping]   = useState(false);
  const [word, setWord]       = useState('');
  const [wipeError, setWipeError] = useState('');

  useEffect(() => { api.get('/manager-notes/pin').then(r => setHasPin(r.data.has_pin)).catch(() => setHasPin(null)); }, []);
  if (hasPin === null) return null;

  const digits = set => e => { set(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); setMsg(''); };
  async function savePin() {
    setBusy(true); setError(''); setMsg('');
    try { await api.post('/manager-notes/pin', { pin, current_pin: current }); setHasPin(true); setPin(''); setCurrent(''); setMsg('ה-PIN נשמר'); }
    catch (e) { setError(errText(e, 'השמירה נכשלה')); }
    setBusy(false);
  }
  async function wipeAll(p) {
    setBusy(true); setWipeError('');
    try {
      const { data } = await api.post('/manager-notes/wipe-all', { pin: p });
      setWiping(false); setWord(''); setMsg(data.events ? `נמחקו הערות המנהל של ${data.events} אירועים` : 'לא היה מה למחוק');
    } catch (e) { setWipeError(errText(e, 'המחיקה נכשלה')); }
    setBusy(false);
  }
  const field = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-base text-center tracking-widest';

  return (
    <div className="rounded-2xl p-4 bg-white border border-violet-100 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">🔒</span>
        <h2 className="font-black text-base text-slate-800">הערות מנהל</h2>
      </div>
      <p className="text-xs mb-3 text-slate-400">
        חלון נעול בתוך הפקת האירוע. ה-PIN האישי שלך (6 ספרות) פותח אותו, מייצר קוד לאירוע ומאשר מחיקה. לכל מנהל PIN משלו.
      </p>
      <div className="space-y-2">
        {hasPin && <input value={current} onChange={digits(setCurrent)} type="password" inputMode="numeric" autoComplete="off" dir="ltr" placeholder="ה-PIN הנוכחי" className={field} />}
        <input value={pin} onChange={digits(setPin)} type="password" inputMode="numeric" autoComplete="new-password" dir="ltr" placeholder={hasPin ? 'PIN חדש, 6 ספרות' : 'PIN, 6 ספרות'} className={field} />
        <button onClick={savePin} disabled={busy || pin.length !== 6 || (hasPin && current.length !== 6)}
          className="w-full py-2.5 rounded-xl font-black text-sm text-white disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
          {hasPin ? 'החלף PIN' : 'הגדר PIN'}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {msg && <p className="text-sm text-emerald-700">{msg}</p>}
      </div>

      {hasPin && (
        <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
          {!wiping ? (
            <button onClick={() => { setWiping(true); setMsg(''); setWipeError(''); }}
              className="w-full py-2.5 rounded-xl font-black text-sm text-red-600 border border-red-200 bg-white">
              🗑 מחק את כל הערות המנהל
            </button>
          ) : (
            <>
              <p className="text-sm text-red-600 font-bold">הפעולה מוחקת את הערות המנהל בכל האירועים, ואי אפשר לשחזר. כדי להמשיך כתוב: מחק</p>
              <input value={word} onChange={e => setWord(e.target.value)} placeholder="מחק" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-base text-center" />
              {word.trim() === 'מחק'
                ? <PinPrompt label="אישור עם ה-PIN שלך" confirmLabel="מחק הכול" danger busy={busy} error={wipeError} onConfirm={wipeAll} onCancel={() => { setWiping(false); setWord(''); }} />
                : <button onClick={() => { setWiping(false); setWord(''); }} className="text-sm font-bold text-slate-500 underline">ביטול</button>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
