import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';
import ChecklistDetail    from '../components/ops/ChecklistDetail';
import FaultDetail        from '../components/ops/FaultDetail';
import MaintenanceDetail  from '../components/ops/MaintenanceDetail';

const PRIORITY_LABEL = { urgent: 'דחוף', high: 'גבוה', normal: 'רגיל', low: 'נמוך' };
const PRIORITY_COLOR = { urgent: 'bg-red-100 text-red-700', high: 'bg-orange-100 text-orange-700', normal: 'bg-violet-100 text-violet-700', low: 'bg-slate-100 text-slate-500' };
const TASK_STATUS    = { open: { label: 'פתוח', color: 'bg-violet-100 text-violet-700' }, in_progress: { label: 'בביצוע', color: 'bg-amber-100 text-amber-700' }, done: { label: 'הושלם', color: 'bg-green-100 text-green-700' } };
const FAULT_STATUS   = { open: { label: 'פתוח', color: 'bg-violet-100 text-violet-700' }, in_progress: { label: 'בטיפול', color: 'bg-amber-100 text-amber-700' }, resolved: { label: 'נפתר', color: 'bg-green-100 text-green-700' } };
const CATS = [
  { key: 'tasks',       label: 'משימות כלליות' },
  { key: 'maintenance', label: 'תחזוקה' },
  { key: 'faults',      label: 'תקלות' },
  { key: 'inventory',   label: 'מלאי' },
];

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

const inputCls = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400';

