import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';
import LeadCard from '../components/LeadCard';

const POSTPONE_PRESETS = [
  { label: '15 דקות', minutes: 15 },
  { label: '30 דקות', minutes: 30 },
  { label: 'שעה',     minutes: 60 },
  { label: 'יום שלם', minutes: 1440 },
];

function getMe() {
  try {
    const token = localStorage.getItem('crm_token');
    return JSON.parse(atob(token.split('.')[1]));
  } catch { return {}; }
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function isOverdue(due_at) {
  return due_at && new Date(due_at) < new Date();
}

function isToday(due_at) {
  if (!due_at) return false;
  const d = new Date(due_at).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });
  const now = new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });
  return d === now;
}

function SectionHeader({ label, color, count }) {
  const styles = {
    red:    'bg-red-50 text-red-700 border-red-200',
    amber:  'bg-amber-50 text-amber-800 border-amber-200',
    violet: 'bg-violet-50 text-violet-700 border-violet-200',
    slate:  'bg-slate-50 text-slate-500 border-slate-200',
    gray:   'bg-slate-100 text-slate-400 border-slate-200',
  };
  return (
    <div className={`px-4 py-1.5 text-xs font-black uppercase tracking-wider border-b ${styles[color]}`}>
      {label} <span className="font-normal opacity-60">({count})</span>
    </div>
  );
}

