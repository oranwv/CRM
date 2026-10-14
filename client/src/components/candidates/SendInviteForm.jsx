// Interview invite: create a Google Calendar event on the Sharviya calendar, then send it to the
// candidate by email (Google invite with accept/decline) and/or WhatsApp (CRM Green API line).
import { useState } from 'react';
import { addHours } from 'date-fns';
import api from '../../api';

function toLocalDateTimeString(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const RSVP_LABELS = {
  accepted:    { icon: '✅', text: 'אישר פגישה',   color: 'text-green-700 bg-green-50 border-green-200' },
  declined:    { icon: '❌', text: 'דחה פגישה',    color: 'text-red-700 bg-red-50 border-red-200' },
  tentative:   { icon: '❓', text: 'אולי יגיע',    color: 'text-amber-700 bg-amber-50 border-amber-200' },
  needsAction: { icon: '🕐', text: 'ממתין לתגובה', color: 'text-slate-600 bg-slate-50 border-slate-200' },
  none:        { icon: '🕐', text: 'ממתין לתגובה', color: 'text-slate-600 bg-slate-50 border-slate-200' },
};

export default function SendInviteForm({ candidate, onClose, onRsvpUpdated, onCreated }) {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const defaultStart = toLocalDateTimeString(addHours(now, 1));
  const defaultEnd   = toLocalDateTimeString(addHours(now, 2));

  const [title, setTitle]           = useState(`ראיון — ${candidate.name || 'מועמד'}`);
  const [startTime, setStartTime]   = useState(defaultStart);
  const [endTime, setEndTime]       = useState(defaultEnd);
  const [step, setStep]             = useState('form'); // form | loading | done
  const [eventLink, setEventLink]   = useState(null);
  const [error, setError]           = useState('');
  const [notifying, setNotifying]   = useState(false);
  const [emailSent, setEmailSent]   = useState(false);
  const [whatsappSent, setWhatsappSent] = useState(false);
  const [rsvpStatus, setRsvpStatus] = useState(null);
  const [checkingRsvp, setCheckingRsvp] = useState(false);

  async function handleCreate() {
    setError('');
    setStep('loading');
    try {
      const { data } = await api.post(`/candidates/${candidate.id}/meeting`, {
        title,
        start: new Date(startTime).toISOString(),
        end:   new Date(endTime).toISOString(),
      });
      setEventLink(data.eventLink);
      setStep('done');
      onCreated?.();
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה ביצירת הפגישה');
      setStep('form');
    }
  }

  async function handleSendEmail() {
    setNotifying(true);
    try {
      await api.post(`/candidates/${candidate.id}/meeting/notify`);
      setEmailSent(true);
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה בשליחת ההזמנה');
    } finally {
      setNotifying(false);
    }
  }

  async function handleSendWhatsApp() {
    setNotifying(true);
    try {
      await api.post(`/candidates/${candidate.id}/meeting/whatsapp`, { eventLink, title, startTime: new Date(startTime).toISOString() });
      setWhatsappSent(true);
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה בשליחת WhatsApp');
    } finally {
      setNotifying(false);
    }
  }

  async function handleCheckRsvp() {
    setCheckingRsvp(true);
    try {
      const { data } = await api.get(`/candidates/${candidate.id}/meeting/status`);
      setRsvpStatus(data.status);
      onRsvpUpdated?.(data.status);
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה בבדיקת הסטטוס');
    } finally {
      setCheckingRsvp(false);
    }
  }

  const inputCls = 'border-2 border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400 transition w-full';

  if (step === 'form') {
    return (
      <div className="bg-gradient-to-br from-violet-50 to-indigo-50 border-2 border-violet-200 rounded-2xl p-4 space-y-3 text-sm">
        <p className="font-bold text-slate-700">📅 קביעת ראיון</p>
        <div>
          <label className="block text-xs font-bold text-slate-400 mb-1">כותרת</label>
          <input type="text" value={title} onChange={e => setTitle(e.target.value)} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-bold text-slate-400 mb-1">התחלה</label>
            <input
              type="datetime-local"
              value={startTime}
              onChange={e => {
                setStartTime(e.target.value);
                if (e.target.value) setEndTime(toLocalDateTimeString(addHours(new Date(e.target.value), 1)));
              }}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 mb-1">סיום</label>
            <input type="datetime-local" value={endTime} onChange={e => setEndTime(e.target.value)} className={inputCls} />
          </div>
        </div>
        {error && <p className="text-red-500 text-xs">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600 px-3 py-1.5 rounded-xl transition">ביטול</button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!title || !startTime || !endTime}
            className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-500 hover:from-violet-700 hover:to-indigo-600 text-white text-xs font-bold px-4 py-2 rounded-xl transition disabled:opacity-50"
          >
            📆 צור פגישה ביומן
          </button>
        </div>
      </div>
    );
  }

  if (step === 'loading') {
    return (
      <div className="bg-gradient-to-br from-violet-50 to-indigo-50 border-2 border-violet-200 rounded-2xl p-6 text-center">
        <p className="text-sm text-slate-600 font-medium">יוצר פגישה ביומן...</p>
      </div>
    );
  }

  const rsvpInfo = rsvpStatus ? RSVP_LABELS[rsvpStatus] || RSVP_LABELS.needsAction : null;

  return (
    <div className="bg-gradient-to-br from-violet-50 to-indigo-50 border-2 border-violet-200 rounded-2xl p-4 space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-green-500 text-lg">✅</span>
        <p className="font-bold text-slate-700">הפגישה נוצרה ביומן שרביה</p>
      </div>
      <p className="text-xs text-slate-500">בחר איך לשלוח את ההזמנה למועמד:</p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSendWhatsApp}
          disabled={!candidate.phone || notifying || whatsappSent}
          className={`flex-1 text-xs font-bold py-2.5 rounded-xl transition ${whatsappSent ? 'bg-green-100 text-green-700 border-2 border-green-300' : 'bg-green-500 hover:bg-green-600 text-white disabled:opacity-40'}`}
          title={!candidate.phone ? 'אין מספר טלפון' : ''}
        >
          {whatsappSent ? '✓ נשלח בWhatsApp' : notifying ? 'שולח...' : '📱 שלח בWhatsApp'}
        </button>
        <button
          type="button"
          onClick={handleSendEmail}
          disabled={!candidate.email || notifying || emailSent}
          className={`flex-1 text-xs font-bold py-2.5 rounded-xl transition ${emailSent ? 'bg-green-100 text-green-700 border-2 border-green-300' : 'bg-gradient-to-r from-violet-600 to-indigo-500 hover:from-violet-700 hover:to-indigo-600 text-white disabled:opacity-40'}`}
          title={!candidate.email ? 'אין אימייל' : ''}
        >
          {emailSent ? '✓ הזמנה נשלחה' : notifying ? 'שולח...' : '📧 שלח הזמנה באימייל'}
        </button>
      </div>

      {emailSent && (
        <p className="text-xs text-green-600 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
          Google שלחה למועמד הזמנה עם כפתורי אישור/דחייה.
        </p>
      )}
      {!candidate.email && (
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          אין אימייל למועמד — לא ניתן לשלוח הזמנת יומן. ניתן לשלוח בWhatsApp בלבד.
        </p>
      )}
      {error && <p className="text-red-500 text-xs">{error}</p>}

      {(emailSent || whatsappSent) && (
        <div className="border-t border-violet-100 pt-3 space-y-2">
          <button
            type="button"
            onClick={handleCheckRsvp}
            disabled={checkingRsvp}
            className="w-full text-xs font-bold py-2 px-3 rounded-xl bg-white border-2 border-violet-200 text-violet-700 hover:bg-violet-50 transition disabled:opacity-50"
          >
            {checkingRsvp ? 'בודק...' : '🔄 בדוק תגובת מועמד'}
          </button>
          {rsvpInfo && (
            <div className={`flex items-center gap-2 text-xs font-semibold border rounded-xl px-3 py-2 ${rsvpInfo.color}`}>
              <span>{rsvpInfo.icon}</span><span>{rsvpInfo.text}</span>
            </div>
          )}
        </div>
      )}

      <button type="button" onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600 w-full text-center pt-1 transition">סגור</button>
    </div>
  );
}
