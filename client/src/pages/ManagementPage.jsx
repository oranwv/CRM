import { useState, useEffect, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

const METRIC_COLS = [
  { key: 'calls_made',          label: 'שיחות שבוצעו' },
  { key: 'calls_documented',    label: 'שיחות שתועדו' },
  { key: 'meetings_done',       label: 'פגישות שבוצעו' },
  { key: 'meetings_documented', label: 'פגישות שתועדו' },
  { key: 'notes',               label: 'הערות' },
  { key: 'wa_sent',             label: 'WA נשלח' },
  { key: 'tasks_created',       label: 'משימות נוצרו' },
  { key: 'tasks_completed',     label: 'משימות הושלמו' },
  { key: 'leads_created',       label: 'לידים' },
  { key: 'files_uploaded',      label: 'קבצים' },
];

const dayStr = d => d.toISOString().slice(0, 10);
function shiftDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return dayStr(d); }

// Decimal hours → "H:MM"
function fmtHours(h) {
  if (!h) return '—';
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

const metricTotal = obj => METRIC_COLS.reduce((s, c) => s + Number(obj[c.key] || 0), 0);

export default function ManagementPage() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const isManager = ['admin', 'manager'].includes(user.role);

  const todayStr = dayStr(new Date());
  const [from, setFrom] = useState(todayStr);
  const [to, setTo]     = useState(todayStr);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());

  useEffect(() => {
    if (!isManager) { navigate('/'); return; }
  }, []);

  useEffect(() => {
    if (!isManager) return;
    setLoading(true);
    api.get(`/analytics/employee-activity?from=${from}&to=${to}`)
      .then(r => setRows(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [from, to]);

  function toggle(id) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const sortedRows = [...rows].sort((a, b) => metricTotal(b.totals) - metricTotal(a.totals));
  const isRange = from !== to;

  const presets = [
    { label: 'היום',     from: todayStr,      to: todayStr },
    { label: '7 ימים',  from: shiftDays(-6),  to: todayStr },
    { label: '30 ימים', from: shiftDays(-29), to: todayStr },
  ];

  // Page the selected window backward/forward by its own length (one day when a
  // single day is selected). dir = -1 (older) / +1 (newer). Forward is clamped to today.
  function shiftRange(dir) {
    const f = new Date(from + 'T12:00:00'), t = new Date(to + 'T12:00:00');
    const span = Math.round((t - f) / 86400000) + 1;
    const step = span * dir;
    f.setDate(f.getDate() + step);
    t.setDate(t.getDate() + step);
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let nf = fmt(f), nt = fmt(t);
    if (nt > todayStr) { // clamp so the window never passes today, keeping its length
      const t2 = new Date(todayStr + 'T12:00:00'), f2 = new Date(t2);
      f2.setDate(f2.getDate() - (span - 1));
      nf = fmt(f2); nt = todayStr;
    }
    setFrom(nf); setTo(nt);
  }
  const atToday = to >= todayStr;

  return (
    <div className="min-h-screen bg-slate-50 pb-32" dir="rtl">
      <div className="px-4 pt-4 pb-3 flex items-center gap-2 flex-wrap sticky top-11 bg-slate-50 z-10 border-b border-slate-200">
        <span className="font-black text-slate-700 text-sm">פעילות עובדים</span>
        <div className="flex items-center gap-1">
          <button onClick={() => shiftRange(-1)} title="טווח קודם" aria-label="טווח קודם"
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-slate-300 text-slate-600 hover:bg-slate-100 font-bold">▶</button>
          <button onClick={() => shiftRange(1)} disabled={atToday} title="טווח הבא" aria-label="טווח הבא"
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-slate-300 text-slate-600 hover:bg-slate-100 font-bold disabled:opacity-40 disabled:hover:bg-white">◀</button>
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <span>מ-</span>
          <input type="date" value={from} max={to}
            onChange={e => setFrom(e.target.value)}
            className="border border-slate-300 rounded-xl px-2 py-1.5 text-sm text-slate-700 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            style={{ direction: 'ltr' }} />
          <span>עד</span>
          <input type="date" value={to} min={from} max={todayStr}
            onChange={e => setTo(e.target.value)}
            className="border border-slate-300 rounded-xl px-2 py-1.5 text-sm text-slate-700 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            style={{ direction: 'ltr' }} />
        </div>
        <div className="flex items-center gap-1">
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
        {isRange && <span className="text-xs text-slate-400">· לחיצה על שורה פותחת פירוט יומי</span>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse" style={{ minWidth: 820 }}>
          <thead>
            <tr className="bg-violet-50 text-violet-700">
              <th className="text-right px-4 py-2.5 font-black border-b border-violet-100 sticky right-0 bg-violet-50">שם</th>
              {METRIC_COLS.map(c => (
                <th key={c.key} className="text-center px-3 py-2.5 font-bold border-b border-violet-100 whitespace-nowrap">{c.label}</th>
              ))}
              <th className="text-center px-3 py-2.5 font-bold border-b border-violet-100 whitespace-nowrap">כניסה ראשונה</th>
              <th className="text-center px-3 py-2.5 font-bold border-b border-violet-100 whitespace-nowrap">פעילות אחרונה</th>
              <th className="text-center px-3 py-2.5 font-black border-b border-violet-100 bg-sky-100 text-sky-800 whitespace-nowrap">שעות</th>
              <th className="text-center px-3 py-2.5 font-black border-b border-violet-100 bg-violet-100">סה״כ</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 && !loading && (
              <tr>
                <td colSpan={METRIC_COLS.length + 5} className="text-center py-10 text-slate-400 text-sm">אין נתונים לטווח זה</td>
              </tr>
            )}
            {sortedRows.map(row => {
              const tot = metricTotal(row.totals);
              const inactive = tot === 0 && !row.totals.hours;
              const open = expanded.has(row.id);
              return (
                <Fragment key={row.id}>
                  <tr
                    onClick={() => row.days.length && toggle(row.id)}
                    className={`border-b border-slate-100 transition ${row.days.length ? 'cursor-pointer' : ''} ${inactive ? 'bg-red-50' : 'bg-white hover:bg-slate-50'}`}>
                    <td className={`px-4 py-2.5 font-bold sticky right-0 ${inactive ? 'bg-red-50 text-red-500' : 'bg-white text-slate-800'}`}>
                      {row.days.length > 0 && <span className="text-slate-400 mr-1">{open ? '▾' : '▸'}</span>}
                      {row.display_name}
                    </td>
                    {METRIC_COLS.map(c => {
                      const val = Number(row.totals[c.key] || 0);
                      return (
                        <td key={c.key} className={`text-center px-3 py-2.5 tabular-nums ${val > 0 ? 'text-slate-800 font-semibold' : 'text-slate-300'}`}>
                          {val || '—'}
                        </td>
                      );
                    })}
                    <td className="text-center px-3 py-2.5 tabular-nums text-xs text-slate-600" title={isRange && row.days[0] ? `ביום ${row.days[0].date}` : undefined}>{row.days[0]?.first_activity || '—'}</td>
                    <td className="text-center px-3 py-2.5 tabular-nums text-xs text-slate-600" title={isRange && row.days[0] ? `ביום ${row.days[0].date}` : undefined}>{row.days[0]?.last_activity || '—'}</td>
                    <td className="text-center px-3 py-2.5 tabular-nums font-bold text-sky-700">{fmtHours(row.totals.hours)}</td>
                    <td className={`text-center px-3 py-2.5 font-black tabular-nums ${inactive ? 'text-red-400' : 'text-violet-700'}`}>{tot || '—'}</td>
                  </tr>

                  {open && row.days.map(d => {
                    const dtot = metricTotal(d);
                    return (
                      <tr key={`${row.id}-${d.date}`} className="border-b border-slate-100 bg-slate-50/60 text-xs">
                        <td className="px-4 py-2 sticky right-0 bg-slate-50/60 text-slate-500">
                          <span className="font-semibold text-slate-600">{d.date}</span>
                        </td>
                        {METRIC_COLS.map(c => {
                          const val = Number(d[c.key] || 0);
                          return (
                            <td key={c.key} className={`text-center px-3 py-2 tabular-nums ${val > 0 ? 'text-slate-700' : 'text-slate-300'}`}>{val || '—'}</td>
                          );
                        })}
                        <td className="text-center px-3 py-2 tabular-nums text-slate-500">{d.first_activity || '—'}</td>
                        <td className="text-center px-3 py-2 tabular-nums text-slate-500">{d.last_activity || '—'}</td>
                        <td className="text-center px-3 py-2 tabular-nums text-sky-700"
                          title={d.hours_source === 'estimated' ? 'מחושב לפי פעילות, ללא מעקב נוכחות' : 'נמדד לפי נוכחות בפועל'}>
                          {d.hours_source === 'estimated' && d.hours ? '≈' : ''}{fmtHours(d.hours)}
                        </td>
                        <td className="text-center px-3 py-2 tabular-nums text-slate-500">{dtot || '—'}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
