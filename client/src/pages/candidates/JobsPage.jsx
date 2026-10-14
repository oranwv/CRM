// מועמדים → משרות: the entry screen of the candidates mode (managers only). One card per job with
// per-status counts; click → that job's candidates (CandidateListPage). Phase 44 (Oran, 14.10.2026).
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import api from '../../api';

const CARD_COLORS = [
  { bar: 'bg-violet-500',  light: 'bg-violet-50',  border: 'border-violet-200',  hover: 'hover:border-violet-400' },
  { bar: 'bg-pink-500',    light: 'bg-pink-50',    border: 'border-pink-200',    hover: 'hover:border-pink-400' },
  { bar: 'bg-indigo-500',  light: 'bg-indigo-50',  border: 'border-indigo-200',  hover: 'hover:border-indigo-400' },
  { bar: 'bg-emerald-500', light: 'bg-emerald-50', border: 'border-emerald-200', hover: 'hover:border-emerald-400' },
  { bar: 'bg-amber-500',   light: 'bg-amber-50',   border: 'border-amber-200',   hover: 'hover:border-amber-400' },
  { bar: 'bg-sky-500',     light: 'bg-sky-50',     border: 'border-sky-200',     hover: 'hover:border-sky-400' },
];

export default function JobsPage() {
  const navigate = useNavigate();
  const [jobs, setJobs]           = useState([]);
  const [unassigned, setUnassigned] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [showAdd, setShowAdd]     = useState(false);
  const [newTitle, setNewTitle]   = useState('');
  const [saving, setSaving]       = useState(false);
  const [editing, setEditing]     = useState(null); // { id, title }
  const [loading, setLoading]     = useState(true);

  const load = useCallback(() => {
    Promise.all([
      api.get(`/candidates/jobs${showArchived ? '?archived=1' : ''}`),
      api.get('/candidates/jobs/unassigned-count'),
    ]).then(([j, u]) => { setJobs(j.data); setUnassigned(u.data.count || 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [showArchived]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      const { data } = await api.post('/candidates/jobs', { title: newTitle.trim() });
      setNewTitle('');
      setShowAdd(false);
      navigate(`/candidates/jobs/${data.id}`);
    } finally { setSaving(false); }
  }

  async function handleRename(e) {
    e.preventDefault();
    if (!editing?.title.trim()) return;
    await api.patch(`/candidates/jobs/${editing.id}`, { title: editing.title.trim() });
    setEditing(null);
    load();
  }

  async function handleArchive(job, e) {
    e.stopPropagation();
    const archive = !job.archived_at;
    if (archive && !confirm(`להעביר את "${job.title}" לארכיון? המועמדים נשמרים.`)) return;
    await api.patch(`/candidates/jobs/${job.id}`, { archived: archive });
    load();
  }

  async function handleDelete(job, e) {
    e.stopPropagation();
    if (!confirm(`למחוק את המשרה "${job.title}" לצמיתות? המועמדים לא יימחקו (יישארו ללא משרה).`)) return;
    await api.delete(`/candidates/jobs/${job.id}`);
    load();
  }

  const active   = jobs.filter(j => !j.archived_at);
  const archived = jobs.filter(j => j.archived_at);

  return (
    <div className="min-h-screen px-4 sm:px-6 pt-4" dir="rtl">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">💼</span>
          <h1 className="text-xl font-black text-slate-800">משרות</h1>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="text-sm bg-gradient-to-r from-violet-600 to-indigo-500 hover:from-violet-700 hover:to-indigo-600 text-white px-4 py-2 rounded-xl transition font-bold flex items-center gap-1.5 shadow-md shadow-violet-200"
        >
          <span className="text-lg leading-none">+</span> משרה חדשה
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleCreate} className="bg-white border-2 border-violet-200 rounded-2xl p-4 mb-4 flex gap-2 shadow-md shadow-violet-100">
          <input
            autoFocus
            type="text"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="שם המשרה, למשל: אנשי מכירות"
            className="flex-1 min-w-0 border-2 border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400 transition"
          />
          <button type="submit" disabled={saving} className="bg-gradient-to-r from-violet-600 to-indigo-500 text-white text-sm font-bold px-4 py-2 rounded-xl transition disabled:opacity-60">
            {saving ? 'שומר...' : 'צור'}
          </button>
          <button type="button" onClick={() => { setShowAdd(false); setNewTitle(''); }} className="text-sm text-slate-400 hover:text-slate-600 px-2 py-2 rounded-xl transition">ביטול</button>
        </form>
      )}

      {loading ? (
        <div className="text-center py-16 text-slate-400 text-sm">טוען...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {active.map((job, i) => (
              <JobCard
                key={job.id}
                job={job}
                color={CARD_COLORS[i % CARD_COLORS.length]}
                editing={editing?.id === job.id ? editing : null}
                onEditChange={title => setEditing({ id: job.id, title })}
                onEditSubmit={handleRename}
                onEditCancel={() => setEditing(null)}
                onStartEdit={e => { e.stopPropagation(); setEditing({ id: job.id, title: job.title }); }}
                onArchive={e => handleArchive(job, e)}
                onOpen={() => navigate(`/candidates/jobs/${job.id}`)}
              />
            ))}

            {unassigned > 0 && (
              <div
                onClick={() => navigate('/candidates/unassigned')}
                className="bg-white border-2 border-dashed border-amber-300 hover:border-amber-400 hover:shadow-lg rounded-2xl p-5 cursor-pointer transition-all hover:-translate-y-0.5"
              >
                <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-amber-50 text-2xl mb-3">❓</div>
                <h3 className="font-bold text-slate-700">ללא משרה</h3>
                <p className="text-sm text-amber-700 mt-1">{unassigned} מועמד/ים לשיוך</p>
              </div>
            )}
          </div>

          {active.length === 0 && !showAdd && (
            <div className="text-center mt-16">
              <p className="text-5xl mb-3">✨</p>
              <p className="text-slate-400 text-sm">אין משרות פתוחות. צור משרה חדשה להתחלה.</p>
            </div>
          )}

          <div className="mt-8">
            <button onClick={() => setShowArchived(v => !v)} className="text-xs font-bold text-slate-400 hover:text-slate-600 transition">
              {showArchived ? '▾ הסתר ארכיון' : '▸ הצג משרות בארכיון'}
            </button>
            {showArchived && (
              archived.length === 0 ? (
                <p className="text-xs text-slate-400 mt-2">אין משרות בארכיון.</p>
              ) : (
                <ul className="mt-2 bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
                  {archived.map(job => (
                    <li key={job.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <button onClick={() => navigate(`/candidates/jobs/${job.id}`)} className="font-semibold text-slate-600 hover:text-violet-700 text-right">
                        {job.title} <span className="text-slate-400 font-normal">· {job.candidate_count} מועמד/ים · הועבר לארכיון {format(new Date(job.archived_at), 'dd/MM/yyyy')}</span>
                      </button>
                      <div className="flex gap-3 shrink-0">
                        <button onClick={e => handleArchive(job, e)} className="text-xs text-violet-600 hover:underline font-semibold">שחזר</button>
                        <button onClick={e => handleDelete(job, e)} className="text-xs text-slate-400 hover:text-red-500">מחק</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Count({ n, label, cls }) {
  if (!n) return null;
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cls}`}>{n} {label}</span>;
}

function JobCard({ job, color, editing, onEditChange, onEditSubmit, onEditCancel, onStartEdit, onArchive, onOpen }) {
  return (
    <div
      onClick={editing ? undefined : onOpen}
      className={`relative bg-white border-2 ${color.border} ${color.hover} hover:shadow-lg rounded-2xl p-5 transition-all overflow-hidden ${editing ? '' : 'cursor-pointer hover:-translate-y-0.5'}`}
    >
      <span className={`absolute top-0 right-0 left-0 h-1 ${color.bar}`} />

      {editing ? (
        <form onSubmit={onEditSubmit} onClick={e => e.stopPropagation()} className="flex gap-2 mb-3">
          <input
            autoFocus
            value={editing.title}
            onChange={e => onEditChange(e.target.value)}
            className="flex-1 min-w-0 border-2 border-slate-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-violet-400"
          />
          <button type="submit" className="text-xs font-bold text-white bg-violet-600 px-3 rounded-xl">שמור</button>
          <button type="button" onClick={onEditCancel} className="text-xs text-slate-400 px-1">ביטול</button>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-xl ${color.light} text-2xl`}>💼</div>
            <div className="min-w-0">
              <h3 className="font-bold text-slate-800 truncate">{job.title}</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {job.active_count} פעילים
                {job.last_arrival ? ` · אחרון ${format(new Date(job.last_arrival), 'dd/MM')}` : ''}
              </p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0 text-slate-300">
            <button onClick={onStartEdit} className="hover:text-violet-500 transition text-sm" title="שנה שם">✏️</button>
            <button onClick={onArchive} className="hover:text-amber-500 transition text-sm" title="העבר לארכיון">🗄️</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <Count n={job.new_count}       label="חדשים"  cls="bg-sky-100 text-sky-700" />
        <Count n={job.process_count}   label="בתהליך" cls="bg-amber-100 text-amber-700" />
        <Count n={job.interview_count} label="ראיון"  cls="bg-violet-100 text-violet-700" />
        <Count n={job.hired_count}     label="התקבלו" cls="bg-emerald-100 text-emerald-700" />
        <Count n={job.rejected_count}  label="נדחו"   cls="bg-slate-100 text-slate-500" />
        {job.candidate_count === 0 && <span className="text-xs text-slate-400">עדיין אין מועמדים</span>}
      </div>
    </div>
  );
}
