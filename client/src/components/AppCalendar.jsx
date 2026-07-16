import { useState, useEffect, useRef } from 'react';
import api from '../api';

const HEBREW_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const HEBREW_DAYS   = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];
const HOUR_HEIGHT   = 64; // px per hour → 1px ≈ 1 minute

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

function getColor(colorId, source) {
  if (source === 'holiday') return 'bg-[#0b8043]'; // Google Calendar holiday green
  if (source === 'manual')  return 'bg-[#795548]'; // brown — manually added CRM events
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
    d1.getMonth()  === d2.getMonth() &&
    d1.getDate()   === d2.getDate();
}

function eventDate(ev) {
  if (ev.all_day) {
    const [y, m, d] = ev.start_time.split('T')[0].split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(ev.start_time);
}

// Returns minutes since midnight in Asia/Jerusalem for a UTC datetime string
function toJerusalemMins(dateStr) {
  const d = new Date(dateStr);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const h = parseInt(parts.find(p => p.type === 'hour').value);
  const m = parseInt(parts.find(p => p.type === 'minute').value);
  return h * 60 + m;
}

// Assign events to columns so overlapping events sit side-by-side
function computeColumns(timedEvents) {
  const sorted = [...timedEvents].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  const columns = [];

  for (const ev of sorted) {
    const start = new Date(ev.start_time);
    let placed  = false;
    for (let col = 0; col < columns.length; col++) {
      const last = columns[col][columns[col].length - 1];
      if (new Date(last.end_time) <= start) {
        columns[col].push(ev);
        placed = true;
        break;
      }
    }
    if (!placed) columns.push([ev]);
  }

  const posMap   = {};
  const totalCols = columns.length || 1;
  for (let col = 0; col < columns.length; col++) {
    for (const ev of columns[col]) {
      posMap[ev.google_event_id] = { col, totalCols };
    }
  }
  return posMap;
}

function DayView({ date, events, onClose, onSelectEvent }) {
  const scrollRef = useRef(null);

  const allDay = events.filter(ev => ev.all_day);
  const timed  = events.filter(ev => !ev.all_day)
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  const colMap = computeColumns(timed);

  // Auto-scroll: 1 hour before first event, or 07:00 by default
  useEffect(() => {
    if (!scrollRef.current) return;
    let scrollMins = 7 * 60;
    if (timed.length > 0) {
      scrollMins = Math.max(0, toJerusalemMins(timed[0].start_time) - 60);
    }
    scrollRef.current.scrollTop = (scrollMins / 60) * HOUR_HEIGHT;
  }, [date.toDateString()]);

  function getEventStyle(ev) {
    const startMins = toJerusalemMins(ev.start_time);
    let   endMins   = toJerusalemMins(ev.end_time);
    if (endMins <= startMins) endMins += 24 * 60; // midnight-crossing event
    const durationMins = Math.max(endMins - startMins, 30);

    const { col, totalCols } = colMap[ev.google_event_id] || { col: 0, totalCols: 1 };
    const widthPct = 100 / totalCols;

    return {
      position: 'absolute',
      top:    `${startMins * (HOUR_HEIGHT / 60)}px`,
      height: `${durationMins * (HOUR_HEIGHT / 60)}px`,
      left:   `calc(${col * widthPct}% + 4px)`,
      width:  `calc(${widthPct}% - 8px)`,
    };
  }

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0 bg-white">
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition text-lg"
        >✕</button>
        <h2 className="font-bold text-slate-800 text-base">
          {date.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </h2>
        <div className="w-8" />
      </div>

      {/* All-day strip */}
      {allDay.length > 0 && (
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 shrink-0">
          <p className="text-xs text-slate-400 mb-1.5">כל היום</p>
          <div className="flex flex-wrap gap-1.5">
            {allDay.map(ev => (
              <button
                key={ev.google_event_id}
                onClick={() => onSelectEvent(ev)}
                className={`text-xs text-white px-2 py-1 rounded font-semibold hover:opacity-90 transition ${getColor(ev.color_id, ev.source)}`}
              >
                {ev.title || '(ללא שם)'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Scrollable 24-hour grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="flex" style={{ height: `${24 * HOUR_HEIGHT}px` }}>

          {/* Hour labels */}
          <div className="w-14 shrink-0 border-l border-slate-100 bg-white">
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                style={{ height: `${HOUR_HEIGHT}px` }}
                className="border-b border-slate-100 flex items-start justify-end pr-2 pt-1"
              >
                <span className="text-xs text-slate-400 select-none">
                  {String(h).padStart(2, '0')}:00
                </span>
              </div>
            ))}
          </div>

          {/* Events area */}
          <div className="flex-1 relative">
            {/* Hour lines */}
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                style={{ height: `${HOUR_HEIGHT}px` }}
                className="border-b border-slate-100"
              />
            ))}

            {/* Half-hour guide lines */}
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={`half-${h}`}
                style={{
                  position: 'absolute',
                  top: `${h * HOUR_HEIGHT + HOUR_HEIGHT / 2}px`,
                  left: 0, right: 0,
                  borderBottom: '1px dashed #f1f5f9',
                  pointerEvents: 'none',
                }}
              />
            ))}

            {/* Event blocks */}
            {timed.map(ev => (
              <button
                key={ev.google_event_id}
                style={getEventStyle(ev)}
                onClick={() => onSelectEvent(ev)}
                className={`text-right overflow-hidden cursor-pointer hover:opacity-90 transition rounded-lg ${getColor(ev.color_id, ev.source)}`}
              >
                <div className="px-2 py-1 h-full flex flex-col justify-start gap-0.5">
                  <p className="text-xs font-bold text-white truncate leading-tight">
                    {ev.title || '(ללא שם)'}
                  </p>
                  <p className="text-xs text-white/80 leading-tight">
                    {formatTime(ev.start_time)} – {formatTime(ev.end_time)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Google-Calendar-style "add event" dialog: title, all-day toggle, start/end time, description.
function AddEventModal({ defaultDate, onClose, onSaved }) {
  const toDateStr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const [title, setTitle]             = useState('');
  const [date, setDate]               = useState(toDateStr(defaultDate || new Date()));
  const [allDay, setAllDay]           = useState(false);
  const [startTime, setStartTime]     = useState('');
  const [endTime, setEndTime]         = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  const inputCls = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400';

  async function save() {
    if (!title.trim())          return setError('נא להזין כותרת');
    if (!date)                  return setError('נא לבחור תאריך');
    if (!allDay && !startTime)  return setError('נא לבחור שעת התחלה');
    setError('');
    setSaving(true);
    try {
      await api.post('/calendar/events', { title, description, date, startTime, endTime, allDay });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה בשמירת האירוע');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-5 w-full max-w-sm space-y-3" dir="rtl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-slate-800 text-base">אירוע חדש</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition text-lg leading-none">✕</button>
        </div>

        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="הוסף כותרת"
          className="w-full border-b-2 border-slate-200 focus:border-violet-500 px-1 py-2 text-lg font-semibold focus:outline-none"
        />

        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">תאריך</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
          <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)}
            className="w-4 h-4 accent-violet-600" />
          כל היום
        </label>

        {!allDay && (
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs font-bold text-slate-500 mb-1">שעת התחלה</label>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className={inputCls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-bold text-slate-500 mb-1">שעת סיום</label>
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className={inputCls} />
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">תיאור</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            placeholder="הוסף תיאור (אופציונלי)"
            className={`${inputCls} resize-none`}
          />
        </div>

        {error && <p className="text-xs text-red-500 font-semibold">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="border-2 border-slate-200 text-slate-500 font-bold py-2.5 px-4 rounded-xl hover:bg-slate-50 transition">ביטול</button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 bg-violet-600 text-white font-bold py-2.5 rounded-xl hover:bg-violet-700 transition disabled:opacity-50"
          >
            {saving ? 'שומר...' : 'שמור'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AppCalendar({ onOpenLead }) {
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [events, setEvents]               = useState([]);
  const [selectedDay, setSelectedDay]     = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showAddEvent, setShowAddEvent]   = useState(false);
  const [deletingEvent, setDeletingEvent] = useState(false);

  function loadEvents() {
    api.get(`/calendar/google-events?year=${year}&month=${month}`)
      .then(r => setEvents(r.data))
      .catch(() => {});
  }

  useEffect(loadEvents, [year, month]);

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

  const firstDayOfMonth = new Date(year, month - 1, 1);
  const daysInMonth     = new Date(year, month, 0).getDate();
  const startOffset     = firstDayOfMonth.getDay();
  const totalCells      = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  const cells = Array.from({ length: totalCells }, (_, i) => {
    const dayNum = i - startOffset + 1;
    return (dayNum >= 1 && dayNum <= daysInMonth) ? new Date(year, month - 1, dayNum) : null;
  });

  function eventsForDay(date) {
    return events
      .filter(ev => isSameDay(eventDate(ev), date))
      .sort((a, b) => {
        // Holidays first (like Google Calendar), then by start time
        const hol = (b.source === 'holiday') - (a.source === 'holiday');
        if (hol !== 0) return hol;
        return new Date(a.start_time) - new Date(b.start_time);
      });
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-violet-100 overflow-hidden" dir="rtl">

      {/* Month header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <button onClick={nextMonth} className="text-slate-500 hover:text-violet-700 px-3 py-1 rounded-lg hover:bg-violet-50 transition font-bold text-lg">‹</button>
        <div className="flex items-center gap-3">
          <h2 className="font-bold text-slate-800 text-base">{HEBREW_MONTHS[month - 1]} {year}</h2>
          <button onClick={goToday} className="text-xs text-violet-600 border border-violet-200 px-2 py-0.5 rounded-lg hover:bg-violet-50 transition">היום</button>
          <button
            onClick={() => setShowAddEvent(true)}
            title="הוסף אירוע"
            className="w-6 h-6 flex items-center justify-center rounded-full bg-violet-600 text-white text-base font-bold leading-none hover:bg-violet-700 transition"
          >+</button>
        </div>
        <button onClick={prevMonth} className="text-slate-500 hover:text-violet-700 px-3 py-1 rounded-lg hover:bg-violet-50 transition font-bold text-lg">›</button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/50">
        {HEBREW_DAYS.map(d => (
          <div key={d} className="text-center text-xs font-bold text-slate-400 py-2">{d}</div>
        ))}
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-7">
        {cells.map((date, i) => {
          if (!date) {
            return <div key={i} className="min-h-[80px] border-b border-l border-slate-50 bg-slate-50/40" />;
          }
          const isToday = isSameDay(date, today);
          const dayEvs  = eventsForDay(date);

          return (
            <div
              key={i}
              onClick={() => { setSelectedDay(date); setSelectedEvent(null); }}
              className="min-h-[80px] border-b border-l border-slate-100 p-1 cursor-pointer transition hover:bg-slate-50"
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
                    className={`truncate text-xs text-white px-1 rounded ${getColor(ev.color_id, ev.source)}`}
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

      {/* Day view — full-screen overlay */}
      {selectedDay && (
        <DayView
          date={selectedDay}
          events={eventsForDay(selectedDay)}
          onClose={() => { setSelectedDay(null); setSelectedEvent(null); }}
          onSelectEvent={setSelectedEvent}
        />
      )}

      {/* Event detail modal — sits above DayView */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40"
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
                <span className={`w-3 h-3 rounded-full shrink-0 ${getColor(selectedEvent.color_id, selectedEvent.source)}`} />
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

            {selectedEvent.source === 'manual' && (
              <button
                disabled={deletingEvent}
                onClick={async () => {
                  if (!window.confirm('למחוק את האירוע? הוא יימחק גם מיומן הגוגל.')) return;
                  setDeletingEvent(true);
                  try {
                    await api.delete(`/calendar/events/${encodeURIComponent(selectedEvent.google_event_id)}`);
                    setSelectedEvent(null);
                    loadEvents();
                  } catch {
                    alert('שגיאה במחיקת האירוע');
                  } finally {
                    setDeletingEvent(false);
                  }
                }}
                className="w-full border-2 border-red-200 text-red-500 font-bold py-2.5 rounded-xl hover:bg-red-50 transition disabled:opacity-50"
              >
                {deletingEvent ? 'מוחק...' : 'מחק אירוע'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Add-event dialog */}
      {showAddEvent && (
        <AddEventModal
          defaultDate={selectedDay || today}
          onClose={() => setShowAddEvent(false)}
          onSaved={loadEvents}
        />
      )}
    </div>
  );
}
