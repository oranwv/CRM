import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

const TIERS = [
  { key: 1, title: 'חוזים שנשלחו וטרם נחתמו', color: 'border-red-300 bg-red-50',     dot: 'bg-red-500' },
  { key: 2, title: 'הצעות מחיר שנשלחו',        color: 'border-amber-300 bg-amber-50', dot: 'bg-amber-500' },
  { key: 3, title: 'דחופים / חמים',            color: 'border-violet-300 bg-violet-50', dot: 'bg-violet-500' },
];

const fmtDate = d => d ? new Date(d).toLocaleDateString('he-IL') : '—';
const dayStr = d => d.toISOString().slice(0, 10);
const shiftDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return dayStr(d); };

function WorklistItem({ it, onOpen }) {
  return (
    <button onClick={() => onOpen(it.lead_id)}
      className="w-full text-right bg-white rounded-xl border border-slate-200 px-3 py-2.5 hover:border-violet-300 transition">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-slate-800 truncate">
            {it.name}
            {it.near_event && <span className="mr-2 text-[10px] bg-red-100 text-red-700 rounded-full px-1.5 py-0.5 font-bold">אירוע קרוב</span>}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {it.event_type || 'אירוע'} · אירוע {fmtDate(it.event_date)}
            {it.rep && <> · <b>{it.rep}</b></>}
          </p>
        </div>
        <div className="text-left shrink-0">
          <p className="text-xs font-semibold text-slate-600">{it.reason}</p>
          {it.days_since_contact != null && it.days_since_contact < 900 &&
            <p className="text-[11px] text-slate-400">אין קשר {it.days_since_contact} ימים</p>}
        </div>
      </div>
    </button>
  );
}

function LossInsights() {
  const [from, setFrom] = useState(shiftDays(-90));
  const [to, setTo]     = useState(dayStr(new Date()));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const { data } = await api.get(`/sales/loss-insights?from=${from}&to=${to}`);
      setData(data);
    } catch (err) {
      alert(err.response?.data?.error || 'שגיאה בניתוח');
    } finally { setLoading(false); }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-black text-slate-800">תובנות AI — למה עסקאות לא נסגרות</h2>
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1" style={{ direction: 'ltr' }} />
          <span>עד</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1" style={{ direction: 'ltr' }} />
          <button onClick={run} disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-violet-600 text-white font-bold disabled:opacity-50">
            {loading ? 'מנתח...' : 'נתח'}
          </button>
        </div>
      </div>
      {!data ? (
        <p className="text-sm text-slate-400">בחר טווח ולחץ "נתח" כדי לקבל תובנות מ-AI על הלידים שלא נסגרו.</p>
      ) : data.count === 0 ? (
        <p className="text-sm text-slate-400">אין לידים אבודים בטווח שנבחר.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">נותחו {data.count} לידים אבודים</p>
          {data.top_reasons?.length > 0 && (
            <div>
              <p className="text-sm font-bold text-slate-700 mb-1">סיבות עיקריות</p>
              <div className="space-y-1">
                {data.top_reasons.map((r, i) => (
                  <div key={i} className="text-sm bg-slate-50 rounded-lg px-3 py-1.5">
                    <b className="text-slate-800">{r.reason}</b> {r.count != null && <span className="text-slate-400">({r.count})</span>}
                    {r.insight && <span className="text-slate-500"> — {r.insight}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {data.patterns?.length > 0 && (
            <div>
              <p className="text-sm font-bold text-slate-700 mb-1">דפוסים</p>
              <ul className="list-disc pr-5 text-sm text-slate-600 space-y-0.5">{data.patterns.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}
          {data.recommendations?.length > 0 && (
            <div>
              <p className="text-sm font-bold text-emerald-700 mb-1">המלצות לשיפור</p>
              <ul className="list-disc pr-5 text-sm text-slate-700 space-y-0.5">{data.recommendations.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SalesWorklistPage() {
  const navigate = useNavigate();
  const [items, setItems]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState('worklist');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/sales/worklist')
      .then(r => setItems(r.data.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const openLead = id => navigate(`/?lead=${id}`);
  const byTier = t => (items || []).filter(i => i.tier === t);

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4" dir="rtl">
      <div className="flex items-center gap-2">
        <button onClick={() => setTab('worklist')}
          className={`text-sm font-bold px-3 py-1.5 rounded-xl transition ${tab === 'worklist' ? 'bg-violet-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>עבודה להיום</button>
        <button onClick={() => setTab('insights')}
          className={`text-sm font-bold px-3 py-1.5 rounded-xl transition ${tab === 'insights' ? 'bg-violet-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>תובנות AI</button>
      </div>

      {tab === 'insights' ? <LossInsights /> : loading ? (
        <p className="text-center text-slate-400 py-8">טוען...</p>
      ) : (items && items.length === 0) ? (
        <p className="text-center text-slate-400 py-8">אין לידים פעילים לטיפול כרגע 🎉</p>
      ) : (
        <div className="space-y-4">
          {TIERS.map(t => {
            const list = byTier(t.key);
            if (!list.length) return null;
            return (
              <div key={t.key} className={`rounded-2xl border ${t.color} p-3`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${t.dot}`} />
                  <h2 className="font-black text-slate-800 text-sm">{t.title}</h2>
                  <span className="text-xs text-slate-400">({list.length})</span>
                </div>
                <div className="space-y-2">
                  {list.map(it => <WorklistItem key={it.lead_id} it={it} onOpen={openLead} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
