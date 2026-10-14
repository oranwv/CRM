// מועמדים — candidate tracker merged into the CRM (managers only; see AppModeContext + App.jsx).
// Jobs are chips above the list; the list and the detail drawer are the standalone app's, restyled
// to sit under the CRM top bar.
import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import api from '../api';
import CandidateDetail from '../components/candidates/CandidateDetail';
import AddCandidateModal from '../components/candidates/AddCandidateModal';
import StatusBadge from '../components/candidates/StatusBadge';

const STATUS_SORT_ORDER = { 'ראיון נקבע': 1, 'בתהליך': 2, 'חדש': 3 };

function formatPhoneForCall(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('972')) return '+' + digits;
  if (digits.startsWith('0')) return '+972' + digits.slice(1);
  return '+' + digits;
}

export default function CandidatesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [jobs, setJobs]             = useState([]);
  const [jobId, setJobId]           = useState(null);   // null = all candidates
  const [candidates, setCandidates] = useState([]);
  const [tab, setTab]               = useState('active');
  const [sorted, setSorted]         = useState(false);
  const [selected, setSelected]     = useState(null);
  const [showAdd, setShowAdd]       = useState(false);
  const [showJobs, setShowJobs]     = useState(false);
  const [newTitle, setNewTitle]     = useState('');
  const [savingJob, setSavingJob]   = useState(false);
  const [loading, setLoading]       = useState(true);

  const loadJobs = useCallback(() => api.get('/candidates/jobs').then(r => setJobs(r.data)).catch(() => {}), []);

  const loadCandidates = useCallback(async () => {
    try {
      let url = `/candidates?tab=${tab}`;
      if (jobId) url += `&job_id=${jobId}`;
      const { data } = await api.get(url);
      setCandidates(data);
    } catch { /* handled by interceptor */ }
    finally { setLoading(false); }
  }, [jobId, tab]);

  useEffect(() => { loadJobs(); }, [loadJobs]);
  useEffect(() => { loadCandidates(); }, [loadCandidates]);

  // Deep link from a calendar event description: /candidates?candidate=ID
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get('candidate');
    if (id) {
      setSelected(Number(id));
      params.delete('candidate');
      navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    }
  }, [location.search, location.pathname, navigate]);

  const displayed = sorted
    ? [...candidates].sort((a, b) => (STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99))
    : candidates;

  async function handleCreateJob(e) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setSavingJob(true);
    try {
      await api.post('/candidates/jobs', { title: newTitle.trim() });
      setNewTitle('');
      loadJobs();
    } finally { setSavingJob(false); }
  }

  async function handleDeleteJob(id) {
    if (!confirm('למחוק משרה זו? המועמדים לא יימחקו.')) return;
    await api.delete(`/candidates/jobs/${id}`);
    if (jobId === id) setJobId(null);
    loadJobs();
    loadCandidates();
  }

  function refreshAll() { loadCandidates(); loadJobs(); }

  const currentJob = jobs.find(j => j.id === jobId);

  return (
    <div className="min-h-screen" dir="rtl">
      {/* Title row */}
      <div className="px-4 sm:px-6 pt-4 pb-2 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🧑‍💼</span>
          <h1 className="text-xl font-black text-slate-800">מועמדים</h1>
          {currentJob && <span className="text-sm font-bold text-violet-600">· {currentJob.title}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowJobs(v => !v)}
            className={`text-sm font-bold px-3 py-1.5 rounded-xl border-2 transition ${showJobs ? 'bg-violet-600 border-violet-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-violet-300'}`}
          >
            💼 משרות
          </button>
          {tab === 'active' && (
            <button
              onClick={() => setShowAdd(true)}
              className="text-sm bg-gradient-to-r from-violet-600 to-indigo-500 hover:from-violet-700 hover:to-indigo-600 text-white px-3 py-1.5 rounded-xl transition font-bold flex items-center gap-1.5 shadow-md shadow-violet-200"
            >
              <span className="text-lg leading-none">+</span> הוסף מועמד
            </button>
          )}
        </div>
      </div>

      {/* Job chips */}
      <div className="px-4 sm:px-6 pb-2 flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        <JobChip active={jobId === null} onClick={() => setJobId(null)}>
          👥 כל המועמדים
        </JobChip>
        {jobs.map(j => (
          <JobChip key={j.id} active={jobId === j.id} onClick={() => setJobId(j.id)}>
            💼 {j.title} <span className="opacity-70">({j.active_count})</span>
          </JobChip>
        ))}
      </div>

      {/* Jobs manager */}
      {showJobs && (
        <div className="mx-4 sm:mx-6 mb-3 bg-white border-2 border-violet-200 rounded-2xl p-4 shadow-md shadow-violet-100">
          <form onSubmit={handleCreateJob} className="flex gap-2 mb-3">
            <input
              autoFocus
              type="text"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="שם המשרה, למשל: אנשי מכירות"
              className="flex-1 border-2 border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400 transition"
            />
            <button type="submit" disabled={savingJob}
              className="bg-gradient-to-r from-violet-600 to-indigo-500 text-white text-sm font-bold px-4 py-2 rounded-xl transition disabled:opacity-60">
              {savingJob ? 'שומר...' : 'צור משרה'}
            </button>
          </form>
          {jobs.length === 0 ? (
            <p className="text-sm text-slate-400">אין משרות עדיין.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {jobs.map(j => (
                <li key={j.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-semibold text-slate-700">{j.title} <span className="text-slate-400 font-normal">· {j.candidate_count} מועמד/ים</span></span>
                  <button onClick={() => handleDeleteJob(j.id)} className="text-slate-300 hover:text-red-400 transition" title="מחק משרה">✕</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Tabs + sort bar */}
      <div className="mx-4 sm:mx-6 bg-white border border-slate-200 rounded-t-2xl px-2 flex items-center justify-between">
        <div className="flex">
          <TabBtn active={tab === 'active'} onClick={() => setTab('active')}>פעילים</TabBtn>
          <TabBtn active={tab === 'rejected'} onClick={() => setTab('rejected')}>נדחה / לא רלוונטי</TabBtn>
        </div>
        {tab === 'active' && (
          <button
            onClick={() => setSorted(s => !s)}
            className={`text-xs px-3 py-1.5 rounded-xl transition border-2 font-semibold ml-2 ${
              sorted ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-500 border-slate-200 hover:border-violet-300 hover:text-violet-600'
            }`}
          >
            {sorted ? '✓ מסודר לפי סטטוס' : 'סדר לפי סטטוס'}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="mx-4 sm:mx-6 bg-white rounded-b-2xl shadow-sm border border-t-0 border-slate-200 overflow-x-auto">
        {loading ? (
          <div className="text-center py-16 text-slate-400 text-sm">טוען...</div>
        ) : displayed.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <p className="text-5xl mb-3">{tab === 'rejected' ? '🚫' : '📋'}</p>
            <p className="text-sm">{tab === 'rejected' ? 'אין מועמדים נדחים.' : 'אין מועמדים עדיין. הוסף מועמד ידנית.'}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gradient-to-r from-violet-50 to-indigo-50 border-b border-violet-100 text-right">
                <th className="px-4 py-3 font-bold text-slate-500 w-10">#</th>
                <th className="px-4 py-3 font-bold text-slate-600">שם</th>
                <th className="px-4 py-3 font-bold text-slate-600">סטטוס</th>
                <th className="px-4 py-3 font-bold text-slate-600 hidden md:table-cell">עדכון סטטוס</th>
                <th className="px-4 py-3 font-bold text-slate-600">טלפון</th>
                <th className="px-4 py-3 font-bold text-slate-600 hidden sm:table-cell">התקבל ב</th>
                <th className="px-4 py-3 font-bold text-slate-600 hidden lg:table-cell">אימייל</th>
                {tab === 'rejected' && <th className="px-4 py-3 font-bold text-slate-600">סיבה</th>}
              </tr>
            </thead>
            <tbody>
              {displayed.map((c, i) => (
                <tr key={c.id} onClick={() => setSelected(c.id)} className="border-b border-slate-100 cursor-pointer hover:bg-violet-50 transition">
                  <td className="px-4 py-3 text-slate-400 text-xs font-medium">{i + 1}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">
                    {c.name || '—'}
                    {c.meeting_rsvp_status === 'accepted' && <span className="mr-1 text-xs" title="אישר פגישה">✅</span>}
                    {c.meeting_rsvp_status === 'declined' && <span className="mr-1 text-xs" title="דחה פגישה">❌</span>}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3 text-slate-400 text-xs hidden md:table-cell">
                    {c.status_updated_at ? format(new Date(c.status_updated_at), 'dd/MM/yyyy HH:mm') : '—'}
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    {c.phone
                      ? <a href={`tel:${formatPhoneForCall(c.phone)}`} className="text-violet-600 font-semibold hover:underline" dir="ltr">{c.phone}</a>
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs hidden sm:table-cell">
                    {c.arrival_time ? format(new Date(c.arrival_time), 'dd/MM/yyyy HH:mm') : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-500 hidden lg:table-cell">{c.email || '—'}</td>
                  {tab === 'rejected' && <td className="px-4 py-3 text-slate-400 text-xs">{c.status_reason || '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <CandidateDetail
          candidateId={selected}
          onClose={() => { setSelected(null); refreshAll(); }}
          onUpdated={refreshAll}
        />
      )}

      {showAdd && (
        <AddCandidateModal
          jobId={jobId}
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); refreshAll(); }}
        />
      )}
    </div>
  );
}

function JobChip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 text-xs font-bold px-3 py-1.5 rounded-full border-2 transition whitespace-nowrap ${
        active ? 'bg-violet-600 border-violet-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-violet-300'
      }`}
    >
      {children}
    </button>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 text-sm font-bold border-b-2 transition ${
        active ? 'border-violet-600 text-violet-600' : 'border-transparent text-slate-400 hover:text-slate-600'
      }`}
    >
      {children}
    </button>
  );
}
