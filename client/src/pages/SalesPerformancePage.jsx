import { useState, useEffect, useCallback } from 'react';
import api from '../api';

const HEBREW_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

const fmt = n => Number(n || 0).toLocaleString('he-IL');
const fmtDate = d => d ? new Date(d).toLocaleDateString('he-IL') : '—';

// Editable cost lines for one closed event
// A line with both qty and unit_price has its amount locked to qty × price
function lineAmount(l) {
  const hasQty = l.qty !== '' && l.qty != null && !isNaN(Number(l.qty));
  const hasUp  = l.unit_price !== '' && l.unit_price != null && !isNaN(Number(l.unit_price));
  if (hasQty && hasUp) return Math.round(Number(l.qty) * Number(l.unit_price));
  return Number(l.amount) || 0;
}
function isComputed(l) {
  return l.qty !== '' && l.qty != null && !isNaN(Number(l.qty))
    && l.unit_price !== '' && l.unit_price != null && !isNaN(Number(l.unit_price));
}

function CostEditor({ event, onSaved }) {
  const [lines, setLines]       = useState(event.lines?.length ? event.lines : []);
  const [saving, setSaving]     = useState(false);
  const [generating, setGenerating] = useState(false);

  const setLine = (i, field, v) => setLines(ls => ls.map((l, j) => j === i ? { ...l, [field]: v } : l));
  const addLine = () => setLines(ls => [...ls, { id: Date.now(), label: '', qty: '', unit_price: '', amount: '', basis: '' }]);
  const removeLine = (i) => setLines(ls => ls.filter((_, j) => j !== i));

  const total = lines.reduce((s, l) => s + lineAmount(l), 0);
  const profit = event.amount != null ? event.amount - total : null;

  async function save() {
    setSaving(true);
    try {
      // The server recomputes amounts (qty × unit_price) and is the authority
      const { data } = await api.put(`/sales/costs/${event.lead_id}`, { lines });
      if (data.lines) setLines(data.lines);
      await onSaved();
    } catch (err) {
      alert(err.response?.data?.error || 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  }

  async function generate() {
    if (lines.length && !window.confirm('חישוב מחדש ידרוס את שורות העלות הקיימות. להמשיך?')) return;
    setGenerating(true);
    try {
      const { data } = await api.post(`/sales/costs/${event.lead_id}/generate`);
      setLines(data.lines || []);
      await onSaved();
    } catch (err) {
      alert(err.response?.data?.error || 'שגיאה בחישוב העלויות');
    } finally {
      setGenerating(false);
    }
  }

  const inputCls = 'border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-violet-400';

  return (
    <div className="bg-slate-50 rounded-xl border border-slate-200 p-3 mt-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-500">עלויות האירוע</span>
        <button onClick={generate} disabled={generating}
          className="text-xs px-3 py-1 rounded-lg border border-violet-300 text-violet-700 font-bold hover:bg-violet-50 transition disabled:opacity-50">
          {generating ? 'מחשב...' : 'חשב עלויות (AI)'}
        </button>
      </div>

      {lines.length === 0 && (
        <p className="text-xs text-slate-400">אין שורות עלות — חשב עם AI לפי המודל, או הוסף ידנית.</p>
      )}
      {lines.map((l, i) => (
        <div key={l.id ?? i} className="bg-white rounded-lg border border-slate-200 p-2 space-y-1">
          <div className="flex items-center gap-2">
            <input value={l.label} onChange={e => setLine(i, 'label', e.target.value)}
              placeholder="תיאור (למשל: מלצרים)" className={`${inputCls} flex-1 font-semibold min-w-0`} />
            <button onClick={() => removeLine(i)} className="text-rose-400 hover:text-rose-600 font-bold px-1">×</button>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <label className="shrink-0">כמות</label>
            <input type="number" value={l.qty ?? ''} onChange={e => setLine(i, 'qty', e.target.value)}
              placeholder="—" className={`${inputCls} w-16 text-center`} dir="ltr" />
            <span className="shrink-0">×</span>
            <label className="shrink-0">מחיר ליח'</label>
            <input type="number" value={l.unit_price ?? ''} onChange={e => setLine(i, 'unit_price', e.target.value)}
              placeholder="—" className={`${inputCls} w-20 text-center`} dir="ltr" />
            <span className="shrink-0">=</span>
            {isComputed(l) ? (
              <span className="flex-1 text-center font-bold text-slate-700 bg-slate-100 rounded-lg py-1.5" dir="ltr">
                ₪{fmt(lineAmount(l))}
              </span>
            ) : (
              <input type="number" value={l.amount} onChange={e => setLine(i, 'amount', e.target.value)}
                placeholder="סכום ₪" className={`${inputCls} flex-1 text-center`} dir="ltr" />
            )}
          </div>
          <input value={l.basis || ''} onChange={e => setLine(i, 'basis', e.target.value)}
            placeholder="לפי מה חושב — למשל: מלצר לכל 17 אורחים"
            className="w-full text-xs text-slate-500 px-2 py-1 rounded-lg border border-transparent hover:border-slate-200 focus:border-violet-300 focus:outline-none bg-transparent" />
        </div>
      ))}

      <div className="flex items-center justify-between pt-1">
        <button onClick={addLine} className="text-xs text-violet-600 font-bold hover:text-violet-800 transition">
          + הוסף שורת עלות
        </button>
        <div className="text-sm text-slate-600">
          סה"כ עלויות: <b>₪{fmt(total)}</b>
          {profit != null && <> · רווח: <b className={profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}>₪{fmt(profit)}</b></>}
        </div>
      </div>

      <button onClick={save} disabled={saving}
        className="w-full bg-violet-600 text-white font-bold py-2 rounded-xl text-sm hover:bg-violet-700 transition disabled:opacity-50">
        {saving ? 'שומר...' : 'שמור עלויות'}
      </button>
      {event.ai_generated_at && (
        <p className="text-[11px] text-slate-400 text-center">חושב לאחרונה ע"י AI: {fmtDate(event.ai_generated_at)}</p>
      )}
    </div>
  );
}

export default function SalesPerformancePage() {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null); // lead_id of the open cost editor
  const [bulkGenerating, setBulkGenerating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/sales/closed-events?year=${year}&month=${month}`)
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [year, month]);

  useEffect(load, [load]);

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1);
    setExpanded(null);
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1);
    setExpanded(null);
  }

  const events  = data?.events || [];
  const summary = data?.summary || { count: 0, total_amount: 0, total_profit: 0 };
  const missingCount = events.filter(e => e.amount != null && (!e.lines || e.lines.length === 0)).length;

  async function generateMissing() {
    setBulkGenerating(true);
    try {
      const { data: r } = await api.post(`/sales/costs/generate-missing?year=${year}&month=${month}`);
      if (r.failed > 0) alert(`חושבו ${r.generated} אירועים; ${r.failed} נכשלו${r.errors?.[0] ? ` (${r.errors[0].error})` : ''}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'שגיאה בחישוב העלויות');
    } finally {
      setBulkGenerating(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4" dir="rtl">
      {/* Month navigation (chevrons are bidi-mirrored in RTL — sources swapped so they point outward) */}
      <div className="bg-white rounded-2xl shadow-sm border border-violet-100 flex items-center justify-between px-4 py-3">
        <button onClick={nextMonth} className="text-slate-500 hover:text-violet-700 px-3 py-1 rounded-lg hover:bg-violet-50 transition font-bold text-lg">‹</button>
        <h2 className="font-black text-slate-800 text-base">רווחי מכירות — {HEBREW_MONTHS[month - 1]} {year}</h2>
        <button onClick={prevMonth} className="text-slate-500 hover:text-violet-700 px-3 py-1 rounded-lg hover:bg-violet-50 transition font-bold text-lg">›</button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-3 text-center">
          <p className="text-2xl font-black text-slate-800">{summary.count}</p>
          <p className="text-xs text-slate-500 font-semibold">אירועים שנסגרו</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-3 text-center">
          <p className="text-2xl font-black text-slate-800">₪{fmt(summary.total_amount)}</p>
          <p className="text-xs text-slate-500 font-semibold">מחזור לפני מע"מ</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-3 text-center">
          <p className={`text-2xl font-black ${summary.total_profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>₪{fmt(summary.total_profit)}</p>
          <p className="text-xs text-slate-500 font-semibold">סה"כ רווח</p>
        </div>
      </div>

      {/* Backfill banner — events closed before the auto-compute-on-signing mechanism */}
      {!loading && missingCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-amber-800 font-semibold">ל-{missingCount} אירועים אין עדיין חישוב עלויות</p>
          <button onClick={generateMissing} disabled={bulkGenerating}
            className="shrink-0 text-sm px-3 py-1.5 rounded-xl bg-amber-500 text-white font-bold hover:bg-amber-600 transition disabled:opacity-50">
            {bulkGenerating ? `מחשב ${missingCount} אירועים...` : 'חשב לכולם (AI)'}
          </button>
        </div>
      )}

      {/* Events list */}
      {loading ? (
        <p className="text-center text-slate-400 py-8">טוען נתונים...</p>
      ) : events.length === 0 ? (
        <p className="text-center text-slate-400 py-8">לא נסגרו אירועים בחודש זה</p>
      ) : (
        <div className="space-y-2">
          {events.map(ev => (
            <div key={ev.lead_id} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
              <button className="w-full text-right" onClick={() => setExpanded(e => e === ev.lead_id ? null : ev.lead_id)}>
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800 truncate">{ev.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {ev.event_type || 'אירוע'} · אירוע: {fmtDate(ev.event_date)} · נסגר: {fmtDate(ev.close_date)}
                      {ev.salesperson && <> · נסגר ע"י <b>{ev.salesperson}</b></>}
                    </p>
                  </div>
                  <div className="text-left shrink-0 mr-3">
                    <p className="text-sm text-slate-600">
                      {ev.amount != null ? <>₪{fmt(ev.amount)} <span className="text-xs text-slate-400">לפני מע"מ</span></> : <span className="text-xs text-slate-400">אין חוזה</span>}
                    </p>
                    <p className="text-xs text-slate-500">עלויות: ₪{fmt(ev.costs_total)}</p>
                    {ev.profit != null && (
                      <p className={`font-black ${ev.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>רווח: ₪{fmt(ev.profit)}</p>
                    )}
                  </div>
                </div>
              </button>
              {expanded === ev.lead_id && <CostEditor event={ev} onSaved={load} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
