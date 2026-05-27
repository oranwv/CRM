import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api';

const STATE_LABEL = {
  draft:  'טיוטה',
  active: 'פעיל',
  closed: 'סגור',
};
const STATE_CLS = {
  draft:  'bg-slate-100 text-slate-500',
  active: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-slate-200 text-slate-500',
};

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function CreateModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '', host_name: '', event_date: '', event_time: '', venue_address: '',
    template_name: 'rsvp_invitation', reminder_template_name: 'rsvp_reminder',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) return setErr('שם קמפיין נדרש');
    setSaving(true);
    try {
      const { data } = await api.post('/rsvp/campaigns', form);
      onCreated(data);
    } catch (e) {
      setErr(e.response?.data?.error || 'שגיאה');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white rounded-t-3xl p-6 pb-10"
        dir="rtl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-black text-slate-800 mb-5">קמפיין חדש</h2>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1">שם הקמפיין</label>
            <input
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
              placeholder="חתונת דנה ויוסי"
              value={form.name}
              onChange={e => set('name', e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1">שם המארחים</label>
            <input
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
              placeholder="דנה ויוסי כהן"
              value={form.host_name}
              onChange={e => set('host_name', e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs font-bold text-slate-500 block mb-1">תאריך האירוע</label>
              <input
                type="date"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
                value={form.event_date}
                onChange={e => set('event_date', e.target.value)}
              />
            </div>
            <div className="w-28">
              <label className="text-xs font-bold text-slate-500 block mb-1">שעה</label>
              <input
                type="time"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
                value={form.event_time}
                onChange={e => set('event_time', e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1">כתובת המקום</label>
            <input
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
              placeholder="שרביה, פנחס בן יאיר 3, תל אביב"
              value={form.venue_address}
              onChange={e => set('venue_address', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1">תבנית הזמנה (Meta)</label>
              <input
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
                value={form.template_name}
                onChange={e => set('template_name', e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1">תבנית תזכורת</label>
              <input
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
                value={form.reminder_template_name}
                onChange={e => set('reminder_template_name', e.target.value)}
              />
            </div>
          </div>
          {err && <p className="text-red-500 text-xs">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-bold"
            >
              ביטול
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl text-white text-sm font-black"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)' }}
            >
              {saving ? 'שומר...' : 'צור קמפיין'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function RSVPsPage() {
  const navigate        = useNavigate();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  function load() {
    setLoading(true);
    api.get('/rsvp/campaigns')
      .then(r => setCampaigns(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const totalGuests    = campaigns.reduce((s, c) => s + Number(c.total_guests || 0), 0);
  const totalConfirmed = campaigns.reduce((s, c) => s + Number(c.confirmed || 0), 0);

  return (
    <div className="min-h-screen bg-slate-50" dir="rtl">
      {/* Summary banner */}
      <div
        className="px-4 pt-4 pb-5"
        style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-white font-black text-lg">אישורי הגעה</h1>
          <button
            onClick={() => setShowCreate(true)}
            className="text-xs font-black px-4 py-2 rounded-xl text-white"
            style={{ background: 'rgba(255,255,255,0.2)' }}
          >
            + קמפיין חדש
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'קמפיינים', value: campaigns.length },
            { label: 'סה"כ אורחים', value: totalGuests },
            { label: 'אישרו הגעה', value: totalConfirmed },
          ].map(s => (
            <div key={s.label} className="rounded-2xl text-center py-2.5" style={{ background: 'rgba(255,255,255,0.15)' }}>
              <p className="text-white font-black text-xl leading-none">{s.value}</p>
              <p className="text-white/70 text-[10px] mt-0.5 font-semibold">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Campaign list */}
      <div className="px-4 py-4 space-y-3">
        {loading && (
          <p className="text-center text-slate-400 text-sm py-10">טוען...</p>
        )}
        {!loading && campaigns.length === 0 && (
          <div className="text-center py-16">
            <p className="text-slate-400 text-sm">אין קמפיינים עדיין</p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-3 text-violet-600 font-black text-sm"
            >
              צור קמפיין ראשון
            </button>
          </div>
        )}
        {campaigns.map(c => {
          const total     = Number(c.total_guests || 0);
          const confirmed = Number(c.confirmed || 0);
          const declined  = Number(c.declined || 0);
          const pending   = Number(c.pending || 0);
          const pct       = total > 0 ? Math.round((confirmed / total) * 100) : 0;

          return (
            <button
              key={c.id}
              onClick={() => navigate(`/rsvps/${c.id}`)}
              className="w-full text-right bg-white rounded-2xl shadow-sm border border-violet-100 px-4 py-3 hover:border-violet-300 transition"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <p className="font-black text-slate-800 text-sm truncate">{c.name}</p>
                  {c.host_name && <p className="text-xs text-slate-500 truncate">{c.host_name}</p>}
                  {c.event_date && (
                    <p className="text-xs text-violet-600 font-semibold mt-0.5">{formatDate(c.event_date)}{c.event_time ? ` · ${c.event_time}` : ''}</p>
                  )}
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${STATE_CLS[c.status]}`}>
                  {STATE_LABEL[c.status]}
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mb-1.5">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#7c3aed,#10b981)' }}
                />
              </div>

              <div className="flex gap-3 text-[10px] font-bold">
                <span className="text-emerald-600">{confirmed} אישרו</span>
                <span className="text-red-400">{declined} לא מגיעים</span>
                <span className="text-amber-500">{pending} ממתינים</span>
                <span className="text-slate-400 mr-auto">{total} סה"כ</span>
              </div>
            </button>
          );
        })}
      </div>

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={campaign => {
            setShowCreate(false);
            navigate(`/rsvps/${campaign.id}`);
          }}
        />
      )}
    </div>
  );
}
