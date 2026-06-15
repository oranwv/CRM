import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';
import useBackGuard from '../hooks/useBackGuard';
import DriveFilePicker from './DriveFilePicker';
import { useAppMode } from '../context/AppModeContext';
import ProductionChecklist from './ProductionChecklist';
import EventBriefModal from './EventBriefModal';
import SeatingChart from './SeatingChart';
import InvoiceModal from './InvoiceModal';
import PendingDocDetail from './PendingDocDetail';
import { docTypeLabel } from '../utils/docTypes';

const STAGES = [
  { key: 'new',               label: 'חדש',                 active: 'bg-sky-500 text-white border-sky-500',          past: 'bg-sky-100 text-sky-600 border-sky-200',            future: 'bg-white text-slate-400 border-slate-200 hover:border-sky-300 hover:text-sky-500' },
  { key: 'contacted',         label: 'בוצעה שיחה ראשונית', active: 'bg-amber-500 text-white border-amber-500',      past: 'bg-amber-100 text-amber-600 border-amber-200',      future: 'bg-white text-slate-400 border-slate-200 hover:border-amber-300 hover:text-amber-500' },
  { key: 'meeting_scheduled', label: 'נקבעה פגישה',        active: 'bg-fuchsia-500 text-white border-fuchsia-500',  past: 'bg-fuchsia-100 text-fuchsia-600 border-fuchsia-200', future: 'bg-white text-slate-400 border-slate-200 hover:border-fuchsia-300 hover:text-fuchsia-500' },
  { key: 'meeting',           label: 'בוצעה פגישה',        active: 'bg-violet-500 text-white border-violet-500',    past: 'bg-violet-100 text-violet-600 border-violet-200',   future: 'bg-white text-slate-400 border-slate-200 hover:border-violet-300 hover:text-violet-500' },
  { key: 'offer_sent',        label: 'נשלחה הצעת מחיר',    active: 'bg-blue-500 text-white border-blue-500',        past: 'bg-blue-100 text-blue-600 border-blue-200',         future: 'bg-white text-slate-400 border-slate-200 hover:border-blue-300 hover:text-blue-500' },
  { key: 'negotiation',       label: 'מו"מ',               active: 'bg-orange-500 text-white border-orange-500',    past: 'bg-orange-100 text-orange-600 border-orange-200',   future: 'bg-white text-slate-400 border-slate-200 hover:border-orange-300 hover:text-orange-500' },
  { key: 'contract_sent',     label: 'נשלח חוזה',           active: 'bg-indigo-500 text-white border-indigo-500',    past: 'bg-indigo-100 text-indigo-600 border-indigo-200',   future: 'bg-white text-slate-400 border-slate-200 hover:border-indigo-300 hover:text-indigo-500' },
  { key: 'deposit',           label: 'התקבלה מקדמה',       active: 'bg-emerald-500 text-white border-emerald-500',  past: 'bg-emerald-100 text-emerald-600 border-emerald-200', future: 'bg-white text-slate-400 border-slate-200 hover:border-amber-300 hover:text-emerald-500' },
  { key: 'production',        label: 'הפקה',               active: 'bg-teal-500 text-white border-teal-500',        past: 'bg-teal-100 text-teal-600 border-teal-200',         future: 'bg-white text-slate-400 border-slate-200 hover:border-teal-300 hover:text-teal-500' },
  { key: 'completed',         label: 'אירוע הסתיים והתקבל תשלום', active: 'bg-slate-700 text-white border-slate-700', past: 'bg-slate-100 text-slate-600 border-slate-200',      future: 'bg-white text-slate-400 border-slate-200 hover:border-slate-400 hover:text-slate-600' },
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
  call_event: 'Call Event', telekol: 'טלקול', vonage: 'מענה קולי',
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
  return (
    <input type="text" value={value || ''} onChange={e => onChange(e.target.value)}
      placeholder="DD/MM/YYYY" className={className} dir="ltr" />
  );
}
function TimeInput({ value, onChange, className }) {
  return (
    <input type="text" value={value || ''} onChange={e => onChange(e.target.value)}
      placeholder="HH:MM" className={className} dir="ltr" />
  );
}
// Calendar + clock pickers — for task/meeting modals where exact datetime is required
function PickerDateInput({ value, onChange, className }) {
  const ref = useRef(null);
  const display = value ? value.split('-').reverse().join('/') : '';
  return (
    <div className={`${className} relative flex items-center cursor-pointer`}
         onClick={() => ref.current?.showPicker?.()}>
      <span className={`flex-1 select-none ${display ? '' : 'text-slate-400'}`}>{display || 'DD/MM/YYYY'}</span>
      <span className="text-slate-400 text-xs ml-1">📅</span>
      <input ref={ref} type="date" value={value || ''} onChange={e => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
    </div>
  );
}
function PickerTimeInput({ value, onChange, className }) {
  const ref = useRef(null);
  return (
    <div className={`${className} relative flex items-center cursor-pointer`}
         onClick={() => ref.current?.showPicker?.()}>
      <span className={`flex-1 select-none ${value ? '' : 'text-slate-400'}`}>{value || 'HH:MM'}</span>
      <span className="text-slate-400 text-xs ml-1">🕐</span>
      <input ref={ref} type="time" value={value || ''} onChange={e => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
    </div>
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

export default function LeadCard({ leadId, onClose, onUpdated = () => {} }) {
  const currentUser = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const isManager   = ['admin', 'manager'].includes(currentUser.role);
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
  const [taskDefaultAssignee, setTaskDefaultAssignee] = useState(null);
  const [taskAction, setTaskAction]             = useState(null); // { task, mode: 'complete'|'reschedule'|'followup' }
  const [editing, setEditing]           = useState(false);
  const [editForm, setEditForm]         = useState({});
  const [avatarZoom, setAvatarZoom]     = useState(false);
  const [editingName, setEditingName]     = useState(false);
  const [nameDraft, setNameDraft]         = useState('');
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [showPriceOffer, setShowPriceOffer]     = useState(false);
  const [showContract, setShowContract]         = useState(false);
  const [showBrief,    setShowBrief]    = useState(false);
  const [showSeating,  setShowSeating]  = useState(false);
  const [hasSketch,    setHasSketch]    = useState(false);
  const [showInvoice,    setShowInvoice]    = useState(false);
  const [pendingDocs,    setPendingDocs]    = useState([]);
  const [selectedDoc,    setSelectedDoc]    = useState(null);
  const [leadSuppliers,      setLeadSuppliers]      = useState([]);
  const [allSuppliers,       setAllSuppliers]       = useState([]);
  const [showSupplierPicker, setShowSupplierPicker] = useState(false);
  const [supplierSearch,     setSupplierSearch]     = useState('');
  const [showActionMenu,     setShowActionMenu]     = useState(false);
  const [showReviewModal,    setShowReviewModal]    = useState(false);
  const [reviewSettings,     setReviewSettings]    = useState(null);
  const [reviewMsg,          setReviewMsg]         = useState('');
  const [reviewSending,      setReviewSending]     = useState(false);
  const { mode } = useAppMode();

  // Back gesture (Windows back / trackpad swipe) closes the topmost overlay
  // instead of navigating away; editors warn before discarding unsaved work.
  useBackGuard(true, onClose, { isDirty: editing || editingName });
  useBackGuard(showContract,   () => setShowContract(false),   { isDirty: true });
  useBackGuard(showPriceOffer, () => setShowPriceOffer(false), { isDirty: true });
  useBackGuard(showInvoice,    () => setShowInvoice(false),    { isDirty: true });
  useBackGuard(showBrief,      () => setShowBrief(false),      { isDirty: true });
  useBackGuard(showSeating,    () => setShowSeating(false),    { isDirty: true });

  const load = useCallback(async (signal) => {
    try {
      const [leadRes, intRes, msgRes, fileRes, taskRes, userRes, calRes, contactsRes] = await Promise.all([
        api.get(`/leads/${leadId}`, { signal }),
        api.get(`/leads/${leadId}/interactions`, { signal }),
        api.get(`/leads/${leadId}/messages`, { signal }),
        api.get(`/leads/${leadId}/files`, { signal }),
        api.get(`/leads/${leadId}/tasks`, { signal }),
        api.get('/users', { signal }),
        api.get(`/calendar/leads/${leadId}/status`, { signal }).catch(() => ({ data: { type: null } })),
        api.get(`/leads/${leadId}/contacts`, { signal }),
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
    } catch (err) {
      if (err?.code === 'ERR_CANCELED') return; // ignore aborts on unmount
    }
    api.get(`/greeninvoice/pending?leadId=${leadId}`, { signal }).then(r => setPendingDocs(r.data)).catch(() => {});
    setLoading(false);
  }, [leadId]);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    api.post(`/leads/${leadId}/read`).catch(() => {});
    const onVisible = () => { if (document.visibilityState === 'visible') load(ctrl.signal); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      ctrl.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, leadId]);

  useEffect(() => {
    if (!lead || !['deposit', 'production', 'completed'].includes(lead.stage)) return;
    api.get(`/leads/${leadId}/suppliers`).then(r => setLeadSuppliers(r.data)).catch(() => {});
    api.get('/suppliers').then(r => setAllSuppliers(r.data)).catch(() => {});
  }, [lead?.stage, leadId]);

  useEffect(() => {
    if (!lead || ['deposit', 'production', 'completed'].includes(lead.stage)) return;
    api.get(`/leads/${leadId}/seating`)
      .then(r => {
        const d = r.data || {};
        setHasSketch((d.inside?.length || 0) + (d.outside?.length || 0) > 0);
      })
      .catch(() => {});
  }, [lead?.stage, leadId]);

  function refreshPendingDocs() {
    api.get(`/greeninvoice/pending?leadId=${leadId}`).then(r => setPendingDocs(r.data)).catch(() => {});
  }

  async function linkSupplier(supplierId) {
    await api.post(`/leads/${leadId}/suppliers`, { supplierId }).catch(() => {});
    const s = allSuppliers.find(x => x.id === supplierId);
    if (s) setLeadSuppliers(prev => [...prev.filter(x => x.id !== supplierId), s]);
    setShowSupplierPicker(false);
    setSupplierSearch('');
  }

  async function unlinkSupplier(supplierId) {
    await api.delete(`/leads/${leadId}/suppliers/${supplierId}`).catch(() => {});
    setLeadSuppliers(prev => prev.filter(s => s.id !== supplierId));
  }

  async function openReviewModal() {
    if (!reviewSettings) {
      const res = await api.get('/admin/settings');
      const s = res.data;
      const settings = { link: s.google_review_link || '', message: s.google_review_message || '' };
      setReviewSettings(settings);
      setReviewMsg(settings.message);
    } else {
      setReviewMsg(reviewSettings.message);
    }
    setShowReviewModal(true);
  }

  async function sendReviewLink(channel) {
    if (!reviewMsg.trim()) return;
    setReviewSending(channel);
    try {
      await api.post(`/leads/${leadId}/send-review`, { channel, message: reviewMsg });
      setShowReviewModal(false);
      setReviewMsg('');
      load();
    } catch {
      alert('שגיאה בשליחה');
    } finally {
      setReviewSending(false);
    }
  }

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
  const allPhoneLabels = Object.fromEntries(
    contacts.filter(c => c.type === 'phone' && c.label).map(c => [c.value, c.label])
  );
  const allEmailLabels = Object.fromEntries(
    contacts.filter(c => c.type === 'email' && c.label).map(c => [c.value, c.label])
  );

  const timeline = [
    ...interactions.map(i => ({
      id: `i-${i.id}`, _time: i.created_at,
      type: i.type, direction: i.direction,
      body: i.body, author: i.created_by_name,
    })),
    ...messages.map(m => ({
      id: `m-${m.id}`, _time: m.timestamp,
      type: m.channel, direction: m.direction,
      body: m.body, author: m.sent_by_name || null,
      contact_value: m.contact_value || null,
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
          <div className="flex flex-col gap-1 shrink-0">
            <button
              onClick={async () => {
                const next = lead.priority === 'hot' ? 'normal' : 'hot';
                const { data } = await api.patch(`/leads/${leadId}`, { priority: next });
                setLead(data);
              }}
              title="ליד חם"
              className={`text-xs font-bold px-2 py-1 rounded-lg transition ${
                lead.priority === 'hot' ? 'bg-orange-500 text-white' : 'bg-white/15 text-white/80 hover:bg-white/25'
              }`}
            >
              🔥 חם{lead.priority === 'hot' ? ' ✓' : ''}
            </button>
            <button
              onClick={async () => {
                const next = lead.priority === 'urgent' ? 'normal' : 'urgent';
                const { data } = await api.patch(`/leads/${leadId}`, { priority: next });
                setLead(data);
              }}
              title="ליד דחוף"
              className={`text-xs font-bold px-2 py-1 rounded-lg transition ${
                lead.priority === 'urgent' ? 'bg-red-500 text-white' : 'bg-white/15 text-white/80 hover:bg-white/25'
              }`}
            >
              ⚡ דחוף{lead.priority === 'urgent' ? ' ✓' : ''}
            </button>
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
          { key: 'whatsapp', label: 'וואטסאפ ואימייל' },
        ].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`flex-1 py-3 transition border-b-2 ${
              activeTab === t.key ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}>
            {t.label}
          </button>
        ))}
        {['deposit', 'production', 'completed'].includes(lead.stage) && (
          <>
            <button
              onClick={() => setShowBrief(true)}
              className="flex-1 py-3 transition border-b-2 border-transparent text-violet-500 hover:text-violet-700 font-bold"
            >
              בריף אירוע
            </button>
            <button
              onClick={() => setShowSeating(true)}
              className="flex-1 py-3 transition border-b-2 border-transparent text-violet-500 hover:text-violet-700 font-bold"
            >
              סקיצה
            </button>
          </>
        )}
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
                    {mode !== 'הפקה' && <button onClick={() => setShowMeetingModal(true)} className="text-sm font-bold px-2.5 py-1 rounded-xl bg-violet-600 text-white hover:bg-violet-700 transition">📅 קבע פגישה</button>}
                    {lead.meeting_event_id && <SendReminderButton eventId={lead.meeting_event_id} />}
                    <button onClick={() => setShowAddTask(true)} className="text-sm font-bold px-2.5 py-1 rounded-xl bg-violet-600 text-white hover:bg-violet-700 transition">+ משימה</button>
                    {mode !== 'הפקה' && <button onClick={() => setShowPriceOffer(true)} className="text-sm font-bold px-2.5 py-1 rounded-xl bg-amber-500 text-white hover:bg-amber-600 transition">הצעת מחיר</button>}
                    {mode === 'הפקה' && (lead.stage === 'deposit' || lead.stage === 'production') && (
                      <button
                        onClick={() => !savingStage && changeStage('completed')}
                        disabled={savingStage}
                        className="text-sm font-bold px-2.5 py-1 rounded-xl bg-slate-700 text-white hover:bg-slate-800 transition"
                      >
                        אירוע הסתיים והתקבל תשלום
                      </button>
                    )}
                    {mode !== 'הפקה' && <button onClick={() => setShowContract(true)} className="text-sm font-bold px-2.5 py-1 rounded-xl bg-violet-700 text-white hover:bg-violet-800 transition">חוזה</button>}
                    {mode === 'הפקה' && (
                      <button
                        onClick={() => setShowActionMenu(true)}
                        className="text-sm font-bold px-2.5 py-1 rounded-xl text-white hover:opacity-90 transition"
                        style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
                      >
                        +
                      </button>
                    )}
                  </div>
                </div>
              }>
              {isLost && (
                <span className="text-sm font-bold px-3 py-1.5 rounded-full bg-red-100 text-red-600 border border-red-200 mb-2 inline-block">
                  ✕ לא סגרו — {LOST_REASONS.find(r => r.value === lead.lost_reason)?.label || lead.lost_reason}
                  {lead.lost_reason_text && <span className="font-normal"> · {lead.lost_reason_text}</span>}
                </span>
              )}
              {mode === 'הפקה' && (lead.stage === 'deposit' || lead.stage === 'production' || lead.stage === 'completed') ? (
                <ProductionChecklist leadId={leadId} />
              ) : (
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
              )}
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
            <CalendarSection lead={lead} leadId={leadId} editForm={editForm} calStatus={calStatus} onUpdated={load} allPhones={allPhones} allPhoneLabels={allPhoneLabels} />

            {/* Event brief button — visible on closed leads */}
            {(lead.stage === 'deposit' || lead.stage === 'production' || lead.stage === 'completed') && (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowBrief(true)}
                  className="flex-1 py-2.5 rounded-2xl font-bold text-sm border-2 border-violet-300 text-violet-700 hover:bg-violet-50 transition"
                >
                  בריף אירוע
                </button>
                <button
                  onClick={() => setShowSeating(true)}
                  className="flex-1 py-2.5 rounded-2xl font-bold text-sm border-2 border-violet-300 text-violet-700 hover:bg-violet-50 transition"
                >
                  סקיצת פריסה
                </button>
              </div>
            )}

            {/* Details */}
            <Section title="פרטי לקוח"
              action={!editing && <button onClick={() => setEditing(true)} className="text-sm text-violet-600 hover:underline font-semibold">✏️ עריכה</button>}>
              {editing ? (
                <EditForm form={editForm} setForm={setEditForm} users={users} onSave={saveEdit} onCancel={() => setEditing(false)} />
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <InfoRow label="טלפון">
                      {lead.phone ? (
                        <a
                          href={`tel:${lead.phone}`}
                          className="text-violet-700 hover:underline font-medium"
                          dir="ltr"
                          onClick={() => api.post(`/leads/${lead.id}/interactions`, { type: 'call', direction: 'outbound', body: '', source: 'dial' }).then(load)}
                        >{lead.phone}</a>
                      ) : '—'}
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

            {/* Production module — only for deposit/production/completed stage */}
            {(lead.stage === 'deposit' || lead.stage === 'production' || lead.stage === 'completed') && (
              <ProductionSection leadId={leadId} lead={lead} onUpdated={load} />
            )}

            {/* Suppliers — visible on deposit/production/completed */}
            {(lead.stage === 'deposit' || lead.stage === 'production' || lead.stage === 'completed') && (
              <Section title={`ספקים${leadSuppliers.length ? ` (${leadSuppliers.length})` : ''}`}>
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {leadSuppliers.map(s => (
                      <span key={s.id} className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                        {s.name}
                        <button onClick={() => unlinkSupplier(s.id)} className="opacity-50 hover:opacity-100 font-black leading-none">×</button>
                      </span>
                    ))}
                  </div>
                  <button onClick={() => setShowSupplierPicker(p => !p)}
                    className="text-xs text-violet-600 font-bold hover:text-violet-800 transition">
                    + הוסף ספק
                  </button>
                  {showSupplierPicker && (
                    <div className="bg-white border border-slate-200 rounded-xl p-2 space-y-1 max-h-44 overflow-y-auto shadow-lg">
                      <input value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)}
                        placeholder="חיפוש ספק..." autoFocus
                        className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-violet-400 mb-1" />
                      {allSuppliers
                        .filter(s => !leadSuppliers.find(ls => ls.id === s.id) && (!supplierSearch || s.name.toLowerCase().includes(supplierSearch.toLowerCase())))
                        .map(s => (
                          <button key={s.id} onClick={() => linkSupplier(s.id)}
                            className="w-full text-right text-xs px-2 py-1.5 hover:bg-violet-50 rounded-lg flex items-center gap-2 transition">
                            <span className="font-bold text-slate-800">{s.name}</span>
                            <span className="text-slate-400 text-[10px]">{s.category}</span>
                          </button>
                        ))
                      }
                    </div>
                  )}
                </div>
              </Section>
            )}

            {/* Files */}
            <Section title={`קבצים${files.length ? ` (${files.length})` : ''}`}>
              <FilesSection leadId={leadId} files={files} onChanged={load} isAdmin={currentUser.role === 'admin'} />
              {!['deposit', 'production', 'completed'].includes(lead.stage) && (
                <button
                  onClick={() => setShowSeating(true)}
                  className="w-full mt-1 border-2 border-dashed border-violet-200 rounded-xl py-3 text-sm font-semibold text-center text-violet-500 hover:border-violet-400 hover:text-violet-700 hover:bg-violet-50 transition">
                  {hasSketch ? 'ערוך סקיצה' : '+ צור סקיצה'}
                </button>
              )}
            </Section>

            {/* Financial Documents */}
            <Section title="מסמכים פיננסיים">
              {pendingDocs.length > 0 && (
                <div className="space-y-2 mb-3">
                  {pendingDocs.map(doc => (
                    <button key={doc.id} onClick={() => setSelectedDoc(doc)}
                      className="w-full text-right border border-slate-200 rounded-xl p-3 text-xs space-y-1.5 hover:border-violet-300 hover:bg-violet-50 transition">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-700">{docTypeLabel(doc.payload?.type)}</span>
                        {doc.status === 'pending' && (
                          <span className="bg-amber-100 text-amber-700 font-bold px-2 py-0.5 rounded-full">ממתין לאישור</span>
                        )}
                        {doc.status === 'approved' && (
                          <span className="bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-full">אושר</span>
                        )}
                        {doc.status === 'rejected' && (
                          <span className="bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded-full">נדחה</span>
                        )}
                      </div>
                      <p className="text-slate-500">יצר: {doc.creator_name || 'לא ידוע'} · {new Date(doc.created_at).toLocaleDateString('he-IL')}</p>
                      {doc.status === 'rejected' && doc.rejection_comment && (
                        <p className="text-red-600">סיבה: {doc.rejection_comment}</p>
                      )}
                      {doc.status === 'pending' && isManager && (
                        <p className="text-violet-600 font-bold pt-0.5">לחץ לצפייה ואישור ←</p>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {mode !== 'הפקה' && (
                <button onClick={() => setShowInvoice(true)}
                  className="w-full border-2 border-dashed border-emerald-200 rounded-xl py-3 text-sm font-semibold text-center text-emerald-600 hover:border-emerald-400 hover:bg-emerald-50 transition">
                  + צור מסמך (חשבונית מס / קבלה / חשבונית עסקה)
                </button>
              )}
            </Section>

            {/* Interactions */}
            <Section title={`פעילות${timeline.length ? ` (${timeline.length})` : ''}`}>
              <TimelineSection leadId={leadId} lead={lead} timeline={timeline} allPhones={allPhones} allEmails={allEmails} allPhoneLabels={allPhoneLabels} leadFiles={files} onAdded={load} onAddTask={(defaultAssigneeId) => { setTaskDefaultAssignee(defaultAssigneeId || null); setShowAddTask(true); }} />
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
          <WhatsAppTab leadId={leadId} allPhones={allPhones} allPhoneLabels={allPhoneLabels} allEmails={allEmails} leadFiles={files} messages={messages} onSent={load} />
        )}
      </div>

      {/* ── Action bottom sheet ── */}
      {showActionMenu && mode === 'הפקה' && (
        <div className="fixed inset-0 z-[67] flex items-end bg-black/40" dir="rtl"
          onClick={() => setShowActionMenu(false)}>
          <div className="w-full bg-white rounded-t-2xl shadow-2xl p-4 pb-8 space-y-1"
            onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
            {[
              { label: '📅 קבע פגישה',          action: () => setShowMeetingModal(true) },
              { label: 'הצעת מחיר',             action: () => setShowPriceOffer(true) },
              { label: 'חוזה',                  action: () => setShowContract(true) },
              { label: '+ צור מסמך פיננסי',     action: () => setShowInvoice(true) },
              { label: 'שלח לינק לביקורות',     action: openReviewModal },
            ].map(({ label, action }) => (
              <button key={label}
                onClick={() => { setShowActionMenu(false); action(); }}
                className="w-full text-right px-4 py-3 rounded-xl text-sm font-bold text-slate-800 hover:bg-slate-100 transition">
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Review link modal ── */}
      {showReviewModal && (
        <div className="fixed inset-0 z-[68] flex items-end bg-black/40" dir="rtl"
          onClick={() => setShowReviewModal(false)}>
          <div className="w-full bg-white rounded-t-2xl shadow-2xl p-5 pb-8 space-y-4"
            onClick={e => e.stopPropagation()}>
            <h3 className="font-black text-slate-800 text-base">שלח לינק לביקורת</h3>
            <textarea
              value={reviewMsg}
              onChange={e => setReviewMsg(e.target.value)}
              rows={5}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400 resize-none"
            />
            <div className="flex gap-3">
              <button onClick={() => sendReviewLink('whatsapp')}
                disabled={!reviewMsg.trim() || !!reviewSending || !lead.phone}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-green-600 hover:bg-green-700 disabled:opacity-40 transition">
                {reviewSending === 'whatsapp' ? '...' : 'שלח ב-WhatsApp'}
              </button>
              <button onClick={() => sendReviewLink('email')}
                disabled={!reviewMsg.trim() || !!reviewSending || !lead.email}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-40 transition">
                {reviewSending === 'email' ? '...' : 'שלח במייל'}
              </button>
            </div>
            {!lead.phone && <p className="text-xs text-red-400 text-center">אין מספר טלפון בליד</p>}
            {!lead.email && <p className="text-xs text-slate-400 text-center">אין אימייל בליד — לא ניתן לשלוח מייל</p>}
          </div>
        </div>
      )}

      {showMeetingModal && (
        <ScheduleMeetingModal
          lead={lead}
          leadId={leadId}
          allPhones={allPhones}
          allPhoneLabels={allPhoneLabels}
          onClose={() => setShowMeetingModal(false)}
          onDone={() => { setShowMeetingModal(false); load(); onUpdated(); }}
        />
      )}

      {showPriceOffer && (
        <PriceOfferModal
          lead={lead}
          allEmails={allEmails}
          allPhones={allPhones}
          allPhoneLabels={allPhoneLabels}
          allEmailLabels={allEmailLabels}
          onClose={() => setShowPriceOffer(false)}
          onSaved={() => { setShowPriceOffer(false); load(); }}
        />
      )}

      {showContract && (
        <ContractModal
          lead={lead}
          allEmails={allEmails}
          allPhones={allPhones}
          allPhoneLabels={allPhoneLabels}
          allEmailLabels={allEmailLabels}
          onClose={() => setShowContract(false)}
          onSaved={() => { setShowContract(false); load(); }}
        />
      )}

      {showLostModal && <LostModal onClose={() => setShowLostModal(false)} onConfirm={markLost} />}

      {showBrief && (
        <EventBriefModal leadId={leadId} onClose={() => setShowBrief(false)} />
      )}

      {showSeating && (
        <SeatingChart leadId={leadId} onClose={() => setShowSeating(false)} />
      )}

      {showInvoice && lead && (
        <InvoiceModal
          lead={lead}
          allPhones={allPhones}
          allPhoneLabels={allPhoneLabels}
          onClose={() => setShowInvoice(false)}
          onCreated={() => { load(); refreshPendingDocs(); }}
        />
      )}

      {selectedDoc && (
        <PendingDocDetail
          doc={selectedDoc}
          isManager={isManager}
          onClose={() => setSelectedDoc(null)}
          onActionDone={refreshPendingDocs}
        />
      )}

      {showAddTask && (
        <AddTaskModal
          leadId={leadId} users={users}
          defaultAssignedTo={taskDefaultAssignee}
          onClose={() => { setShowAddTask(false); setTaskDefaultAssignee(null); }}
          onSaved={() => { setShowAddTask(false); setTaskDefaultAssignee(null); load(); onUpdated(); }}
        />
      )}

      {taskAction && (
        <TaskActionModal
          task={taskAction}
          leadId={leadId}
          lead={lead}
          users={users}
          allPhones={allPhones}
          allPhoneLabels={allPhoneLabels}
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
function FilesSection({ leadId, files, onChanged, isAdmin }) {
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
            {(isAdmin || f.file_type !== 'contract') && (
              <button onClick={() => deleteFile(f.id)}
                className="shrink-0 text-slate-400 hover:text-red-500 transition text-sm font-medium px-2 py-1 rounded-lg hover:bg-red-50 border border-transparent hover:border-red-200">
                🗑️
              </button>
            )}
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
  const isMediaPlaceholder = /^\[.+Message\]$/.test(text);
  return (
    <div>
      {text.trim() && !isMediaPlaceholder && <p className="text-base text-slate-700 whitespace-pre-wrap">{text.trim()}</p>}
      {isMediaPlaceholder && !files.length && <span className="text-sm text-slate-400 italic">📎 קובץ</span>}
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

/* ── PRICE OFFER MODAL ── */
function EditableCell({ value, onChange, multiline, dir: cellDir }) {
  const [editing, setEditing] = useState(false);
  const commit = () => setEditing(false);
  const style = { cursor: 'pointer', padding: '1px 2px', display: 'inline' };
  const inputStyle = { border: '1px solid #6366f1', borderRadius: 4, padding: '2px 6px', fontSize: 'inherit', fontFamily: 'inherit', width: '100%', direction: cellDir || 'rtl' };
  if (editing) {
    if (multiline) return <textarea autoFocus value={value} onChange={e => onChange(e.target.value)} onBlur={commit}
      style={{ ...inputStyle, resize: 'none', minHeight: 40 }} rows={2} />;
    return <input autoFocus value={value} onChange={e => onChange(e.target.value)}
      onBlur={commit} onKeyDown={e => e.key === 'Enter' && commit()} style={inputStyle} />;
  }
  const _v = value ? value.replace(/ /g, ' ') : ' ';
  return <span dir={cellDir || 'rtl'} onClick={() => setEditing(true)} style={style}>{cellDir !== 'ltr' && value ? '‫' + _v + '‬' : _v}</span>;
}


function ContractModal({ lead, allEmails, allPhones, allPhoneLabels, allEmailLabels = {}, onClose, onSaved }) {
  const fmtNum = n => Number(n || 0).toLocaleString('he-IL');

  const FIELD_DEFS = [
    { key: 'clientName',      label: 'לכבוד',                     type: 'text'   },
    { key: 'clientEmail',     label: 'מייל',                       type: 'email'  },
    { key: 'clientPhone',     label: 'טלפון',                      type: 'tel'    },
    { key: 'eventDate',       label: 'תאריך האירוע',               type: 'date'   },
    { key: 'startTime',       label: 'שעת כניסה',                  type: 'time'   },
    { key: 'endTime',         label: 'שעת סיום האירוע',            type: 'time'   },
    { key: 'guests',          label: 'מינימום אורחים',             type: 'number' },
    { key: 'extraGuestPrice', label: 'מחיר לאורח נוסף (אופציונלי)', type: 'number' },
    { key: 'chefMenu',        label: 'תפריט שף',                   type: 'text'   },
    { key: 'barMenu',         label: 'תפריט בר',                   type: 'text'   },
    { key: 'depositPercent',  label: 'אחוז מקדמה (%)',             type: 'number' },
  ];
  const FIELD_STEPS = FIELD_DEFS.length; // 11
  const ROW_START   = 12;

  const PKG_FIELD_DEFS = [
    { key: 'clientName',             label: 'לכבוד',                          type: 'text'   },
    { key: 'clientEmail',            label: 'מייל',                           type: 'email'  },
    { key: 'clientPhone',            label: 'טלפון',                          type: 'tel'    },
    { key: 'eventDate',              label: 'תאריך האירוע',                   type: 'date'   },
    { key: 'startTime',              label: 'שעת כניסה',                      type: 'time'   },
    { key: 'endTime',                label: 'שעת סיום האירוע',                type: 'time'   },
    { key: 'packageGuests',          label: 'מינימום אורחים בחבילה',          type: 'number' },
    { key: 'packageTotal',           label: 'מחיר החבילה כולל מע"מ (₪)',      type: 'number' },
    { key: 'packageExtraGuestPrice', label: 'מחיר אורח נוסף כולל מע"מ (₪)',  type: 'number' },
    { key: 'chefMenu',               label: 'תפריט שף',                       type: 'text'   },
    { key: 'barMenu',                label: 'תפריט בר',                       type: 'text'   },
    { key: 'depositPercent',         label: 'אחוז מקדמה (%)',                 type: 'number' },
  ];

  const DEFAULT_ROWS = [
    { id: 1, label: 'מחיר אורח',                             desc: 'כולל שכירות המקום, תפריט קייטרינג, תפריט בר', qty: 0, price: 395 },
    { id: 2, label: 'שירות מלצרים',                          desc: '',        qty: 1, price: 500 },
    { id: 3, label: 'שירות ברמנים',                          desc: '',        qty: 1, price: 550 },
    { id: 4, label: 'מנהל אירוע / קייטרינג שירות',           desc: 'שירות',   qty: 1, price: 900 },
    { id: 5, label: 'תאורה והגברה + תפעול לאורך האירוע',     desc: '',        qty: 1, price: 0   },
  ];

  const [step, setStep]               = useState(0);
  const [fields, setFields]           = useState({
    clientName:      lead.name  || '',
    clientEmail:     allEmails[0] || '',
    clientPhone:     lead.phone || '',
    eventDate:       lead.event_date ? lead.event_date.slice(0, 10) : '',
    startTime:       lead.event_time || '',
    endTime:         lead.event_end_time || '',
    guests:                 lead.guest_count || '',
    extraGuestPrice:        '',
    chefMenu:               '',
    barMenu:                '',
    depositPercent:         '30',
    packageGuests:          '',
    packageTotal:           '',
    packageExtraGuestPrice: '',
  });
  const [contractType, setContractType] = useState(null); // null | 'regular' | 'package'
  const [newInclude, setNewInclude]       = useState('');
  const [newCancellation, setNewCancellation] = useState('');
  const [newObligation, setNewObligation]     = useState('');
  const [newPaymentExtra, setNewPaymentExtra] = useState('');
  const [rows, setRows]               = useState(DEFAULT_ROWS);
  const [loadingImport, setLoadingImport] = useState(false);
  const [latestContract,   setLatestContract]   = useState(undefined);
  const [latestPriceOffer, setLatestPriceOffer] = useState(undefined);
  const [newRow, setNewRow]           = useState({ label: '', desc: '', qty: 1, price: 0, isPct: false, pct: 0 });
  const [sending, setSending]         = useState('');
  const [sent, setSent]               = useState(false);
  const [signingUrl, setSigningUrl]   = useState('');
  const [sentChannel, setSentChannel] = useState('');
  const [contractExtraFiles, setContractExtraFiles] = useState([]);
  const [contractSendStep, setContractSendStep] = useState(null); // null | 'wa' | 'email'
  const [contractDrivePicker, setContractDrivePicker] = useState(false);
  const [waPhone, setWaPhone] = useState(allPhones?.[0] || lead?.phone || '');
  const contractFileRef = useRef(null);

  const [contractTexts, setContractTexts] = useState({
    title: 'הסכם הזמנת אירוע',
    whereas1: 'הואיל: והספק הינו המחזיק הבלעדי והמפעיל של מתחם אירועים "שרביה" הנמצא בישוב תל אביב- יפו (להלן: "אולם אירועים");',
    whereas2: 'והואיל: וברצון המזמין להזמין מאת הספק שירותיו והכל כפי שיפורט בהסכם זה;',
    therefore: 'לפיכך הוסכם והותנה בין הצדדים:',
    preamble: 'המבוא להסכם זה וכל הנספחים, בין המצורפים במועד חתימת הסכם זה ובין שיצורפו אליו בעתיד, מהווים חלק בלתי נפרד הימנו.',
    includesHeader: 'המחיר כולל בתוכו:',
    includes: [
      'צוות הקמה', 'צוות תפעול', 'מנהל אירוע וליווי לאורך התהליך',
      'מלצרים', 'ברמנים + מנהל בר',
      'תפריט שף', 'תפריט בר',
      'אבטחה', 'צוות ניקיון',
      'מקרן להקרנה על הקיר (לא כולל מחשב וכבל HDMI)',
      "במה והקמת עמדת די ג'י", 'מיקרופון',
      'מערכת הגברה ותאורה כולל תפעול לאורך כל האירוע',
      'עיצוב המקום - שולחנות אבירים עם מפות לבנות, כדי נוי דקורטיבים, פינות ישיבה אלטרנטיביות כולל ספות, שולחנות בר גבוהים, שולחנות נמוכים, חביות יין עתיקות',
    ],
    paymentHeader: 'תנאי תשלום:',
    depositLine: 'במעמד חתימת הסכם זה תינתן מקדמה על-סך',
    depositAmtLabel:    null,
    depositPctLabel:    null,
    depositSuffix: 'לא כולל מע"מ. סה"כ כולל מע"מ',
    depositAmtVatLabel: null,
    remainderLine: 'ביום האירוע, לפני תחילת האירוע יש לשלם את יתרת הסכום על סך',
    remainderAmtLabel:  null,
    remainderSuffix: 'כולל מע"מ',
    checkNote: "לחלופין - ניתן להביא צ'ק ביטחון של הסכום הנ\"ל בתחילת האירוע.",
    paymentNote: 'חשוב לציין כי ללא הנ"ל מנהל האירוע לא יתחיל ויקיים את האירוע!',
    cancellationHeader: 'ביטול האירוע:',
    cancellationItems: [
      'במקרה של אי אישור לעריכת אירועים של פיקוד העורף/כוח עליון שאינו מאפשר לקיים את האירוע — הסכימו הצדדים על דחיית מועד האירוע למועד אחר עד לתאריך',
      'במקרה של ביטול תוך פחות מחודשיים ממועד האירוע – יחויב המזמין בדמי ביטול של 50% מהסכום הכולל.',
      'במקרה של ביטול תוך פחות מחודש ועד שבוע ממועד האירוע – יחויב המזמין בדמי ביטול של 75% מהסכום הכולל.',
      'במקרה של ביטול תוך פחות משבוע ממועד האירוע – יחויב המזמין בדמי ביטול מלאים.',
    ],
    obligationsHeader: 'ההתחייבויות והצהרות הצדדים:',
    obligations: [
      'האולם על חלקיו ישמש ללקוח לקיום האירוע. הספק מתחייב לאפשר למזמין עריכת האירוע באולם ובמועד כפי שפורטו לעיל.',
      'הספק יעמיד את האולם לרשות המזמין כשהוא נקי, ומסודר.',
      'המזמין מצהיר כי הובאו לידיעתו שעות בהן מתקיימים האירועים והוא מסכים לכך, כי האירוע יתקיים בין שעות הפעילות המפורטות לעיל בלבד.',
      'המזמין מצהיר כי הינו אחראי הבלעדי למעשיו ו/או למעשי נותני השירות שהוזמנו על ידו, למעט נותני השירות המפורטים ברשימת המומלצים של הספק.',
      'בנוסף המזמין אחראי על פי דין למעשי אורחיו וכי הוא יפצה את הספק לאחר פסק דין חלוט בגין כל נזק שיגרם ממעשה ו/או ממחדל של כל אחד מהנ"ל.',
      'מובהר בזאת, כי הספק אינו אחראי על שום ציוד ו/או חפצים אישיים, אשר נשכחו על ידי מי מטעם המזמין במתחם האולם.',
      'ידוע למזמין כי לא ניתן להשתמש בזיקוקים מכל סוג שהוא בכל שטח האתר, לרבות בחניה וכן לא ניתן להשתמש בקישוטים מתפזרים כדוגמת קונפטי וכדומה.',
      'עוצמת המוזיקה המתנגנת באירוע לא תעלה על המותר בחוק.',
      'המזמין יודע, מסכים, מאשר ומבין כי באולם האירועים יש הוראה חד משמעית כי אסור לעשן בתוכו בהתאם לחוק איסור עישון במקומות ציבוריים וכי יש בגן פינות עישון מיועדת לכך.',
      'באחריות הלקוח לשלם לאקו"ם באתר הבית.',
    ],
    legalParagraphs: [
      'למען הסר ספק, אם לא התייצב המזמין לביצוע התחשבנות כאמור בסעיף זה, יהא רשאי הספק לפעול בכל הדרכים הנתונות לו על פי החוק והדין לשם גביית סכום האירוע.',
      'המזמין עיין ובדק את מלוא התנאים המצוינים בהסכם זה והוא הסכים לכל סעיפיו. כל שינוי, תוספת או גריעה מהסכם זה, לא יהיה להם כל תוקף או נפקות, אלא אם כן נעשו בכתב ונחתמו ע"י שני הצדדים להסכם זה.',
      'הצדדים מצהירים במפורש כי אין בהסכם זה כדי ליצור בין הצדדים יחסי סוכנות ו/או שליחות ו/או שותפות מכל מין וסוג שהוא.',
      'שום ויתור, הנחה, היימנעות מפעולה בזמנה, או מתן ארכה, לא יחשבו כוויתור של צד מהצדדים להסכם זה על זכות מזכויותיו.',
    ],
    paymentExtras: [],
  });
  const setTxt = (key, val) => setContractTexts(t => ({ ...t, [key]: val }));
  const setInc = (i, val) => setContractTexts(t => ({ ...t, includes: t.includes.map((v,j) => j===i ? val : v) }));
  const setCancelItem = (i, val) => setContractTexts(t => ({ ...t, cancellationItems: t.cancellationItems.map((v,j) => j===i ? val : v) }));
  const setObligation = (i, val) => setContractTexts(t => ({ ...t, obligations: t.obligations.map((v,j) => j===i ? val : v) }));
  const setLegalPara = (i, val) => setContractTexts(t => ({ ...t, legalParagraphs: t.legalParagraphs.map((v,j) => j===i ? val : v) }));

  function addContractInclude() {
    if (!newInclude.trim()) return;
    setContractTexts(t => ({ ...t, includes: [...t.includes, newInclude.trim()] }));
    setNewInclude('');
  }
  function addCancellationItem() {
    if (!newCancellation.trim()) return;
    setContractTexts(t => ({ ...t, cancellationItems: [...t.cancellationItems, newCancellation.trim()] }));
    setNewCancellation('');
  }
  function addObligationItem() {
    if (!newObligation.trim()) return;
    setContractTexts(t => ({ ...t, obligations: [...t.obligations, newObligation.trim()] }));
    setNewObligation('');
  }
  function addPaymentExtra() {
    if (!newPaymentExtra.trim()) return;
    setContractTexts(t => ({ ...t, paymentExtras: [...(t.paymentExtras || []), newPaymentExtra.trim()] }));
    setNewPaymentExtra('');
  }

  const setField = (k, v) => setFields(f => ({ ...f, [k]: v }));

  // Step calculations
  const isPackage          = contractType === 'package';
  const ACTIVE_FIELD_DEFS  = isPackage ? PKG_FIELD_DEFS : FIELD_DEFS;
  const ACTIVE_FIELD_STEPS = ACTIVE_FIELD_DEFS.length;

  const addRowStep        = ROW_START + rows.length;
  const PKG_INCLUDES_STEP = ACTIVE_FIELD_STEPS + 1;
  const previewStep         = isPackage ? ACTIVE_FIELD_STEPS + 2 : addRowStep + 2;

  const isImportStep        = contractType !== null && step === 0;
  const isFieldStep         = contractType !== null && step >= 1 && step <= ACTIVE_FIELD_STEPS;
  const isRowStep           = !isPackage && step >= ROW_START && step < addRowStep;
  const isAddRowStep        = !isPackage && step === addRowStep;
  const isRegIncludesStep   = !isPackage && step === addRowStep + 1;
  const isPkgIncludesStep   = isPackage && step === PKG_INCLUDES_STEP;
  const isPreviewStep     = contractType !== null && step === previewStep;

  const currentDef = isFieldStep ? ACTIVE_FIELD_DEFS[step - 1] : null;
  const currentRow = isRowStep   ? rows[step - ROW_START] : null;
  const totalSteps = previewStep;
  const progressPct = Math.min(100, Math.round((step / (totalSteps || 1)) * 100));

  // Calculated values
  const pkgTotal           = Number(fields.packageTotal) || 0;
  const cFixedSubtotal     = isPackage
    ? Math.round(pkgTotal / 1.18)
    : rows.filter(r => !r.isPct).reduce((s, r) => s + (r.qty || 0) * (r.price || 0), 0);
  const cGetRowTotal       = (r) => r.isPct ? Math.round(cFixedSubtotal * (r.pct || 0) / 100) : (r.qty || 0) * (r.price || 0);
  const subtotal           = isPackage ? Math.round(pkgTotal / 1.18) : rows.reduce((s, r) => s + cGetRowTotal(r), 0);
  const vat                = isPackage ? pkgTotal - subtotal : Math.round(subtotal * 0.18);
  const total              = isPackage ? pkgTotal : subtotal + vat;
  const depositPct       = Number(fields.depositPercent) || 0;
  const depositAmount    = Math.round(subtotal * depositPct / 100);
  const depositAmountVat = Math.round(depositAmount * 1.18);
  const remainingBalance = total - depositAmountVat;
  const cancellationDate = fields.eventDate
    ? (() => { const d = new Date(fields.eventDate + 'T12:00:00'); d.setMonth(d.getMonth() + 6); return d.toLocaleDateString('he-IL'); })()
    : '';

  async function handleSelectType(type) {
    setContractType(type);
    setLoadingImport(true);
    const [cRes, oRes] = await Promise.allSettled([
      api.get(`/leads/${lead.id}/contracts/latest?type=${type}`),
      api.get(`/leads/${lead.id}/price-offer/latest`),
    ]);
    const contract = cRes.status === 'fulfilled' ? cRes.value.data : null;
    const offer    = oRes.status === 'fulfilled' ? oRes.value.data : null;
    setLatestContract(contract);
    setLatestPriceOffer(offer);
    setLoadingImport(false);
    if (!contract && !offer) setStep(1);
  }

  function handleImportFromOffer() {
    const data = latestPriceOffer;
    if (!data) return;
    const f = data.fields || {};
    if (isPackage) {
      setFields(prev => ({
        ...prev,
        clientName:             f.name                    || '',
        clientEmail:            f.email                   || '',
        clientPhone:            f.phone                   || '',
        startTime:              f.doorTime                || '',
        endTime:                f.endTime                 || '',
        packageGuests:          f.packageGuests          != null ? String(f.packageGuests)          : '',
        packageTotal:           f.packagePrice           != null ? String(f.packagePrice)           : '',
        packageExtraGuestPrice: f.packageExtraGuestPrice != null ? String(f.packageExtraGuestPrice) : '',
        chefMenu:               f.chefMenu               || '',
        barMenu:                f.barMenu                || '',
      }));
    } else {
      setFields(prev => ({
        ...prev,
        clientName:      f.name            || '',
        clientEmail:     f.email           || '',
        clientPhone:     f.phone           || '',
        startTime:       f.doorTime        || '',
        endTime:         f.endTime         || '',
        guests:          f.guests          != null ? String(f.guests)          : '',
        extraGuestPrice: f.extraGuestPrice != null ? String(f.extraGuestPrice) : '',
        chefMenu:        f.chefMenu        || '',
        barMenu:         f.barMenu         || '',
      }));
      if (data.rows?.length) setRows(data.rows);
    }
    if (data.includes?.length) setContractTexts(t => ({ ...t, includes: data.includes }));
    setStep(1);
  }

  function handleImportFromContract() {
    const data = latestContract;
    if (!data) return;
    if (data.fields) setFields(prev => ({ ...prev, ...data.fields }));
    if (!isPackage && data.rows?.length) setRows(data.rows);
    if (data.texts) setContractTexts(data.texts);
    setStep(1);
  }

  async function handleSend(channel) {
    setSending(channel);
    setContractSendStep(null);
    try {
      const calculated = { subtotal, vat, total, depositAmount, depositAmountVat, remainingBalance, cancellationDate };
      const { data } = await api.post(`/leads/${lead.id}/contracts`, {
        contract_data: { fields, rows, calculated, texts: contractTexts, offerType: contractType },
      });
      const url = `${window.location.origin}/sign/${data.token}`;
      setSigningUrl(url);

      const msg = `שלום ${fields.clientName},\n\nמצורף קישור לחוזה לחתימה דיגיטלית:\n${url}\n\nבברכה, צוות שרביה`;
      if (channel === 'email') {
        const fd = new FormData();
        fd.append('to', fields.clientEmail);
        fd.append('subject', `חוזה לחתימה — ${fields.clientName} — שרביה`);
        fd.append('body', msg);
        const driveIds = [];
        for (const att of contractExtraFiles) {
          if (att.type === 'local') fd.append('files', att.file);
          else driveIds.push(att.fileId);
        }
        if (driveIds.length) fd.append('driveFileIds', JSON.stringify(driveIds));
        await api.post(`/leads/${lead.id}/email/send`, fd);
      } else {
        await api.post('/whatsapp/send', { leadId: lead.id, message: msg, phone: waPhone });
        for (let i = 0; i < contractExtraFiles.length; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const att = contractExtraFiles[i];
          const fd = new FormData();
          fd.append('leadId', lead.id);
          fd.append('message', '');
          fd.append('phone', waPhone);
          if (att.type === 'local') fd.append('file', att.file);
          else fd.append('driveFileId', att.fileId);
          await api.post('/whatsapp/send-file', fd);
        }
      }
      const stageOrder = ['new','contacted','meeting_scheduled','meeting','offer_sent','negotiation','contract_sent','deposit','production','completed'];
      if (stageOrder.indexOf(lead.stage) < stageOrder.indexOf('contract_sent')) {
        await api.patch(`/leads/${lead.id}`, { stage: 'contract_sent' });
      }
      setSentChannel(channel);
      setSent(true);
    } catch (err) {
      alert('שגיאה בשליחה: ' + (err.response?.data?.error || err.message));
    } finally {
      setSending('');
    }
  }

  const cls = 'w-full rounded-xl px-3 py-3 text-sm border border-violet-200 focus:border-violet-400 focus:outline-none text-slate-700 bg-white';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">

        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
          <h2 className="font-bold text-lg text-slate-800">חוזה לחתימה</h2>
        </div>

        {contractType !== null && (
          <div className="h-1 bg-slate-100 shrink-0">
            <div className="h-1 bg-violet-500 transition-all duration-300" style={{ width: `${progressPct}%` }} />
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5">

          {/* Type selection */}
          {contractType === null && (
            <div className="flex flex-col items-center gap-4 py-8">
              <p className="font-bold text-slate-700 text-base">בחר סוג חוזה</p>
              <button onClick={() => handleSelectType('regular')}
                className="w-full max-w-xs py-4 rounded-2xl font-black text-sm text-white"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
                חוזה רגיל
              </button>
              <button onClick={() => handleSelectType('package')}
                className="w-full max-w-xs py-4 rounded-2xl font-black text-sm border-2 border-violet-400 text-violet-700 bg-white">
                חוזה חבילה
              </button>
            </div>
          )}

          {/* Field steps */}
          {isFieldStep && currentDef && (
            <div className="space-y-4">
              <p className="text-base font-bold text-slate-700">{currentDef.label}</p>
              {currentDef.type === 'date' ? (
                <PickerDateInput value={fields[currentDef.key]} onChange={v => setField(currentDef.key, v)} className={cls} />
              ) : currentDef.type === 'time' ? (
                <PickerTimeInput value={fields[currentDef.key]} onChange={v => setField(currentDef.key, v)} className={cls} />
              ) : (
                <input
                  type={currentDef.type}
                  value={fields[currentDef.key]}
                  onChange={e => setField(currentDef.key, e.target.value)}
                  className={cls}
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && setStep(s => s + 1)}
                />
              )}
            </div>
          )}

          {/* Import step (step 0) */}
          {isImportStep && (
            <div className="flex flex-col items-center gap-4 py-6">
              {loadingImport ? (
                <p className="text-slate-500 text-sm">טוען...</p>
              ) : (
                <div className="text-center">
                  <p className="font-bold text-slate-700 mb-1">לייבא פרטים?</p>
                  <p className="text-xs text-slate-400 mb-5">פרטי לקוח, תאריך, שעות, תפריטים ועלויות ימולאו אוטומטית</p>
                  <div className="flex flex-wrap gap-3 justify-center">
                    {latestContract && (
                      <button onClick={handleImportFromContract}
                        className="px-6 py-2.5 rounded-xl font-bold text-sm text-white"
                        style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
                        ייבא מחוזה אחרון
                      </button>
                    )}
                    {latestPriceOffer && (
                      <button onClick={handleImportFromOffer}
                        className="px-6 py-2.5 rounded-xl font-bold text-sm text-white"
                        style={{ background: 'linear-gradient(135deg, #06b6d4, #3b82f6)' }}>
                        ייבא מהצעת מחיר
                      </button>
                    )}
                    <button onClick={() => setStep(1)}
                      className="px-6 py-2.5 rounded-xl font-bold text-sm border border-slate-200 text-slate-600">
                      לא
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Row step */}
          {isRowStep && currentRow && (
            <div className="space-y-3">
              <p className="font-bold text-slate-700">{currentRow.label}</p>
              {currentRow.desc && <p className="text-xs text-slate-400">{currentRow.desc}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-500 mb-1 block">כמות</label>
                  <input type="number" min="0" value={currentRow.qty}
                    onChange={e => setRows(rs => rs.map(r => r.id === currentRow.id ? { ...r, qty: Number(e.target.value) } : r))}
                    className={cls} autoFocus
                    onKeyDown={e => e.key === 'Enter' && setStep(s => s + 1)} />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 mb-1 block">מחיר ליחידה (ש"ח)</label>
                  <input type="number" min="0" value={currentRow.price}
                    onChange={e => setRows(rs => rs.map(r => r.id === currentRow.id ? { ...r, price: Number(e.target.value) } : r))}
                    className={cls}
                    onKeyDown={e => e.key === 'Enter' && setStep(s => s + 1)} />
                </div>
              </div>
            </div>
          )}

          {/* Add row step */}
          {isAddRowStep && (
            <div className="space-y-3">
              <p className="font-bold text-slate-700">הוסף שורת תמחור (אופציונלי)</p>
              <input placeholder="שם פריט" value={newRow.label} onChange={e => setNewRow(r => ({ ...r, label: e.target.value }))} className={cls} />
              <input placeholder="תיאור (אופציונלי)" value={newRow.desc} onChange={e => setNewRow(r => ({ ...r, desc: e.target.value }))} className={cls} />
              <div className="flex gap-1 p-1 rounded-xl bg-slate-100">
                <button onClick={() => setNewRow(r => ({ ...r, isPct: false }))}
                  className={`flex-1 py-1.5 rounded-lg font-bold text-xs transition ${!newRow.isPct ? 'bg-violet-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}>
                  מחיר בש"ח
                </button>
                <button onClick={() => setNewRow(r => ({ ...r, isPct: true }))}
                  className={`flex-1 py-1.5 rounded-lg font-bold text-xs transition ${newRow.isPct ? 'bg-violet-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}>
                  מחיר באחוזים
                </button>
              </div>
              {newRow.isPct ? (
                <input type="number" placeholder="אחוזים %" min="0" value={newRow.pct} onChange={e => setNewRow(r => ({ ...r, pct: Number(e.target.value) }))} className={cls} />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <input type="number" placeholder="כמות" min="0" value={newRow.qty} onChange={e => setNewRow(r => ({ ...r, qty: Number(e.target.value) }))} className={cls} />
                  <input type="number" placeholder="מחיר" min="0" value={newRow.price} onChange={e => setNewRow(r => ({ ...r, price: Number(e.target.value) }))} className={cls} />
                </div>
              )}
              {newRow.label.trim() && (
                <button onClick={() => {
                  setRows(rs => [...rs, { ...newRow, id: Date.now() }]);
                  setNewRow({ label: '', desc: '', qty: 1, price: 0, isPct: false, pct: 0 });
                }} className="text-sm font-bold text-violet-600 underline">+ הוסף שורה</button>
              )}
            </div>
          )}

          {/* Regular contract: includes editing step */}
          {isRegIncludesStep && (
            <div className="space-y-3">
              <p className="font-bold text-slate-700">המחיר כולל בתוכו:</p>
              <ul className="space-y-1.5">
                {contractTexts.includes.map((item, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-sm bg-slate-50 rounded-lg px-3 py-1.5">
                    <span className="flex-1">{item}</span>
                    <button type="button" onClick={() => setContractTexts(t => ({
                      ...t, includes: t.includes.filter((_, j) => j !== i)
                    }))} className="text-red-400 hover:text-red-600 text-xs font-bold">הסר</button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2 pt-1">
                <input
                  value={newInclude}
                  onChange={e => setNewInclude(e.target.value)}
                  placeholder="הוסף פריט (למשל: די ג'יי)"
                  className={cls}
                  onKeyDown={e => { if (e.key === 'Enter' && newInclude.trim()) { setContractTexts(t => ({ ...t, includes: [...t.includes, newInclude.trim()] })); setNewInclude(''); } }}
                />
                <button type="button" onClick={() => {
                  if (!newInclude.trim()) return;
                  setContractTexts(t => ({ ...t, includes: [...t.includes, newInclude.trim()] }));
                  setNewInclude('');
                }} className="px-4 py-2 rounded-xl bg-violet-100 text-violet-700 text-sm font-bold whitespace-nowrap">הוסף</button>
              </div>
            </div>
          )}

          {/* Package includes editing step */}
          {isPkgIncludesStep && (
            <div className="space-y-3">
              <p className="font-bold text-slate-700">המחיר כולל בתוכו:</p>
              <ul className="space-y-1.5">
                {contractTexts.includes.map((item, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-sm bg-slate-50 rounded-lg px-3 py-1.5">
                    <span className="flex-1">{item}</span>
                    <button type="button" onClick={() => setContractTexts(t => ({
                      ...t, includes: t.includes.filter((_, j) => j !== i)
                    }))} className="text-red-400 hover:text-red-600 text-xs font-bold">הסר</button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2 pt-1">
                <input
                  value={newInclude}
                  onChange={e => setNewInclude(e.target.value)}
                  placeholder="הוסף פריט (למשל: די ג'יי)"
                  className={cls}
                  onKeyDown={e => { if (e.key === 'Enter' && newInclude.trim()) { setContractTexts(t => ({ ...t, includes: [...t.includes, newInclude.trim()] })); setNewInclude(''); } }}
                />
                <button type="button" onClick={() => {
                  if (!newInclude.trim()) return;
                  setContractTexts(t => ({ ...t, includes: [...t.includes, newInclude.trim()] }));
                  setNewInclude('');
                }} className="px-4 py-2 rounded-xl bg-violet-100 text-violet-700 text-sm font-bold whitespace-nowrap">הוסף</button>
              </div>
            </div>
          )}

          {/* Preview step — full editable contract document */}
          {isPreviewStep && !sent && (
            <div>
              <p className="text-xs text-slate-400 text-center mb-3">לחץ על כל טקסט לעריכה</p>
              <div dir="rtl" style={{ fontFamily: 'Arial, sans-serif', fontSize: '10pt', color: '#222', background: '#fff', padding: '10px', lineHeight: 1.8 }}>

                <div style={{ textAlign: 'center', marginBottom: 8 }}>
                  <img src="/logo.jpg" alt="" style={{ height: 60, objectFit: 'contain' }} />
                </div>

                <h2 style={{ textAlign: 'center', fontSize: '14pt', fontWeight: 'bold', marginBottom: 8 }}>
                  <EditableCell value={contractTexts.title} onChange={v => setTxt('title', v)} />
                </h2>

                <p>שנערך ונחתם ביום ___ לאירוע בתאריך {fields.eventDate ? new Date(fields.eventDate + 'T12:00:00').toLocaleDateString('he-IL') : '___'}</p>
                <p>‫בין:‬ ___ &nbsp;&nbsp;&nbsp; ‫ת.ז\ח.פ:‬ ___</p>
                <p style={{ textAlign: 'left' }}>מצד אחד;</p>
                <p>לבין:</p>
                <p>שרביה, מספר שותפות 558450383</p>
                <p>מרח' שמעון הצדיק 18 תל אביב.</p>
                <p style={{ textAlign: 'left', marginBottom: 8 }}>מצד שני;</p>

                <p><EditableCell value={contractTexts.whereas1} onChange={v => setTxt('whereas1', v)} multiline /></p>
                <p><EditableCell value={contractTexts.whereas2} onChange={v => setTxt('whereas2', v)} multiline /></p>
                <p style={{ marginBottom: 8 }}><EditableCell value={contractTexts.therefore} onChange={v => setTxt('therefore', v)} /></p>
                <p style={{ marginBottom: 10 }}><EditableCell value={contractTexts.preamble} onChange={v => setTxt('preamble', v)} multiline /></p>

                <h3 style={{ fontWeight: 'bold', marginTop: 8 }}>האירוע:</h3>
                <p>תאריך אירוע: <EditableCell value={fields.eventDate ? new Date(fields.eventDate + 'T12:00:00').toLocaleDateString('he-IL') : ''} onChange={v => setField('eventDate', v)} /></p>
                <p>אולם אירועים: שרביה ברחוב רבי פנחס בן יאיר 3 תל-אביב יפו</p>
                <p>שעת התחלה: <EditableCell value={fields.startTime} onChange={v => setField('startTime', v)} /></p>
                <p>שעת סיום האירוע: <EditableCell value={fields.endTime} onChange={v => setField('endTime', v)} /></p>

                <h3 style={{ fontWeight: 'bold', marginTop: 10, marginBottom: 4 }}>עלויות:</h3>

                {isPackage ? (
                  <div style={{ marginBottom: 8 }}>
                    <p>עלות החבילה עבור <EditableCell value={String(fields.packageGuests || '')} onChange={v => setField('packageGuests', v)} /> אורחים - <EditableCell value={String(fields.packageTotal || '')} onChange={v => setField('packageTotal', v)} /> ש"ח כולל מע"מ</p>
                    {Number(fields.packageExtraGuestPrice) > 0 && (
                      <p>כל אורח נוסף מעל {fields.packageGuests} אורחים בתוספת של <EditableCell value={String(fields.packageExtraGuestPrice || '')} onChange={v => setField('packageExtraGuestPrice', v)} /> ש"ח כולל מע"מ</p>
                    )}
                  </div>
                ) : (
                  <>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt' }}>
                  <thead>
                    <tr style={{ background: '#f5f5f5' }}>
                      {['שם הפריט', 'תיאור', 'כמות', 'מחיר', 'סה"כ לפני מע"מ'].map(h => (
                        <th key={h} style={{ border: '1px solid #ccc', padding: '4px 6px', textAlign: 'center' }}>{h}</th>
                      ))}
                      <th style={{ border: '1px solid #ccc', padding: '4px 6px', width: 20 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={row.id}>
                        <td style={{ border: '1px solid #ccc', padding: '4px 6px' }}>
                          <EditableCell value={row.label} onChange={v => setRows(rs => rs.map(r => r.id === row.id ? { ...r, label: v } : r))} />
                        </td>
                        <td style={{ border: '1px solid #ccc', padding: '4px 6px', fontSize: '8pt', color: '#555' }}>
                          <EditableCell value={row.desc || ''} onChange={v => setRows(rs => rs.map(r => r.id === row.id ? { ...r, desc: v } : r))} />
                        </td>
                        <td style={{ border: '1px solid #ccc', padding: '4px 6px', textAlign: 'center' }}>
                          {row.isPct ? '-' : <EditableCell value={String(row.qty)} onChange={v => setRows(rs => rs.map(r => r.id === row.id ? { ...r, qty: parseFloat(v) || 0 } : r))} />}
                        </td>
                        <td style={{ border: '1px solid #ccc', padding: '4px 6px', textAlign: 'center' }}>
                          {row.isPct
                            ? `${row.pct || 0}%`
                            : <><EditableCell value={String(row.price)} onChange={v => setRows(rs => rs.map(r => r.id === row.id ? { ...r, price: parseFloat(v) || 0 } : r))} />{' ש"ח'}</>}
                        </td>
                        <td style={{ border: '1px solid #ccc', padding: '4px 6px', textAlign: 'center' }}>
                          {cGetRowTotal(row).toLocaleString()}{' ש"ח'}
                        </td>
                        <td style={{ border: '1px solid #ccc', padding: '2px', textAlign: 'center' }}>
                          <button onClick={() => setRows(rs => rs.filter((_, idx) => idx !== i))}
                            style={{ color: '#ef4444', fontWeight: 'bold', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }}>✕</button>
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={4} style={{ border: '1px solid #ccc', padding: '4px 6px', textAlign: 'right', fontWeight: 'bold' }}>‫סה"כ חייב במע"מ:‬</td>
                      <td colSpan={2} style={{ border: '1px solid #ccc', padding: '4px 6px', textAlign: 'center', fontWeight: 'bold' }}>{subtotal.toLocaleString()} ש"ח</td>
                    </tr>
                    <tr>
                      <td colSpan={4} style={{ border: '1px solid #ccc', padding: '4px 6px', textAlign: 'right' }}>‫מע"מ (18%):‬</td>
                      <td colSpan={2} style={{ border: '1px solid #ccc', padding: '4px 6px', textAlign: 'center' }}>{vat.toLocaleString()} ש"ח</td>
                    </tr>
                    <tr style={{ fontWeight: 'bold' }}>
                      <td colSpan={4} style={{ border: '1px solid #ccc', padding: '4px 6px', textAlign: 'right' }}>‫סה"כ לתשלום:‬</td>
                      <td colSpan={2} style={{ border: '1px solid #ccc', padding: '4px 6px', textAlign: 'center' }}>{total.toLocaleString()} ש"ח</td>
                    </tr>
                  </tbody>
                </table>

                <p style={{ marginTop: 8 }}>
                  הסכם זה עבור קיום אירוע עם מינימום{' '}
                  <EditableCell value={String(fields.guests || '')} onChange={v => setField('guests', v)} />{' '}אורחים
                </p>
                {fields.extraGuestPrice && Number(fields.extraGuestPrice) > 0 && (
                  <p>כל אורח מעל {fields.guests} אורחים בעלות של {Number(fields.extraGuestPrice).toLocaleString()} ש"ח לא כולל מע"מ</p>
                )}
                  </>
                )}

                <h3 style={{ fontWeight: 'bold', marginTop: 10, marginBottom: 4 }}>
                  <EditableCell value={contractTexts.includesHeader} onChange={v => setTxt('includesHeader', v)} />
                </h3>
                <ul style={{ paddingRight: 16, lineHeight: 1.8 }}>
                  {contractTexts.includes.map((item, i) => (
                    <li key={i}>
                      {i === 5 ? (
                        <><EditableCell value={item} onChange={v => setInc(i, v)} />{fields.chefMenu ? <>{' '}<EditableCell value={fields.chefMenu} onChange={v => setField('chefMenu', v)} /></> : null}</>
                      ) : i === 6 ? (
                        <><EditableCell value={item} onChange={v => setInc(i, v)} />{fields.barMenu ? <>{' '}<EditableCell value={fields.barMenu} onChange={v => setField('barMenu', v)} /></> : null}</>
                      ) : (
                        <EditableCell value={item} onChange={v => setInc(i, v)} multiline />
                      )}
                    </li>
                  ))}
                </ul>
                <div data-html2canvas-ignore="true" style={{ marginTop: '4pt', display: 'flex', gap: '6px' }}>
                  <input value={newInclude} onChange={e => setNewInclude(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addContractInclude()}
                    placeholder="הוסף פריט..."
                    style={{ flex: 1, border: '1px solid #ccc', borderRadius: '6px', padding: '2px 6px', fontSize: '9pt', direction: 'rtl' }} />
                  <button onClick={addContractInclude} disabled={!newInclude.trim()}
                    style={{ border: '1px solid #f59e0b', color: '#b45309', borderRadius: '6px', padding: '2px 8px', fontSize: '9pt', background: 'none', cursor: 'pointer', opacity: newInclude.trim() ? 1 : 0.4 }}>
                    + הוסף
                  </button>
                </div>

                <h3 style={{ fontWeight: 'bold', marginTop: 10, marginBottom: 4 }}>
                  <EditableCell value={contractTexts.paymentHeader} onChange={v => setTxt('paymentHeader', v)} />
                </h3>
                <p>
                  <EditableCell value={contractTexts.depositLine} onChange={v => setTxt('depositLine', v)} multiline />{' '}
                  <strong>
                    <EditableCell value={contractTexts.depositAmtLabel ?? `${fmtNum(depositAmount)} ש"ח`} onChange={v => setTxt('depositAmtLabel', v)} />{' '}
                    <EditableCell value={contractTexts.depositPctLabel ?? `(${fields.depositPercent}%)`} onChange={v => setTxt('depositPctLabel', v)} />
                  </strong>{' '}
                  <EditableCell value={contractTexts.depositSuffix} onChange={v => setTxt('depositSuffix', v)} />{' '}
                  <strong>
                    <EditableCell value={contractTexts.depositAmtVatLabel ?? `${fmtNum(depositAmountVat)} ש"ח`} onChange={v => setTxt('depositAmtVatLabel', v)} />
                  </strong>
                </p>
                <p>
                  <EditableCell value={contractTexts.remainderLine} onChange={v => setTxt('remainderLine', v)} multiline />{' '}
                  <strong>
                    <EditableCell value={contractTexts.remainderAmtLabel ?? `${fmtNum(remainingBalance)} ש"ח`} onChange={v => setTxt('remainderAmtLabel', v)} />{' '}
                    <EditableCell value={contractTexts.remainderSuffix} onChange={v => setTxt('remainderSuffix', v)} />
                  </strong>
                </p>
                <p><EditableCell value={contractTexts.checkNote} onChange={v => setTxt('checkNote', v)} multiline /></p>
                <p><EditableCell value={contractTexts.paymentNote} onChange={v => setTxt('paymentNote', v)} multiline /></p>
                {(contractTexts.paymentExtras || []).map((line, i) => (
                  <p key={i}><EditableCell value={line} onChange={v => setContractTexts(t => ({ ...t, paymentExtras: t.paymentExtras.map((x, j) => j === i ? v : x) }))} multiline /></p>
                ))}
                <div data-html2canvas-ignore="true" style={{ marginTop: '4pt', display: 'flex', gap: '6px' }}>
                  <input value={newPaymentExtra} onChange={e => setNewPaymentExtra(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addPaymentExtra()}
                    placeholder="הוסף שורה..."
                    style={{ flex: 1, border: '1px solid #ccc', borderRadius: '6px', padding: '2px 6px', fontSize: '9pt', direction: 'rtl' }} />
                  <button onClick={addPaymentExtra} disabled={!newPaymentExtra.trim()}
                    style={{ border: '1px solid #f59e0b', color: '#b45309', borderRadius: '6px', padding: '2px 8px', fontSize: '9pt', background: 'none', cursor: 'pointer', opacity: newPaymentExtra.trim() ? 1 : 0.4 }}>
                    + הוסף
                  </button>
                </div>

                <h3 style={{ fontWeight: 'bold', marginTop: 10, marginBottom: 4 }}>
                  <EditableCell value={contractTexts.cancellationHeader} onChange={v => setTxt('cancellationHeader', v)} />
                </h3>
                <ul style={{ paddingRight: 16, lineHeight: 1.8 }}>
                  {contractTexts.cancellationItems.map((item, i) => (
                    <li key={i}>
                      <EditableCell value={item} onChange={v => setCancelItem(i, v)} multiline />
                      {i === 0 && cancellationDate ? <strong> {cancellationDate}</strong> : null}
                    </li>
                  ))}
                </ul>
                <div data-html2canvas-ignore="true" style={{ marginTop: '4pt', display: 'flex', gap: '6px' }}>
                  <input value={newCancellation} onChange={e => setNewCancellation(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addCancellationItem()}
                    placeholder="הוסף שורה..."
                    style={{ flex: 1, border: '1px solid #ccc', borderRadius: '6px', padding: '2px 6px', fontSize: '9pt', direction: 'rtl' }} />
                  <button onClick={addCancellationItem} disabled={!newCancellation.trim()}
                    style={{ border: '1px solid #f59e0b', color: '#b45309', borderRadius: '6px', padding: '2px 8px', fontSize: '9pt', background: 'none', cursor: 'pointer', opacity: newCancellation.trim() ? 1 : 0.4 }}>
                    + הוסף
                  </button>
                </div>

                <h3 style={{ fontWeight: 'bold', marginTop: 10, marginBottom: 4 }}>
                  <EditableCell value={contractTexts.obligationsHeader} onChange={v => setTxt('obligationsHeader', v)} />
                </h3>
                <ul style={{ paddingRight: 16, lineHeight: 1.8 }}>
                  {contractTexts.obligations.map((item, i) => (
                    <li key={i}><EditableCell value={item} onChange={v => setObligation(i, v)} multiline /></li>
                  ))}
                </ul>
                <div data-html2canvas-ignore="true" style={{ marginTop: '4pt', display: 'flex', gap: '6px' }}>
                  <input value={newObligation} onChange={e => setNewObligation(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addObligationItem()}
                    placeholder="הוסף שורה..."
                    style={{ flex: 1, border: '1px solid #ccc', borderRadius: '6px', padding: '2px 6px', fontSize: '9pt', direction: 'rtl' }} />
                  <button onClick={addObligationItem} disabled={!newObligation.trim()}
                    style={{ border: '1px solid #f59e0b', color: '#b45309', borderRadius: '6px', padding: '2px 8px', fontSize: '9pt', background: 'none', cursor: 'pointer', opacity: newObligation.trim() ? 1 : 0.4 }}>
                    + הוסף
                  </button>
                </div>

                {contractTexts.legalParagraphs.map((para, i) => (
                  <p key={i} style={{ marginTop: 6 }}>
                    <EditableCell value={para} onChange={v => setLegalPara(i, v)} multiline />
                  </p>
                ))}

                <p style={{ marginTop: 12, fontWeight: 'bold' }}>לראיה באו הצדדים על החתום:</p>
                <p>שם המזמין: ___</p>
                <table style={{ width: '100%', marginTop: 16 }}>
                  <tbody><tr>
                    <td style={{ width: '50%', textAlign: 'center', paddingTop: 8 }}>
                      <div style={{ borderTop: '1px solid #333', paddingTop: 4 }}>המזמין</div>
                    </td>
                    <td style={{ width: '50%', textAlign: 'center', paddingTop: 8 }}>
                      <div style={{ borderTop: '1px solid #333', paddingTop: 4 }}>הספק</div>
                    </td>
                  </tr></tbody>
                </table>
              </div>
            </div>
          )}

          {/* Sent state */}
          {isPreviewStep && sent && (
            <div className="space-y-4 text-center">
              <p className="text-3xl">✅</p>
              <p className="font-bold text-slate-800">החוזה נשלח לחתימה!</p>
              <p className="text-xs text-slate-500">
                {sentChannel === 'email' ? `נשלח לאימייל: ${fields.clientEmail}` : `נשלח ב-WhatsApp ל: ${fields.clientPhone}`}
              </p>
              <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-600 break-all">{signingUrl}</div>
              <button onClick={() => { navigator.clipboard.writeText(signingUrl); }}
                className="text-sm font-bold text-violet-600 underline">העתק קישור</button>
            </div>
          )}
        </div>

        {/* Footer */}
        {contractType !== null && !isImportStep && <div className="border-t border-slate-100 p-4 shrink-0">
          {sent ? (
            <button onClick={() => { onSaved(); onClose(); }}
              className="w-full py-2.5 rounded-xl font-black text-sm text-white"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
              סגור
            </button>
          ) : contractSendStep ? (
            <div className="space-y-2">
              {contractSendStep === 'whatsapp' && allPhones?.length > 1 && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 block">שלח לנייד:</label>
                  {allPhones.map(p => (
                    <label key={p} className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                      <input type="radio" name="contractWaPhone" value={p}
                        checked={waPhone === p} onChange={() => setWaPhone(p)} />
                      {allPhoneLabels?.[p] ? `${allPhoneLabels[p]} (${p})` : p}
                    </label>
                  ))}
                </div>
              )}
              {contractSendStep === 'email' && allEmails?.length > 1 && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 block">שלח לאימייל:</label>
                  {allEmails.map(e => (
                    <label key={e} className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                      <input type="radio" name="contractEmail" value={e}
                        checked={fields.clientEmail === e} onChange={() => setFields(f => ({ ...f, clientEmail: e }))} />
                      {allEmailLabels?.[e] ? `${allEmailLabels[e]} (${e})` : e}
                    </label>
                  ))}
                </div>
              )}
              <p className="text-sm font-bold text-slate-700">קבצים נוספים (אופציונלי)</p>
              <input ref={contractFileRef} type="file" className="hidden" onChange={e => { const f = e.target.files[0]; if (f) { setContractExtraFiles(a => [...a, { type: 'local', file: f }]); e.target.value = ''; } }} />
              <div className="flex gap-2">
                <button onClick={() => contractFileRef.current.click()}
                  className="flex-1 border-2 border-dashed rounded-xl py-2 text-xs font-semibold text-center transition border-slate-200 text-slate-400 hover:border-violet-300 hover:text-violet-600">
                  + מהמחשב
                </button>
                <button onClick={() => setContractDrivePicker(true)}
                  className="flex-1 border-2 border-dashed rounded-xl py-2 text-xs font-semibold text-center transition border-slate-200 text-slate-400 hover:border-violet-300 hover:text-violet-600">
                  מ-Google Drive
                </button>
              </div>
              {contractExtraFiles.length > 0 && (
                <div className="space-y-1">
                  {contractExtraFiles.map((att, i) => (
                    <div key={i} className="flex items-center justify-between bg-violet-50 border border-violet-200 rounded-lg px-2.5 py-1.5 text-xs">
                      <span className="truncate text-violet-800">📎 {att.type === 'local' ? att.file.name : att.name}</span>
                      <button onClick={() => setContractExtraFiles(a => a.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 mr-1 shrink-0">&times;</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => { setContractSendStep(null); setContractExtraFiles([]); }} className="flex-1 border-2 border-slate-200 text-slate-500 font-bold py-2 rounded-xl text-sm">ביטול</button>
                <button onClick={() => handleSend(contractSendStep)} disabled={!!sending}
                  className={`flex-1 py-2.5 rounded-xl font-black text-sm text-white disabled:opacity-50 ${contractSendStep === 'whatsapp' ? 'bg-green-600' : 'bg-sky-600'}`}>
                  {sending ? 'שולח...' : 'שלח'}
                </button>
              </div>
            </div>
          ) : isPreviewStep ? (
            <div className="flex gap-2">
              <button onClick={() => setStep(s => s - 1)}
                className="px-4 py-2.5 rounded-xl font-bold text-sm border border-slate-200 text-slate-600">
                חזור
              </button>
              <button onClick={() => { setContractExtraFiles([]); setContractSendStep('whatsapp'); }} disabled={!!sending || !fields.clientPhone}
                className="flex-1 py-2.5 rounded-xl font-black text-sm bg-green-600 text-white disabled:opacity-50">
                {sending === 'whatsapp' ? 'שולח...' : 'וואטסאפ'}
              </button>
              <button onClick={() => { setContractExtraFiles([]); setContractSendStep('email'); }} disabled={!!sending || !fields.clientEmail}
                className="flex-1 py-2.5 rounded-xl font-black text-sm bg-sky-600 text-white disabled:opacity-50">
                {sending === 'email' ? 'שולח...' : 'אימייל'}
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setStep(s => s + 1)}
                className="flex-1 py-2.5 rounded-xl font-black text-sm text-white"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
                {isAddRowStep ? 'המשך ללא הוספה' : isRegIncludesStep ? 'המשך לתצוגה מקדימה' : 'הבא'}
              </button>
              {step > 0 && (
                <button onClick={() => setStep(s => s - 1)}
                  className="px-4 py-2.5 rounded-xl font-bold text-sm border border-slate-200 text-slate-600">
                  חזור
                </button>
              )}
            </div>
          )}
        </div>}
      </div>
      {contractDrivePicker && (
        <DriveFilePicker
          onSelect={files => setContractExtraFiles(a => [...a, ...files])}
          onClose={() => setContractDrivePicker(false)}
        />
      )}
    </div>
  );
}

function PriceOfferModal({ lead, allEmails, allPhones, allPhoneLabels, allEmailLabels = {}, onClose, onSaved }) {
  const FIELD_STEPS = 10;
  const FIELD_DEFS = [
    { key: 'name',      label: 'לכבוד',                type: 'text' },
    { key: 'email',     label: 'מייל',                  type: 'email' },
    { key: 'phone',     label: 'טלפון',                 type: 'tel' },
    { key: 'eventDate', label: 'תאריך האירוע',          type: 'text' },
    { key: 'doorTime',  label: 'שעת פתיחת דלתות',       type: 'time' },
    { key: 'endTime',   label: 'שעת סיום האירוע',        type: 'time' },
    { key: 'guests',    label: 'מספר אורחים (מינימום)', type: 'number' },
    { key: 'chefMenu',  label: 'תפריט שף',              type: 'text' },
    { key: 'barMenu',   label: 'תפריט בר',              type: 'text' },
    { key: 'notes',    label: 'הערות',               type: 'textarea' },
  ];

  const PACKAGE_FIELD_DEFS = [
    { key: 'name',      label: 'לכבוד',              type: 'text' },
    { key: 'email',     label: 'מייל',                type: 'email' },
    { key: 'phone',     label: 'טלפון',               type: 'tel' },
    { key: 'eventDate', label: 'תאריך האירוע',        type: 'text' },
    { key: 'doorTime',  label: 'שעת פתיחת דלתות',     type: 'time' },
    { key: 'endTime',   label: 'שעת סיום האירוע',      type: 'time' },
    { key: 'notes',     label: 'הערות',               type: 'textarea' },
  ];
  const PACKAGE_FIELD_STEPS = PACKAGE_FIELD_DEFS.length; // 7

  const [step, setStep]           = useState(0);
  const [offerType, setOfferType] = useState(''); // '' | 'regular' | 'package'
  const [editMode, setEditMode]   = useState(false);
  const [vatAnswered, setVatAnswered] = useState(false);
  const [withVat, setWithVat]         = useState(true);
  const [fields, setFields]   = useState({
    name: lead.name || '', email: allEmails[0] || '', phone: lead.phone || '',
    eventDate: lead.event_date_text || '', doorTime: lead.event_time || '',
    endTime: lead.event_end_time || '', guests: '', chefMenu: '', barMenu: '', notes: '', extraGuestPrice: '',
    packagePrice: '', packageGuests: '', packageExtraGuestPrice: '',
  });
  const [rows, setRows] = useState([
    { id: 1, label: 'מחיר אורח', desc: 'כולל שכירות המקום, תפריט קייטרינג, תפריט בר', qty: 0, price: 395 },
    { id: 2, label: 'שירות מלצרים', desc: '', qty: 1, price: 500 },
    { id: 3, label: 'שירות ברמנים', desc: '', qty: 1, price: 550 },
    { id: 4, label: 'מנהל אירוע / קייטרינג שירות', desc: '', qty: 1, price: 900 },
    { id: 5, label: 'תאורה והגברה + תפעול לאורך האירוע', desc: '', qty: 1, price: 0 },
  ]);
  const [newRow, setNewRow]         = useState({ label: '', desc: '', qty: 1, price: 0, isPct: false, pct: 0 });
  const [newInclude, setNewInclude] = useState('');
  const [newExtra, setNewExtra]     = useState('');
  const [newPkgLine, setNewPkgLine] = useState('');
  const [saving, setSaving]     = useState(false);
  const [sending, setSending]   = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailTo, setEmailTo]     = useState(allEmails[0] || '');
  const [emailSubject, setEmailSubject] = useState(`הצעת מחיר - ${lead.name} - שרביה`);
  const [emailBody, setEmailBody] = useState(`שלום ${lead.name},\nמצורפת הצעת המחיר שלנו לאירוע שלך.\nנשמח לראותכם, צוות שרביה.`);
  const [offerExtraFiles, setOfferExtraFiles] = useState([]);
  const [showWaExtraFiles, setShowWaExtraFiles] = useState(false);
  const [offerDrivePicker, setOfferDrivePicker] = useState(null); // 'wa' | 'email' | null
  const [waPhone, setWaPhone] = useState(allPhones?.[0] || lead?.phone || '');
  const offerFileRef = useRef(null);
  const previewRef = useRef(null);
  const [texts, setTexts] = useState({
    title:          'הצעת מחיר – אירוע בשרביה',
    arrival:        'כניסה לאירוע: דרך רחוב פנחס בן יאיר 3, תל אביב יפו',
    venueDescHeader: 'מפרט מקום:',
    venueDescIntro:  'הגלריה שלנו מורכבת מכמה מתחמים',
    venueDescItems: [
      'חלל לואי ה-16: חלל מהמם עם קירות אבן חשופים, מעוצב בקפדנות עם ריהוט עתיק באווירה יפואית קסומה, מתאים לכל סוג אירוע.',
      'חלל לואי ה-17: חלל נוסף באותו ניחוח עיצובי המאובזר במערכות סאונד משודרגות לקיום רחבת ריקודים. גם כן יכול לשמש לכל סוג אירוע.',
      'חלק חיצוני: החלק החיצוני יושב על המדרחוב הציורי בשוק היווני. האזור מתוחם ופרטי למשתתפי האירוע. מאפשר מקומות ישיבה, ספות מעוצבות וכולל שמשיות, מערכת מוזיקה ואיוורור / גופי חימום להתאמה לעונות החורף והקיץ.',
    ],
    costsHeader:    'עלויות:',
    tableHeaders:   ['שם הפריט', 'תיאור', 'כמות', 'מחיר', 'סה"כ לפני מע"מ'],
    includesHeader: 'המחיר כולל בתוכו:',
    includes: [
      'שכירות האולם',
      'צוות הקמה',
      'צוות תפעול',
      'תפריט שף',
      'תפריט בר',
      'אבטחה',
      'צוות נקיון',
      'מקרן להקרנה על מסך (לא כולל מחשב וכבל HDMI)',
      'במה והקמת עמדת די גיי',
      'מיקרופון',
      'עיצוב המקום - שולחנות אבירים עם מפות לבנות, כדי נוי דקורטיבים, פינות ישיבה אלטרנטיבות כולל ספות, שולחנות בר גבוהים, שולחנות נמוכים, חביות יין עתיקות, שטיחים מפוארים',
    ],
    extrasHeader:    'תוספות (אופציונלי):',
    extras: [
      'דיג׳יי: 5,500 ש"ח לא כולל מע"מ',
      'צלם סטילס + היילייטס: 5,500 ש"ח לא כולל מע"מ',
      'בר קוקטיילים של האלכימאי (לשעתיים בקבלת פנים): 4,500 ש"ח לא כולל מע"מ',
      'חניות: 40 ש"ח לרכב (יש הסדר חניה עם חניון "חצרות יפו". שעת סגירת החניון ב- 24:00. במידה והאירוע התארך לאחר השעה 24:00, על בעל האירוע לשלם 100 שקלים על כל שעה נוספת לשומר החניון)',
    ],
    packageCostLines: [],
    minGuestsPrefix: 'הצעת מחיר זו הינה עבור קיום אירוע עם מינימום',
    minGuestsSuffix: 'אורחים',
    payment:  'תנאי תשלום: מקדמה 30% והיתרה לתשלום ביום האירוע לפני תחילת האירוע.',
    validity: 'הצעה זו תקפה ל 3 ימים.',
    closing:  'נשמח לראותכם, צוות שרביה',
  });
  const setTxt = (k, v) => setTexts(t => ({ ...t, [k]: v }));
  const setInc = (i, v) => setTexts(t => ({ ...t, includes: t.includes.map((x, j) => j === i ? v : x) }));
  const setExt = (i, v) => setTexts(t => ({ ...t, extras: t.extras.map((x, j) => j === i ? v : x) }));
  const setTh  = (i, v) => setTexts(t => ({ ...t, tableHeaders: t.tableHeaders.map((x, j) => j === i ? v : x) }));
  const setVenueDesc = (i, v) => setTexts(t => ({ ...t, venueDescItems: t.venueDescItems.map((x, j) => j === i ? v : x) }));
  const setPkgLine   = (i, v) => setTexts(t => ({ ...t, packageCostLines: t.packageCostLines.map((x, j) => j === i ? v : x) }));

  // Sync מחיר אורח qty with guests count
  useEffect(() => {
    const g = parseInt(fields.guests) || 0;
    setRows(prev => prev.map(r => r.id === 1 ? { ...r, qty: g } : r));
  }, [fields.guests]);

  // Regular offer step constants
  const EXTRA_GUEST_STEP = FIELD_STEPS;
  const ADD_INCLUDE_STEP = FIELD_STEPS + 1;
  const ROW_START        = FIELD_STEPS + 2;
  const addRowStep  = ROW_START + rows.length;
  const previewStep = addRowStep + 1;

  // Package offer step constants
  const PKG_PRICE_STEP       = PACKAGE_FIELD_STEPS;
  const PKG_GUESTS_STEP      = PACKAGE_FIELD_STEPS + 1;
  const PKG_EXTRA_STEP       = PACKAGE_FIELD_STEPS + 2;
  const PKG_CHEF_STEP        = PACKAGE_FIELD_STEPS + 3;
  const PKG_BAR_STEP         = PACKAGE_FIELD_STEPS + 4;
  const PKG_ADD_INCLUDE_STEP = PACKAGE_FIELD_STEPS + 5;
  const PKG_PREVIEW_STEP     = PACKAGE_FIELD_STEPS + 6;

  const isFieldStep          = offerType === 'regular' ? step < FIELD_STEPS : step < PACKAGE_FIELD_STEPS;
  const isExtraGuestStep     = offerType === 'regular' && step === EXTRA_GUEST_STEP;
  const isAddIncludeStep     = offerType === 'regular' && step === ADD_INCLUDE_STEP;
  const isRowStep            = offerType === 'regular' && step >= ROW_START && step < addRowStep;
  const isAddRowStep         = offerType === 'regular' && step === addRowStep;
  const isPkgPriceStep       = offerType === 'package' && step === PKG_PRICE_STEP;
  const isPkgGuestsStep      = offerType === 'package' && step === PKG_GUESTS_STEP;
  const isPkgExtraStep       = offerType === 'package' && step === PKG_EXTRA_STEP;
  const isPkgChefStep        = offerType === 'package' && step === PKG_CHEF_STEP;
  const isPkgBarStep         = offerType === 'package' && step === PKG_BAR_STEP;
  const isPkgAddIncludeStep  = offerType === 'package' && step === PKG_ADD_INCLUDE_STEP;
  const isPreviewStep        = offerType === 'regular' ? step === previewStep : step === PKG_PREVIEW_STEP;

  const fixedSubtotal = rows.filter(r => !r.isPct).reduce((s, r) => s + r.qty * r.price, 0);
  const getRowTotal   = (r) => r.isPct ? Math.round(fixedSubtotal * (r.pct || 0) / 100) : r.qty * r.price;
  const subtotal      = rows.reduce((s, r) => s + getRowTotal(r), 0);
  const vat           = withVat ? Math.round(subtotal * 0.18) : 0;
  const total         = subtotal + vat;

  const advance = () => { setEditMode(false); setStep(s => s + 1); };
  const back    = () => { setEditMode(false); setStep(s => Math.max(0, s - 1)); };

  function deleteCurrentRow() {
    const idx = step - ROW_START;
    const next = rows.filter((_, i) => i !== idx);
    setRows(next);
    setEditMode(false);
    if (idx >= next.length) setStep(ROW_START + next.length);
  }

  function addIncludeItem() {
    if (!newInclude.trim()) return;
    setTexts(t => ({ ...t, includes: [...t.includes, newInclude.trim()] }));
    setNewInclude('');
  }

  function addExtrasItem() {
    if (!newExtra.trim()) return;
    setTexts(t => ({ ...t, extras: [...t.extras, newExtra.trim()] }));
    setNewExtra('');
  }

  function addPkgLine() {
    if (!newPkgLine.trim()) return;
    setTexts(t => ({ ...t, packageCostLines: [...t.packageCostLines, newPkgLine.trim()] }));
    setNewPkgLine('');
  }

  useEffect(() => {
    if (!isPreviewStep || offerType !== 'package' || texts.packageCostLines.length > 0) return;
    const vatLabel = withVat ? 'כולל מע"מ' : 'לא כולל מע"מ';
    const lines = [];
    if (fields.packageGuests && fields.packagePrice)
      lines.push(`עלות החבילה עבור ${fields.packageGuests} אורחים - ${Number(fields.packagePrice).toLocaleString()} ש"ח ${vatLabel}`);
    if (fields.packageGuests && fields.packageExtraGuestPrice)
      lines.push(`כל אורח נוסף מעל ${fields.packageGuests} אורחים בתוספת של - ${Number(fields.packageExtraGuestPrice).toLocaleString()} ש"ח ${vatLabel}`);
    if (lines.length) setTexts(t => ({ ...t, packageCostLines: lines }));
  }, [isPreviewStep]);

  function addNewRow() {
    if (!newRow.label.trim()) return;
    const nextId = Math.max(0, ...rows.map(r => r.id)) + 1;
    const row = newRow.isPct
      ? { ...newRow, id: nextId, pct: parseFloat(newRow.pct) || 0 }
      : { ...newRow, id: nextId, qty: parseFloat(newRow.qty) || 0, price: parseFloat(newRow.price) || 0 };
    setRows(prev => [...prev, row]);
    setNewRow({ label: '', desc: '', qty: 1, price: 0, isPct: false, pct: 0 });
    setStep(s => s + 1);
  }

  function updateRow(idx, patch) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  async function generateBlob() {
    const res = await api.post(
      `/leads/${lead.id}/price-offer`,
      { fields: { ...fields, withVat }, rows, texts, offerType },
      { responseType: 'blob' }
    );
    return res.data;
  }

  async function handleSave() {
    setSaving(true);
    try {
      const blob = await generateBlob();
      const fd = new FormData();
      fd.append('file', blob, `הצעת מחיר - ${fields.name}.pdf`);
      await api.post(`/leads/${lead.id}/files`, fd);
      onSaved(); onClose();
    } catch { alert('שגיאה בשמירת הקובץ'); setSaving(false); }
  }

  async function handleSendWA() {
    setSending(true);
    setShowWaExtraFiles(false);
    try {
      const blob = await generateBlob();
      const fd1 = new FormData();
      fd1.append('leadId', lead.id);
      fd1.append('file', blob, `הצעת מחיר - ${fields.name}.pdf`);
      fd1.append('message', 'הצעת המחיר שלנו עבור האירוע שלך');
      fd1.append('phone', waPhone);
      await api.post('/whatsapp/send-file', fd1);
      // send extra files with 2-second delay each
      for (let i = 0; i < offerExtraFiles.length; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const att = offerExtraFiles[i];
        const fd = new FormData();
        fd.append('leadId', lead.id);
        fd.append('message', '');
        fd.append('phone', waPhone);
        if (att.type === 'local') fd.append('file', att.file);
        else fd.append('driveFileId', att.fileId);
        await api.post('/whatsapp/send-file', fd);
      }
      const fd2 = new FormData();
      fd2.append('file', blob, `הצעת מחיר - ${fields.name}.pdf`);
      await api.post(`/leads/${lead.id}/files`, fd2);
      const stageOrder = ['new','contacted','meeting_scheduled','meeting','offer_sent','negotiation','contract_sent','deposit','production','completed'];
      if (stageOrder.indexOf(lead.stage) < stageOrder.indexOf('offer_sent')) {
        await api.patch(`/leads/${lead.id}`, { stage: 'offer_sent' });
      }
      onSaved(); onClose();
    } catch { alert('שגיאה בשליחה'); setSending(false); }
  }

  async function handleSendEmail() {
    setSending(true);
    try {
      const blob = await generateBlob();
      const fd = new FormData();
      fd.append('to', emailTo);
      fd.append('subject', emailSubject);
      fd.append('body', emailBody);
      fd.append('files', blob, `הצעת מחיר - ${fields.name}.pdf`);
      const driveIds = [];
      for (const att of offerExtraFiles) {
        if (att.type === 'local') fd.append('files', att.file);
        else driveIds.push(att.fileId);
      }
      if (driveIds.length) fd.append('driveFileIds', JSON.stringify(driveIds));
      await api.post(`/leads/${lead.id}/email/send`, fd);
      const stageOrder = ['new','contacted','meeting_scheduled','meeting','offer_sent','negotiation','contract_sent','deposit','production','completed'];
      if (stageOrder.indexOf(lead.stage) < stageOrder.indexOf('offer_sent')) {
        await api.patch(`/leads/${lead.id}`, { stage: 'offer_sent' });
      }
      onSaved(); onClose();
    } catch { alert('שגיאה בשליחת אימייל'); setSending(false); }
  }

  const totalSteps  = offerType === 'regular' ? previewStep : PKG_PREVIEW_STEP;
  const progressPct = isPreviewStep ? 100 : offerType === '' ? 0 : Math.round((step / totalSteps) * 100);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
          <h2 className="font-bold text-lg text-slate-800">הצעת מחיר</h2>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-slate-100 shrink-0">
          <div className="h-1 bg-amber-400 transition-all duration-300" style={{ width: `${progressPct}%` }} />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* ── VAT pre-step ── */}
          {offerType === '' && !vatAnswered && (
            <div className="space-y-4 text-center">
              <p className="font-black text-slate-700 text-lg">האם ההצעה כוללת מע"מ?</p>
              <button onClick={() => { setWithVat(true); setVatAnswered(true); }}
                className="w-full border-2 border-amber-300 text-amber-700 font-bold py-4 rounded-xl hover:bg-amber-50 text-lg">
                עם מע"מ (18%)
              </button>
              <button onClick={() => { setWithVat(false); setVatAnswered(true); }}
                className="w-full border-2 border-amber-300 text-amber-700 font-bold py-4 rounded-xl hover:bg-amber-50 text-lg">
                ללא מע"מ
              </button>
            </div>
          )}

          {/* ── Type selection ── */}
          {offerType === '' && vatAnswered && (
            <div className="space-y-4">
              <p className="text-slate-500 text-sm font-semibold text-center">בחר סוג הצעת מחיר</p>
              <button onClick={() => setOfferType('regular')}
                className="w-full border-2 border-amber-300 text-amber-700 font-bold py-4 rounded-xl hover:bg-amber-50 text-lg">
                הצעת מחיר רגילה
              </button>
              <button onClick={() => setOfferType('package')}
                className="w-full border-2 border-amber-300 text-amber-700 font-bold py-4 rounded-xl hover:bg-amber-50 text-lg">
                הצעת מחיר חבילה
              </button>
            </div>
          )}

          {/* ── Field step ── */}
          {isFieldStep && (() => {
            const def = (offerType === 'package' ? PACKAGE_FIELD_DEFS : FIELD_DEFS)[step];
            const val = fields[def.key];
            const isLtr = def.type === 'email' || def.type === 'tel';
            return (
              <div className="space-y-5">
                <p className="text-slate-400 text-sm font-semibold">{def.label}</p>
                {editMode ? (
                  def.type === 'textarea' ? (
                    <textarea autoFocus value={val}
                      onChange={e => setFields(f => ({ ...f, [def.key]: e.target.value }))}
                      rows={4} dir="rtl"
                      className="w-full border-2 border-amber-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-amber-500 resize-none" />
                  ) : (
                  <input autoFocus type={def.type} value={val}
                    onChange={e => setFields(f => ({ ...f, [def.key]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && advance()}
                    className="w-full border-2 border-amber-300 rounded-xl px-4 py-3 text-lg focus:outline-none focus:border-amber-500"
                    dir={isLtr ? 'ltr' : 'rtl'} />
                  )
                ) : (
                  <p className="text-2xl font-bold text-slate-800 py-1 min-h-[2.5rem]">{val || <span className="text-slate-300">(ריק)</span>}</p>
                )}
                <div className="flex gap-2 pt-1">
                  {step > 0 && <button onClick={back} className="border-2 border-slate-200 text-slate-500 font-bold py-2.5 px-4 rounded-xl">חזור</button>}
                  {!editMode && <button onClick={() => setEditMode(true)} className="border-2 border-amber-300 text-amber-600 font-bold py-2.5 px-4 rounded-xl hover:bg-amber-50">ערוך</button>}
                  <button onClick={advance} className="flex-1 bg-amber-500 text-white font-bold py-2.5 rounded-xl">המשך</button>
                </div>
              </div>
            );
          })()}

          {/* ── Extra guest cost step ── */}
          {isExtraGuestStep && (
            <div className="space-y-5">
              <p className="text-slate-400 text-sm font-semibold">עלות אורח נוסף</p>
              <input
                autoFocus type="number" value={fields.extraGuestPrice}
                onChange={e => setFields(f => ({ ...f, extraGuestPrice: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && advance()}
                placeholder="לדוגמה: 400"
                className="w-full border-2 border-amber-300 rounded-xl px-4 py-3 text-lg focus:outline-none focus:border-amber-500"
              />
              {withVat && fields.extraGuestPrice && Number(fields.extraGuestPrice) > 0 && (
                <p className="text-xs text-slate-400">= {Math.round(Number(fields.extraGuestPrice) / 1.18).toLocaleString()} ש"ח לפני מע"מ</p>
              )}
              <p className="text-xs text-slate-400">אופציונלי — אם לא רלוונטי, השאר ריק</p>
              <div className="flex gap-2">
                <button onClick={back} className="border-2 border-slate-200 text-slate-500 font-bold py-2.5 px-4 rounded-xl">חזור</button>
                <button onClick={advance} className="flex-1 bg-amber-500 text-white font-bold py-2.5 rounded-xl">המשך</button>
              </div>
            </div>
          )}

          {/* ── Add includes step ── */}
          {isAddIncludeStep && (
            <div className="space-y-4">
              <p className="text-slate-400 text-sm font-semibold">המחיר כולל בתוכו:</p>
              <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                {texts.includes.map((item, i) => {
                  if (!item.trim()) return null;
                  return (
                    <li key={i} className="flex items-center justify-between gap-2 text-sm bg-slate-50 rounded-lg px-3 py-1.5">
                      <span className="flex-1">{item}</span>
                      <button type="button" onClick={() => setTexts(t => ({ ...t, includes: t.includes.filter((_, j) => j !== i) }))}
                        className="text-red-400 hover:text-red-600 text-xs font-bold">הסר</button>
                    </li>
                  );
                })}
              </ul>
              <div className="flex gap-2">
                <input
                  value={newInclude}
                  onChange={e => setNewInclude(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addIncludeItem()}
                  placeholder="פריט חדש..."
                  className="flex-1 border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-amber-400"
                />
                <button onClick={addIncludeItem} disabled={!newInclude.trim()}
                  className="border-2 border-amber-300 text-amber-600 font-bold py-2 px-4 rounded-xl hover:bg-amber-50 disabled:opacity-40">
                  + הוסף
                </button>
              </div>
              <div className="flex gap-2">
                <button onClick={back} className="border-2 border-slate-200 text-slate-500 font-bold py-2.5 px-4 rounded-xl">חזור</button>
                <button onClick={advance} className="flex-1 bg-amber-500 text-white font-bold py-2.5 rounded-xl">המשך לעלויות</button>
              </div>
            </div>
          )}

          {/* ── Package: package price step ── */}
          {isPkgPriceStep && (
            <div className="space-y-5">
              <p className="text-slate-400 text-sm font-semibold">עלות החבילה ({withVat ? 'כולל מע"מ' : 'לא כולל מע"מ'})</p>
              <input
                autoFocus type="number" value={fields.packagePrice}
                onChange={e => setFields(f => ({ ...f, packagePrice: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && advance()}
                placeholder="לדוגמה: 50000"
                className="w-full border-2 border-amber-300 rounded-xl px-4 py-3 text-lg focus:outline-none focus:border-amber-500"
              />
              <div className="flex gap-2">
                <button onClick={back} className="border-2 border-slate-200 text-slate-500 font-bold py-2.5 px-4 rounded-xl">חזור</button>
                <button onClick={advance} className="flex-1 bg-amber-500 text-white font-bold py-2.5 rounded-xl">המשך</button>
              </div>
            </div>
          )}

          {/* ── Package: guests step ── */}
          {isPkgGuestsStep && (
            <div className="space-y-5">
              <p className="text-slate-400 text-sm font-semibold">כמות האורחים בחבילה</p>
              <input
                autoFocus type="number" value={fields.packageGuests}
                onChange={e => setFields(f => ({ ...f, packageGuests: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && advance()}
                placeholder="לדוגמה: 130"
                className="w-full border-2 border-amber-300 rounded-xl px-4 py-3 text-lg focus:outline-none focus:border-amber-500"
              />
              <div className="flex gap-2">
                <button onClick={back} className="border-2 border-slate-200 text-slate-500 font-bold py-2.5 px-4 rounded-xl">חזור</button>
                <button onClick={advance} className="flex-1 bg-amber-500 text-white font-bold py-2.5 rounded-xl">המשך</button>
              </div>
            </div>
          )}

          {/* ── Package: extra guest cost step ── */}
          {isPkgExtraStep && (
            <div className="space-y-5">
              <p className="text-slate-400 text-sm font-semibold">עלות אורח נוסף ({withVat ? 'כולל מע"מ' : 'לא כולל מע"מ'})</p>
              <input
                autoFocus type="number" value={fields.packageExtraGuestPrice}
                onChange={e => setFields(f => ({ ...f, packageExtraGuestPrice: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && advance()}
                placeholder="לדוגמה: 400"
                className="w-full border-2 border-amber-300 rounded-xl px-4 py-3 text-lg focus:outline-none focus:border-amber-500"
              />
              <p className="text-xs text-slate-400">אופציונלי — אם לא רלוונטי, השאר ריק</p>
              <div className="flex gap-2">
                <button onClick={back} className="border-2 border-slate-200 text-slate-500 font-bold py-2.5 px-4 rounded-xl">חזור</button>
                <button onClick={advance} className="flex-1 bg-amber-500 text-white font-bold py-2.5 rounded-xl">המשך</button>
              </div>
            </div>
          )}

          {/* ── Package: chef menu step ── */}
          {isPkgChefStep && (
            <div className="space-y-5">
              <p className="text-slate-400 text-sm font-semibold">תפריט שף</p>
              <input
                autoFocus type="text" value={fields.chefMenu}
                onChange={e => setFields(f => ({ ...f, chefMenu: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && advance()}
                placeholder="לדוגמה: תפריט ים תיכוני"
                className="w-full border-2 border-amber-300 rounded-xl px-4 py-3 text-lg focus:outline-none focus:border-amber-500"
              />
              <p className="text-xs text-slate-400">אופציונלי — אם לא רלוונטי, השאר ריק</p>
              <div className="flex gap-2">
                <button onClick={back} className="border-2 border-slate-200 text-slate-500 font-bold py-2.5 px-4 rounded-xl">חזור</button>
                <button onClick={advance} className="flex-1 bg-amber-500 text-white font-bold py-2.5 rounded-xl">המשך</button>
              </div>
            </div>
          )}

          {/* ── Package: bar menu step ── */}
          {isPkgBarStep && (
            <div className="space-y-5">
              <p className="text-slate-400 text-sm font-semibold">תפריט בר</p>
              <input
                autoFocus type="text" value={fields.barMenu}
                onChange={e => setFields(f => ({ ...f, barMenu: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && advance()}
                placeholder="לדוגמה: פתוח עם אלכוהול"
                className="w-full border-2 border-amber-300 rounded-xl px-4 py-3 text-lg focus:outline-none focus:border-amber-500"
              />
              <p className="text-xs text-slate-400">אופציונלי — אם לא רלוונטי, השאר ריק</p>
              <div className="flex gap-2">
                <button onClick={back} className="border-2 border-slate-200 text-slate-500 font-bold py-2.5 px-4 rounded-xl">חזור</button>
                <button onClick={advance} className="flex-1 bg-amber-500 text-white font-bold py-2.5 rounded-xl">המשך</button>
              </div>
            </div>
          )}

          {/* ── Package: add includes step ── */}
          {isPkgAddIncludeStep && (
            <div className="space-y-4">
              <p className="text-slate-400 text-sm font-semibold">המחיר כולל בתוכו:</p>
              <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                {texts.includes.map((item, i) => {
                  if (!item.trim()) return null;
                  return (
                    <li key={i} className="flex items-center justify-between gap-2 text-sm bg-slate-50 rounded-lg px-3 py-1.5">
                      <span className="flex-1">{item}</span>
                      <button type="button" onClick={() => setTexts(t => ({ ...t, includes: t.includes.filter((_, j) => j !== i) }))}
                        className="text-red-400 hover:text-red-600 text-xs font-bold">הסר</button>
                    </li>
                  );
                })}
              </ul>
              <div className="flex gap-2">
                <input
                  value={newInclude}
                  onChange={e => setNewInclude(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addIncludeItem()}
                  placeholder="פריט חדש..."
                  className="flex-1 border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-amber-400"
                />
                <button onClick={addIncludeItem} disabled={!newInclude.trim()}
                  className="border-2 border-amber-300 text-amber-600 font-bold py-2 px-4 rounded-xl hover:bg-amber-50 disabled:opacity-40">
                  + הוסף
                </button>
              </div>
              <div className="flex gap-2">
                <button onClick={back} className="border-2 border-slate-200 text-slate-500 font-bold py-2.5 px-4 rounded-xl">חזור</button>
                <button onClick={advance} className="flex-1 bg-amber-500 text-white font-bold py-2.5 rounded-xl">המשך לתצוגה מקדימה</button>
              </div>
            </div>
          )}

          {/* ── Row step ── */}
          {isRowStep && (() => {
            const rowIdx = step - ROW_START;
            const row = rows[rowIdx];
            if (!row) return null;
            return (
              <div className="space-y-5">
                <p className="text-slate-400 text-sm font-semibold">שורה בטבלת עלויות</p>
                {editMode ? (
                  <div className="space-y-2">
                    <input value={row.label} onChange={e => updateRow(rowIdx, { label: e.target.value })}
                      className="w-full border-2 border-amber-300 rounded-xl px-3 py-2 text-base focus:outline-none" placeholder="שם פריט" />
                    <input value={row.desc} onChange={e => updateRow(rowIdx, { desc: e.target.value })}
                      className="w-full border-2 border-amber-300 rounded-xl px-3 py-2 text-sm focus:outline-none text-slate-500" placeholder="תיאור (אופציונלי)" />
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <p className="text-xs text-slate-400 mb-1">כמות</p>
                        <input type="number" value={row.qty} onChange={e => updateRow(rowIdx, { qty: parseFloat(e.target.value) || 0 })}
                          className="w-full border-2 border-amber-300 rounded-xl px-3 py-2 text-base focus:outline-none" />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs text-slate-400 mb-1">מחיר ש"ח</p>
                        <input type="number" value={row.price} onChange={e => updateRow(rowIdx, { price: parseFloat(e.target.value) || 0 })}
                          className="w-full border-2 border-amber-300 rounded-xl px-3 py-2 text-base focus:outline-none" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xl font-bold text-slate-800">{row.label}</p>
                    {row.desc && <p className="text-sm text-slate-500">{row.desc}</p>}
                    <div className="flex flex-wrap gap-4 text-base text-slate-600 mt-2">
                      <span>כמות: <strong>{row.qty}</strong></span>
                      <span>מחיר: <strong>{row.price.toLocaleString()} ש"ח</strong></span>
                      <span>סה"כ: <strong>{(row.qty * row.price).toLocaleString()} ש"ח</strong></span>
                    </div>
                  </div>
                )}
                <div className="flex gap-2 flex-wrap pt-1">
                  <button onClick={back} className="border-2 border-slate-200 text-slate-500 font-bold py-2.5 px-4 rounded-xl">חזור</button>
                  <button onClick={deleteCurrentRow} className="border-2 border-red-200 text-red-500 font-bold py-2.5 px-4 rounded-xl hover:bg-red-50">מחק שורה</button>
                  {!editMode && <button onClick={() => setEditMode(true)} className="border-2 border-amber-300 text-amber-600 font-bold py-2.5 px-4 rounded-xl hover:bg-amber-50">ערוך</button>}
                  <button onClick={advance} className="flex-1 bg-amber-500 text-white font-bold py-2.5 rounded-xl">המשך</button>
                </div>
              </div>
            );
          })()}

          {/* ── Add row step ── */}
          {isAddRowStep && (
            <div className="space-y-5">
              <p className="text-slate-400 text-sm font-semibold">הוסף שורה לטבלת העלויות</p>
              <div className="space-y-2">
                <input value={newRow.label} onChange={e => setNewRow(r => ({ ...r, label: e.target.value }))}
                  className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-amber-400" placeholder="שם פריט *" />
                <input value={newRow.desc} onChange={e => setNewRow(r => ({ ...r, desc: e.target.value }))}
                  className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-400 text-slate-600" placeholder="תיאור (אופציונלי)" />
                <div className="flex gap-1 p-1 rounded-xl bg-slate-100">
                  <button onClick={() => setNewRow(r => ({ ...r, isPct: false }))}
                    className={`flex-1 py-1.5 rounded-lg font-bold text-xs transition ${!newRow.isPct ? 'bg-amber-500 text-white' : 'text-slate-500 hover:text-slate-700'}`}>
                    מחיר בש"ח
                  </button>
                  <button onClick={() => setNewRow(r => ({ ...r, isPct: true }))}
                    className={`flex-1 py-1.5 rounded-lg font-bold text-xs transition ${newRow.isPct ? 'bg-amber-500 text-white' : 'text-slate-500 hover:text-slate-700'}`}>
                    מחיר באחוזים
                  </button>
                </div>
                {newRow.isPct ? (
                  <div>
                    <p className="text-xs text-slate-400 mb-1">אחוזים מסכום השורות הקבועות</p>
                    <input type="number" value={newRow.pct} onChange={e => setNewRow(r => ({ ...r, pct: parseFloat(e.target.value) || 0 }))}
                      className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-amber-400" placeholder="לדוגמה: 10" />
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <p className="text-xs text-slate-400 mb-1">כמות</p>
                      <input type="number" value={newRow.qty} onChange={e => setNewRow(r => ({ ...r, qty: parseFloat(e.target.value) || 0 }))}
                        className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-amber-400" />
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-slate-400 mb-1">מחיר ש"ח</p>
                      <input type="number" value={newRow.price} onChange={e => setNewRow(r => ({ ...r, price: parseFloat(e.target.value) || 0 }))}
                        className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-amber-400" />
                    </div>
                  </div>
                )}
              </div>
              <button onClick={addNewRow} disabled={!newRow.label.trim()}
                className="w-full border-2 border-amber-300 text-amber-600 font-bold py-2.5 rounded-xl hover:bg-amber-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
                + הוסף שורה
              </button>
              <div className="flex gap-2">
                <button onClick={back} className="border-2 border-slate-200 text-slate-500 font-bold py-2.5 px-4 rounded-xl">חזור</button>
                <button onClick={advance} className="flex-1 bg-amber-500 text-white font-bold py-2.5 rounded-xl">המשך לתצוגה מקדימה</button>
              </div>
            </div>
          )}

          {/* ── Preview step ── */}
          {isPreviewStep && (
            <div>
              <p className="text-xs text-slate-400 text-center mb-3">לחץ על כל טקסט לעריכה</p>
              <div ref={previewRef} dir="rtl" style={{ fontFamily: 'Arial, sans-serif', fontSize: '10pt', color: '#222', background: '#fff', padding: '12mm', lineHeight: 1.7 }}>

                {/* Logo */}
                <div style={{ textAlign: 'center', marginBottom: '10pt' }}>
                  <img src="/logo.jpg" alt="Sharabiya" crossOrigin="anonymous" style={{ height: '80px', objectFit: 'contain', display: 'inline-block' }} />
                </div>

                <h2 style={{ textAlign: 'center', fontSize: '15pt', fontWeight: 'bold', marginBottom: '12pt' }}>
                  <EditableCell value={texts.title} onChange={v => setTxt('title', v)} />
                </h2>

                {/* Header fields — table keeps label:value correct in RTL */}
                <table style={{ marginBottom: '8pt', borderCollapse: 'collapse' }}>
                  <tbody>
                    {[
                      { label: 'לכבוד', key: 'name' },
                      { label: 'מייל', key: 'email', ltr: true },
                      { label: 'טלפון', key: 'phone', ltr: true },
                      { label: 'תאריך האירוע', key: 'eventDate' },
                      { label: 'שעת פתיחת דלתות', key: 'doorTime' },
                      { label: 'שעת סיום האירוע', key: 'endTime' },
                    ].map(({ label, key, ltr }) => (
                      <tr key={key}>
                        <td style={{ fontWeight: 'bold', whiteSpace: 'nowrap', paddingLeft: '6pt', verticalAlign: 'top', paddingBottom: '2pt' }}>
                          {'‫' + label + ':‬'}
                        </td>
                        <td style={{ direction: ltr ? 'ltr' : 'rtl', paddingBottom: '2pt', verticalAlign: 'top' }}>
                          <EditableCell value={fields[key]} onChange={v => setFields(f => ({ ...f, [key]: v }))} dir={ltr ? 'ltr' : 'rtl'} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <p style={{ marginTop: '8pt', fontSize: '9pt', color: '#555' }}>
                  <EditableCell value={texts.arrival} onChange={v => setTxt('arrival', v)} />
                </p>

                {/* Venue description */}
                <p style={{ marginTop: '6pt', fontWeight: 'bold', fontSize: '9pt' }}>
                  <EditableCell value={texts.venueDescHeader} onChange={v => setTxt('venueDescHeader', v)} />
                </p>
                <p style={{ fontSize: '9pt', marginBottom: '2pt' }}>
                  <EditableCell value={texts.venueDescIntro} onChange={v => setTxt('venueDescIntro', v)} />
                </p>
                <div style={{ fontSize: '9pt', lineHeight: 1.8 }}>
                  {texts.venueDescItems.map((item, i) => {
                    if (!item.trim()) return null;
                    return (
                      <div key={i} style={{ direction: 'rtl' }}>
                        <EditableCell value={item} onChange={v => setVenueDesc(i, v)} multiline />
                      </div>
                    );
                  })}
                </div>

                <h3 style={{ marginTop: '12pt', marginBottom: '4pt' }}>
                  <EditableCell value={texts.costsHeader} onChange={v => setTxt('costsHeader', v)} />
                </h3>
                {offerType === 'regular' && <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt' }}>
                  <thead>
                    <tr style={{ background: '#f5f5f5' }}>
                      {texts.tableHeaders.map((h, i) => (
                        <th key={i} style={{ border: '1px solid #ccc', padding: '4px 6px', textAlign: 'center' }}>
                          <EditableCell value={h} onChange={v => setTh(i, v)} />
                        </th>
                      ))}
                      <th data-html2canvas-ignore="true" style={{ border: '1px solid #ccc', padding: '4px 6px', width: 24 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={row.id}>
                        <td style={{ border: '1px solid #ccc', padding: '4px 6px' }}>
                          <EditableCell value={row.label} onChange={v => updateRow(i, { label: v })} />
                        </td>
                        <td style={{ border: '1px solid #ccc', padding: '4px 6px', fontSize: '8pt', color: '#555' }}>
                          <EditableCell value={row.desc} onChange={v => updateRow(i, { desc: v })} />
                        </td>
                        <td style={{ border: '1px solid #ccc', padding: '4px 6px', textAlign: 'center' }}>
                          {row.isPct ? '-' : <EditableCell value={String(row.qty)} onChange={v => updateRow(i, { qty: parseFloat(v) || 0 })} />}
                        </td>
                        <td style={{ border: '1px solid #ccc', padding: '4px 6px', textAlign: 'center' }}>
                          {row.isPct
                            ? `${row.pct || 0}%`
                            : <><EditableCell value={String(row.price)} onChange={v => updateRow(i, { price: parseFloat(v) || 0 })} />{' ש"ח'}</>}
                        </td>
                        <td style={{ border: '1px solid #ccc', padding: '4px 6px', textAlign: 'center' }}>
                          {getRowTotal(row).toLocaleString()} {'ש"ח'}
                        </td>
                        <td data-html2canvas-ignore="true" style={{ border: '1px solid #ccc', padding: '2px', textAlign: 'center' }}>
                          <button onClick={() => setRows(prev => prev.filter((_, idx) => idx !== i))}
                            style={{ color: '#ef4444', fontWeight: 'bold', fontSize: '12px', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }}>✕</button>
                        </td>
                      </tr>
                    ))}
                    {withVat && <>
                      <tr>
                        <td colSpan={4} style={{ border: '1px solid #ccc', padding: '4px 6px', textAlign: 'right', fontWeight: 'bold' }}>{'‫סה"כ חייב במע"מ:‬'}</td>
                        <td colSpan={2} style={{ border: '1px solid #ccc', padding: '4px 6px', textAlign: 'center', fontWeight: 'bold' }}>{subtotal.toLocaleString()} {'ש"ח'}</td>
                      </tr>
                      <tr>
                        <td colSpan={4} style={{ border: '1px solid #ccc', padding: '4px 6px', textAlign: 'right' }}>{'‫מע"מ (18%):‬'}</td>
                        <td colSpan={2} style={{ border: '1px solid #ccc', padding: '4px 6px', textAlign: 'center' }}>{vat.toLocaleString()} {'ש"ח'}</td>
                      </tr>
                    </>}
                    <tr style={{ fontWeight: 'bold' }}>
                      <td colSpan={4} style={{ border: '1px solid #ccc', padding: '4px 6px', textAlign: 'right' }}>{'‫סה"כ לתשלום:‬'}</td>
                      <td colSpan={2} style={{ border: '1px solid #ccc', padding: '4px 6px', textAlign: 'center' }}>{total.toLocaleString()} {'ש"ח'}</td>
                    </tr>
                  </tbody>
                </table>}

                {/* Regular offer: minimum guests + extra guest cost */}
                {offerType === 'regular' && (
                  <>
                    <p style={{ marginTop: '10pt' }}>
                      <EditableCell value={texts.minGuestsPrefix} onChange={v => setTxt('minGuestsPrefix', v)} />
                      {' '}
                      <EditableCell value={fields.guests} onChange={v => setFields(f => ({ ...f, guests: v }))} />
                      {' '}
                      <EditableCell value={texts.minGuestsSuffix} onChange={v => setTxt('minGuestsSuffix', v)} />
                    </p>
                    {fields.extraGuestPrice && Number(fields.extraGuestPrice) > 0 && (
                      <p style={{ marginTop: '4pt' }}>
                        {'עלות כל אורח נוסף מעל '}
                        <EditableCell value={fields.guests || ''} onChange={v => setFields(f => ({ ...f, guests: v }))} />
                        {' אורחים הינה '}
                        <EditableCell value={Number(fields.extraGuestPrice).toLocaleString()} onChange={v => setFields(f => ({ ...f, extraGuestPrice: v.replace(/,/g, '') }))} />
                        {' ש"ח'}
                        {withVat && <>{' '}<EditableCell value={texts.extraGuestSuffix ?? 'כולל מע"מ'} onChange={v => setTxt('extraGuestSuffix', v)} /></>}
                      </p>
                    )}
                  </>
                )}

                {/* Package offer: cost lines */}
                {offerType === 'package' && (
                  <div style={{ fontSize: '9pt', lineHeight: 2, marginTop: '4pt' }}>
                    {texts.packageCostLines.map((line, i) => {
                      if (!line.trim()) return null;
                      return (
                        <div key={i} style={{ direction: 'rtl' }}>
                          <EditableCell value={line} onChange={v => setPkgLine(i, v)} multiline />
                        </div>
                      );
                    })}
                    <div style={{ marginTop: '4pt', display: 'flex', gap: '6px' }}>
                      <input value={newPkgLine} onChange={e => setNewPkgLine(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addPkgLine()}
                        placeholder="הוסף שורה..."
                        style={{ flex: 1, border: '1px solid #ccc', borderRadius: '6px', padding: '2px 6px', fontSize: '9pt' }} />
                      <button onClick={addPkgLine} disabled={!newPkgLine.trim()}
                        style={{ border: '1px solid #f59e0b', color: '#b45309', borderRadius: '6px', padding: '2px 8px', fontSize: '9pt', background: 'none', cursor: 'pointer', opacity: newPkgLine.trim() ? 1 : 0.4 }}>
                        + הוסף
                      </button>
                    </div>
                  </div>
                )}

                {/* Included items */}
                <p style={{ marginTop: '8pt', marginBottom: '2pt', fontWeight: 'bold' }}>
                  <EditableCell value={texts.includesHeader} onChange={v => setTxt('includesHeader', v)} />
                </p>
                <div style={{ lineHeight: 2 }}>
                  {(() => {
                    const chefIdx = offerType === 'package' ? 5 : 3;
                    const barIdx  = offerType === 'package' ? 6 : 4;
                    return texts.includes.map((item, i) => {
                      const combined = item.trim()
                        + (i === chefIdx && fields.chefMenu ? ' ' + fields.chefMenu : '')
                        + (i === barIdx  && fields.barMenu  ? ' ' + fields.barMenu  : '');
                      if (!combined.trim()) return null;
                      return (
                        <div key={i} style={{ direction: 'rtl' }}>
                          {i === chefIdx ? (
                            <><EditableCell value={item} onChange={v => setInc(i, v)} />{' '}<EditableCell value={fields.chefMenu} onChange={v => setFields(f => ({ ...f, chefMenu: v }))} /></>
                          ) : i === barIdx ? (
                            <><EditableCell value={item} onChange={v => setInc(i, v)} />{' '}<EditableCell value={fields.barMenu} onChange={v => setFields(f => ({ ...f, barMenu: v }))} /></>
                          ) : (
                            <EditableCell value={item} onChange={v => setInc(i, v)} multiline={i === 10} />
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
                <div data-html2canvas-ignore="true" style={{ marginTop: '4pt', display: 'flex', gap: '6px' }}>
                  <input value={newInclude} onChange={e => setNewInclude(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addIncludeItem()}
                    placeholder="הוסף פריט..."
                    style={{ flex: 1, border: '1px solid #ccc', borderRadius: '6px', padding: '2px 6px', fontSize: '9pt', direction: 'rtl' }} />
                  <button onClick={addIncludeItem} disabled={!newInclude.trim()}
                    style={{ border: '1px solid #f59e0b', color: '#b45309', borderRadius: '6px', padding: '2px 8px', fontSize: '9pt', background: 'none', cursor: 'pointer', opacity: newInclude.trim() ? 1 : 0.4 }}>
                    + הוסף
                  </button>
                </div>

                {/* Optional extras */}
                <p style={{ marginTop: '10pt', fontWeight: 'bold' }}>
                  <EditableCell value={texts.extrasHeader} onChange={v => setTxt('extrasHeader', v)} />
                </p>
                <div style={{ lineHeight: 2 }}>
                  {texts.extras.map((item, i) => {
                    if (!item.trim()) return null;
                    return (
                      <div key={i} style={{ direction: 'rtl' }}>
                        <EditableCell value={item} onChange={v => setExt(i, v)} multiline />
                      </div>
                    );
                  })}
                </div>
                <div data-html2canvas-ignore="true" style={{ marginTop: '4pt', display: 'flex', gap: '6px' }}>
                  <input value={newExtra} onChange={e => setNewExtra(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addExtrasItem()}
                    placeholder="הוסף תוספת..."
                    style={{ flex: 1, border: '1px solid #ccc', borderRadius: '6px', padding: '2px 6px', fontSize: '9pt', direction: 'rtl' }} />
                  <button onClick={addExtrasItem} disabled={!newExtra.trim()}
                    style={{ border: '1px solid #f59e0b', color: '#b45309', borderRadius: '6px', padding: '2px 8px', fontSize: '9pt', background: 'none', cursor: 'pointer', opacity: newExtra.trim() ? 1 : 0.4 }}>
                    + הוסף
                  </button>
                </div>

                {fields.notes && (
                  <p style={{ marginTop: '8pt' }}>
                    {'‫הערות: ‬'}<EditableCell value={fields.notes} onChange={v => setFields(f => ({ ...f, notes: v }))} multiline />
                  </p>
                )}

                <p style={{ marginTop: '10pt', fontSize: '9pt', color: '#555' }}>
                  <EditableCell value={texts.payment} onChange={v => setTxt('payment', v)} multiline />
                </p>
                {!withVat && (
                  <p style={{ fontSize: '9pt', fontWeight: 'bold' }}>המחיר אינו כולל מע"מ</p>
                )}
                <p style={{ fontSize: '9pt', color: '#555' }}>
                  <EditableCell value={texts.validity} onChange={v => setTxt('validity', v)} />
                </p>
                <p style={{ marginTop: '6pt', fontWeight: 'bold' }}>
                  <EditableCell value={texts.closing} onChange={v => setTxt('closing', v)} />
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer — only on preview step */}
        {isPreviewStep && (
          <div className="border-t border-slate-100 p-4 space-y-2 shrink-0">
            {showWaExtraFiles ? (
              <div className="space-y-2">
                {allPhones?.length > 1 && (
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 block">שלח לנייד:</label>
                    {allPhones.map(p => (
                      <label key={p} className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                        <input type="radio" name="offerWaPhone" value={p}
                          checked={waPhone === p} onChange={() => setWaPhone(p)} />
                        {allPhoneLabels?.[p] ? `${allPhoneLabels[p]} (${p})` : p}
                      </label>
                    ))}
                  </div>
                )}
                <p className="text-sm font-bold text-slate-700">קבצים נוספים לשליחה בוואטסאפ (אופציונלי)</p>
                <input ref={offerFileRef} type="file" className="hidden" onChange={e => { const f = e.target.files[0]; if (f) { setOfferExtraFiles(a => [...a, { type: 'local', file: f }]); e.target.value = ''; } }} />
                <div className="flex gap-2">
                  <button onClick={() => offerFileRef.current.click()}
                    className="flex-1 border-2 border-dashed rounded-xl py-2 text-sm font-semibold text-center transition border-slate-200 text-slate-400 hover:border-green-300 hover:text-green-600">
                    + מהמחשב
                  </button>
                  <button onClick={() => setOfferDrivePicker('wa')}
                    className="flex-1 border-2 border-dashed rounded-xl py-2 text-sm font-semibold text-center transition border-slate-200 text-slate-400 hover:border-green-300 hover:text-green-600">
                    מ-Google Drive
                  </button>
                </div>
                {offerExtraFiles.length > 0 && (
                  <div className="space-y-1">
                    {offerExtraFiles.map((att, i) => (
                      <div key={i} className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-2.5 py-1.5 text-xs">
                        <span className="truncate text-green-800">📎 {att.type === 'local' ? att.file.name : att.name}</span>
                        <button onClick={() => setOfferExtraFiles(a => a.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 mr-1 shrink-0">&times;</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={() => { setShowWaExtraFiles(false); setOfferExtraFiles([]); }} className="flex-1 border-2 border-slate-200 text-slate-500 font-bold py-2 rounded-xl">ביטול</button>
                  <button onClick={handleSendWA} disabled={sending}
                    className="flex-1 bg-green-600 text-white font-bold py-2 rounded-xl disabled:opacity-50">{sending ? '...' : 'שלח'}</button>
                </div>
              </div>
            ) : showEmailForm ? (
              <div className="space-y-2">
                {allEmails.length > 1 ? (
                  <select value={emailTo} onChange={e => setEmailTo(e.target.value)}
                    className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-sky-400" dir="ltr">
                    {allEmails.map(e => (
                      <option key={e} value={e}>{allEmailLabels[e] ? `${allEmailLabels[e]} (${e})` : e}</option>
                    ))}
                  </select>
                ) : (
                  <input value={emailTo} onChange={e => setEmailTo(e.target.value)}
                    className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-sky-400" placeholder="אימייל נמען" dir="ltr" />
                )}
                <input value={emailSubject} onChange={e => setEmailSubject(e.target.value)}
                  className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-sky-400" placeholder="נושא" />
                <textarea value={emailBody} onChange={e => setEmailBody(e.target.value)} rows={3}
                  className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-sky-400 resize-none" placeholder="גוף ההודעה" />
                <p className="text-xs font-bold text-slate-600">קבצים נוספים (אופציונלי)</p>
                <input ref={offerFileRef} type="file" className="hidden" onChange={e => { const f = e.target.files[0]; if (f) { setOfferExtraFiles(a => [...a, { type: 'local', file: f }]); e.target.value = ''; } }} />
                <div className="flex gap-2">
                  <button onClick={() => offerFileRef.current.click()}
                    className="flex-1 border-2 border-dashed rounded-xl py-2 text-xs font-semibold text-center transition border-slate-200 text-slate-400 hover:border-sky-300 hover:text-sky-600">
                    + מהמחשב
                  </button>
                  <button onClick={() => setOfferDrivePicker('email')}
                    className="flex-1 border-2 border-dashed rounded-xl py-2 text-xs font-semibold text-center transition border-slate-200 text-slate-400 hover:border-sky-300 hover:text-sky-600">
                    מ-Google Drive
                  </button>
                </div>
                {offerExtraFiles.length > 0 && (
                  <div className="space-y-1">
                    {offerExtraFiles.map((att, i) => (
                      <div key={i} className="flex items-center justify-between bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-1.5 text-xs">
                        <span className="truncate text-sky-800">📎 {att.type === 'local' ? att.file.name : att.name}</span>
                        <button onClick={() => setOfferExtraFiles(a => a.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 mr-1 shrink-0">&times;</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={() => { setShowEmailForm(false); setOfferExtraFiles([]); }} className="flex-1 border-2 border-slate-200 text-slate-500 font-bold py-2 rounded-xl">ביטול</button>
                  <button onClick={handleSendEmail} disabled={sending || !emailTo.trim()}
                    className="flex-1 bg-sky-600 text-white font-bold py-2 rounded-xl disabled:opacity-50">{sending ? '...' : 'שלח'}</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 flex-wrap">
                <button onClick={back} className="border-2 border-slate-200 text-slate-500 font-bold py-2 px-4 rounded-xl">חזור</button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 bg-amber-500 text-white font-bold py-2 rounded-xl disabled:opacity-50">{saving ? '...' : 'שמור כ-PDF'}</button>
                <button onClick={() => { setOfferExtraFiles([]); setShowWaExtraFiles(true); }} disabled={sending || !lead.phone}
                  className="flex-1 bg-green-600 text-white font-bold py-2 rounded-xl disabled:opacity-50">{sending ? '...' : 'שלח בוואטסאפ'}</button>
                <button onClick={() => { setOfferExtraFiles([]); setShowEmailForm(true); }} disabled={sending}
                  className="flex-1 bg-sky-600 text-white font-bold py-2 rounded-xl disabled:opacity-50">שלח באימייל</button>
              </div>
            )}
          </div>
        )}
        {offerDrivePicker && (
          <DriveFilePicker
            onSelect={files => setOfferExtraFiles(a => [...a, ...files])}
            onClose={() => setOfferDrivePicker(null)}
          />
        )}
      </div>
    </div>
  );
}

/* ── TIMELINE SECTION ── */
function TimelineSection({ leadId, lead, timeline, allPhones, allEmails, allPhoneLabels = {}, leadFiles = [], onAdded, onAddTask }) {
  const phone = allPhones[0] || null;
  const email = allEmails[0] || null;
  const [adding, setAdding]       = useState(null); // 'call'|'meeting'|'note'
  const [body, setBody]           = useState('');
  const [dir, setDir]             = useState('outbound');
  const [saving, setSaving]       = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);

  const [translations, setTranslations]   = useState({}); // itemId → translated text
  const [translating, setTranslating]     = useState({}); // itemId → bool
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

  const LOG_TYPES = [
    { type: 'call',     label: '📞 שיחה' },
    { type: 'meeting',  label: '🤝 פגישה' },
    { type: 'note',     label: '📝 הערה' },
  ];

  function openAdding(type) {
    setAdding(adding === type ? null : type);
    setBody(''); setDir('outbound');
    setShowFollowUp(false);
  }

  async function saveLog() {
    if (!body.trim()) return;
    setSaving(true);
    await api.post(`/leads/${leadId}/interactions`, { type: adding, direction: dir, body });
    setBody(''); setAdding(null);
    await onAdded();
    setSaving(false);
    setShowFollowUp(true);
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

      {/* Follow-up task prompt */}
      {showFollowUp && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50" dir="rtl"
          onClick={() => setShowFollowUp(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-80 mx-4 space-y-4"
            onClick={e => e.stopPropagation()}>
            <p className="text-lg font-black text-slate-800 text-center">הוסף משימת מעקב?</p>
            <p className="text-sm text-slate-500 text-center">האחראי יוגדר אוטומטית אליך</p>
            <div className="flex gap-3">
              <button onClick={() => { setShowFollowUp(false); const cu = JSON.parse(localStorage.getItem('crm_user') || '{}'); onAddTask(cu.id); }}
                className="flex-1 py-3 rounded-2xl font-bold text-white text-base bg-violet-600 hover:bg-violet-700">
                כן, הוסף משימה
              </button>
              <button onClick={() => setShowFollowUp(false)}
                className="flex-1 py-3 rounded-2xl font-bold text-slate-600 text-base border-2 border-slate-200">
                לא תודה
              </button>
            </div>
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
                    {item.type === 'whatsapp' && !isIn && item.contact_value && (() => {
                      const lastN = p => (p || '').replace(/\D/g, '').slice(-9);
                      const isPrimary = lastN(item.contact_value) === lastN(lead?.phone);
                      const name = allPhoneLabels[item.contact_value]
                        || (isPrimary ? (lead?.event_name || lead?.name) : null);
                      return (
                        <span className="text-xs text-slate-400 font-medium">
                          {name ? `${name} (${item.contact_value})` : item.contact_value}
                        </span>
                      );
                    })()}
                    {item.type === 'whatsapp' && isIn && item.contact_value && allPhones.length > 1 && (() => {
                      const label = allPhoneLabels[item.contact_value];
                      return (
                        <span className="text-xs text-slate-400 font-medium">
                          {label ? `${label} (${item.contact_value})` : item.contact_value}
                        </span>
                      );
                    })()}
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
function WhatsAppTab({ leadId, allPhones, allPhoneLabels = {}, allEmails = [], leadFiles = [], messages = [], onSent }) {
  const [adding, setAdding]           = useState(null); // null | 'wa_send' | 'email_send'
  const [body, setBody]               = useState('');
  const [attachments, setAttachments] = useState([]);
  const [drivePickerFor, setDrivePickerFor] = useState(null);
  const [waPhone, setWaPhone]         = useState(allPhones[0] || '');
  const [emailTo, setEmailTo]         = useState(allEmails[0] || '');
  const [subject, setSubject]         = useState('');
  const [saving, setSaving]           = useState(false);
  const [confirmWA, setConfirmWA]     = useState(false);
  const [draggingWA, setDraggingWA]   = useState(false);
  const [draggingEmail, setDraggingEmail] = useState(false);
  const [showLeadFiles, setShowLeadFiles] = useState(false);
  const [aiLoading, setAiLoading]     = useState(null);
  const fileRef = useRef();
  const phone = allPhones[0] || null;

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

  function openAdding(type) {
    setAdding(adding === type ? null : type);
    setBody(''); setAttachments([]);
    setWaPhone(allPhones[0] || '');
    setEmailTo(allEmails[0] || ''); setSubject('');
  }

  async function sendWA() {
    if (!body.trim() && !attachments.length) return;
    setSaving(true);
    try {
      if (!attachments.length) {
        await api.post('/whatsapp/send', { leadId, message: body, phone: waPhone || undefined });
      } else {
        if (body.trim()) {
          await api.post('/whatsapp/send', { leadId, message: body, phone: waPhone || undefined });
        }
        for (let i = 0; i < attachments.length; i++) {
          if (i > 0) await new Promise(r => setTimeout(r, 2000));
          const att = attachments[i];
          const fd = new FormData();
          fd.append('leadId', leadId);
          fd.append('message', '');
          if (waPhone) fd.append('phone', waPhone);
          if (att.type === 'local') fd.append('file', att.file);
          else if (att.type === 'drive') fd.append('driveFileId', att.fileId);
          else if (att.type === 'lead_file') fd.append('leadFileId', att.fileId);
          await api.post('/whatsapp/send-file', fd);
        }
      }
      setBody(''); setAttachments([]); setAdding(null);
      await onSent();
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
      const driveIds = [];
      for (const att of attachments) {
        if (att.type === 'local') fd.append('files', att.file);
        else driveIds.push(att.fileId);
      }
      if (driveIds.length) fd.append('driveFileIds', JSON.stringify(driveIds));
      await api.post(`/leads/${leadId}/email/send`, fd);
      setBody(''); setAttachments([]); setAdding(null);
      await onSent();
    } catch (err) { alert(err.response?.data?.error || 'שגיאה בשליחת המייל'); }
    setSaving(false);
  }

  const waMessages = messages.filter(m => m.channel === 'whatsapp');

  return (
    <div className="flex flex-col h-full">
      <input ref={fileRef} type="file" multiple className="hidden"
        onChange={e => { Array.from(e.target.files).forEach(f => setAttachments(a => [...a, { type: 'local', file: f }])); e.target.value = ''; }} />

      {/* Message history */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 max-w-2xl mx-auto w-full">
        {waMessages.length === 0
          ? <div className="text-center py-12 text-slate-400 text-base">אין הודעות וואטסאפ</div>
          : waMessages.map(m => (
            <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-base ${m.direction === 'outbound' ? 'bg-green-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                <p>{m.body}</p>
                <p className={`text-sm mt-1 ${m.direction === 'outbound' ? 'text-green-200' : 'text-slate-400'}`}>{formatFull(m.timestamp)}</p>
                {m.contact_value && (
                  <p className={`text-xs mt-0.5 ${m.direction === 'outbound' ? 'text-green-200' : 'text-slate-400'}`} dir="ltr">
                    {allPhoneLabels[m.contact_value]
                      ? `${allPhoneLabels[m.contact_value]} (${m.contact_value})`
                      : m.contact_value}
                  </p>
                )}
              </div>
            </div>
          ))}
      </div>

      {/* Send area */}
      <div className="border-t border-slate-100 p-3 max-w-2xl mx-auto w-full space-y-3">
        {!adding && (
          <div className="flex gap-2">
            <button onClick={() => openAdding('wa_send')} disabled={!phone}
              className="flex-1 bg-green-600 text-white font-bold py-2 rounded-xl text-sm disabled:opacity-40">
              שלח וואטסאפ
            </button>
            <button onClick={() => openAdding('email_send')}
              className="flex-1 bg-sky-600 text-white font-bold py-2 rounded-xl text-sm">
              שלח אימייל
            </button>
          </div>
        )}

        {/* WA form */}
        {adding === 'wa_send' && (
          <div className="bg-white border border-green-100 rounded-xl p-3 space-y-2">
            {allPhones.length > 1 ? (
              <select value={waPhone} onChange={e => setWaPhone(e.target.value)}
                className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-400 text-right" dir="ltr">
                {allPhones.map(p => <option key={p} value={p}>{allPhoneLabels[p] ? `${allPhoneLabels[p]} (${p})` : p}</option>)}
              </select>
            ) : (
              <p className="text-sm text-slate-500 font-semibold text-right">שלח ל: {phone || '(אין מספר)'}</p>
            )}
            <textarea autoFocus value={body} onChange={e => setBody(e.target.value)}
              className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-green-400 resize-none"
              rows={3} placeholder="הודעה..." />
            <AiButtons onAction={aiAction} aiLoading={aiLoading} hasBody={!!body.trim()} />
            <div className="flex gap-2">
              <div
                onDragOver={e => { e.preventDefault(); setDraggingWA(true); }}
                onDragEnter={e => { e.preventDefault(); setDraggingWA(true); }}
                onDragLeave={() => setDraggingWA(false)}
                onDrop={e => { e.preventDefault(); setDraggingWA(false); Array.from(e.dataTransfer.files).forEach(f => setAttachments(a => [...a, { type: 'local', file: f }])); }}
                onClick={() => fileRef.current.click()}
                className={`flex-1 border-2 border-dashed rounded-xl py-2 text-sm font-semibold text-center cursor-pointer transition ${
                  draggingWA ? 'border-green-400 bg-green-50 text-green-600' : 'border-slate-200 text-slate-400 hover:border-green-300 hover:text-green-600'
                }`}>
                {draggingWA ? 'שחרר להוספה' : '+ מהמחשב / גרור לכאן'}
              </div>
              <button onClick={() => setDrivePickerFor('wa')}
                className="flex-1 border-2 border-dashed rounded-xl py-2 text-sm font-semibold text-center transition border-slate-200 text-slate-400 hover:border-green-300 hover:text-green-600">
                מ-Google Drive
              </button>
              {leadFiles.length > 0 && (
                <button onClick={() => setShowLeadFiles(v => !v)}
                  className={`flex-1 border-2 border-dashed rounded-xl py-2 text-sm font-semibold text-center transition ${
                    showLeadFiles ? 'border-green-400 bg-green-50 text-green-600' : 'border-slate-200 text-slate-400 hover:border-green-300 hover:text-green-600'
                  }`}>
                  מקבצים שנשלחו
                </button>
              )}
            </div>
            {showLeadFiles && (
              <div className="border-2 border-slate-200 rounded-xl p-2 space-y-1 max-h-40 overflow-y-auto">
                {leadFiles.map(f => (
                  <button key={f.id}
                    onClick={() => { setAttachments(a => [...a, { type: 'lead_file', fileId: f.id, filename: f.filename }]); setShowLeadFiles(false); }}
                    className="w-full text-right text-sm text-slate-700 hover:bg-slate-50 px-2 py-1 rounded-lg truncate block">
                    {f.filename}
                  </button>
                ))}
              </div>
            )}
            {attachments.length > 0 && (
              <div className="space-y-1">
                {attachments.map((att, i) => (
                  <div key={i} className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-2.5 py-1.5 text-xs">
                    <span className="truncate text-green-800">📎 {att.type === 'local' ? att.file.name : att.filename ?? att.name}</span>
                    <button onClick={() => setAttachments(a => a.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 mr-1 shrink-0">&times;</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setAdding(null)} className="flex-1 border-2 border-slate-200 text-slate-500 text-base font-bold py-1.5 rounded-xl">ביטול</button>
              <button onClick={() => setConfirmWA(true)} disabled={saving || (!body.trim() && !attachments.length) || !waPhone}
                className="flex-1 bg-green-600 text-white text-base font-bold py-1.5 rounded-xl disabled:opacity-50">
                {saving ? '...' : 'שלח'}
              </button>
            </div>
          </div>
        )}

        {/* Email form */}
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
            <div className="flex gap-2">
              <div
                onDragOver={e => { e.preventDefault(); setDraggingEmail(true); }}
                onDragEnter={e => { e.preventDefault(); setDraggingEmail(true); }}
                onDragLeave={() => setDraggingEmail(false)}
                onDrop={e => { e.preventDefault(); setDraggingEmail(false); Array.from(e.dataTransfer.files).forEach(f => setAttachments(a => [...a, { type: 'local', file: f }])); }}
                onClick={() => fileRef.current.click()}
                className={`flex-1 border-2 border-dashed rounded-xl py-2 text-sm font-semibold text-center cursor-pointer transition ${
                  draggingEmail ? 'border-sky-400 bg-sky-50 text-sky-600' : 'border-slate-200 text-slate-400 hover:border-sky-300 hover:text-sky-600'
                }`}>
                {draggingEmail ? 'שחרר להוספה' : '+ מהמחשב / גרור לכאן'}
              </div>
              <button onClick={() => setDrivePickerFor('email')}
                className="flex-1 border-2 border-dashed rounded-xl py-2 text-sm font-semibold text-center transition border-slate-200 text-slate-400 hover:border-sky-300 hover:text-sky-600">
                מ-Google Drive
              </button>
            </div>
            {attachments.length > 0 && (
              <div className="space-y-1">
                {attachments.map((att, i) => (
                  <div key={i} className="flex items-center justify-between bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-1.5 text-xs">
                    <span className="truncate text-sky-800">📎 {att.type === 'local' ? att.file.name : att.name}</span>
                    <button onClick={() => setAttachments(a => a.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 mr-1 shrink-0">&times;</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setAdding(null)} className="flex-1 border-2 border-slate-200 text-slate-500 text-base font-bold py-1.5 rounded-xl">ביטול</button>
              <button onClick={sendEmail} disabled={saving || !emailTo.trim() || !body.trim()}
                className="flex-1 bg-sky-600 text-white text-base font-bold py-1.5 rounded-xl disabled:opacity-50">
                {saving ? '...' : 'שלח'}
              </button>
            </div>
          </div>
        )}

        {drivePickerFor && (
          <DriveFilePicker
            onSelect={files => setAttachments(a => [...a, ...files])}
            onClose={() => setDrivePickerFor(null)}
          />
        )}
      </div>

      {confirmWA && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50" onClick={() => setConfirmWA(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-5 w-80 mx-4 text-right space-y-3" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-slate-800 text-base">האם אתה בטוח שאתה רוצה לשלוח את הודעת הוואטסאפ?</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmWA(false)}
                className="flex-1 border-2 border-slate-200 text-slate-500 font-bold py-2 rounded-xl">לא</button>
              <button onClick={() => { setConfirmWA(false); sendWA(); }}
                className="flex-1 bg-green-600 text-white font-bold py-2 rounded-xl">כן, שלח</button>
            </div>
          </div>
        </div>
      )}
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
          <select
            value={EVENT_TYPES.includes(form.event_type) || !form.event_type ? (form.event_type || '') : 'אחר'}
            onChange={e => set('event_type', e.target.value)}
            className={cls}>
            <option value="">בחר...</option>
            {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {(form.event_type === 'אחר' || (form.event_type && !EVENT_TYPES.includes(form.event_type))) && (
            <input
              value={form.event_type === 'אחר' ? '' : form.event_type}
              onChange={e => set('event_type', e.target.value || 'אחר')}
              className={`${cls} mt-1`}
              placeholder="פרט סוג אירוע..." />
          )}</div>
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
  const [saving, setSaving]           = useState(false);
  const [balanceEdit, setBalanceEdit] = useState(false);
  const [balanceDraft, setBalanceDraft] = useState('');
  const [savingBalance, setSavingBalance] = useState(false);
  const [balanceData, setBalanceData] = useState({
    override: lead.remaining_balance_override,
    override_name: lead.remaining_balance_override_name,
    override_at: lead.remaining_balance_override_at,
  });
  const [autoBalance, setAutoBalance] = useState(null);

  useEffect(() => {
    api.get(`/leads/${leadId}/event-brief`)
      .then(r => {
        const v = r.data?.auto?.remaining_balance;
        if (v != null && v !== '') setAutoBalance(v);
      })
      .catch(() => {});
  }, [leadId]);

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/leads/${leadId}`, form);
      await onUpdated();
    } catch { alert('שגיאה בשמירה'); }
    setSaving(false);
  }

  async function saveBalance() {
    setSavingBalance(true);
    try {
      const { data } = await api.patch(`/leads/${leadId}/remaining-balance`, { amount: balanceDraft });
      const user = JSON.parse(localStorage.getItem('crm_user') || '{}');
      setBalanceData({ override: data.remaining_balance_override, override_name: user.display_name, override_at: data.remaining_balance_override_at });
      setBalanceEdit(false);
    } catch { alert('שגיאה בשמירה'); }
    setSavingBalance(false);
  }

  const cls = 'w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-violet-400 transition bg-white';

  const displayBalance = balanceData.override != null ? balanceData.override : autoBalance;
  const isManual = balanceData.override != null;
  const isAuto   = !isManual && autoBalance != null;

  return (
    <Section title="תשלומים">
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

        {/* יתרה לתשלום */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm text-slate-500 font-semibold">יתרה לתשלום (₪)</label>
            <button onClick={() => { setBalanceDraft(displayBalance ?? ''); setBalanceEdit(e => !e); }}
              className="text-xs text-violet-600 font-bold hover:underline">
              {balanceEdit ? 'ביטול' : 'ערוך'}
            </button>
          </div>
          {balanceEdit ? (
            <div className="flex gap-2">
              <input type="number" value={balanceDraft} onChange={e => setBalanceDraft(e.target.value)}
                className="flex-1 border-2 border-violet-300 rounded-xl px-3 py-1.5 text-base focus:outline-none focus:border-violet-500" />
              <button onClick={saveBalance} disabled={savingBalance}
                className="px-3 py-1.5 rounded-xl bg-violet-600 text-white text-sm font-bold disabled:opacity-50">
                {savingBalance ? '...' : 'שמור'}
              </button>
            </div>
          ) : (
            <>
              <p className="text-lg font-black text-slate-800">
                {displayBalance != null ? `₪${Number(displayBalance).toLocaleString('he-IL')}` : '—'}
              </p>
              {isManual && (
                <p className="text-[11px] text-slate-400 mt-0.5">
                  הוכנס ידנית ע"י {balanceData.override_name || 'משתמש'}
                </p>
              )}
              {isAuto && (
                <p className="text-[11px] text-slate-400 mt-0.5">מולא אוטומטית מהחוזה</p>
              )}
            </>
          )}
        </div>

        <div>
          <label className="text-sm text-slate-500 block mb-1">הערות</label>
          <textarea value={form.production_notes}
            onChange={e => setForm(f => ({ ...f, production_notes: e.target.value }))}
            className={`${cls} resize-none`} rows={3} placeholder="הערות..." />
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

function CalendarSection({ lead, leadId, editForm, calStatus, onUpdated, allPhones = [], allPhoneLabels = {} }) {
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
          allPhones={allPhones}
          allPhoneLabels={allPhoneLabels}
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
function AddTaskModal({ leadId, users, onClose, onSaved, defaultAssignedTo }) {
  const [form, setForm] = useState({ title: '', due_date: '', due_time: '', assigned_to: defaultAssignedTo ? String(defaultAssignedTo) : '', remind_via: 'whatsapp' });
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
            <PickerDateInput value={form.due_date} onChange={v => setForm(f => ({ ...f, due_date: v }))} className={cls} />
          </div>
          <div>
            <label className="text-sm text-slate-500 block mb-1 text-right">שעה</label>
            <PickerTimeInput value={form.due_time} onChange={v => setForm(f => ({ ...f, due_time: v }))} className={cls} />
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
function TaskActionModal({ task, leadId, lead, users, allPhones, allPhoneLabels, allEmails, onClose, onDone, completeTask }) {
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
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 block">שלח לנייד:</label>
                {allPhones.map(p => (
                  <label key={p} className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                    <input type="radio" name="taskWaPhone" value={p}
                      checked={waPhone === p} onChange={() => setWaPhone(p)} />
                    {allPhoneLabels?.[p] ? `${allPhoneLabels[p]} (${p})` : p}
                  </label>
                ))}
              </div>
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
              <PickerDateInput value={newDueDate} onChange={setNewDueDate} className={`${cls} flex-1`} />
              <PickerTimeInput value={newDueTime} onChange={setNewDueTime} className={`${cls} w-28`} />
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
              <PickerDateInput value={followDueDate} onChange={setFollowDueDate} className={`${cls} flex-1`} />
              <PickerTimeInput value={followDueTime} onChange={setFollowDueTime} className={`${cls} w-28`} />
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
function MeetingActionModal({ lead, leadId, eventId, meeting, allPhones, allPhoneLabels, onClose, onUpdated }) {
  const [step, setStep] = useState(1); // 1=choose, 2=cancel, 3=postpone
  const [reason, setReason] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [delivery, setDelivery] = useState(lead?.phone ? 'whatsapp' : 'email');
  const [waPhone, setWaPhone] = useState(allPhones?.[0] || lead?.phone || '');
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
      const newDt = new Date(`${date}T${startTime}`);
      const fmtDate = newDt.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
      if (delivery === 'whatsapp') {
        await api.post('/whatsapp/send', {
          leadId,
          phone: waPhone,
          message: `שלום! הפגישה שלך נדחתה לתאריך ${fmtDate} בשעה ${startTime}–${endTime}.\nהנה הקישור המעודכן:\n${icsUrl}`,
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
              <PickerDateInput value={date} onChange={setDate} className={cls} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-sm text-slate-500 block mb-1">שעת התחלה</label>
                <PickerTimeInput value={startTime} onChange={setStartTime} className={cls} />
              </div>
              <div>
                <label className="text-sm text-slate-500 block mb-1">שעת סיום</label>
                <PickerTimeInput value={endTime} onChange={setEndTime} className={cls} />
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
            {delivery === 'whatsapp' && allPhones?.length > 1 && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 block">שלח לנייד:</label>
                {allPhones.map(p => (
                  <label key={p} className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                    <input type="radio" name="meetingWaPhone" value={p}
                      checked={waPhone === p} onChange={() => setWaPhone(p)} />
                    {allPhoneLabels?.[p] ? `${allPhoneLabels[p]} (${p})` : p}
                  </label>
                ))}
              </div>
            )}
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
function ScheduleMeetingModal({ lead, leadId, allPhones, allPhoneLabels, onClose, onDone }) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString('sv', { timeZone: 'Asia/Jerusalem' }); // yyyy-mm-dd

  const [title, setTitle]       = useState(`פגישה עם ${lead.name || ''}`);
  const [date, setDate]         = useState(tomorrowStr);
  const [startTime, setStart]   = useState('10:00');
  const [endTime, setEnd]       = useState('11:00');
  const [delivery, setDelivery] = useState(lead.phone ? 'whatsapp' : 'email');
  const [waPhone, setWaPhone]   = useState(allPhones?.[0] || lead?.phone || '');
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
        sendInvite: delivery === 'email',
      });

      if (delivery === 'whatsapp') {
        await api.post('/whatsapp/send', {
          leadId,
          phone: waPhone,
          message: `שלום! קישור לפגישה שנקבעה לך ל-${new Date(`${date}T${startTime}`).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })} בשעה ${startTime} בשרביה:\n${data.icsUrl}`,
        });
        if (guestEmail) await api.post(`/calendar/meetings/${data.eventId}/notify`);
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
              <PickerDateInput value={date} onChange={setDate} className={cls} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-sm text-slate-500 block mb-1 text-right">שעת התחלה</label>
                <PickerTimeInput value={startTime} onChange={setStart} className={cls} />
              </div>
              <div>
                <label className="text-sm text-slate-500 block mb-1 text-right">שעת סיום</label>
                <PickerTimeInput value={endTime} onChange={setEnd} className={cls} />
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
            {delivery === 'whatsapp' && allPhones?.length > 1 && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 block">שלח לנייד:</label>
                {allPhones.map(p => (
                  <label key={p} className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                    <input type="radio" name="schedWaPhone" value={p}
                      checked={waPhone === p} onChange={() => setWaPhone(p)} />
                    {allPhoneLabels?.[p] ? `${allPhoneLabels[p]} (${p})` : p}
                  </label>
                ))}
              </div>
            )}
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
  const [adding, setAdding]   = useState(false);
  const [value, setValue]     = useState('');
  const [itemLabel, setItemLabel] = useState('');
  const [saving, setSaving]   = useState(false);

  async function add() {
    if (!value.trim()) return;
    setSaving(true);
    try {
      await api.post(`/leads/${leadId}/contacts`, { type, value: value.trim(), label: itemLabel.trim() || undefined });
      setValue(''); setItemLabel(''); setAdding(false);
      await onAdded();
    } catch { }
    setSaving(false);
  }

  function cancel() { setAdding(false); setValue(''); setItemLabel(''); }

  return (
    <div>
      <p className="text-sm font-bold text-slate-500 mb-1.5">{label}</p>
      <div className="space-y-1">
        {items.map(c => (
          <div key={c.id} className="flex items-center gap-2 bg-white rounded-xl px-3 py-2 border border-slate-100">
            {c.label && <span className="text-sm font-semibold text-slate-500 shrink-0">{c.label}</span>}
            <span className="flex-1 text-base text-slate-700 font-medium" dir={inputDir}>{c.value}</span>
            <button onClick={() => onRemove(c.id)}
              className="text-slate-300 hover:text-red-400 transition text-sm px-1 rounded">🗑️</button>
          </div>
        ))}
        {adding ? (
          <div className="space-y-1.5">
            <input autoFocus value={itemLabel} onChange={e => setItemLabel(e.target.value)}
              className="w-full border-2 border-slate-200 rounded-xl px-3 py-1.5 text-base focus:outline-none focus:border-violet-400"
              placeholder="שם (אופציונלי)" dir="rtl" />
            <div className="flex gap-2">
              <input value={value} onChange={e => setValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && add()}
                className="flex-1 border-2 border-slate-200 rounded-xl px-3 py-1.5 text-base focus:outline-none focus:border-violet-400"
                placeholder={placeholder} dir={inputDir} />
              <button onClick={add} disabled={saving || !value.trim()}
                className="bg-violet-600 text-white text-sm font-bold px-3 py-1.5 rounded-xl disabled:opacity-50">
                {saving ? '...' : 'הוסף'}
              </button>
              <button onClick={cancel}
                className="text-slate-400 hover:text-slate-600 text-sm px-2">✕</button>
            </div>
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
