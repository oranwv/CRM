import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAppMode } from '../context/AppModeContext';

const TOOL_LABELS = {
  get_my_tasks:       'מחפש משימות...',
  get_today_schedule: 'מושך לוז היום...',
  get_leads:          'מחפש לידים...',
  get_lead_details:   'טוען פרטי ליד...',
  get_urgent_leads:   'מחפש לידים דחופים...',
  get_op_tasks:       'מחפש משימות תפעול...',
  get_maintenance:    'טוען לוח תחזוקה...',
  get_suppliers:      'מחפש ספקים...',
  get_rsvp_summary:   'טוען נתוני אישורי הגעה...',
};

function MarkdownText({ content }) {
  const navigate = useNavigate();
  const tokens = [];
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m;

  while ((m = linkRe.exec(content)) !== null) {
    if (m.index > last) tokens.push({ type: 'text', value: content.slice(last, m.index) });
    tokens.push({ type: 'link', text: m[1], href: m[2] });
    last = m.index + m[0].length;
  }
  if (last < content.length) tokens.push({ type: 'text', value: content.slice(last) });

  return (
    <>
      {tokens.map((tok, i) => {
        if (tok.type === 'link') {
          if (tok.href.startsWith('tel:')) {
            return <a key={i} href={tok.href} className="text-blue-600 underline font-semibold">{tok.text}</a>;
          }
          if (tok.href.startsWith('/')) {
            return (
              <a key={i} href={tok.href} className="text-violet-600 underline font-semibold"
                onClick={e => { e.preventDefault(); navigate(tok.href); }}>
                {tok.text}
              </a>
            );
          }
          return <a key={i} href={tok.href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">{tok.text}</a>;
        }
        return tok.value.split('\n').map((line, j, arr) => (
          <span key={`${i}-${j}`}>
            {line.split(/(\*\*[^*]+\*\*)/).map((part, k) =>
              part.startsWith('**') && part.endsWith('**')
                ? <strong key={k}>{part.slice(2, -2)}</strong>
                : part
            )}
            {j < arr.length - 1 && <br />}
          </span>
        ));
      })}
    </>
  );
}

function Message({ msg }) {
  const isUser  = msg.role === 'user';
  const isError = msg.error;
  return (
    <div className={`flex ${isUser ? 'justify-start' : 'justify-end'} mb-2`}>
      <div
        className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? 'bg-violet-600 text-white rounded-br-sm'
            : isError
            ? 'bg-red-50 text-red-700 border border-red-200 rounded-bl-sm'
            : 'bg-gray-100 text-gray-800 rounded-bl-sm'
        }`}
        dir="rtl"
      >
        {isUser ? msg.content : <MarkdownText content={msg.content} />}
        {msg.streaming && (
          <span className="inline-block w-1.5 h-3.5 bg-gray-400 ml-0.5 animate-pulse rounded-sm" />
        )}
      </div>
    </div>
  );
}

export default function AIChat() {
  const location = useLocation();
  const { mode, openLeadId } = useAppMode();

  // All hooks must come before any conditional return
  const [open, setOpen]           = useState(false);
  const [messages, setMessages]   = useState([]);
  const [input, setInput]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [toolLabel, setToolLabel] = useState('');
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const abortRef  = useRef(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setLoading(true);
    setToolLabel('');

    const userMsg = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);

    const history = messages.slice(-14).map(m => ({ role: m.role, content: m.content }));
    const token   = localStorage.getItem('crm_token');
    const ctrl    = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: text, history, context: { mode, leadId: openLeadId || undefined } }),
        signal: ctrl.signal,
      });

      if (!resp.ok) {
        setMessages(prev => [...prev, { role: 'assistant', content: 'שגיאה בחיבור לשרת.', error: true }]);
        setLoading(false);
        return;
      }

      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';

        for (const part of parts) {
          if (!part.trim()) continue;
          let eventType = '';
          let dataStr   = '';
          for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim();
            if (line.startsWith('data: '))  dataStr   = line.slice(6).trim();
          }
          if (!dataStr) continue;
          let data;
          try { data = JSON.parse(dataStr); } catch { continue; }

          if (eventType === 'text') {
            setToolLabel('');
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant' && last.streaming) {
                return [...prev.slice(0, -1), { ...last, content: last.content + data.chunk }];
              }
              return [...prev, { role: 'assistant', content: data.chunk, streaming: true }];
            });
          } else if (eventType === 'tool_call') {
            setToolLabel(TOOL_LABELS[data.name] || 'חושב...');
          } else if (eventType === 'done') {
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant' && last.streaming) {
                return [...prev.slice(0, -1), { ...last, streaming: false }];
              }
              return prev;
            });
            setLoading(false);
            setToolLabel('');
          } else if (eventType === 'error') {
            setMessages(prev => [...prev, { role: 'assistant', content: data.message, error: true }]);
            setLoading(false);
            setToolLabel('');
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages(prev => [...prev, { role: 'assistant', content: 'שגיאה בחיבור.', error: true }]);
      }
      setLoading(false);
      setToolLabel('');
    }
  }, [input, loading, messages, mode]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function clearChat() {
    if (abortRef.current) abortRef.current.abort();
    setMessages([]);
    setLoading(false);
    setToolLabel('');
  }

  // Guard: don't render on public pages or when logged out
  const isPublic   = ['/login', '/postpone', '/task-action', '/sign'].some(p => location.pathname.startsWith(p));
  const isLoggedIn = !!localStorage.getItem('crm_token');
  if (isPublic || !isLoggedIn) return null;

  return (
    <div className="fixed bottom-28 right-4 z-[60] flex flex-col items-end gap-2">
      {open && (
        <div
          className="w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
          style={{ height: 'min(480px, calc(100vh - 200px))' }}
        >
          <div
            className="flex items-center justify-between px-4 py-3 text-white text-sm font-bold flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
            dir="rtl"
          >
            <span>עוזר AI</span>
            <div className="flex items-center gap-2">
              {messages.length > 0 && (
                <button onClick={clearChat} className="text-white/70 hover:text-white text-xs transition">
                  נקה
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white text-lg leading-none transition">
                ×
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1" dir="rtl">
            {messages.length === 0 && (
              <div className="text-center text-gray-400 text-xs mt-8 px-4 leading-relaxed">
                שלום! שאל אותי על הלידים, המשימות, הלוז שלך — כל מה שצריך.
              </div>
            )}
            {messages.map((msg, i) => <Message key={i} msg={msg} />)}
            {toolLabel && (
              <div className="flex justify-end mb-1">
                <div className="text-xs text-gray-400 italic px-3 py-1.5 bg-gray-50 rounded-full border border-gray-100">
                  {toolLabel}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="flex-shrink-0 px-3 pb-3 pt-2 border-t border-gray-100">
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="שאל שאלה..."
                disabled={loading}
                rows={1}
                dir="rtl"
                className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-200 transition disabled:opacity-50"
                style={{ maxHeight: 80, overflowY: 'auto' }}
                onInput={e => {
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 80) + 'px';
                }}
              />
              <button
                onClick={send}
                disabled={loading || !input.trim()}
                className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(o => !o)}
        className="w-12 h-12 rounded-full text-white text-sm font-black shadow-lg hover:shadow-xl transition-all active:scale-95"
        style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', boxShadow: open ? '0 0 0 3px rgba(124,58,237,0.3)' : undefined }}
      >
        AI
      </button>
    </div>
  );
}
