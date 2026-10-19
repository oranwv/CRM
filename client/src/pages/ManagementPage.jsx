import { useState, useEffect, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

export const METRIC_COLS = [
  { key: 'calls_made',          label: 'שיחות שבוצעו' },
  { key: 'call_minutes',        label: 'דקות שיחה' },
  { key: 'calls_documented',    label: 'שיחות שתועדו' },
  { key: 'meetings_booked',     label: 'פגישות נקבעו' },
  { key: 'meetings_done',       label: 'פגישות שבוצעו' },
  { key: 'meetings_documented', label: 'פגישות שתועדו' },
  { key: 'notes',               label: 'הערות' },
  { key: 'wa_sent',             label: 'WA נשלח' },
  { key: 'tasks_created',       label: 'משימות נוצרו' },
  { key: 'tasks_completed',     label: 'משימות הושלמו' },
  { key: 'leads_created',       label: 'לידים' },
  { key: 'files_uploaded',      label: 'קבצים' },
];

export const dayStr = d => d.toISOString().slice(0, 10);
export function shiftDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return dayStr(d); }

// Decimal hours → "H:MM"
export function fmtHours(h) {
  if (!h) return '—';
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

// Activity total = number of actions; talk minutes are a duration, not an action, so they stay out.
export const metricTotal = obj => METRIC_COLS.reduce((s, c) => c.key === 'call_minutes' ? s : s + Number(obj[c.key] || 0), 0);

// Phase 51 — per-lead activity line under each day (what the employee did with which customer)
const STAGE_LABELS = {
  new: 'חדש', new_no_answer: 'חדש ולא עונה', contacted: 'בוצעה שיחה ראשונית',
  meeting_scheduled: 'נקבעה פגישה', meeting: 'בוצעה פגישה',
  offer_sent: 'נשלחה הצעת מחיר', negotiation: 'מו"מ',
  contract_sent: 'חוזה נשלח', process_no_answer: 'בתהליך ונעלם / לא עונה',
  deposit: 'התקבלה מקדמה', production: 'הפקה', completed: 'הסתיים ושולם', lost: 'לא סגרו',
};
const stageLabel = k => STAGE_LABELS[k] || k || '—';
const fmtDM = iso => { if (!iso) return ''; const d = new Date(iso); return `${d.getDate()}.${d.getMonth() + 1}`; };
const trunc = (t, n = 70) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// שיחה column: phone icon + minutes (count when more than one call).
const fmtMeetingMin = m => m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} ש'` : `${m} דק'`;
function callText(L) {
  const parts = [];
  if (L.calls > 0) parts.push(`📞 ${L.calls > 1 ? `${L.calls} שיחות · ` : ''}${L.minutes} דק'`);
  if (L.meetings_held > 0) parts.push(`🤝 ${L.meetings_held > 1 ? `${L.meetings_held} פגישות · ` : ''}${fmtMeetingMin(L.meeting_minutes)}`);
  return parts.length ? parts.join(' · ') : '📞 —';
}

// "מה נעשה": the day's actions as colored word-chips joined by "+", in order of happening.
// Repeated kinds collapse into "×n". The stage change (with from ← to) closes the chain.
const CHIP = {
  meeting_booked: a => `קביעת פגישה${a.start ? ' ' + fmtDM(a.start) : ''}`,
  meeting_done:   () => 'פגישה בוצעה',
  meeting_doc:    () => 'פגישה תועדה',
  offer:          () => 'הצעת מחיר',
  contract:       () => 'שליחת חוזה',
  wa:             () => 'הודעת וואטסאפ',
  note:           () => 'הערה',
  task:           () => 'משימה',
  file:           () => 'קובץ',
  lead_created:   () => 'ליד נוצר',
};
const CHIP_CLS = {
  call: 'bg-slate-200 text-slate-800', attempt: 'bg-red-100 text-red-700',
  meeting_booked: 'bg-sky-100 text-sky-700', meeting_done: 'bg-sky-100 text-sky-700', meeting_doc: 'bg-sky-100 text-sky-700',
  offer: 'bg-amber-100 text-amber-700', contract: 'bg-emerald-100 text-emerald-700', signed: 'bg-emerald-100 text-emerald-700',
  stage: 'bg-violet-100 text-violet-700', stage_lost: 'bg-red-100 text-red-700',
  meeting_undoc: 'bg-amber-50 text-amber-700 border border-amber-200',
};
const LOST_LABELS = new Set(['לא סגרו', 'אבוד']);

