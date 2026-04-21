import { useState, useEffect } from 'react';
import api from '../api';

const HEBREW_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const HEBREW_DAYS   = ['א','ב','ג','ד','ה','ו','ש'];

const STAGE_STYLES = {
  new:           { label: 'חדש',        cls: 'bg-sky-100 text-sky-700' },
  contacted:     { label: 'יצירת קשר', cls: 'bg-amber-100 text-amber-700' },
  meeting:       { label: 'פגישה',      cls: 'bg-violet-100 text-violet-700' },
  offer_sent:    { label: 'הצעת מחיר', cls: 'bg-blue-100 text-blue-700' },
  negotiation:   { label: 'מו"מ',       cls: 'bg-orange-100 text-orange-700' },
  contract_sent: { label: 'חוזה נשלח', cls: 'bg-indigo-100 text-indigo-700' },
  deposit:       { label: 'מקדמה',      cls: 'bg-emerald-100 text-emerald-700' },
  production:    { label: 'הפקה',       cls: 'bg-teal-100 text-teal-700' },
  lost:          { label: 'לא סגרו',    cls: 'bg-red-100 text-red-600' },
};

export default function CalendarPage({ onOpenLead }) {
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // date string yyyy-mm-dd

  useEffect(() => {
    setLoading(true);
    api.get('/calendar/leads')
      .then(r => {
        setLeads(r.data);
        // Auto-navigate to the month of the nearest upcoming event if current month is empty
        const upcoming = r.data
          .filter(l => l.event_date && l.event_date.split('T')[0] >= today.toISOString().split('T')[0])
          .sort((a, b) => a.event_date.localeCompare(b.event_date));
        if (upcoming.length > 0) {
          const d = new Date(upcoming[0].event_date);
          setYear(d.getUTCFullYear());
          setMonth(d.getUTCMonth() + 1);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }

  // Build calendar grid
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  // Map leads to date keys
  const leadsByDate = {};
  leads.forEach(lead => {
    if (!lead.event_date) return;
    const key = lead.event_date.split('T')[0];
    if (!leadsByDate[key]) leadsByDate[key] = [];
    leadsByDate[key].push(lead);
  });

  const todayStr = today.toISOString().split('T')[0];
  const selectedLeads = selected ? (leadsByDate[selected] || []) : [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-700 via-teal-600 to-cyan-600 px-4 py-3 flex items-center justify-between shadow-lg">
        <a href="/" className="text-emerald-200 hover:text-white text-sm transition">← חזרה</a>
        <div className="text-right">
          <h1 className="text-lg font-black text-white">📅 לוח שנה</h1>
          <p className="text-emerald-200 text-xs">תאריכי אירועים</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4 space-y-4">
        {/* Month nav */}
        <div className="bg-white rounded-2xl shadow-sm border border-emerald-100 p-4">
          <div className="flex items-center justify-between mb-4">
            <button onClick={nextMonth} className="text-slate-400 hover:text-emerald-600 text-xl px-2">›</button>
            <h2 className="text-lg font-black text-slate-700">{HEBREW_MONTHS[month - 1]} {year}</h2>
            <button onClick={prevMonth} className="text-slate-400 hover:text-emerald-600 text-xl px-2">‹</button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {HEBREW_DAYS.map(d => (
              <div key={d} className="text-center text-xs font-bold text-slate-400 py-1">{d}</div>
            ))}
          </div>

          {/* Cells */}
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, i) => {
              if (!day) return <div key={`empty-${i}`} />;
              const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
              const dayLeads = leadsByDate[dateStr] || [];
              const isToday = dateStr === todayStr;
              const isSelected = dateStr === selected;
              const hasConfirmed = dayLeads.some(l => l.calendar_type === 'confirmed');
              const hasOption    = dayLeads.some(l => l.calendar_type === 'option');
              const hasUnmarked  = dayLeads.some(l => !l.calendar_type);

              return (
                <button key={dateStr} onClick={() => setSelected(isSelected ? null : dateStr)}
                  className={`relative aspect-square rounded-xl flex flex-col items-center justify-start pt-1 transition text-sm font-semibold
                    ${isSelected ? 'bg-emerald-600 text-white' : isToday ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-slate-50 text-slate-700'}
                  `}>
                  <span>{day}</span>
                  {dayLeads.length > 0 && (
                    <div className="flex gap-0.5 mt-0.5">
                      {hasConfirmed && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />}
                      {hasOption    && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />}
                      {hasUnmarked  && <span className="w-1.5 h-1.5 rounded-full bg-slate-300 inline-block" />}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex gap-4 mt-3 text-xs text-slate-400 justify-end">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> סגור</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" /> אופציה</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300 inline-block" /> לא מסומן</span>
          </div>
        </div>

        {/* Selected date leads */}
        {selected && (
          <div className="bg-white rounded-2xl shadow-sm border border-emerald-100 p-4">
            <h3 className="text-sm font-black text-slate-700 text-right mb-3">
              אירועים ב-{new Date(selected).toLocaleDateString('he-IL')}
            </h3>
            {selectedLeads.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">אין אירועים ביום זה</p>
            ) : (
              <div className="space-y-2">
                {selectedLeads.map(lead => (
                  <CalendarLeadCard key={lead.id} lead={lead} onOpen={onOpenLead} onUpdated={() => {
                    api.get('/calendar/leads').then(r => setLeads(r.data));
                  }} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Upcoming events list */}
        <div className="bg-white rounded-2xl shadow-sm border border-emerald-100 p-4">
          <h3 className="text-sm font-black text-slate-700 text-right mb-3">אירועים קרובים</h3>
          {loading ? (
            <p className="text-sm text-slate-400 text-center py-4">טוען...</p>
          ) : (
            <div className="space-y-2">
              {leads
                .filter(l => l.event_date && l.event_date >= todayStr)
                .slice(0, 10)
                .map(lead => (
                  <CalendarLeadCard key={lead.id} lead={lead} onOpen={onOpenLead} onUpdated={() => {
                    api.get('/calendar/leads').then(r => setLeads(r.data));
                  }} />
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CalendarLeadCard({ lead, onOpen, onUpdated }) {
  const [marking, setMarking] = useState(false);

  async function mark(type) {
    setMarking(true);
    try {
      await api.post(`/calendar/leads/${lead.id}/mark`, { type });
      await onUpdated();
    } catch { alert('שגיאה בסימון'); }
    setMarking(false);
  }

  const stage = STAGE_STYLES[lead.stage];
  const calType = lead.calendar_type;

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:border-emerald-200 transition">
      <div className="flex gap-1.5 shrink-0">
        <button onClick={() => mark('option')} disabled={marking}
          className={`text-xs font-bold px-2 py-1 rounded-lg transition border ${calType === 'option' ? 'bg-yellow-400 text-white border-yellow-400' : 'border-slate-200 text-slate-400 hover:border-yellow-300 hover:text-yellow-600'}`}>
          אופציה
        </button>
        <button onClick={() => mark('confirmed')} disabled={marking}
          className={`text-xs font-bold px-2 py-1 rounded-lg transition border ${calType === 'confirmed' ? 'bg-emerald-500 text-white border-emerald-500' : 'border-slate-200 text-slate-400 hover:border-emerald-300 hover:text-emerald-600'}`}>
          סגור ✅
        </button>
      </div>
      <div className="flex-1 text-right cursor-pointer" onClick={() => onOpen && onOpen(lead.id)}>
        <p className="text-sm font-semibold text-slate-800">{lead.name}</p>
        <div className="flex items-center gap-2 justify-end mt-0.5">
          {lead.event_type && <span className="text-xs text-slate-400">{lead.event_type}</span>}
          {stage && <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${stage.cls}`}>{stage.label}</span>}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-bold text-slate-700">
          {new Date(lead.event_date).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })}
        </p>
        {calType === 'confirmed' && <span className="text-xs text-emerald-600">✅ סגור</span>}
        {calType === 'option'    && <span className="text-xs text-yellow-600">🟡 אופציה</span>}
      </div>
    </div>
  );
}
