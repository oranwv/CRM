import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api';
import LeadCard from '../components/LeadCard';
import AddLeadModal from '../components/AddLeadModal';

const TABS = [
  { key: 'new',        label: 'חדשים' },
  { key: 'in_process', label: 'בתהליך' },
  { key: 'closed',     label: 'סגרו עסקה' },
  { key: 'lost',       label: 'לא סגרו' },
];

const SOURCE_LABELS = {
  website_popup: 'אתר (פופאפ)', website_form: 'אתר (טופס)',
  call_event: 'Call Event', telekol: 'טלקול',
  whatsapp: 'וואטסאפ', facebook: 'פייסבוק',
  instagram: 'אינסטגרם', manual: 'ידני',
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

const AVATAR_GRADIENTS = [
  'from-sky-400 to-blue-500',
  'from-amber-400 to-orange-500',
  'from-rose-400 to-pink-500',
  'from-emerald-400 to-teal-500',
  'from-violet-400 to-purple-500',
  'from-indigo-400 to-blue-600',
];

const IL = { timeZone: 'Asia/Jerusalem' };

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
      <div className="text-stone-400 text-xs">{parts.time}</div>
    </div>
  );
}

function waLink(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  const international = digits.startsWith('972') ? digits : '972' + digits.replace(/^0/, '');
  return `https://wa.me/${international}`;
}

export default function LeadsPage() {
  const [tab, setTab] = useState('new');
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const user = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const [searchParams, setSearchParams] = useSearchParams();

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
      setApiError(false);
    } catch (err) {
      console.error('Failed to load leads:', err);
      setApiError(true);
    }
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

  return (
    <div className="min-h-screen pb-16">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-amber-100 px-4 py-3 flex items-center gap-3 shadow-sm sticky top-0 z-20">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-black text-base shrink-0"
          style={{ background: 'linear-gradient(135deg, #d97706, #b45309)' }}
        >
          ש
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-black text-stone-900 leading-tight">שרביה CRM</h1>
          <p className="text-stone-400 text-xs leading-tight">{user.display_name}</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="text-white text-sm font-bold px-4 py-2 rounded-xl transition shrink-0"
          style={{ background: 'linear-gradient(135deg, #d97706, #b45309)', boxShadow: '0 2px 8px rgba(217,119,6,0.3)' }}>
          + ליד חדש
        </button>
        <button onClick={handleLogout} className="text-stone-400 hover:text-stone-600 text-xs transition shrink-0">
          יציאה
        </button>
      </div>

      {/* Tabs */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex gap-1 bg-amber-100/70 rounded-xl p-1">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition ${
                tab === t.key
                  ? 'bg-white text-stone-800 shadow-sm'
                  : 'text-stone-500 hover:text-stone-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="px-4 pb-3">
        <input
          type="text"
          placeholder="חיפוש לפי שם, טלפון או אימייל..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full border border-amber-200 bg-amber-50 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 transition"
        />
      </div>

      {/* Table */}
      <div className="px-4 pb-6 overflow-x-auto" dir="rtl">
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
        ) : leads.length === 0 ? (
          <div className="text-center py-16 text-stone-400">
            <p className="text-3xl mb-2">📭</p>
            <p className="text-sm">אין לידים בקטגוריה זו</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-amber-100 overflow-hidden mt-2">
            <table className="w-full text-xs min-w-[900px]">
              <thead>
                <tr className="bg-amber-50/60 text-xs font-bold text-stone-500 uppercase tracking-wide border-b border-amber-100">
                  <th className="px-2 py-3 text-right">#</th>
                  <th className="px-2 py-3 text-right">שם</th>
                  <th className="px-2 py-3 text-right">סטטוס</th>
                  <th className="px-2 py-3 text-right">פעילות אחרונה</th>
                  <th className="px-2 py-3 text-right">התקבל ב</th>
                  <th className="px-2 py-3 text-right">טלפון</th>
                  <th className="px-2 py-3 text-right">תאריך אירוע</th>
                  <th className="px-2 py-3 text-right">סוג אירוע</th>
                  <th className="px-2 py-3 text-right">מוזמנים</th>
                  <th className="px-2 py-3 text-right">מקור</th>
                  <th className="px-2 py-3 text-right">אחראי</th>
                  <th className="px-2 py-3 text-right">משימות</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-50">
                {leads.map((lead, idx) => (
                  <tr
                    key={lead.id}
                    onClick={() => setSelectedId(lead.id)}
                    className="hover:bg-amber-50/40 cursor-pointer transition"
                  >
                    <td className="px-2 py-3 text-stone-400 font-medium">{idx + 1}</td>
                    <td className="px-2 py-3 font-semibold text-stone-800">
                      <div className="flex items-center gap-1.5">
                        {lead.avatar_url
                          ? <img src={lead.avatar_url} className="w-7 h-7 rounded-full object-cover shrink-0" onError={e => e.target.style.display='none'} />
                          : <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center text-xs font-bold text-amber-700 shrink-0">
                              {(lead.name || '?')[0]}
                            </div>
                        }
                        <span className="flex items-center gap-0.5">
                          {PRIORITY_ICONS[lead.priority] && (
                            <span>{PRIORITY_ICONS[lead.priority]}</span>
                          )}
                          {lead.name || '—'}
                        </span>
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
                    <td className="px-2 py-3 text-stone-500">
                      <div className="flex items-center gap-1">
                        {lead.unread_count > 0 && (
                          <span className="w-2 h-2 rounded-full bg-green-500 shrink-0 animate-pulse" title="הודעה חדשה שלא נקראה" />
                        )}
                        <DateTimeCell value={lead.last_interaction_at} />
                      </div>
                    </td>
                    <td className="px-2 py-3 text-stone-500"><DateTimeCell value={lead.received_at} /></td>
                    <td className="px-2 py-3 text-stone-600" dir="ltr" style={{ textAlign: 'left' }}>
                      {lead.phone ? (
                        <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()}
                           className="text-amber-700 hover:underline font-medium">
                          {lead.phone}
                        </a>
                      ) : '—'}
                    </td>
                    <td className="px-2 py-3 text-stone-600">{formatDate(lead.event_date)}</td>
                    <td className="px-2 py-3 text-stone-600">{lead.event_type || '—'}</td>
                    <td className="px-2 py-3 text-stone-600">{lead.guest_count || '—'}</td>
                    <td className="px-2 py-3">
                      <span className={`font-semibold px-2 py-0.5 rounded-full ${SOURCE_COLORS[lead.source] || 'bg-stone-100 text-stone-600'}`}>
                        {SOURCE_LABELS[lead.source] || lead.source}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-stone-500">{lead.assigned_name || '—'}</td>
                    <td className="px-2 py-3">
                      {lead.overdue_tasks > 0 ? (
                        <span className="inline-flex items-center gap-1 bg-red-100 text-red-600 font-bold px-2 py-0.5 rounded-full">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
                          {lead.overdue_tasks}
                        </span>
                      ) : lead.open_tasks > 0 ? (
                        <span className="inline-flex items-center gap-1 bg-red-100 text-red-600 font-bold px-2 py-0.5 rounded-full">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
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
