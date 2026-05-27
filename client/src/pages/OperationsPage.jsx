import { useState, useEffect, useCallback } from 'react';
import api from '../api';
import ChecklistDetail from '../components/ops/ChecklistDetail';

const PRIORITY_LABEL = { urgent: 'דחוף', high: 'גבוה', normal: 'רגיל', low: 'נמוך' };
const PRIORITY_COLOR = { urgent: 'bg-red-100 text-red-700', high: 'bg-orange-100 text-orange-700', normal: 'bg-violet-100 text-violet-700', low: 'bg-slate-100 text-slate-500' };
const STATUS_LABEL   = { open: 'פתוח', in_progress: 'בתהליך', done: 'הושלם' };
const FAULT_STATUS   = { open: { label: 'פתוחה', color: 'bg-red-100 text-red-700' }, in_progress: { label: 'בטיפול', color: 'bg-amber-100 text-amber-700' }, resolved: { label: 'טופל', color: 'bg-green-100 text-green-700' } };

function heDay() {
  const d = new Date();
  const days = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
  const months = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}`;
}

function checklistProgress(checklist) {
  const run = checklist.latest_run;
  if (!run || run.completed_at) return { filled: 0, total: (checklist.items || []).length, done: !!run?.completed_at };
  const items = Array.isArray(run.items_state) ? run.items_state : [];
  return { filled: items.filter(i => i.actual_qty !== null).length, total: items.length, done: false };
}

export default function OperationsPage() {
  const [summary,          setSummary]          = useState({ openTasks: 0, pendingMissing: 0, overdueMaintenace: 0, openFaults: 0 });
  const [tasks,            setTasks]            = useState([]);
  const [checklists,       setChecklists]       = useState([]);
  const [users,            setUsers]            = useState([]);
  const [activeChecklist,  setActiveChecklist]  = useState(null);
  const [showFab,          setShowFab]          = useState(false);
  const [modal,            setModal]            = useState(null); // 'task' | 'checklist' | 'fault' | 'maintenance'
  const [loading,          setLoading]          = useState(true);

  // Form state
  const [form, setForm] = useState({});

  const loadAll = useCallback(async () => {
    try {
      const [sRes, tRes, cRes, uRes] = await Promise.all([
        api.get('/operations/summary'),
        api.get('/operations/tasks'),
        api.get('/operations/checklists'),
        api.get('/operations/users'),
      ]);
      setSummary(sRes.data);
      setTasks(tRes.data);
      setChecklists(cRes.data);
      setUsers(uRes.data);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function refreshSummary() {
    try {
      const [sRes, tRes] = await Promise.all([
        api.get('/operations/summary'),
        api.get('/operations/tasks'),
      ]);
      setSummary(sRes.data);
      setTasks(tRes.data);
    } catch {}
  }

  function openModal(type) {
    setForm({});
    setModal(type);
    setShowFab(false);
  }

  async function handleSubmit() {
    try {
      if (modal === 'task') {
        if (!form.title?.trim()) return alert('כותרת חובה');
        await api.post('/operations/tasks', {
          title: form.title, description: form.description,
          assigned_to: form.assigned_to || null, priority: form.priority || 'normal',
          due_date: form.due_date || null,
        });
      } else if (modal === 'checklist') {
        if (!form.name?.trim()) return alert('שם חובה');
        const items = (form.items || []).filter(i => i.name?.trim());
        await api.post('/operations/checklists', { name: form.name, items });
      } else if (modal === 'fault') {
        if (!form.title?.trim()) return alert('כותרת חובה');
        await api.post('/operations/faults', {
          title: form.title, description: form.description,
          assignee_id: form.assignee_id || null,
        });
      } else if (modal === 'maintenance') {
        if (!form.name?.trim() || !form.interval_days) return alert('שם ומרווח זמן חובה');
        await api.post('/operations/maintenance', {
          name: form.name, interval_days: parseInt(form.interval_days),
          assignee_id: form.assignee_id || null,
        });
      }
      setModal(null);
      loadAll();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  }

  async function completeTask(task) {
    try {
      await api.put(`/operations/tasks/${task.id}`, { ...task, status: 'done' });
      setTasks(prev => prev.filter(t => t.id !== task.id));
      setSummary(prev => ({ ...prev, openTasks: Math.max(0, prev.openTasks - 1) }));
    } catch {}
  }

  // Checklist item helpers for create form
  function addChecklistItem() {
    setForm(f => ({ ...f, items: [...(f.items || []), { name: '', unit: '', expected_qty: '' }] }));
  }
  function updateItem(idx, field, val) {
    setForm(f => {
      const items = [...(f.items || [])];
      items[idx] = { ...items[idx], [field]: val };
      return { ...f, items };
    });
  }
  function removeItem(idx) {
    setForm(f => ({ ...f, items: (f.items || []).filter((_, i) => i !== idx) }));
  }

  if (activeChecklist) {
    return (
      <div className="flex flex-col h-full" dir="rtl" style={{ paddingBottom: 0 }}>
        <ChecklistDetail
          checklist={activeChecklist}
          onBack={() => { setActiveChecklist(null); loadAll(); }}
          users={users}
          onSummaryRefresh={refreshSummary}
        />
      </div>
    );
  }

  const statCards = [
    { label: 'משימות פתוחות',  value: summary.openTasks,        color: 'text-violet-600', bg: 'bg-violet-50',  border: 'border-violet-100' },
    { label: 'חוסרים ממתינים', value: summary.pendingMissing,   color: 'text-amber-600',  bg: 'bg-amber-50',   border: 'border-amber-100' },
    { label: 'תחזוקה דחופה',  value: summary.overdueMaintenace, color: 'text-red-600',    bg: 'bg-red-50',     border: 'border-red-100' },
    { label: 'תקלות פתוחות',  value: summary.openFaults,        color: 'text-slate-600',  bg: 'bg-slate-50',   border: 'border-slate-200' },
  ];

  return (
    <div className="flex flex-col h-full bg-slate-50" dir="rtl">
      {/* Page header */}
      <div className="px-4 pt-3 pb-2 bg-white border-b border-slate-100">
        <div className="flex items-center justify-between">
          <p className="font-black text-slate-800 text-lg">תפעול</p>
          <p className="text-xs text-slate-400">{heDay()}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">טוען...</div>
      ) : (
        <div className="flex-1 overflow-auto">
          {/* Stat cards */}
          <div className="grid grid-cols-4 gap-2 px-3 py-3">
            {statCards.map(c => (
              <div key={c.label} className={`rounded-2xl ${c.bg} border ${c.border} p-2.5 text-center`}>
                <p className={`text-2xl font-black ${c.color}`}>{c.value}</p>
                <p className="text-[10px] text-slate-500 font-semibold mt-0.5 leading-tight">{c.label}</p>
              </div>
            ))}
          </div>

          {/* Two-column body */}
          <div className="flex gap-0 mx-0" style={{ minHeight: 0 }}>
            {/* Right column: tasks */}
            <div className="flex-1 border-l border-slate-100">
              <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-slate-100 sticky top-0 z-10">
                <p className="text-xs font-black text-slate-700">משימות פתוחות</p>
                <button onClick={() => openModal('task')} className="text-xs text-violet-600 font-bold">+ חדש</button>
              </div>

              {tasks.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">אין משימות פתוחות</p>
              ) : tasks.map(task => (
                <div key={task.id} className="flex items-start gap-2.5 px-3 py-2.5 border-b border-slate-50 bg-white">
                  <button
                    onClick={() => completeTask(task)}
                    className="mt-0.5 w-4 h-4 rounded border-2 border-violet-300 flex-shrink-0 flex items-center justify-center hover:bg-violet-50 transition"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-800 leading-snug">{task.title}</p>
                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                      {task.priority !== 'normal' && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${PRIORITY_COLOR[task.priority] || ''}`}>
                          {PRIORITY_LABEL[task.priority]}
                        </span>
                      )}
                      {task.assigned_to_name && (
                        <span className="text-[9px] text-slate-400">{task.assigned_to_name}</span>
                      )}
                      {task.due_date && (
                        <span className="text-[9px] text-slate-400">{formatDate(task.due_date)}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Left column: checklists */}
            <div className="flex-1">
              <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-slate-100 sticky top-0 z-10">
                <p className="text-xs font-black text-slate-700">רשימות תיוג</p>
                <button onClick={() => openModal('checklist')} className="text-xs text-violet-600 font-bold">+ חדש</button>
              </div>

              {checklists.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">אין רשימות</p>
              ) : checklists.map(cl => {
                const { filled, total, done } = checklistProgress(cl);
                const run = cl.latest_run;
                const hasMissing = run && !run.completed_at &&
                  (Array.isArray(run.items_state) ? run.items_state : []).some(i => (i.missing_qty || 0) > 0);
                return (
                  <button
                    key={cl.id}
                    onClick={() => setActiveChecklist(cl)}
                    className="w-full text-right px-3 py-2.5 border-b border-slate-50 bg-white hover:bg-violet-50 transition"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-bold text-slate-800 truncate">{cl.name}</p>
                      {hasMissing && (
                        <span className="text-[9px] font-black text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full ml-1">חוסרים</span>
                      )}
                      {done && (
                        <span className="text-[9px] text-green-600">✓</span>
                      )}
                    </div>
                    {total > 0 && (
                      <>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-0.5">
                          <div
                            className={`h-full rounded-full ${done ? 'bg-green-400' : hasMissing ? 'bg-amber-400' : 'bg-violet-400'}`}
                            style={{ width: total ? `${(filled / total) * 100}%` : '0%' }}
                          />
                        </div>
                        <p className="text-[9px] text-slate-400">{filled}/{total}</p>
                      </>
                    )}
                  </button>
                );
              })}

              {/* Maintenance quick view */}
              <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-t border-slate-100 mt-2 sticky top-0">
                <p className="text-xs font-black text-slate-700">תחזוקה</p>
                <button onClick={() => openModal('maintenance')} className="text-xs text-violet-600 font-bold">+ חדש</button>
              </div>
              <p className="text-[10px] text-slate-400 text-center py-2">
                {summary.overdueMaintenace > 0
                  ? `${summary.overdueMaintenace} משימות באיחור`
                  : 'הכל תקין'}
              </p>

              {/* Faults quick view */}
              <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-t border-slate-100 mt-1">
                <p className="text-xs font-black text-slate-700">תקלות</p>
                <button onClick={() => openModal('fault')} className="text-xs text-violet-600 font-bold">+ דווח</button>
              </div>
              <p className="text-[10px] text-slate-400 text-center py-2">
                {summary.openFaults > 0
                  ? `${summary.openFaults} תקלות פתוחות`
                  : 'אין תקלות פתוחות'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setShowFab(f => !f)}
        className="fixed bottom-24 left-4 z-50 w-13 h-13 rounded-full text-white text-2xl font-black shadow-xl flex items-center justify-center transition-transform"
        style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', width: 52, height: 52, transform: showFab ? 'rotate(45deg)' : 'none' }}
      >
        +
      </button>

      {/* FAB menu */}
      {showFab && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowFab(false)}
        >
          <div
            className="absolute bottom-40 left-4 bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-100"
            onClick={e => e.stopPropagation()}
          >
            {[
              { label: '✅ משימה חדשה',     type: 'task' },
              { label: '📋 רשימת תיוג',     type: 'checklist' },
              { label: '🔧 תחזוקה חוזרת',   type: 'maintenance' },
              { label: '⚠️ דווח על תקלה',   type: 'fault' },
            ].map(({ label, type }) => (
              <button
                key={type}
                onClick={() => openModal(type)}
                className="block w-full text-right px-5 py-3 text-sm font-bold text-slate-800 hover:bg-slate-50 transition border-b border-slate-50 last:border-0"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/40"
          dir="rtl"
          onClick={() => setModal(null)}
        >
          <div
            className="w-full bg-white rounded-t-2xl shadow-2xl p-5 pb-8 space-y-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-2" />

            {/* TASK MODAL */}
            {modal === 'task' && (
              <>
                <h3 className="font-black text-slate-800 text-base">משימה חדשה</h3>
                <input
                  autoFocus
                  placeholder="כותרת המשימה"
                  value={form.title || ''}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
                />
                <input
                  placeholder="תיאור (אופציונלי)"
                  value={form.description || ''}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
                />
                <div className="flex gap-2">
                  <select
                    value={form.assigned_to || ''}
                    onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}
                    className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
                  >
                    <option value="">הקצה לאחראי...</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
                  </select>
                  <select
                    value={form.priority || 'normal'}
                    onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                    className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
                  >
                    <option value="urgent">דחוף</option>
                    <option value="high">גבוה</option>
                    <option value="normal">רגיל</option>
                    <option value="low">נמוך</option>
                  </select>
                </div>
                <input
                  type="date"
                  value={form.due_date || ''}
                  onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
                />
              </>
            )}

            {/* CHECKLIST MODAL */}
            {modal === 'checklist' && (
              <>
                <h3 className="font-black text-slate-800 text-base">רשימת תיוג חדשה</h3>
                <input
                  autoFocus
                  placeholder="שם הרשימה (למשל: בר משקאות)"
                  value={form.name || ''}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
                />
                <div className="space-y-2 max-h-48 overflow-auto">
                  {(form.items || []).map((item, idx) => (
                    <div key={idx} className="flex gap-1.5 items-center">
                      <input
                        placeholder="פריט"
                        value={item.name || ''}
                        onChange={e => updateItem(idx, 'name', e.target.value)}
                        className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-violet-400"
                      />
                      <input
                        placeholder="יחידה"
                        value={item.unit || ''}
                        onChange={e => updateItem(idx, 'unit', e.target.value)}
                        className="w-20 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-violet-400"
                      />
                      <input
                        type="number"
                        placeholder="כמות"
                        value={item.expected_qty || ''}
                        onChange={e => updateItem(idx, 'expected_qty', e.target.value)}
                        className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:border-violet-400"
                      />
                      <button onClick={() => removeItem(idx)} className="text-red-400 font-bold text-sm px-1">✕</button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={addChecklistItem}
                  className="text-xs text-violet-600 font-bold"
                >
                  + הוסף פריט
                </button>
              </>
            )}

            {/* FAULT MODAL */}
            {modal === 'fault' && (
              <>
                <h3 className="font-black text-slate-800 text-base">דיווח תקלה</h3>
                <input
                  autoFocus
                  placeholder="תיאור התקלה"
                  value={form.title || ''}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
                />
                <textarea
                  placeholder="פרטים נוספים (אופציונלי)"
                  value={form.description || ''}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400 resize-none"
                />
                <select
                  value={form.assignee_id || ''}
                  onChange={e => setForm(f => ({ ...f, assignee_id: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
                >
                  <option value="">הקצה לאחראי לטיפול...</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
                </select>
              </>
            )}

            {/* MAINTENANCE MODAL */}
            {modal === 'maintenance' && (
              <>
                <h3 className="font-black text-slate-800 text-base">תחזוקה חוזרת</h3>
                <input
                  autoFocus
                  placeholder="שם המשימה (למשל: בדיקת גנרטור)"
                  value={form.name || ''}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
                />
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    min="1"
                    placeholder="חזרה כל..."
                    value={form.interval_days || ''}
                    onChange={e => setForm(f => ({ ...f, interval_days: e.target.value }))}
                    className="w-32 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
                  />
                  <span className="text-sm text-slate-500">ימים</span>
                </div>
                <select
                  value={form.assignee_id || ''}
                  onChange={e => setForm(f => ({ ...f, assignee_id: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
                >
                  <option value="">הקצה לאחראי (אופציונלי)</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
                </select>
              </>
            )}

            <button
              onClick={handleSubmit}
              className="w-full py-3 rounded-2xl text-white font-black text-sm shadow-md transition"
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
