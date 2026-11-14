import { useEffect, useMemo, useState } from 'react';
import api from '../../api';
import {
  fmtTime, fmtDur, dayLabel, shortDate, todayIL, monthLabel, shiftMonth, outISO, israelToISO,
  ABSENCE_LABEL, STATUS_LABEL, FLAG_LABEL, daysText,
} from '../../utils/attendance';

// Phase 84 — "שעות": the signed-in employee's own month — every shift, vacation and sick day,
// the balances, and the two things he can ask for: an absence, or a correction of a shift.
const inputCls = 'w-full min-h-12 rounded-xl border border-slate-400 bg-white px-3 text-base font-semibold text-slate-900';

function Sheet({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[70] flex flex-col" dir="rtl" style={{ background: '#fdf8f0' }}>
      <div className="flex items-center justify-between px-5 py-2 text-white" style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
        <span className="font-black">{title}</span>
        <button onClick={onClose} aria-label="סגירה" className="w-11 h-11 text-2xl leading-none">&times;</button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-5 max-w-md w-full mx-auto flex flex-col gap-4">{children}</div>
    </div>
  );
}

function AbsenceSheet({ initialType, balances, onClose, onSaved }) {
  const [type, setType] = useState(initialType);
  const [from, setFrom] = useState(todayIL());
  const [to, setTo] = useState(todayIL());
  const [half, setHalf] = useState(false);
  const [days, setDays] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const span = from && to && to >= from ? Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1 : 0;
  const oneDay = span === 1;
  const autoDays = oneDay && half ? 0.5 : span;
  const effDays = days !== '' && Number(days) > 0 ? Number(days) : autoDays;
  const balance = type === 'sick' ? balances.sick : balances.vacation;

  async function save() {
    setError('');
    if (!span) return setError('תאריך הסיום לפני תאריך ההתחלה');
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('type', type); fd.append('from_date', from); fd.append('to_date', to);
      fd.append('half_day', String(oneDay && half)); fd.append('days', String(effDays));
      if (note.trim()) fd.append('note', note.trim());
      if (file) fd.append('file', file);
      await api.post('/attendance/absences', fd);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'השליחה נכשלה');
    } finally { setSaving(false); }
  }

  return (
    <Sheet title="דיווח היעדרות" onClose={onClose}>
      <div className="grid grid-cols-2 bg-white rounded-2xl p-1 border border-slate-200">
        {['vacation', 'sick'].map(t => (
          <button key={t} onClick={() => setType(t)} aria-pressed={type === t}
            className={`min-h-12 rounded-xl font-black ${type === t ? 'bg-violet-600 text-white' : 'text-slate-700'}`}>{ABSENCE_LABEL[t]}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1.5 text-sm font-bold text-slate-700">מתאריך
          <input type="date" className={inputCls} value={from} onChange={e => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-bold text-slate-700">עד תאריך
          <input type="date" className={inputCls} value={to} min={from} onChange={e => setTo(e.target.value)} />
        </label>
      </div>
      {oneDay ? (
        <label className="flex items-center gap-2.5 min-h-11 font-semibold text-slate-800">
          <input type="checkbox" className="w-5 h-5 accent-violet-600" checked={half} onChange={e => setHalf(e.target.checked)} /> חצי יום
        </label>
      ) : span > 1 && (
        <label className="flex flex-col gap-1.5 text-sm font-bold text-slate-700">כמה ימי עבודה זה? (בלי ימי החופש הקבועים שלך)
          <input type="number" inputMode="decimal" step="0.5" min="0.5" max={span} className={inputCls} placeholder={String(span)} value={days} onChange={e => setDays(e.target.value)} />
        </label>
      )}
      {type === 'sick' && (
        <label className="min-h-14 rounded-2xl border-2 border-dashed border-violet-600 bg-violet-50 text-violet-800 font-black flex items-center justify-center gap-2 cursor-pointer px-3 text-center">
          <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
          {file ? `צורף: ${file.name}` : 'צילום אישור מחלה'}
        </label>
      )}
      <label className="flex flex-col gap-1.5 text-sm font-bold text-slate-700">הערה (לא חובה)
        <textarea rows={2} className="w-full rounded-xl border border-slate-400 bg-white p-3 text-base text-slate-900" value={note} onChange={e => setNote(e.target.value)} />
      </label>
      {balances.set && (
        <div className="bg-white rounded-2xl px-4 py-3.5 flex flex-col gap-1.5 text-[15px]">
          <div className="flex justify-between"><span className="text-slate-600">{type === 'sick' ? 'ימי מחלה צבורים' : 'יתרת חופשה'}</span><span className="font-black">{balance}</span></div>
          <div className="flex justify-between"><span className="text-slate-600">הדיווח הזה</span><span className="font-black">{daysText(effDays)}</span></div>
          <div className="flex justify-between border-t border-slate-200 pt-1.5"><span className="text-slate-600">יישאר אחרי אישור</span><span className="font-black">{Math.round((balance - effDays) * 100) / 100}</span></div>
        </div>
      )}
      <div className="flex-1" />
      {error && <p className="text-center text-red-700 font-bold text-sm">{error}</p>}
      <p className="text-sm text-slate-600 text-center">הדיווח נשלח לאישור מנהל.</p>
      <button onClick={save} disabled={saving} className="min-h-14 rounded-2xl bg-violet-600 text-white text-lg font-black disabled:opacity-60">{saving ? 'שולח…' : 'שליחה'}</button>
    </Sheet>
  );
}

function FixSheet({ shift, onClose, onSaved }) {
  const [inT, setInT] = useState(fmtTime(shift.clock_in_at));
  const [outT, setOutT] = useState(shift.clock_out_at ? fmtTime(shift.clock_out_at) : '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setError('');
    if (!outT && !shift.clock_out_at) return setError('חסרה שעת יציאה');
    const body = { shift_id: shift.id, note };
    if (inT && inT !== fmtTime(shift.clock_in_at)) body.proposed_in = israelToISO(shift.day, inT);
    if (outT && outT !== (shift.clock_out_at ? fmtTime(shift.clock_out_at) : '')) body.proposed_out = outISO(shift.day, inT, outT);
    if (!body.proposed_in && !body.proposed_out) return setError('לא שינית שום שעה');
    setSaving(true);
    try { await api.post('/attendance/fix-requests', body); onSaved(); }
    catch (err) { setError(err.response?.data?.error || 'השליחה נכשלה'); }
    finally { setSaving(false); }
  }

  return (
    <Sheet title={`בקשת תיקון · ${dayLabel(shift.day)}`} onClose={onClose}>
      <p className="text-slate-700">כותבים את השעות הנכונות. השינוי ייכנס רק אחרי אישור מנהל.</p>
      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1.5 text-sm font-bold text-slate-700">כניסה
          <input type="time" className={inputCls} value={inT} onChange={e => setInT(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-bold text-slate-700">יציאה
          <input type="time" className={inputCls} value={outT} onChange={e => setOutT(e.target.value)} />
        </label>
      </div>
      <p className="text-sm text-slate-600">שעת יציאה מוקדמת משעת הכניסה נחשבת ליום שאחרי (משמרת שנגמרה אחרי חצות).</p>
      <label className="flex flex-col gap-1.5 text-sm font-bold text-slate-700">מה קרה? (לא חובה)
        <textarea rows={2} className="w-full rounded-xl border border-slate-400 bg-white p-3 text-base text-slate-900" value={note} onChange={e => setNote(e.target.value)} />
      </label>
      <div className="flex-1" />
      {error && <p className="text-center text-red-700 font-bold text-sm">{error}</p>}
      <button onClick={save} disabled={saving} className="min-h-14 rounded-2xl bg-violet-600 text-white text-lg font-black disabled:opacity-60">{saving ? 'שולח…' : 'שליחה לאישור'}</button>
    </Sheet>
  );
}

const ABS_CHIP = { vacation: 'bg-sky-100 text-sky-800', sick: 'bg-red-100 text-red-800' };

export default function MyHoursPage() {
  const [month, setMonth] = useState(todayIL().slice(0, 7));
  const [data, setData] = useState(null);
  const [absence, setAbsence] = useState(null); // 'vacation' | 'sick'
  const [fix, setFix] = useState(null);         // shift
  const [msg, setMsg] = useState('');

  function load() { api.get(`/attendance/me?month=${month}`).then(r => setData(r.data)).catch(() => setData({ error: true })); }
  useEffect(() => { setData(null); load(); }, [month]);

  // one list, newest first: shifts and absences together
  const rows = useMemo(() => {
    if (!data?.shifts) return [];
    const out = data.shifts.map(s => ({ kind: 'shift', sort: s.clock_in_at, ...s }));
    data.absences.forEach(a => out.push({ kind: 'absence', sort: `${a.from_date}T00:00:00Z`, ...a }));
    return out.sort((a, b) => (a.sort < b.sort ? 1 : -1));
  }, [data]);

  async function cancelAbsence(a) {
    try { await api.delete(`/attendance/absences/${a.id}`); load(); } catch (err) { setMsg(err.response?.data?.error || 'הביטול נכשל'); }
  }

  if (!data) return <div className="p-6 text-center text-slate-500" dir="rtl">טוען…</div>;
  if (data.error) return <div className="p-6 text-center text-red-700 font-bold" dir="rtl">הטעינה נכשלה. נסה לרענן.</div>;

  const isThisMonth = month === todayIL().slice(0, 7);
  return (
    <div className="px-4 py-4 max-w-md mx-auto flex flex-col gap-3" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black text-slate-900">השעות שלי</h1>
        <div className="flex items-center gap-1">
          <button onClick={() => setMonth(m => shiftMonth(m, -1))} aria-label="חודש קודם" className="w-11 h-11 rounded-xl bg-white border border-slate-200 text-sm font-black text-slate-700">▶</button>
          <span className="min-w-28 text-center font-bold text-slate-800">{monthLabel(month)}</span>
          <button onClick={() => setMonth(m => shiftMonth(m, 1))} disabled={isThisMonth} aria-label="חודש הבא" className="w-11 h-11 rounded-xl bg-white border border-slate-200 text-sm font-black text-slate-700 disabled:opacity-40">◀</button>
        </div>
      </div>

      {!data.enabled && <p className="bg-amber-50 border border-amber-300 text-amber-900 rounded-2xl px-4 py-3 font-semibold">המשתמש שלך לא מוגדר להחתמת נוכחות. פנה למנהל.</p>}

      {data.open && isThisMonth && (
        <div className="bg-emerald-50 border border-emerald-300 rounded-2xl px-4 py-3 flex items-center justify-between">
          <span className="font-black text-emerald-900">במשמרת מ-{fmtTime(data.open.clock_in_at)}</span>
          <span className="bg-emerald-200 text-emerald-900 text-sm font-black px-3 py-1 rounded-full">פעיל</span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white rounded-2xl px-2 py-3 text-center"><div className="text-xl font-black tabular-nums">{fmtDur(data.minutes)}</div><div className="text-xs text-slate-600">שעות החודש</div></div>
        <div className="bg-white rounded-2xl px-2 py-3 text-center"><div className="text-xl font-black tabular-nums">{data.balances.set ? data.balances.vacation : '—'}</div><div className="text-xs text-slate-600">יתרת חופשה</div></div>
        <div className="bg-white rounded-2xl px-2 py-3 text-center"><div className="text-xl font-black tabular-nums">{data.balances.set ? data.balances.sick : '—'}</div><div className="text-xs text-slate-600">ימי מחלה צבורים</div></div>
      </div>

      {data.enabled && (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setAbsence('vacation')} className="min-h-12 rounded-2xl bg-violet-600 text-white font-black">דיווח חופשה</button>
          <button onClick={() => setAbsence('sick')} className="min-h-12 rounded-2xl border-2 border-violet-600 bg-white text-violet-800 font-black">דיווח מחלה</button>
        </div>
      )}
      {msg && <p className="text-center text-red-700 font-bold text-sm">{msg}</p>}

      <div className="bg-white rounded-2xl divide-y divide-slate-200 overflow-hidden">
        {rows.length === 0 && <p className="px-4 py-6 text-center text-slate-500">אין רישומים בחודש הזה</p>}
        {rows.map(r => r.kind === 'absence' ? (
          <div key={`a${r.id}`} className="px-3.5 py-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-bold text-slate-900">{dayLabel(r.from_date)}{r.to_date !== r.from_date ? ` – ${shortDate(r.to_date)}` : ''}</div>
              <div className={`text-sm ${r.status === 'rejected' ? 'text-red-700 font-bold' : 'text-slate-600'}`}>
                {daysText(r.days)} · {STATUS_LABEL[r.status] || r.status}{r.decide_note ? ` · ${r.decide_note}` : ''}
              </div>
              {r.status === 'pending' && <button onClick={() => cancelAbsence(r)} className="text-sm font-bold text-violet-700 underline mt-0.5">ביטול הבקשה</button>}
            </div>
            <span className={`shrink-0 text-sm font-black px-2.5 py-1 rounded-full ${r.status === 'approved' ? ABS_CHIP[r.type] : 'bg-slate-100 text-slate-700'}`}>{ABSENCE_LABEL[r.type]}</span>
          </div>
        ) : (
          <div key={`s${r.id}`} className={`px-3.5 py-3 flex items-center justify-between gap-2 ${r.missing_out ? 'bg-amber-50' : ''}`}>
            <div className="min-w-0">
              <div className="font-bold text-slate-900">{dayLabel(r.day)}</div>
              <div className={`text-sm tabular-nums ${r.missing_out ? 'text-amber-800 font-bold' : 'text-slate-600'}`}>
                {fmtTime(r.clock_in_at)} – {r.clock_out_at ? fmtTime(r.clock_out_at) : (r.missing_out ? 'חסרה יציאה' : 'במשמרת')}
                {r.status === 'pending' && <span className="text-amber-800 font-bold"> · {FLAG_LABEL[r.in_flag || r.out_flag] || 'חריג'}, ממתין לאישור</span>}
              </div>
              {r.fix && <div className="text-sm text-violet-800 font-bold">נשלחה בקשת תיקון – ממתינה לאישור</div>}
            </div>
            <div className="shrink-0 flex items-center gap-2">
              {r.clock_out_at && <span className="font-black tabular-nums text-slate-900">{fmtDur(r.minutes)}</span>}
              {!r.fix && (r.missing_out
                ? <button onClick={() => setFix(r)} className="min-h-11 px-3 rounded-xl bg-amber-800 text-white text-sm font-black">בקשת תיקון</button>
                : (r.clock_out_at && <button onClick={() => setFix(r)} className="min-h-11 px-2 text-sm font-bold text-violet-700 underline">תיקון</button>))}
            </div>
          </div>
        ))}
      </div>

      {absence && <AbsenceSheet initialType={absence} balances={data.balances} onClose={() => setAbsence(null)} onSaved={() => { setAbsence(null); load(); }} />}
      {fix && <FixSheet shift={fix} onClose={() => setFix(null)} onSaved={() => { setFix(null); load(); }} />}
    </div>
  );
}
