import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { openLead } from '../utils/openLead';

// "פתיחת יום" (Phase 83, 2026-11-14): the ranked day plan from /api/sales/day-plan — the same
// plan the morning WhatsApp is built from — with the reasons behind every line, plus extra
// sections that don't fit in the message. The "תובנות AI" tab is unchanged.

const fmtDate = d => d ? new Date(d).toLocaleDateString('he-IL') : '—';
const dayStr = d => d.toISOString().slice(0, 10);
const shiftDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return dayStr(d); };
const fmtK = n => (n == null ? '' : `₪${Math.round(Number(n)).toLocaleString('he-IL')}`);
const ago = d => { if (!d) return ''; const n = Math.floor((Date.now() - new Date(d)) / 86400000); return n <= 0 ? 'היום' : n === 1 ? 'אתמול' : `לפני ${n} ימים`; };

const TEMP_PILL = {
  hot:  { label: '🔥 חם',   cls: 'bg-red-100 text-red-700' },
  warm: { label: '🌤️ פושר', cls: 'bg-amber-100 text-amber-700' },
  cold: { label: '❄️ קר',   cls: 'bg-sky-100 text-sky-700' },
};
const KIND_LABELS = {
  whatsapp: 'וואטסאפ', facebook: 'פייסבוק', instagram: 'אינסטגרם',
  call: 'שיחה', call_attempt: 'ניסיון שיחה', meeting: 'פגישה', email: 'אימייל', note: 'הערה',
};
const STAGE_LABELS = {
  new: 'חדש', new_no_answer: 'חדש – לא ענה', contacted: 'נוצר קשר', meeting_scheduled: 'נקבעה פגישה', meeting: 'פגישה',
  offer_sent: 'נשלחה הצעה', negotiation: 'משא ומתן', contract_sent: 'נשלח חוזה', process_no_answer: 'בתהליך – לא עונה',
};

const SECTIONS = [
  { key: 'contracts',  icon: '📝', title: 'חוזים שנשלחו וטרם נחתמו', hint: 'פתחו ולא חתמו קודם, אחר כך לפי ותק החוזה', color: 'border-red-300 bg-red-50',       dot: 'bg-red-500' },
  { key: 'nearEvents', icon: '📅', title: 'אירועים קרובים',           hint: 'אירוע בתוך 60 יום, הקרוב קודם',                color: 'border-orange-300 bg-orange-50', dot: 'bg-orange-500' },
  { key: 'engaged',    icon: '🤝', title: 'הכי בתהליך',               hint: 'ציון: הצעה, פגישה, קשר רציף, מו"מ, טמפרטורת AI', color: 'border-violet-300 bg-violet-50', dot: 'bg-violet-500' },
  { key: 'waiting',    icon: '⏳', title: 'הכדור אצלנו',              hint: 'פעולות שמחכות לנו — מהודעות, משימות, חוזה שנפתח, פגישות, שיחות ו-AI', color: 'border-amber-300 bg-amber-50', dot: 'bg-amber-500' },
  { key: 'bigDeals',   icon: '💰', title: 'העסקאות הגדולות',          hint: 'לפי רווח צפוי = סכום לפני מע"מ פחות עלויות אירוע משוערות', color: 'border-emerald-300 bg-emerald-50', dot: 'bg-emerald-500' },
];
const SECTION_TITLE = Object.fromEntries(SECTIONS.map(s => [s.key, s.title]));

const EXTRAS = [
  { key: 'newUntouched',   icon: '🆕', title: 'לידים חדשים שלא דיברנו איתם' },
  { key: 'meetingsSoon',   icon: '📆', title: 'פגישות היום / מחר' },
  { key: 'contractViewed', icon: '🔍', title: 'פתחו חוזה ולא חתמו' },
  { key: 'overdueTasks',   icon: '⏰', title: 'משימות באיחור' },
  { key: 'staleOffers',    icon: '📉', title: 'הצעות מלפני 10+ ימים בלי חוזה' },
  { key: 'vanished',       icon: '👻', title: 'נעלמו — מעל 14 יום בלי קשר' },
];

