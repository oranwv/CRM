import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api';

const SUPPLIER_TYPES = ['עיצוב', 'DJ', 'צלם מגנטים', 'צלם סטילס', 'רב', 'אחר'];

function AutoChip() {
  return (
    <span className="text-[10px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded font-semibold mr-1">מולא אוטומטית</span>
  );
}

function Field({ label, auto, children }) {
  return (
    <div>
      <label className="flex items-center text-xs font-bold text-slate-500 mb-1">
        {label}
        {auto && <AutoChip />}
      </label>
      {children}
    </div>
  );
}

const inputCls  = 'w-full rounded-xl px-3 py-2 text-sm border border-slate-200 focus:border-violet-400 focus:outline-none text-slate-700';
const roInputCls = 'w-full rounded-xl px-3 py-2 text-sm border border-slate-100 bg-slate-50 text-slate-500 select-none';

export default function EventBriefModal({ leadId, onClose }) {
  const [auto, setAuto]     = useState({});
  const [data, setData]     = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const saveTimer = useRef(null);
  const printRef  = useRef(null);

  useEffect(() => {
    api.get(`/leads/${leadId}/event-brief`)
      .then(r => {
        setAuto(r.data.auto || {});
        setData(r.data.brief || {});
      })
      .catch(() => {});
  }, [leadId]);

  const scheduleSave = useCallback((nextData) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await api.put(`/leads/${leadId}/event-brief`, { data: nextData });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } finally {
        setSaving(false);
      }
    }, 800);
  }, [leadId]);

  function set(key, val) {
    const next = { ...data, [key]: val };
    setData(next);
    scheduleSave(next);
  }

  function addSupplier(type) {
    const suppliers = [...(data.suppliers || []), { id: Date.now(), supplier_type: type, custom_type: '', name: '', phone: '', price: '' }];
    set('suppliers', suppliers);
  }

  function updateSupplier(id, field, val) {
    const suppliers = (data.suppliers || []).map(s => s.id === id ? { ...s, [field]: val } : s);
    set('suppliers', suppliers);
  }

  function removeSupplier(id) {
    const suppliers = (data.suppliers || []).filter(s => s.id !== id);
    set('suppliers', suppliers);
  }

  function exportPdf() {
    const content = printRef.current?.innerHTML || '';
    const win = window.open('', '_blank');
    win.document.write(`
      <!DOCTYPE html><html dir="rtl"><head>
      <meta charset="utf-8">
      <title>בריף אירוע</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; direction: rtl; font-size: 13px; color: #1e293b; }
        .section-title { font-weight: 900; font-size: 14px; margin: 16px 0 8px; color: #4f46e5; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .field label { font-size: 11px; color: #64748b; font-weight: bold; display: block; margin-bottom: 2px; }
        .field .val { font-size: 13px; color: #1e293b; }
        .auto-chip { font-size: 10px; background: #f1f5f9; color: #94a3b8; padding: 1px 5px; border-radius: 4px; margin-right: 4px; }
        .supplier { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; margin-bottom: 8px; }
        .supplier-title { font-weight: bold; color: #7c3aed; margin-bottom: 4px; }
        textarea, input { border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px 8px; width: 100%; box-sizing: border-box; }
        @media print { body { padding: 8px; } }
      </style></head><body>
      <h2 style="text-align:center;color:#4f46e5;margin-bottom:16px">בריף אירוע</h2>
      ${content}
      </body></html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 500);
  }

  const isWedding = (auto.event_type || '').includes('חתונה');

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-white" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        <h2 className="font-black text-slate-800 text-base">בריף אירוע</h2>
        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-slate-400">שומר...</span>}
          {saved  && <span className="text-xs text-emerald-600 font-bold">נשמר</span>}
          <button
            onClick={exportPdf}
            className="text-xs px-3 py-1.5 rounded-xl font-bold border border-violet-300 text-violet-700 hover:bg-violet-50 transition"
          >
            יצוא PDF
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div ref={printRef} className="space-y-4 max-w-2xl mx-auto">

          {/* Auto-filled from lead */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="שמות הלקוחות" auto>
              <div className={roInputCls}>{auto.client_name || '—'}</div>
            </Field>
            <Field label="סוג אירוע" auto>
              <div className={roInputCls}>{auto.event_type || '—'}</div>
            </Field>
            <Field label="תאריך אירוע" auto>
              <div className={roInputCls}>{auto.event_date || '—'}</div>
            </Field>
            <Field label="יום בשבוע" auto>
              <div className={roInputCls}>{auto.day_of_week || '—'}</div>
            </Field>
            <Field label="שעות אירוע" auto>
              <div className={roInputCls}>
                {auto.event_time && auto.event_end_time
                  ? `${auto.event_time} – ${auto.event_end_time}`
                  : auto.event_time || '—'}
              </div>
            </Field>
            <Field label="מספר אורחים בחוזה" auto={!!auto.contract_guests}>
              {auto.contract_guests
                ? <div className={roInputCls}>{auto.contract_guests}</div>
                : <input className={inputCls} value={data.contract_guests || ''} onChange={e => set('contract_guests', e.target.value)} />
              }
            </Field>
          </div>

          {/* Auto-filled from contract */}
          <div className="grid grid-cols-1 gap-3">
            <Field label="תפריט אוכל" auto={!!auto.chef_menu}>
              {auto.chef_menu
                ? <div className={roInputCls}>{auto.chef_menu}</div>
                : <input className={inputCls} value={data.chef_menu || ''} onChange={e => set('chef_menu', e.target.value)} />
              }
            </Field>
            <Field label="תפריט בר" auto={!!auto.bar_menu}>
              {auto.bar_menu
                ? <div className={roInputCls}>{auto.bar_menu}</div>
                : <input className={inputCls} value={data.bar_menu || ''} onChange={e => set('bar_menu', e.target.value)} />
              }
            </Field>
          </div>

          {/* Manual fields */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="מנהל אירוע">
              <input className={inputCls} value={data.event_manager || ''} onChange={e => set('event_manager', e.target.value)} />
            </Field>
            <Field label="תיזכור על צ'ק ביטחון">
              <input className={inputCls} value={data.security_check_reminder || ''} onChange={e => set('security_check_reminder', e.target.value)} />
            </Field>
            <Field label={'האם שולם אקו"ם'}>
              <input className={inputCls} value={data.ekom_paid || ''} onChange={e => set('ekom_paid', e.target.value)} />
            </Field>
            <Field label="מספר אורחים שצפוי להגיע">
              <input className={inputCls} value={data.expected_guests || ''} onChange={e => set('expected_guests', e.target.value)} />
            </Field>
            <Field label="כמות ילדים">
              <input className={inputCls} value={data.children_count || ''} onChange={e => set('children_count', e.target.value)} />
            </Field>
            <Field label="כיסא תינוק">
              <input className={inputCls} value={data.baby_chairs || ''} onChange={e => set('baby_chairs', e.target.value)} />
            </Field>
            <Field label="שירותי נכים">
              <input className={inputCls} value={data.disabled_services || ''} onChange={e => set('disabled_services', e.target.value)} />
            </Field>
            <Field label="צורת הגשת אוכל">
              <input className={inputCls} value={data.food_service_style || ''} onChange={e => set('food_service_style', e.target.value)} />
            </Field>
            <Field label="צורת הושבה">
              <input className={inputCls} value={data.seating_arrangement || ''} onChange={e => set('seating_arrangement', e.target.value)} />
            </Field>
            <Field label="האם יש קוקטיילים">
              <input className={inputCls} value={data.cocktails || ''} onChange={e => set('cocktails', e.target.value)} />
            </Field>
            <Field label="האם ידוע על אלרגיה של אורחים">
              <input className={inputCls} value={data.allergies || ''} onChange={e => set('allergies', e.target.value)} />
            </Field>
            <Field label="נגישות">
              <input className={inputCls} value={data.accessibility || ''} onChange={e => set('accessibility', e.target.value)} />
            </Field>
            <Field label="חניות">
              <input className={inputCls} value={data.parking || ''} onChange={e => set('parking', e.target.value)} />
            </Field>
            <Field label="מקרן">
              <input className={inputCls} value={data.projector || ''} onChange={e => set('projector', e.target.value)} />
            </Field>
            <Field label="מיקרופון">
              <input className={inputCls} value={data.microphone || ''} onChange={e => set('microphone', e.target.value)} />
            </Field>
            <Field label="עמדת די ג'יי">
              <input className={inputCls} value={data.dj_station || ''} onChange={e => set('dj_station', e.target.value)} />
            </Field>
            <Field label="כספת">
              <input className={inputCls} value={data.safe || ''} onChange={e => set('safe', e.target.value)} />
            </Field>
            <Field label="דקורציה לאירוע">
              <input className={inputCls} value={data.decoration || ''} onChange={e => set('decoration', e.target.value)} />
            </Field>
          </div>

          {/* Wedding-only fields */}
          {isWedding && (
            <div className="grid grid-cols-2 gap-3 rounded-2xl border border-rose-100 bg-rose-50 p-3">
              <p className="col-span-2 text-xs font-bold text-rose-400 mb-1">שדות לחתונה</p>
              <Field label="סוג חתונה (הפוכה/קלאסית)">
                <input className={inputCls} value={data.wedding_type || ''} onChange={e => set('wedding_type', e.target.value)} />
              </Field>
              <Field label="יין לחופה (לבן/אדום)">
                <input className={inputCls} value={data.wine_for_ceremony || ''} onChange={e => set('wine_for_ceremony', e.target.value)} />
              </Field>
              <Field label="חדר חתן כלה">
                <input className={inputCls} value={data.bridal_suite || ''} onChange={e => set('bridal_suite', e.target.value)} />
              </Field>
              <Field label="חופה">
                <input className={inputCls} value={data.ceremony_type || ''} onChange={e => set('ceremony_type', e.target.value)} placeholder="מסורתית במבוק / עומדת..." />
              </Field>
              <Field label="מיקום החופה">
                <input className={inputCls} value={data.ceremony_location || ''} onChange={e => set('ceremony_location', e.target.value)} />
              </Field>
            </div>
          )}

          {/* Multi-line fields */}
          <div className="space-y-3">
            <Field label={'לו"ז הקמות'}>
              <textarea className={`${inputCls} resize-none`} rows={3} value={data.setup_schedule || ''} onChange={e => set('setup_schedule', e.target.value)} />
            </Field>
            <Field label={'לו"ז אירוע'}>
              <textarea className={`${inputCls} resize-none`} rows={3} value={data.event_schedule || ''} onChange={e => set('event_schedule', e.target.value)} />
            </Field>
            <Field label="בחירת מנות בתפריט">
              <textarea className={`${inputCls} resize-none`} rows={3} value={data.menu_selection || ''} onChange={e => set('menu_selection', e.target.value)} />
            </Field>
            <Field label="הערות על האירוע">
              <textarea className={`${inputCls} resize-none`} rows={4} value={data.event_notes || ''} onChange={e => set('event_notes', e.target.value)} />
            </Field>
          </div>

          {/* Suppliers */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-500">ספקים חיצוניים</span>
              <div className="flex flex-wrap gap-1 justify-end">
                {SUPPLIER_TYPES.map(t => (
                  <button
                    key={t}
                    onClick={() => addSupplier(t)}
                    className="text-[11px] px-2 py-0.5 rounded-full border border-violet-300 text-violet-700 hover:bg-violet-50 transition font-semibold"
                  >
                    + {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {(data.suppliers || []).map(s => (
                <div key={s.id} className="bg-slate-50 rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-violet-600">
                      {s.supplier_type === 'אחר' && s.custom_type ? s.custom_type : s.supplier_type}
                    </span>
                    <button onClick={() => removeSupplier(s.id)} className="text-rose-400 hover:text-rose-600 text-sm font-bold leading-none">&times;</button>
                  </div>
                  {s.supplier_type === 'אחר' && (
                    <input
                      className={`${inputCls} mb-2`}
                      placeholder="סוג ספק"
                      value={s.custom_type}
                      onChange={e => updateSupplier(s.id, 'custom_type', e.target.value)}
                    />
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    <input className={inputCls} placeholder="שם" value={s.name} onChange={e => updateSupplier(s.id, 'name', e.target.value)} />
                    <input className={inputCls} placeholder="טלפון" value={s.phone} onChange={e => updateSupplier(s.id, 'phone', e.target.value)} dir="ltr" />
                    <input className={inputCls} placeholder="מחיר" value={s.price} onChange={e => updateSupplier(s.id, 'price', e.target.value)} />
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
