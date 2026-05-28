import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

export default function ManagementPage() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const isManager = ['admin', 'manager'].includes(user.role);

  const todayStr = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(todayStr);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isManager) { navigate('/'); return; }
  }, []);

  useEffect(() => {
    if (!isManager) return;
    setLoading(true);
    api.get(`/analytics/employee-activity?date=${date}`)
      .then(r => setRows(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [date]);

  const cols = [
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
    { key: 'first_activity',      label: 'כניסה ראשונה', noSum: true },
    { key: 'last_activity',       label: 'פעילות אחרונה', noSum: true },
  ];

  const total = row => cols.filter(c => !c.noSum).reduce((s, c) => s + Number(row[c.key] || 0), 0);

  const sortedRows = [...rows].sort((a, b) => total(b) - total(a));

  return (
    <div className="min-h-screen bg-slate-50 pb-32" dir="rtl">
      <div className="px-4 pt-4 pb-3 flex items-center gap-3 sticky top-11 bg-slate-50 z-10 border-b border-slate-200">
        <span className="font-black text-slate-700 text-sm">פעילות עובדים</span>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          max={todayStr}
          className="border border-slate-300 rounded-xl px-3 py-1.5 text-sm text-slate-700 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
          style={{ direction: 'ltr' }}
        />
        {loading && <span className="text-xs text-slate-400">טוען...</span>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse" style={{ minWidth: 680 }}>
          <thead>
            <tr className="bg-violet-50 text-violet-700">
              <th className="text-right px-4 py-2.5 font-black border-b border-violet-100 sticky right-0 bg-violet-50">שם</th>
              {cols.map(c => (
                <th key={c.key} className="text-center px-3 py-2.5 font-bold border-b border-violet-100 whitespace-nowrap">
                  {c.label}
                </th>
              ))}
              <th className="text-center px-3 py-2.5 font-black border-b border-violet-100 bg-violet-100">סה״כ</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 && !loading && (
              <tr>
                <td colSpan={cols.length + 2} className="text-center py-10 text-slate-400 text-sm">
                  אין נתונים לתאריך זה
                </td>
              </tr>
            )}
            {sortedRows.map(row => {
              const tot = total(row);
              const inactive = tot === 0;
              return (
                <tr
                  key={row.id}
                  className={`border-b border-slate-100 transition ${inactive ? 'bg-red-50' : 'bg-white hover:bg-slate-50'}`}
                >
                  <td className={`px-4 py-2.5 font-bold sticky right-0 ${inactive ? 'bg-red-50 text-red-500' : 'bg-white text-slate-800'}`}>
                    {row.display_name}
                  </td>
                  {cols.map(c => {
                    if (c.noSum) {
                      const val = row[c.key];
                      return (
                        <td key={c.key} className={`text-center px-3 py-2.5 tabular-nums text-xs ${val ? 'text-slate-600' : 'text-slate-300'}`}>
                          {val || '—'}
                        </td>
                      );
                    }
                    const val = Number(row[c.key] || 0);
                    return (
                      <td
                        key={c.key}
                        className={`text-center px-3 py-2.5 tabular-nums ${val > 0 ? 'text-slate-800 font-semibold' : 'text-slate-300'}`}
                      >
                        {val || '—'}
                      </td>
                    );
                  })}
                  <td className={`text-center px-3 py-2.5 font-black tabular-nums ${inactive ? 'text-red-400' : 'text-violet-700'}`}>
                    {tot || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
