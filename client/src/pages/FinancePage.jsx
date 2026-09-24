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
// Link to the email in the mailbox it came from (authuser selects the Google
// account when several are signed in). Old rows store 'primary' as the account.
const gmailLink = (gmailId, account) =>
  `https://mail.google.com/mail/${account && account !== 'primary' ? `?authuser=${encodeURIComponent(account)}` : ''}#all/${gmailId}`;

// Preview images are plain <img> tags (fast, cached by the browser, work on
// phones). They need a short-lived token in the URL; fetched once per page load.
let _previewToken = null;
let _previewTokenPromise = null;
function getPreviewToken() {
  if (_previewToken) return Promise.resolve(_previewToken);
  if (!_previewTokenPromise) {
    _previewTokenPromise = api.get('/finance/review/preview-token')
      .then(r => { _previewToken = r.data.token; return _previewToken; })
      .catch(() => { _previewTokenPromise = null; return null; });
  }
  return _previewTokenPromise;
}
const previewUrl = (driveFileId, token, size = 'full') =>
  token && driveFileId ? `/api/finance/invoice-preview/${driveFileId}?size=${size}&t=${encodeURIComponent(token)}` : null;

// Thumbnail for a list row — grey box until the image arrives, hidden on error
function InvoiceThumb({ driveFileId, token, link }) {
  const [failed, setFailed] = useState(false);
  const src = previewUrl(driveFileId, token, 'thumb');
  if (!src || failed) return <div className="w-10 h-12 rounded-md bg-slate-200 shrink-0" />;
  const img = <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="w-10 h-12 rounded-md object-cover object-top bg-white border border-slate-200 shrink-0" />;
  return link ? <a href={link} target="_blank" rel="noreferrer" className="shrink-0">{img}</a> : img;
}

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
  const [showAllFailures, setShowAllFailures] = useState(false);
  const [previewToken, setPreviewToken] = useState(null);
  useEffect(() => { getPreviewToken().then(setPreviewToken); }, []);

  const loadAccounts = () => api.get('/finance/gmail/accounts').then(r => setAccounts(r.data)).catch(() => {});
  const loadInvoices = () => api.get('/finance/invoices').then(r => setInvoices(r.data)).catch(() => {});
  useEffect(() => {
    loadAccounts();
    // Resume progress display if a scan is already running (e.g. after refresh)
    api.get('/finance/scan/status').then(r => {
      if (r.data.running) { setScanning(true); setResult(r.data.summary); setTimeout(pollScan, 3000); }
    }).catch(() => {});
  }, []);

  async function connectMailbox() {
    // Open the window synchronously inside the click handler — browsers
    // (Safari/iOS especially) silently block window.open after an await.
    const popup = window.open('', '_blank', 'width=520,height=680');
    try {
      const { data } = await api.get('/finance/gmail/connect-url');
      if (popup) {
        popup.location.href = data.url;
        // refresh the list when the popup finishes / the tab regains focus
        const onFocus = () => { loadAccounts(); window.removeEventListener('focus', onFocus); };
        window.addEventListener('focus', onFocus);
        setTimeout(loadAccounts, 15000);
      } else {
        // Popup blocked — go through Google in this tab; the callback returns to /finance
        window.location.assign(data.url);
      }
    } catch (err) {
      if (popup) popup.close();
      alert(err.response?.data?.error || 'שגיאה');
    }
  }

  async function removeAccount(id) {
    if (!confirm('להסיר את התיבה מהסריקה?')) return;
    try { await api.delete(`/finance/gmail/accounts/${id}`); loadAccounts(); } catch {}
  }

  // The scan runs in the background on the server; we poll for live progress.
  async function pollScan() {
    try {
      const { data } = await api.get('/finance/scan/status');
      if (data.summary) setResult(data.summary);
      if (data.running) { setTimeout(pollScan, 3000); return; }
      if (data.error) setError(data.error);
      else { loadInvoices(); setShowInvoices(true); }
      setScanning(false);
    } catch {
      setTimeout(pollScan, 5000); // transient network error — keep polling
    }
  }

  async function runScan() {
    setScanning(true); setError(null); setResult(null);
    try {
      await api.post('/finance/scan', { from, to });
      setTimeout(pollScan, 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה בסריקה');
      setScanning(false);
    }
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
        className="w-full py-2.5 rounded-xl font-black text-sm text-white disabled:opacity-70 transition flex items-center justify-center gap-2"
        style={{ background: 'linear-gradient(135deg, #0ea5e9, #6366f1)' }}>
        {scanning && <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
        {scanning
          ? `סורק מיילים... ${result ? `נבדקו ${result.scanned} · זוהו ${result.invoices} · נשמרו ${result.filesSaved}` : '(יכול לקחת כמה דקות)'}`
          : `סרוק מיילים (${from} עד ${to})`}
      </button>

      {scanning && (
        <div className="flex items-center gap-2 text-sm bg-sky-50 border border-sky-200 text-sky-700 rounded-xl px-3 py-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-sky-500" />
          </span>
          <span className="font-bold">הסריקה פועלת ברקע — אפשר להמשיך לעבוד, התוצאות יתעדכנו כאן אוטומטית</span>
        </div>
      )}

      {error && <p className="text-sm text-red-600 font-bold">{error}</p>}
      {result && (
        <div className="text-sm bg-sky-50 border border-sky-200 text-sky-800 rounded-xl px-3 py-2 space-y-0.5">
          <p>נסרקו <strong>{result.scanned}</strong> מיילים · זוהו <strong>{result.invoices}</strong> חשבוניות · נשמרו <strong>{result.filesSaved}</strong> קבצים בדרייב</p>
          {!result.aiUsed && <p className="text-amber-700 text-xs">⚠️ סיווג AI לא פעיל (OPENAI_API_KEY חסר) — זיהוי לפי מילות מפתח בלבד</p>}
          {result.failures?.length > 0 && (
            <div className="text-xs text-red-600 pt-1 space-y-0.5">
              {(showAllFailures ? result.failures : result.failures.slice(0, 5)).map((f, i) => (
                <p key={i}>
                  ✗ {f.subject || f.account}: {f.error}
                  {f.gmailId && (
                    <a href={gmailLink(f.gmailId, f.account)} target="_blank" rel="noreferrer"
                      className="text-violet-600 font-bold underline mr-1.5 whitespace-nowrap">פתח מייל</a>
                  )}
                </p>
              ))}
              {result.failures.length > 5 && (
                <button type="button" onClick={() => setShowAllFailures(v => !v)} className="font-bold underline">
                  {showAllFailures ? 'הצג פחות' : `ועוד ${result.failures.length - 5} כשלונות — הצג הכול`}
                </button>
              )}
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
              {inv.status === 'saved' && inv.drive_file_id && <InvoiceThumb driveFileId={inv.drive_file_id} token={previewToken} link={inv.drive_link} />}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-700 truncate">{inv.email_subject || inv.filename}</p>
                <p className="text-slate-400 truncate">
                  {inv.email_date ? new Date(inv.email_date).toLocaleDateString('he-IL') : ''}
                  {inv.drive_folder ? ` · תיקייה ${inv.drive_folder}` : ''}
                  {inv.status === 'failed' ? ` · נכשל: ${inv.error}` : ''}
                </p>
              </div>
              {inv.status === 'saved' && inv.drive_link
                ? <a href={inv.drive_link} target="_blank" rel="noreferrer" className="text-violet-600 font-bold shrink-0">פתח בדרייב</a>
                : <a href={gmailLink(inv.gmail_message_id, inv.account_email)} target="_blank" rel="noreferrer" className="text-red-500 font-bold shrink-0 underline">✗ פתח מייל</a>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// "שלח לרואה חשבון" — pick MM-YYYY Drive folders, enter the accountant's
// email, and the server mails the files (from the business Gmail, split into
// several emails when they exceed Gmail's size limit). Runs in the background.
function AccountantSendSection() {
  const [open, setOpen]         = useState(false);
  const [months, setMonths]     = useState([]);
  const [loading, setLoading]   = useState(false);
  const [selected, setSelected] = useState([]);
  const [email, setEmail]       = useState('');
  const [note, setNote]         = useState('');
  const [sending, setSending]   = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult]     = useState(null);
  const [error, setError]       = useState(null);
  const [history, setHistory]   = useState([]);
  const [primaryEmail, setPrimaryEmail] = useState('');

  const fmtSize = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
  const loadHistory = () => api.get('/finance/accountant/history').then(r => setHistory(r.data)).catch(() => {});

  async function openPanel() {
    setOpen(true); setLoading(true); setError(null);
    try {
      const { data } = await api.get('/finance/accountant/months');
      setMonths(data.months);
      setPrimaryEmail(data.primaryEmail || '');
      if (data.lastEmail && !email) setEmail(data.lastEmail);
      loadHistory();
      // resume progress display if a send is already running
      const st = await api.get('/finance/accountant/status');
      if (st.data.running) { setSending(true); setProgress(st.data.progress); setTimeout(pollSend, 3000); }
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה בטעינת התיקיות מהדרייב');
    } finally {
      setLoading(false);
    }
  }

  const toggle = (key) => setSelected(s => (s.includes(key) ? s.filter(k => k !== key) : [...s, key]));
  const chosen = months.filter(m => selected.includes(m.key));
  const totalFiles = chosen.reduce((n, m) => n + m.files, 0);
  const totalBytes = chosen.reduce((n, m) => n + m.bytes, 0);

  async function pollSend() {
    try {
      const { data } = await api.get('/finance/accountant/status');
      if (data.progress) setProgress(data.progress);
      if (data.running) { setTimeout(pollSend, 3000); return; }
      if (data.error) setError(data.error);
      else { setResult(data.result); setSelected([]); loadHistory(); }
      setSending(false);
    } catch {
      setTimeout(pollSend, 5000);
    }
  }

  async function send() {
    if (!chosen.length) { setError('יש לבחור לפחות חודש אחד'); return; }
    if (!email.trim()) { setError('יש להזין כתובת מייל של רואה החשבון'); return; }
    // Files are filed per mailbox inside each month folder. When the chosen
    // months hold more than one mailbox, ask whether to send all of them or
    // only the business mailbox.
    const boxes = [...new Set(chosen.flatMap(m => m.mailboxes.map(b => b.email)))];
    let mailboxes = 'all';
    let sendFiles = totalFiles;
    if (boxes.length > 1) {
      const all = confirm(`נמצאו חשבוניות מ-${boxes.length} תיבות מייל:\n${boxes.join('\n')}\n\nלשלוח מכל תיבות המייל?\n(ביטול = לשלוח רק מתיבת העסק${primaryEmail ? ` ${primaryEmail}` : ''})`);
      if (!all) {
        mailboxes = [primaryEmail || boxes[0]];
        sendFiles = chosen.reduce((n, m) => n + m.mailboxes.filter(b => mailboxes.includes(b.email)).reduce((k, b) => k + b.files, 0), 0);
        if (!sendFiles) { setError('אין קבצים מתיבת העסק בחודשים שנבחרו'); return; }
      }
    }
    if (!confirm(`לשלוח ${sendFiles} קבצים (${chosen.map(m => m.label).join(', ')}) אל ${email.trim()}?`)) return;
    setSending(true); setError(null); setResult(null); setProgress({ downloaded: 0, total: sendFiles, emailsSent: 0 });
    try {
      await api.post('/finance/accountant/send', { months: selected, email: email.trim(), note, mailboxes });
      setTimeout(pollSend, 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה בשליחה');
      setSending(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-violet-100 shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="font-bold text-slate-800 text-sm">שליחת חשבוניות לרואה חשבון</p>
          <p className="text-xs text-slate-400">שולח את קבצי החשבוניות מהתיקיות החודשיות בדרייב כקבצים מצורפים, מהמייל של העסק.</p>
        </div>
        {!open && (
          <button type="button" onClick={openPanel}
            className="bg-violet-600 text-white text-sm font-bold rounded-xl px-4 py-2 hover:bg-violet-700 transition">
            שלח לרואה חשבון
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-3">
          {loading && <p className="text-xs text-slate-400">טוען תיקיות מהדרייב…</p>}

          {!loading && months.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-600 mb-1.5">בחר חודשים לשליחה</p>
              <div className="flex flex-wrap gap-1.5">
                {months.map(m => {
                  const on = selected.includes(m.key);
                  return (
                    <button key={m.key} type="button" onClick={() => toggle(m.key)} disabled={sending || m.files === 0}
                      className={`text-xs font-bold px-2.5 py-1.5 rounded-lg border transition disabled:opacity-40 ${on ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                      {m.label} <span className={on ? 'text-violet-200' : 'text-slate-400'}>({m.files})</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {!loading && months.length === 0 && !error && <p className="text-xs text-slate-400">לא נמצאו תיקיות חודשיות בדרייב עדיין</p>}

          <div className="flex flex-col sm:flex-row gap-2">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} disabled={sending}
              placeholder="המייל של רואה החשבון" dir="ltr"
              className="flex-1 border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white" />
            <input type="text" value={note} onChange={e => setNote(e.target.value)} disabled={sending}
              placeholder="הערה למייל (לא חובה)"
              className="flex-1 border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white" />
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button type="button" onClick={send} disabled={sending || !chosen.length}
              className="bg-violet-600 text-white text-sm font-bold rounded-xl px-4 py-2 hover:bg-violet-700 transition disabled:opacity-50">
              {sending ? 'שולח…' : 'שלח'}
            </button>
            {chosen.length > 0 && !sending && (
              <span className="text-xs text-slate-500">{totalFiles} קבצים · {fmtSize(totalBytes)}{totalBytes > 18 * 1024 * 1024 ? ' · יישלח בכמה מיילים' : ''}</span>
            )}
            <button type="button" onClick={() => { setOpen(false); setError(null); setResult(null); }} disabled={sending}
              className="text-xs text-slate-400 underline">סגור</button>
          </div>

          {sending && progress && (
            <div className="flex items-center gap-2 text-sm bg-sky-50 border border-sky-200 text-sky-700 rounded-xl px-3 py-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-sky-500" />
              </span>
              <span className="font-bold">מוריד קבצים מהדרייב ושולח… {progress.downloaded}/{progress.total} קבצים · {progress.emailsSent} מיילים נשלחו</span>
            </div>
          )}
          {error && <p className="text-sm text-red-600 font-bold">{error}</p>}
          {result && (
            <p className="text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-3 py-2">
              ✓ נשלחו {result.files} קבצים ({result.period}) ב-{result.emailsSent} {result.emailsSent === 1 ? 'מייל' : 'מיילים'} אל {email}
            </p>
          )}

          {history.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-600 mb-1">שליחות קודמות</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {history.map(h => (
                  <div key={h.id} className="text-xs text-slate-500 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-100">
                    {new Date(h.created_at).toLocaleDateString('he-IL')} · {h.months.join(', ')} · {h.files_count} קבצים{h.mailboxes ? ` · תיבות: ${h.mailboxes.join(', ')}` : ''} → <span dir="ltr">{h.email}</span>{h.created_by_name ? ` · ${h.created_by_name}` : ''}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// סקירת חשבוניות — browse a month's files one at a time (preview + email
// context) and throw irrelevant ones into the Drive trash folder; the trash
// is listed by month and any item can be restored.
function InvoiceReviewSection() {
  const [open, setOpen]         = useState(false);
  const [months, setMonths]     = useState([]);
  const [month, setMonth]       = useState(null);
  const [files, setFiles]       = useState([]);
  const [idx, setIdx]           = useState(0);
  const [loading, setLoading]   = useState(false);
  const [previewToken, setPreviewToken] = useState(null);
  const [previewState, setPreviewState] = useState('loading'); // loading | ok | failed
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState(null);
  const [trash, setTrash]       = useState(null); // null = hidden, [] = shown
  const [trashOpenMonth, setTrashOpenMonth] = useState(null);

  const current = files[idx] || null;
  useEffect(() => { getPreviewToken().then(setPreviewToken); }, []);
  const fmtSize = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

  async function openPanel() {
    setOpen(true); setLoading(true); setError(null);
    try {
      const { data } = await api.get('/finance/review/months');
      setMonths(data.months);
    } catch (err) { setError(err.response?.data?.error || 'שגיאה בטעינת החודשים'); }
    finally { setLoading(false); }
  }

  async function pickMonth(key) {
    setMonth(key); setFiles([]); setIdx(0); setLoading(true); setError(null);
    try {
      const { data } = await api.get('/finance/review/files', { params: { month: key } });
      setFiles(data);
    } catch (err) { setError(err.response?.data?.error || 'שגיאה בטעינת הקבצים'); }
    finally { setLoading(false); }
  }

  // New file on screen → loading state; and warm the browser cache with the next two
  useEffect(() => {
    setPreviewState('loading');
    if (!previewToken) return;
    for (const f of files.slice(idx + 1, idx + 3)) {
      const src = previewUrl(f.driveFileId, previewToken);
      if (src) { const im = new Image(); im.src = src; }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.driveFileId, previewToken]);

  async function trashCurrent() {
    if (!current || busy) return;
    setBusy(true); setError(null);
    try {
      await api.post('/finance/review/trash', { driveFileId: current.driveFileId, month: current.month, mailbox: current.mailbox });
      const next = files.filter((_, i) => i !== idx);
      setFiles(next);
      setIdx(i => Math.min(i, Math.max(0, next.length - 1)));
      setMonths(ms => ms.map(m => (m.key === month ? { ...m, files: Math.max(0, m.files - 1) } : m)));
      if (trash) loadTrash();
    } catch (err) { setError(err.response?.data?.error || 'המחיקה נכשלה'); }
    finally { setBusy(false); }
  }

  async function loadTrash() {
    try { const { data } = await api.get('/finance/review/trash'); setTrash(data); }
    catch (err) { setError(err.response?.data?.error || 'שגיאה בטעינת הפח'); }
  }

  async function restore(item) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/finance/review/restore/${item.id}`);
      await loadTrash();
      if (item.month === month) pickMonth(month);
      setMonths(ms => ms.map(m => (m.key === item.month ? { ...m, files: m.files + 1 } : m)));
    } catch (err) { setError(err.response?.data?.error || 'השחזור נכשל'); }
    finally { setBusy(false); }
  }

  const currentSrc = current && previewToken ? previewUrl(current.driveFileId, previewToken) : null;

  return (
    <div className="bg-white rounded-2xl border border-violet-100 shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="font-bold text-slate-800 text-sm">סקירת חשבוניות</p>
          <p className="text-xs text-slate-400">עוברים על החשבוניות שנשמרו בדרייב אחת-אחת ומוחקים את הלא-רלוונטיות (שימוש פרטי, חשבוניות שהוצאנו בעצמנו). מה שנמחק עובר לפח ואפשר לשחזר.</p>
        </div>
        {!open && (
          <button type="button" onClick={openPanel}
            className="bg-violet-600 text-white text-sm font-bold rounded-xl px-4 py-2 hover:bg-violet-700 transition">
            סקור חשבוניות
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5 items-center">
            {months.map(m => (
              <button key={m.key} type="button" onClick={() => pickMonth(m.key)} disabled={busy}
                className={`text-xs font-bold px-2.5 py-1.5 rounded-lg border transition ${month === m.key ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                {m.label} <span className={month === m.key ? 'text-violet-200' : 'text-slate-400'}>({m.files})</span>
              </button>
            ))}
            <button type="button" onClick={() => (trash ? setTrash(null) : loadTrash())}
              className={`text-xs font-bold px-2.5 py-1.5 rounded-lg border transition ${trash ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
              🗑 פח
            </button>
            <button type="button" onClick={() => { setOpen(false); setMonth(null); setFiles([]); setTrash(null); }} disabled={busy}
              className="text-xs text-slate-400 underline mr-auto">סגור</button>
          </div>

          {loading && <p className="text-xs text-slate-400">טוען…</p>}
          {error && <p className="text-sm text-red-600 font-bold">{error}</p>}

          {month && !loading && files.length === 0 && <p className="text-xs text-slate-400">אין קבצים בחודש הזה</p>}

          {current && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-slate-500">
                <span className="font-bold text-slate-700">{idx + 1} / {files.length}</span>
                <span dir="ltr" className="truncate">{current.mailbox}</span>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-y-auto relative" style={{ height: '60vh', minHeight: 320 }}>
                {previewState === 'loading' && <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400">טוען תצוגה מקדימה…</div>}
                {currentSrc && previewState !== 'failed' && (
                  <img key={current.driveFileId} src={currentSrc} alt=""
                    onLoad={() => setPreviewState('ok')} onError={() => setPreviewState('failed')}
                    className={`w-full h-auto bg-white ${previewState === 'ok' ? '' : 'opacity-0'}`} />
                )}
                {previewState === 'failed' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-slate-400">
                    <span>אין תצוגה מקדימה לקובץ הזה</span>
                    <a href={current.driveLink} target="_blank" rel="noreferrer" className="text-violet-600 font-bold underline">פתח בדרייב</a>
                  </div>
                )}
              </div>

              <div className="text-xs text-slate-600 space-y-0.5">
                <p className="font-bold text-slate-800 truncate">{current.subject || current.name}</p>
                {current.subject && <p className="text-slate-400 truncate">{current.name}</p>}
                <p className="text-slate-400 truncate">
                  {current.from ? <span dir="ltr">{current.from}</span> : 'הועלה ידנית / ללא מייל'}
                  {current.emailDate ? ` · ${new Date(current.emailDate).toLocaleDateString('he-IL')}` : ''}
                  {current.size ? ` · ${fmtSize(current.size)}` : ''}
                </p>
                <p className="flex gap-3">
                  {current.gmailId && <a href={gmailLink(current.gmailId, current.account)} target="_blank" rel="noreferrer" className="text-violet-600 font-bold underline">פתח מייל</a>}
                  <a href={current.driveLink} target="_blank" rel="noreferrer" className="text-violet-600 font-bold underline">פתח את הקובץ המלא</a>
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button type="button" onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0 || busy}
                  className="text-sm font-bold px-3 py-2 rounded-xl border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40">→ הקודם</button>
                <button type="button" onClick={() => setIdx(i => Math.min(files.length - 1, i + 1))} disabled={idx >= files.length - 1 || busy}
                  className="text-sm font-bold px-3 py-2 rounded-xl border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40">הבא ←</button>
                <button type="button" onClick={trashCurrent} disabled={busy}
                  className="text-sm font-bold px-4 py-2 rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 mr-auto">
                  {busy ? '…' : '🗑 מחק'}
                </button>
              </div>
            </div>
          )}

          {trash && (
            <div className="border-t border-slate-100 pt-3 space-y-2">
              <p className="text-xs font-bold text-slate-700">פח — לפי חודשים</p>
              {trash.length === 0 && <p className="text-xs text-slate-400">הפח ריק</p>}
              {trash.map(g => (
                <div key={g.key} className="rounded-xl border border-slate-200">
                  <button type="button" onClick={() => setTrashOpenMonth(o => (o === g.key ? null : g.key))}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold text-slate-700">
                    <span>{g.label} <span className="text-slate-400 font-normal">({g.items.length})</span></span>
                    <span className="text-slate-400">{trashOpenMonth === g.key ? '▲' : '▼'}</span>
                  </button>
                  {trashOpenMonth === g.key && (
                    <div className="px-3 pb-2 space-y-1">
                      {g.items.map(t => (
                        <div key={t.id} className="flex items-center justify-between gap-2 text-xs bg-slate-50 border border-slate-100 rounded-lg px-2 py-1.5">
                          <div className="min-w-0">
                            <p className="font-medium text-slate-700 truncate">{t.email_subject || t.name}</p>
                            <p className="text-slate-400 truncate" dir="ltr">{t.mailbox} · {new Date(t.trashed_at).toLocaleDateString('he-IL')}{t.trashed_by_name ? ` · ${t.trashed_by_name}` : ''}</p>
                          </div>
                          <button type="button" onClick={() => restore(t)} disabled={busy}
                            className="text-violet-600 font-bold shrink-0 underline disabled:opacity-50">שחזר</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
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
        <InvoiceReviewSection />
        <AccountantSendSection />

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
              {kartesetFiles.length ? `${kartesetFiles.length} קבצי כרטסת נבחרו` : '+ בחר קבצי כרטסת (אקסל או PDF)'}
              <input ref={kartesetRef} type="file" multiple accept=".xlsx,.xls,.pdf" className="hidden"
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
          <input ref={rekRef} type="file" multiple accept=".xlsx,.xls,.pdf" className="hidden" disabled={rekRunning || !periodId}
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
