import { useState, useEffect, useRef } from 'react';
import api from '../api';

const SOURCE_LABELS = { bank: 'בנק', cal: 'כאל', max: 'מקס' };
const SOURCE_COLORS = { bank: 'bg-sky-100 text-sky-700', cal: 'bg-violet-100 text-violet-700', max: 'bg-orange-100 text-orange-700' };
const TYPE_LABELS = { bank: 'דף בנק', credit_cal: 'אשראי כאל', credit_max: 'אשראי מקס', karteset: 'כרטסת', unknown: 'לא זוהה' };

const fmtAmount = (n) => Number(n).toLocaleString('he-IL', { maximumFractionDigits: 0 });
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('he-IL') : '');

function ExpenseRow({ item, onChanged, periods = [], periodId }) {
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

  async function moveToPeriod(targetId) {
    const target = periods.find(p => p.id === targetId);
    if (!target) return;
    if (!confirm(`להעביר את ההוצאה לתקופה "${target.name}"? היא תיסגר שם אוטומטית כשתועלה כרטסת שמכילה את הסכום.`)) return;
    setBusy(true);
    try {
      await api.post(`/finance/missing/${item.id}/move`, { periodId: targetId });
      onChanged();
    } catch (err) {
      alert(err.response?.data?.error || 'שגיאה בהעברה');
    } finally { setBusy(false); }
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
            {item.deferred_from_name && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                הועבר מ־{item.deferred_from_name}
              </span>
            )}
            {item.entry_date && <span className="text-xs text-slate-400">{fmtDate(item.entry_date)}</span>}
          </div>
          <p className="text-sm text-slate-600 truncate">
            <span className="text-slate-400">
              {item.source === 'bank'
                ? (item.name && item.name !== item.description ? 'מוטב: ' : 'סוג פעולה: ')
                : 'בית עסק: '}
            </span>
            {item.name || item.description || '—'}
          </p>
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
          {periods.filter(p => p.id !== periodId).length > 0 && !item.resolved && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-slate-500">העבר לתקופה:</label>
              <select value="" onChange={e => e.target.value && moveToPeriod(Number(e.target.value))} disabled={busy}
                className="text-xs bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-violet-400">
                <option value="">בחר תקופה...</option>
                {periods.filter(p => p.id !== periodId).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <span className="text-[11px] text-slate-400">לחשבונית שהונפקה בתקופת הדיווח הבאה</span>
            </div>
          )}
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

// ── Invoice email scanning (Gmail → Drive monthly folders) ───────────────────
function InvoiceScanSection() {
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const shift = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const monthEdge = (offset, end) => { // offset months back; end=false → first day, true → last day
    const d = new Date();
    const first = new Date(d.getFullYear(), d.getMonth() - offset, 1);
    const last  = new Date(d.getFullYear(), d.getMonth() - offset + 1, 0);
    return (end ? last : first).toLocaleDateString('sv-SE'); // YYYY-MM-DD
  };

  const PRESETS = [
    { label: 'יום אחרון',      from: () => todayStr(),      to: () => todayStr() },
    { label: 'שבוע אחרון',     from: () => shift(-6),       to: () => todayStr() },
    { label: 'חודש אחרון',     from: () => shift(-29),      to: () => todayStr() },
    { label: 'חודש קודם',      from: () => monthEdge(1),    to: () => monthEdge(1, true) },
    { label: 'חודשיים קודמים', from: () => monthEdge(2),    to: () => monthEdge(1, true) },
  ];

  const [accounts, setAccounts] = useState([]);
  const [from, setFrom]         = useState(todayStr());
  const [to, setTo]             = useState(todayStr());
  const [activePreset, setActivePreset] = useState('יום אחרון');
  const [scanning, setScanning] = useState(false);
  const [result, setResult]     = useState(null);
  const [error, setError]       = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [showInvoices, setShowInvoices] = useState(false);

  const loadAccounts = () => api.get('/finance/gmail/accounts').then(r => setAccounts(r.data)).catch(() => {});
  const loadInvoices = () => api.get('/finance/invoices').then(r => setInvoices(r.data)).catch(() => {});
  useEffect(() => { loadAccounts(); }, []);

  async function connectMailbox() {
    try {
      const { data } = await api.get('/finance/gmail/connect-url');
      window.open(data.url, '_blank', 'width=520,height=680');
      // refresh list when the popup likely finished
      setTimeout(loadAccounts, 15000);
    } catch (err) {
      alert(err.response?.data?.error || 'שגיאה');
    }
  }

  async function removeAccount(id) {
    if (!confirm('להסיר את התיבה מהסריקה?')) return;
    try { await api.delete(`/finance/gmail/accounts/${id}`); loadAccounts(); } catch {}
  }

  async function runScan() {
    setScanning(true); setError(null); setResult(null);
    try {
      const { data } = await api.post('/finance/scan', { from, to });
      setResult(data);
      loadInvoices(); setShowInvoices(true);
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה בסריקה');
    } finally { setScanning(false); }
  }

  return (
    <div className="bg-white rounded-2xl border border-violet-100 shadow-sm p-4 space-y-3">
      <div>
        <p className="font-bold text-slate-800 text-sm">סריקת חשבוניות ממייל</p>
        <p className="text-xs text-slate-400">סורק את המיילים, מזהה חשבוניות ספקים (מילות מפתח + AI) ושומר אותן בדרייב בתיקייה חודשית. סריקה אוטומטית רצה פעם ביום.</p>
      </div>

      {/* Connected accounts */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs bg-slate-100 text-slate-600 rounded-lg px-2 py-1">תיבת העסק (ראשית)</span>
        {accounts.map(a => (
          <span key={a.id} className="inline-flex items-center gap-1 text-xs bg-sky-50 text-sky-700 border border-sky-200 rounded-lg px-2 py-1" dir="ltr">
            {a.email}
            <button type="button" onClick={() => removeAccount(a.id)} className="text-sky-400 hover:text-red-500 font-bold">×</button>
          </span>
        ))}
        <button type="button" onClick={connectMailbox}
          className="text-xs font-bold text-violet-600 border border-dashed border-violet-300 rounded-lg px-2 py-1 hover:bg-violet-50">
          + חבר תיבת מייל
        </button>
      </div>

      {/* Range presets */}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map(p => (
          <button key={p.label} type="button"
            onClick={() => { setFrom(p.from()); setTo(p.to()); setActivePreset(p.label); }}
            className={`text-xs font-bold px-2.5 py-1.5 rounded-lg border transition ${activePreset === p.label ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
            {p.label}
          </button>
        ))}
        <button type="button" onClick={() => setActivePreset('custom')}
          className={`text-xs font-bold px-2.5 py-1.5 rounded-lg border transition ${activePreset === 'custom' ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
          טווח מותאם
        </button>
      </div>
      {activePreset === 'custom' && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>מ-</span>
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
            className="border border-slate-300 rounded-xl px-2 py-1.5 text-sm bg-white" style={{ direction: 'ltr' }} />
          <span>עד</span>
          <input type="date" value={to} min={from} max={todayStr()} onChange={e => setTo(e.target.value)}
            className="border border-slate-300 rounded-xl px-2 py-1.5 text-sm bg-white" style={{ direction: 'ltr' }} />
        </div>
      )}

      <button type="button" onClick={runScan} disabled={scanning}
        className="w-full py-2.5 rounded-xl font-black text-sm text-white disabled:opacity-40 transition"
        style={{ background: 'linear-gradient(135deg, #0ea5e9, #6366f1)' }}>
        {scanning ? 'סורק מיילים... (יכול לקחת כמה דקות)' : `סרוק מיילים (${from} עד ${to})`}
      </button>

      {error && <p className="text-sm text-red-600 font-bold">{error}</p>}
      {result && (
        <div className="text-sm bg-sky-50 border border-sky-200 text-sky-800 rounded-xl px-3 py-2 space-y-0.5">
          <p>נסרקו <strong>{result.scanned}</strong> מיילים · זוהו <strong>{result.invoices}</strong> חשבוניות · נשמרו <strong>{result.filesSaved}</strong> קבצים בדרייב</p>
          {!result.aiUsed && <p className="text-amber-700 text-xs">⚠️ סיווג AI לא פעיל (OPENAI_API_KEY חסר) — זיהוי לפי מילות מפתח בלבד</p>}
          {result.failures?.length > 0 && (
            <div className="text-xs text-red-600 pt-1">
              {result.failures.slice(0, 5).map((f, i) => <p key={i}>✗ {f.subject || f.account}: {f.error}</p>)}
              {result.failures.length > 5 && <p>ועוד {result.failures.length - 5} כשלונות...</p>}
            </div>
          )}
        </div>
      )}

      <button type="button" onClick={() => { if (!showInvoices) loadInvoices(); setShowInvoices(v => !v); }}
        className="text-xs font-bold text-slate-500 underline">
        {showInvoices ? 'הסתר חשבוניות שנשמרו' : 'הצג חשבוניות שנשמרו'}
      </button>
      {showInvoices && (
        <div className="space-y-1.5 max-h-80 overflow-y-auto">
          {invoices.length === 0 && <p className="text-xs text-slate-400">אין חשבוניות שמורות עדיין</p>}
          {invoices.map(inv => (
            <div key={inv.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-100 text-xs">
              <div className="min-w-0">
                <p className="font-medium text-slate-700 truncate">{inv.email_subject || inv.filename}</p>
                <p className="text-slate-400 truncate">
                  {inv.email_date ? new Date(inv.email_date).toLocaleDateString('he-IL') : ''}
                  {inv.drive_folder ? ` · תיקייה ${inv.drive_folder}` : ''}
                  {inv.status === 'failed' ? ` · נכשל: ${inv.error}` : ''}
                </p>
              </div>
              {inv.status === 'saved' && inv.drive_link
                ? <a href={inv.drive_link} target="_blank" rel="noreferrer" className="text-violet-600 font-bold shrink-0">פתח בדרייב</a>
                : <span className="text-red-500 font-bold shrink-0">✗</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FinancePage() {
  const [items, setItems]           = useState([]);
  const [showResolved, setShowResolved] = useState(false);
  const [loading, setLoading]       = useState(true);
  const [periods, setPeriods]       = useState([]);
  const [periodId, setPeriodId]     = useState(() => Number(localStorage.getItem('finance_period')) || null);
  const [newPeriodName, setNewPeriodName] = useState('');
  const [addingPeriod, setAddingPeriod]   = useState(false);
  const [sourceTab, setSourceTab]   = useState('all');
  const [rekRunning, setRekRunning] = useState(false);
  const [rekResult, setRekResult]   = useState(null);
  const rekRef = useRef(null);
  const [kartesetFiles, setKartesetFiles] = useState([]);
  const [expenseFiles, setExpenseFiles]   = useState([]);
  const [running, setRunning]       = useState(false);
  const [summary, setSummary]       = useState(null);
  const [error, setError]           = useState(null);
  const [exclusions, setExclusions] = useState([]);
  const [newExclusion, setNewExclusion] = useState('');
  const kartesetRef = useRef(null);
  const expenseRef  = useRef(null);

  async function load() {
    if (!periodId) { setItems([]); setLoading(false); return; }
    try {
      const { data } = await api.get(`/finance/missing?resolved=${showResolved}&periodId=${periodId}`);
      setItems(data);
    } catch {} finally { setLoading(false); }
  }
  useEffect(() => { setLoading(true); load(); }, [showResolved, periodId]);
  useEffect(() => {
    api.get('/finance/exclusions').then(r => setExclusions(r.data.exclusions || [])).catch(() => {});
    loadPeriods();
  }, []);

  async function loadPeriods() {
    try {
      const { data } = await api.get('/finance/periods');
      setPeriods(data);
      // Keep a valid selection: stored one if it still exists, else the newest
      setPeriodId(prev => (prev && data.some(p => p.id === prev)) ? prev : (data[0]?.id || null));
    } catch {}
  }

  function selectPeriod(id) {
    setPeriodId(id);
    localStorage.setItem('finance_period', String(id));
  }

  async function createPeriod() {
    const name = newPeriodName.trim();
    if (!name) return;
    try {
      const { data } = await api.post('/finance/periods', { name });
      setPeriods(prev => [data, ...prev]);
      selectPeriod(data.id);
      setNewPeriodName(''); setAddingPeriod(false);
    } catch (err) {
      alert(err.response?.data?.error || 'שגיאה');
    }
  }

  async function deletePeriod(id, name) {
    if (!confirm(`למחוק את התקופה "${name}"? כל רשימת החוסרים וההערות שלה יימחקו לצמיתות.`)) return;
    try {
      await api.delete(`/finance/periods/${id}`);
      loadPeriods();
    } catch (err) {
      alert(err.response?.data?.error || 'שגיאה');
    }
  }

  async function saveExclusions(next) {
    setExclusions(next);
    try { await api.put('/finance/exclusions', { exclusions: next }); } catch {}
  }

  // Upload ONLY the accountant's updated karteset — re-compares against the
  // expenses stored from the last full run; newly-covered items auto-resolve.
  async function runRekarteset(files) {
    if (!files.length || !periodId) return;
    setRekRunning(true); setError(null); setRekResult(null);
    try {
      const fd = new FormData();
      fd.append('periodId', String(periodId));
      files.forEach(f => fd.append('kartesetFiles', f));
      const { data } = await api.post('/finance/rekarteset', fd);
      setRekResult(data);
      load(); loadPeriods();
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה בהעלאת הכרטסת');
    } finally {
      setRekRunning(false);
      if (rekRef.current) rekRef.current.value = '';
    }
  }

  async function runReconcile() {
    if (!kartesetFiles.length || !expenseFiles.length || !periodId) return;
    setRunning(true); setError(null); setSummary(null);
    try {
      const fd = new FormData();
      fd.append('periodId', String(periodId));
      kartesetFiles.forEach(f => fd.append('kartesetFiles', f));
      expenseFiles.forEach(f => fd.append('expenseFiles', f));
      const { data } = await api.post('/finance/reconcile', fd);
      setSummary(data);
      setKartesetFiles([]); setExpenseFiles([]);
      if (kartesetRef.current) kartesetRef.current.value = '';
      if (expenseRef.current)  expenseRef.current.value = '';
      load(); loadPeriods();
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

        <InvoiceScanSection />

        {/* Period selector — each reconciliation round is a saved workspace */}
        <div className="bg-white rounded-2xl border border-violet-100 shadow-sm p-4 space-y-2">
          <p className="font-bold text-slate-800 text-sm">תקופות התאמה</p>
          <div className="flex flex-wrap gap-1.5 items-center">
            {periods.map(p => (
              <span key={p.id}
                className={`inline-flex items-center gap-1.5 text-xs font-bold rounded-lg px-2.5 py-1.5 cursor-pointer border transition ${
                  p.id === periodId ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
                onClick={() => selectPeriod(p.id)}>
                {p.name}
                {p.open_count > 0 && (
                  <span className={`text-[10px] rounded-full px-1.5 ${p.id === periodId ? 'bg-white/25' : 'bg-amber-100 text-amber-700'}`}>{p.open_count}</span>
                )}
                <button type="button" onClick={e => { e.stopPropagation(); deletePeriod(p.id, p.name); }}
                  className={`font-bold ${p.id === periodId ? 'text-white/60 hover:text-white' : 'text-slate-300 hover:text-red-500'}`}>×</button>
              </span>
            ))}
            {addingPeriod ? (
              <span className="inline-flex items-center gap-1">
                <input value={newPeriodName} onChange={e => setNewPeriodName(e.target.value)} autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') createPeriod(); if (e.key === 'Escape') setAddingPeriod(false); }}
                  placeholder='למשל: יולי-אוגוסט 2026'
                  className="text-xs border border-violet-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-violet-500 w-40" />
                <button type="button" onClick={createPeriod} disabled={!newPeriodName.trim()}
                  className="text-xs font-bold px-2 py-1.5 rounded-lg bg-violet-600 text-white disabled:opacity-40">צור</button>
              </span>
            ) : (
              <button type="button" onClick={() => setAddingPeriod(true)}
                className="text-xs font-bold text-violet-600 border border-dashed border-violet-300 rounded-lg px-2.5 py-1.5 hover:bg-violet-50">
                + תקופה חדשה
              </button>
            )}
          </div>
          {!periodId && <p className="text-xs text-amber-600 font-bold">צור או בחר תקופה כדי להתחיל השוואה</p>}
        </div>

        {/* Upload + run */}
        <div className="bg-white rounded-2xl border border-violet-100 shadow-sm p-4 space-y-3">
          {/* Karteset files (one or more months) */}
          <div>
            <p className="text-xs font-bold text-slate-500 mb-1">קבצי כרטסת (אפשר כמה חודשים — למשל מאי + יוני)</p>
            <label className="block w-full py-3 rounded-xl font-bold text-sm text-center cursor-pointer border-2 border-dashed border-emerald-300 text-emerald-600 hover:bg-emerald-50 transition">
              {kartesetFiles.length ? `${kartesetFiles.length} קבצי כרטסת נבחרו` : '+ בחר קבצי כרטסת (אקסל)'}
              <input ref={kartesetRef} type="file" multiple accept=".xlsx,.xls" className="hidden"
                onChange={e => setKartesetFiles(Array.from(e.target.files || []))} />
            </label>
            {kartesetFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {kartesetFiles.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg px-2 py-1">
                    {f.name}
                    <button type="button" onClick={() => setKartesetFiles(prev => prev.filter((_, j) => j !== i))}
                      className="text-emerald-400 hover:text-red-500 font-bold">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Expense files (bank + credit cards) */}
          <div>
            <p className="text-xs font-bold text-slate-500 mb-1">קבצי הוצאות — דף בנק (PDF), אשראי כאל/מקס (אקסל)</p>
            <p className="text-[11px] text-slate-400 mb-1">טיפ: העלה מהבנק גם את "יתרה ותנועות בעו"ש" וגם את "רשימת ההעברות" — כך כל העברה תציג את שם המוטב</p>
            <label className="block w-full py-3 rounded-xl font-bold text-sm text-center cursor-pointer border-2 border-dashed border-violet-300 text-violet-600 hover:bg-violet-50 transition">
              {expenseFiles.length ? `${expenseFiles.length} קבצי הוצאות נבחרו` : '+ בחר קבצי הוצאות'}
              <input ref={expenseRef} type="file" multiple accept=".pdf,.xlsx,.xls" className="hidden"
                onChange={e => setExpenseFiles(Array.from(e.target.files || []))} />
            </label>
            {expenseFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {expenseFiles.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-xs bg-violet-50 text-violet-700 border border-violet-200 rounded-lg px-2 py-1">
                    {f.name}
                    <button type="button" onClick={() => setExpenseFiles(prev => prev.filter((_, j) => j !== i))}
                      className="text-violet-400 hover:text-red-500 font-bold">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

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

          <button type="button" onClick={runReconcile} disabled={running || !kartesetFiles.length || !expenseFiles.length || !periodId}
            className="w-full py-2.5 rounded-xl font-black text-sm text-white disabled:opacity-40 transition"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
            {running ? 'משווה...' : periodId
              ? `השווה מול הכרטסת (${periods.find(p => p.id === periodId)?.name || ''})`
              : 'בחר תקופה כדי להשוות'}
          </button>

          {error && <p className="text-sm text-red-600 font-bold">{error}</p>}
          {summary && (
            <div className="text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-3 py-2">
              נמצאו <strong>{summary.newCount}</strong> חוסרים חדשים
              {summary.knownCount > 0 && <> · <strong>{summary.knownCount}</strong> כבר במעקב</>}
              {summary.resolvedCount > 0 && <> · <strong>{summary.resolvedCount}</strong> טופלו בעבר</>}
              {summary.autoResolvedCount > 0 && <> · <strong className="text-emerald-700">{summary.autoResolvedCount}</strong> נסגרו אוטומטית (נמצאו בכרטסת המעודכנת)</>}
              <span className="block text-xs text-emerald-600 mt-0.5">
                נבדקו {summary.totalEntries} תנועות מול {summary.kartesetCount} רשומות כרטסת
                {summary.sources?.length ? ` (${summary.sources.map(s => `${TYPE_LABELS[s.type] || s.type}: ${s.count ?? '?'}`).join(', ')})` : ''}
              </span>
              {summary.warnings?.map((w, i) => (
                <span key={i} className="block text-xs text-amber-700 mt-0.5">⚠️ {w}</span>
              ))}
            </div>
          )}
        </div>

        {/* List — per-source tabs */}
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setShowResolved(v => !v)}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition ${showResolved ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-300'}`}>
            {showResolved ? 'חזרה לפתוחים' : 'הצג פתורים'}
          </button>
          <p className="text-sm font-bold text-slate-600">
            {showResolved ? 'טופלו' : 'חשבוניות חסרות'}{periodId && periods.length ? ` — ${periods.find(p => p.id === periodId)?.name || ''}` : ''}
          </p>
        </div>

        <div className="flex gap-1.5">
          {[['all', 'הכל'], ['bank', 'בנק'], ['cal', 'כאל'], ['max', 'מקס']].map(([key, label]) => {
            const count = key === 'all' ? items.length : items.filter(i => i.source === key).length;
            return (
              <button key={key} type="button" onClick={() => setSourceTab(key)}
                className={`flex-1 text-xs font-bold py-2 rounded-xl border transition ${
                  sourceTab === key ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}>
                {label} ({count})
              </button>
            );
          })}
        </div>

        {/* Karteset-only re-upload: re-compares vs the stored expenses */}
        <label className={`block w-full py-2 rounded-xl font-bold text-xs text-center cursor-pointer border-2 border-dashed border-emerald-300 text-emerald-700 hover:bg-emerald-50 transition ${(rekRunning || !periodId) ? 'opacity-50 cursor-not-allowed' : ''}`}>
          {rekRunning ? 'משווה מול הכרטסת המעודכנת...' : '⬆ העלה כרטסת מעודכנת — הוצאות שנוספו לכרטסת ייסגרו אוטומטית'}
          <input ref={rekRef} type="file" multiple accept=".xlsx,.xls" className="hidden" disabled={rekRunning || !periodId}
            onChange={e => runRekarteset(Array.from(e.target.files || []))} />
        </label>
        {rekResult && (
          <div className="text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-3 py-2">
            נפתרו אוטומטית <strong>{rekResult.autoResolvedCount}</strong> הוצאות שנמצאו בכרטסת המעודכנת
            {rekResult.newCount > 0 && <> · נוספו <strong>{rekResult.newCount}</strong> חוסרים חדשים</>}
            <span className="block text-xs text-emerald-600 mt-0.5">
              נבדקו {rekResult.totalEntries} הוצאות שמורות מול {rekResult.kartesetCount} רשומות כרטסת
              {' · '}{new Date(rekResult.uploadedAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          </div>
        )}

        {(() => {
          const visible = sourceTab === 'all' ? items : items.filter(i => i.source === sourceTab);
          return loading ? (
            <p className="text-center text-slate-400 py-8 text-sm">טוען...</p>
          ) : visible.length === 0 ? (
            <p className="text-center text-slate-400 py-8 text-sm">
              {showResolved ? 'אין פריטים שטופלו' : 'אין חשבוניות חסרות — הכול מותאם ✓'}
            </p>
          ) : (
            <div className="space-y-2">
              {visible.map(item => (
                <ExpenseRow key={item.id} item={item} periods={periods} periodId={periodId}
                  onChanged={() => { load(); loadPeriods(); }} />
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
