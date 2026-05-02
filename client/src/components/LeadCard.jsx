import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

const STAGES = [
  { key: 'new',           label: 'חדש',          active: 'bg-sky-500 text-white border-sky-500',         past: 'bg-sky-100 text-sky-600 border-sky-200',         future: 'bg-white text-slate-400 border-slate-200 hover:border-sky-300 hover:text-sky-500' },
  { key: 'contacted',     label: 'יצירת קשר',    active: 'bg-amber-500 text-white border-amber-500',     past: 'bg-amber-100 text-amber-600 border-amber-200',   future: 'bg-white text-slate-400 border-slate-200 hover:border-amber-300 hover:text-amber-500' },
  { key: 'meeting',       label: 'פגישה',         active: 'bg-violet-500 text-white border-violet-500',   past: 'bg-violet-100 text-violet-600 border-violet-200', future: 'bg-white text-slate-400 border-slate-200 hover:border-violet-300 hover:text-violet-500' },
  { key: 'offer_sent',    label: 'הצעת מחיר',    active: 'bg-blue-500 text-white border-blue-500',       past: 'bg-blue-100 text-blue-600 border-blue-200',       future: 'bg-white text-slate-400 border-slate-200 hover:border-blue-300 hover:text-blue-500' },
  { key: 'negotiation',   label: 'מו"מ',          active: 'bg-orange-500 text-white border-orange-500',   past: 'bg-orange-100 text-orange-600 border-orange-200', future: 'bg-white text-slate-400 border-slate-200 hover:border-orange-300 hover:text-orange-500' },
  { key: 'contract_sent', label: 'חוזה נשלח',    active: 'bg-indigo-500 text-white border-indigo-500',   past: 'bg-indigo-100 text-indigo-600 border-indigo-200', future: 'bg-white text-slate-400 border-slate-200 hover:border-indigo-300 hover:text-indigo-500' },
  { key: 'deposit',       label: 'מקדמה',         active: 'bg-emerald-500 text-white border-emerald-500', past: 'bg-emerald-100 text-emerald-600 border-emerald-200', future: 'bg-white text-slate-400 border-slate-200 hover:border-amber-300 hover:text-emerald-500' },
  { key: 'production',    label: 'הפקה',          active: 'bg-teal-500 text-white border-teal-500',       past: 'bg-teal-100 text-teal-600 border-teal-200',       future: 'bg-white text-slate-400 border-slate-200 hover:border-teal-300 hover:text-teal-500' },
];

const LOST_REASONS = [
  { value: 'price',         label: 'מחיר/תקציב' },
  { value: 'date',          label: 'תאריך תפוס' },
  { value: 'competitor',    label: 'בחר מתחרה' },
  { value: 'ghosted',       label: 'נעלם' },
  { value: 'plans_changed', label: 'שינוי תוכניות' },
  { value: 'other',         label: 'אחר' },
];

const SOURCE_LABELS = {
  website_popup: 'אתר (פופאפ)', website_form: 'אתר (טופס)',
  call_event: 'Call Event', telekol: 'טלקול',
  whatsapp: 'וואטסאפ', facebook: 'פייסבוק',
  instagram: 'אינסטגרם', manual: 'ידני',
};

const TYPE_META = {
  call:      { icon: '📞', label: 'שיחה',      bg: 'bg-blue-100',    text: 'text-blue-700' },
  meeting:   { icon: '🤝', label: 'פגישה',     bg: 'bg-purple-100',  text: 'text-purple-700' },
  note:      { icon: '📝', label: 'הערה',      bg: 'bg-amber-100',   text: 'text-amber-700' },
  email:     { icon: '✉️', label: 'אימייל',    bg: 'bg-sky-100',     text: 'text-sky-700' },
  whatsapp:  { icon: '💬', label: 'וואטסאפ',  bg: 'bg-green-100',   text: 'text-green-700' },
  facebook:  { icon: '📘', label: 'פייסבוק',  bg: 'bg-blue-100',    text: 'text-blue-700' },
  instagram: { icon: '📸', label: 'אינסטגרם', bg: 'bg-pink-100',    text: 'text-pink-700' },
};

const EVENT_TYPES = ['חתונה', 'בר/בת מצווה', 'אירוסין', 'יום הולדת', 'כנס', 'אירוע חברה', 'חינה', 'אחר'];

const IL = { timeZone: 'Asia/Jerusalem' };

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', IL);
}
function formatFull(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('en-GB', { ...IL, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}
// Returns ISO string from separate date (yyyy-mm-dd) + time (hh:mm) inputs, treating as Israel time
function localToISO(date, time) {
  if (!date) return null;
  const str = time ? `${date}T${time}` : `${date}T00:00`;
  return new Date(str).toISOString(); // browser is in Israel TZ → correct UTC offset
}
// Parses free-text date (day first) → 'YYYY-MM-DD' or null
function parseDateIL(str) {
  if (!str || !str.trim()) return null;
  const m = str.trim().match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})$/);
  if (!m) return null;
  let [, d, mo, y] = m.map(Number);
  if (y < 100) y += 2000;
  if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2020) return null;
  return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
