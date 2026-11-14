import { useEffect, useState } from 'react';
import api from '../../api';
import {
  fmtTime, fmtDur, dayLabel, shortDate, todayIL, monthLabel, shiftMonth, outISO, israelToISO, getPosition, downloadCsv,
  ABSENCE_LABEL, STATUS_LABEL, FLAG_LABEL, daysText,
} from '../../utils/attendance';

// Phase 84 — "נוכחות" (ניהול mode, admin / manager): who is in now, what waits for a decision,
// the month per employee with Excel export, and the one-time setup (employees, NFC tags, venue).
const inputCls = 'w-full min-h-11 rounded-xl border border-slate-400 bg-white px-3 text-base text-slate-900';
const btnOk = 'min-h-11 rounded-xl bg-emerald-700 text-white font-black px-3';
const btnNo = 'min-h-11 rounded-xl border-2 border-slate-300 bg-white text-slate-700 font-black px-3';

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-end sm:items-center justify-center" dir="rtl" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-4 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-900">{title}</h2>
          <button onClick={onClose} aria-label="סגירה" className="w-11 h-11 text-2xl leading-none text-slate-600">&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---- one waiting item -------------------------------------------------------------------------
function PendingCard({ item, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [other, setOther] = useState(false);
  const [outT, setOutT] = useState(item.proposed_out ? fmtTime(item.proposed_out) : '');
  const [inT, setInT] = useState(fmtTime(item.proposed_in || item.clock_in_at));

  async function decide(approve, extra = {}) {
    setBusy(true); setError('');
    try { await api.post(`/attendance/pending/${item.kind}/${item.id}/decide`, { approve, ...extra }); onDone(); }
    catch (err) { setError(err.response?.data?.error || 'הפעולה נכשלה'); setBusy(false); }
  }
  async function openFile() {
    try { const { data } = await api.get(`/attendance/absences/${item.id}/file`); window.open(data.url, '_blank'); }
    catch { setError('לא ניתן לפתוח את הקובץ'); }
  }

  let head, sub, actions;
  if (item.kind === 'absence') {
    head = `${item.name} · בקשת ${ABSENCE_LABEL[item.type]}`;
    sub = `${shortDate(item.from_date)}${item.to_date !== item.from_date ? ' – ' + shortDate(item.to_date) : ''} · ${daysText(item.days)}` +
      (item.balance !== null ? ` · יתרה אחרי אישור: ${Math.round((item.balance - Number(item.days)) * 100) / 100}` : '');
    actions = <><button disabled={busy} onClick={() => decide(true)} className={btnOk}>אישור</button><button disabled={busy} onClick={() => decide(false)} className={btnNo}>דחייה</button></>;
  } else if (item.kind === 'fix') {
    head = `${item.name} · בקשת תיקון שעות`;
    sub = `${dayLabel(item.day)} · נרשם ${fmtTime(item.clock_in_at)}–${item.clock_out_at ? fmtTime(item.clock_out_at) : 'חסר'} · מבקש/ת ${fmtTime(item.proposed_in || item.clock_in_at)}–${item.proposed_out ? fmtTime(item.proposed_out) : (item.clock_out_at ? fmtTime(item.clock_out_at) : '?')}`;
    actions = other ? (
      <button disabled={busy || !outT} onClick={() => decide(true, { clock_in_at: israelToISO(item.day, inT), clock_out_at: outISO(item.day, inT, outT) })} className={btnOk}>אישור השעות שכתבתי</button>
    ) : <><button disabled={busy} onClick={() => decide(true)} className={btnOk}>אישור</button><button disabled={busy} onClick={() => setOther(true)} className={btnNo}>שעה אחרת</button></>;
  } else if (item.kind === 'flag') {
    const f = item.in_flag || item.out_flag;
    head = `${item.name} · החתמה ${FLAG_LABEL[f] || 'חריגה'}`;
    sub = `${dayLabel(item.day)} · כניסה ${fmtTime(item.clock_in_at)}${item.clock_out_at ? ' · יציאה ' + fmtTime(item.clock_out_at) : ''}` +
      (f === 'no_location' ? ' · הטלפון לא שיתף מיקום' : ' · טלפון שלא הוחתם ממנו קודם');
    actions = <><button disabled={busy} onClick={() => decide(true)} className={btnOk}>אישור</button><button disabled={busy} onClick={() => decide(false)} className={btnNo}>ביטול החתמה</button></>;
  } else {
    head = `${item.name} · חסרה יציאה`;
    sub = `${dayLabel(item.day)} · נכנס/ה ${fmtTime(item.clock_in_at)} · עוד לא נשלחה בקשת תיקון`;
    actions = other
      ? <button disabled={busy || !outT} onClick={() => decide(true, { clock_out_at: outISO(item.day, fmtTime(item.clock_in_at), outT) })} className={btnOk}>שמירת שעת היציאה</button>
      : <><button disabled={busy} onClick={() => setOther(true)} className={btnOk}>קביעת שעת יציאה</button><button disabled={busy} onClick={() => decide(false)} className={btnNo}>ביטול המשמרת</button></>;
  }
  const warn = item.kind === 'missing' || item.kind === 'fix';
  return (
    <div className={`rounded-2xl p-3.5 flex flex-col gap-2 ${warn ? 'bg-amber-50 border border-amber-300' : 'bg-white'}`}>
      <span className="font-bold text-slate-900">{head}</span>
      <span className="text-sm text-slate-700">{sub}</span>
      {item.note && <span className="text-sm text-slate-700">״{item.note}״</span>}
      {item.kind === 'absence' && item.has_file && <button onClick={openFile} className="text-sm font-bold text-violet-700 underline self-start">צפייה באישור שצורף</button>}
      {other && (
        <div className="grid grid-cols-2 gap-2">
          {item.kind === 'fix' && <label className="text-sm font-bold text-slate-700">כניסה<input type="time" className={inputCls} value={inT} onChange={e => setInT(e.target.value)} /></label>}
          <label className="text-sm font-bold text-slate-700">יציאה<input type="time" className={inputCls} value={outT} onChange={e => setOutT(e.target.value)} /></label>
        </div>
      )}
      {error && <span className="text-sm font-bold text-red-700">{error}</span>}
      <div className="grid grid-cols-2 gap-2">{actions}</div>
    </div>
  );
}

// ---- an employee's month (manager view) with manual edit / add --------------------------------
function UserMonth({ userId, month, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState(null); // { id?, day, inT, outT, reason, void }
  const [error, setError] = useState('');
  const load = () => api.get(`/attendance/user/${userId}?month=${month}`).then(r => setData(r.data)).catch(() => setError('הטעינה נכשלה'));
  useEffect(() => { load(); }, [userId, month]);

  async function saveEdit() {
    setError('');
    if (!edit.reason.trim()) return setError('חובה לכתוב סיבה');
    try {
      const body = { reason: edit.reason, clock_in_at: israelToISO(edit.day, edit.inT), clock_out_at: edit.outT ? outISO(edit.day, edit.inT, edit.outT) : null };
      if (edit.id) await api.put(`/attendance/shifts/${edit.id}`, edit.void ? { reason: edit.reason, void: true } : body);
      else await api.post('/attendance/shifts', { ...body, user_id: userId });
      setEdit(null); load(); onChanged();
    } catch (err) { setError(err.response?.data?.error || 'השמירה נכשלה'); }
  }
  function exportCsv() {
    const rows = [['תאריך', 'יום', 'כניסה', 'יציאה', 'שעות', 'הערה']];
    [...data.shifts].reverse().forEach(s => rows.push([s.day, dayLabel(s.day).split(' ')[0], fmtTime(s.clock_in_at), s.clock_out_at ? fmtTime(s.clock_out_at) : '', s.clock_out_at ? fmtDur(s.minutes) : '', s.missing_out ? 'חסרה יציאה' : (s.source === 'manual' ? 'הוזן ידנית' : '')]));
    data.absences.filter(a => a.status === 'approved').forEach(a => rows.push([a.from_date, '', '', '', '', `${ABSENCE_LABEL[a.type]} ${Number(a.days)} ימים${a.to_date !== a.from_date ? ' עד ' + a.to_date : ''}`]));
    rows.push(['סה"כ', '', '', '', fmtDur(data.minutes), `${data.work_days} ימי עבודה`]);
    downloadCsv(`נוכחות-${data.name}-${month}.csv`, rows);
  }

  return (
    <Modal title={data ? `${data.name} · ${monthLabel(month)}` : 'טוען…'} onClose={onClose}>
      {data && (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="bg-violet-50 text-violet-900 font-bold px-3 py-1.5 rounded-full">{fmtDur(data.minutes)} שעות</span>
            <span className="bg-slate-100 text-slate-800 font-bold px-3 py-1.5 rounded-full">{data.work_days} ימי עבודה</span>
            {data.balances.set && <span className="bg-sky-100 text-sky-900 font-bold px-3 py-1.5 rounded-full">חופשה: {data.balances.vacation}</span>}
            {data.balances.set && <span className="bg-red-100 text-red-900 font-bold px-3 py-1.5 rounded-full">מחלה: {data.balances.sick}</span>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setEdit({ day: todayIL(), inT: '', outT: '', reason: '' })} className={btnNo}>+ הוספת משמרת</button>
            <button onClick={exportCsv} className={btnNo}>הורדה לאקסל</button>
          </div>
          {edit && (
            <div className="bg-violet-50 rounded-2xl p-3 flex flex-col gap-2">
              <span className="font-black text-slate-900">{edit.id ? `תיקון · ${dayLabel(edit.day)}` : 'משמרת חדשה'}</span>
              {!edit.id && <input type="date" className={inputCls} value={edit.day} max={todayIL()} onChange={e => setEdit({ ...edit, day: e.target.value })} />}
              {!edit.void && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-sm font-bold text-slate-700">כניסה<input type="time" className={inputCls} value={edit.inT} onChange={e => setEdit({ ...edit, inT: e.target.value })} /></label>
                  <label className="text-sm font-bold text-slate-700">יציאה<input type="time" className={inputCls} value={edit.outT} onChange={e => setEdit({ ...edit, outT: e.target.value })} /></label>
                </div>
              )}
              <input className={inputCls} placeholder="סיבת השינוי (חובה)" value={edit.reason} onChange={e => setEdit({ ...edit, reason: e.target.value })} />
              {edit.id && <label className="flex items-center gap-2 text-sm font-bold text-slate-800"><input type="checkbox" className="w-5 h-5 accent-violet-600" checked={!!edit.void} onChange={e => setEdit({ ...edit, void: e.target.checked })} /> ביטול המשמרת כולה</label>}
              <div className="grid grid-cols-2 gap-2">
                <button onClick={saveEdit} disabled={!edit.void && !edit.inT} className={`${btnOk} disabled:opacity-50`}>שמירה</button>
                <button onClick={() => { setEdit(null); setError(''); }} className={btnNo}>ביטול</button>
              </div>
            </div>
          )}
          {error && <span className="text-sm font-bold text-red-700">{error}</span>}
          <div className="divide-y divide-slate-200 border border-slate-200 rounded-2xl overflow-hidden">
            {data.shifts.length === 0 && data.absences.length === 0 && <p className="px-4 py-5 text-center text-slate-500">אין רישומים בחודש הזה</p>}
            {data.shifts.map(s => {
              const edits = data.edits.filter(e => e.shift_id === s.id);
              return (
                <div key={s.id} className={`px-3 py-2.5 ${s.missing_out ? 'bg-amber-50' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-slate-900">{dayLabel(s.day)}</div>
                      <div className="text-sm tabular-nums text-slate-700">{fmtTime(s.clock_in_at)} – {s.clock_out_at ? fmtTime(s.clock_out_at) : (s.missing_out ? 'חסרה יציאה' : 'במשמרת')}{s.in_tag ? ` · ${s.in_tag}` : ''}{s.status === 'pending' ? ' · ממתין לאישור' : ''}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {s.clock_out_at && <span className="font-black tabular-nums">{fmtDur(s.minutes)}</span>}
                      <button onClick={() => { setError(''); setEdit({ id: s.id, day: s.day, inT: fmtTime(s.clock_in_at), outT: s.clock_out_at ? fmtTime(s.clock_out_at) : '', reason: '' }); }} className="min-h-11 px-2 text-sm font-bold text-violet-700 underline">תיקון</button>
                    </div>
                  </div>
                  {edits.map((e, i) => <div key={i} className="text-xs text-slate-600 mt-0.5">שונה ע״י {e.by_name || '—'}: {e.reason}</div>)}
                </div>
              );
            })}
            {data.absences.map(a => (
              <div key={`a${a.id}`} className="px-3 py-2.5 flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-900">{dayLabel(a.from_date)}{a.to_date !== a.from_date ? ` – ${shortDate(a.to_date)}` : ''}</div>
                  <div className="text-sm text-slate-700">{daysText(a.days)} · {STATUS_LABEL[a.status] || a.status}</div>
                </div>
                <span className="text-sm font-black px-2.5 py-1 rounded-full bg-slate-100 text-slate-800">{ABSENCE_LABEL[a.type]}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

// ---- setup: employees, tags, venue ------------------------------------------------------------
function Setup({ onChanged }) {
  const [emps, setEmps] = useState([]);
  const [tags, setTags] = useState([]);
  const [settings, setSettings] = useState(null);
  const [editEmp, setEditEmp] = useState(null);
  const [newTag, setNewTag] = useState('');
  const [msg, setMsg] = useState('');
  const load = () => {
    api.get('/attendance/employees').then(r => setEmps(r.data)).catch(() => {});
    api.get('/attendance/tags').then(r => setTags(r.data)).catch(() => {});
    api.get('/attendance/settings').then(r => setSettings(r.data)).catch(() => {});
  };
  useEffect(load, []);

  async function saveEmp() {
    try { await api.put(`/attendance/employees/${editEmp.id}`, editEmp); setEditEmp(null); load(); onChanged(); }
    catch (err) { setMsg(err.response?.data?.error || 'השמירה נכשלה'); }
  }
  async function addTag() {
    if (!newTag.trim()) return;
    try { await api.post('/attendance/tags', { label: newTag.trim() }); setNewTag(''); load(); }
    catch (err) { setMsg(err.response?.data?.error || 'ההוספה נכשלה'); }
  }
  async function copy(url) {
    try { await navigator.clipboard.writeText(url); setMsg('הקישור הועתק'); } catch { setMsg(url); }
  }
  async function useMyLocation() {
    setMsg('מאתר מיקום…');
    const pos = await getPosition(12000);
    if (!pos) return setMsg('לא התקבל מיקום מהטלפון. יש לאשר שיתוף מיקום ולנסות שוב.');
    const { data } = await api.put('/attendance/settings', { lat: pos.lat, lng: pos.lng });
    setSettings(data); setMsg(`המיקום נשמר (דיוק ${Math.round(pos.accuracy)} מ׳)`);
  }
  async function saveNumbers() {
    const { data } = await api.put('/attendance/settings', { radius_m: settings.radius_m, open_shift_h: settings.open_shift_h });
    setSettings(data); setMsg('נשמר');
  }

  return (
    <div className="flex flex-col gap-4">
      {msg && <p className="text-sm font-bold text-violet-800 break-all">{msg}</p>}

      <section className="flex flex-col gap-2">
        <h3 className="font-black text-slate-900">מי מחתים נוכחות</h3>
        <div className="bg-white rounded-2xl divide-y divide-slate-200 overflow-hidden">
          {emps.map(u => (
            <button key={u.id} onClick={() => setEditEmp({ ...u, balance_date: u.balance_date || todayIL(), reset_devices: false })} className="w-full px-3.5 py-3 flex items-center justify-between text-right">
              <span className="font-bold text-slate-900">{u.name}</span>
              <span className={`text-sm font-black px-2.5 py-1 rounded-full ${u.attendance_enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{u.attendance_enabled ? 'מחתים' : 'לא מחתים'}</span>
            </button>
          ))}
        </div>
        <p className="text-sm text-slate-600">עובד קבוע שאין לו משתמש: פותחים לו משתמש בהגדרות עם ההרשאה "נוכחות בלבד", ואז מסמנים אותו כאן.</p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-black text-slate-900">נקודות החתמה (מדבקות NFC)</h3>
        {tags.map(t => (
          <div key={t.id} className="bg-white rounded-2xl p-3.5 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900">{t.label}</span>
              <button onClick={async () => { await api.put(`/attendance/tags/${t.id}`, { active: !t.active }); load(); }} className={`text-sm font-black px-2.5 py-1 rounded-full ${t.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>{t.active ? 'פעילה' : 'מושבתת'}</button>
            </div>
            <span dir="ltr" className="text-xs text-slate-700 break-all text-left">{t.url}</span>
            <button onClick={() => copy(t.url)} className="text-sm font-bold text-violet-700 underline self-start">העתקת הקישור לכתיבה על המדבקה</button>
          </div>
        ))}
        <div className="flex gap-2">
          <input className={inputCls} placeholder="שם הנקודה, למשל: הבר" value={newTag} onChange={e => setNewTag(e.target.value)} />
          <button onClick={addTag} className="min-h-11 px-4 rounded-xl bg-violet-600 text-white font-black shrink-0">הוספה</button>
        </div>
        <p className="text-sm text-slate-600">את הקישור כותבים על המדבקה באפליקציית NFC Tools (Write → Add a record → URL) ונועלים אותה.</p>
      </section>

      {settings && (
        <section className="flex flex-col gap-2">
          <h3 className="font-black text-slate-900">מיקום העסק</h3>
          <div className="bg-white rounded-2xl p-3.5 flex flex-col gap-2.5">
            {settings.lat === null
              ? <p className="text-amber-900 bg-amber-50 border border-amber-300 rounded-xl px-3 py-2 font-semibold text-sm">עוד לא הוגדר מיקום – כרגע אפשר להחתים מכל מקום.</p>
              : <p className="text-sm text-slate-700" dir="ltr">{settings.lat.toFixed(5)}, {settings.lng.toFixed(5)}</p>}
            <button onClick={useMyLocation} className={btnNo}>אני עכשיו בעסק – שמירת המיקום הזה</button>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm font-bold text-slate-700">רדיוס (מטרים)<input type="number" className={inputCls} value={settings.radius_m} onChange={e => setSettings({ ...settings, radius_m: e.target.value })} /></label>
              <label className="text-sm font-bold text-slate-700">"חסרה יציאה" אחרי (שעות)<input type="number" className={inputCls} value={settings.open_shift_h} onChange={e => setSettings({ ...settings, open_shift_h: e.target.value })} /></label>
            </div>
            <button onClick={saveNumbers} className={btnNo}>שמירה</button>
          </div>
        </section>
      )}

      {editEmp && (
        <Modal title={editEmp.name} onClose={() => setEditEmp(null)}>
          <label className="flex items-center gap-2.5 min-h-11 font-bold text-slate-900">
            <input type="checkbox" className="w-5 h-5 accent-violet-600" checked={!!editEmp.attendance_enabled} onChange={e => setEditEmp({ ...editEmp, attendance_enabled: e.target.checked })} /> מחתים נוכחות
          </label>
          <label className="text-sm font-bold text-slate-700">היתרות נכונות לתאריך<input type="date" className={inputCls} value={editEmp.balance_date || ''} onChange={e => setEditEmp({ ...editEmp, balance_date: e.target.value })} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm font-bold text-slate-700">יתרת חופשה בתאריך הזה<input type="number" step="0.5" className={inputCls} value={editEmp.vacation_opening ?? 0} onChange={e => setEditEmp({ ...editEmp, vacation_opening: e.target.value })} /></label>
            <label className="text-sm font-bold text-slate-700">ימי מחלה צבורים בתאריך הזה<input type="number" step="0.5" className={inputCls} value={editEmp.sick_opening ?? 0} onChange={e => setEditEmp({ ...editEmp, sick_opening: e.target.value })} /></label>
          </div>
          <label className="text-sm font-bold text-slate-700">מכסת חופשה שנתית (ימים)<input type="number" step="0.5" className={inputCls} value={editEmp.vacation_quota_days ?? 0} onChange={e => setEditEmp({ ...editEmp, vacation_quota_days: e.target.value })} /></label>
          <p className="text-sm text-slate-600">מהתאריך הזה: חופשה נצברת כל חודש (המכסה חלקי 12), מחלה 1.5 יום לחודש עד 90, וימים שאושרו יורדים מהיתרה.</p>
          {editEmp.devices > 0 && (
            <label className="flex items-center gap-2.5 min-h-11 text-sm font-bold text-slate-800">
              <input type="checkbox" className="w-5 h-5 accent-violet-600" checked={!!editEmp.reset_devices} onChange={e => setEditEmp({ ...editEmp, reset_devices: e.target.checked })} /> איפוס הטלפון הרשום (למשל כשהעובד החליף טלפון)
            </label>
          )}
          <button onClick={saveEmp} className={btnOk}>שמירה</button>
        </Modal>
      )}
    </div>
  );
}

// ---- the page ---------------------------------------------------------------------------------
export default function AttendancePage() {
  const [tab, setTab] = useState('main'); // main | setup
  const [month, setMonth] = useState(todayIL().slice(0, 7));
  const [now, setNow] = useState([]);
  const [pending, setPending] = useState([]);
  const [summary, setSummary] = useState([]);
  const [openUser, setOpenUser] = useState(null);
  const [denied, setDenied] = useState(false);

  function load() {
    api.get('/attendance/now').then(r => setNow(r.data)).catch(e => { if (e.response?.status === 403) setDenied(true); });
    api.get('/attendance/pending').then(r => setPending(r.data)).catch(() => {});
    api.get(`/attendance/month?month=${month}`).then(r => setSummary(r.data.rows)).catch(() => {});
  }
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [month]);

  function exportCsv() {
    const rows = [['עובד', 'שעות', 'ימי עבודה', 'ימי חופשה', 'ימי מחלה', 'חסרה יציאה']];
    summary.forEach(r => rows.push([r.name, fmtDur(r.minutes), r.work_days, Number(r.vacation_days), Number(r.sick_days), r.missing || '']));
    downloadCsv(`נוכחות-${month}.csv`, rows);
  }

  if (denied) return <div className="p-6 text-center font-bold text-slate-700" dir="rtl">המסך הזה פתוח למנהלים בלבד.</div>;
  const isThisMonth = month === todayIL().slice(0, 7);
  return (
    <div className="px-4 py-4 max-w-2xl mx-auto flex flex-col gap-4" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black text-slate-900">נוכחות</h1>
        <div className="grid grid-cols-2 bg-white rounded-xl p-1 border border-slate-200">
          <button onClick={() => setTab('main')} aria-pressed={tab === 'main'} className={`min-h-10 px-4 rounded-lg text-sm font-black ${tab === 'main' ? 'bg-violet-600 text-white' : 'text-slate-700'}`}>יומי</button>
          <button onClick={() => setTab('setup')} aria-pressed={tab === 'setup'} className={`min-h-10 px-4 rounded-lg text-sm font-black ${tab === 'setup' ? 'bg-violet-600 text-white' : 'text-slate-700'}`}>הגדרות</button>
        </div>
      </div>

      {tab === 'setup' ? <Setup onChanged={load} /> : (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="font-black text-slate-900">במשמרת עכשיו · {now.length}</h2>
            <div className="bg-white rounded-2xl divide-y divide-slate-200 overflow-hidden">
              {now.length === 0 && <p className="px-4 py-4 text-slate-500">אף אחד לא במשמרת כרגע</p>}
              {now.map(s => (
                <div key={s.id} className="px-3.5 py-3 flex items-center justify-between">
                  <span className="flex items-center gap-2.5 font-bold text-slate-900"><span aria-hidden="true" className="w-3 h-3 rounded-full bg-emerald-600" />{s.name}</span>
                  <span className="text-sm text-slate-700 tabular-nums">מ-{fmtTime(s.clock_in_at)}{s.tag ? ` · ${s.tag}` : ''}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-black text-slate-900">ממתין לטיפול · {pending.length}</h2>
            {pending.length === 0 && <p className="bg-white rounded-2xl px-4 py-4 text-slate-500">אין מה לאשר</p>}
            {pending.map(p => <PendingCard key={`${p.kind}${p.id}`} item={p} onDone={load} />)}
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <button onClick={() => setMonth(m => shiftMonth(m, -1))} aria-label="חודש קודם" className="w-11 h-11 rounded-xl bg-white border border-slate-200 text-sm font-black text-slate-700">▶</button>
                <span className="min-w-28 text-center font-black text-slate-900">{monthLabel(month)}</span>
                <button onClick={() => setMonth(m => shiftMonth(m, 1))} disabled={isThisMonth} aria-label="חודש הבא" className="w-11 h-11 rounded-xl bg-white border border-slate-200 text-sm font-black text-slate-700 disabled:opacity-40">◀</button>
              </div>
              <button onClick={exportCsv} className="min-h-11 px-3 rounded-xl border-2 border-violet-600 bg-white text-violet-800 text-sm font-black">הורדה לאקסל</button>
            </div>
            <div className="bg-white rounded-2xl overflow-hidden">
              <div className="px-3.5 py-2.5 grid grid-cols-[2fr_1.4fr_1fr_1fr] gap-1.5 text-[13px] font-bold text-slate-600 border-b border-slate-200">
                <span>עובד</span><span>שעות</span><span>חופשה</span><span>מחלה</span>
              </div>
              {summary.length === 0 && <p className="px-4 py-4 text-slate-500">עוד לא הוגדרו עובדים מחתימים – ראה "הגדרות".</p>}
              {summary.map(r => (
                <button key={r.id} onClick={() => setOpenUser(r.id)} className="w-full px-3.5 py-3 grid grid-cols-[2fr_1.4fr_1fr_1fr] gap-1.5 text-right border-b border-slate-200 last:border-b-0 hover:bg-violet-50/50">
                  <span className="font-bold text-violet-800">{r.name}{r.missing > 0 && <span className="text-amber-800 text-xs font-bold block">חסרה יציאה ×{r.missing}</span>}</span>
                  <span className="font-black tabular-nums">{fmtDur(r.minutes)}</span><span>{Number(r.vacation_days)}</span><span>{Number(r.sick_days)}</span>
                </button>
              ))}
            </div>
            <p className="text-[13px] text-slate-600">לחיצה על עובד פותחת את כל הימים שלו, עם תיקון והוספה ידנית.</p>
          </section>
        </>
      )}
      {openUser && <UserMonth userId={openUser} month={month} onClose={() => setOpenUser(null)} onChanged={load} />}
    </div>
  );
}
