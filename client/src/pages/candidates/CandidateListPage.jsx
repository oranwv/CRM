// מועמדים — candidate list for one job (/candidates/jobs/:jobId), all candidates (/candidates/all)
// or candidates without a job (/candidates/unassigned). Managers only; see JobsPage for the entry
// screen. The list, drawer and modals come from the standalone tracker, restyled for the CRM.
import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import api from '../../api';
import CandidateDetail from '../../components/candidates/CandidateDetail';
import AddCandidateModal from '../../components/candidates/AddCandidateModal';
import StatusBadge from '../../components/candidates/StatusBadge';

const STATUS_SORT_ORDER = { 'ראיון נקבע': 1, 'בתהליך': 2, 'חדש': 3 };

function formatPhoneForCall(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('972')) return '+' + digits;
  if (digits.startsWith('0')) return '+972' + digits.slice(1);
  return '+' + digits;
}

export default function CandidateListPage({ scope = 'job' }) {
  const { jobId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [job, setJob]               = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [tab, setTab]               = useState('active');
  const [sorted, setSorted]         = useState(false);
  const [search, setSearch]         = useState('');
  const [selected, setSelected]     = useState(null);
  const [showAdd, setShowAdd]       = useState(false);
  const [loading, setLoading]       = useState(true);

  const jobFilter = scope === 'job' ? jobId : scope === 'unassigned' ? 'none' : null;

  const loadCandidates = useCallback(async () => {
    try {
      let url = `/candidates?tab=${tab}`;
      if (jobFilter) url += `&job_id=${jobFilter}`;
      const { data } = await api.get(url);
      setCandidates(data);
    } catch { /* handled by interceptor */ }
    finally { setLoading(false); }
  }, [jobFilter, tab]);

  useEffect(() => { loadCandidates(); }, [loadCandidates]);

  useEffect(() => {
    if (scope !== 'job') return;
    api.get('/candidates/jobs?archived=1')
      .then(r => setJob(r.data.find(j => j.id === Number(jobId)) || null))
      .catch(() => {});
  }, [scope, jobId]);

  // Deep link from a calendar event description: /candidates/all?candidate=ID
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get('candidate');
    if (id) {
      setSelected(Number(id));
      params.delete('candidate');
      params.delete('src');
      navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    }
  }, [location.search, location.pathname, navigate]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? candidates.filter(c => (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q) || (c.email || '').toLowerCase().includes(q))
    : candidates;
  const displayed = sorted
    ? [...filtered].sort((a, b) => (STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99))
    : filtered;

  const title = scope === 'all' ? 'כל המועמדים' : scope === 'unassigned' ? 'מועמדים ללא משרה' : (job?.title || 'טוען...');

  return (
    <div className="min-h-screen" dir="rtl">
      {/* Title row */}
      <div className="px-4 sm:px-6 pt-4 pb-3 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => navigate('/candidates')} className="text-slate-400 hover:text-violet-600 transition text-xl leading-none shrink-0" title="חזרה למשרות">→</button>
          <span className="text-2xl shrink-0">{scope === 'job' ? '💼' : scope === 'unassigned' ? '❓' : '👥'}</span>
          <h1 className="text-xl font-black text-slate-800 truncate">{title}</h1>
          {job?.archived_at && <span className="text-xs font-bold bg-slate-100 text-slate-500 rounded-full px-2 py-0.5 shrink-0">ארכיון</span>}
        </div>
        {tab === 'active' && (
          <button
            onClick={() => setShowAdd(true)}
            className="text-sm bg-gradient-to-r from-violet-600 to-indigo-500 hover:from-violet-700 hover:to-indigo-600 text-white px-3 py-1.5 rounded-xl transition font-bold flex items-center gap-1.5 shadow-md shadow-violet-200"
          >
            <span className="text-lg leading-none">+</span> הוסף מועמד
          </button>
        )}
      </div>

      {/* Tabs + search + sort */}
      <div className="mx-4 sm:mx-6 bg-white border border-slate-200 rounded-t-2xl px-2 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex">
          <TabBtn active={tab === 'active'} onClick={() => setTab('active')}>פעילים</TabBtn>
          <TabBtn active={tab === 'rejected'} onClick={() => setTab('rejected')}>נדחה / לא רלוונטי</TabBtn>
        </div>
        <div className="flex items-center gap-2 py-2 ml-2">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש שם / טלפון"
            className="w-36 sm:w-48 border-2 border-slate-200 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-violet-400 transition"
          />
          {tab === 'active' && (
            <button
              onClick={() => setSorted(s => !s)}
              className={`text-xs px-3 py-1.5 rounded-xl transition border-2 font-semibold whitespace-nowrap ${
                sorted ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-500 border-slate-200 hover:border-violet-300 hover:text-violet-600'
              }`}
            >
              {sorted ? '✓ לפי סטטוס' : 'סדר לפי סטטוס'}
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="mx-4 sm:mx-6 bg-white rounded-b-2xl shadow-sm border border-t-0 border-slate-200 overflow-x-auto">
        {loading ? (
          <div className="text-center py-16 text-slate-400 text-sm">טוען...</div>
        ) : displayed.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <p className="text-5xl mb-3">{tab === 'rejected' ? '🚫' : '📋'}</p>
            <p className="text-sm">{q ? 'אין תוצאות לחיפוש.' : tab === 'rejected' ? 'אין מועמדים נדחים.' : 'אין מועמדים עדיין. הוסף מועמד ידנית.'}</p>
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
          onClose={() => { setSelected(null); loadCandidates(); }}
          onUpdated={loadCandidates}
        />
      )}

      {showAdd && (
        <AddCandidateModal
          jobId={scope === 'job' ? jobId : null}
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); loadCandidates(); }}
        />
      )}
    </div>
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
