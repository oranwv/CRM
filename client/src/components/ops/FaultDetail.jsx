import { useState, useEffect } from 'react';
import api from '../../api';

const STATUS = {
  open:       { label: 'חדש',    color: 'bg-violet-100 text-violet-700' },
  in_progress:{ label: 'בביצוע', color: 'bg-amber-100 text-amber-700' },
  resolved:   { label: 'הסתיים', color: 'bg-green-100 text-green-700' },
};
const NEXT = { open: 'in_progress', in_progress: 'resolved', resolved: 'open' };
const GROUPS = [
  { key: 'open',        label: 'חדש' },
  { key: 'in_progress', label: 'בביצוע' },
  { key: 'resolved',    label: 'הסתיים' },
];

export default function FaultDetail({ onBack, users, onRefresh }) {
  const [faults,  setFaults]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [form,    setForm]    = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/operations/faults?all=true');
      setFaults(data);
    } catch {}
    setLoading(false);
  }

  async function cycleStatus(fault) {
    const next = NEXT[fault.status] || 'open';
    try {
      await api.put(`/operations/faults/${fault.id}`, { ...fault, status: next });
      setFaults(prev => prev.map(f => f.id === fault.id ? { ...f, status: next } : f));
      if (onRefresh) onRefresh();
    } catch {}
  }

  async function submitFault() {
    if (!form?.title?.trim()) return;
    try {
      const { data } = await api.post('/operations/faults', {
        title: form.title, description: form.description,
        assignee_id: form.assignee_id || null,
      });
      setFaults(prev => [data, ...prev]);
      setForm(null);
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
        <p className="font-black text-slate-800 text-base">תקלות</p>
        <button
          onClick={() => setForm({ title: '', description: '', assignee_id: '' })}
          className="text-xs font-bold text-violet-600 cursor-pointer"
        >
          + דווח
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">טוען...</div>
      ) : (
        <div className="flex-1 overflow-auto">
          {GROUPS.map(group => {
            const items = faults.filter(f => f.status === group.key);
            if (items.length === 0) return null;
            return (
              <div key={group.key}>
                <div className="px-4 py-1.5 bg-slate-50 border-b border-slate-100">
                  <p className="text-xs font-black text-slate-500">{group.label} ({items.length})</p>
                </div>
                {items.map(fault => {
                  const s = STATUS[fault.status] || STATUS.open;
                  return (
                    <div
                      key={fault.id}
                      onClick={() => cycleStatus(fault)}
                      className="flex items-center gap-3 px-4 py-3 border-b border-slate-50 bg-white hover:bg-slate-50 active:bg-slate-100 transition cursor-pointer"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800">{fault.title}</p>
                        {fault.description && (
                          <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{fault.description}</p>
                        )}
                        <div className="flex items-center gap-2 mt-0.5">
                          {fault.assignee_name && (
                            <span className="text-xs text-slate-500 font-semibold">{fault.assignee_name}</span>
                          )}
                          {fault.reported_by_name && (
                            <span className="text-xs text-slate-400">דוּוח ע"י {fault.reported_by_name}</span>
                          )}
                        </div>
                      </div>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full whitespace-nowrap ${s.color}`}>{s.label}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {faults.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-12">אין תקלות</p>
          )}
        </div>
      )}

      {/* New fault sheet */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" dir="rtl" onClick={() => setForm(null)}>
          <div className="w-full bg-white rounded-t-2xl p-5 pb-8 space-y-3 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-2" />
            <h3 className="font-black text-slate-800 text-base">דיווח תקלה</h3>
            <input
              autoFocus
              placeholder="תיאור התקלה"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
            />
            <textarea
              placeholder="פרטים נוספים (אופציונלי)"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={2}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400 resize-none"
            />
            <select
              value={form.assignee_id}
              onChange={e => setForm(f => ({ ...f, assignee_id: e.target.value }))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
            >
              <option value="">הקצה לאחראי...</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
            </select>
            <button
              onClick={submitFault}
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