// Stage transition of the day → { from, to, lost } (labels), or null.
function transitionOf(L) {
  if (L.stage_to) return { from: L.stage_from ? stageLabel(L.stage_from) : null, to: stageLabel(L.stage_to), lost: L.stage_to === 'lost' };
  if (L.stage_text) { // legacy timeline note "<from> ← <to>"
    const [from, to] = L.stage_text.replace(/אבוד/g, 'לא סגרו').split(' ← ');
    return { from: to ? from : null, to: to || from, lost: LOST_LABELS.has((to || from || '').trim()) };
  }
  return null;
}

function chipsOf(L, tr) {
  const out = [];
  const push = (kind, label) => {
    const prev = out.find(c => c.label === label && ['wa', 'note', 'task', 'file'].includes(kind));
    if (prev) prev.n += 1; else out.push({ kind, label, n: 1 });
  };
  if (L.calls > 0 || L.call_doc) push('call', 'שיחת טלפון');
  if (L.attempts > 0) push('attempt', `אין מענה ×${L.attempts}`);
  if (L.meetings_held > 0) push('meeting_done', L.meetings_held > 1 ? `פגישה בוצעה ×${L.meetings_held}` : 'פגישה בוצעה');
  if (L.meetings_undocumented > 0) push('meeting_undoc', 'פגישה ביומן ללא סיכום');
  (L.actions || []).forEach(a => {
    if (a.kind === 'meeting_doc' && L.meetings_held > 0) return; // the summary is what made the meeting count as held
    const f = CHIP[a.kind]; if (!f) return;
    push(a.kind, f(a));
    if (a.kind === 'contract' && a.signed) push('signed', '✓ החוזה נחתם');
  });
  if (tr) push(tr.lost ? 'stage_lost' : 'stage', `שינוי סטטוס: ${tr.from ? tr.from + ' ← ' : ''}${tr.to}`);
  return out;
}

const Chip = ({ kind, children }) => (
  <span className={`inline-block px-1.5 sm:px-2 py-0.5 rounded-lg sm:rounded-full font-semibold leading-snug sm:whitespace-nowrap ${CHIP_CLS[kind] || 'bg-slate-100 text-slate-600'}`}>{children}</span>
);