// Parses free-text time → 'HH:MM' or null
function parseTimeIL(str) {
  if (!str || !str.trim()) return null;
  const s = str.trim();
  let m = s.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) {
    const d4 = s.match(/^(\d{3,4})$/);
    if (d4) m = [null, d4[1].slice(0, -2) || '0', d4[1].slice(-2)];
  }
  if (!m) return null;
  const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}`;
}
function DateInput({ value, onChange, className }) {
  const selected = value ? new Date(value + 'T00:00:00') : null;
  return (
    <DatePicker
      selected={selected}
      onChange={d => onChange(d ? d.toLocaleDateString('sv') : '')}
      dateFormat="dd/MM/yyyy"
      placeholderText="dd/MM/yyyy"
      className={className}
    />
  );
}
function TimeInput({ value, onChange, className }) {
  return (
    <input type="time" value={value || ''} onChange={e => onChange(e.target.value)}
      className={className} dir="ltr" />
  );
}

function fileIcon(mime = '') {
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.includes('pdf')) return '📄';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  if (mime.includes('sheet') || mime.includes('excel')) return '📊';
  return '📎';
}
function fileIconByExt(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) return '🖼️';
  if (ext === 'pdf') return '📄';
  if (['doc','docx'].includes(ext)) return '📝';
  if (['xls','xlsx','csv'].includes(ext)) return '📊';
  return '📎';
}

export default function LeadCard({ leadId, onClose, onUpdated }) {
  const currentUser = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const [lead, setLead]                 = useState(null);
  const [interactions, setInteractions] = useState([]);
  const [messages, setMessages]         = useState([]);
  const [files, setFiles]               = useState([]);
  const [tasks, setTasks]               = useState([]);
  const [users, setUsers]               = useState([]);
  const [calStatus, setCalStatus]       = useState(null);
  const [contacts, setContacts]         = useState([]);
  const [loading, setLoading]           = useState(true);
  const [activeTab, setActiveTab]       = useState('info');
  const [savingStage, setSavingStage]   = useState(false);
  const [showLostModal, setShowLostModal]       = useState(false);
  const [showDeleteModal, setShowDeleteModal]   = useState(false);
  const [showAddTask, setShowAddTask]           = useState(false);
  const [taskAction, setTaskAction]             = useState(null); // { task, mode: 'complete'|'reschedule'|'followup' }
  const [editing, setEditing]           = useState(false);
  const [editForm, setEditForm]         = useState({});
  const [avatarZoom, setAvatarZoom]     = useState(false);
  const [editingName, setEditingName]     = useState(false);
  const [nameDraft, setNameDraft]         = useState('');
  const [showMeetingModal, setShowMeetingModal] = useState(false);

  const load = useCallback(async () => {
    try {
      const [leadRes, intRes, msgRes, fileRes, taskRes, userRes, calRes, contactsRes] = await Promise.all([
        api.get(`/leads/${leadId}`),
        api.get(`/leads/${leadId}/interactions`),
        api.get(`/leads/${leadId}/messages`),
        api.get(`/leads/${leadId}/files`),
        api.get(`/leads/${leadId}/tasks`),
        api.get('/users'),
        api.get(`/calendar/leads/${leadId}/status`).catch(() => ({ data: { type: null } })),
        api.get(`/leads/${leadId}/contacts`),
      ]);
      setLead(leadRes.data);
      const _d = leadRes.data;
      const _displayDate = _d.event_date_text || (_d.event_date ? _d.event_date.split('T')[0].split('-').reverse().join('/') : '');
      setEditForm({ ..._d, event_date_text: _displayDate });
      setCalStatus(calRes.data);
      setInteractions(intRes.data);
      setMessages(msgRes.data);
      setFiles(fileRes.data);
      setTasks(taskRes.data);
      setUsers(userRes.data);
      setContacts(contactsRes.data);
    } catch { }
    setLoading(false);
  }, [leadId]);

  useEffect(() => {
    load();
    api.post(`/leads/${leadId}/read`).catch(() => {});
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load, leadId]);

  async function changeStage(stageKey) {
    if (stageKey === 'lost') { setShowLostModal(true); return; }
    setSavingStage(true);
    await api.patch(`/leads/${leadId}`, { stage: stageKey });
    await load(); onUpdated();
    setSavingStage(false);
  }

  async function markLost(reason, reasonText) {
    await api.patch(`/leads/${leadId}`, { stage: 'lost', lost_reason: reason, lost_reason_text: reasonText });
    setShowLostModal(false);
    await load(); onUpdated();
  }

  async function saveEdit() {
    const payload = { ...editForm };
    delete payload.event_date; // managed only by CalendarSection (DATE column)
    await api.patch(`/leads/${leadId}`, payload);
    setEditing(false);
    await load(); onUpdated();
  }

  async function deleteLead() {
    await api.delete(`/leads/${leadId}`);
    onUpdated();
    onClose();
  }

  async function completeTask(taskId, result) {
    await api.patch(`/leads/${leadId}/tasks/${taskId}/complete`, { result });
    await load(); onUpdated();
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-white flex items-center justify-center">
        <p className="text-slate-400">טוען...</p>
      </div>
    );
  }
  if (!lead) return null;

  const stageIndex = STAGES.findIndex(s => s.key === lead.stage);
  const isLost     = lead.stage === 'lost';
  const openTasks  = tasks.filter(t => !t.completed_at).length;
  const allPhones  = [lead.phone, ...contacts.filter(c => c.type === 'phone').map(c => c.value)].filter(Boolean);
  const allEmails  = [lead.email, ...contacts.filter(c => c.type === 'email').map(c => c.value)].filter(Boolean);

  const timeline = [
    ...interactions.map(i => ({
      id: `i-${i.id}`, _time: i.created_at,
      type: i.type, direction: i.direction,
      body: i.body, author: i.created_by_name,
    })),
    ...messages.map(m => ({
      id: `m-${m.id}`, _time: m.timestamp,
      type: m.channel, direction: m.direction,
      body: m.body, author: null,
    })),
  ].sort((a, b) => new Date(b._time) - new Date(a._time)); // newest first

  const lastActivity = timeline.length > 0 ? timeline[0]._time : null;

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3 shrink-0" style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
        <button onClick={onClose} className="text-white/80 hover:text-white text-2xl leading-none">&times;</button>
        {currentUser.role === 'admin' && (
          <button onClick={() => setShowDeleteModal(true)} className="text-sm font-bold px-2 py-1 rounded-lg bg-red-600/40 hover:bg-red-600 text-red-200 hover:text-white transition">
            🗑 מחק ליד
          </button>
        )}
        <div className="flex items-center gap-3 flex-1 justify-end">
          <div className="text-right">
            {editingName ? (
              <form onSubmit={async e => { e.preventDefault(); await api.patch(`/leads/${leadId}`, { name: nameDraft }); setEditingName(false); await load(); onUpdated(); }}
                className="flex gap-1 justify-end">
                <input autoFocus value={nameDraft} onChange={e => setNameDraft(e.target.value)}
                  className="bg-white/20 text-white placeholder-white/50 border border-white/40 rounded-lg px-2 py-0.5 text-base font-bold focus:outline-none w-44" />
                <button type="submit" className="text-sm bg-white/20 hover:bg-white/30 text-white px-2 py-0.5 rounded-lg">✓</button>
                <button type="button" onClick={() => setEditingName(false)} className="text-sm text-white/60 hover:text-white px-1">✕</button>
              </form>
            ) : (
              <h2 className="text-white font-black text-lg leading-tight cursor-pointer hover:text-violet-200 transition group"
                  onClick={() => { setNameDraft(lead.name || ''); setEditingName(true); }}>
                {lead.priority === 'hot' && '🔥 '}
                {lead.priority === 'urgent' && '⚡ '}
                {lead.name}
                <span className="text-sm font-normal text-white/40 group-hover:text-white/70 mr-1">✏️</span>
              </h2>
            )}
            <p className="text-white/60 text-sm">
              {SOURCE_LABELS[lead.source] || lead.source}
              {' · '}התקבל {formatFull(lead.created_at)}
              {lastActivity && ` · פעילות אחרונה ${formatFull(lastActivity)}`}
            </p>
          </div>
          {lead.avatar_url
            ? <img src={lead.avatar_url} onClick={() => setAvatarZoom(true)}
                className="w-12 h-12 rounded-full object-cover border-2 border-white/30 shrink-0 cursor-pointer hover:scale-105 transition-transform"
                onError={e => e.target.style.display='none'} />
            : <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-xl font-black text-white shrink-0">
                {(lead.name || '?')[0]}
              </div>
          }
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-100 bg-white shrink-0 text-sm font-bold">
        {[
          { key: 'info',     label: 'פרטים ופעילות' },
          { key: 'tasks',    label: `משימות${openTasks ? ` (${openTasks})` : ''}` },
          { key: 'whatsapp', label: 'וואטסאפ' },
        ].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`flex-1 py-3 transition border-b-2 ${
              activeTab === t.key ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">

        {/* ── INFO + TIMELINE + FILES TAB ── */}
        {activeTab === 'info' && (
          <div className="max-w-3xl mx-auto p-4 space-y-6">

            {/* Status */}
            <Section title="סטטוס"
              action={
                <div>
                  {lead.event_name && (
                    <p className="text-sm font-bold text-slate-700 mb-2">🎉 {lead.event_name}</p>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => setShowMeetingModal(true)} className="text-sm font-bold px-2.5 py-1 rounded-xl bg-violet-600 text-white hover:bg-violet-700 transition">📅 קבע פגישה</button>
                    {lead.meeting_event_id && <SendReminderButton eventId={lead.meeting_event_id} />}
                    <button onClick={() => setShowAddTask(true)} className="text-sm font-bold px-2.5 py-1 rounded-xl bg-violet-600 text-white hover:bg-violet-700 transition">+ משימה</button>
                    <button
                      onClick={async () => {
                        const newPriority = lead.priority === 'hot' ? 'normal' : 'hot';
                        const { data } = await api.patch(`/leads/${lead.id}`, { priority: newPriority });
                        setLead(data);
                      }}
                      className={`text-sm font-bold px-2.5 py-1 rounded-xl transition ${
                        lead.priority === 'hot'
                          ? 'bg-orange-500 text-white hover:bg-orange-600'
                          : 'bg-slate-100 text-slate-600 hover:bg-orange-100 hover:text-orange-700'
                      }`}
                    >
                      🔥 {lead.priority === 'hot' ? 'חם ✓' : 'ליד חם'}
                    </button>
                  </div>
                </div>
              }>
              {isLost && (
                <span className="text-sm font-bold px-3 py-1.5 rounded-full bg-red-100 text-red-600 border border-red-200 mb-2 inline-block">
                  ✕ לא סגרו — {LOST_REASONS.find(r => r.value === lead.lost_reason)?.label || lead.lost_reason}
                  {lead.lost_reason_text && <span className="font-normal"> · {lead.lost_reason_text}</span>}
                </span>
              )}
              <div className="flex flex-wrap gap-1.5">
                {STAGES.map((s, i) => (
                  <button key={s.key} onClick={() => !savingStage && changeStage(s.key)}
                    disabled={savingStage}
                    className={`text-sm px-3 py-1.5 rounded-full font-bold transition border ${
                      i === stageIndex ? s.active : i < stageIndex ? s.past : s.future
                    }`}>
                    {i < stageIndex && '✓ '}{s.label}
                  </button>
                ))}
                {!isLost && (
                  <button onClick={() => setShowLostModal(true)} disabled={savingStage}
                    className="text-sm px-3 py-1.5 rounded-full font-bold bg-white text-slate-400 border border-slate-200 hover:border-red-300 hover:text-red-500 transition">
                    לא סגרו
                  </button>
                )}
              </div>
              {lead.meeting_rsvp_status && lead.meeting_rsvp_status !== 'needsAction' && (
                <div className="mt-2 flex justify-end">
                  {{
                    accepted:  <span className="text-sm font-bold px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">✅ הליד אישר את הפגישה</span>,
                    declined:  <span className="text-sm font-bold px-3 py-1 rounded-full bg-red-100 text-red-600 border border-red-200">❌ הליד דחה את הפגישה</span>,
                    tentative: <span className="text-sm font-bold px-3 py-1 rounded-full bg-amber-100 text-amber-700 border border-amber-200">❓ הליד אולי יגיע</span>,
                  }[lead.meeting_rsvp_status] || null}
                </div>
              )}
            </Section>

            {/* Calendar */}
            <CalendarSection lead={lead} leadId={leadId} editForm={editForm} calStatus={calStatus} onUpdated={load} />

            {/* Details */}
            <Section title="פרטי ליד"
              action={!editing && <button onClick={() => setEditing(true)} className="text-sm text-violet-600 hover:underline font-semibold">✏️ עריכה</button>}>
              {editing ? (
                <EditForm form={editForm} setForm={setEditForm} users={users} onSave={saveEdit} onCancel={() => setEditing(false)} />
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <InfoRow label="טלפון">
                      {lead.phone ? <a href={`tel:${lead.phone}`} className="text-violet-700 hover:underline font-medium" dir="ltr">{lead.phone}</a> : '—'}
                    </InfoRow>
                    <InfoRow label="אימייל">{lead.email || '—'}</InfoRow>
                    <InfoRow label="תאריך אירוע">{lead.event_date_text || formatDate(lead.event_date)}{lead.event_time ? ` · ${lead.event_time}` : ''}</InfoRow>
                    <InfoRow label="סוג אירוע">{lead.event_type || '—'}</InfoRow>
                    <InfoRow label="מוזמנים">{lead.guest_count || '—'}</InfoRow>
                    <InfoRow label="תקציב">{lead.budget || '—'}</InfoRow>
                    <InfoRow label="אחראי">{lead.assigned_name || '—'}</InfoRow>
                    <InfoRow label="עדיפות">{lead.priority === 'hot' ? '🔥 חם' : lead.priority === 'urgent' ? '⚡ דחוף' : 'רגיל'}</InfoRow>
                    <InfoRow label="התקבל ב">{formatFull(lead.created_at)}</InfoRow>
                    <InfoRow label="פעילות אחרונה">{lastActivity ? formatFull(lastActivity) : '—'}</InfoRow>
                  </div>
                  <NotesInlineEdit leadId={leadId} value={lead.notes} onSaved={load} />
                  <AdditionalContacts leadId={leadId} contacts={contacts} onChanged={load} />
                </>
              )}
            </Section>

            {/* Production module — only for deposit/production stage */}
            {(lead.stage === 'deposit' || lead.stage === 'production') && (
              <ProductionSection leadId={leadId} lead={lead} onUpdated={load} />
            )}

            {/* Files */}
            <Section title={`קבצים${files.length ? ` (${files.length})` : ''}`}>
              <FilesSection leadId={leadId} files={files} onChanged={load} />
            </Section>

            {/* Interactions */}
            <Section title={`פעילות${timeline.length ? ` (${timeline.length})` : ''}`}>
              <TimelineSection leadId={leadId} timeline={timeline} allPhones={allPhones} allEmails={allEmails} onAdded={load} />
            </Section>

          </div>
        )}

        {/* ── TASKS TAB ── */}
        {activeTab === 'tasks' && (
          <TasksTab leadId={leadId} tasks={tasks} users={users} onUpdated={load} completeTask={completeTask}
            onTaskAction={setTaskAction} onAddTask={() => setShowAddTask(true)} />
        )}

        {/* ── WHATSAPP TAB ── */}
        {activeTab === 'whatsapp' && (
          <WhatsAppTab leadId={leadId} allPhones={allPhones} messages={messages} onSent={load} />
        )}
      </div>

      {showMeetingModal && (
        <ScheduleMeetingModal
          lead={lead}
          leadId={leadId}
          onClose={() => setShowMeetingModal(false)}
          onDone={() => { setShowMeetingModal(false); load(); onUpdated(); }}
        />
      )}

      {showLostModal && <LostModal onClose={() => setShowLostModal(false)} onConfirm={markLost} />}

      {showAddTask && (
        <AddTaskModal
          leadId={leadId} users={users}
          onClose={() => setShowAddTask(false)}
          onSaved={() => { setShowAddTask(false); load(); onUpdated(); }}
        />
      )}

      {taskAction && (
        <TaskActionModal
          task={taskAction}
          leadId={leadId}
          lead={lead}
          users={users}
          allPhones={allPhones}
          allEmails={allEmails}
          onClose={() => setTaskAction(null)}
          onDone={() => { setTaskAction(null); load(); onUpdated(); }}
          completeTask={completeTask}
        />
      )}
      {avatarZoom && lead.avatar_url && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70" onClick={() => setAvatarZoom(false)}>
          <img src={lead.avatar_url} className="max-w-xs max-h-[80vh] rounded-2xl shadow-2xl object-cover" />
        </div>
      )}

      {showDeleteModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={() => setShowDeleteModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-5 w-80 mx-4" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">🗑️</div>
              <h3 className="font-black text-slate-800 text-lg">האם אתה בטוח?</h3>
              <p className="text-base text-slate-500 mt-1">
                אתה עומד למחוק את הליד של <span className="font-bold text-slate-700">{lead?.name}</span>.
                <br />פעולה זו אינה ניתנת לביטול.
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowDeleteModal(false)}
                className="flex-1 border-2 border-slate-200 text-slate-500 font-bold py-2 rounded-xl text-base">
                ביטול
              </button>
              <button onClick={deleteLead}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2 rounded-xl text-base transition">
                כן, מחק
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── NOTES INLINE EDIT ── */
function NotesInlineEdit({ leadId, value, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value || '');

  async function save() {
    await api.patch(`/leads/${leadId}`, { notes: draft });
    await onSaved();
    setEditing(false);
  }

  if (editing) return (
    <div className="mt-2">
      <textarea
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        className="w-full border border-violet-200 bg-violet-50 rounded-xl px-3 py-2 text-base focus:outline-none resize-none"
        rows={4}
      />
      <div className="flex gap-2 mt-1.5">
        <button onClick={() => setEditing(false)} className="flex-1 border-2 border-slate-200 text-slate-500 text-sm font-bold py-1.5 rounded-xl">ביטול</button>
        <button onClick={save} className="flex-1 bg-violet-600 text-white text-sm font-bold py-1.5 rounded-xl">שמור</button>
      </div>
    </div>
  );

  return (
    <div className="mt-2 bg-violet-50 border border-violet-100 rounded-xl px-3 py-2 text-base text-slate-700 cursor-pointer group"
         onClick={() => { setDraft(value || ''); setEditing(true); }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-violet-400 opacity-0 group-hover:opacity-100 transition">✏️ לחץ לעריכה</span>
        <span className="text-sm font-bold text-violet-600">תיאור</span>
      </div>
      {value ? value : <span className="text-slate-400 text-sm">אין תיאור — לחץ להוספה</span>}
    </div>
  );
}

/* ── SECTION WRAPPER ── */
function Section({ title, action, children }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>{action}</div>
        <h3 className="text-base font-black text-slate-700">{title}</h3>
      </div>
      <div className="bg-violet-50/30 rounded-2xl p-3">
        {children}
      </div>
    </div>
  );
}

/* ── OPEN FILE via signed URL ── */
async function openFile(fileId) {
  const win = window.open('', '_blank');
  try {
    const token = localStorage.getItem('crm_token');
    const res = await fetch(`/api/files/${fileId}/url`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('לא ניתן לפתוח את הקובץ');
    const { url } = await res.json();
    win.location.href = url;
  } catch {
    win?.close();
    alert('שגיאה בפתיחת הקובץ');
  }
}

/* ── FILES SECTION ── */
function FilesSection({ leadId, files, onChanged }) {
  const inputRef = useRef();
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging]   = useState(false);

  async function uploadFile(file) {
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api.post(`/leads/${leadId}/files`, fd);
      await onChanged();
    } catch {
      alert('שגיאה בהעלאת הקובץ');
    }
    setUploading(false);
  }

  function onDrop(e) {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  }

  async function deleteFile(fileId) {
    if (!confirm('למחוק קובץ זה?')) return;
    await api.delete(`/leads/${leadId}/files/${fileId}`);
    await onChanged();
  }

  return (
    <div className="space-y-2">
      {files.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-2">אין קבצים מצורפים</p>
      ) : (
        files.map(f => (
          <div key={f.id} className="flex items-center gap-2 bg-white rounded-xl px-3 py-2 border border-slate-100">
            <span className="text-lg shrink-0">{fileIcon(f.file_type)}</span>
            <div className="flex-1 min-w-0 text-right">
              <button
                onClick={e => { e.stopPropagation(); openFile(f.id); }}
                className="text-base font-semibold text-violet-700 hover:underline truncate block text-right">
                {f.filename}
              </button>
              <p className="text-sm text-slate-400">{f.uploaded_by_name || ''} · {formatFull(f.created_at)}</p>
            </div>
            <button onClick={() => deleteFile(f.id)}
              className="shrink-0 text-slate-400 hover:text-red-500 transition text-sm font-medium px-2 py-1 rounded-lg hover:bg-red-50 border border-transparent hover:border-red-200">
              🗑️
            </button>
          </div>
        ))
      )}
      <input ref={inputRef} type="file" className="hidden" onChange={e => { uploadFile(e.target.files[0]); e.target.value = ''; }} />
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragEnter={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current.click()}
        className={`w-full border-2 border-dashed rounded-xl py-3 text-sm font-semibold text-center cursor-pointer transition ${
          dragging ? 'border-violet-400 bg-violet-50 text-violet-600' : 'border-slate-200 text-slate-400 hover:border-violet-300 hover:text-violet-600'
        } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
        {uploading ? 'מעלה...' : dragging ? 'שחרר להעלאה' : '+ העלה קובץ או גרור לכאן'}
      </div>
    </div>
  );
}

/* ── BODY WITH FILE ATTACHMENT ── */
function BodyWithFile({ body }) {
  if (!body) return null;
  const FILE_RE = /\[\[FILE:([^\|]+)\|([^\]]+)\]\]/g;
  const text = body.replace(FILE_RE, '').trim();
  const files = [...body.matchAll(/\[\[FILE:([^\|]+)\|([^\]]+)\]\]/g)]
    .map(m => ({ id: m[1], name: m[2] }));
  return (
    <div>
      {text.trim() && <p className="text-base text-slate-700 whitespace-pre-wrap">{text.trim()}</p>}
      {files.map((f, i) => (
        <button key={i}
          onClick={e => { e.stopPropagation(); openFile(f.id); }}
          className="inline-flex items-center gap-1.5 mt-1.5 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-violet-50 border border-slate-200 hover:border-violet-300 text-sm font-semibold text-slate-700 hover:text-violet-700 transition">
          {fileIconByExt(f.name)} {f.name}
        </button>
      ))}
    </div>
  );
}

/* ── TIMELINE SECTION ── */
function TimelineSection({ leadId, timeline, allPhones, allEmails, onAdded }) {
  const phone = allPhones[0] || null;
  const email = allEmails[0] || null;
  const [adding, setAdding]     = useState(null); // 'call'|'meeting'|'note'|'wa_send'|'email_send'
  const [body, setBody]         = useState('');
  const [dir, setDir]           = useState('outbound');
  const [file, setFile]         = useState(null);
  const [waPhone, setWaPhone]   = useState(phone || '');
  const [emailTo, setEmailTo]   = useState('');
  const [subject, setSubject]   = useState('');
  const [saving, setSaving]     = useState(false);
  const [draggingWA, setDraggingWA]       = useState(false);
  const [draggingEmail, setDraggingEmail] = useState(false);
  const fileRef                 = useRef();

  const [translations, setTranslations]   = useState({}); // itemId → translated text
  const [translating, setTranslating]     = useState({}); // itemId → bool
  const [aiLoading, setAiLoading]         = useState(null); // null | 'translate'|'reply'|'improve'

  const [editingInteractionId, setEditingInteractionId] = useState(null);
  const [editInteractionBody, setEditInteractionBody]   = useState('');

  async function saveInteractionEdit(rawId) {
    await api.patch(`/leads/${leadId}/interactions/${rawId}`, { body: editInteractionBody.trim() });
    setEditingInteractionId(null);
    setEditInteractionBody('');
    onAdded();
  }

  async function translateItem(itemId, text) {
    const plain = text.replace(/\[\[FILE:[^\]]+\]\]/g, '').trim();
    if (!plain) return;
    setTranslating(t => ({ ...t, [itemId]: true }));
    try {
      const { data } = await api.post('/ai/translate', { text: plain, to: 'he' });
      setTranslations(t => ({ ...t, [itemId]: data.result }));
    } catch { }
    setTranslating(t => ({ ...t, [itemId]: false }));
  }

  async function aiAction(action) {
    setAiLoading(action);
    try {
      if (action === 'translate') {
        const { data } = await api.post('/ai/translate', { text: body, to: 'en' });
        setBody(data.result);
      } else if (action === 'reply') {
        const { data } = await api.post('/ai/reply', { leadId });
        setBody(data.result);
      } else if (action === 'improve') {
        const { data } = await api.post('/ai/improve', { text: body });
        setBody(data.result);
      }
    } catch { alert('שגיאה בבקשת ה-AI'); }
    setAiLoading(null);
  }

  const LOG_TYPES = [
    { type: 'call',     label: '📞 שיחה' },
    { type: 'meeting',  label: '🤝 פגישה' },
    { type: 'note',     label: '📝 הערה' },
  ];

  function openAdding(type) {
    setAdding(adding === type ? null : type);
    setBody(''); setFile(null); setDir('outbound');
    setWaPhone(allPhones[0] || '');
    setEmailTo(allEmails[0] || ''); setSubject('');
  }

  async function saveLog() {
    if (!body.trim()) return;
    setSaving(true);
    await api.post(`/leads/${leadId}/interactions`, { type: adding, direction: dir, body });
    setBody(''); setAdding(null);
    await onAdded();
    setSaving(false);
  }

  async function sendWA() {
    if (!body.trim() && !file) return;
    setSaving(true);
    try {
      if (file) {
        const fd = new FormData();
        fd.append('leadId', leadId);
        fd.append('message', body);
        fd.append('file', file);
        if (waPhone) fd.append('phone', waPhone);
        await api.post('/whatsapp/send-file', fd);
      } else {
        await api.post('/whatsapp/send', { leadId, message: body, phone: waPhone || undefined });
      }
      setBody(''); setFile(null); setAdding(null);
      await onAdded();
    } catch { alert('שגיאה בשליחת הוואטסאפ'); }
    setSaving(false);
  }

  async function sendEmail() {
    if (!emailTo.trim() || !body.trim()) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('to', emailTo);
      fd.append('subject', subject || '(ללא נושא)');
      fd.append('body', body);
      if (file) fd.append('file', file);
      await api.post(`/leads/${leadId}/email/send`, fd);
      setBody(''); setFile(null); setAdding(null);
      await onAdded();
    } catch (err) { alert(err.response?.data?.error || 'שגיאה בשליחת המייל'); }
    setSaving(false);
  }

  return (
    <div className="space-y-3">
      {/* Quick-log buttons */}
      <div className="flex flex-wrap gap-1.5">
        {LOG_TYPES.map(btn => (
          <button key={btn.type}
            onClick={() => openAdding(btn.type)}
            className={`text-sm font-bold px-3 py-1.5 rounded-xl border-2 transition ${
              adding === btn.type ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'
            }`}>
            {btn.label}
          </button>
        ))}
        <button onClick={() => openAdding('wa_send')}
          className={`text-sm font-bold px-3 py-1.5 rounded-xl border-2 transition ${
            adding === 'wa_send' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-slate-600 border-slate-200 hover:border-green-300'
          }`}>
          📱 שלח וואטסאפ
        </button>
        <button onClick={() => openAdding('email_send')}
          className={`text-sm font-bold px-3 py-1.5 rounded-xl border-2 transition ${
            adding === 'email_send' ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200 hover:border-sky-300'
          }`}>
          ✉️ שלח אימייל
        </button>
      </div>

      {/* Log interaction form */}
      {adding && ['call','meeting','note'].includes(adding) && (
        <div className="bg-white border border-violet-100 rounded-xl p-3 space-y-2">
          <div className="flex gap-2">
            <button onClick={() => setDir('outbound')}
              className={`flex-1 text-sm font-bold py-1.5 rounded-xl border-2 transition ${dir === 'outbound' ? 'bg-violet-600 text-white border-violet-600' : 'border-slate-200 text-slate-500'}`}>
              יוצא ↗
            </button>
            <button onClick={() => setDir('inbound')}
              className={`flex-1 text-sm font-bold py-1.5 rounded-xl border-2 transition ${dir === 'inbound' ? 'bg-sky-600 text-white border-sky-600' : 'border-slate-200 text-slate-500'}`}>
              נכנס ↙
            </button>
          </div>
          <textarea autoFocus value={body} onChange={e => setBody(e.target.value)}
            className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-violet-400 resize-none"
            rows={3} placeholder="תיאור..." />
          <div className="flex gap-2">
            <button onClick={() => setAdding(null)} className="flex-1 border-2 border-slate-200 text-slate-500 text-base font-bold py-1.5 rounded-xl">ביטול</button>
            <button onClick={saveLog} disabled={saving || !body.trim()}
              className="flex-1 bg-violet-600 text-white text-base font-bold py-1.5 rounded-xl disabled:opacity-50">
              {saving ? '...' : 'שמור'}
            </button>
          </div>
        </div>
      )}

      {/* WhatsApp send form */}
      {adding === 'wa_send' && (
        <div className="bg-white border border-green-100 rounded-xl p-3 space-y-2">
          {allPhones.length > 1 ? (
            <select value={waPhone} onChange={e => setWaPhone(e.target.value)}
              className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-400 text-right" dir="ltr">
              {allPhones.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          ) : (
            <p className="text-sm text-slate-500 font-semibold text-right">שלח ל: {phone || '(אין מספר)'}</p>
          )}
          <textarea autoFocus value={body} onChange={e => setBody(e.target.value)}
            className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-green-400 resize-none"
            rows={3} placeholder="הודעה..." />
          <AiButtons onAction={aiAction} aiLoading={aiLoading} hasBody={!!body.trim()} />
          <input ref={fileRef} type="file" className="hidden" onChange={e => setFile(e.target.files[0] || null)} />
          <div
            onDragOver={e => { e.preventDefault(); setDraggingWA(true); }}
            onDragEnter={e => { e.preventDefault(); setDraggingWA(true); }}
            onDragLeave={() => setDraggingWA(false)}
            onDrop={e => { e.preventDefault(); setDraggingWA(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
            onClick={() => fileRef.current.click()}
            className={`w-full border-2 border-dashed rounded-xl py-2 text-sm font-semibold text-center cursor-pointer transition ${
              draggingWA ? 'border-green-400 bg-green-50 text-green-600' : file ? 'border-green-300 text-green-700 bg-green-50' : 'border-slate-200 text-slate-400 hover:border-green-300 hover:text-green-600'
            }`}>
            {draggingWA ? 'שחרר להוספה' : file ? `📎 ${file.name}` : '+ צרף קובץ או גרור לכאן'}
          </div>
          {file && <button onClick={() => setFile(null)} className="text-sm text-red-400 hover:underline">הסר קובץ</button>}
          <div className="flex gap-2">
            <button onClick={() => setAdding(null)} className="flex-1 border-2 border-slate-200 text-slate-500 text-base font-bold py-1.5 rounded-xl">ביטול</button>
            <button onClick={sendWA} disabled={saving || (!body.trim() && !file) || !waPhone}
              className="flex-1 bg-green-600 text-white text-base font-bold py-1.5 rounded-xl disabled:opacity-50">
              {saving ? '...' : 'שלח'}
            </button>
          </div>
        </div>
      )}

      {/* Email send form */}
      {adding === 'email_send' && (
        <div className="bg-white border border-sky-100 rounded-xl p-3 space-y-2">
          {allEmails.length > 1 ? (
            <select value={emailTo} onChange={e => setEmailTo(e.target.value)}
              className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-sky-400" dir="ltr">
              {allEmails.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          ) : (
            <input value={emailTo} onChange={e => setEmailTo(e.target.value)}
              className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-sky-400"
              placeholder="אימייל נמען..." dir="ltr" />
          )}
          <input value={subject} onChange={e => setSubject(e.target.value)}
            className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-sky-400"
            placeholder="נושא..." />
          <textarea autoFocus value={body} onChange={e => setBody(e.target.value)}
            className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-sky-400 resize-none"
            rows={4} placeholder="תוכן ההודעה..." />
          <AiButtons onAction={aiAction} aiLoading={aiLoading} hasBody={!!body.trim()} />
          <input ref={fileRef} type="file" className="hidden" onChange={e => setFile(e.target.files[0] || null)} />
          <div
            onDragOver={e => { e.preventDefault(); setDraggingEmail(true); }}
            onDragEnter={e => { e.preventDefault(); setDraggingEmail(true); }}
            onDragLeave={() => setDraggingEmail(false)}
            onDrop={e => { e.preventDefault(); setDraggingEmail(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
            onClick={() => fileRef.current.click()}
            className={`w-full border-2 border-dashed rounded-xl py-2 text-sm font-semibold text-center cursor-pointer transition ${
              draggingEmail ? 'border-sky-400 bg-sky-50 text-sky-600' : file ? 'border-sky-300 text-sky-700 bg-sky-50' : 'border-slate-200 text-slate-400 hover:border-sky-300 hover:text-sky-600'
            }`}>
            {draggingEmail ? 'שחרר להוספה' : file ? `📎 ${file.name}` : '+ צרף קובץ או גרור לכאן'}
          </div>
          {file && <button onClick={() => setFile(null)} className="text-sm text-red-400 hover:underline">הסר קובץ</button>}
          <div className="flex gap-2">
            <button onClick={() => setAdding(null)} className="flex-1 border-2 border-slate-200 text-slate-500 text-base font-bold py-1.5 rounded-xl">ביטול</button>
            <button onClick={sendEmail} disabled={saving || !emailTo.trim() || !body.trim()}
              className="flex-1 bg-sky-600 text-white text-base font-bold py-1.5 rounded-xl disabled:opacity-50">
              {saving ? '...' : 'שלח'}
            </button>
          </div>
        </div>
      )}

      {/* Feed */}
      {timeline.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-4">אין פעילות עדיין</p>
      ) : (
        <div className="space-y-2">
          {timeline.map(item => {
            const meta = TYPE_META[item.type] || { icon: '💬', label: item.type, bg: 'bg-slate-100', text: 'text-slate-600' };
            const isIn = item.direction === 'inbound';
            return (
              <div key={item.id} className="bg-white border border-slate-100 rounded-xl px-3 py-2.5">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5 text-sm text-slate-400">
                    <span>{formatFull(item._time)}</span>
                    {item.author && <span>· {item.author}</span>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className={`text-sm font-semibold px-2 py-0.5 rounded-full ${isIn ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600'}`}>
                      {isIn ? '↙ נכנס' : '↗ יוצא'}
                    </span>
                    <span className={`text-sm font-semibold px-2 py-0.5 rounded-full ${meta.bg} ${meta.text}`}>
                      {meta.icon} {meta.label}
                    </span>
                    {item.id.startsWith('i-') && ['call','meeting','note'].includes(item.type) && (
                      <button
                        onClick={() => { setEditingInteractionId(item.id); setEditInteractionBody(item.body); }}
                        className="text-slate-300 hover:text-violet-500 transition text-xs px-1"
                        title="ערוך"
                      >✏️</button>
                    )}
                  </div>
                </div>
                {editingInteractionId === item.id ? (
                  <div className="mt-1">
                    <textarea
                      autoFocus
                      value={editInteractionBody}
                      onChange={e => setEditInteractionBody(e.target.value)}
                      rows={3}
                      className="w-full border border-violet-300 rounded-xl px-3 py-2 text-sm text-slate-700 resize-none focus:outline-none focus:border-violet-500"
                    />
                    <div className="flex gap-2 mt-1.5">
                      <button
                        onClick={() => saveInteractionEdit(item.id.replace('i-', ''))}
                        disabled={!editInteractionBody.trim()}
                        className="px-3 py-1 rounded-lg text-xs font-black text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40"
                      >שמור</button>
                      <button
                        onClick={() => { setEditingInteractionId(null); setEditInteractionBody(''); }}
                        className="px-3 py-1 rounded-lg text-xs font-bold text-slate-500 border border-slate-200 hover:bg-slate-50"
                      >ביטול</button>
                    </div>
                  </div>
                ) : (
                  <BodyWithFile body={item.body} />
                )}
                {isIn && (
                  <div className="mt-1.5">
                    {translations[item.id] ? (
                      <div className="text-sm text-slate-600 bg-blue-50 border border-blue-100 rounded-lg px-2 py-1.5 whitespace-pre-wrap">
                        <span className="text-xs text-blue-400 font-semibold block mb-0.5">תרגום לעברית:</span>
                        {translations[item.id]}
                      </div>
                    ) : (
                      <button
                        onClick={() => translateItem(item.id, item.body)}
                        disabled={translating[item.id]}
                        className="text-xs font-semibold px-2 py-1 rounded-lg bg-slate-100 hover:bg-blue-50 text-slate-500 hover:text-blue-600 transition disabled:opacity-50">
                        {translating[item.id] ? '...' : '🌐 תרגם לעברית'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── QUICK ADD TASK (inline in info tab) ── */
function QuickAddTask({ leadId, users, onAdded, tasks, completeTask }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle]   = useState('');
  const [saving, setSaving] = useState(false);
  const openTasks = tasks.filter(t => !t.completed_at);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    await api.post(`/leads/${leadId}/tasks`, { title });
    setTitle(''); setAdding(false);
    await onAdded();
    setSaving(false);
  }

  return (
    <div className="space-y-2">
      {openTasks.slice(0, 3).map(task => (
        <div key={task.id} className="flex items-center gap-2 bg-white rounded-xl px-3 py-2 border border-slate-100">
          <button onClick={() => completeTask(task.id)}
            className="shrink-0 w-5 h-5 rounded-full border-2 border-slate-300 hover:border-violet-400 flex items-center justify-center transition" />
          <p className="flex-1 text-base text-slate-700 text-right">{task.title}</p>
          {task.due_at && <span className="text-sm text-slate-400 shrink-0">{formatFull(task.due_at)}</span>}
        </div>
      ))}
      {openTasks.length === 0 && !adding && (
        <p className="text-sm text-slate-400 text-center py-1">אין משימות פתוחות</p>
      )}
      {adding ? (
        <div className="flex gap-2">
          <button onClick={() => { setAdding(false); setTitle(''); }}
            className="shrink-0 border-2 border-slate-200 text-slate-500 text-sm font-bold px-3 py-2 rounded-xl">ביטול</button>
          <button onClick={save} disabled={saving || !title.trim()}
            className="shrink-0 bg-violet-600 text-white text-sm font-bold px-3 py-2 rounded-xl disabled:opacity-50">
            {saving ? '...' : 'הוסף'}
          </button>
          <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()}
            className="flex-1 border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-violet-400 text-right"
            placeholder="כותרת המשימה..." />
        </div>
      ) : (
        <button onClick={() => setAdding(true)}
          className="w-full border-2 border-dashed border-slate-200 text-slate-400 hover:border-violet-300 hover:text-violet-600 text-sm font-bold py-2 rounded-xl transition">
          + משימה חדשה
        </button>
      )}
    </div>
  );
}

/* ── TASKS TAB ── */
function TasksTab({ leadId, tasks, users, onUpdated, completeTask, onTaskAction, onAddTask }) {
  const now = new Date();
  const [editingTask, setEditingTask] = useState(null);

  async function handleDelete(e, taskId) {
    e.stopPropagation();
    if (!window.confirm('למחוק את המשימה?')) return;
    await api.delete(`/tasks/${taskId}`);
    onUpdated();
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-3">
      <button onClick={onAddTask}
        className="w-full text-base font-bold py-2.5 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-violet-300 hover:text-violet-600 transition">
        + משימה חדשה
      </button>

      {tasks.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-base">אין משימות</div>
      ) : (
        <div className="space-y-2">
          {tasks.map(task => {
            const isOverdue = !task.completed_at && task.due_at && new Date(task.due_at) <= now;
            return (
              <div key={task.id}
                onClick={() => !task.completed_at && onTaskAction(task)}
                className={`flex items-start gap-3 p-3 rounded-2xl border cursor-pointer transition ${
                  task.completed_at ? 'bg-slate-50 border-slate-100 opacity-60 cursor-default' :
                  isOverdue ? 'bg-red-50 border-red-200 hover:bg-red-100' :
                  'bg-white border-slate-200 hover:border-violet-300 hover:bg-violet-50'
                }`}>
                <div className={`shrink-0 mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center text-sm ${
                  task.completed_at ? 'bg-emerald-500 border-emerald-500 text-white' :
                  isOverdue ? 'border-red-400' : 'border-slate-300'
                }`}>
                  {task.completed_at && '✓'}
                  {isOverdue && !task.completed_at && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
                </div>
                <div className="flex-1 text-right">
                  <p className={`text-base font-semibold ${task.completed_at ? 'line-through text-slate-400' : isOverdue ? 'text-red-700' : 'text-slate-700'}`}>
                    {task.title}
                  </p>
                  <div className="flex gap-3 mt-0.5 text-sm text-slate-400 flex-wrap justify-end">
                    {task.due_at && <span className={isOverdue ? 'text-red-500 font-semibold' : ''}>📅 {formatFull(task.due_at)}</span>}
                    {task.assigned_name && <span>👤 {task.assigned_name}</span>}
                    {task.completed_at && <span>✓ {formatFull(task.completed_at)}</span>}
                    {task.result && <span className="text-violet-700">💬 {task.result}</span>}
                  </div>
                </div>
                <div className="flex flex-col gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                  <button onClick={e => { e.stopPropagation(); setEditingTask(task); }}
                    className="text-slate-400 hover:text-violet-600 text-sm px-1">✏️</button>
                  <button onClick={e => handleDelete(e, task.id)}
                    className="text-slate-400 hover:text-red-500 text-sm px-1">🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editingTask && (
        <TaskEditModal task={editingTask} users={users}
          onSaved={() => { setEditingTask(null); onUpdated(); }}
          onClose={() => setEditingTask(null)} />
      )}
    </div>
  );
}

/* ── WHATSAPP TAB ── */
function WhatsAppTab({ leadId, allPhones, messages, onSent }) {
  const [msg, setMsg]           = useState('');
  const [sending, setSending]   = useState(false);
  const [waPhone, setWaPhone]   = useState(allPhones[0] || '');
  const phone = allPhones[0] || null;

  async function send() {
    if (!msg.trim() || !waPhone) return;
    setSending(true);
    try {
      await api.post('/whatsapp/send', { leadId, message: msg, phone: waPhone });
      setMsg('');
      await onSent();
    } catch { alert('שגיאה בשליחת ההודעה'); }
    setSending(false);
  }

  const waMessages = messages.filter(m => m.channel === 'whatsapp');

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-2 max-w-2xl mx-auto w-full">
        {waMessages.length === 0
          ? <div className="text-center py-12 text-slate-400 text-base">אין הודעות וואטסאפ</div>
          : waMessages.map(m => (
            <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-base ${m.direction === 'outbound' ? 'bg-green-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                <p>{m.body}</p>
                <p className={`text-sm mt-1 ${m.direction === 'outbound' ? 'text-green-200' : 'text-slate-400'}`}>{formatFull(m.timestamp)}</p>
                {m.contact_value && <p className={`text-xs mt-0.5 ${m.direction === 'outbound' ? 'text-green-200' : 'text-slate-400'}`} dir="ltr">{m.contact_value}</p>}
              </div>
            </div>
          ))}
      </div>
      <div className="border-t border-slate-100 p-3 max-w-2xl mx-auto w-full space-y-2">
        {phone ? (
          <>
            {allPhones.length > 1 && (
              <select value={waPhone} onChange={e => setWaPhone(e.target.value)}
                className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-400" dir="ltr">
                {allPhones.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
            <div className="flex gap-2">
              <button onClick={send} disabled={sending || !msg.trim()}
                className="bg-green-600 text-white text-base font-bold px-4 py-2 rounded-xl disabled:opacity-50 shrink-0">
                {sending ? '...' : 'שלח'}
              </button>
              <input value={msg} onChange={e => setMsg(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
                className="flex-1 border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-violet-400"
                placeholder="הודעה..." />
            </div>
          </>
        ) : (
          <p className="text-center text-base text-slate-400">אין מספר טלפון</p>
        )}
      </div>
    </div>
  );
}

/* ── SHARED ── */
function InfoRow({ label, children }) {
  return (
    <div className="bg-white rounded-xl px-3 py-2 border border-slate-100">
      <p className="text-sm text-slate-400 font-semibold mb-0.5">{label}</p>
      <div className="text-slate-700 font-medium text-base">{children}</div>
    </div>
  );
}

function EditForm({ form, setForm, users, onSave, onCancel }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const cls = 'w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-violet-400 transition bg-white';
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div><label className="text-sm text-slate-500">שם</label><input value={form.name || ''} onChange={e => set('name', e.target.value)} className={cls} /></div>
        <div><label className="text-sm text-slate-500">טלפון</label><input value={form.phone || ''} onChange={e => set('phone', e.target.value)} className={cls} dir="ltr" /></div>
        <div className="col-span-2"><label className="text-sm text-slate-500">שם האירוע</label><input value={form.event_name || ''} onChange={e => set('event_name', e.target.value)} className={cls} placeholder="שם האירוע" /></div>
        <div><label className="text-sm text-slate-500">אימייל</label><input value={form.email || ''} onChange={e => set('email', e.target.value)} className={cls} dir="ltr" /></div>
        <div><label className="text-sm text-slate-500">תאריך אירוע</label><DateInput value={form.event_date_text || ''} onChange={v => set('event_date_text', v)} className={cls} /></div>
        <div><label className="text-sm text-slate-500">שעת האירוע</label><TimeInput value={form.event_time || ''} onChange={v => set('event_time', v)} className={cls} /></div>
        <div><label className="text-sm text-slate-500">שעת סיום</label><TimeInput value={form.event_end_time || ''} onChange={v => set('event_end_time', v)} className={cls} /></div>
        <div><label className="text-sm text-slate-500">סוג אירוע</label>
          <select value={form.event_type || ''} onChange={e => set('event_type', e.target.value)} className={cls}>
            <option value="">בחר...</option>
            {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select></div>
        <div><label className="text-sm text-slate-500">מוזמנים</label><input type="text" value={form.guest_count || ''} onChange={e => set('guest_count', e.target.value)} className={cls} /></div>
        <div><label className="text-sm text-slate-500">תקציב</label><input type="text" value={form.budget || ''} onChange={e => set('budget', e.target.value)} className={cls} /></div>
        <div><label className="text-sm text-slate-500">עדיפות</label>
          <select value={form.priority || 'normal'} onChange={e => set('priority', e.target.value)} className={cls}>
            <option value="normal">רגיל</option><option value="hot">🔥 חם</option><option value="urgent">⚡ דחוף</option>
          </select></div>
        <div className="col-span-2"><label className="text-sm text-slate-500">אחראי</label>
          <select value={form.assigned_to || ''} onChange={e => set('assigned_to', e.target.value)} className={cls}>
            <option value="">ללא</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
          </select></div>
        <div className="col-span-2"><label className="text-sm text-slate-500">תיאור</label>
          <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} className={`${cls} resize-none`} rows={3} /></div>
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 border-2 border-slate-200 text-slate-500 text-base font-bold py-2 rounded-xl">ביטול</button>
        <button onClick={onSave} className="flex-1 bg-violet-600 text-white text-base font-bold py-2 rounded-xl">שמור</button>
      </div>
    </div>
  );
}

function ProductionSection({ leadId, lead, onUpdated }) {
  const [form, setForm] = useState({
    deposit_amount:    lead.deposit_amount    || '',
    deposit_date:      lead.deposit_date      ? lead.deposit_date.split('T')[0] : '',
    deposit_confirmed: lead.deposit_confirmed || false,
    production_notes:  lead.production_notes  || '',
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/leads/${leadId}`, form);
      await onUpdated();
    } catch { alert('שגיאה בשמירה'); }
    setSaving(false);
  }

  const cls = 'w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-violet-400 transition bg-white';

  return (
    <Section title="🎉 הפקה">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-sm text-slate-500 block mb-1">סכום מקדמה (₪)</label>
            <input type="number" value={form.deposit_amount}
              onChange={e => setForm(f => ({ ...f, deposit_amount: e.target.value }))}
              className={cls} placeholder="0" />
          </div>
          <div>
            <label className="text-sm text-slate-500 block mb-1">תאריך מקדמה</label>
            <DateInput value={form.deposit_date} onChange={v => setForm(f => ({ ...f, deposit_date: v }))} className={cls} />
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer justify-end">
          <span className="text-base font-semibold text-slate-700">מקדמה התקבלה</span>
          <input type="checkbox" checked={form.deposit_confirmed}
            onChange={e => setForm(f => ({ ...f, deposit_confirmed: e.target.checked }))}
            className="w-4 h-4 accent-violet-600" />
        </label>
        <div>
          <label className="text-sm text-slate-500 block mb-1">הערות הפקה</label>
          <textarea value={form.production_notes}
            onChange={e => setForm(f => ({ ...f, production_notes: e.target.value }))}
            className={`${cls} resize-none`} rows={3} placeholder="פרטי הפקה, ספקים, הערות..." />
        </div>
        <button onClick={save} disabled={saving}
          className="w-full bg-violet-600 text-white font-bold py-2 rounded-xl text-base disabled:opacity-50">
          {saving ? 'שומר...' : 'שמור'}
        </button>
      </div>
    </Section>
  );
}

function formatMeetingDateTime(isoStr) {
  const dt = new Date(isoStr);
  const date = dt.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jerusalem' });
  const time = dt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem', hour12: false });
  return `${date} ${time}`;
}

function CalendarSection({ lead, leadId, editForm, calStatus, onUpdated }) {
  const [marking, setMarking] = useState(false);
  const [syncWarning, setSyncWarning] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [pendingMark, setPendingMark] = useState(null);
  const [meeting, setMeeting] = useState(null);
  const [showMeetingAction, setShowMeetingAction] = useState(false);

  useEffect(() => {
    if (!lead?.meeting_event_id) { setMeeting(null); return; }
    api.get(`/calendar/meetings/${lead.meeting_event_id}/details`)
      .then(r => setMeeting(r.data))
      .catch(() => setMeeting(null));
  }, [lead?.meeting_event_id]);

  function handleMarkClick(type) {
    const dateStr = editForm?.event_date_text || '';
    const timeStr = editForm?.event_time || '';

    if (!dateStr.trim() && !timeStr.trim()) {
      alert('צריך למלא את התאריך וזמן האירוע על מנת להכניס ליומן');
      return;
    }

    const parsedDate = parseDateIL(dateStr);
    const parsedTime = parseTimeIL(timeStr);

    if (!parsedDate && !parsedTime) {
      alert('התאריך והשעה לא ברורים — אנא הכנס תאריך בפורמט DD/MM/YYYY ושעה בפורמט HH:MM');
      return;
    }
    if (!parsedDate) {
      alert('התאריך לא ברור — אנא הכנס תאריך בפורמט DD/MM/YYYY');
      return;
    }
    if (!parsedTime) {
      alert('השעה לא ברורה — אנא הכנס שעה בפורמט HH:MM');
      return;
    }

    const [y, mo, d] = parsedDate.split('-');
    setPendingMark({ type, parsedDate, parsedTime, displayDate: `${d}/${mo}/${y}` });
  }

  async function confirmMark() {
    const { type, parsedDate, parsedTime } = pendingMark;
    setPendingMark(null);
    setMarking(true);
    setSyncWarning(false);
    setSyncError('');
    try {
      await api.patch(`/leads/${leadId}`, { event_date: parsedDate, event_time: parsedTime, event_date_text: editForm?.event_date_text || null });
      const { data } = await api.post(`/calendar/leads/${leadId}/mark`, { type });
      if (data.calendarSynced === false) {
        setSyncWarning(true);
        setSyncError(data.syncError || '');
      }
      await onUpdated();
    } catch { alert('שגיאה בסימון יומן'); }
    setMarking(false);
  }

  const type = calStatus?.type;

  return (
    <Section title="יומן Google">
      <div className="flex items-center gap-3">
        <div className="flex gap-2">
          <button onClick={() => handleMarkClick('option')} disabled={marking}
            className={`text-sm font-bold px-3 py-1.5 rounded-xl border-2 transition ${type === 'option' ? 'bg-yellow-400 text-white border-yellow-400' : 'border-slate-200 text-slate-500 hover:border-yellow-300 hover:text-yellow-600'}`}>
            אופציה
          </button>
          <button onClick={() => handleMarkClick('confirmed')} disabled={marking}
            className={`text-sm font-bold px-3 py-1.5 rounded-xl border-2 transition ${type === 'confirmed' ? 'bg-emerald-500 text-white border-emerald-500' : 'border-slate-200 text-slate-500 hover:border-violet-300 hover:text-violet-600'}`}>
            סגור
          </button>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-slate-400">
            {type === 'confirmed' ? 'מסומן כסגור ביומן' : type === 'option' ? 'מסומן כאופציה ביומן' : 'לא מסומן ביומן'}
          </span>
          {calStatus?.html_link && (
            <a href={calStatus.html_link} target="_blank" rel="noreferrer"
               className="text-xs text-violet-600 hover:underline">פתח ביומן Google</a>
          )}
        </div>
      </div>
      {lead?.meeting_event_id && (
        <div className="mt-3 bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="text-sm text-right">
            <span className="font-bold text-violet-700">נקבעה פגישה ל-</span>
            <span className="text-slate-700 font-semibold">
              {meeting ? formatMeetingDateTime(meeting.start_time) : '...'}
            </span>
          </div>
          <button onClick={() => setShowMeetingAction(true)}
            className="text-sm font-bold px-3 py-1.5 rounded-xl border-2 border-red-200 text-red-600 hover:bg-red-50 transition whitespace-nowrap">
            בטל\דחה פגישה
          </button>
        </div>
      )}
      {syncWarning && (
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mt-2">
          הסטטוס עודכן ב-CRM, אך הסנכרון ל-Google Calendar נכשל{syncError ? `: ${syncError}` : ''}
        </p>
      )}
      {showMeetingAction && (
        <MeetingActionModal
          lead={lead}
          leadId={leadId}
          eventId={lead.meeting_event_id}
          meeting={meeting}
          onClose={() => setShowMeetingAction(false)}
          onUpdated={async () => { setShowMeetingAction(false); await onUpdated(); }}
        />
      )}
      {pendingMark && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={() => setPendingMark(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-5 w-80 mx-4 text-right space-y-3" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-slate-800 text-base">האם אלו התאריך וזמן האירוע הנכונים?</p>
            <p className="text-slate-700 text-lg font-semibold">{pendingMark.displayDate} · {pendingMark.parsedTime}</p>
            <div className="flex gap-2">
              <button onClick={() => setPendingMark(null)}
                className="flex-1 border-2 border-slate-200 text-slate-500 font-bold py-2 rounded-xl">ביטול</button>
              <button onClick={confirmMark}
                className="flex-1 bg-violet-600 text-white font-bold py-2 rounded-xl">אישור</button>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

/* ── ADD TASK MODAL ── */
function AddTaskModal({ leadId, users, onClose, onSaved }) {
  const [form, setForm] = useState({ title: '', due_date: '', due_time: '', assigned_to: '', remind_via: 'whatsapp' });
  const [saving, setSaving] = useState(false);
  const cls = 'w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-violet-400 bg-white';

  async function save() {
    if (!form.title.trim()) return;
    setSaving(true);
    const payload = { title: form.title, remind_via: form.remind_via };
    if (form.due_date) payload.due_at = localToISO(form.due_date, form.due_time);
    if (form.assigned_to) payload.assigned_to = form.assigned_to;
    await api.post(`/leads/${leadId}/tasks`, payload);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-5 w-96 mx-4 space-y-3" onClick={e => e.stopPropagation()}>
        <h3 className="font-black text-slate-800 text-lg text-right">+ משימה חדשה</h3>
        <input autoFocus value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          className={cls} placeholder="כותרת המשימה..." />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-sm text-slate-500 block mb-1 text-right">תאריך</label>
            <DateInput value={form.due_date} onChange={v => setForm(f => ({ ...f, due_date: v }))} className={cls} />
          </div>
          <div>
            <label className="text-sm text-slate-500 block mb-1 text-right">שעה</label>
            <TimeInput value={form.due_time} onChange={v => setForm(f => ({ ...f, due_time: v }))} className={cls} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-sm text-slate-500 block mb-1 text-right">אחראי</label>
            <select value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))} className={cls}>
              <option value="">ללא</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-500 block mb-1 text-right">תזכורת</label>
            <select value={form.remind_via} onChange={e => setForm(f => ({ ...f, remind_via: e.target.value }))} className={cls}>
              <option value="whatsapp">וואטסאפ</option>
              <option value="app">אפליקציה</option>
            </select>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 border-2 border-slate-200 text-slate-500 font-bold py-2 rounded-xl text-base">ביטול</button>
          <button onClick={save} disabled={saving || !form.title.trim()}
            className="flex-1 bg-violet-600 text-white font-bold py-2 rounded-xl text-base disabled:opacity-50">
            {saving ? '...' : 'הוסף משימה'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── TASK ACTION MODAL ── */
function TaskActionModal({ task, leadId, lead, users, allPhones, allEmails, onClose, onDone, completeTask }) {
  const [mode, setMode]           = useState(null); // null|'done'|'reschedule'|'followup'
  const [outcomeType, setOutcomeType] = useState(null); // null|'call'|'meeting'|'note'|'wa_send'|'email_send'
  const [body, setBody]           = useState('');
  const [dir, setDir]             = useState('outbound');
  const [emailTo, setEmailTo]     = useState((allEmails && allEmails[0]) || lead?.email || '');
  const [waPhone, setWaPhone]     = useState((allPhones && allPhones[0]) || lead?.phone || '');
  const [subject, setSubject]     = useState('');
  const [file, setFile]           = useState(null);
  const [newDueDate, setNewDueDate]   = useState('');
  const [newDueTime, setNewDueTime]   = useState('');
  const [followTitle, setFollowTitle] = useState('');
  const [followDueDate, setFollowDueDate] = useState('');
  const [followDueTime, setFollowDueTime] = useState('');
  const [saving, setSaving]       = useState(false);
  const fileRef = useRef(null);

  const cls = 'w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-violet-400';

  async function handleDoneSubmit() {
    if (!outcomeType) return;
    setSaving(true);
    try {
      if (outcomeType === 'wa_send') {
        const fd = new FormData();
        fd.append('leadId', leadId);
        fd.append('message', body);
        if (file) fd.append('file', file);
        if (waPhone) fd.append('phone', waPhone);
        await api.post('/whatsapp/send-file', fd);
      } else if (outcomeType === 'email_send') {
        const fd = new FormData();
        fd.append('to', emailTo);
        fd.append('subject', subject);
        fd.append('body', body);
        if (file) fd.append('file', file);
        await api.post(`/leads/${leadId}/email/send`, fd);
      } else {
        await api.post(`/leads/${leadId}/interactions`, { type: outcomeType, direction: dir, body });
      }
      await completeTask(task.id, body || outcomeType);
      onDone();
    } catch { setSaving(false); }
  }

  async function handleReschedule() {
    if (!newDueDate) return;
    setSaving(true);
    await api.patch(`/leads/${leadId}/tasks/${task.id}/reschedule`, { due_at: localToISO(newDueDate, newDueTime) });
    onDone();
  }

  async function handleFollowup() {
    if (!followTitle.trim()) return;
    setSaving(true);
    await completeTask(task.id, 'הועבר למשימת המשך');
    await api.post(`/leads/${leadId}/tasks`, { title: followTitle, due_at: followDueDate ? localToISO(followDueDate, followDueTime) : undefined });
    onDone();
  }

  const isOverdue = task.due_at && new Date(task.due_at) <= new Date();

  const OUTCOME_BTNS = [
    { type: 'call',       label: '📞 שיחה',          cls: 'border-slate-200 hover:border-violet-300' },
    { type: 'meeting',    label: '🤝 פגישה',          cls: 'border-slate-200 hover:border-violet-300' },
    { type: 'note',       label: '📝 הערה',           cls: 'border-slate-200 hover:border-violet-300' },
    { type: 'wa_send',    label: '📱 שלח וואטסאפ',   cls: 'border-slate-200 hover:border-green-300' },
    { type: 'email_send', label: '✉️ שלח אימייל',     cls: 'border-slate-200 hover:border-sky-300' },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-5 w-[26rem] mx-4 space-y-3 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="text-right">
          <h3 className="font-black text-slate-800 text-lg">{task.title}</h3>
          {task.due_at && (
            <p className={`text-sm mt-0.5 ${isOverdue ? 'text-red-500 font-semibold' : 'text-slate-400'}`}>
              📅 {formatFull(task.due_at)} {isOverdue ? '— באיחור!' : ''}
            </p>
          )}
          {task.assigned_name && <p className="text-sm text-slate-400">👤 {task.assigned_name}</p>}
        </div>

        {/* Top-level mode picker */}
        {!mode && (
          <div className="space-y-2 pt-1">
            <button onClick={() => setMode('done')}
              className="w-full bg-violet-600 text-white font-bold py-2.5 rounded-xl text-base hover:bg-violet-700 transition">
              ✅ סמן כהושלם + הוסף תוצאה
            </button>
            <button onClick={() => setMode('reschedule')}
              className="w-full bg-violet-100 text-violet-700 font-bold py-2.5 rounded-xl text-base hover:bg-violet-200 transition">
              🔄 קבע מחדש (לא ענה)
            </button>
            <button onClick={() => setMode('followup')}
              className="w-full bg-sky-100 text-sky-700 font-bold py-2.5 rounded-xl text-base hover:bg-sky-200 transition">
              ➕ צור משימת המשך
            </button>
            <button onClick={onClose}
              className="w-full border-2 border-slate-200 text-slate-500 font-bold py-2 rounded-xl text-base">
              ביטול
            </button>
          </div>
        )}

        {/* Done — pick outcome type */}
        {mode === 'done' && !outcomeType && (
          <div className="space-y-2">
            <p className="text-sm font-bold text-slate-500 text-right">מה עשית?</p>
            {OUTCOME_BTNS.map(btn => (
              <button key={btn.type} onClick={() => setOutcomeType(btn.type)}
                className={`w-full text-right font-bold py-2.5 px-4 rounded-xl text-base border-2 transition ${btn.cls}`}>
                {btn.label}
              </button>
            ))}
            <button onClick={() => setMode(null)}
              className="w-full border-2 border-slate-200 text-slate-500 font-bold py-2 rounded-xl text-base">
              חזרה
            </button>
          </div>
        )}

        {/* Done — call/meeting/note form */}
        {mode === 'done' && outcomeType && ['call','meeting','note'].includes(outcomeType) && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <button onClick={() => setDir('outbound')}
                className={`flex-1 text-sm font-bold py-1.5 rounded-xl border-2 transition ${dir === 'outbound' ? 'bg-violet-600 text-white border-violet-600' : 'border-slate-200 text-slate-500'}`}>
                יוצא ↗
              </button>
              <button onClick={() => setDir('inbound')}
                className={`flex-1 text-sm font-bold py-1.5 rounded-xl border-2 transition ${dir === 'inbound' ? 'bg-sky-600 text-white border-sky-600' : 'border-slate-200 text-slate-500'}`}>
                נכנס ↙
              </button>
            </div>
            <textarea autoFocus value={body} onChange={e => setBody(e.target.value)}
              className={`${cls} resize-none text-right`} rows={3} placeholder="תיאור..." />
            <div className="flex gap-2">
              <button onClick={() => setOutcomeType(null)} className="flex-1 border-2 border-slate-200 text-slate-500 font-bold py-2 rounded-xl text-base">חזרה</button>
              <button onClick={handleDoneSubmit} disabled={saving || !body.trim()}
                className="flex-1 bg-violet-600 text-white font-bold py-2 rounded-xl text-base disabled:opacity-50">
                {saving ? '...' : 'שמור וסמן הושלם'}
              </button>
            </div>
          </div>
        )}

        {/* Done — WhatsApp form */}
        {mode === 'done' && outcomeType === 'wa_send' && (
          <div className="space-y-2">
            {allPhones && allPhones.length > 1 ? (
              <select value={waPhone} onChange={e => setWaPhone(e.target.value)}
                className={`${cls} text-sm`} dir="ltr">
                {allPhones.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            ) : (
              <p className="text-sm text-slate-500 font-semibold text-right">שלח ל: {lead?.phone || '(אין מספר)'}</p>
            )}
            <textarea autoFocus value={body} onChange={e => setBody(e.target.value)}
              className={`${cls} resize-none`} rows={3} placeholder="הודעה..." />
            <input ref={fileRef} type="file" className="hidden" onChange={e => setFile(e.target.files[0] || null)} />
            <div onClick={() => fileRef.current.click()}
              className={`w-full border-2 border-dashed rounded-xl py-2 text-sm font-semibold text-center cursor-pointer transition ${file ? 'border-green-300 text-green-700 bg-green-50' : 'border-slate-200 text-slate-400 hover:border-green-300'}`}>
              {file ? `📎 ${file.name}` : '+ צרף קובץ'}
            </div>
            {file && <button onClick={() => setFile(null)} className="text-sm text-red-400 hover:underline">הסר קובץ</button>}
            <div className="flex gap-2">
              <button onClick={() => setOutcomeType(null)} className="flex-1 border-2 border-slate-200 text-slate-500 font-bold py-2 rounded-xl text-base">חזרה</button>
              <button onClick={handleDoneSubmit} disabled={saving || (!body.trim() && !file) || !waPhone}
                className="flex-1 bg-green-600 text-white font-bold py-2 rounded-xl text-base disabled:opacity-50">
                {saving ? '...' : 'שלח וסמן הושלם'}
              </button>
            </div>
          </div>
        )}

        {/* Done — Email form */}
        {mode === 'done' && outcomeType === 'email_send' && (
          <div className="space-y-2">
            {allEmails && allEmails.length > 1 ? (
              <select value={emailTo} onChange={e => setEmailTo(e.target.value)}
                className={`${cls} text-sm`} dir="ltr">
                {allEmails.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            ) : (
              <input value={emailTo} onChange={e => setEmailTo(e.target.value)}
                className={cls} placeholder="אימייל נמען..." dir="ltr" />
            )}
            <input value={subject} onChange={e => setSubject(e.target.value)}
              className={cls} placeholder="נושא..." />
            <textarea autoFocus value={body} onChange={e => setBody(e.target.value)}
              className={`${cls} resize-none`} rows={4} placeholder="תוכן ההודעה..." />
            <input ref={fileRef} type="file" className="hidden" onChange={e => setFile(e.target.files[0] || null)} />
            <div onClick={() => fileRef.current.click()}
              className={`w-full border-2 border-dashed rounded-xl py-2 text-sm font-semibold text-center cursor-pointer transition ${file ? 'border-sky-300 text-sky-700 bg-sky-50' : 'border-slate-200 text-slate-400 hover:border-sky-300'}`}>
              {file ? `📎 ${file.name}` : '+ צרף קובץ'}
            </div>
            {file && <button onClick={() => setFile(null)} className="text-sm text-red-400 hover:underline">הסר קובץ</button>}
            <div className="flex gap-2">
              <button onClick={() => setOutcomeType(null)} className="flex-1 border-2 border-slate-200 text-slate-500 font-bold py-2 rounded-xl text-base">חזרה</button>
              <button onClick={handleDoneSubmit} disabled={saving || !emailTo.trim() || !body.trim()}
                className="flex-1 bg-sky-600 text-white font-bold py-2 rounded-xl text-base disabled:opacity-50">
                {saving ? '...' : 'שלח וסמן הושלם'}
              </button>
            </div>
          </div>
        )}

        {/* Reschedule */}
        {mode === 'reschedule' && (
          <div className="space-y-2">
            <label className="text-sm text-slate-500 block text-right">תאריך ושעה חדשים</label>
            <div className="flex gap-2">
              <DateInput value={newDueDate} onChange={setNewDueDate} className={`${cls} flex-1`} autoFocus />
              <TimeInput value={newDueTime} onChange={setNewDueTime} className={`${cls} w-28`} />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setMode(null)} className="flex-1 border-2 border-slate-200 text-slate-500 font-bold py-2 rounded-xl text-base">חזרה</button>
              <button onClick={handleReschedule} disabled={saving || !newDueDate}
                className="flex-1 bg-violet-500 text-white font-bold py-2 rounded-xl text-base disabled:opacity-50">
                {saving ? '...' : 'קבע מחדש'}
              </button>
            </div>
          </div>
        )}

        {/* Follow-up */}
        {mode === 'followup' && (
          <div className="space-y-2">
            <input value={followTitle} onChange={e => setFollowTitle(e.target.value)}
              className={`${cls} text-right`} autoFocus placeholder="כותרת משימת המשך..." />
            <div className="flex gap-2">
              <DateInput value={followDueDate} onChange={setFollowDueDate} className={`${cls} flex-1`} />
              <TimeInput value={followDueTime} onChange={setFollowDueTime} className={`${cls} w-28`} />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setMode(null)} className="flex-1 border-2 border-slate-200 text-slate-500 font-bold py-2 rounded-xl text-base">חזרה</button>
              <button onClick={handleFollowup} disabled={saving || !followTitle.trim()}
                className="flex-1 bg-sky-600 text-white font-bold py-2 rounded-xl text-base disabled:opacity-50">
                {saving ? '...' : 'צור משימת המשך'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── AI BUTTONS (outgoing compose) ── */
function AiButtons({ onAction, aiLoading, hasBody }) {
  const btns = [
    { key: 'translate', label: '🌐 תרגם לאנגלית', cls: 'hover:border-blue-300 hover:text-blue-600' },
    { key: 'reply',     label: '🤖 הצע תשובה',    cls: 'hover:border-violet-300 hover:text-violet-600' },
    { key: 'improve',   label: '✨ שפר',           cls: 'hover:border-violet-300 hover:text-violet-600', requiresBody: true },
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {btns.map(btn => (
        <button key={btn.key}
          onClick={() => onAction(btn.key)}
          disabled={!!aiLoading || (btn.requiresBody && !hasBody)}
          className={`text-xs font-bold px-2.5 py-1 rounded-lg border-2 border-slate-200 text-slate-500 transition disabled:opacity-40 ${aiLoading === btn.key ? 'bg-slate-100' : btn.cls}`}>
          {aiLoading === btn.key ? '...' : btn.label}
        </button>
      ))}
    </div>
  );
}

/* ── MEETING ACTION MODAL (cancel / postpone) ── */
function MeetingActionModal({ lead, leadId, eventId, meeting, onClose, onUpdated }) {
  const [step, setStep] = useState(1); // 1=choose, 2=cancel, 3=postpone
  const [reason, setReason] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [delivery, setDelivery] = useState(lead?.phone ? 'whatsapp' : 'email');
  const [saving, setSaving] = useState(false);
  const cls = 'w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-violet-400 bg-white';

  useEffect(() => {
    if (meeting?.start_time) {
      const dt = new Date(meeting.start_time);
      setDate(dt.toLocaleDateString('sv', { timeZone: 'Asia/Jerusalem' }));
      setStartTime(dt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem', hour12: false }));
    }
    if (meeting?.end_time) {
      const dt = new Date(meeting.end_time);
      setEndTime(dt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem', hour12: false }));
    }
  }, [meeting]);

  async function confirmCancel() {
    setSaving(true);
    try {
      await api.delete(`/calendar/meetings/${eventId}`, { data: { reason } });
      await onUpdated();
    } catch { alert('שגיאה בביטול הפגישה'); }
    setSaving(false);
  }

  async function confirmPostpone() {
    if (!date || !startTime || !endTime) return;
    setSaving(true);
    try {
      const newStart = new Date(`${date}T${startTime}`).toISOString();
      const newEnd   = new Date(`${date}T${endTime}`).toISOString();
      await api.patch(`/calendar/meetings/${eventId}/reschedule`, { newStart, newEnd, reason });

      const icsUrl = `${window.location.origin}/api/calendar/meetings/${eventId}/ics`;
      if (delivery === 'whatsapp') {
        await api.post('/whatsapp/send', {
          leadId,
          message: `שלום! הפגישה שלך נדחתה. הנה הקישור המעודכן:\n${icsUrl}`,
        });
        if (lead?.email) await api.post(`/calendar/meetings/${eventId}/notify`);
      } else {
        await api.post(`/calendar/meetings/${eventId}/notify`);
      }

      await onUpdated();
    } catch { alert('שגיאה בדחיית הפגישה'); }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-5 w-[22rem] mx-4 space-y-3 text-right" onClick={e => e.stopPropagation()}>

        {step === 1 && (
          <>
            <h3 className="font-black text-slate-800 text-lg">מה ברצונך לעשות?</h3>
            {meeting && (
              <p className="text-sm text-slate-500">פגישה: {formatMeetingDateTime(meeting.start_time)}</p>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setStep(3)}
                className="flex-1 border-2 border-amber-300 text-amber-700 font-bold py-2 rounded-xl hover:bg-amber-50 transition">
                דחה פגישה
              </button>
              <button onClick={() => setStep(2)}
                className="flex-1 border-2 border-red-300 text-red-600 font-bold py-2 rounded-xl hover:bg-red-50 transition">
                בטל פגישה
              </button>
            </div>
            <button onClick={onClose} className="w-full text-sm text-slate-400 hover:text-slate-600 transition">חזור</button>
          </>
        )}

        {step === 2 && (
          <>
            <h3 className="font-black text-slate-800 text-lg">ביטול פגישה</h3>
            <div>
              <label className="text-sm text-slate-500 block mb-1">הכנס את סיבת הביטול</label>
              <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
                className={cls} placeholder="סיבת הביטול..." />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setStep(1)} className="flex-1 border-2 border-slate-200 text-slate-500 font-bold py-2 rounded-xl">חזור</button>
              <button onClick={confirmCancel} disabled={saving}
                className="flex-1 bg-red-600 text-white font-bold py-2 rounded-xl disabled:opacity-50">
                {saving ? '...' : 'בטל פגישה'}
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h3 className="font-black text-slate-800 text-lg">דחיית פגישה</h3>
            <div>
              <label className="text-sm text-slate-500 block mb-1">סיבת הדחייה</label>
              <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
                className={cls} placeholder="סיבת הדחייה..." />
            </div>
            <div>
              <label className="text-sm text-slate-500 block mb-1">תאריך חדש</label>
              <DateInput value={date} onChange={setDate} className={cls} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-sm text-slate-500 block mb-1">שעת התחלה</label>
                <TimeInput value={startTime} onChange={setStartTime} className={cls} />
              </div>
              <div>
                <label className="text-sm text-slate-500 block mb-1">שעת סיום</label>
                <TimeInput value={endTime} onChange={setEndTime} className={cls} />
              </div>
            </div>
            <div>
              <label className="text-sm text-slate-500 block mb-1">שלח עדכון דרך</label>
              <div className="flex gap-2">
                {lead?.phone && (
                  <button onClick={() => setDelivery('whatsapp')}
                    className={`flex-1 text-sm font-bold py-2 rounded-xl border-2 transition ${delivery === 'whatsapp' ? 'bg-green-600 text-white border-green-600' : 'border-slate-200 text-slate-600 hover:border-green-300'}`}>
                    וואטסאפ
                  </button>
                )}
                {lead?.email && (
                  <button onClick={() => setDelivery('email')}
                    className={`flex-1 text-sm font-bold py-2 rounded-xl border-2 transition ${delivery === 'email' ? 'bg-sky-600 text-white border-sky-600' : 'border-slate-200 text-slate-600 hover:border-sky-300'}`}>
                    אימייל
                  </button>
                )}
                {!lead?.phone && !lead?.email && (
                  <p className="text-sm text-red-400">אין מספר טלפון או אימייל</p>
                )}
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setStep(1)} className="flex-1 border-2 border-slate-200 text-slate-500 font-bold py-2 rounded-xl">חזור</button>
              <button onClick={confirmPostpone} disabled={saving || !date || !startTime || !endTime}
                className="flex-1 bg-amber-500 text-white font-bold py-2 rounded-xl disabled:opacity-50">
                {saving ? '...' : 'דחה ושלח'}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}

/* ── SCHEDULE MEETING MODAL ── */
function ScheduleMeetingModal({ lead, leadId, onClose, onDone }) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString('sv', { timeZone: 'Asia/Jerusalem' }); // yyyy-mm-dd

  const [title, setTitle]       = useState(`פגישה עם ${lead.name || ''}`);
  const [date, setDate]         = useState(tomorrowStr);
  const [startTime, setStart]   = useState('10:00');
  const [endTime, setEnd]       = useState('11:00');
  const [delivery, setDelivery] = useState(lead.phone ? 'whatsapp' : 'email');
  const [step, setStep]         = useState(1); // 1=form, 2=done
  const [saving, setSaving]     = useState(false);
  const [result, setResult]     = useState(null); // { eventId, eventLink }
  const [rsvp, setRsvp]         = useState(null);
  const [checkingRsvp, setCheckingRsvp] = useState(false);

  const cls = 'w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-violet-400 bg-white';

  function buildDateTime(d, t) {
    return new Date(`${d}T${t}`).toISOString();
  }

  async function submit() {
    if (!date || !startTime || !endTime) return;
    setSaving(true);
    try {
      const start = buildDateTime(date, startTime);
      const end   = buildDateTime(date, endTime);
      const guestEmail = lead.email || null;

      const { data } = await api.post(`/calendar/leads/${leadId}/meeting`, {
        title, start, end, guestEmail, guestName: lead.name,
      });

      if (delivery === 'whatsapp') {
        await api.post('/whatsapp/send', {
          leadId,
          message: `שלום! קישור לפגישה שנקבעה לך בשרביה:\n${data.icsUrl}`,
        });
        if (guestEmail) await api.post(`/calendar/meetings/${data.eventId}/notify`);
      } else {
        await api.post(`/calendar/meetings/${data.eventId}/notify`);
      }

      setResult(data);
      setStep(2);
    } catch (err) {
      alert(err.response?.data?.error || 'שגיאה ביצירת הפגישה');
    }
    setSaving(false);
  }

  async function checkRsvp() {
    if (!result || !lead.email) return;
    setCheckingRsvp(true);
    try {
      const { data } = await api.get(`/calendar/meetings/${result.eventId}/status`, {
        params: { leadId, guestEmail: lead.email },
      });
      setRsvp(data.status);
    } catch { }
    setCheckingRsvp(false);
  }

  const RSVP_LABELS = {
    accepted:  { text: '✅ אישר',    cls: 'bg-emerald-100 text-emerald-700' },
    declined:  { text: '❌ דחה',     cls: 'bg-red-100 text-red-600' },
    tentative: { text: '❓ אולי',    cls: 'bg-amber-100 text-amber-700' },
    needsAction: { text: '⏳ ממתין', cls: 'bg-slate-100 text-slate-600' },
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-5 w-[22rem] mx-4 space-y-3" onClick={e => e.stopPropagation()}>
        <h3 className="font-black text-slate-800 text-lg text-right">📅 קבע פגישה</h3>

        {step === 1 && (
          <>
            <div>
              <label className="text-sm text-slate-500 block mb-1 text-right">כותרת</label>
              <input value={title} onChange={e => setTitle(e.target.value)} className={cls} />
            </div>
            <div>
              <label className="text-sm text-slate-500 block mb-1 text-right">תאריך</label>
              <DateInput value={date} onChange={setDate} className={cls} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-sm text-slate-500 block mb-1 text-right">שעת התחלה</label>
                <TimeInput value={startTime} onChange={setStart} className={cls} />
              </div>
              <div>
                <label className="text-sm text-slate-500 block mb-1 text-right">שעת סיום</label>
                <TimeInput value={endTime} onChange={setEnd} className={cls} />
              </div>
            </div>
            <div>
              <label className="text-sm text-slate-500 block mb-1 text-right">שלח הזמנה דרך</label>
              <div className="flex gap-2">
                {lead.phone && (
                  <button onClick={() => setDelivery('whatsapp')}
                    className={`flex-1 text-sm font-bold py-2 rounded-xl border-2 transition ${delivery === 'whatsapp' ? 'bg-green-600 text-white border-green-600' : 'border-slate-200 text-slate-600 hover:border-green-300'}`}>
                    📱 וואטסאפ
                  </button>
                )}
                {lead.email && (
                  <button onClick={() => setDelivery('email')}
                    className={`flex-1 text-sm font-bold py-2 rounded-xl border-2 transition ${delivery === 'email' ? 'bg-sky-600 text-white border-sky-600' : 'border-slate-200 text-slate-600 hover:border-sky-300'}`}>
                    ✉️ אימייל
                  </button>
                )}
              </div>
              {!lead.phone && !lead.email && (
                <p className="text-sm text-red-400 text-right mt-1">אין מספר טלפון או אימייל</p>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={onClose} className="flex-1 border-2 border-slate-200 text-slate-500 font-bold py-2 rounded-xl text-base">ביטול</button>
              <button onClick={submit} disabled={saving || !date || (!lead.phone && !lead.email)}
                className="flex-1 bg-violet-600 text-white font-bold py-2 rounded-xl text-base disabled:opacity-50">
                {saving ? '...' : 'צור ושלח'}
              </button>
            </div>
          </>
        )}

        {step === 2 && result && (
          <div className="space-y-3 text-right">
            <p className="text-base font-bold text-emerald-600">✅ הפגישה נוצרה ונשלחה בהצלחה!</p>
            <a href={result.eventLink} target="_blank" rel="noreferrer"
              className="block text-sm text-violet-600 hover:underline font-semibold">
              🔗 פתח ב-Google Calendar
            </a>
            {lead.email && (
              <div className="flex items-center gap-2">
                <button onClick={checkRsvp} disabled={checkingRsvp}
                  className="text-sm font-bold px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition disabled:opacity-50">
                  {checkingRsvp ? '...' : 'בדוק תשובה'}
                </button>
                {rsvp && (
                  <span className={`text-sm font-bold px-3 py-1 rounded-full ${RSVP_LABELS[rsvp]?.cls || 'bg-slate-100 text-slate-600'}`}>
                    {RSVP_LABELS[rsvp]?.text || rsvp}
                  </span>
                )}
              </div>
            )}
            <button onClick={onDone} className="w-full bg-violet-600 text-white font-bold py-2 rounded-xl text-base">סגור</button>
          </div>
        )}
      </div>
    </div>
  );
}

function LostModal({ onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [text, setText]     = useState('');
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-5 w-80 mx-4" onClick={e => e.stopPropagation()}>
        <h3 className="font-black text-slate-800 text-lg text-right mb-3">סיבת אי-סגירה</h3>
        <div className="space-y-2 mb-3">
          {LOST_REASONS.map(r => (
            <button key={r.value} onClick={() => setReason(r.value)}
              className={`w-full text-right px-3 py-2 rounded-xl text-base font-semibold transition border-2 ${reason === r.value ? 'bg-red-50 border-red-400 text-red-700' : 'border-slate-200 text-slate-600 hover:border-red-200'}`}>
              {r.label}
            </button>
          ))}
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)}
          className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-red-300 resize-none mb-3"
          rows={2} placeholder="פירוט נוסף (אופציונלי)..." />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border-2 border-slate-200 text-slate-500 font-bold py-2 rounded-xl text-base">ביטול</button>
          <button onClick={() => reason && onConfirm(reason, text)} disabled={!reason}
            className="flex-1 bg-red-500 text-white font-bold py-2 rounded-xl text-base disabled:opacity-50">
            סמן כלא סגרו
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── ADDITIONAL CONTACTS ── */
function AdditionalContacts({ leadId, contacts, onChanged }) {
  const phones = contacts.filter(c => c.type === 'phone');
  const emails = contacts.filter(c => c.type === 'email');

  async function remove(id) {
    await api.delete(`/leads/${leadId}/contacts/${id}`);
    await onChanged();
  }

  return (
    <div className="mt-3 space-y-3">
      <ContactGroup label="📞 טלפונים נוספים" type="phone" items={phones} leadId={leadId}
        onRemove={remove} onAdded={onChanged} placeholder="מספר טלפון..." inputDir="ltr" />
      <ContactGroup label="✉️ אימיילים נוספים" type="email" items={emails} leadId={leadId}
        onRemove={remove} onAdded={onChanged} placeholder="כתובת אימייל..." inputDir="ltr" />
    </div>
  );
}

function ContactGroup({ label, type, items, leadId, onRemove, onAdded, placeholder, inputDir }) {
  const [adding, setAdding] = useState(false);
  const [value, setValue]   = useState('');
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!value.trim()) return;
    setSaving(true);
    try {
      await api.post(`/leads/${leadId}/contacts`, { type, value: value.trim() });
      setValue(''); setAdding(false);
      await onAdded();
    } catch { }
    setSaving(false);
  }

  return (
    <div>
      <p className="text-sm font-bold text-slate-500 mb-1.5">{label}</p>
      <div className="space-y-1">
        {items.map(c => (
          <div key={c.id} className="flex items-center gap-2 bg-white rounded-xl px-3 py-2 border border-slate-100">
            <span className="flex-1 text-base text-slate-700 font-medium" dir={inputDir}>{c.value}</span>
            <button onClick={() => onRemove(c.id)}
              className="text-slate-300 hover:text-red-400 transition text-sm px-1 rounded">🗑️</button>
          </div>
        ))}
        {adding ? (
          <div className="flex gap-2">
            <input autoFocus value={value} onChange={e => setValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && add()}
              className="flex-1 border-2 border-slate-200 rounded-xl px-3 py-1.5 text-base focus:outline-none focus:border-violet-400"
              placeholder={placeholder} dir={inputDir} />
            <button onClick={add} disabled={saving || !value.trim()}
              className="bg-violet-600 text-white text-sm font-bold px-3 py-1.5 rounded-xl disabled:opacity-50">
              {saving ? '...' : 'הוסף'}
            </button>
            <button onClick={() => { setAdding(false); setValue(''); }}
              className="text-slate-400 hover:text-slate-600 text-sm px-2">✕</button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="text-sm text-violet-600 hover:underline font-semibold">
            + הוסף
          </button>
        )}
      </div>
    </div>
  );
}

function TaskEditModal({ task, users, onSaved, onClose }) {
  const [title, setTitle]       = useState(task.title);
  const [dueAt, setDueAt]       = useState(task.due_at ? new Date(task.due_at).toISOString().slice(0,16) : '');
  const [assignedTo, setAssignedTo] = useState(task.assigned_to || '');
  const [saving, setSaving]     = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/tasks/${task.id}`, {
        title,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        assigned_to: assignedTo || null,
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'w-full rounded-xl px-3 py-2 text-sm border border-violet-200 focus:border-violet-400 focus:outline-none text-slate-700';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-5 w-full max-w-sm space-y-3" onClick={e => e.stopPropagation()} dir="rtl">
        <h3 className="font-black text-slate-800 text-base">עריכת משימה</h3>
        <input className={inputCls} placeholder="כותרת *" value={title} onChange={e => setTitle(e.target.value)} />
        <input className={inputCls} type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} />
        <select className={inputCls} value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
          <option value="">ללא שיוך</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}
        </select>
        <div className="flex gap-2 pt-1">
          <button onClick={save} disabled={saving || !title.trim()}
            className="flex-1 py-2.5 rounded-xl font-black text-sm text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
            {saving ? 'שומר...' : 'שמור'}
          </button>
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl font-bold text-sm border border-slate-200 text-slate-600 hover:bg-slate-50">
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

function SendReminderButton({ eventId }) {
  const [state, setState] = useState('idle'); // idle | sending | sent | error
  async function send() {
    setState('sending');
    try {
      await api.post(`/calendar/meetings/${eventId}/remind`);
      setState('sent');
      setTimeout(() => setState('idle'), 3000);
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 3000);
    }
  }
  return (
    <button onClick={send} disabled={state === 'sending'}
      className="text-sm font-bold px-2.5 py-1 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 transition disabled:opacity-50">
      {state === 'sending' ? '⏳...' : state === 'sent' ? '✅ נשלח' : state === 'error' ? '❌ שגיאה' : '🔔 שלח תזכורת'}
    </button>
  );
}
