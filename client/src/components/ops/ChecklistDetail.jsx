import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../api';

function fmtFilledAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const day   = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const hour  = String(d.getHours()).padStart(2, '0');
  const min   = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month} ${hour}:${min}`;
}

const inputCls = 'border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-violet-400';

export default function ChecklistDetail({ checklist, onBack, users, onSummaryRefresh }) {
  const [run,        setRun]        = useState(null);
  const [items,      setItems]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [editingIdx, setEditingIdx] = useState(null);
  const [editForm,   setEditForm]   = useState({ name: '', unit: '', expected_qty: '' });
  const [addingItem, setAddingItem] = useState(false);
  const [addForm,    setAddForm]    = useState({ name: '', unit: '', expected_qty: '' });
  const saveTimer = useRef(null);

  const currentUser = (() => { try { return JSON.parse(localStorage.getItem('crm_user') || '{}'); } catch { return {}; } })();

  useEffect(() => { load(); }, [checklist.id]);

  async function createRun() {
    const { data } = await api.post('/operations/checklist-runs', { checklist_id: checklist.id });
    setRun(data);
    setItems(Array.isArray(data.items_state) ? data.items_state : []);
  }

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get(`/operations/checklists/${checklist.id}`);
      const r = data.latest_run;
      if (r && !r.completed_at) {
        setRun(r);
        setItems(Array.isArray(r.items_state) ? r.items_state : []);
      } else {
        await createRun();
      }
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
    setLoading(false);
  }

  const scheduleSave = useCallback((newItems) => {
    if (!run) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await api.put(`/operations/checklist-runs/${run.id}`, { items_state: newItems });
        if (onSummaryRefresh) onSummaryRefresh();
      } catch {}
      setSaving(false);
    }, 600);
  }, [run]);

  function handleQtyChange(idx, val) {
    const parsed = val === '' ? null : parseInt(val);
    const updated = items.map((item, i) => {
      if (i !== idx) return item;
      const missing = parsed !== null && parsed < (item.expected_qty || 0)
        ? (item.expected_qty || 0) - parsed : 0;
      return {
        ...item,
        actual_qty:  parsed,
        missing_qty: missing,
        assigned_to: missing > 0 ? item.assigned_to : null,
        filled_by:   parsed !== null ? (currentUser.id || null) : null,
        filled_at:   parsed !== null ? new Date().toISOString() : null,
      };
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

  function openEdit(idx) {
    setEditingIdx(idx);
    setEditForm({
      name:         items[idx].name || '',
      unit:         items[idx].unit || '',
      expected_qty: String(items[idx].expected_qty ?? ''),
    });
    setAddingItem(false);
  }

  function saveEdit() {
    if (!editForm.name.trim()) return;
    const updated = items.map((item, i) => {
      if (i !== editingIdx) return item;
      const newExpected = parseInt(editForm.expected_qty) || 0;
      const missing = item.actual_qty !== null && item.actual_qty < newExpected
        ? newExpected - item.actual_qty : 0;
      return { ...item, name: editForm.name.trim(), unit: editForm.unit.trim(), expected_qty: newExpected, missing_qty: missing };
    });
    setItems(updated);
    scheduleSave(updated);
    setEditingIdx(null);
  }

  function confirmAddItem() {
    if (!addForm.name.trim()) return;
    const newItem = {
      name:         addForm.name.trim(),
      unit:         addForm.unit.trim(),
      expected_qty: parseInt(addForm.expected_qty) || 0,
      actual_qty:   null,
      missing_qty:  0,
      assigned_to:  null,
      filled_by:    null,
      filled_at:    null,
    };
    const updated = [...items, newItem];
    setItems(updated);
    scheduleSave(updated);
    setAddForm({ name: '', unit: '', expected_qty: '' });
    setAddingItem(false);
  }

  const filled  = items.filter(i => i.actual_qty !== null).length;
  const missing = items.filter(i => (i.missing_qty || 0) > 0);

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
        <div className="w-16" />
      </div>

      <div className="flex-1 overflow-auto">
        {/* Progress bar */}
        <div className="px-4 py-2 bg-violet-50 border-b border-violet-100">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-violet-700 font-semibold">מילוי: {filled}/{items.length}</p>
            {saving && <p className="text-xs text-slate-400">שומר...</p>}
          </div>
          <div className="h-1.5 bg-violet-100 rounded-full overflow-hidden">
            <div className="h-full bg-violet-500 rounded-full transition-all"
              style={{ width: items.length ? `${(filled / items.length) * 100}%` : '0%' }} />
          </div>
        </div>

        {/* Items */}
        <div className="divide-y divide-slate-100">
          {items.map((item, idx) => {
            const isMissing = (item.missing_qty || 0) > 0;
            const isEditing = editingIdx === idx;
            const filledByName = item.filled_by
              ? (users.find(u => u.id === item.filled_by)?.display_name || currentUser.display_name || '')
              : '';

            return (
              <div key={idx} className={`px-4 py-3 ${isMissing ? 'bg-red-50' : 'bg-white'}`}>
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="שם פריט" className={`flex-1 ${inputCls}`} />
                      <input value={editForm.unit} onChange={e => setEditForm(f => ({ ...f, unit: e.target.value }))}
                        placeholder="יחידה" className={`w-20 ${inputCls}`} />
                      <input type="number" min="0" value={editForm.expected_qty}
                        onChange={e => setEditForm(f => ({ ...f, expected_qty: e.target.value }))}
                        placeholder="כמות" className={`w-16 ${inputCls} text-center`} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={saveEdit}
                        className="flex-1 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-bold">שמור</button>
                      <button onClick={() => setEditingIdx(null)}
                        className="flex-1 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-xs font-bold">ביטול</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3 mb-1">
                      <div className="flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-bold text-slate-800">{item.name}</p>
                          {item.unit && <span className="text-xs text-slate-400">{item.unit}</span>}
                          <button onClick={() => openEdit(idx)}
                            className="text-slate-300 hover:text-violet-500 transition text-xs px-1">✏️</button>
                        </div>
                        <p className="text-xs text-slate-400">צפוי: {item.expected_qty || 0}</p>
                        {item.actual_qty !== null && (filledByName || item.filled_at) && (
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {filledByName}{filledByName && item.filled_at ? ' · ' : ''}{fmtFilledAt(item.filled_at)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <label className="text-xs text-slate-500">בפועל:</label>
                        <input type="number" min="0" value={item.actual_qty ?? ''}
                          onChange={e => handleQtyChange(idx, e.target.value)}
                          className={`w-16 border rounded-lg px-2 py-1 text-sm text-center font-bold focus:outline-none focus:ring-2 ${
                            isMissing
                              ? 'border-red-300 text-red-700 focus:ring-red-200'
                              : 'border-slate-200 text-slate-800 focus:ring-violet-200'
                          }`} />
                      </div>
                    </div>

                    {isMissing && (
                      <div className="flex items-center gap-2 mt-2 pr-1">
                        <span className="text-xs font-bold text-red-600">חסרים {item.missing_qty}</span>
                        <span className="text-xs text-slate-400">—</span>
                        <select value={item.assigned_to ?? ''} onChange={e => handleAssign(idx, e.target.value)}
                          className="flex-1 text-xs border border-red-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-red-200 text-slate-700">
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
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Add item */}
        <div className="px-4 py-3 border-t border-slate-100">
          {addingItem ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input autoFocus value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="שם פריט" className={`flex-1 ${inputCls}`} />
                <input value={addForm.unit} onChange={e => setAddForm(f => ({ ...f, unit: e.target.value }))}
                  placeholder="יחידה" className={`w-20 ${inputCls}`} />
                <input type="number" min="0" value={addForm.expected_qty}
                  onChange={e => setAddForm(f => ({ ...f, expected_qty: e.target.value }))}
                  placeholder="כמות" className={`w-16 ${inputCls} text-center`} />
              </div>
              <div className="flex gap-2">
                <button onClick={confirmAddItem}
                  className="flex-1 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-bold">הוסף</button>
                <button onClick={() => { setAddingItem(false); setAddForm({ name: '', unit: '', expected_qty: '' }); }}
                  className="flex-1 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-xs font-bold">ביטול</button>
              </div>
            </div>
          ) : (
            <button onClick={() => { setAddingItem(true); setEditingIdx(null); }}
              className="w-full py-2 rounded-xl border-2 border-dashed border-violet-200 text-violet-600 text-xs font-bold hover:border-violet-400 hover:bg-violet-50 transition">
              + הוסף פריט
            </button>
          )}
        </div>

        {/* Missing summary */}
        {missing.length > 0 && (
          <div className="mx-4 mb-3 p-3 bg-red-50 border border-red-200 rounded-xl">
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
    </div>
  );
}
