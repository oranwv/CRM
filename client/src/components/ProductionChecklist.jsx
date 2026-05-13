import { useState, useEffect } from 'react';
import api from '../api';

const ITEMS = [
  { key: 'deposit_received',        label: 'התקבלה מקדמה' },
  { key: 'production_meeting_set',  label: 'נקבעה פגישת הפקה' },
  { key: 'production_meeting_done', label: 'בוצעה פגישת הפקה' },
  { key: 'waiters_closed',          label: 'נסגרו מלצרים' },
  { key: 'bartenders_closed',       label: 'נסגרו ברמנים' },
  { key: 'security_closed',         label: 'נסגר מאבטח' },
  { key: 'catering_closed',         label: 'נסגר קייטרינג/שף' },
  { key: 'full_payment_received',   label: 'הועבר סך התשלום לאירוע' },
];

function fmtTs(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ProductionChecklist({ leadId }) {
  const [items, setItems]   = useState([]);
  const [toggling, setToggling] = useState(null);

  async function load() {
    try {
      const { data } = await api.get(`/leads/${leadId}/production-checklist`);
      setItems(data);
    } catch { /* silent */ }
  }

  useEffect(() => { load(); }, [leadId]);

  async function toggle(key) {
    if (toggling) return;
    setToggling(key);
    try {
      await api.post(`/leads/${leadId}/production-checklist/${key}`);
      await load();
    } finally {
      setToggling(null);
    }
  }

  const done  = items.filter(i => i.checked_at).length;
  const total = ITEMS.length;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-slate-400">רשימת ביצוע</span>
        <span className="text-xs font-bold text-violet-600">{done}/{total}</span>
      </div>
      {ITEMS.map(({ key, label }) => {
        const row = items.find(i => i.item_key === key);
        const checked = !!row?.checked_at;
        const ts = fmtTs(row?.checked_at);
        return (
          <button
            key={key}
            onClick={() => toggle(key)}
            disabled={toggling === key}
            className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl border text-right transition ${
              checked
                ? 'bg-emerald-50 border-emerald-200'
                : 'bg-white border-slate-200 hover:border-violet-300'
            }`}
          >
            <span className={`mt-0.5 shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center text-[11px] font-black ${
              checked ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300'
            }`}>
              {checked ? '✓' : ''}
            </span>
            <span className="flex-1">
              <span className={`text-sm font-semibold ${checked ? 'text-emerald-700 line-through decoration-emerald-400' : 'text-slate-700'}`}>
                {label}
              </span>
              {ts && (
                <span className="block text-[11px] text-slate-400 mt-0.5">
                  {row?.checked_by_name ? `${row.checked_by_name} · ` : ''}{ts}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
