import { useState, useEffect, useRef } from 'react';
import api from '../api';

const SOURCE_LABELS = { bank: 'בנק', cal: 'כאל', max: 'מקס' };
const SOURCE_COLORS = { bank: 'bg-sky-100 text-sky-700', cal: 'bg-violet-100 text-violet-700', max: 'bg-orange-100 text-orange-700' };
const TYPE_LABELS = { bank: 'דף בנק', credit_cal: 'אשראי כאל', credit_max: 'אשראי מקס', karteset: 'כרטסת', unknown: 'לא זוהה' };

const fmtAmount = (n) => Number(n).toLocaleString('he-IL', { maximumFractionDigits: 0 });
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('he-IL') : '');

function ExpenseRow({ item, onChanged }) {
  const [open, setOpen]         = useState(false);
  const [status, setStatus]     = useState(item.status || '');
  const [notes, setNotes]       = useState(null);
  const [newNote, setNewNote]   = useState('');
  const [busy, setBusy]         = useState(false);

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && notes === null) {
      try { const { data } = await api.get(`/finance/missing/${item.id}/notes`); setNotes(data); } catch { setNotes([]); }
    }
  }

  async function saveStatus() {
    if ((item.status || '') === status.trim()) return;
    try {
      await api.patch(`/finance/missing/${item.id}`, { status: status.trim() });
      onChanged();
    } catch {}
  }

  async function addNote() {
    const body = newNote.trim();
    if (!body) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/finance/missing/${item.id}/notes`, { body });
      setNotes(prev => [data, ...(prev || [])]);
      setNewNote('');
    } catch {} finally { setBusy(false); }
  }

  async function toggleResolved() {
    setBusy(true);
    try {
      await api.patch(`/finance/missing/${item.id}`, { resolved: !item.resolved });
      onChanged();
    } catch {} finally { setBusy(false); }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={toggleOpen}>
        <button type="button" onClick={e => { e.stopPropagation(); toggleResolved(); }} disabled={busy}
          title={item.resolved ? 'החזר לרשימה' : 'סמן כטופל'}
          className={`w-7 h-7 shrink-0 rounded-full border-2 flex items-center justify-center font-black text-sm transition ${
            item.resolved ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 text-transparent hover:border-emerald-400 hover:text-emerald-400'
          }`}>✓</button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-black text-slate-800 text-base">{fmtAmount(item.amount)} ₪</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${SOURCE_COLORS[item.source] || 'bg-slate-100 text-slate-600'}`}>
              {SOURCE_LABELS[item.source] || item.source}
            </span>
            {item.entry_date && <span className="text-xs text-slate-400">{fmtDate(item.entry_date)}</span>}
          </div>
          <p className="text-sm text-slate-600 truncate">{item.name || item.description || '—'}</p>
          {item.status && (
            <p className="text-xs text-amber-700 truncate">
              {item.status}
              {item.status_updated_at && <span className="text-slate-400"> · {fmtDate(item.status_updated_at)}</span>}
            </p>
          )}
        </div>
        <span className="text-slate-300 text-sm shrink-0">{open ? '▲' : '▼'}{item.note_count > 0 && <span className="ml-1 text-slate-400">({item.note_count})</span>}</span>
      </div>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-3 bg-slate-50/50">
          {item.description && <p className="text-xs text-slate-500">{item.description}</p>}
          <div>
            <label className="text-xs font-bold text-slate-500 mb-1 block">סטטוס</label>
            <input value={status} onChange={e => setStatus(e.target.value)} onBlur={saveStatus}
              onKeyDown={e => e.key === 'Enter' && e.target.blur()}
              placeholder='למשל: התקשרתי לספק, ישלח חשבונית'
              className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-violet-400" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 mb-1 block">הערות</label>
            <div className="flex gap-2 mb-2">
              <input value={newNote} onChange={e => setNewNote(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addNote()}
                placeholder="הוסף הערה (טלפון של הספק, מי העסק...)"
                className="flex-1 text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-violet-400" />
              <button type="button" onClick={addNote} disabled={busy || !newNote.trim()}
                className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-bold disabled:opacity-40">הוסף</button>
            </div>
            {(notes || []).map(n => (
              <div key={n.id} className="text-sm text-slate-700 bg-white rounded-xl px-3 py-2 mb-1.5 border border-slate-100">
                <p>{n.body}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {new Date(n.created_at).toLocaleDateString('he-IL')} {new Date(n.created_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                  {n.author ? ` · ${n.author}` : ''}
                </p>
              </div>
            ))}
            {notes !== null && !notes.length && <p className="text-xs text-slate-400">אין הערות עדיין</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function FinancePage() {
  const [items, setItems]           = useState([]);
  const [showResolved, setShowResolved] = useState(false);
  const [loading, setLoading]       = useState(true);
  const [files, setFiles]           = useState([]);
  const [running, setRunning]       = useState(false);
  const [summary, setSummary]       = useState(null);
  const [error, setError]           = useState(null);
  const [exclusions, setExclusions] = useState([]);
  const [newExclusion, setNewExclusion] = useState('');
  const fileRef = useRef(null);

  async function load() {
    try {
      const { data } = await api.get(`/finance/missing?resolved=${showResolved}`);
      setItems(data);
    } catch {} finally { setLoading(false); }
  }
  useEffect(() => { setLoading(true); load(); }, [showResolved]);
  useEffect(() => {
    api.get('/finance/exclusions').then(r => setExclusions(r.data.exclusions || [])).catch(() => {});
  }, []);

  async function saveExclusions(next) {
    setExclusions(next);
    try { await api.put('/finance/exclusions', { exclusions: next }); } catch {}
  }

  async function runReconcile() {
    if (!files.length) return;
    setRunning(true); setError(null); setSummary(null);
    try {
      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      const { data } = await api.post('/finance/reconcile', fd);
      setSummary(data);
      setFiles([]);
      if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה בהשוואה');
    } finally { setRunning(false); }
  }

  return (
    <div className="min-h-screen bg-slate-50" dir="rtl">
      <div className="max-w-3xl mx-auto p-4 space-y-4">
        <div className="text-right pt-2">
          <h1 className="text-lg font-black text-stone-900">כספים — התאמת חשבוניות</h1>
          <p className="text-stone-400 text-xs">השוואת הוצאות בנק ואשראי מול הכרטסת — מעקב אחר חשבוניות חסרות</p>
        </div>

        {/* Upload + run */}
        <div className="bg-white rounded-2xl border border-violet-100 shadow-sm p-4 space-y-3">
          <label className="block w-full py-4 rounded-xl font-bold text-sm text-center cursor-pointer border-2 border-dashed border-violet-300 text-violet-600 hover:bg-violet-50 transition">
            {files.length ? `${files.length} קבצים נבחרו` : '+ בחר קבצים: דף בנק (PDF), אשראי כאל/מקס וכרטסת (אקסל)'}
            <input ref={fileRef} type="file" multiple accept=".pdf,.xlsx,.xls" className="hidden"
              onChange={e => setFiles(Array.from(e.target.files || []))} />
          </label>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <span key={i} className="text-xs bg-slate-100 text-slate-600 rounded-lg px-2 py-1">{f.name}</span>
              ))}
            </div>
          )}

          {/* Exclusions */}
          <div>
            <p className="text-xs font-bold text-slate-500 mb-1">החרגות (תנועות בנק שמכילות מילים אלו לא ייבדקו)</p>
            <div className="flex flex-wrap gap-1.5 items-center">
              {exclusions.map((ex, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-lg px-2 py-1">
                  {ex}
                  <button type="button" onClick={() => saveExclusions(exclusions.filter((_, j) => j !== i))}
                    className="text-amber-400 hover:text-amber-700 font-bold">×</button>
                </span>
              ))}
              <input value={newExclusion} onChange={e => setNewExclusion(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && newExclusion.trim()) { saveExclusions([...exclusions, newExclusion.trim()]); setNewExclusion(''); } }}
                placeholder="+ הוסף החרגה"
                className="text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:border-violet-400 w-28" />
            </div>
          </div>

          <button type="button" onClick={runReconcile} disabled={running || !files.length}
            className="w-full py-2.5 rounded-xl font-black text-sm text-white disabled:opacity-40 transition"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
            {running ? 'משווה...' : 'השווה מול הכרטסת'}
          </button>

          {error && <p className="text-sm text-red-600 font-bold">{error}</p>}
          {summary && (
            <div className="text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-3 py-2">
              נמצאו <strong>{summary.newCount}</strong> חוסרים חדשים
              {summary.knownCount > 0 && <> · <strong>{summary.knownCount}</strong> כבר במעקב</>}
              {summary.resolvedCount > 0 && <> · <strong>{summary.resolvedCount}</strong> טופלו בעבר</>}
              <span className="block text-xs text-emerald-600 mt-0.5">
                נבדקו {summary.totalEntries} תנועות מול {summary.kartesetCount} רשומות כרטסת
                {summary.sources?.length ? ` (${summary.sources.map(s => TYPE_LABELS[s.type] || s.type).join(', ')})` : ''}
              </span>
            </div>
          )}
        </div>

        {/* List */}
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setShowResolved(v => !v)}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition ${showResolved ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-300'}`}>
            {showResolved ? 'חזרה לפתוחים' : 'הצג פתורים'}
          </button>
          <p className="text-sm font-bold text-slate-600">
            {showResolved ? 'טופלו' : 'חשבוניות חסרות'} ({items.length})
          </p>
        </div>

        {loading ? (
          <p className="text-center text-slate-400 py-8 text-sm">טוען...</p>
        ) : items.length === 0 ? (
          <p className="text-center text-slate-400 py-8 text-sm">
            {showResolved ? 'אין פריטים שטופלו' : 'אין חשבוניות חסרות — הכול מותאם ✓'}
          </p>
        ) : (
          <div className="space-y-2">
            {items.map(item => <ExpenseRow key={item.id} item={item} onChanged={load} />)}
          </div>
        )}
      </div>
    </div>
  );
}
