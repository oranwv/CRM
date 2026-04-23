import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api';
import LeadCard from '../components/LeadCard';
import AddLeadModal from '../components/AddLeadModal';

const TABS = [
  { key: 'new',        label: 'חדשים',       color: 'bg-blue-500' },
  { key: 'in_process', label: 'בתהליך',      color: 'bg-amber-500' },
  { key: 'closed',     label: 'סגרו עסקה',   color: 'bg-emerald-500' },
  { key: 'lost',       label: 'לא סגרו',     color: 'bg-slate-400' },
];

const SOURCE_LABELS = {
  website_popup: 'אתר (פופאפ)', website_form: 'אתר (טופס)',
  call_event: 'Call Event', telekol: 'טלקול',
  whatsapp: 'וואטסאפ', facebook: 'פייסבוק',
  instagram: 'אינסטגרם', manual: 'ידני',
};

const SOURCE_COLORS = {
  website_popup: 'bg-violet-100 text-violet-700',
  website_form: 'bg-purple-100 text-purple-700',
  call_event: 'bg-orange-100 text-orange-700',
  telekol: 'bg-sky-100 text-sky-700',
  whatsapp: 'bg-green-100 text-green-700',
  facebook: 'bg-blue-100 text-blue-700',
  instagram: 'bg-pink-100 text-pink-700',
  manual: 'bg-slate-100 text-slate-600',
};

