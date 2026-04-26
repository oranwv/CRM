import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';
import LeadCard from '../components/LeadCard';

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

function TaskRow({ task, onComplete, onOpenLead }) {
  const overdue = !task.completed_at && isOverdue(task.due_at);
  const today   = !task.completed_at && !overdue && isToday(task.due_at);

  const dateColor = task.completed_at ? 'text-slate-400'
    : overdue ? 'text-red-600 font-bold'
    : today   ? 'text-amber-700 font-bold'
    : 'text-slate-500';

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 border-b border-slate-100 transition
        ${task.completed_at ? 'opacity-55' : 'hover:bg-violet-50/40'}
        ${overdue ? 'bg-red-50/40' : ''}`}
    >
      {/* Complete button / done indicator */}
      {task.completed_at ? (
        <span className="w-6 h-6 rounded-full bg-emerald-100 border-2 border-emerald-400
          flex items-center justify-center flex-shrink-0 text-xs text-emerald-600">✓</span>
      ) : (
        <button
          onClick={() => onComplete(task)}
          title="סמן כבוצע"
          className="w-6 h-6 rounded-full border-2 border-slate-300 hover:border-emerald-500
            hover:bg-emerald-50 transition flex items-center justify-center flex-shrink-0 group"
        >
          <span className="text-emerald-600 text-xs leading-none opacity-0 group-hover:opacity-100">✓</span>
        </button>
      )}

      {/* Title + lead name */}
      <div className="flex-1 min-w-0">
        <p className={`font-semibold text-slate-800 text-sm truncate ${task.completed_at ? 'line-through' : ''}`}>
          {task.title}
        </p>
        <button
          onClick={() => onOpenLead(task.lead_id)}
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
  const [tasks, setTasks]             = useState([]);
  const [users, setUsers]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [assignedTo, setAssignedTo]   = useState('');
  const [status, setStatus]           = useState('pending');
  const [search, setSearch]           = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [myOnly, setMyOnly]           = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [completingTask, setCompletingTask] = useState(null);
  const [resultText, setResultText]   = useState('');
  const [completing, setCompleting]   = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const searchTimer = useRef(null);

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

  async function handleConfirmComplete() {
    if (!completingTask) return;
    setCompleting(true);
    try {
      await api.patch(
        `/leads/${completingTask.lead_id}/tasks/${completingTask.id}/complete`,
        { result: resultText.trim() || null }
      );
      setCompletingTask(null);
      setResultText('');
      loadTasks();
    } catch { /* silent */ } finally {
      setCompleting(false);
    }
  }

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
        {/* Search */}
        <input
          value={search}
          onChange={e => handleSearchChange(e.target.value)}
          placeholder="חיפוש משימה או ליד..."
          className="flex-1 min-w-[140px] border border-slate-200 rounded-xl px-3 py-1.5 text-sm
            focus:outline-none focus:border-violet-400 transition"
        />

        {/* Assigned to */}
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

        {/* Status */}
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
                  <TaskRow key={t.id} task={t} onComplete={setCompletingTask} onOpenLead={setSelectedLeadId} />
                ))}
              </>
            )}

            {grouped.today.length > 0 && (
              <>
                <SectionHeader label="היום" color="amber" count={grouped.today.length} />
                {grouped.today.map(t => (
                  <TaskRow key={t.id} task={t} onComplete={setCompletingTask} onOpenLead={setSelectedLeadId} />
                ))}
              </>
            )}

            {grouped.upcoming.length > 0 && (
              <>
                <SectionHeader label="קרוב" color="violet" count={grouped.upcoming.length} />
                {grouped.upcoming.map(t => (
                  <TaskRow key={t.id} task={t} onComplete={setCompletingTask} onOpenLead={setSelectedLeadId} />
                ))}
              </>
            )}

            {grouped.noDate.length > 0 && (
              <>
                <SectionHeader label="ללא תאריך" color="slate" count={grouped.noDate.length} />
                {grouped.noDate.map(t => (
                  <TaskRow key={t.id} task={t} onComplete={setCompletingTask} onOpenLead={setSelectedLeadId} />
                ))}
              </>
            )}

            {pendingCount === 0 && grouped.completed.length === 0 && !loading && (
              <div className="text-center py-16 text-slate-400">
                <p className="text-4xl mb-2">✅</p>
                <p className="text-sm font-bold">אין משימות פתוחות</p>
              </div>
            )}

            {/* Completed toggle */}
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
                      <TaskRow key={t.id} task={t} onComplete={setCompletingTask} onOpenLead={setSelectedLeadId} />
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Complete bottom sheet */}
      {completingTask && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => { setCompletingTask(null); setResultText(''); }}>
          <div
            className="bg-white rounded-t-2xl shadow-2xl px-4 pt-4 pb-6 border-t-2 border-violet-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
            <p className="font-black text-slate-700 mb-1 text-sm">סיום משימה</p>
            <p className="text-xs text-slate-500 mb-3 truncate">{completingTask.title}</p>
            <textarea
              autoFocus
              value={resultText}
              onChange={e => setResultText(e.target.value)}
              placeholder="תוצאה / הערה (אופציונלי)..."
              rows={3}
              className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm
                focus:outline-none focus:border-violet-400 transition resize-none mb-3"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setCompletingTask(null); setResultText(''); }}
                className="flex-1 border-2 border-slate-200 text-slate-500 py-2.5 rounded-xl text-sm font-bold"
              >
                ביטול
              </button>
              <button
                onClick={handleConfirmComplete}
                disabled={completing}
                className="flex-1 text-white font-black py-2.5 rounded-xl text-sm shadow-md
                  disabled:opacity-60 transition"
                style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
              >
                {completing ? '...' : 'סמן כבוצע ✓'}
              </button>
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
