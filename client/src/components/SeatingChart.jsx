import { useState, useEffect, useRef } from 'react';
import api from '../api';

const DEFS = {
  round_table_4:  { label: 'שולחן עגול (4)',   shape: 'circle', wM: 1,   hM: 1,    guests: 4  },
  rect_table_10:  { label: 'שולחן מלבני (10)', shape: 'rect',   wM: 0.8, hM: 2.4,  guests: 10 },
  rect_table_20:  { label: 'שולחן מלבני (20)', shape: 'rect',   wM: 0.8, hM: 4.8,  guests: 20 },
  round_bar:      { label: 'בר (עגול)',         shape: 'circle', wM: 1,   hM: 1,    guests: 0  },
  chavit:         { label: 'חבית',              shape: 'circle', wM: 1,   hM: 1,    guests: 0  },
  bama:           { label: 'במה',               shape: 'rect',   wM: 3,   hM: 2.4,  guests: 0  },
  dj_stand:       { label: 'DJ',                shape: 'rect',   wM: 1,   hM: 0.3,  guests: 0  },
  coffee_corner:  { label: 'פינת קפה',          shape: 'rect',   wM: 1.5, hM: 0.3,  guests: 0  },
  butcher_large:  { label: "בוצ'ר גדול",        shape: 'rect',   wM: 1.8, hM: 1,    guests: 0  },
  butcher_small:  { label: "בוצ'ר קטן",         shape: 'rect',   wM: 1.3, hM: 0.5,  guests: 0  },
  kasefet:        { label: 'כספת',              shape: 'rect',   wM: 0.4, hM: 0.4,  guests: 0  },
  sofa:           { label: 'ספה',               shape: 'rect',   wM: 1.8, hM: 0.3,  guests: 0  },
  butcher_cart:   { label: "בוצ'ר עגלה",        shape: 'rect',   wM: 1,   hM: 0.3,  guests: 0  },
  couch:          { label: 'ספת ישיבה',         shape: 'couch',  wM: 0.4, hM: 0.3,  guests: 0  },
  bar_arc:        { label: 'בר (קשתי)',         shape: 'arc',    wM: 2.5, hM: 1.25, guests: 0  },
};

const FILL = {
  round_table_4: '#ddd6fe', rect_table_10: '#ddd6fe', rect_table_20: '#ddd6fe',
  round_bar: '#fed7aa', chavit: '#d1fae5', bama: '#fce7f3',
  dj_stand: '#e0e7ff', coffee_corner: '#fef3c7',
  butcher_large: '#dcfce7', butcher_small: '#dcfce7', butcher_cart: '#dcfce7',
  kasefet: '#f1f5f9', sofa: '#fdf4ff', couch: '#fef9c3', bar_arc: '#fed7aa',
};

const STROKE = {
  round_table_4: '#7c3aed', rect_table_10: '#7c3aed', rect_table_20: '#7c3aed',
  round_bar: '#ea580c', chavit: '#059669', bama: '#db2777',
  dj_stand: '#4f46e5', coffee_corner: '#d97706',
  butcher_large: '#16a34a', butcher_small: '#16a34a', butcher_cart: '#16a34a',
  kasefet: '#64748b', sofa: '#a21caf', couch: '#ca8a04', bar_arc: '#ea580c',
};

const PALETTE_GROUPS = [
  { label: 'שולחנות', keys: ['round_table_4', 'rect_table_10', 'rect_table_20'] },
  { label: 'בר ובמה', keys: ['round_bar', 'bar_arc', 'bama', 'dj_stand'] },
  { label: 'ריהוט',   keys: ['chavit', 'coffee_corner', 'sofa', 'couch', 'butcher_large', 'butcher_small', 'butcher_cart', 'kasefet'] },
];

