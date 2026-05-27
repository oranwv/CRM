import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../api';

const PRIORITY_COLORS = { urgent: 'text-red-600', high: 'text-orange-500', normal: 'text-violet-600', low: 'text-slate-400' };

export default function ChecklistDetail({ checklist, onBack, users, onSummaryRefresh }) {
  const [run,     setRun]     = useState(null);
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    load();
  }, [checklist.id]);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get(`/operations/checklists/${checklist.id}`);
      const r = data.latest_run;
      if (r && !r.completed_at) {
        setRun(r);
        setItems(Array.isArray(r.items_state) ? r.items_state : []);
      } else {
        setRun(null);
        setItems([]);
      }
    } catch {}
    setLoading(false);
  }

  async function startRun() {
    try {
      const { data } = await api.post('/operations/checklist-runs', { checklist_id: checklist.id });
      setRun(data);
      setItems(Array.isArray(data.items_state) ? data.items_state : []);
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  }

  const scheduleSave = useCallback((newItems, completed = false) => {
    if (!run) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await api.put(`/operations/checklist-runs/${run.id}`, { items_state: newItems, completed });
        if (onSummaryRefresh) onSummaryRefresh();
      } catch {}
      setSaving(false);
    }, 600);
  }, [run]);

  function handleQtyChange(idx, val) {
    const parsed = val === '' ? null : parseInt(val);
    const updated = items.map((item, i) => {
      if (i !== idx) return item;
      const actual   = parsed;
      const missing  = actual !== null && actual < (item.expected_qty || 0)
        ? (item.expected_qty || 0) - actual : 0;
      return { ...item, actual_qty: actual, missing_qty: missing, assigned_to: missing > 0 ? item.assigned_to : null };
    });
    setItems(updated);
    scheduleSave(updated);
  }

  function handleAssign(idx, userId) {
    const updated = items.map((item, i) =>
      i === idx ? { ...item, assigned_to: userId ? parseInt(userId) : null } : item
    );
    setItems(updated);
    scheduleSave(updated);
  }

  async function completeRun() {
    if (!run) return;
    clearTimeout(saveTimer.current);
    setSaving(true);
    try {
      await api.put(`/operations/checklist-runs/${run.id}`, { items_state: items, completed: true });
      if (onSummaryRefresh) onSummaryRefresh();
      setRun(null);
      setItems([]);
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
    setSaving(false);
  }

  const filled   = items.filter(i => i.actual_qty !== null).length;
  const missing  = items.filter(i => (i.missing_qty || 0) > 0);

  if (loading) return (
    <div className="flex-1 flex items-center justify-center py-16 text-slate-400 text-sm">טוען...</div>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-100">
        <button onClick={onBack} className="text-violet-600 font-bold text-sm flex items-center gap-1">
          <span>→</span> חזרה
        </button>
        <p className="font-black text-slate-800 text-base">{checklist.name}</p>
        {run && (
          <button
            onClick={completeRun}
            disabled={saving}
            className="text-xs font-bold px-3 py-1.5 rounded-xl text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 transition"
          >
            {saving ? '...' : 'סיים'}
          </button>
        )}
        {!run && <div className="w-16" />}
      </div>

      {!run ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
          <p className="text-slate-500 text-sm text-center">אין רשימה פעילה כרגע</p>
          <button
            onClick={startRun}
            className="px-6 py-3 rounded-2xl text-white font-black text-sm shadow-lg"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
          >
            הפעל רשימה
          </button>
          {/* Show template items as preview */}
          {(checklist.items || []).length > 0 && (
            <div className="w-full mt-4 space-y-1">
              {(checklist.items || []).map((item, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2 bg-slate-50 rounded-xl text-sm text-slate-600">
                  <span>{item.name}</span>
                  <span className="text-xs text-slate-400">{item.unit} × {item.expected_qty}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {/* Progress bar */}
          <div className="px-4 py-2 bg-violet-50 border-b border-violet-100">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-violet-700 font-semibold">מילוי: {filled}/{items.length}</p>
              {saving && <p className="text-xs text-slate-400">שומר...</p>}
            </div>
            <div className="h-1.5 bg-violet-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-violet-500 rounded-full transition-all"
                style={{ width: items.length ? `${(filled / items.length) * 100}%` : '0%' }}
              />
            </div>
          </div>

          {/* Items */}
          <div className="divide-y divide-slate-100">
            {items.map((item, idx) => {
              const isMissing = (item.missing_qty || 0) > 0;
              return (
                <div key={idx} className={`px-4 py-3 ${isMissing ? 'bg-red-50' : 'bg-white'}`}>
                  <div className="flex items-center gap-3 mb-1">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-slate-800">{item.name}</p>
                        {item.unit && <span className="text-xs text-slate-400">{item.unit}</span>}
                      </div>
                      <p className="text-xs text-slate-400">צפוי: {item.expected_qty || 0}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <label className="text-xs text-slate-500">בפועל:</label>
                      <input
                        type="number"
                        min="0"
                        value={item.actual_qty ?? ''}
                        onChange={e => handleQtyChange(idx, e.target.value)}
                        className={`w-16 border rounded-lg px-2 py-1 text-sm text-center font-bold focus:outline-none focus:ring-2 ${
                          isMissing
                            ? 'border-red-300 text-red-700 focus:ring-red-200'
                            : 'border-slate-200 text-slate-800 focus:ring-violet-200'
                        }`}
                      />
                    </div>
                  </div>

                  {isMissing && (
                    <div className="flex items-center gap-2 mt-2 pr-1">
                      <span className="text-xs font-bold text-red-600">חסרים {item.missing_qty}</span>
                      <span className="text-xs text-slate-400">—</span>
                      <select
                        value={item.assigned_to ?? ''}
                        onChange={e => handleAssign(idx, e.target.value)}
                        className="flex-1 text-xs border border-red-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-red-200 text-slate-700"
                      >
                        <option value="">הקצה לאחראי...</option>
                        {users.map(u => (
                          <option key={u.id} value={u.id}>{u.display_name || u.id}</option>
                        ))}
                      </select>
                      {item.assigned_to && (
                        <span className="text-xs bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                          {users.find(u => u.id === item.assigned_to)?.display_name || '?'}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Missing summary */}
          {missing.length > 0 && (
            <div className="mx-4 my-3 p-3 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-xs font-black text-red-700 mb-1">סיכום חוסרים ({missing.length})</p>
              {missing.map((item, i) => {
                const assignee = users.find(u => u.id === item.assigned_to);
                return (
                  <p key={i} className="text-xs text-red-600">
                    {item.name}: חסרים {item.missing_qty}
                    {assignee ? ` — ${assignee.display_name}` : ' — לא הוקצה'}
                  </p>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
