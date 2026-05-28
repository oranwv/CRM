import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';
import ChecklistDetail    from '../components/ops/ChecklistDetail';
import FaultDetail        from '../components/ops/FaultDetail';
import MaintenanceDetail  from '../components/ops/MaintenanceDetail';

const PRIORITY_LABEL = { urgent: 'דחוף', high: 'גבוה', normal: 'רגיל', low: 'נמוך' };
const PRIORITY_COLOR = { urgent: 'bg-red-100 text-red-700', high: 'bg-orange-100 text-orange-700', normal: 'bg-violet-100 text-violet-700', low: 'bg-slate-100 text-slate-500' };
const TASK_STATUS    = { open: { label: 'חדש', color: 'bg-violet-100 text-violet-700' }, in_progress: { label: 'בביצוע', color: 'bg-amber-100 text-amber-700' }, done: { label: 'הסתיים', color: 'bg-green-100 text-green-700' } };

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

function isOverdue(d) {
  if (!d) return false;
  return new Date(d) < new Date(new Date().toDateString());
}

function checklistProgress(checklist) {
  const run = checklist.latest_run;
  if (!run || run.completed_at) return { filled: 0, total: (checklist.items || []).length, done: !!run?.completed_at };
  const items = Array.isArray(run.items_state) ? run.items_state : [];
  return { filled: items.filter(i => i.actual_qty !== null).length, total: items.length, done: false };
}

