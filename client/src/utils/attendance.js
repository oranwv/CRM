// Phase 84 — shared helpers for the נוכחות screens. All times are shown in Israel time.
import { israelToISO, isoToIsraelParts } from './israelTime';

const IL = 'Asia/Jerusalem';
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

export const fmtTime = iso => (iso ? isoToIsraelParts(iso).time : '—');
export const fmtDur = min => {
  if (min === null || min === undefined || isNaN(min)) return '—';
  const m = Math.max(0, Math.round(Number(min)));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};
// 'YYYY-MM-DD' -> 'חמישי 12.11'
export function dayLabel(day) {
  const [y, m, d] = day.split('-').map(Number);
  return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}.${m}`;
}
export const shortDate = day => { const [, m, d] = day.split('-').map(Number); return `${d}.${m}`; };
export const todayIL = () => new Intl.DateTimeFormat('en-CA', { timeZone: IL }).format(new Date());
export const monthLabel = ym => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
export function shiftMonth(ym, by) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
// An "out" time typed for a shift that started on `day` at `inTime`: earlier than the start
// means it ended after midnight.
export function outISO(day, inTime, outTime) {
  return israelToISO(outTime < inTime ? addDays(day, 1) : day, outTime);
}
export { israelToISO };

// A stable id for this browser — the server registers the first phone a user punches from.
export function deviceId() {
  try {
    let id = localStorage.getItem('crm_device_id');
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem('crm_device_id', id);
    }
    return id;
  } catch { return null; }
}

// The phone's position, or null when refused / unavailable / too slow.
export function getPosition(timeoutMs = 8000) {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    setTimeout(() => finish(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      p => finish({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => finish(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 });
  });
}

// CSV with BOM so Excel opens Hebrew correctly (same approach as the daily report, Phase 78).
export function downloadCsv(name, rows) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob(['﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const ABSENCE_LABEL = { vacation: 'חופשה', sick: 'מחלה' };
export const STATUS_LABEL = { pending: 'ממתין לאישור', approved: 'אושר', rejected: 'לא אושר', cancelled: 'בוטל' };
export const FLAG_LABEL = { no_location: 'בלי מיקום', new_device: 'מכשיר חדש' };

// 1 -> 'יום אחד', 0.5 -> 'חצי יום', 3 -> '3 ימים'
export const daysText = n => (Number(n) === 1 ? 'יום אחד' : Number(n) === 0.5 ? 'חצי יום' : `${Number(n)} ימים`);