function fmtTs(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ── Shared: Reminders + Activity Log sections ──────────────────────────
function RemindersSection({ entityType, entityId, users }) {
  const [reminders, setReminders] = useState([]);
  const [newTitle, setNewTitle]       = useState('');
  const [newDate,  setNewDate]        = useState('');
  const [newTime,  setNewTime]        = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api.get(`/operations/reminders/${entityType}/${entityId}`)
      .then(r => setReminders(r.data)).catch(() => {});
  }, [entityType, entityId]);

  async function add() {
    if (!newTitle.trim()) return;
    setAdding(true);
    try {
      const r = await api.post(`/operations/reminders/${entityType}/${entityId}`, {
        title: newTitle, due_date: newDate || null, due_time: newTime || null, assigned_to: newAssignee || null,
      });
      setReminders(prev => [...prev, r.data]);
      setNewTitle(''); setNewDate(''); setNewTime(''); setNewAssignee('');
    } catch {} finally { setAdding(false); }
  }

  async function toggle(rem) {
    try {
      const r = await api.put(`/operations/reminders/${rem.id}`, { done: !rem.done });
      setReminders(prev => prev.map(x => x.id === rem.id ? r.data : x)
        .sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1)));
    } catch {}
  }

  async function del(id) {
    try {
      await api.delete(`/operations/reminders/${id}`);
      setReminders(prev => prev.filter(x => x.id !== id));
    } catch {}
  }

  const openCount = reminders.filter(r => !r.done).length;

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <p className="text-sm font-black text-slate-700">תזכורות</p>
        {openCount > 0 && (
          <span className="text-[10px] font-black bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full">{openCount}</span>
        )}
      </div>
      <div className="space-y-1.5 mb-3">
        {reminders.map(rem => (
          <div key={rem.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${rem.done ? 'bg-slate-50 border-slate-100 opacity-60' : 'bg-white border-slate-200'}`}>
            <button onClick={() => toggle(rem)}
              className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition cursor-pointer ${rem.done ? 'bg-violet-500 border-violet-500 text-white' : 'border-slate-300'}`}>
              {rem.done && <span className="text-[10px] leading-none">✓</span>}
            </button>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-semibold ${rem.done ? 'line-through text-slate-400' : 'text-slate-800'}`}>{rem.title}</p>
              {(rem.due_date || rem.assigned_to_name) && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  {rem.due_date && (
                    <span className={`text-[10px] font-semibold ${isOverdue(rem.due_date) && !rem.done ? 'text-red-500' : 'text-slate-400'}`}>
                      {formatDate(rem.due_date)}{rem.due_time ? ' ' + String(rem.due_time).slice(0,5) : ''}
                    </span>
                  )}
                  {rem.assigned_to_name && (
                    <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">{rem.assigned_to_name}</span>
                  )}
                </div>
              )}
            </div>
            <button onClick={() => del(rem.id)} className="text-slate-300 hover:text-red-400 transition text-xs px-1 cursor-pointer">✕</button>
          </div>
        ))}
        {reminders.length === 0 && (
          <p className="text-xs text-slate-400 text-center py-2">אין תזכורות</p>
        )}
      </div>
      <div className="flex gap-1.5">
        <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
          placeholder="הוסף תזכורת..." onKeyDown={e => e.key === 'Enter' && add()}
          className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-violet-400" />
        <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
          style={{ direction: 'ltr' }}
          className="w-28 border border-slate-200 rounded-xl px-2 py-2 text-xs focus:outline-none focus:border-violet-400" />
        <input type="time" value={newTime} onChange={e => setNewTime(e.target.value)}
          style={{ direction: 'ltr' }}
          className="w-20 border border-slate-200 rounded-xl px-2 py-2 text-xs focus:outline-none focus:border-violet-400" />
        <select value={newAssignee} onChange={e => setNewAssignee(e.target.value)}
          className="w-24 border border-slate-200 rounded-xl px-2 py-2 text-xs focus:outline-none focus:border-violet-400">
          <option value="">אחראי</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
        </select>
        <button onClick={add} disabled={adding || !newTitle.trim()}
          className="px-3 py-2 rounded-xl bg-violet-600 text-white text-xs font-black disabled:opacity-40 cursor-pointer">
          הוסף
        </button>
      </div>
    </div>
  );
}

function ActivityLogSection({ entityType, entityId, refreshTrigger }) {
  const [log, setLog]           = useState([]);
  const [note, setNote]         = useState('');
  const [adding, setAdding]     = useState(false);
  const [uploading, setUploading] = useState(false);
  const cameraRef = useRef(null);
  const fileRef   = useRef(null);

  const load = useCallback(() => {
    api.get(`/operations/activity/${entityType}/${entityId}`)
      .then(r => setLog(r.data)).catch(() => {});
  }, [entityType, entityId]);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  async function addNote() {
    if (!note.trim()) return;
    setAdding(true);
    try {
      const r = await api.post(`/operations/activity/${entityType}/${entityId}`, { body: note });
      setLog(prev => [r.data, ...prev]);
      setNote('');
    } catch {} finally { setAdding(false); }
  }

  async function uploadAttachment(file) {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post(`/operations/activity/${entityType}/${entityId}/file`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setLog(prev => [r.data, ...prev]);
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally { setUploading(false); }
  }

  function renderEntry(entry) {
    if (entry.type === 'file') {
      let meta = {};
      try { meta = JSON.parse(entry.body); } catch {}
      const displayUrl = meta.signed_url || meta.url;
      const isImage = meta.mime_type?.startsWith('image/');
      return (
        <div>
          {isImage ? (
            <a href={displayUrl} target="_blank" rel="noopener noreferrer">
              <img src={displayUrl} alt={meta.filename} className="max-h-40 rounded-lg border border-slate-200 mt-1 object-contain" />
            </a>
          ) : (
            <a href={displayUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-violet-600 font-semibold hover:underline mt-0.5">
              <span>📎</span> {meta.filename}
            </a>
          )}
        </div>
      );
    }
    return (
      <p className={`text-slate-700 ${entry.type !== 'note' ? 'italic text-slate-500' : ''}`}>{entry.body}</p>
    );
  }

  return (
    <div>
      <p className="text-sm font-black text-slate-700 mb-2">לוג פעילות</p>
      <div className="flex gap-2 mb-2">
        <textarea value={note} onChange={e => setNote(e.target.value)}
          placeholder="הוסף הערה..."
          rows={2}
          className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-violet-400 resize-none" />
        <button onClick={addNote} disabled={adding || !note.trim()}
          className="px-3 rounded-xl bg-violet-600 text-white text-xs font-black disabled:opacity-40 cursor-pointer self-stretch">
          הוסף
        </button>
      </div>
      <div className="flex gap-2 mb-3">
        <input ref={cameraRef} type="file" accept="image/*" capture="environment"
          className="hidden" onChange={e => { uploadAttachment(e.target.files[0]); e.target.value = ''; }} />
        <input ref={fileRef} type="file"
          className="hidden" onChange={e => { uploadAttachment(e.target.files[0]); e.target.value = ''; }} />
        <button onClick={() => cameraRef.current?.click()} disabled={uploading}
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 cursor-pointer">
          {uploading ? '...' : '📷 צלם'}
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 cursor-pointer">
          {uploading ? '...' : '📎 קובץ'}
        </button>
      </div>
      <div className="space-y-1.5">
        {log.length === 0 && (
          <p className="text-xs text-slate-400 text-center py-2">אין פעילות עדיין</p>
        )}
        {log.map(entry => (
          <div key={entry.id} className={`px-3 py-2 rounded-xl text-xs ${entry.type === 'note' || entry.type === 'file' ? 'bg-white border border-slate-200' : 'bg-slate-50 border border-slate-100'}`}>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-slate-400">{fmtTs(entry.created_at)}</span>
              {entry.created_by_name && <span className="font-bold text-slate-600">{entry.created_by_name}</span>}
              {entry.type !== 'note' && entry.type !== 'file' && (
                <span className="text-[9px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded-full font-bold">אוטומטי</span>
              )}
            </div>
            {renderEntry(entry)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Task Detail (full-screen) ──────────────────────────────────────────
function TaskDetailModal({ task, users, onClose, onSaved, onDeleted }) {
  const [form, setForm]         = useState({ ...task });
  const [saving, setSaving]     = useState(false);
  const [actRefresh, setActRefresh] = useState(0);

  async function save() {
    setSaving(true);
    try {
      await api.put(`/operations/tasks/${form.id}`, form);
      setActRefresh(n => n + 1);
      onSaved();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally { setSaving(false); }
  }

  async function del() {
    if (!window.confirm('למחוק משימה זו?')) return;
    try { await api.delete(`/operations/tasks/${form.id}`); onDeleted(); } catch {}
  }

  return (
    <div className="fixed inset-0 z-50 bg-white overflow-y-auto" dir="rtl">
      <div className="sticky top-0 bg-white border-b border-slate-200 flex items-center gap-3 px-4 py-3 z-10">
        <button onClick={onClose} className="text-slate-500 font-bold text-sm cursor-pointer">← חזרה</button>
        <h2 className="font-black text-slate-800 flex-1 text-sm truncate">{form.title}</h2>
        <button onClick={del} className="text-xs text-red-400 font-bold px-2 py-1 rounded-lg hover:bg-red-50 cursor-pointer">מחק</button>
      </div>

      <div className="p-4 pb-32 space-y-5">
        <div className="space-y-3">
          <input className={inputCls} placeholder="כותרת" value={form.title || ''}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />

          <textarea className={`${inputCls} resize-none`} rows={2} placeholder="תיאור (אופציונלי)" value={form.description || ''}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />

          <div className="flex gap-1.5">
            {Object.entries(TASK_STATUS).map(([s, info]) => (
              <button key={s} onClick={() => setForm(f => ({ ...f, status: s }))}
                className={`flex-1 py-2 rounded-xl text-xs font-black transition border cursor-pointer ${form.status === s ? info.color + ' border-current' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
                {info.label}
              </button>
            ))}
          </div>

          <select className={inputCls} value={form.priority || 'normal'}
            onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
            <option value="urgent">דחוף</option>
            <option value="high">גבוה</option>
            <option value="normal">רגיל</option>
            <option value="low">נמוך</option>
          </select>

          <div className="flex gap-2">
            <select className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
              value={form.assigned_to || ''} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}>
              <option value="">ללא אחראי</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
            </select>
            <input type="date" className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
              style={{ direction: 'ltr' }} value={form.due_date ? String(form.due_date).slice(0,10) : ''}
              onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
          </div>

          <textarea className={`${inputCls} resize-none`} rows={3} placeholder="תיעוד / הערות לאחר ביצוע..." value={form.notes || ''}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>

        <div className="border-t border-slate-100 pt-5">
          <RemindersSection entityType="task" entityId={task.id} users={users} />
        </div>

        <div className="border-t border-slate-100 pt-5">
          <ActivityLogSection entityType="task" entityId={task.id} refreshTrigger={actRefresh} />
        </div>
      </div>

      <div className="fixed bottom-16 left-0 right-0 px-4 pb-4 bg-white border-t border-slate-100 pt-3">
        <button onClick={save} disabled={saving}
          className="w-full py-3 rounded-2xl text-white font-black text-sm disabled:opacity-50 cursor-pointer"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
          {saving ? 'שומר...' : 'שמור'}
        </button>
      </div>
    </div>
  );
}