export default function OperationsPage() {
  const [summary,         setSummary]         = useState({ openTasks: 0, pendingMissing: 0, overdueMaintenace: 0, openFaults: 0 });
  const [tasks,           setTasks]           = useState([]);
  const [checklists,      setChecklists]      = useState([]);
  const [maintenance,     setMaintenance]     = useState([]);
  const [faults,          setFaults]          = useState([]);
  const [users,           setUsers]           = useState([]);
  const [activeChecklist, setActiveChecklist] = useState(null);
  const [activeView,      setActiveView]      = useState(null); // 'faults' | 'maintenance'
  const [showFab,         setShowFab]         = useState(false);
  const [modal,           setModal]           = useState(null);
  const [loading,         setLoading]         = useState(true);
  const [taskSearch,      setTaskSearch]      = useState('');
  const [taskAssignee,    setTaskAssignee]    = useState('');
  const [form, setForm] = useState({});

  const tasksRef      = useRef(null);
  const checklistsRef = useRef(null);
  const maintenanceRef = useRef(null);
  const faultsRef     = useRef(null);

  const loadAll = useCallback(async () => {
    try {
      const [sRes, tRes, cRes, uRes, mRes, fRes] = await Promise.all([
        api.get('/operations/summary'),
        api.get('/operations/tasks'),
        api.get('/operations/checklists'),
        api.get('/operations/users'),
        api.get('/operations/maintenance'),
        api.get('/operations/faults'),
      ]);
      setSummary(sRes.data);
      setTasks(tRes.data);
      setChecklists(cRes.data);
      setUsers(uRes.data);
      setMaintenance(mRes.data);
      setFaults(fRes.data);
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

  async function cycleTaskStatus(task) {
    const next = task.status === 'open' ? 'in_progress' : 'done';
    try {
      await api.put(`/operations/tasks/${task.id}`, { ...task, status: next });
      if (next === 'done') {
        setTasks(prev => prev.filter(t => t.id !== task.id));
        setSummary(prev => ({ ...prev, openTasks: Math.max(0, prev.openTasks - 1) }));
      } else {
        setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: next } : t));
      }
    } catch {}
  }

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

  function scrollTo(ref) {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (activeChecklist) {
    return (
      <div className="flex flex-col h-full" dir="rtl">
        <ChecklistDetail
          checklist={activeChecklist}
          onBack={() => { setActiveChecklist(null); loadAll(); }}
          users={users}
          onSummaryRefresh={refreshSummary}
        />
      </div>
    );
  }

  if (activeView === 'faults') {
    return (
      <div className="flex flex-col h-full" dir="rtl">
        <FaultDetail onBack={() => { setActiveView(null); loadAll(); }} users={users} onRefresh={refreshSummary} />
      </div>
    );
  }

  if (activeView === 'maintenance') {
    return (
      <div className="flex flex-col h-full" dir="rtl">
        <MaintenanceDetail onBack={() => { setActiveView(null); loadAll(); }} users={users} onRefresh={refreshSummary} />
      </div>
    );
  }

  const filteredTasks = tasks.filter(t => {
    const matchSearch   = !taskSearch   || t.title.toLowerCase().includes(taskSearch.toLowerCase());
    const matchAssignee = !taskAssignee || String(t.assigned_to) === String(taskAssignee);
    return matchSearch && matchAssignee;
  });

  const statCards = [
    { label: 'משימות פתוחות',  value: summary.openTasks,         color: 'text-violet-600', bg: 'bg-violet-50',  border: 'border-violet-100', ref: tasksRef },
    { label: 'חוסרים ממתינים', value: summary.pendingMissing,    color: 'text-amber-600',  bg: 'bg-amber-50',   border: 'border-amber-100',  ref: checklistsRef },
    { label: 'תחזוקה דחופה',   value: summary.overdueMaintenace, color: 'text-red-600',    bg: 'bg-red-50',     border: 'border-red-100',    ref: maintenanceRef },
    { label: 'תקלות פתוחות',   value: summary.openFaults,        color: 'text-slate-600',  bg: 'bg-slate-50',   border: 'border-slate-200',  ref: faultsRef },
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
          {/* Stat cards — clickable */}
          <div className="grid grid-cols-4 gap-2 px-3 py-3">
            {statCards.map(c => (
              <button
                key={c.label}
                onClick={() => scrollTo(c.ref)}
                className={`rounded-2xl ${c.bg} border ${c.border} p-2.5 text-center cursor-pointer hover:scale-105 active:scale-95 transition-transform`}
              >
                <p className={`text-2xl font-black ${c.color}`}>{c.value}</p>
                <p className="text-[10px] text-slate-500 font-semibold mt-0.5 leading-tight">{c.label}</p>
              </button>
            ))}
          </div>

          {/* Two-column body */}
          <div className="flex gap-0 mx-0">
            {/* Right column: tasks */}
            <div className="flex-1 border-l border-slate-100" ref={tasksRef}>
              <div className="px-3 py-2 bg-white border-b border-slate-100 sticky top-0 z-10">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-black text-slate-700">משימות פתוחות</p>
                  <button onClick={() => openModal('task')} className="text-xs text-violet-600 font-bold cursor-pointer">+ חדש</button>
                </div>
                {/* Search + filter */}
                <input
                  type="text"
                  placeholder="חיפוש..."
                  value={taskSearch}
                  onChange={e => setTaskSearch(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs mb-1 focus:outline-none focus:border-violet-400"
                />
                <select
                  value={taskAssignee}
                  onChange={e => setTaskAssignee(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-violet-400"
                >
                  <option value="">כל האחראים</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
                </select>
              </div>

              {filteredTasks.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">אין משימות</p>
              ) : filteredTasks.map(task => {
                const ts = TASK_STATUS[task.status] || TASK_STATUS.open;
                return (
                  <div
                    key={task.id}
                    onClick={() => cycleTaskStatus(task)}
                    className="flex items-start gap-2.5 px-3 py-2.5 border-b border-slate-50 bg-white hover:bg-violet-50 active:bg-violet-100 transition cursor-pointer"
                  >
                    <span className={`mt-0.5 text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap ${ts.color}`}>{ts.label}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-slate-800 leading-snug">{task.title}</p>
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        {task.priority !== 'normal' && (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${PRIORITY_COLOR[task.priority] || ''}`}>
                            {PRIORITY_LABEL[task.priority]}
                          </span>
                        )}
                        {task.assigned_to_name && (
                          <span className="text-xs text-slate-500 font-semibold">{task.assigned_to_name}</span>
                        )}
                        {task.due_date && (
                          <span className={`text-xs font-semibold ${isOverdue(task.due_date) ? 'text-red-500' : 'text-slate-400'}`}>{formatDate(task.due_date)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Left column */}
            <div className="flex-1">
              {/* Checklists */}
              <div ref={checklistsRef} className="flex items-center justify-between px-3 py-2 bg-white border-b border-slate-100 sticky top-0 z-10">
                <p className="text-xs font-black text-slate-700">רשימות תיוג</p>
                <button onClick={() => openModal('checklist')} className="text-xs text-violet-600 font-bold cursor-pointer">+ חדש</button>
              </div>

              {checklists.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">אין רשימות</p>
              ) : checklists.map(cl => {
                const { filled, total, done } = checklistProgress(cl);
                const run = cl.latest_run;
                const hasMissing = run && !run.completed_at &&
                  (Array.isArray(run.items_state) ? run.items_state : []).some(i => (i.missing_qty || 0) > 0);
                return (
                  <button
                    key={cl.id}
                    onClick={() => setActiveChecklist(cl)}
                    className="w-full text-right px-3 py-2.5 border-b border-slate-50 bg-white hover:bg-violet-50 active:bg-violet-100 transition cursor-pointer"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-bold text-slate-800 truncate">{cl.name}</p>
                      {hasMissing && (
                        <span className="text-[9px] font-black text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full ml-1">חוסרים</span>
                      )}
                      {done && <span className="text-[9px] text-green-600 font-bold">✓</span>}
                    </div>
                    {total > 0 && (
                      <>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-0.5">
                          <div
                            className={`h-full rounded-full ${done ? 'bg-green-400' : hasMissing ? 'bg-amber-400' : 'bg-violet-400'}`}
                            style={{ width: total ? `${(filled / total) * 100}%` : '0%' }}
                          />
                        </div>
                        <p className="text-xs text-slate-400 font-semibold">{filled}/{total}</p>
                      </>
                    )}
                  </button>
                );
              })}

              {/* Maintenance */}
              <div ref={maintenanceRef} className="flex items-center justify-between px-3 py-2 bg-white border-b border-t border-slate-100 mt-2 sticky top-0 z-10">
                <button onClick={() => setActiveView('maintenance')} className="text-xs font-black text-slate-700 cursor-pointer hover:text-violet-600 transition flex items-center gap-1">
                  תחזוקה <span className="text-[10px] opacity-50">←</span>
                </button>
                <button onClick={() => openModal('maintenance')} className="text-xs text-violet-600 font-bold cursor-pointer">+ חדש</button>
              </div>

              {maintenance.filter(i => (i.status || 'open') !== 'done').length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">אין משימות תחזוקה פעילות</p>
              ) : maintenance.filter(i => (i.status || 'open') !== 'done').map(item => {
                const overdue = isOverdue(item.next_due);
                return (
                  <div
                    key={item.id}
                    onClick={() => setActiveView('maintenance')}
                    className={`flex items-center gap-2 px-3 py-2.5 border-b border-slate-50 ${overdue ? 'bg-red-50' : 'bg-white'} hover:bg-violet-50 transition cursor-pointer`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-slate-800 leading-snug">{item.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {item.next_due && (
                          <span className={`text-xs font-semibold ${overdue ? 'text-red-600' : 'text-slate-400'}`}>
                            {overdue ? 'איחור — ' : ''}{formatDate(item.next_due)}
                          </span>
                        )}
                        {item.assignee_name && (
                          <span className="text-xs text-slate-500 font-semibold">{item.assignee_name}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Faults */}
              <div ref={faultsRef} className="flex items-center justify-between px-3 py-2 bg-white border-b border-t border-slate-100 mt-2 sticky top-0 z-10">
                <button onClick={() => setActiveView('faults')} className="text-xs font-black text-slate-700 cursor-pointer hover:text-violet-600 transition flex items-center gap-1">
                  תקלות <span className="text-[10px] opacity-50">←</span>
                </button>
                <button onClick={() => openModal('fault')} className="text-xs text-violet-600 font-bold cursor-pointer">+ דווח</button>
              </div>

              {faults.filter(f => f.status !== 'resolved').length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">אין תקלות פתוחות</p>
              ) : faults.filter(f => f.status !== 'resolved').map(fault => {
                const statusMap = { open: { label: 'חדש', color: 'bg-violet-100 text-violet-700' }, in_progress: { label: 'בביצוע', color: 'bg-amber-100 text-amber-700' } };
                const s = statusMap[fault.status] || statusMap.open;
                return (
                  <div
                    key={fault.id}
                    onClick={() => setActiveView('faults')}
                    className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-50 bg-white hover:bg-red-50 active:bg-red-100 transition cursor-pointer"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-slate-800 leading-snug">{fault.title}</p>
                      {fault.assignee_name && (
                        <p className="text-xs text-slate-500 font-semibold mt-0.5">{fault.assignee_name}</p>
                      )}
                    </div>
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full whitespace-nowrap ${s.color}`}>{s.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setShowFab(f => !f)}
        className="fixed bottom-24 left-4 z-50 w-13 h-13 rounded-full text-white text-2xl font-black shadow-xl flex items-center justify-center transition-transform cursor-pointer"
        style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', width: 52, height: 52, transform: showFab ? 'rotate(45deg)' : 'none' }}
      >
        +
      </button>

      {/* FAB menu */}
      {showFab && (
        <div className="fixed inset-0 z-40" onClick={() => setShowFab(false)}>
          <div
            className="absolute bottom-40 left-4 bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-100"
            onClick={e => e.stopPropagation()}
          >
            {[
              { label: 'משימה חדשה',    type: 'task' },
              { label: 'רשימת תיוג',    type: 'checklist' },
              { label: 'תחזוקה חוזרת',  type: 'maintenance' },
              { label: 'דווח על תקלה',  type: 'fault' },
            ].map(({ label, type }) => (
              <button
                key={type}
                onClick={() => openModal(type)}
                className="block w-full text-right px-5 py-3 text-sm font-bold text-slate-800 hover:bg-slate-50 transition border-b border-slate-50 last:border-0 cursor-pointer"
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
                      <button onClick={() => removeItem(idx)} className="text-red-400 font-bold text-sm px-1 cursor-pointer">✕</button>
                    </div>
                  ))}
                </div>
                <button onClick={addChecklistItem} className="text-xs text-violet-600 font-bold cursor-pointer">+ הוסף פריט</button>
              </>
            )}

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
              className="w-full py-3 rounded-2xl text-white font-black text-sm shadow-md transition cursor-pointer"
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