function lastContactText(lc) {
  if (!lc) return null;
  const label = KIND_LABELS[lc.kind] || lc.kind || 'קשר';
  const dir = (lc.kind === 'note') ? '' : (lc.direction === 'inbound' ? ' מהלקוח' : ' שלנו');
  const snippet = String(lc.body || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${label}${dir}${snippet ? ' — ' + snippet : ''}`;
}

function Pill({ cls, children }) {
  return <span className={`text-[10px] rounded-full px-1.5 py-0.5 font-bold whitespace-nowrap ${cls}`}>{children}</span>;
}

function LeadRow({ it, section, onOpen }) {
  const lc = lastContactText(it.last_contact);
  const facts = [];
  if (section === 'contracts') {
    facts.push(it.contract_viewed_at ? `פתח/ה את החוזה ${ago(it.contract_viewed_at)} ולא חתם/ה` : `חוזה נשלח ${ago(it.contract_sent_at)}`);
  } else {
    if (it.offer_sent_at) facts.push(`הצעה נשלחה ${fmtDate(it.offer_sent_at)}`);
    if (it.meeting_done) facts.push(`פגישה התקיימה${it.last_meeting_at ? ' ' + fmtDate(it.last_meeting_at) : ''}`);
    else if (it.next_meeting_at) facts.push(`פגישה ${fmtDate(it.next_meeting_at)}`);
  }
  const reasons = section === 'waiting' ? it.waiting : it.waiting.slice(0, 1);
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-3 py-2.5 hover:border-violet-300 transition">
      <div className="flex items-start justify-between gap-2">
        <button onClick={() => onOpen(it.lead_id)} className="text-right min-w-0 flex-1">
          <p className="font-bold text-slate-800 flex items-center gap-1.5 flex-wrap">
            <span className="truncate">{it.name || 'ללא שם'}</span>
            {it.near_event && <Pill cls="bg-red-100 text-red-700">אירוע קרוב</Pill>}
            {it.temperature && TEMP_PILL[it.temperature] && <Pill cls={TEMP_PILL[it.temperature].cls}>{TEMP_PILL[it.temperature].label}</Pill>}
            {section === 'engaged' && <Pill cls="bg-violet-100 text-violet-700">ציון {it.engagement}</Pill>}
            {it.also_in && <Pill cls="bg-slate-100 text-slate-500">גם ב: {SECTION_TITLE[it.also_in]}</Pill>}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {it.event_type || 'אירוע'} · אירוע {fmtDate(it.event_date)}{it.guest_count ? ` · ${it.guest_count} מוזמנים` : ''}
            {it.rep && <> · <b>{it.rep}</b></>} · {STAGE_LABELS[it.stage] || it.stage}
          </p>
        </button>
        <div className="text-left shrink-0">
          {it.deal_value > 0 && <p className="text-xs font-black text-violet-700 tabular-nums">{fmtK(it.deal_value)}</p>}
          {section === 'bigDeals' && (
            <p className="text-[11px] tabular-nums text-emerald-700 font-bold">
              {it.expected_profit != null ? `רווח צפוי ${fmtK(it.expected_profit)}` : <span className="text-slate-400 font-normal">אין הערכת עלויות</span>}
            </p>
          )}
        </div>
      </div>
      {facts.length > 0 && <p className="text-[11px] text-slate-600 mt-1">{facts.join(' · ')}</p>}
      {section === 'engaged' && it.engagement_parts?.length > 0 && (
        <p className="text-[11px] text-violet-600 mt-0.5">{it.engagement_parts.join(' · ')}</p>
      )}
      <p className="text-[11px] text-slate-400 mt-0.5">
        {lc ? <>קשר אחרון: {lc} · {ago(it.last_contact.ts)}</> : 'אין תיעוד קשר'}
      </p>
      {reasons.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {reasons.map((w, i) => (
            <li key={i} className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 flex items-start gap-1.5">
              <span>⏳</span><span className="flex-1">{w.text}</span>
              <span className="text-[10px] text-amber-600 whitespace-nowrap">{w.source}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-1.5 mt-2">
        <button onClick={() => onOpen(it.lead_id)} className="text-[11px] font-bold px-2 py-1 rounded-lg bg-violet-600 text-white">פתח ליד</button>
        {it.phone && <a href={`https://wa.me/${String(it.phone).replace(/\D/g, '').replace(/^0/, '972')}`} target="_blank" rel="noreferrer" className="text-[11px] font-bold px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">וואטסאפ</a>}
        {it.phone && <a href={`tel:${it.phone}`} className="text-[11px] font-bold px-2 py-1 rounded-lg bg-slate-50 text-slate-700 border border-slate-200">שיחה</a>}
      </div>
    </div>
  );
}

