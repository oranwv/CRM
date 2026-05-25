import { useState, useEffect, useRef } from 'react';
import api from '../api';
import SeatingTemplateGallery from './SeatingTemplateGallery';

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

function getElDef(el, overrides = {}) {
  if (el.type === 'custom') {
    return { wM: el.wM, hM: el.hM, shape: el.shape, label: el.label, guests: 0, fill: '#e2e8f0', stroke: '#64748b' };
  }
  const d = DEFS[el.type];
  if (!d) return { wM: 1, hM: 1, shape: 'rect', label: el.type, guests: 0, fill: '#e2e8f0', stroke: '#64748b' };
  const ov = overrides[el.type] || {};
  return { ...d, fill: FILL[el.type] || '#ddd6fe', stroke: STROKE[el.type] || '#7c3aed', ...ov };
}

function palDims(wM, hM) {
  const MAX = 32;
  const s = Math.min(MAX / wM, MAX / hM, 20);
  return { w: Math.max(8, Math.round(wM * s)), h: Math.max(8, Math.round(hM * s)) };
}

function ShapeBox({ shape, fill, stroke, width, height, guests, image }) {
  if (image) return (
    <div style={{ width, height, pointerEvents: 'none', userSelect: 'none', overflow: 'hidden', borderRadius: 4, border: `2px solid ${stroke}` }}>
      <img src={image} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
    </div>
  );
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
        <path d="M 0 50 A 50 50 0 0 1 100 50 L 88 50 A 38 38 0 0 0 12 50 Z" fill={fill} stroke={stroke} strokeWidth="3" />
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
  const [pdfBusy,     setPdfBusy]     = useState(false);
  const [addingCustom, setAddingCustom] = useState(false);
  const [newItem,     setNewItem]     = useState({ label: '', wM: '', hM: '', shape: 'rect' });
  const [ghost,       setGhost]       = useState(null);
  const [elemOverrides, setElemOverrides] = useState({});
  const [templates,    setTemplates]    = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showGallery,  setShowGallery]  = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);
  const elDef = el => getElDef(el, elemOverrides);
  const [zoom,        setZoom]        = useState(() => Math.min(1, (window.innerWidth - 96) / 900));

  const canvasRef      = useRef(null);
  const dragRef        = useRef(null);
  const saveTimer      = useRef(null);
  const sectionRef     = useRef(section);
  const scaleRef       = useRef(45);
  const zoomRef        = useRef(zoom);
  const pinchRef       = useRef({ active: false, dist0: 0, zoom0: 1 });
  const dropdownRef    = useRef(null);

  useEffect(() => { sectionRef.current = section; }, [section]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  useEffect(() => {
    function onClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    api.get(`/leads/${leadId}/seating`).then(r => {
      setLayouts({ inside: r.data.inside || [], outside: r.data.outside || [] });
    }).catch(() => {});
    api.get('/admin/settings').then(r => {
      const d = r.data;
      try { setCustomItems(d.seating_custom_items ? JSON.parse(d.seating_custom_items) : []); } catch {}
      try { setElemOverrides(d.seating_element_overrides ? JSON.parse(d.seating_element_overrides) : {}); } catch {}
      try { setTemplates(d.seating_templates ? JSON.parse(d.seating_templates) : []); } catch {}
    }).catch(() => {});
    // Fetch floorplan URLs from dedicated endpoints (handles both old base64 and new Supabase records)
    Promise.all(['inside', 'outside'].map(async sec => {
      try {
        const r = await api.get(`/admin/settings/floorplan/${sec}/url`);
        return [sec, { image: r.data.url, widthM: r.data.widthM, heightM: r.data.heightM }];
      } catch {
        return [sec, null];
      }
    })).then(results => {
      const fp = { inside: null, outside: null };
      results.forEach(([sec, val]) => { fp[sec] = val; });
      setFloorplans(fp);
    });
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
    function applyMove(clientX, clientY) {
      const ds = dragRef.current;
      if (!ds || ds.mode === 'palette') return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect   = canvas.getBoundingClientRect();
      const z      = zoomRef.current;
      const mx = (clientX - rect.left) / z;
      const my = (clientY - rect.top)  / z;
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

    function applyDrop(clientX, clientY) {
      setGhost(null);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect  = canvas.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right &&
          clientY >= rect.top  && clientY <= rect.bottom) {
        const ds  = dragRef.current;
        const s   = scaleRef.current;
        const z   = zoomRef.current;
        const wPx = ds.wM * s;
        const hPx = ds.hM * s;
        const mx  = (clientX - rect.left) / z;
        const my  = (clientY - rect.top)  / z;
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

    function onMove(e) {
      const ds = dragRef.current;
      if (!ds) return;
      if (ds.mode === 'palette') {
        setGhost(g => g ? { ...g, x: e.clientX, y: e.clientY } : g);
        return;
      }
      applyMove(e.clientX, e.clientY);
    }

    function onUp(e) {
      const ds = dragRef.current;
      if (!ds) return;
      if (ds.mode === 'palette') {
        applyDrop(e.clientX, e.clientY);
      } else if (ds.mode === 'move' || ds.mode === 'rotate') {
        setLayouts(prev => { triggerSave(prev, sectionRef.current); return prev; });
      }
      dragRef.current = null;
    }

    function onTouchStart(e) {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchRef.current = { active: true, dist0: Math.hypot(dx, dy), zoom0: zoomRef.current };
        dragRef.current = null;
        setGhost(null);
      }
    }

    function onTouchMove(e) {
      if (pinchRef.current.active && e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const newZ = Math.max(0.2, Math.min(3, pinchRef.current.zoom0 * Math.hypot(dx, dy) / pinchRef.current.dist0));
        setZoom(newZ);
        return;
      }
      const ds = dragRef.current;
      if (!ds) return;
      e.preventDefault();
      const t = e.touches[0];
      if (ds.mode === 'palette') {
        setGhost(g => g ? { ...g, x: t.clientX, y: t.clientY } : g);
        return;
      }
      applyMove(t.clientX, t.clientY);
    }

    function onTouchEnd(e) {
      if (pinchRef.current.active) {
        pinchRef.current.active = false;
        return;
      }
      const ds = dragRef.current;
      if (!ds) return;
      if (ds.mode === 'palette') {
        const t = e.changedTouches[0];
        applyDrop(t.clientX, t.clientY);
      } else if (ds.mode === 'move' || ds.mode === 'rotate') {
        setLayouts(prev => { triggerSave(prev, sectionRef.current); return prev; });
      }
      dragRef.current = null;
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    document.addEventListener('touchstart', onTouchStart);
    document.addEventListener('touchmove',  onTouchMove, { passive: false });
    document.addEventListener('touchend',   onTouchEnd);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove',  onTouchMove);
      document.removeEventListener('touchend',   onTouchEnd);
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
    const def   = elDef(el);
    const s     = scaleRef.current;
    const rect  = canvasRef.current.getBoundingClientRect();
    const z     = zoomRef.current;
    const mx    = (e.clientX - rect.left) / z;
    const my    = (e.clientY - rect.top)  / z;
    dragRef.current = { mode: 'move', id: el.id, offX: mx - el.x, offY: my - el.y, wPx: def.wM * s, hPx: def.hM * s };
  }

  function startElementMoveTouch(e, el) {
    if (e.touches.length > 1) return;
    e.stopPropagation(); e.preventDefault();
    setSelected(el.id);
    const def   = elDef(el);
    const s     = scaleRef.current;
    const rect  = canvasRef.current.getBoundingClientRect();
    const z     = zoomRef.current;
    const t     = e.touches[0];
    const mx    = (t.clientX - rect.left) / z;
    const my    = (t.clientY - rect.top)  / z;
    dragRef.current = { mode: 'move', id: el.id, offX: mx - el.x, offY: my - el.y, wPx: def.wM * s, hPx: def.hM * s };
  }

  function startRotate(e, el) {
    e.stopPropagation();
    const def = elDef(el);
    const s   = scaleRef.current;
    dragRef.current = { mode: 'rotate', id: el.id, cx: el.x + (def.wM * s) / 2, cy: el.y + (def.hM * s) / 2 };
  }

  function startRotateTouch(e, el) {
    e.stopPropagation(); e.preventDefault();
    const def = elDef(el);
    const s   = scaleRef.current;
    dragRef.current = { mode: 'rotate', id: el.id, cx: el.x + (def.wM * s) / 2, cy: el.y + (def.hM * s) / 2 };
  }

  function startPaletteDragTouch(e, type, customData = null) {
    e.preventDefault();
    const t    = e.touches[0];
    const wM   = type === 'custom' ? customData.wM : DEFS[type].wM;
    const hM   = type === 'custom' ? customData.hM : DEFS[type].hM;
    const shape = type === 'custom' ? customData.shape : DEFS[type].shape;
    dragRef.current = { mode: 'palette', type, wM, hM, shape, label: customData?.label };
    setGhost({ x: t.clientX, y: t.clientY, type, wM, hM, shape,
      fill:   type === 'custom' ? '#e2e8f0' : (FILL[type]   || '#ddd6fe'),
      stroke: type === 'custom' ? '#64748b' : (STROKE[type] || '#7c3aed') });
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

  const totalGuests = layouts[section].reduce((sum, el) => sum + (elDef(el).guests || 0), 0);

  async function captureThumbnail() {
    const { default: html2canvas } = await import('html2canvas');
    const innerDiv = canvasRef.current?.querySelector('[dir="ltr"]');
    if (!innerDiv) return null;
    const cvs = await html2canvas(innerDiv, { scale: 0.8, useCORS: true, logging: false, backgroundColor: '#cbd5e1' });
    return cvs.toDataURL('image/jpeg', 0.88);
  }

  async function saveAsTemplate() {
    const name = window.prompt('שם הסקיצה:');
    if (name === null) return;
    setShowDropdown(false);
    setTemplateBusy(true);
    try {
      let thumbnail = null;
      try { thumbnail = await captureThumbnail(); } catch {}
      const res = await api.post('/admin/seating/templates', {
        name: name.trim() || 'סקיצה ללא שם',
        section,
        elements: layouts[section],
        thumbnail,
      });
      setTemplates(prev => [...prev, res.data]);
      setTemplateSaved(true);
      setTimeout(() => setTemplateSaved(false), 2000);
    } catch (err) {
      console.error('[template save]', err);
    } finally {
      setTemplateBusy(false);
    }
  }

  function loadTemplate(tpl) {
    if (layouts[tpl.section].length > 0) {
      if (!window.confirm('להחליף את הסקיצה הקיימת?')) return;
    }
    setSection(tpl.section);
    const next = { ...layouts, [tpl.section]: tpl.elements };
    setLayouts(next);
    triggerSave(next, tpl.section);
    setShowGallery(false);
  }

  async function deleteTemplate(id) {
    if (!window.confirm('למחוק את הסקיצה?')) return;
    await api.delete(`/admin/seating/templates/${id}`).catch(() => {});
    setTemplates(prev => prev.filter(t => t.id !== id));
  }

  async function captureCanvasImage() {
    const { default: html2canvas } = await import('html2canvas');
    const innerDiv = canvasRef.current?.querySelector('[dir="ltr"]');
    if (!innerDiv) throw new Error('canvas not found');
    return html2canvas(innerDiv, { scale: 2, useCORS: true, logging: false, backgroundColor: '#cbd5e1' });
  }

  async function downloadPdf() {
    setPdfBusy(true);
    try {
      const { default: jsPDF } = await import('jspdf');
      const cvs = await captureCanvasImage();
      const imgData = cvs.toDataURL('image/jpeg', 0.92);
      const pdf = new jsPDF({ orientation: cvs.width > cvs.height ? 'landscape' : 'portrait', unit: 'px', format: [cvs.width / 2, cvs.height / 2] });
      pdf.addImage(imgData, 'JPEG', 0, 0, cvs.width / 2, cvs.height / 2);
      pdf.save(`סקיצה-${section === 'inside' ? 'פנים' : 'חוץ'}.pdf`);
    } catch (err) { console.error('[PDF]', err); }
    finally { setPdfBusy(false); }
  }

  async function saveToFiles() {
    setPdfBusy(true);
    try {
      const { default: jsPDF } = await import('jspdf');
      const cvs = await captureCanvasImage();
      const imgData = cvs.toDataURL('image/jpeg', 0.92);
      const pdf = new jsPDF({ orientation: cvs.width > cvs.height ? 'landscape' : 'portrait', unit: 'px', format: [cvs.width / 2, cvs.height / 2] });
      pdf.addImage(imgData, 'JPEG', 0, 0, cvs.width / 2, cvs.height / 2);
      const blob = pdf.output('blob');
      const fd = new FormData();
      fd.append('file', new File([blob], `סקיצה-${section === 'inside' ? 'פנים' : 'חוץ'}.pdf`, { type: 'application/pdf' }));
      await api.post(`/leads/${leadId}/files`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      alert('הקובץ נשמר בהצלחה');
    } catch (err) { console.error('[PDF save]', err); }
    finally { setPdfBusy(false); }
  }

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
        {templateSaved && <span className="text-xs text-violet-600 font-bold">הסקיצה נשמרה</span>}
        <button onClick={saveNow} disabled={saving}
          className="text-xs px-3 py-1.5 rounded-xl font-bold text-white disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>שמור</button>
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowDropdown(p => !p)}
            disabled={pdfBusy || templateBusy}
            className="text-xs px-3 py-1.5 rounded-xl font-bold border border-slate-300 text-slate-600 hover:bg-slate-50 transition disabled:opacity-50">
            {(pdfBusy || templateBusy) ? '...' : '+'}
          </button>
          {showDropdown && (
            <div className="absolute top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 overflow-hidden w-44" style={{ left: 0 }}>
              <button onClick={() => { setShowDropdown(false); downloadPdf(); }}
                className="w-full text-right px-4 py-2.5 text-xs text-slate-700 hover:bg-slate-50 transition">
                הורד PDF
              </button>
              <button onClick={() => { setShowDropdown(false); saveToFiles(); }}
                className="w-full text-right px-4 py-2.5 text-xs text-slate-700 hover:bg-slate-50 transition">
                שמור בקבצים
              </button>
              <div className="h-px bg-slate-100 mx-2" />
              <button onClick={() => { setShowDropdown(false); setShowGallery(true); }}
                className="w-full text-right px-4 py-2.5 text-xs text-slate-700 hover:bg-slate-50 transition">
                סקיצות מוכנות
              </button>
              <button onClick={saveAsTemplate}
                className="w-full text-right px-4 py-2.5 text-xs text-slate-700 hover:bg-slate-50 transition">
                שמור כסקיצה מוכנה
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Palette */}
        <div className="w-24 shrink-0 border-l border-slate-200 overflow-y-auto bg-slate-50 p-1.5 space-y-2" dir="rtl">
          {PALETTE_GROUPS.map(group => (
            <div key={group.label}>
              <p className="text-[11px] font-black text-slate-400 uppercase tracking-wide mb-1 text-center">{group.label}</p>
              <div className="grid grid-cols-2 gap-1 mb-1">
                {group.keys.map(key => {
                  const d = elDef({ type: key });
                  const { w, h } = palDims(d.wM, d.hM);
                  return (
                    <div key={key}
                      onMouseDown={e => startPaletteDrag(e, key)}
                      onTouchStart={e => startPaletteDragTouch(e, key)}
                      className="flex flex-col items-center gap-0.5 p-1 rounded-lg hover:bg-white hover:shadow-sm cursor-grab transition select-none">
                      <div className="flex items-center justify-center" style={{ width: 36, height: 36 }}>
                        <ShapeBox shape={d.shape} fill={d.fill} stroke={d.stroke} width={w} height={h} guests={d.guests} image={d.image} />
                      </div>
                      <span className="text-[11px] text-slate-600 leading-tight text-center">{d.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {customItems.length > 0 && (
            <div>
              <p className="text-[11px] font-black text-slate-400 uppercase tracking-wide mb-1 text-center">מותאם אישית</p>
              <div className="grid grid-cols-2 gap-1 mb-1">
                {customItems.map(item => {
                  const { w, h } = palDims(item.wM, item.hM);
                  return (
                    <div key={item.id} className="relative group flex flex-col items-center gap-0.5 p-1 rounded-lg hover:bg-white hover:shadow-sm transition select-none cursor-grab"
                      onMouseDown={e => startPaletteDrag(e, 'custom', item)}
                      onTouchStart={e => startPaletteDragTouch(e, 'custom', item)}>
                      <div className="flex items-center justify-center" style={{ width: 36, height: 36 }}>
                        <ShapeBox shape={item.shape} fill="#e2e8f0" stroke="#64748b" width={w} height={h} guests={0} />
                      </div>
                      <span className="text-[11px] text-slate-600 leading-tight text-center">{item.label}</span>
                      <button onClick={ev => { ev.stopPropagation(); deleteCustomItem(item.id); }}
                        className="hidden group-hover:flex absolute top-0.5 right-0.5 items-center justify-center w-3.5 h-3.5 rounded-full bg-red-400 text-white text-[9px] leading-none">×</button>
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
        <div className="flex-1 overflow-auto bg-slate-300" dir="ltr"
          onMouseDown={e => { if (e.target === e.currentTarget) setSelected(null); }}>
          <div ref={canvasRef}
               style={{ width: Math.round(900 * zoom), height: Math.round(canvasH * zoom),
                        position: 'relative', marginLeft: 'auto' }}>
          <div style={{ width: 900, height: canvasH, position: 'absolute', top: 0, left: 0,
                        transform: `scale(${zoom})`, transformOrigin: 'top left' }} dir="ltr">
            {fp?.image
              ? <img src={fp.image} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none', userSelect: 'none' }} />
              : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <p className="text-slate-400 text-sm select-none">לא הועלתה תמונת רקע — גרור פריטים לכאן</p>
                </div>
            }

            {layouts[section].map(el => {
              const def  = elDef(el);
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
                  onMouseDown={e => startElementMove(e, el)}
                  onTouchStart={e => startElementMoveTouch(e, el)}>
                  <ShapeBox shape={def.shape} fill={def.fill} stroke={def.stroke} width={wPx} height={hPx} guests={def.guests} image={def.image || null} />

                  {def.guests === 0 && (
                    <div style={{
                      position: 'absolute', bottom: -13, left: 0, right: 0,
                      textAlign: 'center', fontSize: 11, color: '#374151',
                      fontWeight: 'bold', whiteSpace: 'nowrap', pointerEvents: 'none',
                      background: 'rgba(255,255,255,0.8)', borderRadius: 2,
                    }}>
                      {def.label}
                    </div>
                  )}

                  {isSel && (
                    <div
                      onMouseDown={e => startRotate(e, el)}
                      onTouchStart={e => startRotateTouch(e, el)}
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
                  )}
                </div>
              );
            })}
          </div>
          </div>
        </div>
      </div>

      {showGallery && (
        <SeatingTemplateGallery
          templates={templates}
          onSelect={loadTemplate}
          onClose={() => setShowGallery(false)}
          onDelete={deleteTemplate}
        />
      )}

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
