// ניהול → עלויות: monthly spend on the paid services behind the CRM.
// Twilio (real billed when available, else estimate), OpenAI (metered per feature),
// fixed subscriptions entered by hand. USD is the source; ₪ via an editable rate.
import { useEffect, useState } from 'react';
import api from '../api';

const FEATURE_LABELS = {
  'assistant-chat': 'עוזר AI (צ׳אט)', 'deal-advisor': 'יועץ עסקאות / בריפינג', 'call-analysis': 'סיכום שיחות טלפון',
  'voice-note': 'תמלול הודעות קוליות', 'whatsapp-bot': 'בוט וואטסאפ', 'lead-summary': 'סיכומי ליד (תזכורות)',
  'event-cost': 'חישוב עלות אירוע', 'invoice-classifier': 'סיווג חשבוניות', 'ai-tools': 'כלי AI (שיפור/תרגום)',
};
const TW_CATS = {
  'calls-inbound': 'שיחות נכנסות', 'calls-outbound': 'שיחות יוצאות', 'calls-client': 'רגל דפדפן',
  'recordings': 'הקלטות', 'calls-recordings': 'הקלטות', 'phonenumbers': 'מספר טלפון', 'transcriptions': 'תמלול Twilio', 'calls': 'שיחות',
};
const SUGGESTED = [
  { name: 'Railway (שרת)', currency: 'USD' }, { name: 'Supabase (DB + קבצים)', currency: 'USD' },
  { name: 'Green API (וואטסאפ)', currency: 'USD' }, { name: 'GreenInvoice', currency: 'ILS' }, { name: 'דומיין proevent.co.il', currency: 'ILS' },
];

