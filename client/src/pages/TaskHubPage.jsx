import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api';
import { openLead } from '../utils/openLead';
import { TaskRow, fmtDue } from '../components/TaskItems';

// Phase 134 — ניהול משימות. A new screen beside the existing משימות tab (which is unchanged).
//   היום שלי  — what needs me now: up to three "בטיפול עכשיו", then today's and late items; the rest
//               is folded (בקרוב / אחר כך / מחכה לאחרים) so the list never becomes a warehouse.
//   לוח הפקה — a column per event, nearest first; past events stay as "לסגירה" until nothing is open.
// Rows and their actions are the existing TaskRow (בוצע / דחייה / לא רלוונטי).

const CAT_STYLE = {
  'מכירות': 'bg-violet-100 text-violet-800',
  'הפקה':   'bg-amber-100 text-amber-800',
  'תפעול':  'bg-sky-100 text-sky-800',
  'אחזקה':  'bg-slate-200 text-slate-700',
  'כללי':   'bg-slate-100 text-slate-600',
};
const VISIBLE_DAYS = 14; // on the board, tasks due later than this are folded under "עוד N בהמשך"

function addDays(dayStr, n) {
  const d = new Date(`${dayStr}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// A fault has no בוצע/דחייה of its own outside תפעול — show it and send the user there.
function FaultRow({ t }) {
  const navigate = useNavigate();
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-slate-800 text-sm">{t.title}</span>
          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-700 whitespace-nowrap">תקלה פתוחה</span>
        </div>
        <div className="text-xs text-slate-500 mt-0.5">{t.created_by_name ? `דווח על ידי ${t.created_by_name}` : 'תקלה'}{t.assigned_name ? ` · אצל ${t.assigned_name}` : ''}</div>
      </div>
      <button onClick={() => navigate('/operations')} className="shrink-0 text-xs font-bold px-3 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">לתפעול</button>
    </div>
  );
}

// One line of the hub: category + (optionally) the focus toggle above the regular task row.
function HubRow({ t, onChanged, onFocus, showAssignee, showEvent = true }) {
  return (
    <div>
      <div className="flex items-center gap-2 px-1 mb-0.5">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${CAT_STYLE[t.category] || CAT_STYLE['כללי']}`}>{t.category}</span>
        {showEvent && t.event_date && t.category === 'הפקה' && <span className="text-[11px] text-slate-500">אירוע ב-{fmtDue(t.event_date)}</span>}
        {onFocus && (
          <button onClick={() => onFocus(t)} className={`mr-auto text-[11px] font-bold px-2 py-0.5 rounded-full ${t.focus ? 'bg-violet-600 text-white' : 'bg-white border border-violet-200 text-violet-700 hover:bg-violet-50'}`}>
            {t.focus ? '✓ בטיפול · הוצא' : '+ לטיפול עכשיו'}
          </button>
        )}
      </div>
      {t.kind === 'fault' ? <FaultRow t={t} /> : <TaskRow t={t} showAssignee={showAssignee} onChanged={onChanged} />}
    </div>
  );
}

