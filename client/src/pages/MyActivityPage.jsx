import { useState, useEffect, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { METRIC_COLS, dayStr, shiftDays, fmtHours, metricTotal, LeadActivityHeader, LeadActivityLine } from './ManagementPage';

// Phase 52 — "הפעילות שלי": the signed-in user's own activity, same range picker and the same
// customer lines as ניהול, without the per-employee table. Any role.
export default function MyActivityPage() {
  const navigate = useNavigate();
  const todayStr = dayStr(new Date());
  const [from, setFrom] = useState(todayStr);
  const [to, setTo]     = useState(todayStr);
  const [row, setRow]   = useState(null);     // { totals, days } of the user
  const [leadDays, setLeadDays] = useState([]); // [{ date, leads }]
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get(`/analytics/my-activity?from=${from}&to=${to}`),
      api.get(`/analytics/my-activity/leads?from=${from}&to=${to}`),
    ])
      .then(([a, b]) => { setRow(a.data); setLeadDays(Array.isArray(b.data) ? b.data : []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [from, to]);

  const isRange = from !== to;
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
  const tot = metricTotal(totals);
  const summaryCols = METRIC_COLS.filter(c => Number(totals[c.key] || 0) > 0);

  return (
    <div className="min-h-screen bg-slate-50 pb-32" dir="rtl">
      <div className="px-4 pt-4 pb-3 flex items-center gap-2 flex-wrap sticky top-11 bg-slate-50 z-10 border-b border-slate-200">
        <span className="font-black text-slate-700 text-sm">👤 הפעילות שלי</span>
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

      {/* Range summary */}
      <div className="px-4 pt-3">
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-x-5 gap-y-1 flex-wrap text-sm">
          <span className="font-black text-violet-700 tabular-nums">{tot || 0} פעולות</span>
          <span className="font-bold text-sky-700 tabular-nums">{fmtHours(totals.hours)} שעות</span>
          {summaryCols.map(c => (
            <span key={c.key} className="text-slate-600 tabular-nums"><span className="font-bold text-slate-800">{totals[c.key]}</span> {c.label}</span>
          ))}
          {!loading && tot === 0 && !totals.hours && <span className="text-slate-400">אין פעילות בטווח זה</span>}
        </div>
      </div>

      {/* Days → customer lines */}
      <div className="px-4 pt-3">
        <div>
          {dayList.length > 0 && <div className="px-3 pb-1"><LeadActivityHeader /></div>}
          {dayList.map(d => (
            <Fragment key={d.date}>
              <div className="flex items-center gap-3 px-3 py-1.5 text-xs text-slate-500 bg-slate-100 rounded-md mt-2">
                <span className="font-bold text-slate-600">{d.date}</span>
                {d.metrics && (
                  <>
                    <span className="tabular-nums">{d.metrics.first_activity || '—'} – {d.metrics.last_activity || '—'}</span>
                    <span className="tabular-nums text-sky-700 font-semibold" title={d.metrics.hours_source === 'estimated' ? 'מחושב לפי פעילות' : 'נמדד לפי נוכחות בפועל'}>
                      {d.metrics.hours_source === 'estimated' && d.metrics.hours ? '≈' : ''}{fmtHours(d.metrics.hours)} שעות
                    </span>
                    <span className="tabular-nums">{metricTotal(d.metrics) || 0} פעולות</span>
                  </>
                )}
              </div>
              {d.leads.length === 0 && <div className="px-3 py-1.5 text-xs text-slate-400">אין פעילות מול לקוחות ביום זה</div>}
              {d.leads.map(L => (
                <div key={`${d.date}-${L.lead_id}`} className="px-3 py-1.5 border-b border-slate-100 bg-white hover:bg-violet-50/40">
                  <LeadActivityLine L={L} onOpen={() => navigate(`/?lead=${L.lead_id}`)} />
                </div>
              ))}
            </Fragment>
          ))}
          {!loading && dayList.length === 0 && isRange && <div className="text-center py-10 text-slate-400 text-sm">אין נתונים לטווח זה</div>}
        </div>
      </div>
    </div>
  );
}