const STAGE_STYLES = {
  new:           { label: 'חדש',          cls: 'bg-sky-100 text-sky-700 border border-sky-200' },
  contacted:     { label: 'יצירת קשר',    cls: 'bg-amber-100 text-amber-700 border border-amber-200' },
  meeting:       { label: 'פגישה',         cls: 'bg-violet-100 text-violet-700 border border-violet-200' },
  offer_sent:    { label: 'הצעת מחיר',    cls: 'bg-blue-100 text-blue-700 border border-blue-200' },
  negotiation:   { label: 'מו"מ',          cls: 'bg-orange-100 text-orange-700 border border-orange-200' },
  contract_sent: { label: 'חוזה נשלח',    cls: 'bg-indigo-100 text-indigo-700 border border-indigo-200' },
  deposit:       { label: 'מקדמה',         cls: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
  production:    { label: 'הפקה',          cls: 'bg-teal-100 text-teal-700 border border-teal-200' },
  lost:          { label: 'לא סגרו',       cls: 'bg-red-100 text-red-600 border border-red-200' },
};

const PRIORITY_ICONS = { normal: '', hot: '🔥', urgent: '⚡' };

const IL = { timeZone: 'Asia/Jerusalem' };

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', IL);
}

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { ...IL, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function LeadsPage() {
  const [tab, setTab] = useState('new');
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const user = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const [searchParams, setSearchParams] = useSearchParams();

  // Auto-open lead card if ?lead=ID in URL (e.g. from Google Calendar event link)
  useEffect(() => {
    const leadParam = searchParams.get('lead');
    if (leadParam) {
      setSelectedId(Number(leadParam));
      setSearchParams({}, { replace: true });
    }
  }, []);

  const loadLeads = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await api.get('/leads', { params: { tab, search: search || undefined } });
      setLeads(data);
    } catch { }
    if (!silent) setLoading(false);
  }, [tab, search]);

  useEffect(() => {
    loadLeads();
    const interval = setInterval(() => loadLeads({ silent: true }), 30000);
    return () => clearInterval(interval);
  }, [loadLeads]);

  function handleLogout() {
    localStorage.removeItem('crm_token');
    localStorage.removeItem('crm_user');
    window.location.href = '/login';
  }

  const tabCounts = {}; // could add counts later

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 pb-16">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-700 via-teal-600 to-cyan-600 px-4 py-3 flex items-center justify-between shadow-lg">
        <button onClick={handleLogout} className="text-emerald-200 hover:text-white text-sm transition">
          יציאה
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAdd(true)}
            className="text-xs bg-white/20 hover:bg-white/30 text-white font-bold px-3 py-1.5 rounded-xl transition"
          >
            + ליד חדש
          </button>
          <div className="text-right">
            <h1 className="text-lg font-black text-white leading-tight">שרביה CRM</h1>
            <p className="text-emerald-200 text-xs">{user.display_name}</p>
          </div>
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center text-xl">🌿</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-emerald-100 bg-white shadow-sm">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-3 text-sm font-bold transition border-b-2 ${
              tab === t.key
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="px-4 pt-4 pb-2">
        <input
          type="text"
          placeholder="חיפוש לפי שם, טלפון או אימייל..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full border-2 border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-400 transition bg-white"
        />
      </div>

      {/* Table */}
      <div className="px-4 pb-6 overflow-x-auto">
        {loading ? (
          <div className="text-center py-16 text-slate-400">
            <p className="text-3xl mb-2">⏳</p>
            <p className="text-sm">טוען לידים...</p>
          </div>
        ) : leads.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <p className="text-3xl mb-2">📭</p>
            <p className="text-sm">אין לידים בקטגוריה זו</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-emerald-100 overflow-hidden mt-2">
            <table className="w-full text-sm min-w-[1050px]">
              <thead>
                <tr className="bg-gradient-to-r from-emerald-50 to-teal-50 text-xs font-bold text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3 text-right">#</th>
                  <th className="px-4 py-3 text-right">שם</th>
                  <th className="px-4 py-3 text-right">סטטוס</th>
                  <th className="px-4 py-3 text-right">פעילות אחרונה</th>
                  <th className="px-4 py-3 text-right">התקבל ב</th>
                  <th className="px-4 py-3 text-right">טלפון</th>
                  <th className="px-4 py-3 text-right">תאריך אירוע</th>
                  <th className="px-4 py-3 text-right">סוג אירוע</th>
                  <th className="px-4 py-3 text-right">מוזמנים</th>
                  <th className="px-4 py-3 text-right">מקור</th>
                  <th className="px-4 py-3 text-right">אחראי</th>
                  <th className="px-4 py-3 text-right">משימות</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {leads.map((lead, idx) => (
                  <tr
                    key={lead.id}
                    onClick={() => setSelectedId(lead.id)}
                    className="hover:bg-emerald-50/50 cursor-pointer transition"
                  >
                    <td className="px-4 py-3 text-slate-400 text-xs font-medium">{idx + 1}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">
                      <div className="flex items-center gap-2">
                        {lead.avatar_url
                          ? <img src={lead.avatar_url} className="w-7 h-7 rounded-full object-cover shrink-0" onError={e => e.target.style.display='none'} />
                          : <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center text-xs font-bold text-emerald-700 shrink-0">
                              {(lead.name || '?')[0]}
                            </div>
                        }
                        <span className="flex items-center gap-1">
                          {PRIORITY_ICONS[lead.priority] && (
                            <span className="text-base">{PRIORITY_ICONS[lead.priority]}</span>
                          )}
                          {lead.name || '—'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const s = STAGE_STYLES[lead.stage];
                        return s ? (
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${s.cls}`}>{s.label}</span>
                        ) : '—';
                      })()}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      <div className="flex items-center gap-1.5">
                        {lead.unread_count > 0 && (
                          <span className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0 animate-pulse" title="הודעה חדשה שלא נקראה" />
                        )}
                        {formatDateTime(lead.last_interaction_at)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{formatDateTime(lead.received_at)}</td>
                    <td className="px-4 py-3 text-slate-600 dir-ltr text-left">
                      {lead.phone ? (
                        <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()}
                           className="text-emerald-600 hover:underline font-medium">
                          {lead.phone}
                        </a>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(lead.event_date)}</td>
                    <td className="px-4 py-3 text-slate-600">{lead.event_type || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{lead.guest_count || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SOURCE_COLORS[lead.source] || 'bg-slate-100 text-slate-600'}`}>
                        {SOURCE_LABELS[lead.source] || lead.source}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{lead.assigned_name || '—'}</td>
                    <td className="px-4 py-3">
                      {lead.overdue_tasks > 0 ? (
                        <span className="inline-flex items-center gap-1 bg-red-100 text-red-600 text-xs font-bold px-2 py-0.5 rounded-full">
                          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse inline-block" />
                          {lead.overdue_tasks}
                        </span>
                      ) : lead.open_tasks > 0 ? (
                        <span className="inline-flex items-center gap-1 bg-red-100 text-red-600 text-xs font-bold px-2 py-0.5 rounded-full">
                          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse inline-block" />
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

      {/* Lead card panel */}
      {selectedId && (
        <LeadCard
          leadId={selectedId}
          onClose={() => setSelectedId(null)}
          onUpdated={loadLeads}
        />
      )}

      {/* Add lead modal */}
      {showAdd && (
        <AddLeadModal
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); loadLeads(); }}
        />
      )}
    </div>
  );
}
