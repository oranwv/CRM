// Offer builder (Phase 102) — the first screen of the price-offer modal.
// The user says what the offer should be (records or types); only then the
// assistant asks about what is missing. When nothing is missing, onDone(spec)
// hands the spec to the modal, which fills the template and opens the regular
// preview. "מעדיף למלא לבד" (onManual) goes to the step-by-step wizard as before.
import { useEffect, useRef, useState } from 'react';
import api from '../api';
import useVoiceToText from '../hooks/useVoiceToText';
import { fmtGuests } from '../utils/guests';

const Mic = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
);
const Stop = ({ size = 14 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>;

export default function OfferBuilder({ lead, template, onDone, onManual }) {
  const [messages, setMessages] = useState([]); // { role: 'user'|'assistant'|'system', content, voice? }
  const [spec, setSpec]         = useState(null);
  const [input, setInput]       = useState('');
  const [busy, setBusy]         = useState(false);
  const [viaVoice, setViaVoice] = useState(false); // the text in the input came from a recording
  const scrollRef = useRef(null);
  const inputRef  = useRef(null);
  const started = messages.length > 0;

  const voice = useVoiceToText(text => { setInput(v => (v ? v + ' ' : '') + text); setViaVoice(true); });

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const history = [...messages, { role: 'user', content: text, voice: viaVoice }];
    setMessages(history); setInput(''); setViaVoice(false); setBusy(true);
    try {
      const { data } = await api.post(`/leads/${lead.id}/price-offer/build`, {
        messages: history.filter(m => m.role !== 'system').map(({ role, content }) => ({ role, content })),
        spec, template,
      });
      setSpec(data.spec);
      setMessages(m => [...m, { role: 'assistant', content: data.reply }]);
      if (data.ready) setTimeout(() => onDone(data.spec), 900);
    } catch (e) {
      setMessages(m => [...m, { role: 'system', content: e.response?.data?.error || 'העוזר לא זמין כרגע, נסה שוב' }]);
    }
    setBusy(false);
  }

  const known = [lead.name, lead.event_name && lead.event_name !== lead.name ? lead.event_name : null, lead.event_type,
    lead.event_date_text || (lead.event_date ? String(lead.event_date).slice(0, 10).split('-').reverse().join('.') : null),
    lead.event_time ? `${lead.event_time}${lead.event_end_time ? '–' + lead.event_end_time : ''}` : null,
    fmtGuests(lead) ? `${fmtGuests(lead)} מוזמנים` : null].filter(Boolean);

  const recording = voice.state === 'recording', transcribing = voice.state === 'transcribing';

  /* ── Start screen: say what you want ── */
  if (!started) {
    return (
      <div className="flex flex-col gap-3" dir="rtl">
        {known.length > 0 && (
          <div className="rounded-xl bg-violet-50 px-3 py-2 text-sm text-slate-700 leading-relaxed">
            <p className="text-[11px] font-bold text-violet-600">מה שכבר ידוע מכרטיס הליד</p>
            <p className="wrap-anywhere">{known.join(' · ')}</p>
          </div>
        )}
        <div className="text-center">
          <p className="font-black text-slate-800 text-lg">ספר לי על ההצעה</p>
          <p className="text-sm text-slate-500">הקלט או כתוב בחופשיות. אני אשאל רק על מה שחסר.</p>
        </div>
        <button type="button" onClick={voice.toggle} disabled={transcribing}
          className={`mx-auto w-24 h-24 rounded-full grid place-items-center text-white transition disabled:opacity-60 ${recording ? 'bg-red-600 animate-pulse' : 'bg-rose-500 hover:bg-rose-600'}`}
          style={{ boxShadow: '0 0 0 10px rgba(244,63,94,.12)' }} aria-label={recording ? 'עצור הקלטה' : 'התחל הקלטה'}>
          {recording ? <Stop size={30} /> : <Mic size={38} />}
        </button>
        <p className="text-sm text-center font-bold text-slate-500">
          {recording ? `מקליט… ${voice.mmss} · לחץ לסיום` : transcribing ? 'מתמלל את ההקלטה…' : 'לחץ להקלטה'}
        </p>
        {voice.error && <p className="text-sm text-center font-bold text-red-500">{voice.error}</p>}
        <div className="flex items-center gap-2 text-xs text-slate-400"><span className="flex-1 h-px bg-slate-200" />או<span className="flex-1 h-px bg-slate-200" /></div>
        <textarea id="offer-builder-first" value={input} onChange={e => { setInput(e.target.value); }} rows={4}
          placeholder="כתוב כאן… למשל: חבילה ל-40 איש עם תפריט צהריים ובר, והם מקבלים גם את המתחם ליד ליוגה"
          className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-violet-400 resize-none" />
        {viaVoice && input && <p className="text-xs text-slate-400 -mt-2">זה התמלול של ההקלטה. אפשר לתקן לפני ששולחים.</p>}
        <button type="button" onClick={send} disabled={!input.trim() || busy || recording || transcribing}
          className="w-full py-2.5 rounded-xl font-black text-white disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
          המשך
        </button>
        <button type="button" onClick={onManual} className="text-sm font-bold text-slate-500 underline">מעדיף למלא לבד, שלב אחרי שלב</button>
      </div>
    );
  }

  /* ── Conversation ── */
  return (
    <div className="flex flex-col gap-3" dir="rtl">
      <div ref={scrollRef} className="max-h-[52vh] min-h-[30vh] overflow-y-auto space-y-2 rounded-xl bg-slate-50 border border-slate-100 p-2">
        {messages.map((m, i) => (
          m.role === 'user' ? (
            <div key={i} className="flex justify-start">
              <p className="max-w-[88%] bg-violet-600 text-white text-sm rounded-2xl rounded-tr-sm px-3 py-1.5 whitespace-pre-wrap wrap-anywhere">
                {m.voice && <span className="block text-[11px] opacity-80">🎤 הקלטה</span>}{m.content}
              </p>
            </div>
          ) : m.role === 'assistant' ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[92%] bg-white border border-slate-200 text-slate-700 text-sm rounded-2xl rounded-tl-sm px-3 py-1.5 whitespace-pre-wrap wrap-anywhere">{m.content}</p>
            </div>
          ) : (
            <p key={i} className="text-xs text-red-500 font-bold text-center">{m.content}</p>
          )
        ))}
        {busy && <p className="text-xs text-slate-400 text-center">העוזר חושב…</p>}
      </div>
      <div className="flex items-end gap-1 rounded-xl border-2 border-violet-300 focus-within:border-violet-500 bg-white px-2 py-1">
        <textarea id="offer-builder-input" ref={inputRef} rows={1} value={input}
          onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={recording ? `מקליט… ${voice.mmss}` : transcribing ? 'מתמלל…' : 'כתוב תשובה…'}
          className="flex-1 min-w-0 resize-none bg-transparent text-sm py-1.5 focus:outline-none placeholder:text-slate-400" />
        <button type="button" onClick={voice.toggle} disabled={busy || transcribing} aria-label="הקלטה"
          className={`w-8 h-8 mb-0.5 shrink-0 rounded-full grid place-items-center disabled:opacity-40 ${recording ? 'bg-red-600 text-white animate-pulse' : 'bg-rose-50 text-rose-600'}`}>
          {recording ? <Stop size={12} /> : <Mic size={15} />}
        </button>
        <button type="button" onClick={send} disabled={busy || !input.trim()} aria-label="שלח"
          className="w-8 h-8 mb-0.5 shrink-0 rounded-full bg-violet-600 text-white grid place-items-center disabled:opacity-40">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>
        </button>
      </div>
      {voice.error && <p className="text-xs font-bold text-red-500">{voice.error}</p>}
      <button type="button" onClick={() => spec && onDone(spec)} disabled={busy || !spec}
        className="w-full py-2.5 rounded-xl font-black text-white disabled:opacity-40"
        style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
        הכן את ההצעה עם מה שיש
      </button>
      <button type="button" onClick={onManual} className="text-sm font-bold text-slate-500 underline">מעדיף למלא לבד, שלב אחרי שלב</button>
    </div>
  );
}
