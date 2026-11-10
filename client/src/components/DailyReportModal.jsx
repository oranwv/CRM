import { useMemo } from 'react';

// Phase 78 — per-employee daily report: for every day of the selected range, how many actions
// the employee did and how many of them were talk minutes. Opened from ניהול ("📄 דוח יומי").
// `row` is the employee's entry from /analytics/employee-activity; days with nothing are listed as 0.
const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const fmtDate = ds => { const [y, m, d] = ds.split('-'); return `${Number(d)}.${Number(m)}.${y.slice(2)}`; };

export default function DailyReportModal({ row, from, to, metricTotal, onClose }) {
  const days = useMemo(() => {
    const byDate = new Map((row.days || []).map(d => [d.date, d]));
    const out = [];
    const cur = new Date(from + 'T12:00:00'), end = new Date(to + 'T12:00:00');
    while (cur <= end) {
      const ds = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
      const d = byDate.get(ds);
      out.push({ date: ds, weekday: WEEKDAYS[cur.getDay()], actions: d ? metricTotal(d) : 0, minutes: d ? Number(d.call_minutes || 0) : 0 });
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }, [row, from, to]);
  const totalActions = days.reduce((s, d) => s + d.actions, 0);
  const totalMinutes = days.reduce((s, d) => s + d.minutes, 0);
  const activeDays = days.filter(d => d.actions > 0 || d.minutes > 0).length;

  function download() {
    const lines = [['תאריך', 'יום', 'פעולות', 'דקות שיחה'], ...days.map(d => [fmtDate(d.date), d.weekday, d.actions, d.minutes]), ['סה"כ', `${activeDays} ימי פעילות`, totalActions, totalMinutes]];
    const csv = '﻿' + lines.map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `דוח יומי - ${row.display_name} - ${from} עד ${to}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="fixed inset-0 z-[78] flex items-center justify-center bg-black/50 p-4" dir="rtl" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[88vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="min-w-0">
            <h2 className="font-black text-slate-800 text-base">📄 דוח יומי — {row.display_name}</h2>
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">{fmtDate(from)} – {fmtDate(to)} · {activeDays} ימי פעילות</p>
          </div>
          <button onClick={onClose} className="shrink-0 mr-3 text-slate-400 hover:text-slate-600 text-2xl leading-none" aria-label="סגור">&times;</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0">
              <tr className="bg-violet-50 text-violet-700">
                <th className="text-right px-4 py-2 font-black">תאריך</th>
                <th className="text-right px-2 py-2 font-black">יום</th>
                <th className="text-center px-2 py-2 font-black">פעולות</th>
                <th className="text-center px-4 py-2 font-black">דקות שיחה</th>
              </tr>
            </thead>
            <tbody>
              {days.map(d => {
                const empty = d.actions === 0 && d.minutes === 0;
                return (
                  <tr key={d.date} className={`border-b border-slate-100 ${empty ? 'text-slate-300' : 'text-slate-800'} ${d.weekday === 'שבת' || d.weekday === 'שישי' ? 'bg-slate-50' : ''}`}>
                    <td className="px-4 py-1.5 tabular-nums">{fmtDate(d.date)}</td>
                    <td className="px-2 py-1.5">{d.weekday}</td>
                    <td className="px-2 py-1.5 text-center tabular-nums font-bold">{d.actions || '—'}</td>
                    <td className="px-4 py-1.5 text-center tabular-nums font-bold">{d.minutes || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0">
              <tr className="bg-violet-600 text-white font-black">
                <td className="px-4 py-2" colSpan={2}>סה״כ</td>
                <td className="px-2 py-2 text-center tabular-nums">{totalActions}</td>
                <td className="px-4 py-2 text-center tabular-nums">{totalMinutes}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 shrink-0 flex justify-end">
          <button onClick={download} className="text-sm font-bold px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700">⬇ הורדה לאקסל</button>
        </div>
      </div>
    </div>
  );
}
