import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

const PRESETS = [
  { label: '15 דקות', minutes: 15 },
  { label: '30 דקות', minutes: 30 },
  { label: 'שעה',     minutes: 60 },
  { label: 'יום שלם', minutes: 1440 },
];

export default function PostponePage() {
  const { taskId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [task,       setTask]       = useState(null);
  const [error,      setError]      = useState('');
  const [selected,   setSelected]   = useState(null);
  const [customDate, setCustomDate] = useState('');
  const [saving,     setSaving]     = useState(false);
  const [done,       setDone]       = useState(false);

  useEffect(() => {
    if (!token) { setError('קישור לא תקין'); return; }
    fetch(`/api/tasks/${taskId}/postpone-info?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setTask(d); })
      .catch(() => setError('שגיאה בטעינה'));
  }, [taskId, token]);

  async function handleSubmit() {
    if (!selected || (selected === 'custom' && !customDate)) return;
    setSaving(true);
    const body = { token };
    if (selected === 'custom') body.dueAt = new Date(customDate).toISOString();
    else body.minutes = selected;

    try {
      const res  = await fetch(`/api/tasks/${taskId}/postpone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) setDone(true);
      else setError(data.error || 'שגיאה');
    } catch {
      setError('שגיאת רשת');
    }
    setSaving(false);
  }

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 to-indigo-50" dir="rtl">
      <div className="text-center p-6">
        <div className="text-4xl mb-3">❌</div>
        <p className="text-slate-600 font-semibold">{error}</p>
      </div>
    </div>
  );

  if (done) return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 to-indigo-50" dir="rtl">
      <div className="text-center p-6">
        <div className="text-4xl mb-3">✅</div>
        <p className="text-slate-700 font-bold text-lg">המשימה נדחתה בהצלחה</p>
        <p className="text-slate-500 text-sm mt-1">תקבל תזכורת בזמן החדש</p>
      </div>
    </div>
  );

  if (!task) return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 to-indigo-50">
      <div className="text-violet-600 font-semibold animate-pulse">טוען...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 to-indigo-50 flex items-start justify-center pt-12 px-4" dir="rtl">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-6 border border-violet-100">
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">⏰</div>
          <h1 className="text-lg font-black text-slate-800">{task.title}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{task.lead_name}</p>
        </div>

        <p className="text-sm font-bold text-slate-600 mb-3">דחה ל:</p>

        <div className="space-y-2 mb-4">
          {PRESETS.map(p => (
            <button key={p.minutes} onClick={() => setSelected(p.minutes)}
              className={`w-full py-3 rounded-xl font-bold text-base border-2 transition ${
                selected === p.minutes
                  ? 'border-violet-500 bg-violet-50 text-violet-700'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-violet-300'
              }`}>
              {p.label}
            </button>
          ))}
          <button onClick={() => setSelected('custom')}
            className={`w-full py-3 rounded-xl font-bold text-base border-2 transition ${
              selected === 'custom'
                ? 'border-violet-500 bg-violet-50 text-violet-700'
                : 'border-slate-200 bg-white text-slate-700 hover:border-violet-300'
            }`}>
            זמן מותאם אישית ✏️
          </button>
        </div>

        {selected === 'custom' && (
          <input type="datetime-local" value={customDate}
            onChange={e => setCustomDate(e.target.value)}
            className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 mb-4 text-slate-700 focus:outline-none focus:border-violet-400"
          />
        )}

        <button onClick={handleSubmit}
          disabled={!selected || saving || (selected === 'custom' && !customDate)}
          className="w-full py-3 rounded-xl font-black text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
          {saving ? 'שומר...' : 'דחה משימה'}
        </button>
      </div>
    </div>
  );
}
