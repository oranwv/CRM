// Phase 88 — לשונית וואטסאפ: the business WhatsApp inside the CRM (sales mode).
// A conversation list (one per lead) + an open chat that looks like WhatsApp. Everything is read
// from, and sent through, the same endpoints the lead card uses, so a message sent here shows up
// on the lead's "וואטסאפ ואימייל" tab and the other way round.
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../api';
import { useAppMode } from '../context/AppModeContext';
import { openLead } from '../utils/openLead';
import { WaBubbleBody } from '../components/LeadCard';
import DriveFilePicker from '../components/DriveFilePicker';

const IL = { timeZone: 'Asia/Jerusalem' };
const WA_GREEN = '#008069';

const STAGE_LABELS = {
  new: 'חדש', new_no_answer: 'חדש ולא עונה', contacted: 'בוצעה שיחה ראשונית',
  meeting_scheduled: 'נקבעה פגישה', meeting: 'בוצעה פגישה', offer_sent: 'נשלחה הצעת מחיר',
  negotiation: 'מו"מ', contract_sent: 'חוזה נשלח', process_no_answer: 'בתהליך ונעלם / לא עונה',
  deposit: 'התקבלה מקדמה', production: 'הפקה', completed: 'אירוע הסתיים', lost: 'לא סגרו',
};

