import { useState } from 'react';

export default function SeatingTemplateGallery({ templates, onSelect, onClose, onDelete }) {
  const [selected,   setSelected]   = useState(null);
  const [previewTpl, setPreviewTpl] = useState(null);

  const inside  = templates.filter(t => t.section === 'inside');
  const outside = templates.filter(t => t.section === 'outside');

  function TemplateCard({ tpl }) {
    const isSel = selected?.id === tpl.id;
    return (
      <div
        onClick={() => setSelected(tpl)}
        className={`cursor-pointer rounded-xl border-2 overflow-hidden transition select-none ${
          isSel ? 'border-violet-500 shadow-md' : 'border-slate-200 hover:border-violet-300'
        }`}
      >
        {tpl.thumbnail
          ? <img src={tpl.thumbnail} alt={tpl.name} className="w-full h-28 object-cover bg-slate-200" draggable={false} />
          : <div className="w-full h-28 bg-slate-100 flex items-center justify-center text-slate-400 text-xs">אין תצוגה מקדימה</div>
        }
        <div className="px-2 py-1.5 flex items-center justify-between bg-white">
          <span className="text-xs font-bold text-slate-700 truncate">{tpl.name}</span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={e => { e.stopPropagation(); setPreviewTpl(tpl); }}
              className="text-[10px] text-violet-500 hover:text-violet-700 font-bold px-1"
            >
              תצוגה
            </button>
            <button
              onClick={e => { e.stopPropagation(); onDelete(tpl.id); }}
              className="text-[10px] text-red-400 hover:text-red-600 font-bold px-1"
            >
              מחק
            </button>
          </div>
        </div>
      </div>
    );
  }

  function Section({ label, items }) {
    return (
      <div>
        <h3 className="font-black text-slate-700 text-sm mb-3 pb-1 border-b border-slate-100">{label}</h3>
        {items.length === 0
          ? <p className="text-xs text-slate-400">אין סקיצות שמורות</p>
          : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {items.map(tpl => <TemplateCard key={tpl.id} tpl={tpl} />)}
            </div>
          )
        }
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-[70] flex flex-col bg-white" dir="rtl">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 bg-white shrink-0">
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
          <h2 className="font-black text-slate-800 text-base">סקיצות מוכנות</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {templates.length === 0 ? (
            <p className="text-center text-slate-400 text-sm mt-16">אין סקיצות שמורות עדיין</p>
          ) : (
            <>
              <Section label="פנים" items={inside} />
              <Section label="חוץ" items={outside} />
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-200 px-4 py-3 flex justify-end gap-3 bg-white">
          <button onClick={onClose}
            className="text-xs px-4 py-2 rounded-xl font-bold text-slate-600 border border-slate-300 hover:bg-slate-50 transition">
            ביטול
          </button>
          <button
            onClick={() => selected && onSelect(selected)}
            disabled={!selected}
            className="text-xs px-4 py-2 rounded-xl font-bold text-white disabled:opacity-40 transition"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
            בחר סקיצה
          </button>
        </div>
      </div>

      {previewTpl && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70"
          onClick={() => setPreviewTpl(null)}
          dir="rtl"
        >
          <div
            className="relative bg-white rounded-2xl shadow-2xl overflow-hidden max-w-2xl w-full mx-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <span className="font-black text-slate-800 text-sm">{previewTpl.name}</span>
              <button
                onClick={() => setPreviewTpl(null)}
                className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
              >&times;</button>
            </div>
            {previewTpl.thumbnail
              ? <img src={previewTpl.thumbnail} alt={previewTpl.name} className="w-full object-contain max-h-[75vh] bg-slate-200" draggable={false} />
              : <div className="w-full h-64 bg-slate-100 flex items-center justify-center text-slate-400 text-sm">אין תצוגה מקדימה</div>
            }
          </div>
        </div>
      )}
    </>
  );
}
