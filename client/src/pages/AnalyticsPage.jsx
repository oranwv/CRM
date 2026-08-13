import { useState, useEffect } from 'react';
import api from '../api';

const SOURCE_LABELS = {
  website_popup: 'גוגל - אתר (פופ אפ)', website_form: 'גוגל - אתר (טופס)',
  call_event: 'Call Event', telekol: 'טלקול', vonage: 'Vonage',
  whatsapp: 'וואטסאפ', facebook: 'פייסבוק',
  instagram: 'אינסטגרם', manual: 'ידני',
};

const LOST_REASON_LABELS = {
  price: 'מחיר/תקציב', date: 'תאריך תפוס', competitor: 'בחר מתחרה',
  ghosted: 'נעלם', plans_changed: 'שינוי תוכניות', other: 'אחר',
};

const SOURCE_COLORS = [
  'bg-violet-400', 'bg-purple-400', 'bg-orange-400', 'bg-sky-400',
  'bg-green-400', 'bg-blue-400', 'bg-pink-400', 'bg-slate-400',
];

const dayStr = d => d.toISOString().slice(0, 10);
function shiftDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return dayStr(d); }

export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hoveredMonth, setHoveredMonth] = useState(null);
  // Empty range = all-time (preserves original behavior).
  const [from, setFrom] = useState('');
  const [to, setTo]     = useState('');

  const todayStr = dayStr(new Date());

  useEffect(() => {
    setLoading(true);
    const qs = (from && to) ? `?from=${from}&to=${to}` : '';
    api.get(`/analytics/overview${qs}`)
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [from, to]);

  const presets = [
    { label: 'הכל',     from: '',              to: '' },
    { label: 'היום',    from: todayStr,        to: todayStr },
    { label: '7 ימים',  from: shiftDays(-6),   to: todayStr },
    { label: '30 ימים', from: shiftDays(-29),  to: todayStr },
  ];

  if (loading && !data) return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-stone-400">טוען נתונים...</p>
    </div>
  );

  if (!data) return null;

  const { overview, activity, bySource, byMonth, staffPerf, lostReasons } = data;
  const totalRaw = parseInt(overview.total) || 0;
  const closedRaw = parseInt(overview.closed) || 0;  // closings that HAPPENED in the period
  const lostRaw = parseInt(overview.lost) || 0;      // losses that happened in the period
  const activeRaw = parseInt(overview.active) || 0;  // this period's inflow still open
  const total = totalRaw || 1;
  const wonRate = Math.round((closedRaw / total) * 100);
  const lostRate = Math.round((lostRaw / total) * 100);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="bg-white/70 backdrop-blur-sm border-b border-violet-100 px-5 py-4 flex items-center justify-between gap-3 flex-wrap shadow-sm" dir="rtl">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            {presets.map(p => {
              const active = from === p.from && to === p.to;
              return (
                <button key={p.label} onClick={() => { setFrom(p.from); setTo(p.to); }}
                  className={`text-xs font-bold px-2.5 py-1.5 rounded-lg transition ${active ? 'bg-violet-600 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-100'}`}>
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <span>מ-</span>
            <input type="date" value={from} max={to || todayStr}
              onChange={e => setFrom(e.target.value)}
              className="border border-slate-300 rounded-xl px-2 py-1.5 text-sm text-slate-700 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              style={{ direction: 'ltr' }} />
            <span>עד</span>
            <input type="date" value={to} min={from || undefined} max={todayStr}
              onChange={e => setTo(e.target.value)}
              className="border border-slate-300 rounded-xl px-2 py-1.5 text-sm text-slate-700 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              style={{ direction: 'ltr' }} />
          </div>
          {loading && <span className="text-xs text-slate-400">טוען...</span>}
        </div>
        <div className="text-right">
          <h1 className="text-lg font-black text-stone-900">אנליטיקס</h1>
          <p className="text-stone-400 text-xs">סטטיסטיקות ומדדים</p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 space-y-5">

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <KpiCard label="סה״כ לידים שהתקבלו" value={totalRaw} color="text-slate-700" />
          <KpiCard label="סגרו" value={closedRaw} color="text-emerald-600" />
          <KpiCard label="לא סגרו" value={lostRaw} color="text-red-500" />
          <KpiCard label="עדיין פעילים" value={activeRaw} color="text-violet-600" />
          <KpiCard label="אחוז סגירה" value={`${wonRate}%`} color="text-emerald-700" />
          <KpiCard label="אחוז נשירה" value={`${lostRate}%`} color="text-red-600" />
        </div>

        {/* Leads by Month */}
        {byMonth.length > 0 && (
          <Card title="לידים לפי חודש">
            <div className="flex items-end gap-2 h-32 mt-2">
              {byMonth.map((m, i) => {
                const max = Math.max(...byMonth.map(x => Math.max(parseInt(x.total), parseInt(x.won))));
                const h = Math.round((parseInt(m.total) / (max || 1)) * 100);
                const wonH = Math.round((parseInt(m.won) / (max || 1)) * 100);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1"
                    onMouseEnter={() => setHoveredMonth(i)} onMouseLeave={() => setHoveredMonth(null)}>
                    <div className="w-full relative flex flex-col justify-end cursor-default" style={{ height: '100px' }}>
                      <div className="w-full bg-slate-200 rounded-t-lg absolute bottom-0" style={{ height: `${h}%` }} />
                      <div className="w-full bg-violet-400 rounded-t-lg absolute bottom-0" style={{ height: `${wonH}%` }} />
                      {hoveredMonth === i && (
                        <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 z-10 whitespace-nowrap bg-slate-800 text-white text-[11px] rounded-lg px-2 py-1 shadow-lg pointer-events-none">
                          <div>סה״כ: {m.total}</div>
                          <div>סגרו: {m.won}</div>
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-slate-500">{m.month}</span>
                    <span className="text-xs font-bold text-slate-700">{m.total}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-4 mt-2 text-xs text-slate-500">
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-slate-200 rounded inline-block" /> כלל לידים</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-violet-400 rounded inline-block" /> סגרו עסקה</span>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Sales activity funnel */}
          <Card title="פעילות">
            {(() => {
              const offers    = parseInt(activity?.offers_sent) || 0;
              const contracts = parseInt(activity?.contracts_sent) || 0;
              const signed    = parseInt(activity?.contracts_signed) || 0;
              const max = Math.max(offers, contracts, signed, 1);
              const c1 = offers ? Math.round((contracts / offers) * 100) : 0;
              const c2 = contracts ? Math.round((signed / contracts) * 100) : 0;
              const steps = [
                { value: offers,    title: 'הצעות מחיר נשלחו', color: 'bg-sky-400',     note: null },
                { value: contracts, title: 'חוזים נשלחו',       color: 'bg-violet-400',  note: `ל-${c1}% מהלידים שקיבלו הצעת מחיר נשלח חוזה` },
                { value: signed,    title: 'חוזים נחתמו',        color: 'bg-emerald-500', note: `${c2}% מהלידים שקיבלו חוזה חתמו עליו` },
              ];
              return (
                <div className="space-y-3 mt-2">
                  {steps.map((s, i) => (
                    <div key={i}>
                      <div className="text-xs mb-0.5 text-right">
                        <span className="font-bold text-slate-700">{s.value} {s.title}</span>
                        {s.note && <span className="text-slate-400 font-normal"> ({s.note})</span>}
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2.5">
                        <div className={`h-2.5 rounded-full ${s.color}`} style={{ width: `${Math.round((s.value / max) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </Card>

          {/* By Source */}
          <Card title="לידים לפי מקור">
            <div className="space-y-2 mt-2">
              {bySource.map((s, i) => {
                const max = Math.max(...bySource.map(x => parseInt(x.count)));
                const count = parseInt(s.count);
                const pct = Math.round((count / (max || 1)) * 100);
                return (
                  <div key={s.source}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="font-bold text-slate-700">
                        {count}
                        <span className="text-sky-700 font-normal"> · {parseInt(s.offers) || 0} הצעה</span>
                        <span className="text-violet-700 font-normal"> · {parseInt(s.contracts) || 0} חוזה</span>
                        <span className="text-emerald-700 font-normal"> · {parseInt(s.closed) || 0} סגרו</span>
                      </span>
                      <span className="text-slate-500">{SOURCE_LABELS[s.source] || s.source}</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div className={`h-2 rounded-full ${SOURCE_COLORS[i % SOURCE_COLORS.length]}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Staff Performance */}
          <Card title="ביצועי צוות">
            <div className="space-y-2 mt-2">
              {staffPerf.filter(s => s.display_name).map(s => (
                <div key={s.display_name} className="flex items-center gap-2 bg-violet-50/40 rounded-xl px-3 py-2">
                  <div className="flex-1 text-right">
                    <p className="text-sm font-bold text-slate-700">{s.display_name}</p>
                    <p className="text-xs text-slate-400">{s.total} לידים · {s.won} סגרו · {s.lost} לא סגרו</p>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-black text-violet-700">
                      {parseInt(s.total) > 0 ? Math.round((parseInt(s.won) / parseInt(s.total)) * 100) : 0}%
                    </span>
                    <p className="text-xs text-slate-400">סגירה</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Lost Reasons */}
          {lostReasons.length > 0 && (
            <Card title="סיבות אי-סגירה">
              <div className="space-y-2 mt-2">
                {lostReasons.map((r, i) => {
                  const max = Math.max(...lostReasons.map(x => parseInt(x.count)));
                  const pct = Math.round((parseInt(r.count) / (max || 1)) * 100);
                  return (
                    <div key={r.lost_reason}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="font-bold text-slate-700">{parseInt(r.count)}</span>
                        <span className="text-slate-500">{LOST_REASON_LABELS[r.lost_reason] || r.lost_reason}</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2">
                        <div className="h-2 rounded-full bg-red-400" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, color }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-violet-100 p-4 text-right">
      <p className={`text-2xl font-black ${color}`}>{value}</p>
      <p className="text-xs text-slate-400 mt-0.5">{label}</p>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-violet-100 p-4">
      <h3 className="text-sm font-black text-slate-700 text-right">{title}</h3>
      {children}
    </div>
  );
}
