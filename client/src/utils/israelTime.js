// Date/time pickers in the CRM always mean Israel wall-clock time, whatever timezone the
// device is in (Oran books meetings from Bali). `new Date('YYYY-MM-DDTHH:MM')` would use the
// device zone, so a 19:00 pick from UTC+8 landed at 14:00 in Israel. (2026-10-15)
const IL = 'Asia/Jerusalem';

// Offset (minutes) of Israel from UTC at the given instant.
function israelOffsetMin(at) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: IL, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at).reduce((o, p) => (o[p.type] = p.value, o), {});
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - at.getTime()) / 60000);
}

// 'YYYY-MM-DD' + 'HH:MM' (Israel time) -> ISO/UTC string. Null when no date.
export function israelToISO(date, time) {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm, 0);
  // Two passes so a pick near a DST switch resolves with the offset in force at that time.
  let off = israelOffsetMin(new Date(naive));
  off = israelOffsetMin(new Date(naive - off * 60000));
  return new Date(naive - off * 60000).toISOString();
}

// ISO/UTC -> { date: 'YYYY-MM-DD', time: 'HH:MM' } in Israel time, for filling pickers.
export function isoToIsraelParts(iso) {
  if (!iso) return { date: '', time: '' };
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: IL, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(iso)).reduce((o, p) => (o[p.type] = p.value, o), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