const dayKey = d => new Date(d).toLocaleDateString('en-CA', IL); // YYYY-MM-DD in Israel time
const timeOf = d => new Date(d).toLocaleTimeString('en-GB', { ...IL, hour: '2-digit', minute: '2-digit', hour12: false });
function daysAgo(d) {
  const a = new Date(dayKey(new Date()) + 'T00:00:00Z'), b = new Date(dayKey(d) + 'T00:00:00Z');
  return Math.round((a - b) / 86400000);
}
// List row: today → hour, yesterday → "אתמול", older → date
function listTime(d) {
  if (!d) return '';
  const n = daysAgo(d);
  if (n <= 0) return timeOf(d);
  if (n === 1) return 'אתמול';
  return new Date(d).toLocaleDateString('en-GB', { ...IL, day: '2-digit', month: '2-digit', year: '2-digit' });
}
function dayLabel(d) {
  const n = daysAgo(d);
  if (n <= 0) return 'היום';
  if (n === 1) return 'אתמול';
  return new Date(d).toLocaleDateString('he-IL', { ...IL, weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' });
}
function waitText(since) {
  if (!since) return '';
  const min = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 60000));
  if (min < 1) return 'עכשיו';
  if (min < 60) return `${min} דק׳`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} שע׳`;
  const days = Math.floor(h / 24);
  return days === 1 ? 'יום' : `${days} ימים`;
}
// "[[FILE:id|name]]" markers → the file's name, for the one-line preview
const previewOf = body => (body || '').replace(/\[\[FILE:[^|\]]+\|([^\]]+)\]\]/g, '📎 $1').replace(/\s+/g, ' ').trim();

// The customer's WhatsApp profile picture (Phase 96). No picture, a hidden one, or a link that
// no longer loads → the first letter of the name, as before.
function Avatar({ name, url, size = 48 }) {
  const [failed, setFailed] = useState(null); // the url that failed to load
  const ch = (name || '').trim().charAt(0) || '?';
  if (url && failed !== url) {
    return (
      <img src={url} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(url)}
        className="shrink-0 rounded-full object-cover" style={{ width: size, height: size, background: '#dfe5e7' }} />
    );
  }
  return (
    <span aria-hidden="true" className="shrink-0 rounded-full flex items-center justify-center font-bold"
      style={{ width: size, height: size, background: '#dfe5e7', color: '#3b4a54', fontSize: size * 0.36 }}>
      {ch}
    </span>
  );
}

const attName = a => (a.type === 'local' ? a.file.name : a.name || a.filename || 'קובץ');

export default function WhatsAppPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { mode } = useAppMode();
  const me = useMemo(() => { try { return JSON.parse(localStorage.getItem('crm_user') || '{}'); } catch { return {}; } }, []);

  const chatId = Number(new URLSearchParams(location.search).get('chat')) || null;

  const [chats, setChats]     = useState(null); // null = first load
  const [loadErr, setLoadErr] = useState(false);
  const [filter, setFilter]   = useState('all'); // all | awaiting
  // Phase 96 — filter by the lead's אחראי: [] = everyone; user ids as strings, 'none' = no אחראי.
  const [owners, setOwners]   = useState(() => {
    try { const v = JSON.parse(localStorage.getItem('crm_wa_owners') || '[]'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
  });
  const [ownersOpen, setOwnersOpen] = useState(false);
  useEffect(() => { try { localStorage.setItem('crm_wa_owners', JSON.stringify(owners)); } catch { /* private mode */ } }, [owners]);
  const [search, setSearch]   = useState('');

  const loadChats = useCallback(() => {
    return api.get('/whatsapp/inbox')
      .then(r => { setChats(r.data); setLoadErr(false); })
      .catch(() => setLoadErr(true));
  }, []);

  useEffect(() => {
    loadChats();
    const t = setInterval(() => { if (!document.hidden) loadChats(); }, 20_000);
    return () => clearInterval(t);
  }, [loadChats]);

  const inOwners = c => !owners.length || owners.includes(c.assigned_to == null ? 'none' : String(c.assigned_to));
  const awaitingCount = (chats || []).filter(c => c.awaiting && inOwners(c)).length;
  // Whoever is אחראי on at least one conversation, me first.
  const ownerOptions = useMemo(() => {
    const byId = new Map();
    for (const c of chats || []) if (c.assigned_to != null) byId.set(String(c.assigned_to), c.assigned_name || 'משתמש');
    const rest = [...byId.entries()].filter(([id]) => id !== String(me.id)).sort((a, b) => a[1].localeCompare(b[1], 'he'));
    const opts = me.id != null ? [[String(me.id), `שלי${me.display_name ? ` (${me.display_name})` : ''}`]] : [];
    return [...opts, ...rest];
  }, [chats, me.id, me.display_name]);
  const toggleOwner = id => setOwners(o => (o.includes(id) ? o.filter(x => x !== id) : [...o, id]));
  const ownersLabel = !owners.length ? 'כולם'
    : owners.length === 1 ? (owners[0] === 'none' ? 'ללא אחראי' : owners[0] === String(me.id) ? 'שלי' : (ownerOptions.find(([id]) => id === owners[0])?.[1] || '1'))
    : `${owners.length} נבחרו`;
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    return (chats || []).filter(c => {
      if (filter === 'awaiting' && !c.awaiting) return false;
      if (owners.length && !owners.includes(c.assigned_to == null ? 'none' : String(c.assigned_to))) return false;
      if (!q) return true;
      if ((c.name || '').toLowerCase().includes(q)) return true;
      return qDigits.length >= 3 && (c.phone || '').replace(/\D/g, '').includes(qDigits);
    });
  }, [chats, filter, search, owners]);

  function openChat(id) {
    // On a phone the chat covers the list, so the back gesture should return to the list:
    // push one history entry when opening from the list, replace when switching chats.
    navigate(`/whatsapp?chat=${id}`, { replace: !!chatId, state: { fromList: true } });
  }
  function closeChat() {
    if (location.state?.fromList) navigate(-1);
    else navigate('/whatsapp', { replace: true });
  }

  const active = chatId ? (chats || []).find(c => c.lead_id === chatId) : null;

  const chip = (key, label) => (
    <button key={key} onClick={() => setFilter(key)}
      className="min-h-11 px-4 rounded-full text-sm font-bold transition"
      style={filter === key ? { background: '#d9fdd3', color: '#005c4b' } : { background: '#f0f2f5', color: '#3b4a54' }}>
      {label}
    </button>
  );

  return (
    <div dir="rtl" className="bg-white md:fixed md:inset-x-0 md:top-11 md:bottom-[var(--crm-nav-h,0px)] md:flex">
      {/* ── Conversation list ── */}
      <aside className="md:w-[380px] md:shrink-0 md:flex md:flex-col md:min-h-0 md:border-l md:border-slate-200">
        <div className="px-4 pt-3 pb-2.5 text-white space-y-2.5" style={{ background: WA_GREEN }}>
          <div className="text-xl font-bold">וואטסאפ העסק</div>
          <label className="flex items-center gap-2 h-11 px-3 rounded-full bg-white text-slate-500">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="חיפוש לפי שם או טלפון"
              className="flex-1 min-w-0 bg-transparent outline-none text-base text-slate-900" />
          </label>
        </div>
        <div className="relative flex gap-2 px-3 py-2.5 border-b border-slate-200">
          {chip('all', 'הכל')}
          {chip('awaiting', `לא נענו · ${awaitingCount}`)}
          <button onClick={() => setOwnersOpen(v => !v)} aria-expanded={ownersOpen} aria-haspopup="true"
            className="min-h-11 min-w-0 px-4 rounded-full text-sm font-bold transition truncate"
            style={owners.length ? { background: '#d9fdd3', color: '#005c4b' } : { background: '#f0f2f5', color: '#3b4a54' }}>
            אחראי: {ownersLabel} ▾
          </button>
          {ownersOpen && (
            <>
              <button aria-label="סגירת רשימת האחראים" className="fixed inset-0 z-40 cursor-default" onClick={() => setOwnersOpen(false)} />
              <div className="absolute z-50 top-full left-3 -mt-1 w-56 max-h-80 overflow-y-auto py-1.5 rounded-xl bg-white" style={{ boxShadow: '0 8px 28px rgba(0,0,0,0.28)' }}>
                <label className="flex items-center gap-2.5 min-h-11 px-3.5 text-[15px] font-bold cursor-pointer">
                  <input type="checkbox" checked={!owners.length} onChange={() => setOwners([])} className="w-[18px] h-[18px]" style={{ accentColor: WA_GREEN }} />כולם
                </label>
                {ownerOptions.map(([id, label]) => (
                  <label key={id} className="flex items-center gap-2.5 min-h-11 px-3.5 text-[15px] cursor-pointer">
                    <input type="checkbox" checked={owners.includes(id)} onChange={() => toggleOwner(id)} className="w-[18px] h-[18px]" style={{ accentColor: WA_GREEN }} />
                    <span className="truncate">{label}</span>
                  </label>
                ))}
                <label className="flex items-center gap-2.5 min-h-11 px-3.5 text-[15px] cursor-pointer border-t border-slate-200">
                  <input type="checkbox" checked={owners.includes('none')} onChange={() => toggleOwner('none')} className="w-[18px] h-[18px]" style={{ accentColor: WA_GREEN }} />ללא אחראי
                </label>
              </div>
            </>
          )}
        </div>
        <div className="md:flex-1 md:overflow-y-auto md:min-h-0">
          {chats === null && !loadErr && <div className="text-center py-12 text-slate-500">טוען שיחות…</div>}
          {loadErr && chats === null && <div className="text-center py-12 text-red-700 font-semibold">לא הצלחתי לטעון את השיחות. נסו לרענן.</div>}
          {chats !== null && shown.length === 0 && (
            <div className="text-center py-12 text-slate-500">
              {filter === 'awaiting' ? 'אין שיחות שמחכות לתשובה' : 'לא נמצאו שיחות'}{owners.length ? ' אצל האחראים שנבחרו' : ''}
            </div>
          )}
          {shown.map(c => {
            const unread = c.unread > 0;
            const sub = [c.event_type, STAGE_LABELS[c.stage] || c.stage].filter(Boolean).join(' · ');
            const isActive = c.lead_id === chatId;
            return (
              <button key={c.lead_id} onClick={() => openChat(c.lead_id)}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 text-right border-b transition"
                style={{
                  background: c.awaiting ? '#ffedd5' : isActive ? '#f0f2f5' : '#ffffff',
                  borderColor: c.awaiting ? '#f5d0a9' : '#f0f2f5',
                  boxShadow: isActive ? `inset -4px 0 0 ${WA_GREEN}` : 'none',
                }}>
                <Avatar name={c.name} url={c.avatar_url} />
                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="flex justify-between gap-2">
                    <span className={`text-base truncate ${unread || c.awaiting ? 'font-bold' : 'font-semibold'}`} style={{ color: '#111b21' }}>
                      {c.name || c.phone || 'ללא שם'}
                    </span>
                    <span className={`shrink-0 text-xs ${unread ? 'font-bold' : ''}`} style={{ color: unread ? WA_GREEN : '#54656f' }}>
                      {listTime(c.last_at)}
                    </span>
                  </span>
                  <span className="flex justify-between items-center gap-2">
                    <span className="text-sm truncate" style={{ color: unread ? '#3b4a54' : '#54656f' }}>
                      {c.last_direction === 'outbound' ? 'את/ה: ' : ''}{previewOf(c.last_body) || '—'}
                    </span>
                    {unread && (
                      <span className="shrink-0 min-w-[22px] h-[22px] px-1.5 rounded-full text-white text-xs font-bold flex items-center justify-center" style={{ background: WA_GREEN }}>
                        {c.unread > 99 ? '99+' : c.unread}
                      </span>
                    )}
                  </span>
                  <span className={`text-xs truncate ${c.awaiting ? 'font-bold' : ''}`} style={{ color: c.awaiting ? '#b42318' : '#54656f' }}>
                    {c.awaiting
                      ? [`${unread ? '' : 'נקראה, '}מחכה לתשובה ${waitText(c.waiting_since)}`, sub].filter(Boolean).join(' · ')
                      : [c.last_direction === 'outbound' && c.last_sent_by_name ? `ענה/תה ${c.last_sent_by_name}` : null, sub].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* ── Open chat ── */}
      {chatId ? (
        <ChatPane key={chatId} leadId={chatId} chat={active}
          onBack={closeChat}
          onOpenLead={() => openLead(navigate, chatId, mode)}
          onChanged={loadChats} />
      ) : (
        <div className="hidden md:flex md:flex-1 items-center justify-center text-slate-500 text-lg" style={{ background: '#efeae2' }}>
          בחרו שיחה מהרשימה
        </div>
      )}
    </div>
  );
}

function ChatPane({ leadId, chat, onBack, onOpenLead, onChanged }) {
  const [messages, setMessages] = useState(null);
  const [text, setText]         = useState('');
  // Attachments, the same three sources as the lead card's WhatsApp form (Phase 96):
  // { type: 'local', file } | { type: 'drive', fileId, name } | { type: 'lead_file', fileId, filename }
  const [files, setFiles]       = useState([]);
  const [sending, setSending]   = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [drivePicker, setDrivePicker] = useState(false);
  const [leadFiles, setLeadFiles] = useState(null); // null = not loaded yet
  const [showLeadFiles, setShowLeadFiles] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Copy the FileList right away: the input is cleared straight after, before React runs the updater.
  const addLocal = list => { const picked = Array.from(list).map(file => ({ type: 'local', file })); setFiles(a => [...a, ...picked]); };
  function openLeadFiles() {
    setShowLeadFiles(true);
    api.get(`/leads/${leadId}/files`).then(r => setLeadFiles(r.data)).catch(() => setLeadFiles([]));
  }
  const closeAttach = () => { setAttachOpen(false); setShowLeadFiles(false); };
  const scrollRef = useRef(null);
  const fileRef   = useRef(null);
  const taRef     = useRef(null);
  const lastCount = useRef(0);
  const lastInId  = useRef(null);

  const load = useCallback(() => {
    return api.get(`/leads/${leadId}/messages`)
      .then(r => setMessages(r.data.filter(m => m.channel === 'whatsapp')))
      .catch(() => setMessages(m => m || []));
  }, [leadId]);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 6_000);
    return () => clearInterval(t);
  }, [load]);

  // Opening the chat (and every new customer message while it is open) marks the lead's
  // messages as read — the same call the lead card makes — then refreshes list + nav badge.
  useEffect(() => {
    if (!messages) return;
    const lastIn = [...messages].reverse().find(m => m.direction === 'inbound');
    const id = lastIn ? lastIn.id : 0;
    if (lastInId.current === id) return;
    lastInId.current = id;
    api.post(`/leads/${leadId}/read`).then(() => {
      onChanged();
      window.dispatchEvent(new Event('crm-wa-read'));
    }).catch(() => {});
  }, [messages, leadId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stay at the newest message, like WhatsApp.
  useEffect(() => {
    if (!messages || messages.length === lastCount.current) return;
    lastCount.current = messages.length;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Composer grows with the text, up to ~5 lines.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 130) + 'px';
  }, [text]);

  // Answer the person who wrote last (a lead can have several contact people).
  const replyPhone = useMemo(() => {
    const lastIn = [...(messages || [])].reverse().find(m => m.direction === 'inbound' && m.contact_value);
    return lastIn ? lastIn.contact_value : null;
  }, [messages]);
  const manyContacts = useMemo(
    () => new Set((messages || []).map(m => m.contact_value).filter(Boolean)).size > 1,
    [messages]
  );

  async function send() {
    const body = text.trim();
    if ((!body && !files.length) || sending) return;
    setSending(true);
    try {
      if (body) await api.post('/whatsapp/send', { leadId, message: body, phone: replyPhone || undefined });
      for (let i = 0; i < files.length; i++) {
        if (i > 0 || body) await new Promise(r => setTimeout(r, 2000));
        const fd = new FormData();
        fd.append('leadId', leadId);
        fd.append('message', '');
        if (replyPhone) fd.append('phone', replyPhone);
        const att = files[i];
        if (att.type === 'local') fd.append('file', att.file);
        else if (att.type === 'drive') fd.append('driveFileId', att.fileId);
        else if (att.type === 'lead_file') fd.append('leadFileId', att.fileId);
        await api.post('/whatsapp/send-file', fd);
      }
      setText(''); setFiles([]);
    } catch {
      alert('שגיאה בשליחת הוואטסאפ');
    }
    await load();
    onChanged();
    setSending(false);
  }

  const name = chat?.name || chat?.phone || 'שיחה';
  const sub = chat ? [chat.event_type, STAGE_LABELS[chat.stage] || chat.stage].filter(Boolean).join(' · ') : '';
  const awaitingIn = chat?.awaiting && messages
    ? messages.filter(m => m.direction === 'inbound' && chat.waiting_since && new Date(m.timestamp) >= new Date(chat.waiting_since)).length
    : 0;

  return (
    <section className="fixed inset-0 z-50 flex flex-col md:relative md:inset-auto md:z-auto md:flex-1 md:min-w-0 md:min-h-0" style={{ background: '#efeae2' }}
      onDragOver={e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
      onDrop={e => { if (e.dataTransfer?.files?.length) { e.preventDefault(); addLocal(e.dataTransfer.files); } setDragging(false); }}>
      {dragging && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none" style={{ background: 'rgba(0,128,105,0.14)' }}>
          <span className="px-5 py-3 rounded-2xl bg-white text-base font-bold" style={{ color: '#005c4b', boxShadow: '0 8px 28px rgba(0,0,0,0.28)' }}>שחררו כאן כדי לצרף</span>
        </div>
      )}
      <div className="shrink-0 flex items-center gap-2 py-2 pr-1.5 pl-2.5 text-white" style={{ background: WA_GREEN }}>
        <button onClick={onBack} aria-label="חזרה לרשימת השיחות" className="shrink-0 w-11 h-11 flex items-center justify-center md:hidden">
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>
        </button>
        <span className="md:mr-2"><Avatar name={name} url={chat?.avatar_url} size={40} /></span>
        <span className="flex-1 min-w-0 flex flex-col">
          <span className="text-base font-bold truncate">{name}</span>
          {sub && <span className="text-xs truncate">{sub}</span>}
        </span>
        <button onClick={onOpenLead} className="shrink-0 min-h-11 px-3.5 rounded-full text-sm font-bold" style={{ border: '1px solid rgba(255,255,255,0.7)' }}>
          כרטיס ליד
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-3">
        <div className="max-w-3xl mx-auto flex flex-col gap-1.5">
          {messages === null && <div className="text-center py-10 text-slate-600">טוען…</div>}
          {messages !== null && messages.length === 0 && <div className="text-center py-10 text-slate-600">אין הודעות וואטסאפ</div>}
          {(messages || []).map((m, i, arr) => {
            const out = m.direction === 'outbound';
            const showDay = i === 0 || dayKey(arr[i - 1].timestamp) !== dayKey(m.timestamp);
            return (
              <div key={m.id} className="contents">
                {showDay && (
                  <span className="self-center my-1.5 px-3 py-1 rounded-lg bg-white text-xs font-semibold" style={{ color: '#3b4a54' }}>
                    {dayLabel(m.timestamp)}
                  </span>
                )}
                <div className={`max-w-[80%] min-w-0 px-2.5 pt-1.5 pb-1 rounded-[10px] text-[15px] leading-snug whitespace-pre-wrap ${out ? 'self-end' : 'self-start'}`}
                  style={{ background: out ? '#d9fdd3' : '#ffffff', color: '#111b21', boxShadow: '0 1px 1px rgba(0,0,0,0.12)' }}>
                  <WaBubbleBody body={m.body} />
                  <div className="text-[11px] mt-0.5 text-left" style={{ color: '#54656f' }}>
                    {timeOf(m.timestamp)}
                    {out && m.sent_by_name ? ` · ${m.sent_by_name}` : ''}
                    {manyContacts && m.contact_value ? <span dir="ltr"> · {m.contact_value}</span> : null}
                  </div>
                </div>
              </div>
            );
          })}
          {awaitingIn > 0 && (
            <span className="self-center mt-2 px-3 py-1 rounded-lg text-xs font-bold" style={{ background: '#fde8e6', color: '#912018' }}>
              {awaitingIn === 1 ? 'הודעה אחת מחכה' : `${awaitingIn} הודעות מחכות`} לתשובה · {waitText(chat.waiting_since)}
            </span>
          )}
        </div>
      </div>

      <div className="shrink-0 px-2.5 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="max-w-3xl mx-auto">
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {files.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 max-w-full pr-3 pl-1 rounded-full bg-white text-sm font-semibold" style={{ color: '#3b4a54' }}>
                  <span className="truncate">📎 {attName(f)}</span>
                  <button onClick={() => setFiles(a => a.filter((_, j) => j !== i))} aria-label={`הסרת ${attName(f)}`} className="w-9 h-9 text-lg leading-none">&times;</button>
                </span>
              ))}
            </div>
          )}
          {attachOpen && (
            <div className="mb-2 p-3 rounded-2xl bg-white flex flex-col gap-2" style={{ boxShadow: '0 8px 28px rgba(0,0,0,0.2)' }}>
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-bold" style={{ color: '#3b4a54' }}>{showLeadFiles ? 'קבצים שנשלחו' : 'צירוף תמונה או קובץ'}</span>
                <button onClick={closeAttach} aria-label="סגירה" className="w-9 h-9 text-xl leading-none" style={{ color: '#54656f' }}>&times;</button>
              </div>
              {!showLeadFiles ? (
                <>
                  <button onClick={() => { closeAttach(); fileRef.current.click(); }} className="flex flex-col items-start gap-0.5 min-h-[52px] px-3.5 py-2 rounded-[10px] text-right" style={{ background: '#f0f2f5', color: '#111b21' }}>
                    <span className="text-[15px] font-bold">מהטלפון / מהמחשב</span>
                    <span className="text-xs" style={{ color: '#3b4a54' }}>תמונות, סרטונים ומסמכים. במחשב אפשר גם לגרור לכאן</span>
                  </button>
                  <button onClick={() => { closeAttach(); setDrivePicker(true); }} className="flex flex-col items-start gap-0.5 min-h-[52px] px-3.5 py-2 rounded-[10px] text-right" style={{ background: '#f0f2f5', color: '#111b21' }}>
                    <span className="text-[15px] font-bold">מ-Google Drive</span>
                    <span className="text-xs" style={{ color: '#3b4a54' }}>בחירת קובץ מהדרייב של העסק</span>
                  </button>
                  <button onClick={openLeadFiles} className="flex flex-col items-start gap-0.5 min-h-[52px] px-3.5 py-2 rounded-[10px] text-right" style={{ background: '#f0f2f5', color: '#111b21' }}>
                    <span className="text-[15px] font-bold">מקבצים שנשלחו</span>
                    <span className="text-xs" style={{ color: '#3b4a54' }}>קבצים שכבר נשלחו לליד הזה או התקבלו ממנו</span>
                  </button>
                </>
              ) : (
                <div className="max-h-56 overflow-y-auto flex flex-col">
                  {leadFiles === null && <span className="py-3 text-sm text-center" style={{ color: '#54656f' }}>טוען…</span>}
                  {leadFiles !== null && leadFiles.length === 0 && <span className="py-3 text-sm text-center" style={{ color: '#54656f' }}>אין עדיין קבצים בליד הזה</span>}
                  {(leadFiles || []).map(f => (
                    <button key={f.id} onClick={() => { setFiles(a => [...a, { type: 'lead_file', fileId: f.id, filename: f.filename }]); closeAttach(); }}
                      className="min-h-11 px-2 text-right text-sm font-semibold truncate rounded-lg hover:bg-slate-50" style={{ color: '#111b21' }}>
                      📎 {f.filename}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1 min-w-0 flex items-end gap-1 pr-3.5 pl-1 rounded-3xl bg-white" style={{ boxShadow: '0 1px 1px rgba(0,0,0,0.12)' }}>
              <textarea ref={taRef} value={text} onChange={e => setText(e.target.value)} rows={1}
                aria-label="הודעה" placeholder="הודעה"
                className="flex-1 min-w-0 py-3 bg-transparent outline-none resize-none text-base" style={{ color: '#111b21' }} />
              <input ref={fileRef} type="file" multiple className="hidden"
                onChange={e => { addLocal(e.target.files); e.target.value = ''; }} />
              <button onClick={() => (attachOpen ? closeAttach() : setAttachOpen(true))} aria-label="צירוף תמונה או קובץ" aria-expanded={attachOpen} className="shrink-0 w-11 h-12 flex items-center justify-center" style={{ color: '#54656f' }}>
                <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8" /></svg>
              </button>
            </div>
            <button onClick={send} disabled={sending || (!text.trim() && !files.length)} aria-label="שליחה"
              className="shrink-0 w-12 h-12 rounded-full text-white flex items-center justify-center disabled:opacity-50" style={{ background: WA_GREEN }}>
              {sending
                ? <span className="text-xs font-bold">…</span>
                : <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style={{ transform: 'scaleX(-1)' }}><path d="M21 12L4 4l3 8-3 8z" /></svg>}
            </button>
          </div>
        </div>
      </div>
      {drivePicker && (
        <div className="relative z-[60]">
          <DriveFilePicker onSelect={picks => setFiles(a => [...a, ...picks])} onClose={() => setDrivePicker(false)} />
        </div>
      )}
    </section>
  );
}
