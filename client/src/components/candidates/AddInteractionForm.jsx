import { useState } from 'react';
import { format } from 'date-fns';
import api from '../../api';
import { israelLocalToISO, isoToIsraelLocal } from '../../utils/israelTime';

export default function AddInteractionForm({ candidateId, type, onSaved, onCancel }) {
  const now = isoToIsraelLocal(new Date().toISOString());
  const [dateTime, setDateTime] = useState(now);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const isNote = type === 'note';
  const labels = { call: 'שיחה', meeting: 'פגישה', note: 'הערה' };

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/candidates/${candidateId}/interactions`, {
        type,
        date_time: isNote ? null : israelLocalToISO(dateTime),
        notes: notes || null,
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-gradient-to-br from-violet-50 to-indigo-50 border-2 border-violet-200 rounded-2xl p-4 mb-2 space-y-3 text-sm">
      <p className="font-bold text-slate-700">{labels[type]} חדשה</p>

      {!isNote && (
        <div>
          <label className="block text-xs font-bold text-slate-400 mb-1">תאריך ושעה</label>
          <input
            type="datetime-local"
            value={dateTime}
            onChange={e => setDateTime(e.target.value)}
            className="border-2 border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400 transition w-full"
            required
          />
        </div>
      )}

      <div>
        <label className="block text-xs font-bold text-slate-400 mb-1">{isNote ? 'תוכן ההערה' : 'הערות'}</label>
        <textarea
          autoFocus={isNote}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          placeholder={isNote ? 'כתוב הערה...' : 'מה קרה...'}
          className="border-2 border-slate-200 rounded-xl px-3 py-2 text-sm w-full focus:outline-none focus:border-violet-400 transition resize-none"
          required={isNote}
        />
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="text-xs text-slate-400 hover:text-slate-600 px-3 py-1.5 rounded-xl transition">ביטול</button>
        <button type="submit" disabled={saving} className="bg-gradient-to-r from-violet-600 to-indigo-500 hover:from-violet-700 hover:to-indigo-600 text-white text-xs font-bold px-4 py-1.5 rounded-xl transition disabled:opacity-60">
          {saving ? 'שומר...' : 'שמור'}
        </button>
      </div>
    </form>
  );
}