const usd = (v) => `$${(Number(v) || 0).toFixed(2)}`;
const ils = (v, rate) => `₪${Math.round((Number(v) || 0) * rate).toLocaleString('he-IL')}`;
const monthLabel = (m) => { const [y, mo] = m.split('-'); return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' }); };

export default function CostsPage() {
  const [data, setData] = useState(null);
  const [months, setMonths] = useState(6);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [rateEdit, setRateEdit] = useState('');
  const [newSub, setNewSub] = useState({ name: '', amount: '', currency: 'USD' });

  const load = () => api.get(`/costs?months=${months}`).then(r => { setData(r.data); setRateEdit(String(r.data.rate)); }).catch(e => setError(e.response?.data?.error || e.message));
  useEffect(() => { load(); }, [months]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="p-6 text-red-600 font-bold" dir="rtl">{error}</div>;
  if (!data) return <div className="p-6 text-slate-400" dir="rtl">טוען עלויות…</div>;
  const { rate } = data;
  const current = data.months[0];

  async function saveRate() { const r = Number(rateEdit); if (!r) return; await api.put('/costs/rate', { rate: r }); load(); }
  async function addSub(e) {
    e.preventDefault();
    if (!newSub.name || newSub.amount === '') return;
    await api.post('/costs/subscriptions', newSub); setNewSub({ name: '', amount: '', currency: 'USD' }); load();
  }
  async function removeSub(id) { if (!confirm('להסיר את המנוי מהחישוב?')) return; await api.delete(`/costs/subscriptions/${id}`); load(); }

  return (
    <div className="min-h-screen bg-slate-50 pb-32" dir="rtl">
      <div className="px-4 pt-4 pb-3 flex items-center gap-3 flex-wrap sticky top-11 bg-slate-50 z-10 border-b border-slate-200">
        <span className="font-black text-slate-700 text-sm">עלויות שירותים</span>
        <select value={months} onChange={e => setMonths(Number(e.target.value))}
          className="border border-slate-300 rounded-xl px-2 py-1.5 text-sm bg-white">
          {[3, 6, 12].map(n => <option key={n} value={n}>{n} חודשים</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs text-slate-500">שער $→₪
          <input value={rateEdit} onChange={e => setRateEdit(e.target.value)} onBlur={saveRate}
            className="w-16 border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white text-center" dir="ltr" />
        </label>
        <span className="text-[11px] text-slate-400">{data.twilio_live ? 'Twilio: חיוב אמיתי' : 'Twilio: הערכה לפי מחירון'}</span>
      </div>

      {/* Current month summary */}
      <div className="px-4 pt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label={`סה"כ ${monthLabel(current.month)}`} main={ils(current.total_usd, rate)} sub={usd(current.total_usd)} strong />
        <Tile label="Twilio — שיחות" main={ils(current.twilio.total_usd, rate)} sub={`${current.twilio.calls} שיחות · ${current.twilio.minutes} דק׳`} />
        <Tile label="OpenAI — AI" main={ils(current.ai.total_usd, rate)} sub={usd(current.ai.total_usd)} />
        <Tile label="מנויים קבועים" main={ils(current.subscriptions_usd, rate)} sub={`${data.subscriptions.length} שירותים`} />
      </div>

      {/* Monthly table */}
      <div className="px-4 pt-5">
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr><th className="text-right px-3 py-2">חודש</th><th className="px-3 py-2">Twilio</th><th className="px-3 py-2">OpenAI</th><th className="px-3 py-2">מנויים</th><th className="px-3 py-2 font-black text-slate-700">סה"כ ₪</th><th></th></tr>
            </thead>
            <tbody>
              {data.months.map(m => (
                <FragmentRow key={m.month} m={m} rate={rate} open={open === m.month} onToggle={() => setOpen(open === m.month ? null : m.month)} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
          Twilio מחויב לפי דקות בפועל: נכנסת ${data.prices.inbound}/דק׳, יוצאת לנייד ${data.prices.outMobile}/דק׳ (לקו ${data.prices.outLandline}), רגל דפדפן ${data.prices.client}/דק׳, הקלטה ${data.prices.recording}/דק׳, מספר ${data.prices.number}/חודש.
          OpenAI נמדד לפי טוקנים ודקות אודיו בכל קריאה מהמערכת (החל מ-16/09/26 — שימוש ישן יותר לא נספר). הסכומים הם הערכה לפי מחירון; החשבונית האמיתית עלולה לסטות במעט.
        </p>
      </div>

      {/* Subscriptions */}
      <div className="px-4 pt-6">
        <h3 className="font-black text-slate-700 text-sm mb-2">מנויים קבועים (לחודש)</h3>
        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
          {data.subscriptions.map(s => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="flex-1 font-semibold text-slate-700">{s.name}</span>
              <span className="text-slate-600" dir="ltr">{s.currency === 'ILS' ? `₪${Number(s.amount).toLocaleString('he-IL')}` : usd(s.amount)}</span>
              <button onClick={() => removeSub(s.id)} className="text-slate-300 hover:text-red-500 text-lg leading-none" title="הסר">&times;</button>
            </div>
          ))}
          {!data.subscriptions.length && <div className="px-4 py-3 text-sm text-slate-400">עוד לא הוזנו מנויים. הוסף למטה — למשל Railway, Supabase, Green API.</div>}
          <form onSubmit={addSub} className="flex items-center gap-2 px-4 py-3 flex-wrap">
            <input list="sub-names" placeholder="שם השירות" value={newSub.name} onChange={e => setNewSub(s => ({ ...s, name: e.target.value, currency: SUGGESTED.find(x => x.name === e.target.value)?.currency || s.currency }))}
              className="flex-1 min-w-[160px] border border-slate-300 rounded-xl px-3 py-1.5 text-sm" />
            <datalist id="sub-names">{SUGGESTED.map(s => <option key={s.name} value={s.name} />)}</datalist>
            <input type="number" step="0.01" min="0" placeholder="סכום" value={newSub.amount} onChange={e => setNewSub(s => ({ ...s, amount: e.target.value }))}
              className="w-24 border border-slate-300 rounded-xl px-3 py-1.5 text-sm" dir="ltr" />
            <select value={newSub.currency} onChange={e => setNewSub(s => ({ ...s, currency: e.target.value }))} className="border border-slate-300 rounded-xl px-2 py-1.5 text-sm bg-white">
              <option value="USD">$</option><option value="ILS">₪</option>
            </select>
            <button type="submit" className="px-3 py-1.5 rounded-xl bg-violet-600 text-white text-sm font-black hover:bg-violet-700">הוסף</button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, main, sub, strong }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${strong ? 'bg-violet-600 border-violet-600 text-white' : 'bg-white border-slate-200'}`}>
      <div className={`text-[11px] font-bold ${strong ? 'text-violet-100' : 'text-slate-500'}`}>{label}</div>
      <div className="text-xl font-black mt-0.5" dir="ltr">{main}</div>
      <div className={`text-[11px] ${strong ? 'text-violet-100' : 'text-slate-400'}`} dir="ltr">{sub}</div>
    </div>
  );
}

function FragmentRow({ m, rate, open, onToggle }) {
  return (
    <>
      <tr onClick={onToggle} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
        <td className="px-3 py-2.5 font-bold text-slate-700">{monthLabel(m.month)}</td>
        <td className="px-3 py-2.5 text-center text-slate-600" dir="ltr">{usd(m.twilio.total_usd)}{m.twilio.billed ? '' : ' ~'}</td>
        <td className="px-3 py-2.5 text-center text-slate-600" dir="ltr">{usd(m.ai.total_usd)}</td>
        <td className="px-3 py-2.5 text-center text-slate-600" dir="ltr">{usd(m.subscriptions_usd)}</td>
        <td className="px-3 py-2.5 text-center font-black text-slate-800" dir="ltr">{ils(m.total_usd, rate)}</td>
        <td className="px-2 text-slate-400 text-xs">{open ? '▴' : '▾'}</td>
      </tr>
      {open && (
        <tr className="bg-slate-50/60">
          <td colSpan={6} className="px-4 py-3">
            <div className="grid sm:grid-cols-2 gap-4 text-xs">
              <div>
                <div className="font-black text-slate-600 mb-1">📞 Twilio — {m.twilio.calls} שיחות, {m.twilio.answered} נענו, {m.twilio.minutes} דקות</div>
                {m.twilio.categories && Object.keys(m.twilio.categories).length ? (
                  Object.entries(m.twilio.categories).map(([k, v]) => (
                    <div key={k} className="flex justify-between py-0.5 text-slate-600"><span>{TW_CATS[k] || k}</span><span dir="ltr">{usd(v)}</span></div>
                  ))
                ) : (
                  <>
                    <div className="flex justify-between py-0.5 text-slate-600"><span>שיחות (הערכה לפי דקות)</span><span dir="ltr">{usd(m.twilio.estimate_usd - m.twilio.number_fee_usd)}</span></div>
                    <div className="flex justify-between py-0.5 text-slate-600"><span>מספר טלפון</span><span dir="ltr">{usd(m.twilio.number_fee_usd)}</span></div>
                  </>
                )}
              </div>
              <div>
                <div className="font-black text-slate-600 mb-1">🤖 OpenAI לפי שימוש</div>
                {m.ai.rows.length ? m.ai.rows.map((r, i) => (
                  <div key={i} className="flex justify-between py-0.5 text-slate-600 gap-2">
                    <span className="truncate">{FEATURE_LABELS[r.feature] || r.feature} <span className="text-slate-400">· {r.model} · {r.calls}×</span></span>
                    <span dir="ltr" className="shrink-0">{usd(r.cost_usd)}</span>
                  </div>
                )) : <div className="text-slate-400">אין שימוש מתועד</div>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
