import { useState, useEffect } from 'react';
import api from '../api';

function parseDateIL(str) {
  if (!str || !str.trim()) return null;
  const m = str.trim().match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})$/);
  if (!m) return null;
  let [, d, mo, y] = m.map(Number);
  if (y < 100) y += 2000;
  if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2020) return null;
  return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
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
function TimeInput({ value, onChange, className, placeholder }) {
  return (
    <input type="text" value={value || ''} onChange={e => onChange(e.target.value)}
      placeholder={placeholder || 'HH:MM'} className={className} dir="ltr" />
  );
}

const SOURCE_OPTIONS = [
  { value: 'website_popup', label: 'אתר (פופאפ)' },
  { value: 'website_form', label: 'אתר (טופס)' },
  { value: 'call_event', label: 'Call Event' },
  { value: 'telekol', label: 'טלקול' },
  { value: 'whatsapp', label: 'וואטסאפ' },
  { value: 'facebook', label: 'פייסבוק' },
  { value: 'instagram', label: 'אינסטגרם' },
  { value: 'manual', label: 'ידני' },
];

const EVENT_TYPES = ['חתונה', 'בר/בת מצווה', 'אירוסין', 'יום הולדת', 'כנס', 'אירוע חברה', 'חינה', 'אחר'];

export default function AddLeadModal({ onClose, onSaved }) {
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [customEventType, setCustomEventType] = useState('');
  const [form, setForm] = useState({
    name: '', phone: '', email: '', event_name: '',
    event_date: '', event_time: '', event_end_time: '', event_type: '', guest_count: '', budget: '',
    source: 'manual', priority: 'normal', assigned_to: '',
    notes: '',
  });

  useEffect(() => {
    api.get('/users').then(r => setUsers(r.data)).catch(() => {});
  }, []);

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      if (!payload.guest_count) delete payload.guest_count;
      if (!payload.budget) delete payload.budget;
      if (!payload.assigned_to) delete payload.assigned_to;
      if (payload.event_type === 'אחר' && customEventType.trim()) {
        payload.event_type = customEventType.trim();
      }
      // Parse free-text date → ISO date column; store raw text in event_date_text
      const parsedDate = parseDateIL(payload.event_date);
      payload.event_date_text = payload.event_date || null;
      payload.event_date = parsedDate || null;
      // Parse free-text times → HH:MM; drop if unparseable
      const parsedTime = parseTimeIL(payload.event_time);
      payload.event_time = parsedTime || null;
      if (!payload.event_time) delete payload.event_time;
      const parsedEnd = parseTimeIL(payload.event_end_time);
      payload.event_end_time = parsedEnd || null;
      if (!payload.event_end_time) delete payload.event_end_time;
      await api.post('/leads', payload);
      onSaved();
    } catch (err) {
      alert(err.response?.data?.error || 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white px-5 pt-5 pb-3 border-b border-violet-100 flex items-center justify-between rounded-t-3xl">
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
          <h2 className="font-black text-slate-800 text-lg">ליד חדש</h2>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {/* Name + Phone */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="שם *">
              <input required value={form.name} onChange={e => set('name', e.target.value)}
                className={inputCls} placeholder="שם מלא" />
            </Field>
            <Field label="טלפון *">
              <input required value={form.phone} onChange={e => set('phone', e.target.value)}
                className={inputCls} placeholder="05X-XXXXXXX" dir="ltr" />
            </Field>
          </div>

          {/* Event name */}
          <Field label="שם האירוע">
            <input value={form.event_name} onChange={e => set('event_name', e.target.value)}
              className={inputCls} placeholder="שם האירוע (ברירת מחדל: שם הליד)" />
          </Field>

          {/* Email */}
          <Field label="אימייל">
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
              className={inputCls} placeholder="example@email.com" dir="ltr" />
          </Field>

          {/* Event date + time + type */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="תאריך אירוע">
              <DateInput value={form.event_date} onChange={v => set('event_date', v)} className={inputCls} />
            </Field>
            <Field label="שעת האירוע">
              <TimeInput value={form.event_time} onChange={v => set('event_time', v)} className={inputCls} placeholder="19:00" />
            </Field>
            <Field label="שעת סיום">
              <TimeInput value={form.event_end_time} onChange={v => set('event_end_time', v)} className={inputCls} placeholder="23:00" />
            </Field>
          </div>
          <Field label="סוג אירוע">
            <select value={form.event_type} onChange={e => set('event_type', e.target.value)} className={inputCls}>
              <option value="">בחר...</option>
              {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          {form.event_type === 'אחר' && (
            <Field label="פרט סוג אירוע">
              <input value={customEventType} onChange={e => setCustomEventType(e.target.value)}
                className={inputCls} placeholder="הכנס סוג אירוע..." />
            </Field>
          )}

          {/* Guests + Budget */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="מוזמנים">
              <input type="number" min="0" value={form.guest_count} onChange={e => set('guest_count', e.target.value)}
                className={inputCls} placeholder="כמות" />
            </Field>
            <Field label="תקציב">
              <input type="number" min="0" value={form.budget} onChange={e => set('budget', e.target.value)}
                className={inputCls} placeholder="₪" />
            </Field>
          </div>

          {/* Source + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="מקור">
              <select value={form.source} onChange={e => set('source', e.target.value)} className={inputCls}>
                {SOURCE_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="עדיפות">
              <select value={form.priority} onChange={e => set('priority', e.target.value)} className={inputCls}>
                <option value="normal">רגיל</option>
                <option value="hot">🔥 חם</option>
                <option value="urgent">⚡ דחוף</option>
              </select>
            </Field>
          </div>

          {/* Assigned to */}
          <Field label="אחראי">
            <select value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)} className={inputCls}>
              <option value="">ללא שיוך</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
            </select>
          </Field>

          {/* Notes */}
          <Field label="הערות">
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
              className={`${inputCls} resize-none`} rows={3} placeholder="הערות..." />
          </Field>

          {/* Buttons */}
          <div className="flex gap-3 pt-1 pb-2">
            <button type="button" onClick={onClose}
              className="flex-1 border-2 border-slate-200 text-slate-600 font-bold py-3 rounded-xl hover:bg-slate-50 transition">
              ביטול
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 text-white font-bold py-3 rounded-xl transition disabled:opacity-60 shadow-lg"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', boxShadow: '0 4px 14px rgba(124,58,237,0.3)' }}>
              {saving ? 'שומר...' : 'הוסף ליד'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputCls = 'w-full border border-violet-200 bg-violet-50 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 transition';

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
