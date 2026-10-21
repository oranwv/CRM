import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAppMode } from '../context/AppModeContext';
import { israelLocalToISO, isoToIsraelLocal } from '../utils/israelTime';

const TOOL_LABELS = {
  get_my_tasks:       'מחפש משימות...',
  get_today_schedule: 'מושך לוז היום...',
  get_leads:          'מחפש לידים...',
  get_lead_details:   'טוען פרטי ליד...',
  get_urgent_leads:   'מחפש לידים דחופים...',
  get_op_tasks:       'מחפש משימות תפעול...',
  get_maintenance:    'טוען לוח תחזוקה...',
  get_suppliers:      'מחפש ספקים...',
  get_rsvp_summary:   'טוען נתוני אישורי הגעה...',
  get_lead_documents: 'בודק הצעות, חוזים ומסמכים...',
  get_sales_worklist: 'טוען את רשימת AI מכירות...',
  get_analytics_kpis: 'מחשב נתוני אנליטיקס...',
  get_finance_summary:'טוען תמונת כספים...',
  get_event_brief:    'טוען בריף אירוע...',
  get_employee_activity: 'טוען פעילות עובדים...',
  propose_task:       'מכין הצעת משימה...',
  propose_note:       'מכין הערה...',
  propose_fault:      'מכין דיווח תקלה...',
  propose_lead:       'מכין כרטיס ליד חדש...',
  propose_meeting:    'מכין כרטיס פגישה...',
};

const ACTION_META = {
  task:  { icon: '✅', title: 'משימה חדשה',   confirm: 'צור משימה' },
  note:  { icon: '📝', title: 'הערה בליד',     confirm: 'הוסף הערה' },
  fault: { icon: '🔧', title: 'תקלה לתפעול',  confirm: 'פתח תקלה' },
  lead:  { icon: '🆕', title: 'ליד חדש',       confirm: 'צור ליד' },
  meeting: { icon: '📅', title: 'פגישה ביומן', confirm: 'קבע פגישה' },
};

// Staff list for the assignee / host pickers in the chat cards (fetched once per page load)
let usersCache = null;
function useStaff() {
  const [users, setUsers] = useState(usersCache || []);
  useEffect(() => {
    if (usersCache) return;
    const token = localStorage.getItem('crm_token');
    fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : []).then(rows => { if (Array.isArray(rows)) { usersCache = rows; setUsers(rows); } }).catch(() => {});
  }, []);
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  return users.length ? users : (me.id ? [{ id: me.id, display_name: me.display_name || me.username }] : []);
}

