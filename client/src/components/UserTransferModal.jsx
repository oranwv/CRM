import { useState, useEffect } from 'react';
import api from '../api';

// Phase 92 — Settings → משתמשים: hand a blocked user's leads / tasks / meetings to someone else,
// and give them back (e.g. after blocking someone by mistake). Restoring returns only what still
// belongs to the person it was moved to.
const PARTS = [
  { key: 'leads_active', label: 'לידים פעילים', hint: 'לפני סגירה', on: true },
  { key: 'leads_closed', label: 'לידים שנסגרו', hint: 'מקדמה / הפקה / הסתיים', on: true },
  { key: 'leads_lost',   label: 'לידים שלא סגרו', hint: '', on: false },
  { key: 'production',   label: 'ניהול הפקה של אירועים', hint: '', on: true },
  { key: 'tasks',        label: 'משימות פתוחות', hint: 'לידים, תפעול, תחזוקה ותקלות', on: true },
  { key: 'meetings',     label: 'פגישות עתידיות', hint: '', on: true },
];
const LABEL = Object.fromEntries(PARTS.map(p => [p.key, p.label]));
const fmt = ts => new Date(ts).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const sum = o => Object.values(o || {}).reduce((a, b) => a + b, 0);

export default function UserTransferModal({ user, users, onClose, onChanged }) {
  const [data, setData]   = useState(null);
  const [picked, setPicked] = useState(() => Object.fromEntries(PARTS.map(p => [p.key, p.on])));
  const [toUser, setToUser] = useState('');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');
  const [msg, setMsg]     = useState('');
  const [confirm, setConfirm] = useState(null); // 'transfer' | transfer id (restore)
  const name = user.display_name || user.username;
  const targets = users.filter(u => !u.blocked && u.id !== user.id);

  const load = () => api.get(`/admin/users/${user.id}/transfer`).then(r => setData(r.data)).catch(e => setErr(e.response?.data?.error || 'שגיאה בטעינה'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = data?.counts || {};
  const chosen = PARTS.filter(p => picked[p.key] && counts[p.key] > 0);
  const total = chosen.reduce((a, p) => a + counts[p.key], 0);
  const toName = targets.find(u => String(u.id) === String(toUser))?.display_name || '';

  async function doTransfer() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const { data: r } = await api.post(`/admin/users/${user.id}/transfer`, { to_user: Number(toUser), parts: chosen.map(p => p.key) });
      setMsg(`הועברו ${r.total} פריטים אל ${toName}`);
      setConfirm(null); await load(); onChanged?.();
    } catch (e) { setErr(e.response?.data?.error || 'ההעברה נכשלה'); }
    finally { setBusy(false); }
  }
  async function doRestore(id) {
    setBusy(true); setErr(''); setMsg('');
    try {
      const { data: r } = await api.post(`/admin/transfers/${id}/restore`);
      setMsg(`הושבו ${r.restored} פריטים אל ${name}` + (r.skipped ? ` · ${r.skipped} לא הושבו כי שויכו מחדש בינתיים` : ''));
      setConfirm(null); await load(); onChanged?.();
    } catch (e) { setErr(e.response?.data?.error || 'ההשבה נכשלה'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="min-w-0">
            <h2 className="font-black text-slate-800 text-base truncate">העברת לידים ומשימות — {name}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{user.blocked ? 'המשתמש חסום. אפשר להעביר את מה שמשויך אליו למשתמש אחר.' : 'המשתמש פעיל. אפשר להשיב אליו העברות קודמות.'}</p>
          </div>
          <button onClick={onClose} className="shrink-0 mr-3 text-slate-400 hover:text-slate-600 text-2xl leading-none" aria-label="סגור">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {!data && !err && <p className="text-center text-slate-400 text-sm py-6">טוען...</p>}
          {msg && <p className="text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">{msg}</p>}
          {err && <p className="text-sm font-bold text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</p>}

          {data && user.blocked && (
            <div className="space-y-3">
              <p className="text-xs font-black text-slate-500">מה להעביר</p>
              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                {PARTS.map(p => {
                  const n = counts[p.key] || 0;
                  return (
                    <label key={p.key} className={`flex items-center gap-3 px-3 py-2 ${n ? 'cursor-pointer' : 'opacity-40'}`}>
                      <input type="checkbox" className="w-4 h-4 accent-violet-600" disabled={!n}
                        checked={!!picked[p.key] && n > 0} onChange={e => setPicked(s => ({ ...s, [p.key]: e.target.checked }))} />
                      <span className="flex-1 min-w-0">
                        <span className="text-sm font-bold text-slate-800">{p.label}</span>
                        {p.hint && <span className="text-xs text-slate-400"> · {p.hint}</span>}
                      </span>
                      <span className="text-sm font-black tabular-nums text-slate-700">{n}</span>
                    </label>
                  );
                })}
              </div>
              <div>
                <p className="text-xs font-black text-slate-500 mb-1">למי להעביר</p>
                <select value={toUser} onChange={e => { setToUser(e.target.value); setConfirm(null); }}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400">
                  <option value="">בחר משתמש…</option>
                  {targets.map(u => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}
                </select>
              </div>
              {confirm === 'transfer' ? (
                <div className="rounded-xl bg-violet-50 border border-violet-200 p-3 space-y-2">
                  <p className="text-sm text-slate-700">להעביר <b>{total}</b> פריטים מ{name} אל <b>{toName}</b>?</p>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setConfirm(null)} className="text-xs text-slate-500 px-3 py-1.5">ביטול</button>
                    <button onClick={doTransfer} disabled={busy} className="text-xs font-bold px-4 py-1.5 rounded-lg text-white bg-violet-600 disabled:opacity-40">{busy ? 'מעביר…' : 'כן, להעביר'}</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => { setErr(''); setMsg(''); setConfirm('transfer'); }} disabled={!toUser || !total}
                  className="w-full text-sm font-black py-2.5 rounded-xl text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40">
                  העבר {total > 0 ? `${total} פריטים` : ''}
                </button>
              )}
            </div>
          )}

          {data && (
            <div className="space-y-2">
              <p className="text-xs font-black text-slate-500">העברות קודמות</p>
              {data.history.length === 0 && <p className="text-xs text-slate-400">עדיין לא הועבר דבר מהמשתמש הזה.</p>}
              {data.history.map(h => (
                <div key={h.id} className={`rounded-xl border px-3 py-2 ${h.restored_at ? 'border-slate-200 bg-slate-50' : 'border-violet-100 bg-violet-50/40'}`}>
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800">{sum(h.counts)} פריטים הועברו אל {h.to_name || 'משתמש שנמחק'}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {Object.entries(h.counts || {}).map(([k, n]) => `${LABEL[k] || k}: ${n}`).join(' · ')}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{fmt(h.created_at)}{h.by_name ? ` · ${h.by_name}` : ''}</p>
                      {h.restored_at && (
                        <p className="text-[11px] font-bold text-emerald-700 mt-1">
                          הושב ב-{fmt(h.restored_at)}: {h.restored_counts?.restored ?? 0} הושבו
                          {h.restored_counts?.skipped ? ` · ${h.restored_counts.skipped} לא הושבו (שויכו מחדש בינתיים)` : ''}
                        </p>
                      )}
                    </div>
                    {!h.restored_at && confirm !== h.id && (
                      <button onClick={() => { setErr(''); setMsg(''); setConfirm(h.id); }}
                        className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg bg-white border border-violet-200 text-violet-700 hover:bg-violet-50">השב ל{name}</button>
                    )}
                  </div>
                  {confirm === h.id && (
                    <div className="mt-2 pt-2 border-t border-violet-100 space-y-2">
                      <p className="text-xs text-slate-600">להשיב אל {name} את מה שהועבר? יושב רק מה שעדיין משויך אל {h.to_name || 'המשתמש'}.</p>
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => setConfirm(null)} className="text-xs text-slate-500 px-3 py-1.5">ביטול</button>
                        <button onClick={() => doRestore(h.id)} disabled={busy} className="text-xs font-bold px-4 py-1.5 rounded-lg text-white bg-violet-600 disabled:opacity-40">{busy ? 'משיב…' : 'כן, להשיב'}</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
