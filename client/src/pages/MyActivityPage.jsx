import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { METRIC_COLS, dayStr, shiftDays, metricTotal, LeadActivityTable } from './ManagementPage';
import { TaskRow, GROUP_LABELS, GROUP_ORDER } from '../components/TaskItems';

// The summary tiles, in the order Oran asked for (no hours, no "leads created")
const SUMMARY_ORDER = ['calls_made','call_minutes','calls_documented','meetings_booked','meetings_done','meetings_documented','notes','wa_sent','tasks_created','tasks_completed','files_uploaded'];
const SUMMARY_COLS = SUMMARY_ORDER.map(k => METRIC_COLS.find(c => c.key === k)).filter(Boolean);

// Phase 52 — "הפעילות שלי": the signed-in user's own activity, same range picker and the same
// customer lines as ניהול, without the per-employee table. Any role.
export default function MyActivityPage() {
  const navigate = useNavigate();
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const isManager = (me.roles?.length ? me.roles : [me.role]).some(r => ['admin', 'manager', 'sales_manager'].includes(r));
  const todayStr = dayStr(new Date());
  const [from, setFrom] = useState(todayStr);
  const [to, setTo]     = useState(todayStr);
  const [row, setRow]   = useState(null);     // { totals, days } of the user
  const [leadDays, setLeadDays] = useState([]); // [{ date, leads }]
  const [loading, setLoading] = useState(false);
  // Phase 55: tasks first, and managers may look at another user
  const [userId, setUserId] = useState(me.id);
  const [users, setUsers] = useState([]);
  const [tasks, setTasks] = useState(null);           // { mine, delegated }
  const [taskTab, setTaskTab] = useState('mine');     // 'mine' | 'delegated'
  const [group, setGroup] = useState('sales');        // sales | production | operations | maintenance
  const [showDone, setShowDone] = useState(false);
  const userQ = userId && userId !== me.id ? `&user=${userId}` : '';

  useEffect(() => { if (isManager) api.get('/users').then(r => setUsers(r.data)).catch(() => {}); }, [isManager]);

  function loadTasks() {
    api.get(`/my-tasks?from=${from}&to=${to}${userQ}`).then(r => setTasks(r.data)).catch(() => setTasks({ mine: {}, delegated: {} }));
  }
  useEffect(() => {
    setLoading(true);
    loadTasks();
    Promise.all([
      api.get(`/analytics/my-activity?from=${from}&to=${to}${userQ}`),
      api.get(`/analytics/my-activity/leads?from=${from}&to=${to}${userQ}`),
    ])
      .then(([a, b]) => { setRow(a.data); setLeadDays(Array.isArray(b.data) ? b.data : []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [from, to, userQ]);

  const counts = g => {
    const list = tasks?.[taskTab]?.[g] || [];
    const open = list.filter(t => !t.done); const late = open.filter(t => t.overdue);
    return { open: open.length, late: late.length };
  };
  const visible = (tasks?.[taskTab]?.[group] || []).filter(t => showDone || !t.done);

  const presets = [
    { label: 'היום',     from: todayStr,      to: todayStr },
    { label: 'אתמול',    from: shiftDays(-1), to: shiftDays(-1) },
    { label: '7 ימים',  from: shiftDays(-6),  to: todayStr },
    { label: '30 ימים', from: shiftDays(-29), to: todayStr },
  ];

  function shiftRange(dir) {
    const f = new Date(from + 'T12:00:00'), t = new Date(to + 'T12:00:00');
    const span = Math.round((t - f) / 86400000) + 1;
    const step = span * dir;
    f.setDate(f.getDate() + step);
    t.setDate(t.getDate() + step);
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let nf = fmt(f), nt = fmt(t);
    if (nt > todayStr) {
      const t2 = new Date(todayStr + 'T12:00:00'), f2 = new Date(t2);
      f2.setDate(f2.getDate() - (span - 1));
      nf = fmt(f2); nt = todayStr;
    }
    setFrom(nf); setTo(nt);
  }
  const atToday = to >= todayStr;

  // Days to show: union of metric days and lead-activity days, newest first
  const dayList = (() => {
    const map = new Map();
    (row?.days || []).forEach(d => map.set(d.date, { date: d.date, metrics: d, leads: [] }));
    leadDays.forEach(ld => {
      if (!map.has(ld.date)) map.set(ld.date, { date: ld.date, metrics: null, leads: [] });
      map.get(ld.date).leads = ld.leads || [];
    });
    return Array.from(map.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
  })();
  const totals = row?.totals || {};

  return (
    <div className="min-h-screen bg-slate-50 pb-32" dir="rtl">
      <div className="px-4 pt-4 pb-3 flex items-center gap-2 flex-wrap sticky top-11 bg-slate-50 z-10 border-b border-slate-200">
        <span className="font-black text-slate-700 text-sm">👤 {userId === me.id ? 'הפעילות שלי' : `הפעילות של ${users.find(u => u.id === userId)?.display_name || ''}`}</span>
        {isManager && users.length > 0 && (
          <select value={userId} onChange={e => setUserId(Number(e.target.value))}
            className="border border-slate-300 rounded-xl px-2 py-1.5 text-xs text-slate-700 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-400">
            <option value={me.id}>אני</option>
            {users.filter(u => u.id !== me.id).map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
          </select>
        )}
        <div className="flex items-center gap-1">
          <button onClick={() => shiftRange(-1)} title="טווח קודם" aria-label="טווח קודם"
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-slate-300 text-slate-600 hover:bg-slate-100 font-bold">▶</button>
          <button onClick={() => shiftRange(1)} disabled={atToday} title="טווח הבא" aria-label="טווח הבא"
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-slate-300 text-slate-600 hover:bg-slate-100 font-bold disabled:opacity-40 disabled:hover:bg-white">◀</button>
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <span>מ-</span>
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
            className="border border-slate-300 rounded-xl px-2 py-1.5 text-sm text-slate-700 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-400" style={{ direction: 'ltr' }} />
          <span>עד</span>
          <input type="date" value={to} min={from} max={todayStr} onChange={e => setTo(e.target.value)}
            className="border border-slate-300 rounded-xl px-2 py-1.5 text-sm text-slate-700 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-400" style={{ direction: 'ltr' }} />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {presets.map(p => {
            const active = from === p.from && to === p.to;
            return (
              <button key={p.label} onClick={() => { setFrom(p.from); setTo(p.to); }}
                className={`text-xs font-bold px-2.5 py-1.5 rounded-lg transition ${active ? 'bg-violet-600 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-100'}`}>
                {p.label}
              </button>
            );
          })}
        </div>
        {loading && <span className="text-xs text-slate-400">טוען...</span>}
      </div>

      {/* Phase 55 — tasks first: mine / ones I gave, each split מכירות · הפקה · תפעול · תחזוקה */}
      <div className="px-4 pt-3">
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="flex items-center gap-2 flex-wrap">
            {[['mine', userId === me.id ? 'המשימות שלי' : 'המשימות'], ['delegated', userId === me.id ? 'משימות שנתתי' : 'משימות שנתן/ה']].map(([k, label]) => {
              const all = GROUP_ORDER.flatMap(g => tasks?.[k]?.[g] || []).filter(t => !t.done);
              const late = all.filter(t => t.overdue).length;
              return (
                <button key={k} onClick={() => setTaskTab(k)}
                  className={`text-sm font-black px-3 py-1.5 rounded-lg transition ${taskTab === k ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {label} <span className={`tabular-nums ${taskTab === k ? 'text-violet-200' : 'text-slate-400'}`}>{all.length}</span>
                  {late > 0 && <span className="mr-1 bg-red-600 text-white text-[10px] font-black rounded-full px-1.5 py-0.5 tabular-nums">{late}</span>}
                </button>
              );
            })}
            <label className="mr-auto flex items-center gap-1 text-xs text-slate-500 cursor-pointer">
              <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />
              הצג גם שהושלמו בטווח
            </label>
          </div>
          <div className="flex items-center gap-1 flex-wrap mt-2 border-b border-slate-100 pb-2">
            {GROUP_ORDER.map(g => {
              const c = counts(g);
              return (
                <button key={g} onClick={() => setGroup(g)}
                  className={`text-xs font-bold px-2.5 py-1 rounded-full transition ${group === g ? 'bg-violet-100 text-violet-800' : 'text-slate-500 hover:bg-slate-100'}`}>
                  {GROUP_LABELS[g]} <span className="tabular-nums">{c.open}</span>
                  {c.late > 0 && <span className="mr-1 text-red-600 tabular-nums">({c.late} באיחור)</span>}
                </button>
              );
            })}
          </div>
          <div className="space-y-1.5 mt-2">
            {tasks === null && <p className="text-xs text-slate-400 py-2">טוען משימות...</p>}
            {tasks && visible.length === 0 && <p className="text-xs text-slate-400 py-2">אין משימות {GROUP_LABELS[group]} {showDone ? 'בטווח' : 'פתוחות'} ✅</p>}
            {visible.map(t => <TaskRow key={`${t.kind}-${t.id}`} t={t} showAssignee={taskTab === 'delegated'} onChanged={loadTasks} />)}
          </div>
        </div>
      </div>

      {/* Range summary — Oran's list (2026-10-19), always all of them, no hours */}
      <div className="px-4 pt-3">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
          {SUMMARY_COLS.map(c => {
            const v = Number(totals[c.key] || 0);
            return (
              <div key={c.key} className={`rounded-xl border px-2 py-1.5 text-center ${v > 0 ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-100'}`}>
                <div className={`text-lg font-black tabular-nums leading-tight ${v > 0 ? 'text-violet-700' : 'text-slate-300'}`}>{v}</div>
                <div className="text-[11px] text-slate-500 leading-tight">{c.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Days → customer lines */}
      <div className="px-4 pt-3">
        <LeadActivityTable
          loading={loading && dayList.length === 0}
          empty="אין פעילות מול לקוחות בטווח זה"
          onOpen={L => navigate(`/?lead=${L.lead_id}`)}
          days={dayList.map(d => ({
            date: d.date,
            leads: d.leads,
            meta: d.metrics
              ? `${d.metrics.first_activity || '—'} – ${d.metrics.last_activity || '—'} · ${metricTotal(d.metrics) || 0} פעולות`
              : null,
          }))} />
      </div>
    </div>
  );
}
