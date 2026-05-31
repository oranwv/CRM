import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api';

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}


const STATE_LABEL = {
  not_sent:      'לא נשלח',
  invited:       'ממתין',
  awaiting_count:'ממתין למספר',
  confirmed:     'אישר',
  declined:      'לא מגיע',
};
const STATE_CLS = {
  not_sent:      'bg-slate-100 text-slate-500',
  invited:       'bg-amber-100 text-amber-700',
  awaiting_count:'bg-blue-100 text-blue-700',
  confirmed:     'bg-emerald-100 text-emerald-700',
  declined:      'bg-red-100 text-red-500',
};

// ── Stat tile ─────────────────────────────────────────────────────────────────

function Tile({ label, value, color }) {
  return (
    <div className="flex-1 rounded-2xl text-center py-2.5 px-1" style={{ background: 'rgba(255,255,255,0.15)' }}>
      <p className="font-black text-xl leading-none" style={{ color }}>{value}</p>
      <p className="text-white/70 text-[10px] mt-0.5 font-semibold">{label}</p>
    </div>
  );
}

// ── Guest list tab ─────────────────────────────────────────────────────────────

function GuestsTab({ campaignId, campaign, onStatsChange }) {
  const [guests, setGuests]       = useState([]);
  const [filter, setFilter]       = useState('all');
  const [loading, setLoading]     = useState(true);
  const [sending, setSending]     = useState(false);
  const [reminding, setReminding] = useState(false);
  const [showAdd, setShowAdd]     = useState(false);
  const [newName, setNewName]     = useState('');
  const [newPhone, setNewPhone]   = useState('');
  const [addErr, setAddErr]       = useState('');
  const importRef = useRef();

  function load() {
    setLoading(true);
    api.get(`/rsvp/campaigns/${campaignId}/guests`)
      .then(r => setGuests(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [campaignId]);

  const FILTERS = [
    { key: 'all',      label: 'כולם' },
    { key: 'confirmed',label: 'אישרו' },
    { key: 'declined', label: 'לא מגיעים' },
    { key: 'invited',  label: 'ממתינים' },
    { key: 'not_sent', label: 'לא נשלח' },
  ];

  const visible = guests.filter(g => {
    if (filter === 'all')      return true;
    if (filter === 'invited')  return ['invited','awaiting_count'].includes(g.state);
    return g.state === filter;
  });

  async function handleSend() {
    if (!confirm(`שלח הזמנות ל-${guests.filter(g => g.state === 'not_sent').length} אורחים שלא קיבלו עדיין?`)) return;
    setSending(true);
    try {
      const { data } = await api.post(`/rsvp/campaigns/${campaignId}/send`);
      alert(`נשלח ל-${data.sent} אורחים${data.failed ? `, נכשל עבור ${data.failed}` : ''}`);
      load();
      onStatsChange?.();
    } catch (e) {
      alert(e.response?.data?.error || 'שגיאה בשליחה');
    } finally {
      setSending(false);
    }
  }

  async function handleRemind() {
    const cnt = guests.filter(g => g.state === 'invited').length;
    if (!cnt) return alert('אין אורחים ממתינים לתזכורת');
    if (!confirm(`שלח תזכורת ל-${cnt} אורחים שלא ענו?`)) return;
    setReminding(true);
    try {
      const { data } = await api.post(`/rsvp/campaigns/${campaignId}/remind`);
      alert(`תזכורת נשלחה ל-${data.sent} אורחים`);
    } catch (e) {
      alert(e.response?.data?.error || 'שגיאה בשליחת תזכורת');
    } finally {
      setReminding(false);
    }
  }

  async function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await api.post(`/rsvp/campaigns/${campaignId}/guests/import`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      alert(`יובאו ${data.imported} אורחים${data.skipped ? `, דולגו ${data.skipped}` : ''}`);
      load();
      onStatsChange?.();
    } catch (e) {
      alert(e.response?.data?.error || 'שגיאה בייבוא');
    } finally {
      importRef.current.value = '';
    }
  }

  async function handleAddGuest(ev) {
    ev.preventDefault();
    setAddErr('');
    if (!newPhone.trim()) return setAddErr('טלפון נדרש');
    try {
      await api.post(`/rsvp/campaigns/${campaignId}/guests`, { name: newName, phone: newPhone });
      setNewName(''); setNewPhone(''); setShowAdd(false);
      load();
      onStatsChange?.();
    } catch (e) {
      setAddErr(e.response?.data?.error || 'שגיאה');
    }
  }

  async function handleDelete(guestId, name) {
    if (!confirm(`מחק את ${name || 'האורח'}?`)) return;
    await api.delete(`/rsvp/campaigns/${campaignId}/guests/${guestId}`).catch(() => {});
    load();
    onStatsChange?.();
  }

  return (
    <div>
      {/* Action bar */}
      <div className="flex flex-wrap gap-2 px-4 pt-4 pb-2">
        <button
          onClick={() => importRef.current.click()}
          className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 bg-white"
        >
          ייבוא Excel
        </button>
        <input ref={importRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />

        <button
          onClick={() => setShowAdd(s => !s)}
          className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 bg-white"
        >
          + הוסף ידנית
        </button>

        <button
          onClick={handleSend}
          disabled={sending || guests.filter(g => g.state === 'not_sent').length === 0}
          className="text-xs font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)' }}
        >
          {sending ? 'שולח...' : `שלח הזמנות (${guests.filter(g => g.state === 'not_sent').length})`}
        </button>

        <button
          onClick={handleRemind}
          disabled={reminding || guests.filter(g => g.state === 'invited').length === 0}
          className="text-xs font-bold px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 bg-amber-50 disabled:opacity-40"
        >
          {reminding ? 'שולח...' : `תזכורת (${guests.filter(g => g.state === 'invited').length})`}
        </button>

        <a
          href={`/api/rsvp/campaigns/${campaignId}/export`}
          className="text-xs font-bold px-3 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 bg-emerald-50"
        >
          ייצוא CSV
        </a>
      </div>

      {/* Add guest inline form */}
      {showAdd && (
        <form onSubmit={handleAddGuest} className="mx-4 mb-2 bg-violet-50 border border-violet-200 rounded-xl p-3 flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-[10px] font-bold text-slate-500 block mb-0.5">שם</label>
            <input
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-violet-400 bg-white"
              placeholder="ישראל ישראלי"
              value={newName}
              onChange={e => setNewName(e.target.value)}
            />
          </div>
          <div className="flex-1">
            <label className="text-[10px] font-bold text-slate-500 block mb-0.5">טלפון</label>
            <input
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-violet-400 bg-white"
              placeholder="050-0000000"
              value={newPhone}
              onChange={e => setNewPhone(e.target.value)}
              inputMode="tel"
            />
          </div>
          <button type="submit" className="text-xs font-black px-3 py-2 rounded-lg text-white" style={{ background: '#7c3aed' }}>הוסף</button>
          {addErr && <p className="text-red-500 text-[10px] self-center">{addErr}</p>}
        </form>
      )}

      {/* Filter bar */}
      <div className="flex gap-1.5 px-4 pb-3 overflow-x-auto no-scrollbar">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`shrink-0 text-[11px] font-bold px-3 py-1 rounded-full transition ${filter === f.key ? 'text-white' : 'bg-slate-100 text-slate-500'}`}
            style={filter === f.key ? { background: 'linear-gradient(135deg,#7c3aed,#4f46e5)' } : {}}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-center text-slate-400 text-sm py-10">טוען...</p>
      ) : visible.length === 0 ? (
        <p className="text-center text-slate-400 text-sm py-10">אין אורחים</p>
      ) : (
        <div className="px-4 space-y-2 pb-4">
          {visible.map(g => (
            <div key={g.id} className="bg-white rounded-xl border border-slate-100 px-3 py-2.5 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-slate-800 truncate">
                  {g.name || <a href={`tel:${g.phone}`} className="text-violet-600">{g.phone}</a>}
                </p>
                {g.name && <a href={`tel:${g.phone}`} className="text-[11px] text-slate-400 truncate block">{g.phone}</a>}
                {g.invited_at && (
                  <p className="text-[10px] text-slate-300 mt-0.5">נשלח {fmt(g.invited_at)}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATE_CLS[g.state]}`}>
                  {STATE_LABEL[g.state]}
                </span>
                {g.state === 'confirmed' && g.guest_count && (
                  <span className="text-[10px] font-black text-emerald-600">{g.guest_count} מגיעים</span>
                )}
              </div>
              <button
                onClick={() => handleDelete(g.id, g.name)}
                className="text-slate-300 hover:text-red-400 transition text-lg leading-none pr-1"
                title="מחק"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Settings tab ──────────────────────────────────────────────────────────────

function SettingsTab({ campaign, onSaved }) {
  const [form, setForm] = useState({
    name:                   campaign.name            || '',
    host_name:              campaign.host_name        || '',
    event_date:             campaign.event_date       ? campaign.event_date.slice(0,10) : '',
    event_time:             campaign.event_time       || '',
    venue_address:          campaign.venue_address    || '',
    template_name:          campaign.template_name    || 'rsvp_invitation',
    reminder_template_name: campaign.reminder_template_name || 'rsvp_reminder',
    status:                 campaign.status           || 'draft',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function save(e) {
    e.preventDefault();
    setSaving(true); setSaved(false);
    try {
      await api.put(`/rsvp/campaigns/${campaign.id}`, form);
      setSaved(true);
      onSaved?.(form);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={save} className="px-4 pt-4 pb-6 space-y-3" dir="rtl">
      <div>
        <label className="text-xs font-bold text-slate-500 block mb-1">שם הקמפיין</label>
        <input className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400" value={form.name} onChange={e => set('name', e.target.value)} />
      </div>
      <div>
        <label className="text-xs font-bold text-slate-500 block mb-1">שם המארחים</label>
        <input className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400" value={form.host_name} onChange={e => set('host_name', e.target.value)} />
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-xs font-bold text-slate-500 block mb-1">תאריך האירוע</label>
          <input type="date" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400" value={form.event_date} onChange={e => set('event_date', e.target.value)} />
        </div>
        <div className="w-28">
          <label className="text-xs font-bold text-slate-500 block mb-1">שעה</label>
          <input type="time" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400" value={form.event_time} onChange={e => set('event_time', e.target.value)} />
        </div>
      </div>
      <div>
        <label className="text-xs font-bold text-slate-500 block mb-1">כתובת המקום</label>
        <input className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400" value={form.venue_address} onChange={e => set('venue_address', e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-bold text-slate-500 block mb-1">תבנית הזמנה (Meta)</label>
          <input className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400" value={form.template_name} onChange={e => set('template_name', e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-bold text-slate-500 block mb-1">תבנית תזכורת</label>
          <input className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400" value={form.reminder_template_name} onChange={e => set('reminder_template_name', e.target.value)} />
        </div>
      </div>
      <div>
        <label className="text-xs font-bold text-slate-500 block mb-1">סטטוס</label>
        <select className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400" value={form.status} onChange={e => set('status', e.target.value)}>
          <option value="draft">טיוטה</option>
          <option value="active">פעיל</option>
          <option value="closed">סגור</option>
        </select>
      </div>

      {/* Message preview */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
        <p className="text-[10px] font-bold text-slate-400 mb-1.5">תצוגה מקדימה — הזמנה</p>
        <p className="text-xs text-slate-700 leading-relaxed">
          שלום {'{שם האורח}'},<br />
          אתם מוזמנים לאירוע של <strong>{form.host_name || '{שם המארחים}'}</strong> ביום{' '}
          <strong>{form.event_date ? fmt(new Date(form.event_date)) : '{תאריך}'}</strong>{' '}
          בשעה <strong>{form.event_time || '{שעה}'}</strong> ב<strong>{form.venue_address || '{מקום}'}</strong>.<br />
          האם תגיעו?<br />
          <span className="inline-block mt-1 text-emerald-600 font-bold">[כן, מגיעים]</span>{' '}
          <span className="inline-block text-red-400 font-bold">[לא נוכל להגיע]</span>
        </p>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="w-full py-3 rounded-xl text-white font-black text-sm"
        style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)' }}
      >
        {saved ? 'נשמר!' : saving ? 'שומר...' : 'שמור שינויים'}
      </button>
    </form>
  );
}

// ── Message log tab ──────────────────────────────────────────────────────────

function MessagesTab({ campaignId }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    api.get(`/rsvp/campaigns/${campaignId}/messages`)
      .then(r => setMessages(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [campaignId]);

  if (loading) return <p className="text-center text-slate-400 text-sm py-10">טוען...</p>;
  if (!messages.length) return <p className="text-center text-slate-400 text-sm py-10">אין הודעות עדיין</p>;

  return (
    <div className="px-4 pt-4 pb-6 space-y-2">
      {messages.map(m => (
        <div
          key={m.id}
          className={`rounded-xl px-3 py-2 max-w-[85%] ${m.direction === 'outbound' ? 'mr-auto bg-violet-50 border border-violet-100' : 'ml-auto bg-white border border-slate-100'}`}
        >
          <p className="text-[10px] font-bold text-slate-400 mb-0.5">
            {m.direction === 'outbound' ? 'מערכת' : (m.guest_name || m.guest_phone || 'אורח')}
            {' · '}{new Date(m.created_at).toLocaleString('he-IL', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}
          </p>
          <p className="text-xs text-slate-700 whitespace-pre-wrap">{m.body}</p>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RSVPDetailPage() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const [campaign, setCampaign]   = useState(null);
  const [loading, setLoading]     = useState(true);
  const [tab, setTab]             = useState('guests');

  function loadCampaign() {
    api.get(`/rsvp/campaigns/${id}`)
      .then(r => setCampaign(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadCampaign(); }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-400 text-sm">טוען...</p>
      </div>
    );
  }
  if (!campaign) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-3">
        <p className="text-slate-400 text-sm">קמפיין לא נמצא</p>
        <button onClick={() => navigate('/rsvps')} className="text-violet-600 font-bold text-sm">חזור</button>
      </div>
    );
  }

  const total     = Number(campaign.total_guests || 0);
  const confirmed = Number(campaign.confirmed || 0);
  const declined  = Number(campaign.declined  || 0);
  const pending   = Number(campaign.pending   || 0);

  const TABS = [
    { key: 'guests',   label: 'רשימת אורחים' },
    { key: 'settings', label: 'הגדרות' },
    { key: 'log',      label: 'לוג הודעות' },
  ];

  return (
    <div className="min-h-screen bg-slate-50" dir="rtl">
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)' }} className="pb-4">
        <div className="flex items-center gap-2 px-4 pt-3 pb-3">
          <button onClick={() => navigate('/rsvps')} className="text-white/80 text-xl leading-none">‹</button>
          <div className="flex-1 min-w-0">
            <h1 className="text-white font-black text-base truncate">{campaign.name}</h1>
            {campaign.host_name && (
              <p className="text-white/70 text-xs truncate">{campaign.host_name}</p>
            )}
          </div>
          {campaign.event_date && (
            <p className="text-white/80 text-xs font-semibold shrink-0">{fmt(campaign.event_date)}</p>
          )}
        </div>

        {/* Stats */}
        <div className="flex gap-2 px-4">
          <Tile label='סה"כ'        value={total}     color="#fff" />
          <Tile label="אישרו"       value={confirmed} color="#6ee7b7" />
          <Tile label="לא מגיעים"   value={declined}  color="#fca5a5" />
          <Tile label="ממתינים"     value={pending}   color="#fde68a" />
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-slate-200 bg-white sticky top-11 z-20">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2.5 text-xs font-black transition border-b-2 ${tab === t.key ? 'border-violet-500 text-violet-700' : 'border-transparent text-slate-400'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'guests' && (
        <GuestsTab
          campaignId={id}
          campaign={campaign}
          onStatsChange={loadCampaign}
        />
      )}
      {tab === 'settings' && (
        <SettingsTab
          campaign={campaign}
          onSaved={updates => setCampaign(c => ({ ...c, ...updates }))}
        />
      )}
      {tab === 'log' && <MessagesTab campaignId={id} />}
    </div>
  );
}
