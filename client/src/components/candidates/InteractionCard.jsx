import { useState } from 'react';
import { format } from 'date-fns';
import api from '../../api';
import { israelLocalToISO, isoToIsraelLocal } from '../../utils/israelTime';

const TYPE_STYLES = {
  call:    'bg-sky-100 text-sky-700',
  meeting: 'bg-purple-100 text-purple-700',
  note:    'bg-amber-100 text-amber-700',
};

const TYPE_LABELS = {
  call:    '📞 שיחה',
  meeting: '🤝 פגישה',
  note:    '📝 הערה',
};

export default function InteractionCard({ interaction, onDelete, onUpdated }) {
  const { id, type, date_time, notes } = interaction;
  const [editing, setEditing] = useState(false);
  const [editNotes, setEditNotes] = useState(notes || '');
  const [editDateTime, setEditDateTime] = useState(isoToIsraelLocal(date_time));
  const [saving, setSaving] = useState(false);
  const isNote = type === 'note';

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/candidates/interactions/${id}`, {
        date_time: isNote ? null : israelLocalToISO(editDateTime),
        notes: editNotes || null,
      });
      onUpdated({ ...interaction, notes: editNotes, date_time: isNote ? null : israelLocalToISO(editDateTime) });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={handleSave} className="bg-gradient-to-br from-violet-50 to-indigo-50 border-2 border-violet-200 rounded-2xl p-3 text-sm space-y-2">
        <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${TYPE_STYLES[type] || 'bg-slate-100 text-slate-600'}`}>
          {TYPE_LABELS[type] || type}
        </span>
        {!isNote && (
          <input
            type="datetime-local"
            value={editDateTime}
            onChange={e => setEditDateTime(e.target.value)}
            className="border-2 border-slate-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-violet-400 transition w-full"
          />
        )}
        <textarea
          autoFocus
          value={editNotes}
          onChange={e => setEditNotes(e.target.value)}
          rows={3}
          className="border-2 border-slate-200 rounded-xl px-3 py-2 text-sm w-full focus:outline-none focus:border-violet-400 transition resize-none"
        />
        <div className="flex gap-2">
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-400 hover:text-slate-600 px-3 py-1.5 rounded-xl transition">ביטול</button>
          <button type="submit" disabled={saving} className="bg-gradient-to-r from-violet-600 to-indigo-500 text-white text-xs font-bold px-4 py-1.5 rounded-xl transition disabled:opacity-60">
            {saving ? 'שומר...' : 'שמור'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="bg-white border-2 border-slate-100 hover:border-violet-200 rounded-2xl p-3 text-sm transition">
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${TYPE_STYLES[type] || 'bg-slate-100 text-slate-600'}`}>
          {TYPE_LABELS[type] || type}
        </span>
        <div className="flex items-center gap-2 text-slate-400">
          {date_time && <span className="text-xs">{new Date(date_time).toLocaleString('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</span>}
          <button onClick={() => setEditing(true)} className="hover:text-violet-500 transition text-xs" title="ערוך">✏️</button>
          <button onClick={() => onDelete(id)} className="hover:text-red-400 transition text-xs leading-none" title="מחק">✕</button>
        </div>
      </div>
      {notes && <p className="text-slate-600 mt-1 whitespace-pre-line text-sm">{notes}</p>}
    </div>
  );
}
