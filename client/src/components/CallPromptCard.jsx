// הגדרות → "הנחיות לסיכום שיחות": the guidelines the model follows when it summarises a phone
// call (Oran, 2026-11-18). Managers replace the text freely; the output fields and the call's
// own data are added by the server and are not part of this text (see callAnalysisPrompt.js).
// "נסה על שיחה" runs the text in the box — saved or not — on an existing call, without saving.
import { useEffect, useState } from 'react';
import api from '../api';

export default function CallPromptCard() {
  const [data, setData] = useState(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [callId, setCallId] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get('/calls/analysis-prompt')
      .then(r => { setData(r.data); setText(r.data.value || ''); setCallId(r.data.calls?.[0]?.id ? String(r.data.calls[0].id) : ''); })
      .catch(e => setError(e.response?.data?.error || 'לא ניתן לטעון את ההנחיות'));
  }, []);

  async function save() {
    setSaving(true); setSaved(false); setError('');
    try {
      // The default text is stored as "empty", so a future improved default reaches everyone
      const value = text.trim() === (data?.default || '').trim() ? '' : text;
      await api.put('/admin/settings/call_analysis_prompt', { value });
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch (e) { setError(e.response?.data?.error || 'השמירה נכשלה'); }
    finally { setSaving(false); }
  }
  function restore() {
    if (!data?.default) return;
    if (!confirm('להחזיר את נוסח ברירת המחדל לתיבה? (נשמר רק אחרי לחיצה על "שמור")')) return;
    setText(data.default);
  }
  async function test() {
    if (!callId) return;
    setTesting(true); setResult(null); setError('');
    try { const r = await api.post('/calls/analysis-prompt/test', { callId: Number(callId), prompt: text }); setResult(r.data); }
    catch (e) { setError(e.response?.data?.error || 'הבדיקה נכשלה'); }
    finally { setTesting(false); }
  }
  const callLabel = (c) => `${c.lead_name || 'ליד'} · ${new Date(c.started_at).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })} · ${Math.max(1, Math.round((c.duration_sec || 0) / 60))} דק׳ · ${c.direction === 'inbound' ? 'נכנסת' : 'יוצאת'}`;

  return (
    <div className="rounded-2xl p-4 bg-white border border-violet-100 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">📞</span>
        <h2 className="font-black text-base text-slate-800">הנחיות לסיכום שיחות</h2>
      </div>
      <p className="text-xs mb-3 text-slate-400 leading-relaxed">
        לפי ההנחיות האלה ה-AI מסכם כל שיחת טלפון מוקלטת. אפשר למחוק ולהדביק נוסח חדש. שינוי חל על שיחות חדשות בלבד.
        מבנה הפלט (השדות) ונתוני השיחה עצמה מתווספים אוטומטית — אם הם מופיעים בנוסח שהודבק, הם מוסרים.
      </p>
      {!data && !error ? (
        <div className="text-xs animate-pulse text-slate-400">טוען...</div>
      ) : (
        <>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={16} dir="rtl"
            className="w-full rounded-xl px-3 py-2.5 text-sm resize-y focus:outline-none border border-violet-200 focus:border-violet-400 text-slate-700"
            style={{ fontFamily: 'inherit', lineHeight: '1.6' }} />
          <div className="flex items-center justify-between mt-1 text-[11px] text-slate-400">
            <span>{text.length.toLocaleString('he-IL')} תווים</span>
            <button onClick={restore} className="underline hover:text-violet-600">שחזר ברירת מחדל</button>
          </div>
          <button onClick={save} disabled={saving || !data}
            className="mt-3 w-full py-2.5 rounded-xl font-black text-sm transition disabled:opacity-50 text-white"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
            {saving ? 'שומר...' : saved ? '✅ נשמר' : 'שמור הנחיות'}
          </button>

          <div className="mt-4 pt-3 border-t border-slate-100">
            <div className="text-xs font-black text-slate-600 mb-1.5">נסה את הנוסח שבתיבה על שיחה קיימת (לא נשמר בליד)</div>
            {data?.calls?.length ? (
              <div className="flex items-center gap-2 flex-wrap">
                <select value={callId} onChange={e => setCallId(e.target.value)}
                  className="flex-1 min-w-[180px] border border-slate-300 rounded-xl px-2 py-2 text-sm bg-white">
                  {data.calls.map(c => <option key={c.id} value={c.id}>{callLabel(c)}</option>)}
                </select>
                <button onClick={test} disabled={testing || !callId}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-violet-50 border border-slate-200 hover:border-violet-300 text-sm font-black text-slate-700 disabled:opacity-50">
                  {testing ? 'מסכם… (עד דקה)' : 'נסה'}
                </button>
              </div>
            ) : <div className="text-xs text-slate-400">אין עדיין שיחות עם תמלול לנסות עליהן.</div>}
            {result && (
              <div className="mt-3 grid sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] font-black text-violet-700 mb-1">לפי הנוסח שבתיבה</div>
                  <div className="text-xs text-slate-700 whitespace-pre-wrap bg-violet-50 border border-violet-100 rounded-xl p-3 leading-relaxed">{result.text}</div>
                </div>
                <div>
                  <div className="text-[11px] font-black text-slate-500 mb-1">הסיכום השמור היום בליד</div>
                  <div className="text-xs text-slate-600 whitespace-pre-wrap bg-slate-50 border border-slate-200 rounded-xl p-3 leading-relaxed">{result.current || '—'}</div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
    </div>
  );
}
