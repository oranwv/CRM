// Contract assistant (Phase 90) — a small chat under the contract preview.
// The user asks for a clause to be drafted / added / reworded / removed or a
// number changed; the assistant answers with a proposal (exact text + where it
// goes) and nothing changes until the user approves. An approved proposal is
// applied to the modal's own state by applyContractOps, so only the named
// pieces change and everything stays editable by hand afterwards.
// "חזור לפני השינוי" is always available: every applied proposal pushes the
// state from before it, and each press goes one change back.
import { useEffect, useRef, useState } from 'react';
import api from '../api';
import { applyContractOps } from '../utils/contractOps';
import useVoiceToText from '../hooks/useVoiceToText';

const KIND = {
  add:     { label: 'הוספה',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  replace: { label: 'שינוי נוסח', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  delete:  { label: 'מחיקה',  cls: 'bg-red-50 text-red-600 border-red-200' },
  field:   { label: 'שינוי ערך', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
};

// `endpoint` / `noun` let the price-offer preview use the same assistant (Phase 102).
export default function ContractAssistant({ leadId, visible, getContract, onApply, endpoint = 'contracts/assistant', noun = 'החוזה', initialStatus = '' }) {
  const [messages, setMessages] = useState([]);   // { role: 'user'|'assistant'|'system', content }
  const [pending, setPending]   = useState(null); // { ops, items, notes }
  const [input, setInput]       = useState('');
  const [busy, setBusy]         = useState(false);
  const [open, setOpen]         = useState(false);
  const [undo, setUndo]         = useState([]);   // snapshots { fields, rows, texts }
  const [recent, setRecent]     = useState([]);   // clause texts already offered — the server uses them to avoid repeating itself
  const [status, setStatus]     = useState(initialStatus);   // one line shown while the thread is collapsed
  const scrollRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, pending, busy, open]);

  const say = (role, content) => setMessages(m => [...m, { role, content }]);
  // Voice: the transcript lands in the input so it can be corrected before sending
  const voice = useVoiceToText(text => { setInput(v => (v ? v + ' ' : '') + text); setOpen(true); inputRef.current?.focus(); });

  function applyPending(proposal) {
    const p = proposal || pending;
    if (!p) return;
    const c = getContract();
    const before = { fields: c.fields, rows: c.rows, texts: c.texts };
    const next = applyContractOps(before, p.ops);
    if (next.error) { setPending(null); say('system', next.error); return; }
    setUndo(u => [...u, before]);
    onApply(next);
    setPending(null);
    say('system', 'בוצע. השינוי מופיע במסמך, ואפשר להמשיך לערוך אותו ביד.');
    // Get out of the way so the contract can be read: collapse the thread, keep one status line.
    setStatus('✓ בוצע. השינוי במסמך.');
    setOpen(false);
  }

  function goBack() {
    if (!undo.length) return;
    const prev = undo[undo.length - 1];
    setUndo(u => u.slice(0, -1));
    onApply(prev);
    setPending(null);
    say('system', 'החזרתי את המסמך למצב שלפני השינוי האחרון.');
    setStatus('↩ המסמך חזר למצב שלפני השינוי האחרון.');
    setOpen(false);
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setOpen(true);
    setStatus('');
    const history = [...messages, { role: 'user', content: text }];
    setMessages(history);
    setBusy(true);
    try {
      const { data } = await api.post(`/leads/${leadId}/${endpoint}`, {
        contract: getContract(),
        messages: history.filter(m => m.role !== 'system'),
        pending: pending?.ops || null,
        recentTexts: recent,
      });
      say('assistant', data.reply);
      if (data.apply_pending && pending) applyPending(pending);
      else if (data.proposal) {
        setPending(data.proposal);
        setRecent(r => [...r, ...data.proposal.ops.map(o => o.text).filter(Boolean)].slice(-6));
      }
    } catch (e) {
      say('system', e.response?.data?.error || 'העוזר לא זמין כרגע, נסה שוב');
    }
    setBusy(false);
  }

  function onInput(e) {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  }

  if (!visible) return null;
  const hasThread = messages.length > 0 || pending;

  return (
    <div className="mb-3" dir="rtl">
      {hasThread && open && (
        <div className="mb-2 rounded-xl bg-slate-50 border border-slate-100 overflow-hidden">
        <button type="button" onClick={() => setOpen(false)}
          className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-bold text-violet-700 bg-violet-50 border-b border-violet-100">
          <span>שיחה עם העוזר</span><span>צמצם כדי לקרוא את {noun} ▾</span>
        </button>
        <div ref={scrollRef} className="max-h-[32vh] overflow-y-auto space-y-2 p-2">
          {messages.map((m, i) => (
            m.role === 'user' ? (
              <div key={i} className="flex justify-start">
                <p className="max-w-[85%] bg-violet-600 text-white text-sm rounded-2xl rounded-tr-sm px-3 py-1.5 whitespace-pre-wrap wrap-anywhere">{m.content}</p>
              </div>
            ) : m.role === 'assistant' ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[90%] bg-white border border-slate-200 text-slate-700 text-sm rounded-2xl rounded-tl-sm px-3 py-1.5 whitespace-pre-wrap wrap-anywhere">{m.content}</p>
              </div>
            ) : (
              <p key={i} className="text-xs text-slate-500 text-center">{m.content}</p>
            )
          ))}

          {pending && (
            <div className="rounded-xl border-2 border-violet-200 bg-white p-2.5 space-y-2">
              <p className="text-xs font-black text-violet-700">הצעה לשינוי — עוד לא בוצע</p>
              {pending.items.map((it, i) => {
                const k = KIND[it.kind] || KIND.replace;
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex items-start gap-1.5 flex-wrap">
                      <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full border ${k.cls}`}>{k.label}</span>
                      <span className="text-xs font-bold text-slate-600 flex-1 min-w-0">{it.where}</span>
                    </div>
                    {it.before != null && (
                      <p className="text-sm text-slate-400 line-through whitespace-pre-wrap wrap-anywhere bg-slate-50 rounded-lg px-2 py-1">{it.before}</p>
                    )}
                    {it.after != null && (
                      <p className="text-sm text-slate-800 whitespace-pre-wrap wrap-anywhere bg-violet-50 rounded-lg px-2 py-1">{it.after}</p>
                    )}
                  </div>
                );
              })}
              {(pending.notes || []).map((n, i) => <p key={i} className="text-xs text-amber-700 font-bold">{n}</p>)}
              <p className="text-[11px] text-slate-400">שום דבר אחר במסמך לא משתנה.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => applyPending()} disabled={busy}
                  className="flex-1 py-2 rounded-xl font-black text-sm text-white bg-violet-600 disabled:opacity-50">אשר ובצע</button>
                <button type="button" onClick={() => { setPending(null); say('system', 'ההצעה בוטלה, החוזה לא השתנה.'); }} disabled={busy}
                  className="px-4 py-2 rounded-xl font-bold text-sm border border-slate-200 text-slate-600">לא</button>
              </div>
            </div>
          )}
          {busy && <p className="text-xs text-slate-400 text-center">העוזר כותב…</p>}
        </div>
        </div>
      )}
      {hasThread && !open && (
        <button type="button" onClick={() => setOpen(true)}
          className={`w-full mb-2 flex items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-xs font-bold border ${pending ? 'bg-violet-600 text-white border-violet-600' : 'bg-violet-50 text-violet-700 border-violet-100'}`}>
          <span className="truncate">{pending ? 'יש הצעה שמחכה לאישור שלך' : (status || 'שיחה עם העוזר')}</span>
          <span className="shrink-0">הצג שיחה ▴</span>
        </button>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1 min-w-0 flex items-end gap-1 rounded-xl border-2 border-violet-300 focus-within:border-violet-500 bg-white px-2 py-1">
          <span className="text-violet-500 pb-1.5 select-none" aria-hidden="true">✦</span>
          <textarea id="contract-assistant-input" ref={inputRef} rows={1} value={input} onChange={onInput}
            onFocus={() => setOpen(true)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={voice.state === 'recording' ? `מקליט… ${voice.mmss}` : voice.state === 'transcribing' ? 'מתמלל…' : 'בקש שינוי מהעוזר…'}
            className="flex-1 min-w-0 resize-none bg-transparent text-sm py-1.5 focus:outline-none placeholder:text-slate-400" />
          <button type="button" onClick={voice.toggle} disabled={busy || voice.state === 'transcribing'} aria-label="הקלטה" title="הקלט בקשה"
            className={`w-8 h-8 mb-0.5 shrink-0 rounded-full grid place-items-center disabled:opacity-40 ${voice.state === 'recording' ? 'bg-red-600 text-white animate-pulse' : 'bg-rose-50 text-rose-600'}`}>
            {voice.state === 'recording'
              ? <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>
              : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>}
          </button>
          <button type="button" onClick={send} disabled={busy || !input.trim()} aria-label="שלח לעוזר"
            className="w-8 h-8 mb-0.5 shrink-0 rounded-full bg-violet-600 text-white grid place-items-center disabled:opacity-40">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>
          </button>
        </div>
      </div>

      {voice.error && <p className="text-xs font-bold text-red-500 mt-1">{voice.error}</p>}
      <div className="flex items-center justify-between mt-1.5">
        <button type="button" onClick={goBack} disabled={!undo.length || busy}
          className="text-xs font-bold px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
          title="מחזיר את החוזה למצב שלפני השינוי האחרון של העוזר">
          ↩ חזור לפני השינוי{undo.length > 1 ? ` (${undo.length})` : ''}
        </button>
      </div>
    </div>
  );
}
