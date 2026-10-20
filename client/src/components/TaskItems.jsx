import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

// Phase 55 — one task row (lead / תפעול / תחזוקה / תקלה) with the three ways to deal with it:
// בוצע (with a result line), דחייה (new date + optional reason), לא רלוונטי (reason).
// Used by הפעילות שלי and by the overdue-tasks window.

export const GROUP_LABELS = { sales: 'מכירות', production: 'הפקה', operations: 'תפעול', maintenance: 'תחזוקה' };
export const GROUP_ORDER  = ['sales', 'production', 'operations', 'maintenance'];
const KIND_LABEL = { lead: 'ליד', op: 'תפעול', maintenance: 'תחזוקה', fault: 'תקלה' };

export function fmtDue(ds) {
  if (!ds) return 'ללא תאריך';
  const [y, m, d] = ds.split('-');
  return `${Number(d)}.${Number(m)}.${y.slice(2)}`;
}
function daysLate(ds) {
  if (!ds) return 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(ds + 'T00:00:00');
  return Math.round((today - due) / 86400000);
}
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Status pill: באיחור (red) / היום / פתוחה / הושלמה (green) / בוטלה (grey)
export function TaskStatus({ t }) {
  if (t.cancelled) return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-500 whitespace-nowrap">לא רלוונטי</span>;
  if (t.done) return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700 whitespace-nowrap">הושלמה</span>;
  if (t.overdue) { const n = daysLate(t.due_date); return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-600 text-white whitespace-nowrap">באיחור {n > 0 ? `${n} ${n === 1 ? 'יום' : 'ימים'}` : ''}</span>; }
  if (t.due_date === todayStr()) return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700 whitespace-nowrap">היום</span>;
  return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-violet-50 text-violet-700 whitespace-nowrap">פתוחה</span>;
}

// The action box that opens under a row. onDone(kind) closes it after the server call.
export function TaskActionBox({ t, mode, onClose, onDone }) {
  const [text, setText] = useState('');
  const [date, setDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const canCancel = t.kind === 'lead' || t.kind === 'op';

  async function submit() {
    setBusy(true); setErr('');
    try {
      if (mode === 'complete') await api.post(`/my-tasks/${t.kind}/${t.id}/complete`, { result: text });
      else if (mode === 'postpone') await api.post(`/my-tasks/${t.kind}/${t.id}/postpone`, { due_at: date + 'T09:00:00', reason: text });
      else await api.post(`/my-tasks/${t.kind}/${t.id}/cancel`, { reason: text });
      onDone(mode);
    } catch (e) { setErr(e.response?.data?.error || 'שגיאה'); }
    finally { setBusy(false); }
  }
  const label = mode === 'complete' ? 'מה נעשה / תוצאה' : mode === 'postpone' ? 'סיבה לדחייה (לא חובה)' : 'למה לא רלוונטי';
  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2" dir="rtl">
      {mode === 'postpone' && (
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <span>מועד חדש</span>
          <input type="date" value={date} min={todayStr()} onChange={e => setDate(e.target.value)}
            className="border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white" style={{ direction: 'ltr' }} />
          {t.postpone_count > 0 && <span className="text-slate-400">· נדחתה כבר {t.postpone_count}×</span>}
        </label>
      )}
      {mode === 'cancel' && !canCancel && <p className="text-xs text-red-600">תחזוקה תקופתית אפשר רק לבצע או לדחות.</p>}
      <input value={text} onChange={e => setText(e.target.value)} placeholder={label} autoFocus
        className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-400" />
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex items-center gap-2 justify-end">
        <button onClick={onClose} className="text-xs text-slate-500 px-3 py-1.5">ביטול</button>
        <button onClick={submit} disabled={busy || (mode === 'cancel' && !canCancel) || (mode === 'cancel' && !text.trim())}
          className={`text-xs font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-40 ${mode === 'complete' ? 'bg-emerald-600' : mode === 'postpone' ? 'bg-violet-600' : 'bg-slate-600'}`}>
          {mode === 'complete' ? 'סמן כבוצע' : mode === 'postpone' ? 'דחה' : 'סמן לא רלוונטי'}
        </button>
      </div>
    </div>
  );
}

// A row. `showAssignee` for the "משימות שנתתי" list; `actions` false hides the buttons (closed items).
export function TaskRow({ t, showAssignee, onChanged }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState(null); // 'complete' | 'postpone' | 'cancel'
  const open = !t.done;
  return (
    <div className={`rounded-xl border px-3 py-2 ${t.overdue && open ? 'border-red-200 bg-red-50/40' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-slate-800 text-sm">{t.title}</span>
            <TaskStatus t={t} />
            <span className="text-[10px] text-slate-400 border border-slate-200 rounded px-1">{KIND_LABEL[t.kind]}</span>
          </div>
          <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-x-3 gap-y-0.5 flex-wrap">
            {t.lead_id && <button onClick={() => navigate(`/?lead=${t.lead_id}`)} className="text-violet-700 font-bold hover:underline">{t.who}</button>}
            <span className={`tabular-nums ${t.overdue && open ? 'text-red-600 font-bold' : ''}`}>יעד: {fmtDue(t.due_date)}</span>
            {showAssignee
              ? <span>אצל: <b className="text-slate-700">{t.assigned_name || '—'}</b></span>
              : (t.created_by_name && <span>מאת: {t.created_by_name}</span>)}
            {t.postpone_count > 0 && open && <span className="text-amber-700">נדחתה {t.postpone_count}×</span>}
            {t.done && t.result && <span className="text-emerald-700 truncate max-w-[60vw]" title={t.result}>{t.result}</span>}
          </div>
        </div>
        {open && (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => setMode(m => m === 'complete' ? null : 'complete')} title="בוצע"
              className={`w-8 h-8 rounded-lg font-black text-sm ${mode === 'complete' ? 'bg-emerald-600 text-white' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}>✓</button>
            <button onClick={() => setMode(m => m === 'postpone' ? null : 'postpone')} title="דחייה"
              className={`w-8 h-8 rounded-lg font-black text-sm ${mode === 'postpone' ? 'bg-violet-600 text-white' : 'bg-violet-100 text-violet-700 hover:bg-violet-200'}`}>⏭</button>
            {(t.kind === 'lead' || t.kind === 'op') && (
              <button onClick={() => setMode(m => m === 'cancel' ? null : 'cancel')} title="לא רלוונטי"
                className={`w-8 h-8 rounded-lg font-black text-sm ${mode === 'cancel' ? 'bg-slate-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>🚫</button>
            )}
          </div>
        )}
      </div>
      {mode && <TaskActionBox t={t} mode={mode} onClose={() => setMode(null)} onDone={m => { setMode(null); onChanged?.(t, m); }} />}
    </div>
  );
}
