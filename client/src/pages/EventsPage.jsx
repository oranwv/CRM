import { useState, useEffect, useCallback } from 'react';
import api from '../api';
import LeadCard from '../components/LeadCard';

function formatEventDate(lead) {
  if (lead.event_date_text) return lead.event_date_text;
  if (!lead.event_date) return null;
  const d = new Date(lead.event_date);
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const STAGE_LABEL = { deposit: 'התקבלה מקדמה', production: 'הפקה' };
const STAGE_CLS   = { deposit: 'bg-emerald-100 text-emerald-700', production: 'bg-teal-100 text-teal-700' };

export default function EventsPage() {
  const [leads, setLeads]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [openLeadId, setOpenLeadId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/leads', { params: { tab: 'closed' } });
      // Sort by event_date ascending (upcoming first), nulls last
      const sorted = [...data].sort((a, b) => {
        if (!a.event_date && !b.event_date) return 0;
        if (!a.event_date) return 1;
        if (!b.event_date) return -1;
        return new Date(a.event_date) - new Date(b.event_date);
      });
      setLeads(sorted);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-violet-50 to-indigo-50" dir="rtl">
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-violet-100 px-4 pt-4 pb-3">
        <h1 className="text-xl font-black text-slate-800">אירועים</h1>
        <p className="text-xs text-slate-400 mt-0.5">{leads.length} אירועים סגורים</p>
      </div>

      <div className="px-4 py-4 space-y-3">
        {loading && (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-violet-300 border-t-violet-600 rounded-full animate-spin" />
          </div>
        )}

        {!loading && leads.length === 0 && (
          <div className="text-center py-16 text-slate-400 text-sm">אין אירועים סגורים</div>
        )}

        {!loading && leads.map(lead => {
          const dateStr = formatEventDate(lead);
          return (
            <button
              key={lead.id}
              onClick={() => setOpenLeadId(lead.id)}
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
        })}
      </div>

      {openLeadId && (
        <LeadCard
          leadId={openLeadId}
          onClose={() => { setOpenLeadId(null); load(); }}
        />
      )}
    </div>
  );
}
