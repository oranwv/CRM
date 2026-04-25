import { useState, useEffect } from 'react';
import api from '../api';
import LeadCard from '../components/LeadCard';

const IL = { timeZone: 'Asia/Jerusalem' };

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', IL);
}

const STAGE_LABELS = {
  new: 'חדש', contacted: 'יצירת קשר', meeting: 'פגישה',
  offer_sent: 'הצעת מחיר', negotiation: 'מו"מ', contract_sent: 'חוזה נשלח',
  deposit: 'מקדמה', production: 'הפקה', lost: 'לא סגרו',
};

export default function CalendarPage() {
  const [leads, setLeads]       = useState([]);
  const [openLeadId, setOpenLeadId] = useState(null);

  useEffect(() => {
    api.get('/calendar/leads').then(r => setLeads(r.data)).catch(() => {});
  }, []);

  const today = new Date().toISOString().split('T')[0];
  const upcoming = leads
    .filter(l => l.event_date && l.event_date.split('T')[0] >= today)
    .sort((a, b) => a.event_date.localeCompare(b.event_date));

  const past = leads
    .filter(l => l.event_date && l.event_date.split('T')[0] < today)
    .sort((a, b) => b.event_date.localeCompare(a.event_date));

  const src =
    'https://calendar.google.com/calendar/embed' +
    '?src=sharabiyajaffa%40gmail.com' +
    '&ctz=Asia%2FJerusalem' +
    '&hl=he' +
    '&showTitle=0&showNav=1&showDate=1&showPrint=0&showTabs=1&showCalendars=1';

  return (
    <div className="min-h-screen">
      {/* Google Calendar iframe */}
      <div style={{ height: '60vh' }}>
        <iframe src={src} style={{ border: 0, width: '100%', height: '100%' }}
          frameBorder="0" scrolling="no" title="Google Calendar" />
      </div>

      {/* CRM leads panel */}
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 justify-end">
          <p className="text-xs text-slate-400">לחץ על ליד לפתיחת כרטיס</p>
          <span className="text-xs font-bold text-violet-700 bg-violet-100 px-2 py-1 rounded-lg">📋 לידים ביומן</span>
        </div>
        <LeadList title="אירועים קרובים" leads={upcoming} onOpen={setOpenLeadId} />
        {past.length > 0 && <LeadList title="אירועים שעברו" leads={past} onOpen={setOpenLeadId} muted />}
        {upcoming.length === 0 && past.length === 0 && (
          <p className="text-center text-sm text-slate-400 py-4">אין לידים עם תאריך אירוע</p>
        )}
      </div>

      {openLeadId && (
        <LeadCard leadId={openLeadId} onClose={() => setOpenLeadId(null)} onUpdated={() =>
          api.get('/calendar/leads').then(r => setLeads(r.data)).catch(() => {})
        } />
      )}
    </div>
  );
}

function LeadList({ title, leads, onOpen, muted }) {
  if (!leads.length) return null;
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-violet-100 overflow-hidden">
      <h3 className="text-sm font-black text-slate-700 px-4 py-3 border-b border-slate-50 text-right">{title}</h3>
      <div className="divide-y divide-slate-50">
        {leads.map(lead => (
          <button key={lead.id} onClick={() => onOpen(lead.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 text-right hover:bg-violet-50/50 transition ${muted ? 'opacity-60' : ''}`}>
            <div className="shrink-0 text-right">
              <p className="text-sm font-bold text-violet-700">{formatDate(lead.event_date)}</p>
              {lead.calendar_type === 'confirmed'
                ? <span className="text-xs text-emerald-600">✅ סגור</span>
                : lead.calendar_type === 'option'
                ? <span className="text-xs text-yellow-600">🟡 אופציה</span>
                : <span className="text-xs text-slate-400">לא מסומן</span>}
            </div>
            <div className="flex-1 min-w-0 text-right">
              <p className="text-sm font-semibold text-slate-800 truncate">{lead.name}</p>
              <p className="text-xs text-slate-400">{lead.event_type || ''} · {STAGE_LABELS[lead.stage] || lead.stage}</p>
            </div>
            <span className="text-slate-300 text-lg shrink-0">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}
