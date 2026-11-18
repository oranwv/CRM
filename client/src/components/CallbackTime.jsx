import { useState } from 'react';
import api from '../api';

// Phase 101 — "שיחה חוזרת": the customer asked to be called back at a specific time.
// CallbackTimePicker = the quick choices (עוד שעה / עוד שעתיים / מחר 10:00 / שעה אחרת);
// CallbackButton = the button on the lead that creates the callback in two taps.
const pad = n => String(n).padStart(2, '0');
const toLocalInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const fmtCallbackTime = iso => {
  const d = new Date(iso), now = new Date();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86400000);
  if (diff === 0) return time;
  if (diff === 1) return `מחר ${time}`;
  if (diff === -1) return `אתמול ${time}`;
  return `${d.getDate()}.${d.getMonth() + 1} ${time}`;
};

function quickOptions() {
  const now = new Date();
  const plus = h => new Date(now.getTime() + h * 3600_000);
  const tomorrow10 = new Date(now); tomorrow10.setDate(now.getDate() + 1); tomorrow10.setHours(10, 0, 0, 0);
  return [
    { key: 'h1', label: 'עוד שעה', date: plus(1) },
    { key: 'h2', label: 'עוד שעתיים', date: plus(2) },
    { key: 'tm', label: 'מחר ב-10:00', date: tomorrow10 },
  ];
}

// value = ISO string | ''. onChange(iso)
export function CallbackTimePicker({ value, onChange }) {
  const [opts] = useState(quickOptions);
  const [picked, setPicked] = useState('');
  const [custom, setCustom] = useState('');
  const chip = on => `px-3 py-2 rounded-xl text-sm font-bold border transition ${on ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:border-teal-400'}`;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {opts.map(o => (
          <button key={o.key} type="button" className={chip(picked === o.key)}
            onClick={() => { setPicked(o.key); onChange(o.date.toISOString()); }}>
            {o.label}{o.key !== 'tm' && <span className={`block text-xs font-normal ${picked === o.key ? 'text-teal-100' : 'text-slate-400'}`}>{fmtCallbackTime(o.date)}</span>}
          </button>
        ))}
        <button type="button" className={chip(picked === 'custom')} onClick={() => { setPicked('custom'); onChange(custom ? new Date(custom).toISOString() : ''); }}>שעה אחרת…</button>
      </div>
      {picked === 'custom' && (
        <input type="datetime-local" value={custom} min={toLocalInput(new Date())} autoFocus
          onChange={e => { setCustom(e.target.value); onChange(e.target.value ? new Date(e.target.value).toISOString() : ''); }}
          className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-teal-400 bg-white" style={{ direction: 'ltr' }} />
      )}
      {value && picked && <p className="text-xs text-slate-500">נחזור ב-<b className="text-slate-700">{fmtCallbackTime(value)}</b></p>}
    </div>
  );
}

// The button + its small window. `wide` = full-width version for the new-task window.
export function CallbackButton({ lead, wide, onSaved }) {
  const [open, setOpen] = useState(false);
  const [due, setDue]   = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [done, setDone] = useState('');

  async function save() {
    setBusy(true); setErr('');
    try {
      await api.post('/callbacks', { lead_id: lead.id, due_at: due, note });
      setOpen(false); setDone(`📞 נקבע לחזור ב-${fmtCallbackTime(due)}`); setTimeout(() => setDone(''), 5000);
      setDue(''); setNote(''); onSaved?.();
    } catch (e) { setErr(e.response?.data?.error || 'שגיאה בשמירה'); }
    finally { setBusy(false); }
  }
  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setErr(''); }}
        title="הלקוח לא יכול לדבר עכשיו וביקש שנחזור אליו בשעה מסוימת"
        className={wide
          ? 'w-full px-3 py-2.5 rounded-xl text-sm font-black text-teal-800 bg-teal-50 hover:bg-teal-100 border-2 border-teal-200 text-right'
          : 'px-2.5 py-1 rounded-lg text-xs font-black text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200'}>
        📞 ביקש שאחזור אליו{wide && <span className="font-normal text-teal-700"> · שיחה חוזרת בשעה מדויקת</span>}
      </button>
      {done && !wide && <span className="text-xs font-bold text-teal-700">{done}</span>}
      {open && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50 p-4" dir="rtl" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-5 w-full max-w-sm space-y-3" onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="font-black text-slate-800 text-lg">📞 ביקש שאחזור אליו</h3>
              <p className="text-xs text-slate-500 mt-0.5">{lead.name ? `${lead.name} · ` : ''}מתי לחזור? בזמן הזה יקפוץ חלון על המסך.</p>
            </div>
            <CallbackTimePicker value={due} onChange={setDue} />
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="הערה (לא חובה) — למשל: אחרי הישיבה" maxLength={200}
              className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-teal-400 bg-white" />
            {err && <p className="text-xs text-red-600">{err}</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 px-3 py-2">ביטול</button>
              <button type="button" onClick={save} disabled={busy || !due}
                className="text-sm font-black px-5 py-2 rounded-xl text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-40">{busy ? 'שומר…' : 'קבע שיחה חוזרת'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
