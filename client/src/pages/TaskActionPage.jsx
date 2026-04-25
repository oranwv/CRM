import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

const POSTPONE_PRESETS = [
  { label: '15 דקות', minutes: 15 },
  { label: '30 דקות', minutes: 30 },
  { label: 'שעה',     minutes: 60 },
  { label: 'יום שלם', minutes: 1440 },
];

export default function TaskActionPage() {
  const { taskId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [task,   setTask]   = useState(null);
  const [error,  setError]  = useState('');
  const [done,   setDone]   = useState(''); // success message
  const [active, setActive] = useState(null); // 'complete' | 'postpone' | 'followup'

  // complete state
  const [result, setResult] = useState('');

  // postpone state
  const [postponeSelected, setPostponeSelected] = useState(null);
  const [customDate,        setCustomDate]        = useState('');

  // follow-up state
  const [followTitle, setFollowTitle] = useState('');
  const [followDate,  setFollowDate]  = useState('');

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) { setError('קישור לא תקין'); return; }
    fetch(`/api/tasks/${taskId}/postpone-info?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setTask(d); })
      .catch(() => setError('שגיאה בטעינה'));
  }, [taskId, token]);

  async function post(path, body) {
    setSaving(true);
    try {
      const res  = await fetch(`/api/tasks/${taskId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ...body }),
      });
      const data = await res.json();
      if (data.success) return true;
      setError(data.error || 'שגיאה');
      return false;
    } catch {
      setError('שגיאת רשת');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleComplete() {
    if (await post('complete', { result })) setDone('המשימה סומנה כהושלמה ✅');
  }

  async function handlePostpone() {
    if (!postponeSelected) return;
    const body = postponeSelected === 'custom'
      ? { dueAt: new Date(customDate).toISOString() }
      : { minutes: postponeSelected };
    if (await post('postpone', body)) setDone('המשימה נדחתה בהצלחה ⏰');
  }

  async function handleFollowup() {
    if (!followTitle.trim()) return;
    const body = { title: followTitle, dueAt: followDate ? new Date(followDate).toISOString() : undefined };
    if (await post('create-followup', body)) setDone('משימת המשך נוצרה ➕');
  }

  // ── Render states ──

  if (error) return (
    <Screen><div className="text-center"><div className="text-4xl mb-3">❌</div><p className="text-slate-600 font-semibold">{error}</p></div></Screen>
  );

  if (done) return (
    <Screen><div className="text-center"><div className="text-4xl mb-3">✅</div><p className="text-slate-700 font-bold text-lg">{done}</p></div></Screen>
  );

  if (!task) return (
    <Screen><div className="text-amber-600 font-semibold animate-pulse">טוען...</div></Screen>
  );

  return (
    <div className="min-h-screen bg-amber-50 flex items-start justify-center pt-8 px-4 pb-8" dir="rtl">
      <div className="w-full max-w-sm space-y-3">

        {/* Header */}
        <div className="bg-white rounded-2xl shadow p-4 text-center">
          <div className="text-2xl mb-1">⏰</div>
          <h1 className="text-base font-black text-slate-800">{task.title}</h1>
          <p className="text-sm text-slate-500">{task.lead_name}</p>
        </div>

        {/* Action 1 — Complete */}
        <ActionCard
          icon="✅" title="סמן כהושלם"
          open={active === 'complete'}
          onToggle={() => setActive(active === 'complete' ? null : 'complete')}
          color="green"
        >
          <textarea
            value={result}
            onChange={e => setResult(e.target.value)}
            placeholder="הוסף תוצאה (אופציונלי)..."
            rows={3}
            className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-slate-700 text-sm resize-none focus:outline-none focus:border-green-400 mb-3"
          />
          <ActionBtn onClick={handleComplete} saving={saving} color="green">
            סמן כהושלם
          </ActionBtn>
        </ActionCard>

        {/* Action 2 — Postpone */}
        <ActionCard
          icon="🔁" title="קבע מחדש (לא ענה)"
          open={active === 'postpone'}
          onToggle={() => setActive(active === 'postpone' ? null : 'postpone')}
          color="amber"
        >
          <div className="space-y-2 mb-3">
            {POSTPONE_PRESETS.map(p => (
              <button key={p.minutes} onClick={() => setPostponeSelected(p.minutes)}
                className={`w-full py-2.5 rounded-xl font-bold text-sm border-2 transition ${
                  postponeSelected === p.minutes
                    ? 'border-amber-500 bg-amber-50 text-amber-700'
                    : 'border-slate-200 bg-white text-slate-700'
                }`}>
                {p.label}
              </button>
            ))}
            <button onClick={() => setPostponeSelected('custom')}
              className={`w-full py-2.5 rounded-xl font-bold text-sm border-2 transition ${
                postponeSelected === 'custom'
                  ? 'border-amber-500 bg-amber-50 text-amber-700'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}>
              זמן מותאם ✏️
            </button>
          </div>
          {postponeSelected === 'custom' && (
            <input type="datetime-local" value={customDate}
              onChange={e => setCustomDate(e.target.value)}
              className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-slate-700 text-sm focus:outline-none focus:border-amber-400 mb-3"
            />
          )}
          <ActionBtn
            onClick={handlePostpone} saving={saving} color="amber"
            disabled={!postponeSelected || (postponeSelected === 'custom' && !customDate)}>
            קבע מחדש
          </ActionBtn>
        </ActionCard>

        {/* Action 3 — Follow-up */}
        <ActionCard
          icon="➕" title="צור משימת המשך"
          open={active === 'followup'}
          onToggle={() => setActive(active === 'followup' ? null : 'followup')}
          color="blue"
        >
          <input
            type="text"
            value={followTitle}
            onChange={e => setFollowTitle(e.target.value)}
            placeholder="כותרת המשימה..."
            className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-slate-700 text-sm focus:outline-none focus:border-blue-400 mb-2"
          />
          <input type="datetime-local" value={followDate}
            onChange={e => setFollowDate(e.target.value)}
            className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-slate-700 text-sm focus:outline-none focus:border-blue-400 mb-3"
          />
          <ActionBtn
            onClick={handleFollowup} saving={saving} color="blue"
            disabled={!followTitle.trim()}>
            צור משימה
          </ActionBtn>
        </ActionCard>

      </div>
    </div>
  );
}

function Screen({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-amber-50" dir="rtl">
      <div className="p-6">{children}</div>
    </div>
  );
}

function ActionCard({ icon, title, open, onToggle, color, children }) {
  const borders = { green: 'border-green-200', amber: 'border-amber-200', blue: 'border-blue-200' };
  const headers = { green: 'text-green-700', amber: 'text-amber-700', blue: 'text-blue-700' };
  return (
    <div className={`bg-white rounded-2xl shadow border-2 ${open ? borders[color] : 'border-transparent'} overflow-hidden`}>
      <button onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-right">
        <span className="text-xl">{icon}</span>
        <span className={`font-black text-base flex-1 ${open ? headers[color] : 'text-slate-700'}`}>{title}</span>
        <span className="text-slate-400 text-sm">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function ActionBtn({ onClick, saving, color, disabled, children }) {
  const colors = {
    green: 'bg-green-600 hover:bg-green-700',
    amber: 'bg-amber-600 hover:bg-amber-700',
    blue:  'bg-blue-600  hover:bg-blue-700',
  };
  return (
    <button onClick={onClick}
      disabled={saving || disabled}
      className={`w-full py-3 rounded-xl font-black text-white transition ${colors[color]} disabled:opacity-40 disabled:cursor-not-allowed`}>
      {saving ? 'שומר...' : children}
    </button>
  );
}
