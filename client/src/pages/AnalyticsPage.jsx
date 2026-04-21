import { useState, useEffect } from 'react';
import api from '../api';

const STAGE_LABELS = {
  new: 'חדש', contacted: 'יצירת קשר', meeting: 'פגישה',
  offer_sent: 'הצעת מחיר', negotiation: 'מו"מ',
  contract_sent: 'חוזה נשלח', deposit: 'מקדמה', production: 'הפקה', lost: 'לא סגרו',
};

const SOURCE_LABELS = {
  website_popup: 'אתר (פופאפ)', website_form: 'אתר (טופס)',
  call_event: 'Call Event', telekol: 'טלקול',
  whatsapp: 'וואטסאפ', facebook: 'פייסבוק',
  instagram: 'אינסטגרם', manual: 'ידני',
};

const LOST_REASON_LABELS = {
  price: 'מחיר/תקציב', date: 'תאריך תפוס', competitor: 'בחר מתחרה',
  ghosted: 'נעלם', plans_changed: 'שינוי תוכניות', other: 'אחר',
};

const STAGE_COLORS = [
  'bg-sky-400', 'bg-amber-400', 'bg-violet-400', 'bg-blue-400',
  'bg-orange-400', 'bg-indigo-400', 'bg-emerald-400', 'bg-teal-400', 'bg-red-400',
];

const SOURCE_COLORS = [
  'bg-violet-400', 'bg-purple-400', 'bg-orange-400', 'bg-sky-400',
  'bg-green-400', 'bg-blue-400', 'bg-pink-400', 'bg-slate-400',
];

export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/analytics/overview')
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center">
      <p className="text-slate-400">טוען נתונים...</p>
    </div>
  );

  if (!data) return null;

  const { overview, byStage, bySource, byMonth, staffPerf, lostReasons } = data;
  const total = parseInt(overview.total) || 1;
  const wonRate = Math.round((parseInt(overview.closed) / total) * 100);
  const lostRate = Math.round((parseInt(overview.lost) / total) * 100);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-700 via-teal-600 to-cyan-600 px-4 py-3 flex items-center justify-between shadow-lg">
        <a href="/" className="text-emerald-200 hover:text-white text-sm transition">← חזרה</a>
        <div className="text-right">
          <h1 className="text-lg font-black text-white">📊 אנליטיקס</h1>
          <p className="text-emerald-200 text-xs">סטטיסטיקות ומדדים</p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 space-y-5">

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard label="סה״כ לידים" value={overview.total} color="text-slate-700" />
          <KpiCard label="חדשים" value={overview.new_leads} color="text-sky-600" />
          <KpiCard label="בתהליך" value={overview.in_process} color="text-amber-600" />
          <KpiCard label="סגרו עסקה" value={overview.closed} color="text-emerald-600" />
          <KpiCard label="לא סגרו" value={overview.lost} color="text-red-500" />
          <KpiCard label="אחוז סגירה" value={`${wonRate}%`} color="text-emerald-700" />
          <KpiCard label="אחוז נשירה" value={`${lostRate}%`} color="text-red-600" />
          <KpiCard label="פעילים" value={parseInt(overview.in_process) + parseInt(overview.new_leads)} color="text-violet-600" />
        </div>

        {/* Leads by Month */}
        {byMonth.length > 0 && (
          <Card title="לידים לפי חודש">
            <div className="flex items-end gap-2 h-32 mt-2">
              {byMonth.map((m, i) => {
                const max = Math.max(...byMonth.map(x => parseInt(x.total)));
                const h = Math.round((parseInt(m.total) / (max || 1)) * 100);
                const wonH = Math.round((parseInt(m.won) / (max || 1)) * 100);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full relative flex flex-col justify-end" style={{ height: '100px' }}>
                      <div className="w-full bg-slate-200 rounded-t-lg absolute bottom-0" style={{ height: `${h}%` }} />
                      <div className="w-full bg-emerald-400 rounded-t-lg absolute bottom-0" style={{ height: `${wonH}%` }} />
                    </div>
                    <span className="text-xs text-slate-500">{m.month}</span>
                    <span className="text-xs font-bold text-slate-700">{m.total}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-4 mt-2 text-xs text-slate-500">
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-slate-200 rounded inline-block" /> כלל לידים</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-emerald-400 rounded inline-block" /> סגרו עסקה</span>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* By Stage */}
          <Card title="לידים לפי שלב">
            <div className="space-y-2 mt-2">
              {byStage.map((s, i) => {
                const max = Math.max(...byStage.map(x => parseInt(x.count)));
                const pct = Math.round((parseInt(s.count) / (max || 1)) * 100);
                return (
                  <div key={s.stage}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="font-bold text-slate-700">{parseInt(s.count)}</span>
                      <span className="text-slate-500">{STAGE_LABELS[s.stage] || s.stage}</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div className={`h-2 rounded-full ${STAGE_COLORS[i % STAGE_COLORS.length]}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* By Source */}
          <Card title="לידים לפי מקור">
            <div className="space-y-2 mt-2">
              {bySource.map((s, i) => {
                const max = Math.max(...bySource.map(x => parseInt(x.count)));
                const pct = Math.round((parseInt(s.count) / (max || 1)) * 100);
                const wonPct = parseInt(s.count) > 0 ? Math.round((parseInt(s.won) / parseInt(s.count)) * 100) : 0;
                return (
                  <div key={s.source}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="font-bold text-slate-700">{parseInt(s.count)} <span className="text-emerald-600 font-normal">({wonPct}% סגרו)</span></span>
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
                <div key={s.display_name} className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
                  <div className="flex-1 text-right">
                    <p className="text-sm font-bold text-slate-700">{s.display_name}</p>
                    <p className="text-xs text-slate-400">{s.total} לידים · {s.won} סגרו · {s.lost} לא סגרו</p>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-black text-emerald-600">
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
    <div className="bg-white rounded-2xl shadow-sm border border-emerald-100 p-4 text-right">
      <p className={`text-2xl font-black ${color}`}>{value}</p>
      <p className="text-xs text-slate-400 mt-0.5">{label}</p>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-emerald-100 p-4">
      <h3 className="text-sm font-black text-slate-700 text-right">{title}</h3>
      {children}
    </div>
  );
}
