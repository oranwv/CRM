import { useState, useEffect, useRef } from 'react';
import api from '../api';
import LeadCard from '../components/LeadCard';
import { isDesktop } from '../utils/device';

const TABS = [
  { key: 'in_production', label: 'בהפקה' },
  { key: 'event_done',    label: 'אירועים שהסתיימו' },
];

const STAGE_LABEL = { deposit: 'התקבלה מקדמה', production: 'בהפקה', completed: 'אירוע הסתיים' };
const STAGE_CLS   = { deposit: 'bg-emerald-100 text-emerald-700', production: 'bg-teal-100 text-teal-700', completed: 'bg-slate-100 text-slate-600' };

function formatEventDate(lead) {
  if (lead.event_date_text) return lead.event_date_text;
  if (!lead.event_date) return null;
  const d = new Date(lead.event_date);
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function EventCard({ lead, onClick }) {
  const dateStr = formatEventDate(lead);
  return (
    <button
      onClick={onClick}
      className="w-full text-right bg-white rounded-2xl shadow-sm border border-violet-100 px-4 py-3 hover:border-violet-300 transition"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-black text-slate-800 text-sm truncate">{lead.event_name || lead.name}</p>
          <p className="text-xs text-slate-500 truncate">{lead.name}</p>
          {dateStr && (
            <p className="text-xs text-violet-600 font-semibold mt-1">
              {dateStr}{lead.event_time ? ` · ${lead.event_time}` : ''}
            </p>
          )}
          {lead.event_type && (
            <p className="text-xs text-slate-400 mt-0.5">{lead.event_type}</p>
          )}
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${STAGE_CLS[lead.stage] || 'bg-slate-100 text-slate-500'}`}>
          {STAGE_LABEL[lead.stage] || lead.stage}
        </span>
      </div>
      {lead.assigned_name && (
        <p className="text-[11px] text-slate-400 mt-1.5">אחראי: {lead.assigned_name}</p>
      )}
    </button>
  );
}

function sortByDate(arr) {
  return [...arr].sort((a, b) => {
    if (!a.event_date && !b.event_date) return 0;
    if (!a.event_date) return 1;
    if (!b.event_date) return -1;
    return new Date(a.event_date) - new Date(b.event_date);
  });
}

function matchesSearch(lead, q) {
  if (!q) return true;
  const low = q.toLowerCase();
  return (
    (lead.name || '').toLowerCase().includes(low) ||
    (lead.event_name || '').toLowerCase().includes(low) ||
    (lead.phone || '').includes(q)
  );
}

export default function EventsPage() {
  const [tab, setTab]             = useState('in_production');
  const [leads, setLeads]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [openLeadId, setOpenLeadId] = useState(null);
  const [search, setSearch]       = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  useEffect(() => {
    setLoading(true);
    api.get('/leads', { params: { tab } })
      .then(r => setLeads(sortByDate(r.data)))
      .catch(() => setLeads([]))
      .finally(() => setLoading(false));
  }, [tab]);

  const filteredLeads = leads.filter(l => matchesSearch(l, debouncedSearch));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-violet-50 to-indigo-50" dir="rtl">
      <div className="sticky top-11 z-20 bg-white/90 backdrop-blur border-b border-violet-100 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-xl font-black text-slate-800">אירועים</h1>
          <span className="text-xs text-slate-400">{leads.length} אירועים</span>
        </div>
        <div className="flex gap-1 p-1 rounded-xl bg-violet-100/70 mb-2">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition ${
                tab === t.key
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="חיפוש לפי שם, אירוע, טלפון..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-violet-400 bg-white"
        />
      </div>

      <div className="px-4 py-4 space-y-3">
        {loading && (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-violet-300 border-t-violet-600 rounded-full animate-spin" />
          </div>
        )}

        {!loading && filteredLeads.length === 0 && (
          <div className="text-center py-16 text-slate-400 text-sm">אין אירועים</div>
        )}

        {!loading && filteredLeads.map(lead => (
          <EventCard key={lead.id} lead={lead} onClick={() => {
            // Desktop: open the lead in its own browser tab; mobile: in-page overlay.
            if (isDesktop()) window.open(`/leads/${lead.id}`, '_blank');
            else setOpenLeadId(lead.id);
          }} />
        ))}
      </div>

      {openLeadId && (
        <LeadCard
          leadId={openLeadId}
          onClose={() => { setOpenLeadId(null); api.get('/leads', { params: { tab } }).then(r => setLeads(sortByDate(r.data))); }}
        />
      )}
    </div>
  );
}
