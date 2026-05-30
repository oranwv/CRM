import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api';
import LeadCard from '../components/LeadCard';
import AddLeadModal from '../components/AddLeadModal';
import FilterPanel from '../components/FilterPanel';

const TABS = [
  { key: 'new',        label: 'חדשים' },
  { key: 'in_process', label: 'בתהליך' },
  { key: 'closed',     label: 'סגרו עסקה' },
  { key: 'lost',       label: 'לא סגרו' },
];

// Stage options available in each filter context
const FILTER_STAGES = {
  active: ['new','contacted','meeting_scheduled','meeting','offer_sent','negotiation','contract_sent'],
  closed: ['deposit','production'],
  lost:   ['lost'],
};

const SOURCE_LABELS = {
  website_popup: 'אתר (פופאפ)', website_form: 'אתר (טופס)',
  call_event: 'Call Event', telekol: 'טלקול',
  whatsapp: 'וואטסאפ', facebook: 'פייסבוק',
  instagram: 'אינסטגרם', manual: 'ידני',
};

const STAGE_STYLES = {
  new:               { label: 'חדש',                 cls: 'bg-sky-100 text-sky-700 border border-sky-200' },
  contacted:         { label: 'בוצעה שיחה ראשונית', cls: 'bg-amber-100 text-amber-700 border border-amber-200' },
  meeting_scheduled: { label: 'נקבעה פגישה',        cls: 'bg-fuchsia-100 text-fuchsia-700 border border-fuchsia-200' },
  meeting:           { label: 'בוצעה פגישה',         cls: 'bg-violet-100 text-violet-700 border border-violet-200' },
  offer_sent:        { label: 'נשלחה הצעת מחיר',    cls: 'bg-blue-100 text-blue-700 border border-blue-200' },
  negotiation:       { label: 'מו"מ',                cls: 'bg-orange-100 text-orange-700 border border-orange-200' },
  contract_sent:     { label: 'חוזה נשלח',           cls: 'bg-indigo-100 text-indigo-700 border border-indigo-200' },
  deposit:           { label: 'התקבלה מקדמה',        cls: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
  production:        { label: 'הפקה',                cls: 'bg-teal-100 text-teal-700 border border-teal-200' },
  lost:              { label: 'לא סגרו',             cls: 'bg-red-100 text-red-600 border border-red-200' },
};

const PRIORITY_ICONS = { normal: '', hot: '🔥', urgent: '⚡' };
const PRIORITY_ORDER = { urgent: 0, hot: 1, normal: 2 };

const SOURCE_COLORS = {
  website_popup: 'bg-violet-100 text-violet-700',
  website_form:  'bg-purple-100 text-purple-700',
  call_event:    'bg-orange-100 text-orange-700',
  telekol:       'bg-sky-100 text-sky-700',
  whatsapp:      'bg-green-100 text-green-700',
  facebook:      'bg-blue-100 text-blue-700',
  instagram:     'bg-pink-100 text-pink-700',
  manual:        'bg-slate-100 text-slate-600',
};

const IL = { timeZone: 'Asia/Jerusalem' };

const EMPTY_FILTER = { persons: [], stages: [], dateRange: null };

function hasFilter(f) {
  return f.persons.length > 0 || f.stages.length > 0 || f.dateRange !== null;
}

function filterCount(f) {
  return f.persons.length + f.stages.length + (f.dateRange ? 1 : 0);
}

function applyFilter(leads, filter) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return leads.filter(l => {
    if (filter.persons.length > 0 && !filter.persons.includes(l.assigned_name)) return false;
    if (filter.stages.length  > 0 && !filter.stages.includes(l.stage))          return false;
    if (filter.dateRange) {
      const days = { '30': 30, '60': 60, '90': 90, '180': 180 }[filter.dateRange];
      if (!l.event_date) return false;
      const ev = new Date(l.event_date); ev.setHours(0, 0, 0, 0);
      const limit = new Date(today); limit.setDate(limit.getDate() + days);
      if (ev < today || ev > limit) return false;
    }
    return true;
  });
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', IL);
}

function formatDateTime(d) {
  if (!d) return null;
  const dt = new Date(d);
  return {
    date: dt.toLocaleDateString('en-GB', IL),
    time: dt.toLocaleTimeString('en-GB', { ...IL, hour: '2-digit', minute: '2-digit' }),
  };
}

function DateTimeCell({ value }) {
  const parts = formatDateTime(value);
  if (!parts) return <span>—</span>;
  return (
    <div>
      <div>{parts.date}</div>
      <div className="text-slate-400 text-xs">{parts.time}</div>
    </div>
  );
}