// "פגישה" proposal: date, times, who holds it (picker) and WhatsApp to the customer. Same booking
// path as the lead card's "קבע פגישה". Nothing happens until "קבע ושלח".
function MeetingActionCard({ action, onDone }) {
  const users = useStaff();
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const [f, setF] = useState(() => ({
    date: action.date || '', start: action.start_time || '', end: action.end_time || '',
    host: action.host_user_id ? String(action.host_user_id) : (me.id ? String(me.id) : ''),
    wa: action.send_whatsapp !== false && !!action.phone,
  }));
  const [state, setState] = useState(action.state || 'pending');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const inputCls = 'w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-violet-400';
  const lbl = 'block text-[10px] font-bold text-slate-500 mb-0.5';

  async function confirm() {
    setState('saving'); setError('');
    try {
      const token = localStorage.getItem('crm_token');
      const r = await fetch('/api/chat/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind: 'meeting', lead_id: action.lead_id, title: action.title, date: f.date, start_time: f.start, end_time: f.end || null, host_user_id: f.host ? Number(f.host) : null, send_whatsapp: !!f.wa && !!action.phone }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'שגיאה');
      setResult(data); setState('done'); onDone?.('done');
    } catch (e) { setState('error'); setError(e.message || 'שגיאה'); }
  }

  if (state === 'done') {
    return (
      <div className="my-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 space-y-0.5">
        <div className="font-bold">📅 פגישה נקבעה ✓ · {action.lead_name}</div>
        {!!result?.done?.length && <div className="text-emerald-700">{result.done.join(' · ')}</div>}
        {!!result?.failed?.length && <div className="text-red-600">לא הצליח: {result.failed.join(', ')}</div>}
      </div>
    );
  }
  if (state === 'cancelled') {
    return <div className="my-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">📅 פגישה — בוטל</div>;
  }
  return (
    <div className="my-2 rounded-xl border border-violet-200 bg-violet-50/60 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-black text-violet-800">📅 פגישה ביומן</span>
        {action.lead_name && <span className="text-[11px] text-slate-500 truncate max-w-[55%]">{action.lead_name}</span>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2"><label className={lbl}>תאריך{f.date && heDay(f.date) ? ` · יום ${heDay(f.date)}` : ''}</label>
          <input type="date" value={f.date} onChange={e => set('date', e.target.value)} className={inputCls} dir="ltr" /></div>
        <div><label className={lbl}>התחלה</label><input type="time" value={f.start} onChange={e => set('start', e.target.value)} className={inputCls} dir="ltr" /></div>
        <div><label className={lbl}>סיום</label><input type="time" value={f.end} onChange={e => set('end', e.target.value)} className={inputCls} dir="ltr" /></div>
        <div className="col-span-2"><label className={lbl}>מקיים את הפגישה</label>
          <select value={f.host} onChange={e => set('host', e.target.value)} className={inputCls}>
            {users.map(u => <option key={u.id} value={String(u.id)}>{u.display_name || u.username}</option>)}
          </select></div>
        <label className="col-span-2 flex items-center gap-2 text-[11px] text-slate-600 cursor-pointer">
          <input type="checkbox" checked={!!f.wa && !!action.phone} disabled={!action.phone} onChange={e => set('wa', e.target.checked)} className="accent-violet-600" />
          לשלוח ללקוח בוואטסאפ את פרטי הפגישה{!action.phone ? ' (אין טלפון)' : ''}
        </label>
      </div>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={confirm} disabled={state === 'saving' || !f.date || !f.start}
          className="flex-1 text-xs font-bold text-white rounded-lg py-1.5 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
          {state === 'saving' ? 'קובע...' : (f.wa && action.phone ? 'קבע פגישה ושלח לזוג' : 'קבע פגישה')}
        </button>
        <button onClick={() => { setState('cancelled'); onDone?.('cancelled'); }} disabled={state === 'saving'}
          className="text-xs font-bold text-slate-500 border border-slate-200 rounded-lg px-3 py-1.5 bg-white">בטל</button>
      </div>
    </div>
  );
}

const LEAD_EVENT_TYPES = ['חתונה', 'בר/בת מצווה', 'אירוסין', 'יום הולדת', 'כנס', 'אירוע חברה', 'חינה'];
const LEAD_PRIORITIES  = [['normal', 'רגיל'], ['hot', 'גבוה'], ['urgent', 'דחוף']];
const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
function heDay(ymd) { if (!ymd) return ''; const d = new Date(ymd + 'T00:00:00Z'); return isNaN(d) ? '' : HE_DAYS[d.getUTCDay()]; }

// "ליד חדש" proposal: every field editable, plus the timeline entry, an optional meeting
// (same booking path as the lead card + WhatsApp to the customer) and an optional task.
// Nothing is written until "צור ליד".
function LeadActionCard({ action, onDone }) {
  const meta = ACTION_META.lead;
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const users = useStaff();
  const [f, setF] = useState(() => ({
    name: action.name || '', phone: action.phone || '', email: action.email || '',
    event_name: action.event_name || '', event_date: action.event_date || '', event_time: action.event_time || '', event_end_time: action.event_end_time || '',
    event_type: action.event_type || '', guest_count: action.guest_count || '', budget: action.budget || '',
    priority: action.priority || 'normal', assigned_to: action.assigned_to ? String(action.assigned_to) : (me.id ? String(me.id) : ''),
    log_on: !!action.log?.body, log_type: action.log?.type || 'note', log_body: action.log?.body || '',
  }));
  const [state, setState] = useState(action.state || 'pending');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const inputCls = 'w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-violet-400';
  const lbl = 'block text-[10px] font-bold text-slate-500 mb-0.5';
  const typeIsOther = f.event_type && !LEAD_EVENT_TYPES.includes(f.event_type);

  async function confirm() {
    setState('saving'); setError('');
    try {
      const token = localStorage.getItem('crm_token');
      const payload = {
        kind: 'lead', name: f.name, phone: f.phone, email: f.email, event_name: f.event_name,
        event_date: f.event_date || null, event_time: f.event_time || null, event_end_time: f.event_end_time || null,
        event_type: f.event_type || null, guest_count: f.guest_count || null, budget: f.budget || null,
        source: action.source || 'manual', priority: f.priority, assigned_to: f.assigned_to ? Number(f.assigned_to) : null,
        log: f.log_on && f.log_body.trim() ? { type: f.log_type, body: f.log_body } : null,
      };
      const r = await fetch('/api/chat/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'שגיאה');
      setResult(data); setState('done'); onDone?.('done');
    } catch (e) {
      setState('error'); setError(e.message || 'שגיאה');
    }
  }

  if (state === 'done') {
    const leadRef = { lead_id: result?.lead_id, lead_name: result?.lead_name || f.name, phone: f.phone };
    return (
      <>
        <div className="my-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 space-y-0.5">
          <div className="font-bold">{meta.icon} ליד נוצר ✓ · <a href={`/?lead=${result?.lead_id}`} className="underline">{result?.lead_name || f.name}</a></div>
          {!!result?.done?.length && <div className="text-emerald-700">{result.done.join(' · ')}</div>}
          {!!result?.failed?.length && <div className="text-red-600">לא הצליח: {result.failed.join(', ')}</div>}
        </div>
        {/* The meeting and the task the message mentioned come as their own cards, each with its own picker + button */}
        {action.meeting && <MeetingActionCard action={{ kind: 'meeting', ...action.meeting, ...leadRef }} />}
        {action.task && <ActionCard action={{ kind: 'task', ...action.task, ...leadRef }} />}
      </>
    );
  }
  if (state === 'cancelled') {
    return <div className="my-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">{meta.icon} {meta.title} — בוטל</div>;
  }
  const userOpts = users;
  const toggle = (k, label) => (
    <label className="flex items-center gap-2 text-xs font-black text-violet-800 cursor-pointer select-none">
      <input type="checkbox" checked={!!f[k]} onChange={e => set(k, e.target.checked)} className="accent-violet-600" />
      {label}
    </label>
  );
  return (
    <div className="my-2 rounded-xl border border-violet-200 bg-violet-50/60 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-black text-violet-800">{meta.icon} {meta.title}</span>
        <span className="text-[11px] text-slate-500">ניתן לערוך כל שדה לפני האישור</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div><label className={lbl}>שם *</label><input value={f.name} onChange={e => set('name', e.target.value)} className={inputCls} /></div>
        <div><label className={lbl}>טלפון</label><input value={f.phone} onChange={e => set('phone', e.target.value)} className={inputCls} dir="ltr" placeholder="05X-XXXXXXX" /></div>
        <div className="col-span-2"><label className={lbl}>שם האירוע</label><input value={f.event_name} onChange={e => set('event_name', e.target.value)} className={inputCls} /></div>
        <div className="col-span-2"><label className={lbl}>תאריך האירוע{f.event_date && heDay(f.event_date) ? ` · יום ${heDay(f.event_date)}` : ''}</label>
          <input type="date" value={f.event_date} onChange={e => set('event_date', e.target.value)} className={inputCls} dir="ltr" /></div>
        <div><label className={lbl}>שעת האירוע</label><input type="time" value={f.event_time} onChange={e => set('event_time', e.target.value)} className={inputCls} dir="ltr" /></div>
        <div><label className={lbl}>שעת סיום</label><input type="time" value={f.event_end_time} onChange={e => set('event_end_time', e.target.value)} className={inputCls} dir="ltr" /></div>
        <div><label className={lbl}>סוג אירוע</label>
          <select value={typeIsOther ? 'אחר' : f.event_type} onChange={e => set('event_type', e.target.value === 'אחר' ? (typeIsOther ? f.event_type : 'אחר') : e.target.value)} className={inputCls}>
            <option value="">—</option>
            {LEAD_EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            <option value="אחר">אחר</option>
          </select></div>
        <div><label className={lbl}>פירוט סוג</label>
          <input value={typeIsOther ? f.event_type : ''} onChange={e => set('event_type', e.target.value || 'אחר')} disabled={!typeIsOther && f.event_type !== 'אחר'} className={`${inputCls} disabled:bg-slate-50`} placeholder="למשל שבת חתן" /></div>
        <div><label className={lbl}>מוזמנים</label><input value={f.guest_count} onChange={e => set('guest_count', e.target.value)} className={inputCls} dir="ltr" /></div>
        <div><label className={lbl}>תקציב</label><input value={f.budget} onChange={e => set('budget', e.target.value)} className={inputCls} /></div>
        <div><label className={lbl}>אימייל</label><input value={f.email} onChange={e => set('email', e.target.value)} className={inputCls} dir="ltr" /></div>
        <div><label className={lbl}>עדיפות</label>
          <select value={f.priority} onChange={e => set('priority', e.target.value)} className={inputCls}>
            {LEAD_PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></div>
        <div className="col-span-2"><label className={lbl}>אחראי</label>
          <select value={f.assigned_to} onChange={e => set('assigned_to', e.target.value)} className={inputCls}>
            {userOpts.map(u => <option key={u.id} value={String(u.id)}>{u.display_name || u.username}</option>)}
          </select></div>
      </div>

      <div className="rounded-lg border border-violet-100 bg-white/70 p-2 space-y-1.5">
        <div className="flex items-center justify-between">
          {toggle('log_on', 'תיעוד בציר הזמן')}
          {f.log_on && (
            <div className="flex gap-1 text-[11px]">
              {[['call', '📞 שיחה'], ['note', '📝 הערה']].map(([v, l]) => (
                <button key={v} type="button" onClick={() => set('log_type', v)}
                  className={`px-2 py-0.5 rounded-full border ${f.log_type === v ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200'}`}>{l}</button>
              ))}
            </div>
          )}
        </div>
        {f.log_on && <textarea value={f.log_body} onChange={e => set('log_body', e.target.value)} rows={6} className={inputCls} />}
      </div>

      {error && <p className="text-[11px] text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={confirm} disabled={state === 'saving' || !f.name.trim()}
          className="flex-1 text-xs font-bold text-white rounded-lg py-1.5 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
          {state === 'saving' ? 'שומר...' : meta.confirm}
        </button>
        <button onClick={() => { setState('cancelled'); onDone?.('cancelled'); }} disabled={state === 'saving'}
          className="text-xs font-bold text-slate-500 border border-slate-200 rounded-lg px-3 py-1.5 bg-white">
          בטל
        </button>
      </div>
    </div>
  );
}

// datetime-local value in Israel time, whatever the device timezone (2026-10-15)
function toLocalInput(iso) { return isoToIsraelLocal(iso); }

// A proposal the assistant made (task / note / fault). Nothing exists until "אשר".
function ActionCard({ action, onDone }) {
  const meta = ACTION_META[action.kind] || { icon: '⚡', title: 'פעולה', confirm: 'אשר' };
  const staff = useStaff();
  const [form, setForm] = useState(() => ({
    title: action.title || '', body: action.body || '', description: action.description || '',
    due_at: toLocalInput(action.due_at),
    assigned_to: action.assigned_to ? String(action.assigned_to) : '',
  }));
  const [state, setState] = useState(action.state || 'pending'); // pending | saving | done | cancelled | error
  const [error, setError] = useState('');
  const inputCls = 'w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-violet-400';

  async function confirm() {
    setState('saving'); setError('');
    try {
      const token = localStorage.getItem('crm_token');
      const payload = { kind: action.kind, lead_id: action.lead_id, assigned_to: action.assigned_to };
      if (action.kind === 'task')  Object.assign(payload, { title: form.title, due_at: israelLocalToISO(form.due_at), assigned_to: form.assigned_to ? Number(form.assigned_to) : action.assigned_to });
      if (action.kind === 'note')  Object.assign(payload, { body: form.body });
      if (action.kind === 'fault') Object.assign(payload, { title: form.title, description: form.description });
      const r = await fetch('/api/chat/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'שגיאה');
      setState('done'); onDone?.('done');
    } catch (e) {
      setState('error'); setError(e.message || 'שגיאה');
    }
  }

  if (state === 'done') {
    return (
      <div className="my-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 font-bold">
        {meta.icon} {meta.title} — בוצע ✓{action.lead_name ? ` · ${action.lead_name}` : ''}
      </div>
    );
  }
  if (state === 'cancelled') {
    return <div className="my-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">{meta.icon} {meta.title} — בוטל</div>;
  }
  return (
    <div className="my-2 rounded-xl border border-violet-200 bg-violet-50/60 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-black text-violet-800">{meta.icon} {meta.title}</span>
        {action.lead_name && <span className="text-[11px] text-slate-500 truncate max-w-[55%]">{action.lead_name}</span>}
      </div>
      {(action.kind === 'task' || action.kind === 'fault') && (
        <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={inputCls} placeholder="כותרת" />
      )}
      {action.kind === 'task' && (
        <div className="flex items-center gap-2">
          <input type="datetime-local" value={form.due_at} onChange={e => setForm(f => ({ ...f, due_at: e.target.value }))}
            className={inputCls} style={{ direction: 'ltr' }} />
        </div>
      )}
      {action.kind === 'task' && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500 whitespace-nowrap">אחראי:</span>
          <select value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))} className={inputCls}>
            {!form.assigned_to && <option value="">{action.assigned_name || 'אני'}</option>}
            {staff.map(u => <option key={u.id} value={String(u.id)}>{u.display_name || u.username}</option>)}
          </select>
          <span className="text-[11px] text-slate-400 whitespace-nowrap">· תזכורת בוואטסאפ</span>
        </div>
      )}
      {action.kind === 'note' && (
        <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} rows={3} className={inputCls} />
      )}
      {action.kind === 'fault' && (
        <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} className={inputCls} placeholder="תיאור התקלה" />
      )}
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={confirm} disabled={state === 'saving' || (!form.title && !form.body)}
          className="flex-1 text-xs font-bold text-white rounded-lg py-1.5 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
          {state === 'saving' ? 'שומר...' : meta.confirm}
        </button>
        <button onClick={() => { setState('cancelled'); onDone?.('cancelled'); }} disabled={state === 'saving'}
          className="text-xs font-bold text-slate-500 border border-slate-200 rounded-lg px-3 py-1.5 bg-white">
          בטל
        </button>
      </div>
    </div>
  );
}

// "שלח בוואטסאפ" for a knowledge file / media item: to the open lead, to me, or to a number.
function SendSheet({ kind, id, name, leadId, leadName, onClose }) {
  const [target, setTarget] = useState(leadId ? 'lead' : 'self');
  const [phone, setPhone]   = useState('');
  const [state, setState]   = useState('idle'); // idle | sending | sent | error
  const [error, setError]   = useState('');

  async function send() {
    setState('sending'); setError('');
    try {
      const token = localStorage.getItem('crm_token');
      const body = { kind, id };
      if (target === 'lead')  body.leadId = leadId;
      if (target === 'self')  body.toSelf = true;
      if (target === 'phone') { body.phone = phone; if (leadId) body.leadId = leadId; }
      const r = await fetch('/api/chat/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'השליחה נכשלה');
      setState('sent');
      setTimeout(onClose, 1200);
    } catch (e) { setState('error'); setError(e.message); }
  }

  const opt = (val, label) => (
    <label className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg border cursor-pointer ${target === val ? 'border-violet-400 bg-white' : 'border-transparent'}`}>
      <input type="radio" checked={target === val} onChange={() => setTarget(val)} />
      <span>{label}</span>
    </label>
  );

  return (
    <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50/70 p-2.5 space-y-1.5" onClick={e => e.stopPropagation()}>
      <p className="text-[11px] font-bold text-emerald-800 truncate">שליחה בוואטסאפ · {name}</p>
      {leadId && opt('lead', `ללקוח${leadName ? ` — ${leadName}` : ''}`)}
      {opt('self', 'אליי (לנייד שלי)')}
      {opt('phone', 'למספר אחר')}
      {target === 'phone' && (
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="05x-xxxxxxx" inputMode="tel"
          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white" style={{ direction: 'ltr' }} />
      )}
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      <div className="flex gap-2 pt-0.5">
        <button onClick={send} disabled={state === 'sending' || state === 'sent' || (target === 'phone' && phone.replace(/\D/g, '').length < 9)}
          className="flex-1 text-xs font-bold text-white rounded-lg py-1.5 bg-emerald-600 disabled:opacity-50">
          {state === 'sending' ? 'שולח...' : state === 'sent' ? 'נשלח ✓' : 'שלח'}
        </button>
        <button onClick={onClose} className="text-xs font-bold text-slate-500 border border-slate-200 rounded-lg px-3 py-1.5 bg-white">סגור</button>
      </div>
    </div>
  );
}

// A knowledge file the assistant handed over — download + send over WhatsApp.
function FileChip({ item, id, leadId, leadName }) {
  const [sending, setSending] = useState(false);
  if (!item) return <span className="text-xs text-slate-400">(קובץ {id} לא נמצא)</span>;
  const ext = ((item.filename.match(/\.([a-z0-9]+)$/i) || [])[1] || '').toUpperCase();
  return (
    <div className="my-2">
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
        <span className="w-9 h-9 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center text-[10px] font-black shrink-0">{ext || '📄'}</span>
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 text-sm font-bold text-slate-800 truncate hover:underline" title={item.filename}>
          {item.filename}
        </a>
        <button onClick={() => setSending(v => !v)} title="שלח בוואטסאפ"
          className="shrink-0 w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center hover:bg-emerald-600 transition">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2m0 18.15c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.26 8.26 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24 4.54 0 8.24 3.7 8.24 8.24s-3.7 8.24-8.23 8.24m4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.17.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18l-.47-.25"/></svg>
        </button>
      </div>
      {sending && <SendSheet kind="file" id={id} name={item.filename} leadId={leadId} leadName={leadName} onClose={() => setSending(false)} />}
    </div>
  );
}

// Render a KB media item (image / uploaded video / YouTube / Google Drive).
function MediaEmbed({ item, id, leadId, leadName }) {
  const [sending, setSending] = useState(false);
  if (!item || !item.url) return null;
  const { url, media_type, title } = item;
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/);
  const gd = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  let media;
  if (yt) {
    media = <iframe className="w-full rounded-xl border border-slate-200" style={{ aspectRatio: '16 / 9' }}
      src={`https://www.youtube.com/embed/${yt[1]}`} title={title || 'video'} allowFullScreen
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" />;
  } else if (gd) {
    media = <iframe className="w-full rounded-xl border border-slate-200" style={{ aspectRatio: '16 / 9' }}
      src={`https://drive.google.com/file/d/${gd[1]}/preview`} title={title || 'video'} allowFullScreen />;
  } else if (media_type === 'image') {
    media = <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt={title || ''} className="w-full rounded-xl border border-slate-200 object-contain" /></a>;
  } else {
    media = <video src={url} controls playsInline className="w-full rounded-xl border border-slate-200" />;
  }
  return (
    <div className="my-2">
      <div className="flex items-center justify-between gap-2 mb-1">
        {title ? <div className="text-xs font-bold text-slate-500 truncate">{title}</div> : <span />}
        <button onClick={() => setSending(v => !v)} className="shrink-0 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 hover:bg-emerald-100 transition">
          שלח בוואטסאפ
        </button>
      </div>
      {media}
      {sending && <SendSheet kind="media" id={id} name={title || 'מדיה'} leadId={leadId} leadName={leadName} onClose={() => setSending(false)} />}
    </div>
  );
}

// Render text with [text](url) links and **bold**.
function renderRuns(content, navigate, keyPrefix) {
  const tokens = [];
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0, m;
  while ((m = linkRe.exec(content)) !== null) {
    if (m.index > last) tokens.push({ type: 'text', value: content.slice(last, m.index) });
    tokens.push({ type: 'link', text: m[1], href: m[2] });
    last = m.index + m[0].length;
  }
  if (last < content.length) tokens.push({ type: 'text', value: content.slice(last) });

  return tokens.map((tok, i) => {
    if (tok.type === 'link') {
      if (tok.href.startsWith('tel:')) {
        return <a key={`${keyPrefix}-${i}`} href={tok.href} className="text-blue-600 underline font-semibold">{tok.text}</a>;
      }
      if (tok.href.startsWith('/')) {
        return (
          <a key={`${keyPrefix}-${i}`} href={tok.href} className="text-violet-600 underline font-semibold"
            onClick={e => { e.preventDefault(); navigate(tok.href); }}>
            {tok.text}
          </a>
        );
      }
      return <a key={`${keyPrefix}-${i}`} href={tok.href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">{tok.text}</a>;
    }
    return tok.value.split('\n').map((line, j, arr) => (
      <span key={`${keyPrefix}-${i}-${j}`}>
        {line.split(/(\*\*[^*]+\*\*)/).map((part, k) =>
          part.startsWith('**') && part.endsWith('**')
            ? <strong key={k}>{part.slice(2, -2)}</strong>
            : part
        )}
        {j < arr.length - 1 && <br />}
      </span>
    ));
  });
}

function MarkdownText({ content, mediaMap = {}, fileMap = {}, leadId, leadName }) {
  const navigate = useNavigate();
  // Split out [[media:ID]] / [[file:ID]] tags the assistant may emit, render each as an embed / chip.
  const tagRe = /\[\[(media|file):(\d+)\]\]/g;
  const segments = [];
  let last = 0, mm;
  while ((mm = tagRe.exec(content)) !== null) {
    if (mm.index > last) segments.push({ type: 'text', value: content.slice(last, mm.index) });
    segments.push({ type: mm[1], id: mm[2] });
    last = mm.index + mm[0].length;
  }
  if (last < content.length) segments.push({ type: 'text', value: content.slice(last) });

  return (
    <>
      {segments.map((seg, si) =>
        seg.type === 'media'
          ? <MediaEmbed key={`m-${si}`} id={seg.id} item={mediaMap[seg.id]} leadId={leadId} leadName={leadName} />
          : seg.type === 'file'
          ? <FileChip key={`f-${si}`} id={seg.id} item={fileMap[seg.id]} leadId={leadId} leadName={leadName} />
          : <span key={`t-${si}`}>{renderRuns(seg.value, navigate, `t-${si}`)}</span>
      )}
    </>
  );
}

function Message({ msg, mediaMap, fileMap, leadId, leadName }) {
  const isUser  = msg.role === 'user';
  const isError = msg.error;
  const hasBubble = isUser || isError || (msg.content && msg.content.trim()) || msg.streaming;
  return (
    <div className={`flex flex-col ${isUser ? 'items-start' : 'items-end'} mb-2`}>
      {hasBubble && (
        <div
          className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
            isUser
              ? 'bg-violet-600 text-white rounded-br-sm'
              : isError
              ? 'bg-red-50 text-red-700 border border-red-200 rounded-bl-sm'
              : 'bg-gray-100 text-gray-800 rounded-bl-sm'
          }`}
          dir="rtl"
        >
          {isUser ? msg.content : <MarkdownText content={msg.content} mediaMap={mediaMap} fileMap={fileMap} leadId={leadId} leadName={leadName} />}
          {msg.streaming && (
            <span className="inline-block w-1.5 h-3.5 bg-gray-400 ml-0.5 animate-pulse rounded-sm" />
          )}
        </div>
      )}
      {msg.actions?.length > 0 && (
        <div className="w-[92%]" dir="rtl">
          {msg.actions.map(a => a.kind === 'lead' ? <LeadActionCard key={a.id} action={a} /> : a.kind === 'meeting' ? <MeetingActionCard key={a.id} action={a} /> : <ActionCard key={a.id} action={a} />)}
        </div>
      )}
    </div>
  );
}

export default function AIChat() {
  const location = useLocation();
  const { mode, openLeadId } = useAppMode();

  // All hooks must come before any conditional return
  const [open, setOpen]           = useState(false);
  const [messages, setMessages]   = useState([]);
  const [mediaMap, setMediaMap]   = useState({});
  const [fileMap, setFileMap]     = useState({});
  const [leadName, setLeadName]   = useState('');
  const [input, setInput]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [toolLabel, setToolLabel] = useState('');
  const [btnPos, setBtnPos] = useState(() => {
    try { const s = localStorage.getItem('ai-btn-pos'); return s ? JSON.parse(s) : { right: 16, bottom: 112 }; } catch { return { right: 16, bottom: 112 }; }
  });
  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);
  const abortRef   = useRef(null);
  const posRef     = useRef(btnPos);
  const didDragRef = useRef(false);

  useEffect(() => { posRef.current = btnPos; }, [btnPos]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      // Load the KB media map so [[media:ID]] tags the assistant emits can render.
      const token = localStorage.getItem('crm_token');
      if (token) {
        fetch('/api/chat/media', { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.ok ? r.json() : [])
          .then(list => setMediaMap(Object.fromEntries((list || []).map(m => [String(m.id), m]))))
          .catch(() => {});
        fetch('/api/chat/files', { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.ok ? r.json() : [])
          .then(list => setFileMap(Object.fromEntries((list || []).map(f => [String(f.id), f]))))
          .catch(() => {});
      }
    }
  }, [open]);

  // Name of the lead the user is looking at (for the "שלח ללקוח" option)
  useEffect(() => {
    if (!open || !openLeadId) return;
    const token = localStorage.getItem('crm_token');
    let alive = true;
    fetch(`/api/leads/${openLeadId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(l => { if (alive) setLeadName(l?.name || ''); })
      .catch(() => { if (alive) setLeadName(''); });
    return () => { alive = false; };
  }, [open, openLeadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setLoading(true);
    setToolLabel('');

    const userMsg = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);

    const history = messages.slice(-14).filter(m => m.content).map(m => ({ role: m.role, content: m.content }));
    const token   = localStorage.getItem('crm_token');
    const ctrl    = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: text, history, context: { mode, leadId: openLeadId || undefined } }),
        signal: ctrl.signal,
      });

      if (!resp.ok) {
        setMessages(prev => [...prev, { role: 'assistant', content: 'שגיאה בחיבור לשרת.', error: true }]);
        setLoading(false);
        return;
      }

      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';

        for (const part of parts) {
          if (!part.trim()) continue;
          let eventType = '';
          let dataStr   = '';
          for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim();
            if (line.startsWith('data: '))  dataStr   = line.slice(6).trim();
          }
          if (!dataStr) continue;
          let data;
          try { data = JSON.parse(dataStr); } catch { continue; }

          if (eventType === 'text') {
            setToolLabel('');
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant' && last.streaming) {
                return [...prev.slice(0, -1), { ...last, content: last.content + data.chunk }];
              }
              return [...prev, { role: 'assistant', content: data.chunk, streaming: true }];
            });
          } else if (eventType === 'tool_call') {
            setToolLabel(TOOL_LABELS[data.name] || 'חושב...');
          } else if (eventType === 'action') {
            // A proposal card — attach it to the assistant message being built
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant' && last.streaming) {
                return [...prev.slice(0, -1), { ...last, actions: [...(last.actions || []), data] }];
              }
              return [...prev, { role: 'assistant', content: '', streaming: true, actions: [data] }];
            });
          } else if (eventType === 'done') {
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant' && last.streaming) {
                return [...prev.slice(0, -1), { ...last, streaming: false }];
              }
              return prev;
            });
            setLoading(false);
            setToolLabel('');
          } else if (eventType === 'error') {
            setMessages(prev => [...prev, { role: 'assistant', content: data.message, error: true }]);
            setLoading(false);
            setToolLabel('');
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages(prev => [...prev, { role: 'assistant', content: 'שגיאה בחיבור.', error: true }]);
      }
      setLoading(false);
      setToolLabel('');
    }
  }, [input, loading, messages, mode, openLeadId]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function clearChat() {
    if (abortRef.current) abortRef.current.abort();
    setMessages([]);
    setLoading(false);
    setToolLabel('');
  }

  function handleDragStart(e) {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    didDragRef.current = false;
    const startPos = posRef.current;
    const startX = clientX;
    const startY = clientY;

    function onMove(ev) {
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const dx = startX - cx;
      const dy = startY - cy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDragRef.current = true;
      const next = {
        right:  Math.max(0, Math.min(window.innerWidth  - 56, startPos.right  + dx)),
        bottom: Math.max(0, Math.min(window.innerHeight - 56, startPos.bottom + dy)),
      };
      posRef.current = next;
      setBtnPos(next);
    }
    function onUp() {
      localStorage.setItem('ai-btn-pos', JSON.stringify(posRef.current));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend',  onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend',  onUp);
  }

  // Guard: don't render on public pages or when logged out
  const isPublic   = ['/login', '/postpone', '/task-action', '/sign'].some(p => location.pathname.startsWith(p));
  const isLoggedIn = !!localStorage.getItem('crm_token');
  if (isPublic || !isLoggedIn) return null;

  return (
    <div
      style={{ position: 'fixed', bottom: btnPos.bottom, right: btnPos.right, zIndex: 60, cursor: 'grab', touchAction: 'none' }}
      className="flex flex-col items-end gap-2"
      onMouseDown={handleDragStart}
      onTouchStart={handleDragStart}
    >
      {open && (
        <div
          className="w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
          style={{ height: 'min(480px, calc(100vh - 200px))' }}
        >
          <div
            className="flex items-center justify-between px-4 py-3 text-white text-sm font-bold flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
            dir="rtl"
          >
            <span>עוזר AI</span>
            <div className="flex items-center gap-2">
              {messages.length > 0 && (
                <button onClick={clearChat} className="text-white/70 hover:text-white text-xs transition">
                  נקה
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white text-lg leading-none transition">
                ×
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1" dir="rtl">
            {messages.length === 0 && (
              <div className="text-center text-gray-400 text-xs mt-8 px-4 leading-relaxed">
                שלום! שאל אותי על הלידים, המשימות, הלו"ז, הצעות וחוזים, כספים ומסמכי האולם — ואפשר גם לבקש ממני ליצור משימה, לרשום הערה או לפתוח תקלה.
              </div>
            )}
            {messages.map((msg, i) => <Message key={i} msg={msg} mediaMap={mediaMap} fileMap={fileMap} leadId={openLeadId || null} leadName={openLeadId ? leadName : ''} />)}
            {toolLabel && (
              <div className="flex justify-end mb-1">
                <div className="text-xs text-gray-400 italic px-3 py-1.5 bg-gray-50 rounded-full border border-gray-100">
                  {toolLabel}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="flex-shrink-0 px-3 pb-3 pt-2 border-t border-gray-100">
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="שאל שאלה..."
                disabled={loading}
                rows={1}
                dir="rtl"
                className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-200 transition disabled:opacity-50"
                style={{ maxHeight: 80, overflowY: 'auto' }}
                onInput={e => {
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 80) + 'px';
                }}
              />
              <button
                onClick={send}
                disabled={loading || !input.trim()}
                className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => { if (!didDragRef.current) setOpen(o => !o); }}
        className="w-12 h-12 rounded-full text-white text-sm font-black shadow-lg hover:shadow-xl transition-all active:scale-95"
        style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', boxShadow: open ? '0 0 0 3px rgba(124,58,237,0.3)' : undefined, cursor: 'grab' }}
      >
        AI
      </button>
    </div>
  );
}