function uid() {
  return `el_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function getElDef(el) {
  if (el.type === 'custom') {
    return { wM: el.wM, hM: el.hM, shape: el.shape, label: el.label, guests: 0, fill: '#e2e8f0', stroke: '#64748b' };
  }
  const d = DEFS[el.type];
  if (!d) return { wM: 1, hM: 1, shape: 'rect', label: el.type, guests: 0, fill: '#e2e8f0', stroke: '#64748b' };
  return { ...d, fill: FILL[el.type] || '#ddd6fe', stroke: STROKE[el.type] || '#7c3aed' };
}

function palDims(wM, hM) {
  const MAX = 46;
  const s = Math.min(MAX / wM, MAX / hM, 28);
  return { w: Math.max(10, Math.round(wM * s)), h: Math.max(10, Math.round(hM * s)) };
}

function ShapeBox({ shape, fill, stroke, width, height, guests }) {
  const fs = Math.max(8, Math.min(width, height) * 0.32);
  const text = guests > 0 ? String(guests) : '';
  const base = {
    width, height, boxSizing: 'border-box', userSelect: 'none', pointerEvents: 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: fs, fontWeight: 'bold', color: stroke, overflow: 'hidden',
  };
  if (shape === 'arc') return (
    <div style={{ width, height, pointerEvents: 'none', userSelect: 'none' }}>
      <svg width={width} height={height} viewBox="0 0 100 50" preserveAspectRatio="none" style={{ display: 'block' }}>
        <path d="M 0 50 A 50 50 0 0 0 100 50 L 88 50 A 38 38 0 0 1 12 50 Z" fill={fill} stroke={stroke} strokeWidth="3" />
      </svg>
    </div>
  );
  if (shape === 'circle') return <div style={{ ...base, borderRadius: '50%', background: fill, border: `2px solid ${stroke}` }}>{text}</div>;
  if (shape === 'couch')  return <div style={{ ...base, background: fill, border: `2px solid ${stroke}`, borderRadius: 4, fontSize: Math.min(width, height) * 0.6 }}>🛋️</div>;
  return <div style={{ ...base, background: fill, border: `2px solid ${stroke}`, borderRadius: 3 }}>{text}</div>;
}

export default function SeatingChart({ leadId, onClose }) {
  const [section,     setSection]     = useState('inside');
  const [layouts,     setLayouts]     = useState({ inside: [], outside: [] });
  const [floorplans,  setFloorplans]  = useState({ inside: null, outside: null });
  const [customItems, setCustomItems] = useState([]);
  const [selected,    setSelected]    = useState(null);
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [addingCustom, setAddingCustom] = useState(false);
  const [newItem,     setNewItem]     = useState({ label: '', wM: '', hM: '', shape: 'rect' });
  const [ghost,       setGhost]       = useState(null);

  const canvasRef   = useRef(null);
  const dragRef     = useRef(null);
  const saveTimer   = useRef(null);
  const sectionRef  = useRef(section);
  const scaleRef    = useRef(45);

  useEffect(() => { sectionRef.current = section; }, [section]);

  useEffect(() => {
    api.get(`/leads/${leadId}/seating`).then(r => {
      setLayouts({ inside: r.data.inside || [], outside: r.data.outside || [] });
    }).catch(() => {});
    api.get('/admin/settings').then(r => {
      const d = r.data;
      const fp = { inside: null, outside: null };
      try { fp.inside  = d.floorplan_inside  ? JSON.parse(d.floorplan_inside)  : null; } catch {}
      try { fp.outside = d.floorplan_outside ? JSON.parse(d.floorplan_outside) : null; } catch {}
      setFloorplans(fp);
      try { setCustomItems(d.seating_custom_items ? JSON.parse(d.seating_custom_items) : []); } catch {}
    }).catch(() => {});
  }, [leadId]);

  const fp     = floorplans[section];
  const scale  = fp?.widthM  ? 900 / fp.widthM  : 45;
  const canvasH = fp?.heightM ? Math.round(fp.heightM * scale) : 600;
  useEffect(() => { scaleRef.current = scale; }, [scale]);

  function triggerSave(nextLayouts, sec) {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await api.put(`/leads/${leadId}/seating`, { section: sec, elements: nextLayouts[sec] });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } finally { setSaving(false); }
    }, 1000);
  }

  async function saveNow() {
    clearTimeout(saveTimer.current);
    setSaving(true);
    try {
      const sec = sectionRef.current;
      await api.put(`/leads/${leadId}/seating`, { section: sec, elements: layouts[sec] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  }

  function deleteSelected() {
    if (!selected) return;
    const sec = sectionRef.current;
    setLayouts(prev => {
      const next = { ...prev, [sec]: prev[sec].filter(el => el.id !== selected) };
      triggerSave(next, sec);
      return next;
    });
    setSelected(null);
  }

  useEffect(() => {
    function onMove(e) {
      const ds = dragRef.current;
      if (!ds) return;
      if (ds.mode === 'palette') {
        setGhost(g => g ? { ...g, x: e.clientX, y: e.clientY } : g);
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx   = e.clientX - rect.left + canvas.scrollLeft;
      const my   = e.clientY - rect.top  + canvas.scrollTop;
      if (ds.mode === 'move') {
        setLayouts(prev => {
          const sec = sectionRef.current;
          return { ...prev, [sec]: prev[sec].map(el =>
            el.id === ds.id ? { ...el, x: Math.max(0, mx - ds.offX), y: Math.max(0, my - ds.offY) } : el
          )};
        });
      } else if (ds.mode === 'rotate') {
        const angle = Math.atan2(my - ds.cy, mx - ds.cx) * 180 / Math.PI + 90;
        setLayouts(prev => {
          const sec = sectionRef.current;
          return { ...prev, [sec]: prev[sec].map(el => el.id === ds.id ? { ...el, rotation: angle } : el) };
        });
      }
    }

    function onUp(e) {
      const ds = dragRef.current;
      if (!ds) return;
      if (ds.mode === 'palette') {
        setGhost(null);
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          if (e.clientX >= rect.left && e.clientX <= rect.right &&
              e.clientY >= rect.top  && e.clientY <= rect.bottom) {
            const s   = scaleRef.current;
            const wPx = ds.wM * s;
            const hPx = ds.hM * s;
            const mx  = e.clientX - rect.left + canvas.scrollLeft;
            const my  = e.clientY - rect.top  + canvas.scrollTop;
            const newEl = {
              id: uid(), type: ds.type,
              x: Math.max(0, mx - wPx / 2),
              y: Math.max(0, my - hPx / 2),
              rotation: 0,
              ...(ds.type === 'custom' ? { wM: ds.wM, hM: ds.hM, shape: ds.shape, label: ds.label } : {}),
            };
            setLayouts(prev => {
              const sec = sectionRef.current;
              const next = { ...prev, [sec]: [...prev[sec], newEl] };
              triggerSave(next, sec);
              return next;
            });
            setSelected(newEl.id);
          }
        }
      } else if (ds.mode === 'move' || ds.mode === 'rotate') {
        setLayouts(prev => { triggerSave(prev, sectionRef.current); return prev; });
      }
      dragRef.current = null;
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
  }, [leadId]);

  function startPaletteDrag(e, type, customData = null) {
    e.preventDefault();
    const wM = type === 'custom' ? customData.wM : DEFS[type].wM;
    const hM = type === 'custom' ? customData.hM : DEFS[type].hM;
    const shape = type === 'custom' ? customData.shape : DEFS[type].shape;
    dragRef.current = { mode: 'palette', type, wM, hM, shape, label: customData?.label };
    setGhost({ x: e.clientX, y: e.clientY, type, wM, hM, shape,
      fill:   type === 'custom' ? '#e2e8f0' : (FILL[type]   || '#ddd6fe'),
      stroke: type === 'custom' ? '#64748b' : (STROKE[type] || '#7c3aed') });
  }

  function startElementMove(e, el) {
    e.stopPropagation();
    setSelected(el.id);
    const def    = getElDef(el);
    const s      = scaleRef.current;
    const canvas = canvasRef.current;
    const rect   = canvas.getBoundingClientRect();
    const mx     = e.clientX - rect.left + canvas.scrollLeft;
    const my     = e.clientY - rect.top  + canvas.scrollTop;
    dragRef.current = { mode: 'move', id: el.id, offX: mx - el.x, offY: my - el.y, wPx: def.wM * s, hPx: def.hM * s };
  }

  function startRotate(e, el) {
    e.stopPropagation();
    const def = getElDef(el);
    const s   = scaleRef.current;
    dragRef.current = {
      mode: 'rotate', id: el.id,
      cx: el.x + (def.wM * s) / 2,
      cy: el.y + (def.hM * s) / 2,
    };
  }

  async function addCustomItem() {
    if (!newItem.label || !newItem.wM || !newItem.hM) return;
    const item = { id: uid(), label: newItem.label, wM: parseFloat(newItem.wM), hM: parseFloat(newItem.hM), shape: newItem.shape };
    const next = [...customItems, item];
    setCustomItems(next);
    setNewItem({ label: '', wM: '', hM: '', shape: 'rect' });
    setAddingCustom(false);
    await api.put('/admin/seating/custom-items', { items: next }).catch(() => {});
  }

  async function deleteCustomItem(id) {
    const next = customItems.filter(i => i.id !== id);
    setCustomItems(next);
    await api.put('/admin/seating/custom-items', { items: next }).catch(() => {});
  }

  const totalGuests = layouts[section].reduce((sum, el) => sum + (getElDef(el).guests || 0), 0);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-white" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-200 shrink-0 bg-white flex-wrap">
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        <h2 className="font-black text-slate-800 text-base">סקיצת פריסה</h2>
        <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-0.5">
          {[['inside','פנים'], ['outside','חוץ']].map(([key, lbl]) => (
            <button key={key} onClick={() => setSection(key)}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition ${section === key ? 'bg-white shadow text-violet-700' : 'text-slate-500'}`}>
              {lbl}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500 font-semibold">סה"כ: {totalGuests} אורחים</span>
        <div className="flex-1" />
        {selected && (
          <button onClick={deleteSelected}
            className="text-xs px-3 py-1.5 rounded-xl font-bold text-white bg-red-500 hover:bg-red-600 transition">
            מחק פריט
          </button>
        )}
        {saving && <span className="text-xs text-slate-400">שומר...</span>}
        {saved  && <span className="text-xs text-emerald-600 font-bold">נשמר</span>}
        <button onClick={saveNow} disabled={saving}
          className="text-xs px-3 py-1.5 rounded-xl font-bold text-white disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>שמור</button>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Palette */}
        <div className="w-36 shrink-0 border-l border-slate-200 overflow-y-auto bg-slate-50 p-2 space-y-3" dir="rtl">
          {PALETTE_GROUPS.map(group => (
            <div key={group.label}>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-wide mb-1">{group.label}</p>
              <div className="space-y-1">
                {group.keys.map(key => {
                  const d = DEFS[key];
                  const { w, h } = palDims(d.wM, d.hM);
                  return (
                    <div key={key} onMouseDown={e => startPaletteDrag(e, key)}
                      className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white hover:shadow-sm cursor-grab transition select-none">
                      <div className="shrink-0 flex items-center justify-center" style={{ width: 50, height: 50 }}>
                        <ShapeBox shape={d.shape} fill={FILL[key]} stroke={STROKE[key]} width={w} height={h} guests={d.guests} />
                      </div>
                      <span className="text-[10px] text-slate-600 leading-tight">{d.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {customItems.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-wide mb-1">מותאם אישית</p>
              <div className="space-y-1">
                {customItems.map(item => {
                  const { w, h } = palDims(item.wM, item.hM);
                  return (
                    <div key={item.id} className="relative group flex items-center gap-2 p-1.5 rounded-lg hover:bg-white hover:shadow-sm transition select-none">
                      <div className="shrink-0 flex items-center justify-center cursor-grab" style={{ width: 50, height: 50 }}
                        onMouseDown={e => startPaletteDrag(e, 'custom', item)}>
                        <ShapeBox shape={item.shape} fill="#e2e8f0" stroke="#64748b" width={w} height={h} guests={0} />
                      </div>
                      <span className="text-[10px] text-slate-600 leading-tight flex-1">{item.label}</span>
                      <button onClick={() => deleteCustomItem(item.id)}
                        className="hidden group-hover:flex items-center justify-center w-4 h-4 rounded-full bg-red-400 text-white text-[10px] leading-none shrink-0">×</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {addingCustom ? (
            <div className="space-y-1.5 bg-white border border-violet-200 rounded-xl p-2">
              <input value={newItem.label} onChange={e => setNewItem(p => ({ ...p, label: e.target.value }))}
                placeholder="שם פריט"
                className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:border-violet-400" />
              <div className="flex gap-1">
                <input value={newItem.wM} onChange={e => setNewItem(p => ({ ...p, wM: e.target.value }))}
                  placeholder="רוחב m" type="number" min="0.1" step="0.1"
                  className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:border-violet-400" />
                <input value={newItem.hM} onChange={e => setNewItem(p => ({ ...p, hM: e.target.value }))}
                  placeholder="גובה m" type="number" min="0.1" step="0.1"
                  className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:border-violet-400" />
              </div>
              <select value={newItem.shape} onChange={e => setNewItem(p => ({ ...p, shape: e.target.value }))}
                className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none">
                <option value="rect">מלבן</option>
                <option value="circle">עיגול</option>
              </select>
              <div className="flex gap-1">
                <button onClick={addCustomItem}
                  className="flex-1 text-xs py-1 rounded-lg font-bold text-white"
                  style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>הוסף</button>
                <button onClick={() => setAddingCustom(false)}
                  className="flex-1 text-xs py-1 rounded-lg font-bold text-slate-500 border border-slate-200">בטל</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddingCustom(true)}
              className="w-full text-xs py-1.5 rounded-xl border-2 border-dashed border-violet-300 text-violet-600 font-bold hover:bg-violet-50 transition">
              + הוסף פריט
            </button>
          )}
        </div>

        {/* Canvas */}
        <div ref={canvasRef} className="flex-1 overflow-auto bg-slate-300" dir="ltr"
          onMouseDown={e => { if (e.target === e.currentTarget) setSelected(null); }}>
          <div style={{ width: 900, height: canvasH, position: 'relative', minWidth: 900 }} dir="ltr">
            {fp?.image
              ? <img src={fp.image} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none', userSelect: 'none' }} />
              : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <p className="text-slate-400 text-sm select-none">לא הועלתה תמונת רקע — גרור פריטים לכאן</p>
                </div>
            }

            {layouts[section].map(el => {
              const def  = getElDef(el);
              const wPx  = def.wM * scale;
              const hPx  = def.hM * scale;
              const isSel = selected === el.id;
              return (
                <div key={el.id}
                  style={{
                    position: 'absolute', left: el.x, top: el.y,
                    width: wPx, height: hPx,
                    transform: `rotate(${el.rotation || 0}deg)`,
                    transformOrigin: 'center center',
                    cursor: 'move',
                    zIndex: isSel ? 10 : 1,
                    outline: isSel ? '2px solid #7c3aed' : 'none',
                    outlineOffset: 2,
                  }}
                  onMouseDown={e => startElementMove(e, el)}>
                  <ShapeBox shape={def.shape} fill={def.fill} stroke={def.stroke} width={wPx} height={hPx} guests={def.guests} />

                  {isSel && (
                    <>
                      <div
                        onMouseDown={e => startRotate(e, el)}
                        style={{
                          position: 'absolute', top: -20, left: '50%',
                          transform: 'translateX(-50%)',
                          width: 14, height: 14, borderRadius: '50%',
                          background: '#7c3aed', border: '2px solid white',
                          cursor: 'grab', zIndex: 20, pointerEvents: 'auto',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                        }}
                        title="גרור לסיבוב"
                      />
                      <div style={{
                        position: 'absolute', bottom: -14, left: 0, right: 0,
                        textAlign: 'center', fontSize: 9, color: '#7c3aed',
                        fontWeight: 'bold', whiteSpace: 'nowrap', pointerEvents: 'none',
                      }}>
                        {def.label}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Ghost during palette drag */}
      {ghost && (() => {
        const { w, h } = palDims(ghost.wM, ghost.hM);
        return (
          <div style={{
            position: 'fixed', left: ghost.x - w / 2, top: ghost.y - h / 2,
            pointerEvents: 'none', zIndex: 9999, opacity: 0.65,
          }}>
            <ShapeBox shape={ghost.shape} fill={ghost.fill} stroke={ghost.stroke} width={w} height={h} guests={0} />
          </div>
        );
      })()}
    </div>
  );
}
