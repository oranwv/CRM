import { useState, useEffect } from 'react';
import api from '../api';
import { TaskRow } from './TaskItems';

// Phase 55 — the overdue-tasks gate. Opens by itself when the app loads (or the mode changes) and
// the signed-in user has tasks whose date has passed. Each one has to be dealt with — בוצע /
// דחייה / לא רלוונטי — and the window closes itself when the list is empty. The × closes it
// for this visit; the red "משימות באיחור" badge in the header brings it back.
export default function OverdueTasksModal({ onClose }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  function load() {
    api.get('/my-tasks/overdue')
      .then(r => setItems(r.data.items || []))
      .catch(err => setError(err.response?.data?.error || 'שגיאה בטעינת המשימות'));
  }
  useEffect(load, []);

  function changed(t) {
    setItems(list => {
      const next = (list || []).filter(x => !(x.kind === t.kind && x.id === t.id));
      if (next.length === 0) setTimeout(onClose, 400);
      return next;
    });
  }

  const n = items?.length || 0;
  return (
    <div className="fixed inset-0 z-[79] flex items-center justify-center bg-black/60 p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="min-w-0">
            <h2 className="font-black text-slate-800 text-base">⏰ {n > 0 ? `${n} ${n === 1 ? 'משימה' : 'משימות'} באיחור` : 'משימות באיחור'}</h2>
            <p className="text-xs text-slate-500 mt-0.5">לכל משימה: ✓ בוצע · ⏭ דחייה למועד חדש · 🚫 לא רלוונטי</p>
          </div>
          <button onClick={onClose} className="shrink-0 mr-3 text-slate-400 hover:text-slate-600 text-2xl leading-none" aria-label="סגור">&times;</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {items === null && !error && <p className="text-center text-slate-400 text-sm py-8">טוען...</p>}
          {error && <p className="text-center text-red-500 text-sm py-8">{error}</p>}
          {items && items.length === 0 && <p className="text-center text-emerald-600 font-bold text-sm py-8">הכול טופל ✅</p>}
          {items?.map(t => <TaskRow key={`${t.kind}-${t.id}`} t={t} onChanged={changed} />)}
        </div>
      </div>
    </div>
  );
}
