import { useState, useEffect } from 'react';
import api from '../../api';

const STATUS = {
  open:       { label: 'חדש',    color: 'bg-violet-100 text-violet-700' },
  in_progress:{ label: 'בביצוע', color: 'bg-amber-100 text-amber-700' },
  done:       { label: 'הסתיים', color: 'bg-green-100 text-green-700' },
};
const NEXT = { open: 'in_progress', in_progress: 'done', done: 'open' };
const GROUPS = [
  { key: 'open',        label: 'חדש' },
  { key: 'in_progress', label: 'בביצוע' },
  { key: 'done',        label: 'הסתיים' },
];

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
}

function isOverdue(d) {
  if (!d) return false;
  return new Date(d) < new Date(new Date().toDateString());
}

export default function MaintenanceDetail({ onBack, users, onRefresh }) {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [form,    setForm]    = useState(null);
  const [saving,  setSaving]  = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/operations/maintenance');
      setItems(data.map(item => ({ ...item, status: item.status || 'open' })));
    } catch {}
    setLoading(false);
  }

  async function cycleStatus(item) {
    const next = NEXT[item.status || 'open'] || 'open';
    try {
      await api.put(`/operations/maintenance/${item.id}`, { status: next });
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: next } : i));
      if (onRefresh) onRefresh();
    } catch {}
  }

  async function completeAndAdvance(item) {
    setSaving(item.id);
    try {
      const { data } = await api.put(`/operations/maintenance/${item.id}/complete`);
      setItems(prev => prev.map(i => i.id === item.id ? { ...data, status: 'open' } : i));
      if (onRefresh) onRefresh();
    } catch {}
    setSaving(null);
  }

  async function submitNew() {
    if (!form?.name?.trim() || !form?.interval_days) return alert('שם ומרווח זמן חובה');
    try {
      await api.post('/operations/maintenance', {
        name: form.name, interval_days: parseInt(form.interval_days),
        assignee_id: form.assignee_id || null,
      });
      setForm(null);
      load();
      if (onRefresh) onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-100">
        <button onClick={onBack} className="text-violet-600 font-bold text-sm flex items-center gap-1 cursor-pointer">
          <span>→</span> חזרה
        </button>
        <p className="font-black text-slate-800 text-base">תחזוקה</p>
        <button
          onClick={() => setForm({ name: '', interval_days: '', assignee_id: '' })}
          className="text-xs font-bold text-violet-600 cursor-pointer"
        >
          + חדש
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">טוען...</div>
      ) : (
        <div className="flex-1 overflow-auto">
          {GROUPS.map(group => {
            const groupItems = items.filter(i => (i.status || 'open') === group.key);
            if (groupItems.length === 0) return null;
            return (
              <div key={group.key}>
                <div className="px-4 py-1.5 bg-slate-50 border-b border-slate-100">
                  <p className="text-xs font-black text-slate-500">{group.label} ({groupItems.length})</p>
                </div>
                {groupItems.map(item => {
                  const s      = STATUS[item.status || 'open'] || STATUS.open;
                  const overdue = isOverdue(item.next_due) && item.status !== 'done';
                  return (
                    <div
                      key={item.id}
                      className={`px-4 py-3 border-b border-slate-50 ${overdue ? 'bg-red-50' : 'bg-white'} hover:bg-violet-50 active:bg-violet-100 transition cursor-pointer`}
                      onClick={() => cycleStatus(item)}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-800">{item.name}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-xs text-slate-400 font-semibold">כל {item.interval_days} ימים</span>
                            {item.next_due && (
                              <span className={`text-xs font-semibold ${overdue ? 'text-red-600' : 'text-slate-400'}`}>
                                {overdue ? 'דחוף — ' : 'הבא: '}{formatDate(item.next_due)}
                              </span>
                            )}
                            {item.assignee_name && (
                              <span className="text-xs text-slate-500 font-semibold">{item.assignee_name}</span>
                            )}
                          </div>
                        </div>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full whitespace-nowrap ${s.color}`}>{s.label}</span>
                      </div>

                      {item.status === 'done' && (
                        <button
                          onClick={e => { e.stopPropagation(); completeAndAdvance(item); }}
                          disabled={saving === item.id}
                          className="mt-2 text-xs font-black px-3 py-1 rounded-xl bg-green-100 text-green-700 hover:bg-green-200 transition cursor-pointer disabled:opacity-50"
                        >
                          {saving === item.id ? '...' : 'קדם לתאריך הבא'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {items.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-12">אין משימות תחזוקה</p>
          )}
        </div>
      )}

      {/* New maintenance sheet */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" dir="rtl" onClick={() => setForm(null)}>
          <div className="w-full bg-white rounded-t-2xl p-5 pb-8 space-y-3 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-2" />
            <h3 className="font-black text-slate-800 text-base">תחזוקה חוזרת חדשה</h3>
            <input
              autoFocus
              placeholder="שם המשימה (למשל: בדיקת גנרטור)"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
            />
            <div className="flex gap-2 items-center">
              <input
                type="number"
                min="1"
                placeholder="חזרה כל..."
                value={form.interval_days}
                onChange={e => setForm(f => ({ ...f, interval_days: e.target.value }))}
                className="w-32 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
              />
              <span className="text-sm text-slate-500">ימים</span>
            </div>
            <select
              value={form.assignee_id}
              onChange={e => setForm(f => ({ ...f, assignee_id: e.target.value }))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
            >
              <option value="">הקצה לאחראי (אופציונלי)</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
            </select>
            <button
              onClick={submitNew}
              className="w-full py-3 rounded-2xl text-white font-black text-sm cursor-pointer"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
            >
              שמור
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
