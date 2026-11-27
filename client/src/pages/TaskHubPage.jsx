import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api';
import { openLead } from '../utils/openLead';
import { fmtDue } from '../components/TaskItems';

// ניהול משימות (Phase 134, reworked in Phase 135). A screen beside the existing משימות tab.
//   הלוח שלי   — every open task of mine as a board: a column per context (מכירות / הפקה / תפעול /
//                אחזקה / כספים / כללי / אישי), only columns that have tasks, plus "לאישור שלי" and
//                "נתתי לאחרים".
//   היום שלי   — the short list: up to three "בטיפול עכשיו", today + late; the rest folded.
//   לוח הפקה  — a column per event, nearest first.
//   הצוות שלי — for whoever has people under him ("מנהל ישיר"), and admins.
// Lead / תפעול / תחזוקה rows act through the existing /api/my-tasks endpoints; hub tasks (personal
// and given ones) through /api/task-hub/tasks.

const CAT_ORDER = ['מכירות', 'הפקה', 'תפעול', 'אחזקה', 'כספים', 'כללי', 'אישי'];
const CAT_HEAD = {
  'מכירות': 'bg-violet-600', 'הפקה': 'bg-amber-500', 'תפעול': 'bg-sky-600', 'אחזקה': 'bg-slate-500',
  'כספים': 'bg-emerald-600', 'כללי': 'bg-slate-400', 'אישי': 'bg-slate-800',
};
const HUB_CATS = [['general', 'כללי'], ['sales', 'מכירות'], ['production', 'הפקה'], ['operations', 'תפעול'], ['maintenance', 'אחזקה'], ['finance', 'כספים']];
const PRIVATE_NOTE = 'אלה משימות אישיות שלך, אף אחד אחר לא רואה אותן.';
const VISIBLE_DAYS = 14; // on the event board, tasks due later than this are folded

