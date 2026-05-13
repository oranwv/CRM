import { useState, useEffect } from 'react';
import api from '../api';

const HEBREW_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const HEBREW_DAYS   = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];

const COLOR_CLASSES = {
  '1':  'bg-indigo-300',
  '2':  'bg-green-400',
  '3':  'bg-purple-500',
  '4':  'bg-pink-400',
  '5':  'bg-yellow-400',
  '6':  'bg-orange-400',
  '7':  'bg-teal-500',
  '8':  'bg-slate-400',
  '9':  'bg-blue-800',
  '10': 'bg-green-800',
  '11': 'bg-red-500',
};

function getColor(colorId) {
  return COLOR_CLASSES[colorId] ?? 'bg-blue-500';
}

function extractLeadId(description) {
  if (!description) return null;
  const m = description.match(/[?&]lead=(\d+)/);
  return m ? parseInt(m[1]) : null;
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString('he-IL', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem',
  });
}

function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth()    === d2.getMonth() &&
    d1.getDate()     === d2.getDate();
}

function eventDate(ev) {
  // All-day events are stored as UTC midnight; parse to local date safely
  if (ev.all_day) {
    const s = ev.start_time.split('T')[0];
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(ev.start_time);
}

export default function AppCalendar({ onOpenLead }) {
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [events, setEvents]           = useState([]);
  const [selectedDay, setSelectedDay] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);

  useEffect(() => {
    api.get(`/calendar/google-events?year=${year}&month=${month}`)
      .then(r => setEvents(r.data))
      .catch(() => {});
  }, [year, month]);

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
    setSelectedDay(null);
    setSelectedEvent(null);
  }

  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
    setSelectedDay(null);
    setSelectedEvent(null);
  }

  function goToday() {
    setYear(today.getFullYear());
    setMonth(today.getMonth() + 1);
    setSelectedDay(today);
    setSelectedEvent(null);
  }

  // Build grid cells
  const firstDayOfMonth = new Date(year, month - 1, 1);
  const daysInMonth     = new Date(year, month, 0).getDate();
  const startOffset     = firstDayOfMonth.getDay(); // 0 = Sunday
  const totalCells      = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  const cells = Array.from({ length: totalCells }, (_, i) => {
    const dayNum = i - startOffset + 1;
    return (dayNum >= 1 && dayNum <= daysInMonth) ? new Date(year, month - 1, dayNum) : null;
  });

  function eventsForDay(date) {
    return events
      .filter(ev => isSameDay(eventDate(ev), date))
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  }

  const dayEvents = selectedDay ? eventsForDay(selectedDay) : [];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-violet-100 overflow-hidden" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <button
          onClick={nextMonth}
          className="text-slate-500 hover:text-violet-700 px-3 py-1 rounded-lg hover:bg-violet-50 transition font-bold text-lg"
        >›</button>
        <div className="flex items-center gap-3">
          <h2 className="font-bold text-slate-800 text-base">
            {HEBREW_MONTHS[month - 1]} {year}
          </h2>
          <button
            onClick={goToday}
            className="text-xs text-violet-600 border border-violet-200 px-2 py-0.5 rounded-lg hover:bg-violet-50 transition"
          >היום</button>
        </div>
        <button
          onClick={prevMonth}
          className="text-slate-500 hover:text-violet-700 px-3 py-1 rounded-lg hover:bg-violet-50 transition font-bold text-lg"
        >‹</button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/50">
        {HEBREW_DAYS.map(d => (
          <div key={d} className="text-center text-xs font-bold text-slate-400 py-2">{d}</div>
        ))}
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-7 border-b border-slate-100">
        {cells.map((date, i) => {
          if (!date) {
            return <div key={i} className="min-h-[80px] border-b border-l border-slate-50 bg-slate-50/40" />;
          }
          const isToday    = isSameDay(date, today);
          const isSelected = selectedDay && isSameDay(date, selectedDay);
          const dayEvs     = eventsForDay(date);

          return (
            <div
              key={i}
              onClick={() => { setSelectedDay(isSelected ? null : date); setSelectedEvent(null); }}
              className={`min-h-[80px] border-b border-l border-slate-100 p-1 cursor-pointer transition ${
                isSelected ? 'bg-violet-50' : 'hover:bg-slate-50'
              }`}
            >
              <div className={`text-xs font-bold mb-1 w-6 h-6 flex items-center justify-center rounded-full mx-auto ${
                isToday ? 'bg-violet-600 text-white' : 'text-slate-600'
              }`}>
                {date.getDate()}
              </div>
              <div className="space-y-0.5">
                {dayEvs.slice(0, 3).map(ev => (
                  <div
                    key={ev.google_event_id}
                    onClick={e => { e.stopPropagation(); setSelectedDay(date); setSelectedEvent(ev); }}
                    className={`truncate text-xs text-white px-1 rounded cursor-pointer ${getColor(ev.color_id)}`}
                  >
                    {ev.title || '(ללא שם)'}
                  </div>
                ))}
                {dayEvs.length > 3 && (
                  <div className="text-xs text-slate-400 px-1 text-center">+{dayEvs.length - 3}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Day panel */}
      {selectedDay && !selectedEvent && (
        <div className="border-t border-slate-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setSelectedDay(null)}
              className="text-xs text-slate-400 hover:text-slate-600 transition"
            >✕</button>
            <h3 className="font-bold text-slate-700 text-sm">
              {selectedDay.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}
            </h3>
          </div>
          {dayEvents.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-3">אין אירועים ביום זה</p>
          ) : (
            <div className="space-y-1">
              {dayEvents.map(ev => (
                <button
                  key={ev.google_event_id}
                  onClick={() => setSelectedEvent(ev)}
                  className="w-full flex items-center gap-3 text-right hover:bg-violet-50 rounded-xl px-3 py-2 transition"
                >
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${getColor(ev.color_id)}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{ev.title || '(ללא שם)'}</p>
                    <p className="text-xs text-slate-400">
                      {ev.all_day ? 'כל היום' : `${formatTime(ev.start_time)} – ${formatTime(ev.end_time)}`}
                    </p>
                  </div>
                  <span className="text-slate-300 text-lg shrink-0">›</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Event detail modal */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            className="bg-white rounded-t-2xl w-full max-w-lg p-5 pb-10 space-y-4"
            dir="rtl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <button
                onClick={() => setSelectedEvent(null)}
                className="text-slate-400 hover:text-slate-600 transition text-lg leading-none"
              >✕</button>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-800 text-base">{selectedEvent.title || '(ללא שם)'}</h3>
                <span className={`w-3 h-3 rounded-full shrink-0 ${getColor(selectedEvent.color_id)}`} />
              </div>
            </div>

            <p className="text-sm text-slate-500">
              {selectedEvent.all_day
                ? 'כל היום'
                : `${formatTime(selectedEvent.start_time)} – ${formatTime(selectedEvent.end_time)}`}
            </p>

            {selectedEvent.description && (
              <p className="text-sm text-slate-600 whitespace-pre-wrap bg-slate-50 rounded-xl p-3 leading-relaxed">
                {selectedEvent.description}
              </p>
            )}

            {extractLeadId(selectedEvent.description) !== null && (
              <button
                onClick={() => {
                  onOpenLead(extractLeadId(selectedEvent.description));
                  setSelectedEvent(null);
                  setSelectedDay(null);
                }}
                className="w-full bg-violet-600 text-white font-bold py-3 rounded-xl hover:bg-violet-700 transition"
              >
                פתח ליד
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