function ActionCard({ icon, title, open, onToggle, color, children }) {
  const borders = { green: 'border-green-200', violet: 'border-violet-200', blue: 'border-blue-200' };
  const headers = { green: 'text-green-700',  violet: 'text-violet-700',  blue: 'text-blue-700'  };
  return (
    <div className={`bg-slate-50 rounded-2xl border-2 ${open ? borders[color] : 'border-transparent'} overflow-hidden`}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3.5 text-right">
        <span className="text-xl">{icon}</span>
        <span className={`font-black text-base flex-1 ${open ? headers[color] : 'text-slate-700'}`}>{title}</span>
        <span className="text-slate-400 text-sm">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function ActionBtn({ onClick, saving, color, disabled, children }) {
  const colors = {
    green:  'bg-green-600 hover:bg-green-700',
    violet: 'bg-violet-600 hover:bg-violet-700',
    blue:   'bg-blue-600  hover:bg-blue-700',
  };
  return (
    <button
      onClick={onClick}
      disabled={saving || disabled}
      className={`w-full py-3 rounded-xl font-black text-white transition ${colors[color]} disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {saving ? 'שומר...' : children}
    </button>
  );
}

function TaskRow({ task, onAction, onOpenLead }) {
  const overdue = !task.completed_at && isOverdue(task.due_at);
  const today   = !task.completed_at && !overdue && isToday(task.due_at);

  const dateColor = task.completed_at ? 'text-slate-400'
    : overdue ? 'text-red-600 font-bold'
    : today   ? 'text-amber-700 font-bold'
    : 'text-slate-500';

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 border-b border-slate-100 transition
        ${task.completed_at ? 'opacity-55' : 'hover:bg-violet-50/40 cursor-pointer'}
        ${overdue ? 'bg-red-50/40' : ''}`}
      onClick={() => !task.completed_at && onAction(task)}
    >
      {/* Done indicator / tap hint */}
      {task.completed_at ? (
        <span className="w-6 h-6 rounded-full bg-emerald-100 border-2 border-emerald-400
          flex items-center justify-center flex-shrink-0 text-xs text-emerald-600">✓</span>
      ) : (
        <span className="w-6 h-6 rounded-full border-2 border-slate-300 flex-shrink-0" />
      )}

      {/* Title + lead name */}
      <div className="flex-1 min-w-0">
        <p className={`font-semibold text-slate-800 text-sm truncate ${task.completed_at ? 'line-through' : ''}`}>
          {task.title}
        </p>
        <button
          onClick={e => { e.stopPropagation(); onOpenLead(task.lead_id); }}
          className="text-xs text-violet-600 hover:underline font-medium"
        >
          {task.lead_name}
        </button>
        {task.completed_at && task.result && (
          <p className="text-xs text-slate-400 truncate mt-0.5">💬 {task.result}</p>
        )}
      </div>

      {/* Due date */}
      {task.due_at && (
        <span className={`text-xs whitespace-nowrap flex-shrink-0 ${dateColor}`}>
          {formatDate(task.due_at)}
        </span>
      )}

      {/* Assigned badge */}
      {task.assigned_name && (
        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full
          font-medium flex-shrink-0 max-w-[70px] truncate">
          {task.assigned_name}
        </span>
      )}
    </div>
  );
}

export default function TasksPage() {
  const me = getMe();

  // List state
  const [tasks, setTasks]                     = useState([]);
  const [users, setUsers]                     = useState([]);
  const [loading, setLoading]                 = useState(true);
  const [assignedTo, setAssignedTo]           = useState('');
  const [status, setStatus]                   = useState('pending');
  const [search, setSearch]                   = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [myOnly, setMyOnly]                   = useState(false);
  const [showCompleted, setShowCompleted]     = useState(false);
  const [selectedLeadId, setSelectedLeadId]   = useState(null);
  const searchTimer = useRef(null);

  // Action sheet state
  const [activeTask, setActiveTask]           = useState(null); // task being acted on
  const [activeCard, setActiveCard]           = useState(null); // 'complete' | 'postpone' | 'followup'
  const [saving, setSaving]                   = useState(false);
  // complete
  const [result, setResult]                   = useState('');
  // postpone
  const [postponeSelected, setPostponeSelected] = useState(null);
  const [customDate, setCustomDate]           = useState('');
  // follow-up
  const [followTitle, setFollowTitle]         = useState('');
  const [followDate, setFollowDate]           = useState('');

  useEffect(() => {
    api.get('/tasks/users').then(r => setUsers(r.data)).catch(() => {});
  }, []);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      const uid = myOnly ? me.id : assignedTo;
      if (uid) params.set('assigned_to', uid);
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
      const { data } = await api.get(`/tasks?${params}`);
      setTasks(data);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [status, assignedTo, myOnly, debouncedSearch, me.id]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  function handleSearchChange(val) {
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(val), 300);
  }

  function openActionSheet(task) {
    setActiveTask(task);
    setActiveCard(null);
    setResult('');
    setPostponeSelected(null);
    setCustomDate('');
    setFollowTitle('');
    setFollowDate('');
  }

  function dismissSheet() {
    setActiveTask(null);
    setActiveCard(null);
  }

  function toggleCard(name) {
    setActiveCard(prev => prev === name ? null : name);
  }

  async function handleComplete() {
    setSaving(true);
    try {
      await api.patch(
        `/leads/${activeTask.lead_id}/tasks/${activeTask.id}/complete`,
        { result: result.trim() || null }
      );
      dismissSheet();
      loadTasks();
    } catch { /* silent */ } finally {
      setSaving(false);
    }
  }

  async function handlePostpone() {
    if (!postponeSelected) return;
    let due_at;
    if (postponeSelected === 'custom') {
      due_at = new Date(customDate).toISOString();
    } else {
      due_at = new Date(Date.now() + postponeSelected * 60 * 1000).toISOString();
    }
    setSaving(true);
    try {
      await api.patch(
        `/leads/${activeTask.lead_id}/tasks/${activeTask.id}/reschedule`,
        { due_at }
      );
      dismissSheet();
      loadTasks();
    } catch { /* silent */ } finally {
      setSaving(false);
    }
  }

  async function handleFollowup() {
    if (!followTitle.trim()) return;
    setSaving(true);
    try {
      await api.post(`/leads/${activeTask.lead_id}/tasks`, {
        title:      followTitle.trim(),
        due_at:     followDate ? new Date(followDate).toISOString() : null,
        assigned_to: activeTask.assigned_to,
        remind_via:  activeTask.remind_via,
      });
      dismissSheet();
      loadTasks();
    } catch { /* silent */ } finally {
      setSaving(false);
    }
  }

  // Group tasks by sort_bucket (already sorted by server)
  const grouped = tasks.reduce((acc, t) => {
    const b = t.sort_bucket;
    if (b === 1) acc.overdue.push(t);
    else if (b === 2) acc.today.push(t);
    else if (b === 3) acc.upcoming.push(t);
    else if (b === 4) acc.noDate.push(t);
    else acc.completed.push(t);
    return acc;
  }, { overdue: [], today: [], upcoming: [], noDate: [], completed: [] });

  const pendingCount = grouped.overdue.length + grouped.today.length + grouped.upcoming.length + grouped.noDate.length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 to-indigo-50" dir="rtl">
      {/* Header */}
      <div className="sticky top-0 z-20 px-4 pt-4 pb-3 shadow-md"
        style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
        <div className="flex items-center justify-between">
          <h1 className="text-white font-black text-xl tracking-tight">משימות</h1>
          {pendingCount > 0 && (
            <span className="bg-white/20 text-white text-xs font-bold px-2.5 py-1 rounded-full">
              {pendingCount} פתוחות
            </span>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="sticky top-[60px] z-10 bg-white border-b border-slate-200 px-3 py-2.5 shadow-sm flex flex-wrap gap-2 items-center">
        <input
          value={search}
          onChange={e => handleSearchChange(e.target.value)}
          placeholder="חיפוש משימה או ליד..."
          className="flex-1 min-w-[140px] border border-slate-200 rounded-xl px-3 py-1.5 text-sm
            focus:outline-none focus:border-violet-400 transition"
        />
        <select
          value={myOnly ? '__me__' : assignedTo}
          onChange={e => {
            if (e.target.value === '__me__') { setMyOnly(true); setAssignedTo(''); }
            else { setMyOnly(false); setAssignedTo(e.target.value); }
          }}
          className="border border-slate-200 rounded-xl px-2 py-1.5 text-sm focus:outline-none focus:border-violet-400 bg-white"
        >
          <option value="">כולם</option>
          <option value="__me__">שלי</option>
          {users.filter(u => u.display_name).map(u => (
            <option key={u.id} value={u.id}>{u.display_name}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="border border-slate-200 rounded-xl px-2 py-1.5 text-sm focus:outline-none focus:border-violet-400 bg-white"
        >
          <option value="pending">ממתינות</option>
          <option value="overdue">באיחור</option>
          <option value="">הכל</option>
        </select>
      </div>

      {/* Task list */}
      <div className="max-w-2xl mx-auto">
        {loading ? (
          <div className="text-center py-16 text-slate-400">
            <p className="text-3xl mb-2 animate-pulse">⏳</p>
            <p className="text-sm">טוען משימות...</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-violet-100 mt-3 mx-3 overflow-hidden">

            {grouped.overdue.length > 0 && (
              <>
                <SectionHeader label="באיחור" color="red" count={grouped.overdue.length} />
                {grouped.overdue.map(t => (
                  <TaskRow key={t.id} task={t} onAction={openActionSheet} onOpenLead={setSelectedLeadId} />
                ))}
              </>
            )}

            {grouped.today.length > 0 && (
              <>
                <SectionHeader label="היום" color="amber" count={grouped.today.length} />
                {grouped.today.map(t => (
                  <TaskRow key={t.id} task={t} onAction={openActionSheet} onOpenLead={setSelectedLeadId} />
                ))}
              </>
            )}

            {grouped.upcoming.length > 0 && (
              <>
                <SectionHeader label="קרוב" color="violet" count={grouped.upcoming.length} />
                {grouped.upcoming.map(t => (
                  <TaskRow key={t.id} task={t} onAction={openActionSheet} onOpenLead={setSelectedLeadId} />
                ))}
              </>
            )}

            {grouped.noDate.length > 0 && (
              <>
                <SectionHeader label="ללא תאריך" color="slate" count={grouped.noDate.length} />
                {grouped.noDate.map(t => (
                  <TaskRow key={t.id} task={t} onAction={openActionSheet} onOpenLead={setSelectedLeadId} />
                ))}
              </>
            )}

            {pendingCount === 0 && grouped.completed.length === 0 && (
              <div className="text-center py-16 text-slate-400">
                <p className="text-4xl mb-2">✅</p>
                <p className="text-sm font-bold">אין משימות פתוחות</p>
              </div>
            )}

            {grouped.completed.length > 0 && (
              <>
                <button
                  onClick={() => setShowCompleted(v => !v)}
                  className="w-full flex items-center justify-center gap-2 py-3 text-xs font-bold
                    text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition border-t border-slate-100"
                >
                  {showCompleted ? '▲' : '▼'}
                  {showCompleted ? 'הסתר הושלמות' : `הצג הושלמות (${grouped.completed.length})`}
                </button>
                {showCompleted && (
                  <>
                    <SectionHeader label="הושלמו" color="gray" count={grouped.completed.length} />
                    {grouped.completed.map(t => (
                      <TaskRow key={t.id} task={t} onAction={openActionSheet} onOpenLead={setSelectedLeadId} />
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Action bottom sheet */}
      {activeTask && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={dismissSheet}>
          <div
            className="bg-white rounded-t-3xl shadow-2xl px-4 pt-3 pb-8 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />

            {/* Task header */}
            <div className="mb-4 text-center">
              <p className="font-black text-slate-800 text-base truncate">{activeTask.title}</p>
              <p className="text-sm text-slate-500 mt-0.5">
                {activeTask.lead_name}
                {activeTask.due_at && (
                  <span className={`mr-2 ${isOverdue(activeTask.due_at) ? 'text-red-500 font-bold' : ''}`}>
                    • {formatDate(activeTask.due_at)}
                  </span>
                )}
              </p>
            </div>

            <div className="space-y-2">
              {/* Card 1 — Complete */}
              <ActionCard
                icon="✅" title="סמן כהושלם + הוסף תוצאה"
                open={activeCard === 'complete'}
                onToggle={() => toggleCard('complete')}
                color="green"
              >
                <textarea
                  autoFocus
                  value={result}
                  onChange={e => setResult(e.target.value)}
                  placeholder="הוסף תוצאה (אופציונלי)..."
                  rows={3}
                  className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-slate-700 text-sm resize-none focus:outline-none focus:border-green-400 mb-3"
                />
                <ActionBtn onClick={handleComplete} saving={saving} color="green">
                  סמן כהושלם
                </ActionBtn>
              </ActionCard>

              {/* Card 2 — Reschedule */}
              <ActionCard
                icon="🔁" title="קבע מחדש (לא ענה)"
                open={activeCard === 'postpone'}
                onToggle={() => toggleCard('postpone')}
                color="violet"
              >
                <div className="space-y-2 mb-3">
                  {POSTPONE_PRESETS.map(p => (
                    <button key={p.minutes} onClick={() => setPostponeSelected(p.minutes)}
                      className={`w-full py-2.5 rounded-xl font-bold text-sm border-2 transition ${
                        postponeSelected === p.minutes
                          ? 'border-violet-500 bg-violet-50 text-violet-700'
                          : 'border-slate-200 bg-white text-slate-700'
                      }`}>
                      {p.label}
                    </button>
                  ))}
                  <button onClick={() => setPostponeSelected('custom')}
                    className={`w-full py-2.5 rounded-xl font-bold text-sm border-2 transition ${
                      postponeSelected === 'custom'
                        ? 'border-violet-500 bg-violet-50 text-violet-700'
                        : 'border-slate-200 bg-white text-slate-700'
                    }`}>
                    זמן מותאם ✏️
                  </button>
                </div>
                {postponeSelected === 'custom' && (
                  <input
                    type="datetime-local"
                    value={customDate}
                    onChange={e => setCustomDate(e.target.value)}
                    className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-slate-700 text-sm focus:outline-none focus:border-violet-400 mb-3"
                  />
                )}
                <ActionBtn
                  onClick={handlePostpone} saving={saving} color="violet"
                  disabled={!postponeSelected || (postponeSelected === 'custom' && !customDate)}
                >
                  קבע מחדש
                </ActionBtn>
              </ActionCard>

              {/* Card 3 — Follow-up */}
              <ActionCard
                icon="➕" title="צור משימת המשך"
                open={activeCard === 'followup'}
                onToggle={() => toggleCard('followup')}
                color="blue"
              >
                <input
                  type="text"
                  value={followTitle}
                  onChange={e => setFollowTitle(e.target.value)}
                  placeholder="כותרת המשימה..."
                  className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-slate-700 text-sm focus:outline-none focus:border-blue-400 mb-2"
                />
                <input
                  type="datetime-local"
                  value={followDate}
                  onChange={e => setFollowDate(e.target.value)}
                  className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-slate-700 text-sm focus:outline-none focus:border-blue-400 mb-3"
                />
                <ActionBtn
                  onClick={handleFollowup} saving={saving} color="blue"
                  disabled={!followTitle.trim()}
                >
                  צור משימה
                </ActionBtn>
              </ActionCard>
            </div>
          </div>
        </div>
      )}

      {/* LeadCard overlay */}
      {selectedLeadId && (
        <LeadCard
          leadId={selectedLeadId}
          onClose={() => { setSelectedLeadId(null); loadTasks(); }}
          onUpdated={loadTasks}
        />
      )}
    </div>
  );
}