const pad = n => String(n).padStart(2, '0');
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function addDays(dayStr, n) {
  const d = new Date(`${dayStr}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const daysLate = ds => Math.round((new Date(`${localDay()}T00:00:00Z`) - new Date(`${ds}T00:00:00Z`)) / 86400000);
const errText = (e, fallback = 'שגיאה') => e?.response?.data?.error || fallback;
const keyOf = t => `${t.kind}-${t.id}`;

function DuePill({ t }) {
  if (t.status === 'pending_approval') return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-teal-600 text-white whitespace-nowrap">מחכה לאישור</span>;
  if (t.kind === 'fault') return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-700 whitespace-nowrap">תקלה</span>;
  if (t.overdue) { const n = t.due_date ? daysLate(t.due_date) : 0; return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-600 text-white whitespace-nowrap">באיחור{n > 0 ? ` ${n} ${n === 1 ? 'יום' : 'ימים'}` : ''}</span>; }
  if (t.due_date === localDay()) return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 whitespace-nowrap">היום</span>;
  if (t.due_date) return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 whitespace-nowrap tabular-nums">{fmtDue(t.due_date)}</span>;
  return <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-50 text-slate-500 whitespace-nowrap">ללא תאריך</span>;
}

// One task, the same card everywhere in the hub.
//   mode 'mine' (default) — my task: בוצע / דחייה / לא רלוונטי (+ the focus pin when onFocus is given)
//   mode 'given'          — a task I gave: who holds it, and I may still close or cancel it
//   mode 'approve'        — finished by the other side, waits for my אישור / החזרה
//   mode 'view'           — read only (a manager looking at someone)
function HubCard({ t, mode = 'mine', onChanged, onFocus, showCategory }) {
  const navigate = useNavigate();
  const [box, setBox] = useState(null); // 'complete' | 'postpone' | 'cancel' | 'reject'
  const [text, setText] = useState('');
  const [date, setDate] = useState(() => addDays(localDay(), 1));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const base = t.kind === 'hub' ? `/task-hub/tasks/${t.id}` : `/my-tasks/${t.kind}/${t.id}`;
  const canCancel = ['lead', 'op', 'hub'].includes(t.kind);
  const isFault = t.kind === 'fault';
  const late = t.overdue && mode !== 'approve';

  async function run(action, body) {
    setBusy(true); setErr('');
    try { await api.post(`${base}/${action}`, body || {}); setBox(null); setText(''); onChanged?.(); }
    catch (e) { setErr(errText(e)); }
    finally { setBusy(false); }
  }
  function submit() {
    if (box === 'complete') run('complete', { result: text });
    else if (box === 'postpone') run('postpone', { due_at: `${date}T09:00:00`, reason: text });
    else if (box === 'cancel') run('cancel', { reason: text });
    else if (box === 'reject') run('reject', { reason: text });
  }
  const boxLabel = { complete: 'מה נעשה (לא חובה)', postpone: 'סיבה לדחייה (לא חובה)', cancel: 'למה לא רלוונטי', reject: 'מה חסר' }[box];
  const needText = box === 'cancel' && t.kind !== 'hub';
  const btn = 'h-9 px-2.5 rounded-lg text-xs font-bold transition';
  const toggle = k => { setErr(''); setBox(b => (b === k ? null : k)); };

  return (
    <div className={`rounded-xl border p-2.5 ${late ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-start gap-2">
        <span className="flex-1 min-w-0 text-sm font-bold text-slate-800 leading-snug break-words">
          {t.focus && <span title="בטיפול עכשיו" className="ml-1">📌</span>}{t.title}
        </span>
        <DuePill t={t} />
      </div>
      <div className="mt-1 flex items-center gap-x-2 gap-y-0.5 flex-wrap text-xs text-slate-500">
        {showCategory && <span className="font-bold text-slate-600">{t.category}</span>}
        {t.lead_id && t.who && <button onClick={() => openLead(navigate, t.lead_id)} className="text-violet-700 font-bold hover:underline">{t.who}</button>}
        {t.is_private && <span>🔒 אישי</span>}
        {(mode === 'given' || mode === 'approve' || mode === 'view') && t.assigned_name && <span>אצל <b className="text-slate-700">{t.assigned_name}</b></span>}
        {mode === 'mine' && t.created_by_name && t.created_by !== t.assigned_to && <span>מאת {t.created_by_name}</span>}
        {t.is_callback && <span className="text-teal-700 font-bold">📞 שיחה חוזרת</span>}
        {t.requires_approval && t.status === 'open' && <span>דורש אישור</span>}
        {t.postpone_count > 0 && <span className="text-amber-700">נדחתה {t.postpone_count}×</span>}
      </div>
      {t.notes && <p className="mt-1 text-xs text-slate-600 whitespace-pre-line break-words">{t.notes}</p>}
      {mode === 'approve' && t.result && <p className="mt-1 text-xs text-emerald-800 break-words">נעשה: {t.result}</p>}

      {mode !== 'view' && (
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          {mode === 'approve' ? (
            <>
              <button disabled={busy} onClick={() => run('approve')} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>✓ אישור</button>
              <button onClick={() => toggle('reject')} className={`${btn} ${box === 'reject' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>↩ החזרה</button>
            </>
          ) : isFault ? (
            <button onClick={() => navigate('/operations')} className={`${btn} bg-slate-100 text-slate-700 hover:bg-slate-200`}>פתח בתפעול</button>
          ) : (
            <>
              <button onClick={() => toggle('complete')} className={`${btn} ${box === 'complete' ? 'bg-emerald-600 text-white' : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'}`}>✓ בוצע</button>
              <button onClick={() => toggle('postpone')} className={`${btn} ${box === 'postpone' ? 'bg-violet-600 text-white' : 'bg-violet-100 text-violet-800 hover:bg-violet-200'}`}>דחייה</button>
              {canCancel && <button onClick={() => toggle('cancel')} className={`${btn} ${box === 'cancel' ? 'bg-slate-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>לא רלוונטי</button>}
            </>
          )}
          {onFocus && mode === 'mine' && (
            <button onClick={() => onFocus(t)} title={t.focus ? 'הוצא מ"בטיפול עכשיו"' : 'הוסף ל"בטיפול עכשיו"'}
              className={`${btn} mr-auto ${t.focus ? 'bg-violet-700 text-white' : 'bg-white border border-violet-200 text-violet-700 hover:bg-violet-50'}`}>
              {t.focus ? 'בטיפול ✓' : '+ לטיפול'}
            </button>
          )}
        </div>
      )}
      {err && !box && <p className="mt-1 text-xs text-red-600">{err}</p>}
      {box && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-2">
          {box === 'postpone' && (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <span>מועד חדש</span>
              <input type="date" value={date} min={localDay()} onChange={e => setDate(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white" style={{ direction: 'ltr' }} />
            </label>
          )}
          <input value={text} onChange={e => setText(e.target.value)} placeholder={boxLabel} autoFocus
            className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-400" />
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => setBox(null)} className="text-xs text-slate-500 px-3 py-1.5">ביטול</button>
            <button onClick={submit} disabled={busy || (needText && !text.trim())} className="text-xs font-bold px-3 py-1.5 rounded-lg text-white bg-violet-700 disabled:opacity-40">אישור</button>
          </div>
        </div>
      )}
    </div>
  );
}

// "+ משימה": for me, personal, or for someone else.
function AddTaskModal({ me, onClose, onSaved }) {
  const [users, setUsers] = useState([]);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [who, setWho] = useState('me');          // 'me' | 'private' | user id
  const [category, setCategory] = useState('general');
  const [due, setDue] = useState('');
  const [approval, setApproval] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { api.get('/users').then(r => setUsers(r.data.filter(u => u.id !== me))).catch(() => {}); }, [me]);
  const isPrivate = who === 'private', other = who !== 'me' && who !== 'private';

  async function save() {
    if (!title.trim()) { setErr('צריך לכתוב מה המשימה'); return; }
    setBusy(true); setErr('');
    try {
      await api.post('/task-hub/tasks', {
        title, notes, category, due_date: due || null, is_private: isPrivate,
        assigned_to: other ? Number(who) : me, requires_approval: other && approval,
      });
      onSaved();
    } catch (e) { setErr(errText(e)); setBusy(false); }
  }
  const field = 'w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-400';
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div dir="rtl" className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 space-y-3 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center">
          <h2 className="font-black text-slate-800 flex-1">משימה חדשה</h2>
          <button onClick={onClose} aria-label="סגירה" className="text-slate-400 text-2xl leading-none px-2">&times;</button>
        </div>
        <label className="block text-xs font-bold text-slate-600">מה צריך לעשות
          <input value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="למשל: לסדר את הרמקול" className={`${field} mt-1 font-normal`} />
        </label>
        <label className="block text-xs font-bold text-slate-600">למי
          <select value={who} onChange={e => setWho(e.target.value)} className={`${field} mt-1 font-normal`}>
            <option value="me">לי (משימת עבודה)</option>
            <option value="private">לי, אישי 🔒</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}
          </select>
        </label>
        {isPrivate && <p className="text-xs text-slate-600 rounded-xl bg-slate-100 px-3 py-2">🔒 {PRIVATE_NOTE}</p>}
        <div className="grid grid-cols-2 gap-2">
          {!isPrivate && (
            <label className="block text-xs font-bold text-slate-600">תחום
              <select value={category} onChange={e => setCategory(e.target.value)} className={`${field} mt-1 font-normal`}>
                {HUB_CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          )}
          <label className={`block text-xs font-bold text-slate-600 ${isPrivate ? 'col-span-2' : ''}`}>עד מתי (לא חובה)
            <input type="date" value={due} min={localDay()} onChange={e => setDue(e.target.value)} className={`${field} mt-1 font-normal`} style={{ direction: 'ltr' }} />
          </label>
        </div>
        <label className="block text-xs font-bold text-slate-600">פרטים (לא חובה)
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={`${field} mt-1 font-normal`} />
        </label>
        {other && (
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={approval} onChange={e => setApproval(e.target.checked)} className="mt-1 w-4 h-4" />
            <span><b>דורש אישור שלי</b><br /><span className="text-xs text-slate-500">כשיסמנו "בוצע" המשימה תחזור אליי לאישור ולא תיסגר לבד.</span></span>
          </label>
        )}
        {err && <p className="text-sm text-red-600 font-bold">{err}</p>}
        <button onClick={save} disabled={busy} className="w-full py-3 rounded-xl bg-violet-700 text-white font-black disabled:opacity-50">
          {other ? 'תן משימה' : 'הוסף משימה'}
        </button>
      </div>
    </div>
  );
}

function Column({ title, count, late, head = 'bg-slate-500', note, children }) {
  return (
    <div className="shrink-0 w-[85vw] max-w-[20rem] sm:w-72 snap-start self-start rounded-2xl bg-slate-100 border border-slate-200 overflow-hidden">
      <div className={`${head} text-white px-3 py-2 flex items-center gap-2`}>
        <h3 className="font-black text-sm flex-1">{title}</h3>
        {late > 0 && <span className="text-[11px] font-black bg-white text-red-700 rounded-full px-2 py-0.5">{late} באיחור</span>}
        <span className="text-xs font-black bg-white/25 rounded-full px-2 py-0.5">{count}</span>
      </div>
      {note && <p className="px-3 pt-2 text-[11px] text-slate-600">{note}</p>}
      <div className="p-2 space-y-2">{children}</div>
    </div>
  );
}
const BoardRow = ({ children }) => (
  <div className="flex gap-3 overflow-x-auto pb-3 snap-x snap-mandatory -mx-3 px-3 items-start">{children}</div>
);

// הלוח שלי — everything open, a column per context; only columns that have something.
function MyBoard({ data, reload, toggleFocus }) {
  const mine = [...data.focus, ...data.today, ...data.soon, ...data.later];
  const cols = CAT_ORDER.map(c => ({ c, list: mine.filter(t => t.category === c) })).filter(x => x.list.length);
  const given = [...data.waiting].sort((a, b) => (a.assigned_name || '').localeCompare(b.assigned_name || '', 'he'));
  if (!cols.length && !given.length && !data.approve.length) {
    return <p className="text-center text-sm text-slate-500 py-10">אין משימות פתוחות. אפשר להוסיף עם "+ משימה".</p>;
  }
  return (
    <BoardRow>
      {data.approve.length > 0 && (
        <Column title="לאישור שלי" count={data.approve.length} head="bg-teal-600" note="סומנו כבוצעו ומחכות שתאשר.">
          {data.approve.map(t => <HubCard key={keyOf(t)} t={t} mode="approve" onChanged={reload} />)}
        </Column>
      )}
      {cols.map(({ c, list }) => (
        <Column key={c} title={c} count={list.length} late={list.filter(t => t.overdue).length} head={CAT_HEAD[c]} note={c === 'אישי' ? `🔒 ${PRIVATE_NOTE}` : null}>
          {list.map(t => <HubCard key={keyOf(t)} t={t} onChanged={reload} onFocus={toggleFocus} />)}
        </Column>
      ))}
      {given.length > 0 && (
        <Column title="נתתי לאחרים" count={given.length} late={given.filter(t => t.overdue).length} head="bg-indigo-700" note="משימות שנתת ועוד לא נסגרו, לפי מי שמחזיק אותן.">
          {given.map(t => <HubCard key={keyOf(t)} t={t} mode="given" showCategory onChanged={reload} />)}
        </Column>
      )}
    </BoardRow>
  );
}

function Fold({ title, count, hint, children }) {
  const [open, setOpen] = useState(false);
  if (!count) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-3 py-3 text-right">
        <span className="font-bold text-sm text-slate-800">{title}</span>
        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">{count}</span>
        <span className="flex-1 text-xs text-slate-500 truncate">{hint}</span>
        <span className="text-slate-400 text-xs" style={{ transform: open ? 'rotate(-90deg)' : 'none', transition: 'transform .15s' }}>‹</span>
      </button>
      {open && <div className="px-2 pb-2 space-y-2">{children}</div>}
    </div>
  );
}

function TodayView({ data, reload, toggleFocus }) {
  const limit = data.focus_limit || 3;
  const nothing = !data.focus.length && !data.today.length && !data.soon.length && !data.later.length && !data.waiting.length && !data.approve.length;
  if (nothing) return <p className="text-center text-sm text-slate-500 py-10">אין משימות פתוחות. יום נקי.</p>;
  return (
    <div className="space-y-3 max-w-2xl mx-auto">
      {data.approve.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-black text-slate-800">לאישור שלי <span className="text-xs font-medium text-slate-500">{data.approve.length}</span></h2>
          {data.approve.map(t => <HubCard key={keyOf(t)} t={t} mode="approve" showCategory onChanged={reload} />)}
        </section>
      )}
      <section className="space-y-2">
        <div className="flex items-baseline gap-2">
          <h2 className="font-black text-slate-800">בטיפול עכשיו</h2>
          <span className="text-xs text-slate-500">{data.focus.length} מתוך {limit}</span>
        </div>
        {data.focus.length === 0 && <p className="text-xs text-slate-500 rounded-xl border border-dashed border-slate-300 px-3 py-3">לחץ "+ לטיפול" על עד {limit} משימות כדי להתמקד בהן.</p>}
        {data.focus.map(t => <HubCard key={keyOf(t)} t={t} showCategory onChanged={reload} onFocus={toggleFocus} />)}
      </section>
      {data.today.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-black text-slate-800">היום ובאיחור <span className="text-xs font-medium text-slate-500">{data.today.length}</span></h2>
          {data.today.map(t => <HubCard key={keyOf(t)} t={t} showCategory onChanged={reload} onFocus={toggleFocus} />)}
        </section>
      )}
      <div className="space-y-2 pt-1">
        <Fold title="בקרוב" count={data.soon.length} hint="בשבוע הקרוב">
          {data.soon.map(t => <HubCard key={keyOf(t)} t={t} showCategory onChanged={reload} onFocus={toggleFocus} />)}
        </Fold>
        <Fold title="אחר כך" count={data.later.length} hint="רחוק יותר או בלי תאריך">
          {data.later.map(t => <HubCard key={keyOf(t)} t={t} showCategory onChanged={reload} onFocus={toggleFocus} />)}
        </Fold>
        <Fold title="נתתי לאחרים" count={data.waiting.length} hint="עוד לא נסגרו">
          {data.waiting.map(t => <HubCard key={keyOf(t)} t={t} mode="given" showCategory onChanged={reload} />)}
        </Fold>
      </div>
    </div>
  );
}

function daysLabel(c) {
  if (c.closing) return 'לסגירה';
  if (c.days_until === 0) return 'היום';
  if (c.days_until === 1) return 'מחר';
  return `בעוד ${c.days_until} ימים`;
}

function EventColumn({ c, today, onChanged }) {
  const navigate = useNavigate();
  const [showAll, setShowAll] = useState(false);
  const cut = addDays(today, VISIBLE_DAYS);
  const near = c.tasks.filter(t => !t.due_date || t.due_date <= cut);
  const hidden = c.tasks.length - near.length;
  const list = showAll ? c.tasks : near;
  const pct = c.total ? Math.round((c.done * 100) / c.total) : 0;
  const urgent = !c.closing && c.days_until <= 7;
  return (
    <div className="shrink-0 w-[85vw] max-w-[20rem] sm:w-72 snap-start self-start rounded-2xl bg-slate-100 border border-slate-200 overflow-hidden">
      <div className={`${c.closing ? 'bg-slate-700' : urgent ? 'bg-red-600' : 'bg-amber-500'} text-white px-3 py-2`}>
        <div className="flex items-start gap-2">
          <button onClick={() => openLead(navigate, c.lead_id)} className="flex-1 min-w-0 text-right font-black text-sm truncate hover:underline">{c.name}</button>
          <span className="shrink-0 text-xs font-black bg-white/25 rounded-full px-2 py-0.5 whitespace-nowrap">{daysLabel(c)}</span>
        </div>
        <p className="text-[11px] opacity-90 truncate">{[c.event_type, fmtDue(c.event_date), c.production_manager_name].filter(Boolean).join(' · ')}</p>
      </div>
      <div className="p-2 space-y-2">
        <div className="flex items-center gap-2 px-1">
          <div className="flex-1 h-2 rounded-full bg-slate-300 overflow-hidden"><div className="h-2 bg-emerald-600" style={{ width: `${pct}%` }} /></div>
          <span className="text-xs font-bold text-slate-600 tabular-nums">{c.done} מתוך {c.total}</span>
        </div>
        {c.missing_labels.length > 0 && <p className="px-1 text-xs font-bold text-red-700">חסר: {c.missing_labels.join(' · ')}</p>}
        {list.length === 0 && <p className="px-1 text-xs text-slate-500">אין משימות פתוחות{hidden > 0 ? ' בשבועיים הקרובים' : ''}.</p>}
        {list.map(t => <HubCard key={keyOf(t)} t={t} mode="given" onChanged={onChanged} />)}
        {hidden > 0 && (
          <button onClick={() => setShowAll(s => !s)} className="w-full text-xs font-bold text-violet-700 py-2 rounded-lg bg-white hover:bg-violet-50">
            {showAll ? 'הצג רק את הקרובות' : `עוד ${hidden} ${hidden === 1 ? 'משימה' : 'משימות'} בהמשך`}
          </button>
        )}
      </div>
    </div>
  );
}

function ProductionBoard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => {
    api.get('/task-hub/board/production').then(r => setData(r.data)).catch(e => setErr(errText(e, 'שגיאה בטעינת הלוח')));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <p className="text-center text-sm text-slate-500 py-10">{err || 'טוען…'}</p>;
  const cols = [...data.upcoming, ...data.closing];
  if (!cols.length && !data.far.length) return <p className="text-center text-sm text-slate-500 py-10">אין אירועים פעילים להצגה.</p>;
  return (
    <div>
      <p className="text-xs text-slate-500 mb-2">עמודה לכל אירוע, הקרוב ביותר ראשון. אירוע שנגמר נשאר כ"לסגירה" עד שהכול סגור.</p>
      <BoardRow>
        {cols.map(c => <EventColumn key={c.lead_id} c={c} today={data.today} onChanged={load} />)}
        {data.far.length > 0 && (
          <Column title="רחוק יותר" count={data.far.length} head="bg-slate-400" note={`אירועים בעוד יותר מ-${data.board_days} יום.`}>
            {data.far.map(c => (
              <button key={c.lead_id} onClick={() => openLead(navigate, c.lead_id)} className="w-full text-right rounded-xl border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50">
                <span className="block font-bold text-sm text-slate-800 truncate">{c.name}</span>
                <span className="block text-xs text-slate-500">{[c.event_type, fmtDue(c.event_date), `${c.tasks_open} משימות פתוחות`].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
          </Column>
        )}
      </BoardRow>
    </div>
  );
}

function Stat({ n, label, red }) {
  return (
    <span className="flex flex-col items-center">
      <span className={`text-lg font-black tabular-nums ${red && n > 0 ? 'text-red-700' : 'text-slate-800'}`}>{n}</span>
      <span className="text-[11px] text-slate-500">{label}</span>
    </span>
  );
}

function TeamView() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState(null);
  const [person, setPerson] = useState(null);
  const [editing, setEditing] = useState(false);
  const load = useCallback(() => {
    api.get('/task-hub/team').then(r => setData(r.data)).catch(e => setErr(errText(e, 'שגיאה בטעינת הצוות')));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setPerson(null);
    if (openId) api.get(`/task-hub/team/${openId}`).then(r => setPerson(r.data)).catch(e => setErr(errText(e)));
  }, [openId]);
  async function setManager(userId, managerId) {
    setErr('');
    try { await api.put('/task-hub/team/manager', { user_id: userId, manager_id: managerId || null }); load(); }
    catch (e) { setErr(errText(e)); }
  }
  if (!data) return <p className="text-center text-sm text-slate-500 py-10">{err || 'טוען…'}</p>;
  return (
    <div className="space-y-3 max-w-2xl mx-auto">
      {err && <p className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-bold px-3 py-2">{err}</p>}
      {data.exceptions.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-black text-slate-800">דורש את תשומת הלב שלך <span className="text-xs font-medium text-slate-500">{data.exceptions.length}</span></h2>
          {data.exceptions.map((x, i) => (
            <button key={i} onClick={() => setOpenId(x.user_id)} className="w-full text-right rounded-xl border border-red-200 bg-red-50 px-3 py-2">
              <span className="block text-sm font-bold text-red-900">{x.text}</span>
              <span className="block text-xs text-slate-600">{x.sub}</span>
            </button>
          ))}
        </section>
      )}
      <section className="space-y-2">
        <div className="flex items-baseline gap-2">
          <h2 className="font-black text-slate-800">{data.can_edit ? 'כל העובדים' : 'האנשים שמתחתיי'}</h2>
          <span className="text-xs text-slate-500">{data.people.length}</span>
          {data.can_edit && <button onClick={() => setEditing(e => !e)} className="mr-auto text-xs font-bold text-violet-700 px-2 py-1 rounded-lg bg-violet-50">{editing ? 'סגור' : 'מי מנהל את מי'}</button>}
        </div>
        {editing && data.users && (
          <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
            <p className="text-xs text-slate-500">לכל עובד בוחרים מנהל ישיר. מנהל רואה במסך הזה את מי שמתחתיו (וגם את מי שמתחתם).</p>
            {data.users.map(u => (
              <label key={u.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 font-bold text-slate-700 truncate">{u.display_name}</span>
                <select value={u.manager_id || ''} onChange={e => setManager(u.id, Number(e.target.value) || null)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white max-w-[55%]">
                  <option value="">בלי מנהל ישיר</option>
                  {data.users.filter(m => m.id !== u.id).map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                </select>
              </label>
            ))}
          </div>
        )}
        {data.people.length === 0 && <p className="text-sm text-slate-500 py-4 text-center">עוד לא הוגדרו אנשים מתחתיך.</p>}
        {data.people.map(p => (
          <div key={p.id} className="rounded-xl border border-slate-200 bg-white">
            <button onClick={() => setOpenId(id => (id === p.id ? null : p.id))} className="w-full p-3 text-right">
              <span className="flex items-center gap-2 mb-2">
                <span className="font-black text-slate-800 flex-1">{p.name}</span>
                {p.open >= 12 && <span className="text-[11px] font-bold bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">עומס</span>}
                <span className="text-slate-400 text-xs" style={{ transform: openId === p.id ? 'rotate(-90deg)' : 'none', transition: 'transform .15s' }}>‹</span>
              </span>
              <span className="grid grid-cols-4 gap-2">
                <Stat n={p.open} label="פתוחות" />
                <Stat n={p.overdue} label="באיחור" red />
                <Stat n={p.done_week} label="נסגרו השבוע" />
                <Stat n={p.postponed} label="נדחו 3+" red />
              </span>
            </button>
            {openId === p.id && (
              <div className="px-2 pb-2 space-y-2 border-t border-slate-100 pt-2">
                {!person && <p className="text-xs text-slate-500 px-1">טוען…</p>}
                {person && [...person.focus, ...person.today, ...person.soon, ...person.later].length === 0 && <p className="text-xs text-slate-500 px-1">אין משימות פתוחות.</p>}
                {person && [...person.focus, ...person.today, ...person.soon, ...person.later].map(t => <HubCard key={keyOf(t)} t={t} mode="view" showCategory />)}
              </div>
            )}
          </div>
        ))}
        <p className="text-xs text-slate-500 rounded-xl bg-slate-100 px-3 py-2">🔒 משימות אישיות של עובדים לא מוצגות כאן ולא נספרות.</p>
      </section>
    </div>
  );
}

export default function TaskHubPage() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const reload = useCallback(() => {
    api.get('/task-hub/today').then(r => { setData(r.data); }).catch(e => setErr(errText(e, 'שגיאה בטעינת המשימות')));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  async function toggleFocus(t) {
    setErr('');
    try {
      if (t.focus) await api.delete(`/task-hub/focus/${t.kind}/${t.id}`);
      else await api.post('/task-hub/focus', { kind: t.kind, id: t.id });
      reload();
    } catch (e) { setErr(errText(e)); }
  }
  const TABS = [
    { key: 'board', label: 'הלוח שלי' },
    { key: 'today', label: 'היום שלי' },
    { key: 'production', label: 'לוח הפקה' },
    ...(data?.has_team ? [{ key: 'team', label: 'הצוות שלי' }] : []),
  ];
  const view = TABS.some(t => t.key === params.get('view')) ? params.get('view') : 'board';
  const me = data?.me;
  return (
    <div dir="rtl" className="px-3 py-3">
      <div className="flex items-center gap-2 mb-2">
        <h1 className="font-black text-lg text-slate-800 flex-1">ניהול משימות</h1>
        <button onClick={() => setAdding(true)} disabled={!me} className="h-10 px-4 rounded-xl bg-violet-700 text-white text-sm font-black disabled:opacity-50">+ משימה</button>
      </div>
      <div className="flex gap-1.5 mb-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setParams(t.key === 'board' ? {} : { view: t.key }, { replace: true })}
            className={`shrink-0 flex-1 min-w-[5.5rem] py-2.5 px-2 rounded-xl text-sm font-bold whitespace-nowrap transition ${view === t.key ? 'bg-violet-700 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {err && <p className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-bold px-3 py-2 mb-2">{err}</p>}
      {view === 'production' ? <ProductionBoard />
        : view === 'team' ? <TeamView />
        : !data ? <p className="text-center text-sm text-slate-500 py-10">{err ? '' : 'טוען…'}</p>
        : view === 'today' ? <TodayView data={data} reload={reload} toggleFocus={toggleFocus} />
        : <MyBoard data={data} reload={reload} toggleFocus={toggleFocus} />}
      {adding && me && <AddTaskModal me={me} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </div>
  );
}