function Fold({ title, count, hint, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
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

function TodayView() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => {
    api.get('/task-hub/today').then(r => setData(r.data)).catch(e => setErr(e.response?.data?.error || 'שגיאה בטעינת המשימות'));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggleFocus(t) {
    setErr('');
    try {
      if (t.focus) await api.delete(`/task-hub/focus/${t.kind}/${t.id}`);
      else await api.post('/task-hub/focus', { kind: t.kind, id: t.id });
      load();
    } catch (e) { setErr(e.response?.data?.error || 'שגיאה'); }
  }

  if (!data) return <p className="text-center text-sm text-slate-500 py-10">{err || 'טוען…'}</p>;
  const limit = data.focus_limit || 3;
  const nothing = !data.focus.length && !data.today.length && !data.soon.length && !data.later.length && !data.waiting.length;
  return (
    <div className="space-y-3">
      {err && <p className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-bold px-3 py-2">{err}</p>}
      {nothing && <p className="text-center text-sm text-slate-500 py-10">אין משימות פתוחות. יום נקי.</p>}

      {(data.focus.length > 0 || data.today.length > 0) && (
        <section className="space-y-2">
          <div className="flex items-baseline gap-2">
            <h2 className="font-black text-slate-800">בטיפול עכשיו</h2>
            <span className="text-xs text-slate-500">{data.focus.length} מתוך {limit}</span>
            <span className="mr-auto text-xs text-slate-500">עד {limit} בו-זמנית</span>
          </div>
          {data.focus.length === 0 && <p className="text-xs text-slate-500 rounded-xl border border-dashed border-slate-300 px-3 py-3">בחר עד {limit} משימות מהרשימה למטה ("+ לטיפול עכשיו") כדי להתמקד בהן.</p>}
          {data.focus.map(t => <HubRow key={`${t.kind}-${t.id}`} t={t} onChanged={load} onFocus={toggleFocus} />)}
        </section>
      )}

      {data.today.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-baseline gap-2">
            <h2 className="font-black text-slate-800">היום</h2>
            <span className="text-xs text-slate-500">{data.today.length} {data.today.length === 1 ? 'משימה' : 'משימות'}, כולל מה שבאיחור</span>
          </div>
          {data.today.map(t => <HubRow key={`${t.kind}-${t.id}`} t={t} onChanged={load} onFocus={toggleFocus} />)}
        </section>
      )}

      <div className="space-y-2 pt-1">
        <Fold title="בקרוב" count={data.soon.length} hint="בשבוע הקרוב">
          {data.soon.map(t => <HubRow key={`${t.kind}-${t.id}`} t={t} onChanged={load} onFocus={toggleFocus} />)}
        </Fold>
        <Fold title="אחר כך" count={data.later.length} hint="רחוק יותר או בלי תאריך">
          {data.later.map(t => <HubRow key={`${t.kind}-${t.id}`} t={t} onChanged={load} onFocus={toggleFocus} />)}
        </Fold>
        <Fold title="מחכה לאחרים" count={data.waiting.length} hint="משימות שנתתי ועוד לא נסגרו">
          {data.waiting.map(t => <HubRow key={`${t.kind}-${t.id}`} t={t} onChanged={load} showAssignee />)}
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
    <div className="shrink-0 w-[85vw] max-w-[20rem] sm:w-80 snap-start rounded-2xl border border-slate-200 bg-white p-3 space-y-2 self-start">
      <div className="flex items-start gap-2">
        <button onClick={() => openLead(navigate, c.lead_id)} className="flex-1 min-w-0 text-right">
          <span className="block font-black text-slate-800 text-sm truncate hover:underline">{c.name}</span>
          <span className="block text-xs text-slate-500">{[c.event_type, fmtDue(c.event_date), c.production_manager_name].filter(Boolean).join(' · ')}</span>
        </button>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-black whitespace-nowrap ${c.closing ? 'bg-slate-700 text-white' : urgent ? 'bg-red-600 text-white' : 'bg-violet-50 text-violet-700'}`}>{daysLabel(c)}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 rounded-full bg-slate-200 overflow-hidden"><div className="h-2 bg-emerald-600" style={{ width: `${pct}%` }} /></div>
        <span className="text-xs font-bold text-slate-600 tabular-nums">{c.done} מתוך {c.total}</span>
      </div>
      {c.missing_labels.length > 0 && <p className="text-xs font-bold text-red-700">חסר: {c.missing_labels.join(' · ')}</p>}
      {list.length === 0 && <p className="text-xs text-slate-500">אין משימות פתוחות לאירוע הזה{hidden > 0 ? ' בשבועיים הקרובים' : ''}.</p>}
      {list.map(t => <TaskRow key={`${t.kind}-${t.id}`} t={t} showAssignee onChanged={onChanged} />)}
      {hidden > 0 && (
        <button onClick={() => setShowAll(s => !s)} className="w-full text-xs font-bold text-violet-700 py-2 rounded-lg bg-violet-50 hover:bg-violet-100">
          {showAll ? 'הצג רק את הקרובות' : `עוד ${hidden} ${hidden === 1 ? 'משימה' : 'משימות'} בהמשך`}
        </button>
      )}
    </div>
  );
}

function ProductionBoard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => {
    api.get('/task-hub/board/production').then(r => setData(r.data)).catch(e => setErr(e.response?.data?.error || 'שגיאה בטעינת הלוח'));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <p className="text-center text-sm text-slate-500 py-10">{err || 'טוען…'}</p>;
  const cols = [...data.upcoming, ...data.closing];
  if (!cols.length && !data.far.length) return <p className="text-center text-sm text-slate-500 py-10">אין אירועים פעילים להצגה.</p>;
  return (
    <div>
      <p className="text-xs text-slate-500 mb-2">האירוע הקרוב ביותר ראשון. אירוע שנגמר נשאר כ"לסגירה" עד שהכול סגור.</p>
      <div className="flex gap-3 overflow-x-auto pb-3 snap-x snap-mandatory -mx-3 px-3 items-start">
        {cols.map(c => <EventColumn key={c.lead_id} c={c} today={data.today} onChanged={load} />)}
        {data.far.length > 0 && (
          <div className="shrink-0 w-[85vw] max-w-[20rem] sm:w-80 snap-start rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-3 space-y-2 self-start">
            <div className="flex items-baseline gap-2">
              <h3 className="font-black text-slate-800 text-sm">רחוק יותר</h3>
              <span className="text-xs text-slate-500">מעל {data.board_days} יום</span>
            </div>
            {data.far.map(c => (
              <button key={c.lead_id} onClick={() => openLead(navigate, c.lead_id)} className="w-full text-right rounded-xl border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50">
                <span className="block font-bold text-sm text-slate-800 truncate">{c.name}</span>
                <span className="block text-xs text-slate-500">{[c.event_type, fmtDue(c.event_date), `${c.tasks_open} משימות פתוחות`].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TaskHubPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'production' ? 'production' : 'today';
  const TABS = [{ key: 'today', label: 'היום שלי' }, { key: 'production', label: 'לוח הפקה' }];
  return (
    <div dir="rtl" className="max-w-5xl mx-auto px-3 py-3">
      <h1 className="font-black text-lg text-slate-800 mb-2">ניהול משימות</h1>
      <div className="grid grid-cols-2 gap-1.5 mb-3">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setParams(t.key === 'today' ? {} : { view: t.key }, { replace: true })}
            className={`py-2.5 rounded-xl text-sm font-bold transition ${view === t.key ? 'bg-violet-700 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {view === 'today' ? <TodayView /> : <ProductionBoard />}
    </div>
  );
}