export default function LeadsPage() {
  const [tab, setTab]           = useState('new');
  const [leads, setLeads]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [apiError, setApiError] = useState(false);
  const [search, setSearch]         = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [showAdd, setShowAdd]       = useState(false);
  const [sortCol, setSortCol]   = useState('received_at');
  const [sortDir, setSortDir]   = useState('desc');
  const [users, setUsers]       = useState([]);

  // Three independent filter states — one per section
  const [activeFilter, setActiveFilter] = useState(EMPTY_FILTER);
  const [closedFilter, setClosedFilter] = useState(EMPTY_FILTER);
  const [lostFilter,   setLostFilter]   = useState(EMPTY_FILTER);
  const [filterOpen, setFilterOpen]     = useState(false);

  const filterAreaRef = useRef(null);
  const abortRef      = useRef(null);
  const user = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const [searchParams, setSearchParams] = useSearchParams();

  // Current filter object based on active tab
  const isActiveSection = tab === 'new' || tab === 'in_process';
  const currentFilter   = isActiveSection ? activeFilter : tab === 'closed' ? closedFilter : lostFilter;
  const setCurrentFilter = isActiveSection ? setActiveFilter : tab === 'closed' ? setClosedFilter : setLostFilter;
  const currentFilterCount = filterCount(currentFilter);

  // Stage options shown in the filter panel for the current section
  const stageOptions = isActiveSection ? FILTER_STAGES.active
    : tab === 'closed' ? FILTER_STAGES.closed
    : FILTER_STAGES.lost;

  // Whether we need to fetch the combined 'active' set (both new + in_process)
  const inActiveFilterMode = isActiveSection && hasFilter(activeFilter) && !debouncedSearch;

  useEffect(() => {
    const leadParam = searchParams.get('lead');
    if (leadParam) {
      setSelectedId(Number(leadParam));
      setSearchParams({}, { replace: true });
    }
  }, [searchParams]);

  // Fetch users for the filter panel
  useEffect(() => {
    api.get('/users').then(r => setUsers(r.data)).catch(() => {});
  }, []);

  // Close filter panel on outside click
  useEffect(() => {
    if (!filterOpen) return;
    function handleClick(e) {
      if (filterAreaRef.current && !filterAreaRef.current.contains(e.target)) {
        setFilterOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [filterOpen]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadLeads = useCallback(async ({ silent = false } = {}) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    if (!silent) setLoading(true);
    try {
      // When searching: lost tab stays restricted; all other tabs search across all non-lost stages
      // When activeFilter is set on new/in_process: fetch the combined 'active' group
      const fetchTab = debouncedSearch
        ? (tab === 'lost' ? 'lost' : 'all_active')
        : inActiveFilterMode ? 'active' : tab;

      const { data } = await api.get('/leads', {
        params: { tab: fetchTab, search: debouncedSearch || undefined },
        signal: abortRef.current.signal,
      });
      setLeads(data);
      setApiError(false);
    } catch (err) {
      if (err.code === 'ERR_CANCELED') return;
      console.error('Failed to load leads:', err);
      setApiError(true);
    }
    if (!silent) setLoading(false);
  }, [tab, debouncedSearch, inActiveFilterMode]);

  useEffect(() => {
    loadLeads();
    const interval = setInterval(() => loadLeads({ silent: true }), 30000);
    return () => clearInterval(interval);
  }, [loadLeads]);

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  }

  // Apply current section's filter client-side
  const filteredLeads = useMemo(() => {
    if (debouncedSearch) return leads; // search mode: no extra filter
    const f = isActiveSection ? activeFilter : tab === 'closed' ? closedFilter : lostFilter;
    return hasFilter(f) ? applyFilter(leads, f) : leads;
  }, [leads, tab, activeFilter, closedFilter, lostFilter, debouncedSearch]);

  const sortedLeads = useMemo(() => {
    return [...filteredLeads].sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 2;
      const pb = PRIORITY_ORDER[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      if (!sortCol) return 0;
      const av = a[sortCol], bv = b[sortCol];
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filteredLeads, sortCol, sortDir]);

  function SortIcon({ col }) {
    if (sortCol !== col) return <span className="opacity-30 ml-0.5">↕</span>;
    return <span className="ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  function handleLogout() {
    localStorage.removeItem('crm_token');
    localStorage.removeItem('crm_user');
    window.location.href = '/login';
  }

  // Hide the tab switcher when active filter is set (show combined view instead)
  const showTabs = !debouncedSearch && !inActiveFilterMode;

  return (
    <div className="min-h-screen pb-16">
      {/* Header */}
      <div className="bg-white border-b border-violet-100 px-4 py-3 flex items-center gap-3 shadow-sm sticky top-0 z-20">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-black text-base shrink-0"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
        >
          ש
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-black text-slate-900 leading-tight">שרביה CRM</h1>
          <p className="text-slate-400 text-xs leading-tight">{user.display_name}</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="text-white text-sm font-bold px-4 py-2 rounded-xl transition shrink-0"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', boxShadow: '0 2px 8px rgba(124,58,237,0.3)' }}>
          + ליד חדש
        </button>
        <button onClick={handleLogout} className="text-slate-400 hover:text-slate-600 text-xs transition shrink-0">
          יציאה
        </button>
      </div>

      {/* Tabs */}
      {showTabs && (
        <div className="px-4 pt-4 pb-2">
          <div className="flex gap-1 bg-violet-100/70 rounded-xl p-1">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`flex-1 py-2 rounded-lg text-sm font-bold transition ${
                  tab === t.key
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Active filter mode: show section label instead of tabs */}
      {inActiveFilterMode && (
        <div className="px-4 pt-4 pb-2 flex items-center gap-2" dir="rtl">
          <span className="text-sm font-bold text-violet-700">חדשים + בתהליך</span>
          <span className="text-xs text-slate-400">· כל הלידים הפעילים</span>
        </div>
      )}

      {/* Search */}
      <div className={`px-4 pb-2 ${!debouncedSearch && !inActiveFilterMode ? '' : 'pt-4'}`}>
        <input
          type="text"
          placeholder="חיפוש לפי שם, טלפון, אימייל או תאריך אירוע (DD.MM.YYYY)..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full border border-violet-200 bg-violet-50 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 transition"
        />
      </div>

      {/* Filter button + panel */}
      {!debouncedSearch && (
        <div className="px-4 pb-3 relative" ref={filterAreaRef} dir="rtl">
          <button
            onClick={() => setFilterOpen(o => !o)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-semibold border transition ${
              currentFilterCount > 0
                ? 'bg-violet-600 text-white border-violet-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300 hover:text-violet-600'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 3h14v1.5L10 9v5l-4-2V9L1 4.5V3z"/>
            </svg>
            סינון
            {currentFilterCount > 0 && (
              <span className="bg-white text-violet-700 font-black text-xs w-5 h-5 rounded-full flex items-center justify-center">
                {currentFilterCount}
              </span>
            )}
          </button>

          {/* Active filter chips */}
          {currentFilterCount > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {currentFilter.persons.map(p => (
                <span key={p} className="flex items-center gap-1 bg-violet-100 text-violet-700 text-xs px-2 py-1 rounded-full font-semibold">
                  {p}
                  <button onClick={() => setCurrentFilter(f => ({ ...f, persons: f.persons.filter(x => x !== p) }))} className="hover:text-violet-900">✕</button>
                </span>
              ))}
              {currentFilter.stages.map(s => (
                <span key={s} className="flex items-center gap-1 bg-violet-100 text-violet-700 text-xs px-2 py-1 rounded-full font-semibold">
                  {STAGE_STYLES[s]?.label || s}
                  <button onClick={() => setCurrentFilter(f => ({ ...f, stages: f.stages.filter(x => x !== s) }))} className="hover:text-violet-900">✕</button>
                </span>
              ))}
              {currentFilter.dateRange && (
                <span className="flex items-center gap-1 bg-violet-100 text-violet-700 text-xs px-2 py-1 rounded-full font-semibold">
                  {({ '30':'30 יום','60':'60 יום','90':'90 יום','180':'6 חודשים' })[currentFilter.dateRange]}
                  <button onClick={() => setCurrentFilter(f => ({ ...f, dateRange: null }))} className="hover:text-violet-900">✕</button>
                </span>
              )}
            </div>
          )}

          {filterOpen && (
            <FilterPanel
              users={users}
              stageOptions={stageOptions}
              filter={currentFilter}
              onApply={(f) => { setCurrentFilter(f); setFilterOpen(false); }}
            />
          )}
        </div>
      )}

      {/* Table */}
      <div className="px-2 pb-6" dir="rtl">
        {loading ? (
          <div className="text-center py-16 text-stone-400">
            <p className="text-3xl mb-2">⏳</p>
            <p className="text-sm">טוען לידים...</p>
          </div>
        ) : apiError ? (
          <div className="text-center py-16 text-red-400">
            <p className="text-3xl mb-2">⚠️</p>
            <p className="text-sm font-bold">שגיאה בטעינת לידים</p>
            <p className="text-xs mt-1 text-stone-400">בדוק שהשרת פועל ופתח DevTools (F12) לפרטים</p>
          </div>
        ) : sortedLeads.length === 0 ? (
          <div className="text-center py-16 text-stone-400">
            <p className="text-3xl mb-2">{currentFilterCount > 0 ? '🔍' : '📭'}</p>
            <p className="text-sm">{currentFilterCount > 0 ? 'אין לידים התואמים את הסינון' : 'אין לידים בקטגוריה זו'}</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-violet-100 mt-2 overflow-x-auto">
            <table className="w-full text-xs min-w-[900px]">
              <thead>
                <tr className="bg-violet-50/60 text-xs font-bold text-slate-500 uppercase tracking-wide border-b border-violet-100">
                  <th className="px-2 py-3 text-right">#</th>
                  <th className="px-2 py-3 text-right">שם האירוע</th>
                  <th className="px-2 py-3 text-right">סטטוס</th>
                  <th onClick={() => handleSort('last_interaction_at')} className="px-2 py-3 text-right cursor-pointer select-none hover:text-violet-700">פעילות אחרונה<SortIcon col="last_interaction_at" /></th>
                  <th onClick={() => handleSort('received_at')} className="px-2 py-3 text-right cursor-pointer select-none hover:text-violet-700">התקבל ב<SortIcon col="received_at" /></th>
                  <th className="px-2 py-3 text-right">טלפון</th>
                  <th onClick={() => handleSort('event_date')} className="px-2 py-3 text-right cursor-pointer select-none hover:text-violet-700">תאריך אירוע<SortIcon col="event_date" /></th>
                  <th className="px-2 py-3 text-right">סוג אירוע</th>
                  <th className="px-2 py-3 text-right">מוזמנים</th>
                  <th className="px-2 py-3 text-right">מקור</th>
                  <th className="px-2 py-3 text-right">אחראי</th>
                  <th className="px-2 py-3 text-right">משימות</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-violet-50">
                {sortedLeads.map((lead, idx) => (
                  <tr
                    key={lead.id}
                    onClick={() => setSelectedId(lead.id)}
                    className="hover:bg-violet-50/40 cursor-pointer transition"
                  >
                    <td className="px-2 py-3 text-slate-400 font-medium">{idx + 1}</td>
                    <td className="px-2 py-3 font-semibold text-slate-800">
                      <div className="flex items-center gap-1.5">
                        {PRIORITY_ICONS[lead.priority] && <span>{PRIORITY_ICONS[lead.priority]}</span>}
                        {lead.avatar_url && (
                          <img src={lead.avatar_url} className="w-7 h-7 rounded-full object-cover shrink-0" onError={e => e.target.style.display='none'} />
                        )}
                        <span>{lead.event_name || lead.name || '—'}</span>
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      {(() => {
                        const s = STAGE_STYLES[lead.stage];
                        return s ? (
                          <span className={`font-bold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>
                        ) : '—';
                      })()}
                    </td>
                    <td className="px-2 py-3 text-slate-500">
                      <div className="flex items-center gap-1">
                        {lead.unread_count > 0 && (
                          <span className="w-2 h-2 rounded-full bg-green-500 shrink-0 animate-pulse" title="הודעה חדשה שלא נקראה" />
                        )}
                        <DateTimeCell value={lead.last_interaction_at} />
                      </div>
                    </td>
                    <td className="px-2 py-3 text-slate-500"><DateTimeCell value={lead.received_at} /></td>
                    <td className="px-2 py-3 text-slate-600" dir="ltr" style={{ textAlign: 'left' }}>
                      {lead.phone ? (
                        <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()}
                           className="text-violet-700 hover:underline font-medium">
                          {lead.phone}
                        </a>
                      ) : '—'}
                    </td>
                    <td className="px-2 py-3 text-slate-600">{lead.event_date_text || formatDate(lead.event_date)}</td>
                    <td className="px-2 py-3 text-slate-600">{lead.event_type || '—'}</td>
                    <td className="px-2 py-3 text-slate-600">{lead.guest_count || '—'}</td>
                    <td className="px-2 py-3">
                      <span className={`font-semibold px-2 py-0.5 rounded-full ${SOURCE_COLORS[lead.source] || 'bg-stone-100 text-stone-600'}`}>
                        {SOURCE_LABELS[lead.source] || lead.source}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-slate-500">{lead.assigned_name || '—'}</td>
                    <td className="px-2 py-3">
                      {lead.overdue_tasks > 0 ? (
                        <span className="inline-flex items-center gap-1 bg-red-100 text-red-600 font-bold px-2 py-0.5 rounded-full">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
                          {lead.overdue_tasks}
                        </span>
                      ) : lead.open_tasks > 0 ? (
                        <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-600 font-bold px-2 py-0.5 rounded-full">
                          {lead.open_tasks}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedId && (
        <LeadCard leadId={selectedId} onClose={() => setSelectedId(null)} onUpdated={loadLeads} />
      )}
      {showAdd && (
        <AddLeadModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); loadLeads(); }} />
      )}
    </div>
  );
}