// The customer lines as a real table: לקוח │ שיחה / פגישה │ מה נעשה │ שלב │ שעה, with vertical
// rules between the columns. Phone (< sm): four fixed columns that fit the screen, "מה נעשה" and
// "שלב" wrap onto 2–3 lines, the time sits under the name and the stage change stacks with ↓.
// Desktop (sm+): one line per customer, time in its own column, horizontal ←, sideways scroll
// if ever needed. Approved by Oran from the phone mock-up on 2026-10-19. `days`: [{ date, leads, meta? }].
const TD = 'px-1 py-1 sm:px-3 sm:py-1.5 align-top sm:align-middle border-l border-slate-200 last:border-l-0 break-words';
// true below Tailwind's `sm` (640px) — the phone layout has 4 columns, the desktop one 5, and a
// table-fixed layout reserves space for every column a colSpan mentions, so the count must match.
function useIsPhone() {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const fn = e => setPhone(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return phone;
}
export function LeadActivityTable({ days, onOpen, loading, empty }) {
  const phone = useIsPhone();
  const span = phone ? 4 : 5;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="text-[11px] sm:text-xs leading-snug border-collapse w-full table-fixed sm:table-auto sm:min-w-[700px]">
        <colgroup>
          <col style={{ width: phone ? 76 : 150 }} />
          <col style={{ width: phone ? 58 : 130 }} />
          <col />
          <col style={{ width: phone ? 82 : 260 }} />
          {!phone && <col style={{ width: 56 }} />}
        </colgroup>
        <thead>
          <tr className="bg-violet-50 text-violet-700">
            <th className={`${TD} text-right font-black`}>לקוח</th>
            <th className={`${TD} text-right font-black`}>שיחה / פגישה</th>
            <th className={`${TD} text-right font-black`}>מה נעשה</th>
            <th className={`${TD} text-right font-black`}>שלב</th>
            {!phone && <th className={`${TD} text-center font-black`}>שעה</th>}
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={span} className="px-3 py-2 text-slate-400">טוען לקוחות...</td></tr>}
          {!loading && days.length === 0 && <tr><td colSpan={span} className="px-3 py-2 text-slate-400">{empty || 'אין פעילות מול לקוחות בטווח זה'}</td></tr>}
          {days.map(d => (
            <Fragment key={d.date}>
              <tr className="bg-slate-100 text-slate-600">
                <td colSpan={span} className="px-2 sm:px-3 py-1 font-bold tabular-nums text-[11px]">
                  {d.date}{d.meta ? <span className="font-normal text-slate-500 mr-3">{d.meta}</span> : null}
                </td>
              </tr>
              {d.leads.length === 0 && <tr><td colSpan={span} className="px-3 py-1.5 text-slate-400">אין פעילות מול לקוחות ביום זה</td></tr>}
              {d.leads.map(L => {
                const tr = transitionOf(L);
                const chips = chipsOf(L, tr);
                const afterCls = tr?.lost ? 'bg-red-600 text-white' : 'bg-violet-600 text-white';
                return (
                  <tr key={`${d.date}-${L.lead_id}`} className="border-t border-slate-100 hover:bg-violet-50/40">
                    <td className={TD}>
                      <button onClick={() => onOpen(L)} className="font-bold text-violet-700 hover:underline text-right leading-tight break-words" title={L.name || ''}>{L.name || `ליד #${L.lead_id}`}</button>
                      {phone && <span className="block text-slate-400 tabular-nums text-[11px] mt-0.5">{L.last_time}</span>}
                    </td>
                    <td className={`${TD} tabular-nums font-semibold leading-snug ${L.calls > 0 || L.meetings_held > 0 ? 'text-slate-800' : 'text-slate-400'}`}
                      title={[L.call_summary ? trunc(L.call_summary, 300) : '', L.meetings_held > 0 ? 'משך הפגישה לפי היומן' : ''].filter(Boolean).join('\n') || undefined}>
                      {callText(L).split(' · ').map((t, i) => <span key={i} className="block whitespace-nowrap">{t}</span>)}
                    </td>
                    <td className={TD}>
                      <div className="flex flex-wrap items-center gap-1">
                        {chips.length === 0 && <span className="text-slate-300">—</span>}
                        {chips.map((c, i) => (
                          <Fragment key={i}>
                            {i > 0 && <span className="hidden sm:inline text-slate-300 font-bold">+</span>}
                            <Chip kind={c.kind}>{c.label}{c.n > 1 ? ` ×${c.n}` : ''}</Chip>
                          </Fragment>
                        ))}
                      </div>
                    </td>
                    <td className={TD}>
                      {tr ? (
                        <div className="flex flex-col items-start gap-0.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-1">
                          {tr.from && <span className="px-1.5 sm:px-2 py-0.5 rounded-lg sm:rounded-full font-bold bg-violet-50 text-violet-700 leading-snug">{tr.from}</span>}
                          {tr.from && <span className="text-violet-700 font-black px-1 leading-none"><span className="sm:hidden">↓</span><span className="hidden sm:inline">←</span></span>}
                          <span className={`px-1.5 sm:px-2 py-0.5 rounded-lg sm:rounded-full font-bold leading-snug ${afterCls}`}>{tr.to}</span>
                        </div>
                      ) : (
                        <span className={`inline-block px-1.5 sm:px-2 py-0.5 rounded-lg sm:rounded-full font-bold leading-snug ${L.current_stage === 'lost' ? 'bg-red-100 text-red-700' : 'bg-violet-50 text-violet-700'}`}>{stageLabel(L.current_stage)}</span>
                      )}
                    </td>
                    {!phone && <td className={`${TD} text-center text-slate-400 tabular-nums`}>{L.last_time}</td>}
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ManagementPage() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const isManager = ['admin', 'manager'].includes(user.role);

  const todayStr = dayStr(new Date());
  const [from, setFrom] = useState(todayStr);
  const [to, setTo]     = useState(todayStr);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [leadActivity, setLeadActivity] = useState({}); // uid -> [{ date, leads:[...] }] | 'loading'

  useEffect(() => {
    if (!isManager) { navigate('/'); return; }
  }, []);

  useEffect(() => {
    if (!isManager) return;
    setLoading(true);
    api.get(`/analytics/employee-activity?from=${from}&to=${to}`)
      .then(r => setRows(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
    setLeadActivity({}); // range changed → per-user lead lines are stale
  }, [from, to]);

  // Lead lines are fetched the first time a user is opened for the current range.
  useEffect(() => {
    expanded.forEach(uid => {
      if (leadActivity[uid] !== undefined) return;
      setLeadActivity(prev => ({ ...prev, [uid]: 'loading' }));
      api.get(`/analytics/employee-activity/${uid}/leads?from=${from}&to=${to}`)
        .then(r => setLeadActivity(prev => ({ ...prev, [uid]: r.data })))
        .catch(() => setLeadActivity(prev => ({ ...prev, [uid]: [] })));
    });
  }, [expanded, from, to, leadActivity]);

  function toggle(id) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const sortedRows = [...rows].sort((a, b) => metricTotal(b.totals) - metricTotal(a.totals));
  const isRange = from !== to;

  const presets = [
    { label: 'היום',     from: todayStr,      to: todayStr },
    { label: '7 ימים',  from: shiftDays(-6),  to: todayStr },
    { label: '30 ימים', from: shiftDays(-29), to: todayStr },
  ];

  // Page the selected window backward/forward by its own length (one day when a
  // single day is selected). dir = -1 (older) / +1 (newer). Forward is clamped to today.
  function shiftRange(dir) {
    const f = new Date(from + 'T12:00:00'), t = new Date(to + 'T12:00:00');
    const span = Math.round((t - f) / 86400000) + 1;
    const step = span * dir;
    f.setDate(f.getDate() + step);
    t.setDate(t.getDate() + step);
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let nf = fmt(f), nt = fmt(t);
    if (nt > todayStr) { // clamp so the window never passes today, keeping its length
      const t2 = new Date(todayStr + 'T12:00:00'), f2 = new Date(t2);
      f2.setDate(f2.getDate() - (span - 1));
      nf = fmt(f2); nt = todayStr;
    }
    setFrom(nf); setTo(nt);
  }
  const atToday = to >= todayStr;

  return (
    <div className="min-h-screen bg-slate-50 pb-32" dir="rtl">
      <div className="px-4 pt-4 pb-3 flex items-center gap-2 flex-wrap sticky top-11 bg-slate-50 z-10 border-b border-slate-200">
        <span className="font-black text-slate-700 text-sm">פעילות עובדים</span>
        <div className="flex items-center gap-1">
          <button onClick={() => shiftRange(-1)} title="טווח קודם" aria-label="טווח קודם"
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-slate-300 text-slate-600 hover:bg-slate-100 font-bold">▶</button>
          <button onClick={() => shiftRange(1)} disabled={atToday} title="טווח הבא" aria-label="טווח הבא"
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-slate-300 text-slate-600 hover:bg-slate-100 font-bold disabled:opacity-40 disabled:hover:bg-white">◀</button>
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <span>מ-</span>
          <input type="date" value={from} max={to}
            onChange={e => setFrom(e.target.value)}
            className="border border-slate-300 rounded-xl px-2 py-1.5 text-sm text-slate-700 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            style={{ direction: 'ltr' }} />
          <span>עד</span>
          <input type="date" value={to} min={from} max={todayStr}
            onChange={e => setTo(e.target.value)}
            className="border border-slate-300 rounded-xl px-2 py-1.5 text-sm text-slate-700 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            style={{ direction: 'ltr' }} />
        </div>
        <div className="flex items-center gap-1">
          {presets.map(p => {
            const active = from === p.from && to === p.to;
            return (
              <button key={p.label} onClick={() => { setFrom(p.from); setTo(p.to); }}
                className={`text-xs font-bold px-2.5 py-1.5 rounded-lg transition ${active ? 'bg-violet-600 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-100'}`}>
                {p.label}
              </button>
            );
          })}
        </div>
        {loading && <span className="text-xs text-slate-400">טוען...</span>}
        <span className="text-xs text-slate-400">· לחיצה על עובד פותחת את הלקוחות שטופלו{isRange ? ', לפי יום' : ''}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse" style={{ minWidth: 820 }}>
          <thead>
            <tr className="bg-violet-50 text-violet-700">
              <th className="text-right px-4 py-2.5 font-black border-b border-violet-100 sticky right-0 bg-violet-50">שם</th>
              {METRIC_COLS.map(c => (
                <th key={c.key} className="text-center px-3 py-2.5 font-bold border-b border-violet-100 whitespace-nowrap">{c.label}</th>
              ))}
              <th className="text-center px-3 py-2.5 font-bold border-b border-violet-100 whitespace-nowrap">כניסה ראשונה</th>
              <th className="text-center px-3 py-2.5 font-bold border-b border-violet-100 whitespace-nowrap">פעילות אחרונה</th>
              <th className="text-center px-3 py-2.5 font-black border-b border-violet-100 bg-sky-100 text-sky-800 whitespace-nowrap">שעות</th>
              <th className="text-center px-3 py-2.5 font-black border-b border-violet-100 bg-violet-100">סה״כ</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 && !loading && (
              <tr>
                <td colSpan={METRIC_COLS.length + 5} className="text-center py-10 text-slate-400 text-sm">אין נתונים לטווח זה</td>
              </tr>
            )}
            {sortedRows.map(row => {
              const tot = metricTotal(row.totals);
              const inactive = tot === 0 && !row.totals.hours;
              const open = expanded.has(row.id);
              return (
                <Fragment key={row.id}>
                  <tr
                    onClick={() => row.days.length && toggle(row.id)}
                    className={`border-b border-slate-100 transition ${row.days.length ? 'cursor-pointer' : ''} ${inactive ? 'bg-red-50' : 'bg-white hover:bg-slate-50'}`}>
                    <td className={`px-4 py-2.5 font-bold sticky right-0 ${inactive ? 'bg-red-50 text-red-500' : 'bg-white text-slate-800'}`}>
                      {row.days.length > 0 && <span className="text-slate-400 mr-1">{open ? '▾' : '▸'}</span>}
                      {row.display_name}
                    </td>
                    {METRIC_COLS.map(c => {
                      const val = Number(row.totals[c.key] || 0);
                      return (
                        <td key={c.key} className={`text-center px-3 py-2.5 tabular-nums ${val > 0 ? 'text-slate-800 font-semibold' : 'text-slate-300'}`}>
                          {val || '—'}
                        </td>
                      );
                    })}
                    <td className="text-center px-3 py-2.5 tabular-nums text-xs text-slate-600" title={isRange && row.days[0] ? `ביום ${row.days[0].date}` : undefined}>{row.days[0]?.first_activity || '—'}</td>
                    <td className="text-center px-3 py-2.5 tabular-nums text-xs text-slate-600" title={isRange && row.days[0] ? `ביום ${row.days[0].date}` : undefined}>{row.days[0]?.last_activity || '—'}</td>
                    <td className="text-center px-3 py-2.5 tabular-nums font-bold text-sky-700">{fmtHours(row.totals.hours)}</td>
                    <td className={`text-center px-3 py-2.5 font-black tabular-nums ${inactive ? 'text-red-400' : 'text-violet-700'}`}>{tot || '—'}</td>
                  </tr>

                  {open && row.days.map(d => {
                    const dtot = metricTotal(d);
                    return (
                      <tr key={`${row.id}-${d.date}`} className="border-b border-slate-100 bg-slate-50/60 text-xs">
                        <td className="px-4 py-2 sticky right-0 bg-slate-50/60 text-slate-500">
                          <span className="font-semibold text-slate-600">{d.date}</span>
                        </td>
                        {METRIC_COLS.map(c => {
                          const val = Number(d[c.key] || 0);
                          return (
                            <td key={c.key} className={`text-center px-3 py-2 tabular-nums ${val > 0 ? 'text-slate-700' : 'text-slate-300'}`}>{val || '—'}</td>
                          );
                        })}
                        <td className="text-center px-3 py-2 tabular-nums text-slate-500">{d.first_activity || '—'}</td>
                        <td className="text-center px-3 py-2 tabular-nums text-slate-500">{d.last_activity || '—'}</td>
                        <td className="text-center px-3 py-2 tabular-nums text-sky-700"
                          title={d.hours_source === 'estimated' ? 'מחושב לפי פעילות, ללא מעקב נוכחות' : 'נמדד לפי נוכחות בפועל'}>
                          {d.hours_source === 'estimated' && d.hours ? '≈' : ''}{fmtHours(d.hours)}
                        </td>
                        <td className="text-center px-3 py-2 tabular-nums text-slate-500">{dtot || '—'}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Customer lines of each opened employee — rendered below the metrics table, outside its
          sideways-scrolling container. (They used to sit in a sticky cell inside the table; iOS Safari
          blanked that cell while scrolling.) */}
      {sortedRows.filter(row => expanded.has(row.id)).map(row => (
        <div key={`leads-${row.id}`} className="px-4 pt-4">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-sm font-black text-slate-700">{row.display_name}</span>
            <span className="text-xs text-slate-400">· לקוחות שטופלו</span>
          </div>
          <LeadActivityTable
            days={Array.isArray(leadActivity[row.id]) ? leadActivity[row.id] : []}
            loading={leadActivity[row.id] === 'loading'}
            onOpen={L => navigate(`/?lead=${L.lead_id}`)} />
        </div>
      ))}
    </div>
  );
}