function Section({ def, list, more, onOpen, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const total = list.length + (more || 0);
  return (
    <div className={`rounded-2xl border ${def.color} p-3`}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 text-right">
        <span className={`w-2.5 h-2.5 rounded-full ${def.dot}`} />
        <h2 className="font-black text-slate-800 text-sm">{def.icon} {def.title}</h2>
        <span className="text-xs text-slate-400">({total})</span>
        <span className="mr-auto text-slate-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <>
          {def.hint && <p className="text-[11px] text-slate-500 mt-1 mb-2">{def.hint}</p>}
          {list.length === 0 ? <p className="text-xs text-slate-400">אין כרגע</p> : (
            <div className="space-y-2">{list.map(it => <LeadRow key={`${def.key}-${it.lead_id}`} it={it} section={def.key} onOpen={onOpen} />)}</div>
          )}
          {more > 0 && <p className="text-[11px] text-slate-400 mt-2">ועוד {more} מעבר למכסה של הסעיף</p>}
        </>
      )}
    </div>
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
  const [plan, setPlan]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState('worklist');
  const [refreshing, setRefreshing] = useState(false);
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const roles = me.roles?.length ? me.roles : [me.role];
  const isManager = ['admin', 'manager', 'sales_manager'].some(r => roles.includes(r));

  const load = useCallback(() => {
    setLoading(true);
    api.get('/sales/day-plan')
      .then(r => setPlan(r.data))
      .catch(() => setPlan(null))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  async function refreshAi() {
    setRefreshing(true);
    try { await api.post('/sales/day-plan/refresh'); load(); }
    catch (err) { alert(err.response?.data?.error || 'שגיאה ברענון'); }
    finally { setRefreshing(false); }
  }

  const openLeadFromHere = id => openLead(navigate, id);
  const c = plan?.counts || {};
  const today = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' });

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4" dir="rtl">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setTab('worklist')}
          className={`text-sm font-bold px-3 py-1.5 rounded-xl transition ${tab === 'worklist' ? 'bg-violet-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>☀️ פתיחת יום</button>
        <button onClick={() => setTab('insights')}
          className={`text-sm font-bold px-3 py-1.5 rounded-xl transition ${tab === 'insights' ? 'bg-violet-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>תובנות AI</button>
        {tab === 'worklist' && isManager && (
          <button onClick={refreshAi} disabled={refreshing} title="חילוץ בקשות פתוחות מהטקסט + הערכת עלויות לעסקאות פתוחות (רץ אוטומטית כל בוקר)"
            className="mr-auto text-xs font-bold px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-600 disabled:opacity-50">
            {refreshing ? 'מרענן AI...' : '🤖 רענן AI'}
          </button>
        )}
      </div>

      {tab === 'insights' ? <LossInsights /> : loading ? (
        <p className="text-center text-slate-400 py-8">טוען...</p>
      ) : !plan ? (
        <p className="text-center text-slate-400 py-8">לא ניתן לטעון את התוכנית</p>
      ) : !c.active ? (
        <p className="text-center text-slate-400 py-8">אין לידים פעילים לטיפול כרגע 🎉</p>
      ) : (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3">
            <p className="font-black text-slate-800">☀️ פתיחת יום · {today}</p>
            <p className="text-xs text-slate-500 mt-1">
              {c.active} לידים פעילים · 📝 {c.contracts} חוזים ממתינים · 📅 {c.nearEvents} אירועים ב-60 יום · 🤝 {c.engaged} בתהליך · ⏳ {c.waiting} ממתינים לפעולה שלנו
            </p>
          </div>

          {SECTIONS.map(def => (
            <Section key={def.key} def={def} list={plan.sections[def.key] || []} more={plan.more?.[def.key] || 0} onOpen={openLeadFromHere} />
          ))}

          <div className="pt-2">
            <p className="text-xs font-black text-slate-500 mb-2">עוד דברים ששווה לראות היום</p>
            <div className="space-y-3">
              {EXTRAS.map(def => (
                <Section key={def.key} def={{ ...def, color: 'border-slate-200 bg-white', dot: 'bg-slate-400' }}
                  list={plan.extras?.[def.key] || []} more={0} onOpen={openLeadFromHere} defaultOpen={false} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