// ── Maintenance Detail (full-screen) ──────────────────────────────────
function MaintenanceDetailModal({ item, users, onClose, onSaved }) {
  const [form, setForm]             = useState({ assignee_id: item.assignee_id || '' });
  const [history, setHistory]       = useState([]);
  const [showComplete, setShowComplete] = useState(false);
  const [completeNotes, setCompleteNotes] = useState('');
  const [saving, setSaving]         = useState(false);
  const [actRefresh, setActRefresh] = useState(0);
  const currentUser = JSON.parse(localStorage.getItem('crm_user') || '{}');

  useEffect(() => {
    api.get(`/operations/maintenance/${item.id}`)
      .then(r => setHistory(r.data.history || []))
      .catch(() => {});
  }, [item.id]);

  async function save() {
    setSaving(true);
    try {
      await api.put(`/operations/maintenance/${item.id}`, { ...form });
      onSaved();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally { setSaving(false); }
  }

  async function markDone() {
    setSaving(true);
    try {
      await api.put(`/operations/maintenance/${item.id}/complete`, {
        notes: completeNotes, done_by: currentUser.id,
      });
      setActRefresh(n => n + 1);
      setShowComplete(false);
      setCompleteNotes('');
      onSaved();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-white overflow-y-auto" dir="rtl">
      <div className="sticky top-0 bg-white border-b border-slate-200 flex items-center gap-3 px-4 py-3 z-10">
        <button onClick={onClose} className="text-slate-500 font-bold text-sm cursor-pointer">← חזרה</button>
        <h2 className="font-black text-slate-800 flex-1 text-sm truncate">{item.name}</h2>
        {isOverdue(item.next_due) && (
          <span className="text-[10px] font-black bg-red-100 text-red-600 px-2 py-0.5 rounded-full">באיחור</span>
        )}
      </div>

      <div className="p-4 pb-32 space-y-5">
        <div className="space-y-3">
          <div className="text-xs text-slate-500 space-y-0.5 bg-slate-50 rounded-xl px-3 py-2">
            <p>מרווח: כל {item.interval_days} ימים</p>
            {item.next_due && (
              <p className={isOverdue(item.next_due) ? 'text-red-600 font-bold' : ''}>
                מועד הבא: {formatDate(item.next_due)}{isOverdue(item.next_due) ? ' — באיחור!' : ''}
              </p>
            )}
            {item.last_done && <p>בוצע לאחרונה: {formatDate(item.last_done)}</p>}
          </div>

          <select className={inputCls} value={form.assignee_id || ''}
            onChange={e => setForm(f => ({ ...f, assignee_id: e.target.value }))}>
            <option value="">ללא אחראי</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
          </select>

          {!showComplete ? (
            <button onClick={() => setShowComplete(true)}
              className="w-full py-2.5 rounded-xl bg-green-50 text-green-700 font-black text-sm border border-green-200 cursor-pointer">
              סמן כבוצע
            </button>
          ) : (
            <div className="space-y-2 border border-green-200 rounded-xl p-3 bg-green-50">
              <p className="text-xs font-bold text-green-700">הערות לביצוע (אופציונלי):</p>
              <textarea value={completeNotes} onChange={e => setCompleteNotes(e.target.value)}
                rows={2} placeholder="מה בוצע..."
                className="w-full border border-green-200 bg-white rounded-lg px-2 py-1.5 text-sm focus:outline-none resize-none" />
              <div className="flex gap-2">
                <button onClick={markDone} disabled={saving}
                  className="flex-1 py-2 rounded-xl bg-green-600 text-white font-black text-sm disabled:opacity-50 cursor-pointer">
                  {saving ? 'שומר...' : 'אשר ביצוע'}
                </button>
                <button onClick={() => setShowComplete(false)}
                  className="flex-1 py-2 rounded-xl border border-slate-200 text-slate-600 font-bold text-sm cursor-pointer">
                  ביטול
                </button>
              </div>
            </div>
          )}

          {history.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-black text-slate-500">היסטוריית ביצוע</p>
              {history.map(h => (
                <div key={h.id} className="text-xs bg-slate-50 rounded-xl px-3 py-2">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-bold text-slate-700">{formatDate(h.done_date)}</span>
                    {h.done_by_name && <span className="text-slate-500">{h.done_by_name}</span>}
                  </div>
                  {h.notes && <p className="text-slate-500">{h.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 pt-5">
          <RemindersSection entityType="maintenance" entityId={item.id} users={users} />
        </div>

        <div className="border-t border-slate-100 pt-5">
          <ActivityLogSection entityType="maintenance" entityId={item.id} refreshTrigger={actRefresh} />
        </div>
      </div>

      <div className="fixed bottom-16 left-0 right-0 px-4 pb-4 bg-white border-t border-slate-100 pt-3">
        <button onClick={save} disabled={saving}
          className="w-full py-3 rounded-2xl text-white font-black text-sm disabled:opacity-50 cursor-pointer"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
          {saving ? 'שומר...' : 'שמור שינויים'}
        </button>
      </div>
    </div>
  );
}

// ── Fault Detail (full-screen) ─────────────────────────────────────────
function FaultDetailModal({ fault, users, onClose, onSaved, onDeleted }) {
  const [form, setForm]         = useState({ ...fault });
  const [saving, setSaving]     = useState(false);
  const [actRefresh, setActRefresh] = useState(0);

  async function save() {
    setSaving(true);
    try {
      await api.put(`/operations/faults/${form.id}`, form);
      setActRefresh(n => n + 1);
      onSaved();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally { setSaving(false); }
  }

  async function del() {
    if (!window.confirm('למחוק תקלה זו?')) return;
    try { await api.delete(`/operations/faults/${form.id}`); onDeleted(); } catch {}
  }

  return (
    <div className="fixed inset-0 z-50 bg-white overflow-y-auto" dir="rtl">
      <div className="sticky top-0 bg-white border-b border-slate-200 flex items-center gap-3 px-4 py-3 z-10">
        <button onClick={onClose} className="text-slate-500 font-bold text-sm cursor-pointer">← חזרה</button>
        <h2 className="font-black text-slate-800 flex-1 text-sm truncate">{form.title}</h2>
        <button onClick={del} className="text-xs text-red-400 font-bold px-2 py-1 rounded-lg hover:bg-red-50 cursor-pointer">מחק</button>
      </div>

      <div className="p-4 pb-32 space-y-5">
        <div className="space-y-3">
          <input className={inputCls} placeholder="תיאור התקלה" value={form.title || ''}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />

          <textarea className={`${inputCls} resize-none`} rows={2} placeholder="פרטים נוספים" value={form.description || ''}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />

          <div className="flex gap-1.5">
            {Object.entries(FAULT_STATUS).map(([s, info]) => (
              <button key={s} onClick={() => setForm(f => ({ ...f, status: s }))}
                className={`flex-1 py-2 rounded-xl text-xs font-black transition border cursor-pointer ${form.status === s ? info.color + ' border-current' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
                {info.label}
              </button>
            ))}
          </div>

          <select className={inputCls} value={form.assignee_id || ''}
            onChange={e => setForm(f => ({ ...f, assignee_id: e.target.value }))}>
            <option value="">ללא אחראי</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
          </select>

          <textarea className={`${inputCls} resize-none`} rows={3} placeholder="תיעוד / הערות לאחר טיפול..." value={form.notes || ''}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />

          {form.reported_by_name && (
            <p className="text-xs text-slate-400">דווח על ידי: {form.reported_by_name}</p>
          )}
        </div>

        <div className="border-t border-slate-100 pt-5">
          <RemindersSection entityType="fault" entityId={fault.id} users={users} />
        </div>

        <div className="border-t border-slate-100 pt-5">
          <ActivityLogSection entityType="fault" entityId={fault.id} refreshTrigger={actRefresh} />
        </div>
      </div>

      <div className="fixed bottom-16 left-0 right-0 px-4 pb-4 bg-white border-t border-slate-100 pt-3">
        <button onClick={save} disabled={saving}
          className="w-full py-3 rounded-2xl text-white font-black text-sm disabled:opacity-50 cursor-pointer"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
          {saving ? 'שומר...' : 'שמור'}
        </button>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────
export default function OperationsPage() {
  const [summary,         setSummary]         = useState({ openTasks: 0, pendingMissing: 0, overdueMaintenace: 0, openFaults: 0 });
  const [tasks,           setTasks]           = useState([]);
  const [doneTasks,       setDoneTasks]       = useState([]);
  const [checklists,      setChecklists]      = useState([]);
  const [maintenance,     setMaintenance]     = useState([]);
  const [faults,          setFaults]          = useState([]);
  const [users,           setUsers]           = useState([]);
  const [activeChecklist, setActiveChecklist] = useState(null);
  const [activeView,      setActiveView]      = useState(null);
  const [showFab,         setShowFab]         = useState(false);
  const [modal,           setModal]           = useState(null);
  const [loading,         setLoading]         = useState(true);
  const [taskSearch,      setTaskSearch]      = useState('');
  const [tasksTab,        setTasksTab]        = useState('open');
  const [filterPerson,    setFilterPerson]    = useState('');
  const [filterCategories, setFilterCategories] = useState(['tasks','maintenance','faults','inventory']);
  const [taskDetail,      setTaskDetail]      = useState(null);
  const [maintDetail,     setMaintDetail]     = useState(null);
  const [faultDetail,     setFaultDetail]     = useState(null);
  const [form, setForm] = useState({});

  const tasksRef       = useRef(null);
  const checklistsRef  = useRef(null);
  const maintenanceRef = useRef(null);
  const faultsRef      = useRef(null);

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

  useEffect(() => {
    if (tasksTab === 'done') {
      api.get('/operations/tasks?done=1').then(r => setDoneTasks(r.data)).catch(() => {});
    }
  }, [tasksTab]);

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

  function openModal(type) { setForm({}); setModal(type); setShowFab(false); }

  function toggleCat(key) {
    setFilterCategories(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
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

  function addChecklistItem() {
    setForm(f => ({ ...f, items: [...(f.items || []), { name: '', unit: '', expected_qty: '' }] }));
  }
  function updateItem(idx, field, val) {
    setForm(f => { const items = [...(f.items || [])]; items[idx] = { ...items[idx], [field]: val }; return { ...f, items }; });
  }
  function removeItem(idx) {
    setForm(f => ({ ...f, items: (f.items || []).filter((_, i) => i !== idx) }));
  }

  function scrollTo(ref) { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  if (activeChecklist) {
    return (
      <div className="flex flex-col h-full" dir="rtl">
        <ChecklistDetail checklist={activeChecklist} onBack={() => { setActiveChecklist(null); loadAll(); }} users={users} onSummaryRefresh={refreshSummary} />
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

  const showTasks = filterCategories.includes('tasks');
  const showMaint = filterCategories.includes('maintenance');
  const showFaults = filterCategories.includes('faults');
  const showInv   = filterCategories.includes('inventory');

  const activeTasks = tasks.filter(t => {
    const matchSearch  = !taskSearch  || t.title.toLowerCase().includes(taskSearch.toLowerCase());
    const matchPerson  = !filterPerson || String(t.assigned_to) === String(filterPerson);
    const matchStatus  = tasksTab === 'done' || t.status === tasksTab;
    return matchSearch && matchPerson && matchStatus;
  });

  const filteredMaint = maintenance
    .filter(m => (m.status || 'open') !== 'done')
    .filter(m => !filterPerson || String(m.assignee_id) === String(filterPerson));

  const filteredFaults = faults
    .filter(f => f.status !== 'resolved')
    .filter(f => !filterPerson || String(f.assignee_id) === String(filterPerson));

  const filteredDone = doneTasks.filter(t =>
    (!taskSearch || t.title.toLowerCase().includes(taskSearch.toLowerCase())) &&
    (!filterPerson || String(t.assigned_to) === String(filterPerson))
  );

  const statCards = [
    { label: 'משימות כלליות',   value: summary.openTasks,         color: 'text-violet-600', bg: 'bg-violet-50',  border: 'border-violet-100', ref: tasksRef },
    { label: 'חוסרים ממתינים',  value: summary.pendingMissing,    color: 'text-amber-600',  bg: 'bg-amber-50',   border: 'border-amber-100',  ref: checklistsRef },
    { label: 'תחזוקה דחופה',    value: summary.overdueMaintenace, color: 'text-red-600',    bg: 'bg-red-50',     border: 'border-red-100',    ref: maintenanceRef },
    { label: 'תקלות פתוחות',    value: summary.openFaults,        color: 'text-slate-600',  bg: 'bg-slate-50',   border: 'border-slate-200',  ref: faultsRef },
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
              <button key={c.label} onClick={() => scrollTo(c.ref)}
                className={`rounded-2xl ${c.bg} border ${c.border} p-2.5 text-center cursor-pointer hover:scale-105 active:scale-95 transition-transform`}>
                <p className={`text-2xl font-black ${c.color}`}>{c.value}</p>
                <p className="text-[10px] text-slate-500 font-semibold mt-0.5 leading-tight">{c.label}</p>
              </button>
            ))}
          </div>

          {/* Filter bar */}
          <div className="px-3 pb-2 bg-white border-b border-slate-100 flex items-center gap-2 overflow-x-auto">
            <select value={filterPerson} onChange={e => setFilterPerson(e.target.value)}
              className="shrink-0 border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-violet-400">
              <option value="">כל האנשים</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
            </select>
            {CATS.map(c => (
              <button key={c.key} onClick={() => toggleCat(c.key)}
                className={`shrink-0 text-xs font-bold px-3 py-1 rounded-full border transition cursor-pointer ${
                  filterCategories.includes(c.key)
                    ? 'bg-violet-600 text-white border-violet-600'
                    : 'bg-white text-slate-500 border-slate-200'
                }`}>
                {c.label}
              </button>
            ))}
          </div>

          {/* Two-column body */}
          <div className="flex gap-0">
            {/* Right column: tasks */}
            {showTasks && (
              <div className="flex-1 border-l border-slate-100" ref={tasksRef}>
                <div className="px-3 py-2 bg-white border-b border-slate-100 sticky top-0 z-10">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-black text-slate-700">משימות כלליות</p>
                      <select
                        value={tasksTab}
                        onChange={e => setTasksTab(e.target.value)}
                        className="text-xs font-bold rounded-lg border border-slate-200 px-2 py-1 bg-white text-slate-700 cursor-pointer focus:outline-none focus:border-violet-400"
                        dir="rtl"
                      >
                        <option value="open">פתוחות</option>
                        <option value="in_progress">בתהליך</option>
                        <option value="done">הושלמו</option>
                      </select>
                    </div>
                  </div>
                  <input type="text" placeholder="חיפוש..." value={taskSearch}
                    onChange={e => setTaskSearch(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-violet-400" />
                </div>

                {tasksTab !== 'done' ? (
                  activeTasks.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-6">
                      {tasksTab === 'in_progress' ? 'אין משימות בתהליך' : 'אין משימות פתוחות'}
                    </p>
                  ) : activeTasks.map(task => {
                    const ts = TASK_STATUS[task.status] || TASK_STATUS.open;
                    return (
                      <div key={task.id} onClick={() => setTaskDetail(task)}
                        className="flex items-start gap-2.5 px-3 py-2.5 border-b border-slate-50 bg-white hover:bg-violet-50 active:bg-violet-100 transition cursor-pointer">
                        <span className={`mt-0.5 text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap ${ts.color}`}>{ts.label}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-800 leading-snug">{task.title}</p>
                          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                            {task.priority !== 'normal' && (
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${PRIORITY_COLOR[task.priority] || ''}`}>{PRIORITY_LABEL[task.priority]}</span>
                            )}
                            {task.assigned_to_name && <span className="text-xs text-slate-500 font-semibold">{task.assigned_to_name}</span>}
                            {task.due_date && (
                              <span className={`text-xs font-semibold ${isOverdue(task.due_date) ? 'text-red-500' : 'text-slate-400'}`}>{formatDate(task.due_date)}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  filteredDone.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-6">אין משימות שהושלמו</p>
                  ) : filteredDone.map(task => (
                    <div key={task.id} onClick={() => setTaskDetail(task)}
                      className="flex items-start gap-2.5 px-3 py-2.5 border-b border-slate-50 bg-white hover:bg-green-50 active:bg-green-100 transition cursor-pointer opacity-75">
                      <span className="mt-0.5 text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap bg-green-100 text-green-700">הושלם</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-600 leading-snug line-through">{task.title}</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          {task.assigned_to_name && <span className="text-xs text-slate-400">{task.assigned_to_name}</span>}
                          {task.completed_at && <span className="text-xs text-slate-400">{formatDate(task.completed_at)}</span>}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Left column */}
            <div className={showTasks ? 'flex-1' : 'w-full'}>
              {/* Inventory (checklists) */}
              {showInv && (
                <>
                  <div ref={checklistsRef} className="flex items-center justify-between px-3 py-2 bg-white border-b border-slate-100 sticky top-0 z-10">
                    <p className="text-xs font-black text-slate-700">מלאי</p>
                  </div>
                  {checklists.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4">אין רשימות</p>
                  ) : checklists.map(cl => {
                    const { filled, total, done } = checklistProgress(cl);
                    const run = cl.latest_run;
                    const hasMissing = run && !run.completed_at &&
                      (Array.isArray(run.items_state) ? run.items_state : []).some(i => (i.missing_qty || 0) > 0);
                    return (
                      <button key={cl.id} onClick={() => setActiveChecklist(cl)}
                        className="w-full text-right px-3 py-2.5 border-b border-slate-50 bg-white hover:bg-violet-50 active:bg-violet-100 transition cursor-pointer">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-bold text-slate-800 truncate">{cl.name}</p>
                          {hasMissing && <span className="text-[9px] font-black text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full ml-1">חוסרים</span>}
                          {done && <span className="text-[9px] text-green-600 font-bold">✓</span>}
                        </div>
                        {total > 0 && (
                          <>
                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-0.5">
                              <div className={`h-full rounded-full ${done ? 'bg-green-400' : hasMissing ? 'bg-amber-400' : 'bg-violet-400'}`}
                                style={{ width: total ? `${(filled / total) * 100}%` : '0%' }} />
                            </div>
                            <p className="text-xs text-slate-400 font-semibold">{filled}/{total}</p>
                          </>
                        )}
                      </button>
                    );
                  })}
                </>
              )}

              {/* Maintenance */}
              {showMaint && (
                <>
                  <div ref={maintenanceRef} className="flex items-center justify-between px-3 py-2 bg-white border-b border-t border-slate-100 mt-2 sticky top-0 z-10">
                    <button onClick={() => setActiveView('maintenance')} className="text-xs font-black text-slate-700 cursor-pointer hover:text-violet-600 transition flex items-center gap-1">
                      תחזוקה <span className="text-[10px] opacity-50">←</span>
                    </button>
                  </div>
                  {filteredMaint.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4">אין משימות תחזוקה פעילות</p>
                  ) : filteredMaint.map(item => {
                    const overdue = isOverdue(item.next_due);
                    return (
                      <div key={item.id} onClick={() => setMaintDetail(item)}
                        className={`flex items-center gap-2 px-3 py-2.5 border-b border-slate-50 ${overdue ? 'bg-red-50' : 'bg-white'} hover:bg-violet-50 transition cursor-pointer`}>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-800 leading-snug">{item.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {item.next_due && (
                              <span className={`text-xs font-semibold ${overdue ? 'text-red-600' : 'text-slate-400'}`}>
                                {overdue ? 'איחור — ' : ''}{formatDate(item.next_due)}
                              </span>
                            )}
                            {item.assignee_name && <span className="text-xs text-slate-500 font-semibold">{item.assignee_name}</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {/* Faults */}
              {showFaults && (
                <>
                  <div ref={faultsRef} className="flex items-center justify-between px-3 py-2 bg-white border-b border-t border-slate-100 mt-2 sticky top-0 z-10">
                    <button onClick={() => setActiveView('faults')} className="text-xs font-black text-slate-700 cursor-pointer hover:text-violet-600 transition flex items-center gap-1">
                      תקלות <span className="text-[10px] opacity-50">←</span>
                    </button>
                  </div>
                  {filteredFaults.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4">אין תקלות פתוחות</p>
                  ) : filteredFaults.map(fault => {
                    const s = FAULT_STATUS[fault.status] || FAULT_STATUS.open;
                    return (
                      <div key={fault.id} onClick={() => setFaultDetail(fault)}
                        className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-50 bg-white hover:bg-red-50 active:bg-red-100 transition cursor-pointer">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-800 leading-snug">{fault.title}</p>
                          {fault.assignee_name && <p className="text-xs text-slate-500 font-semibold mt-0.5">{fault.assignee_name}</p>}
                        </div>
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full whitespace-nowrap ${s.color}`}>{s.label}</span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* FAB */}
      <button onClick={() => setShowFab(f => !f)}
        className="fixed bottom-24 left-4 z-50 rounded-full text-white text-2xl font-black shadow-xl flex items-center justify-center transition-transform cursor-pointer"
        style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', width: 52, height: 52, transform: showFab ? 'rotate(45deg)' : 'none' }}>
        +
      </button>

      {showFab && (
        <div className="fixed inset-0 z-40" onClick={() => setShowFab(false)}>
          <div className="absolute bottom-40 left-4 bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-100" onClick={e => e.stopPropagation()}>
            {[
              { label: 'משימה חדשה',    type: 'task' },
              { label: 'רשימת מלאי חדשה', type: 'checklist' },
              { label: 'תחזוקה חוזרת',  type: 'maintenance' },
              { label: 'דווח על תקלה',  type: 'fault' },
            ].map(({ label, type }) => (
              <button key={type} onClick={() => openModal(type)}
                className="block w-full text-right px-5 py-3 text-sm font-bold text-slate-800 hover:bg-slate-50 transition border-b border-slate-50 last:border-0 cursor-pointer">
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Creation modals */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" dir="rtl" onClick={() => setModal(null)}>
          <div className="w-full bg-white rounded-t-2xl shadow-2xl p-5 pb-8 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-2" />

            {modal === 'task' && (
              <>
                <h3 className="font-black text-slate-800 text-base">משימה חדשה</h3>
                <input autoFocus placeholder="כותרת המשימה" value={form.title || ''}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={inputCls} />
                <input placeholder="תיאור (אופציונלי)" value={form.description || ''}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className={inputCls} />
                <div className="flex gap-2">
                  <select value={form.assigned_to || ''} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}
                    className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400">
                    <option value="">הקצה לאחראי...</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
                  </select>
                  <select value={form.priority || 'normal'} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                    className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400">
                    <option value="urgent">דחוף</option>
                    <option value="high">גבוה</option>
                    <option value="normal">רגיל</option>
                    <option value="low">נמוך</option>
                  </select>
                </div>
                <input type="date" value={form.due_date || ''} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} className={inputCls} />
              </>
            )}

            {modal === 'checklist' && (
              <>
                <h3 className="font-black text-slate-800 text-base">רשימת מלאי חדשה</h3>
                <input autoFocus placeholder="שם הרשימה (למשל: בר משקאות)" value={form.name || ''}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} />
                <div className="space-y-2 max-h-48 overflow-auto">
                  {(form.items || []).map((item, idx) => (
                    <div key={idx} className="flex gap-1.5 items-center">
                      <input placeholder="פריט" value={item.name || ''} onChange={e => updateItem(idx, 'name', e.target.value)}
                        className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-violet-400" />
                      <input placeholder="יחידה" value={item.unit || ''} onChange={e => updateItem(idx, 'unit', e.target.value)}
                        className="w-20 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-violet-400" />
                      <input type="number" placeholder="כמות" value={item.expected_qty || ''} onChange={e => updateItem(idx, 'expected_qty', e.target.value)}
                        className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:border-violet-400" />
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
                <input autoFocus placeholder="תיאור התקלה" value={form.title || ''}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={inputCls} />
                <textarea placeholder="פרטים נוספים (אופציונלי)" value={form.description || ''}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={3} className={`${inputCls} resize-none`} />
                <select value={form.assignee_id || ''} onChange={e => setForm(f => ({ ...f, assignee_id: e.target.value }))} className={inputCls}>
                  <option value="">הקצה לאחראי לטיפול...</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
                </select>
              </>
            )}

            {modal === 'maintenance' && (
              <>
                <h3 className="font-black text-slate-800 text-base">תחזוקה חוזרת</h3>
                <input autoFocus placeholder="שם המשימה (למשל: בדיקת גנרטור)" value={form.name || ''}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} />
                <div className="flex gap-2 items-center">
                  <input type="number" min="1" placeholder="חזרה כל..." value={form.interval_days || ''}
                    onChange={e => setForm(f => ({ ...f, interval_days: e.target.value }))}
                    className="w-32 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400" />
                  <span className="text-sm text-slate-500">ימים</span>
                </div>
                <select value={form.assignee_id || ''} onChange={e => setForm(f => ({ ...f, assignee_id: e.target.value }))} className={inputCls}>
                  <option value="">הקצה לאחראי (אופציונלי)</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
                </select>
              </>
            )}

            <button onClick={handleSubmit}
              className="w-full py-3 rounded-2xl text-white font-black text-sm shadow-md transition cursor-pointer"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
              שמור
            </button>
          </div>
        </div>
      )}

      {/* Detail views (full-screen) */}
      {taskDetail && (
        <TaskDetailModal
          task={taskDetail}
          users={users}
          onClose={() => { setTaskDetail(null); loadAll(); if (tasksTab === 'done') api.get('/operations/tasks?done=1').then(r => setDoneTasks(r.data)).catch(() => {}); }}
          onSaved={() => { loadAll(); if (tasksTab === 'done') api.get('/operations/tasks?done=1').then(r => setDoneTasks(r.data)).catch(() => {}); }}
          onDeleted={() => { setTaskDetail(null); loadAll(); }}
        />
      )}

      {maintDetail && (
        <MaintenanceDetailModal
          item={maintDetail}
          users={users}
          onClose={() => { setMaintDetail(null); loadAll(); }}
          onSaved={() => { loadAll(); }}
        />
      )}

      {faultDetail && (
        <FaultDetailModal
          fault={faultDetail}
          users={users}
          onClose={() => { setFaultDetail(null); loadAll(); }}
          onSaved={() => { loadAll(); }}
          onDeleted={() => { setFaultDetail(null); loadAll(); }}
        />
      )}
    </div>
  );
}
