import { useState, useEffect } from 'react';
import api from '../api';
import AddSupplierModal from '../components/AddSupplierModal';
import SupplierCard from '../components/SupplierCard';

const CATEGORY_COLORS = {
  'קייטרינג/שף': { bg: '#fed7aa', text: '#9a3412', border: '#fdba74' },
  'צלמים':       { bg: '#ddd6fe', text: '#5b21b6', border: '#c4b5fd' },
  'מלצרים':      { bg: '#bfdbfe', text: '#1e40af', border: '#93c5fd' },
  'ברמנים':      { bg: '#fde68a', text: '#92400e', border: '#fcd34d' },
  'שומרים':      { bg: '#e2e8f0', text: '#374151', border: '#cbd5e1' },
  'נקיון':       { bg: '#ccfbf1', text: '#134e4a', border: '#99f6e4' },
  'כללי':        { bg: '#f3f4f6', text: '#374151', border: '#d1d5db' },
};

function categoryColor(cat) {
  return CATEGORY_COLORS[cat] || { bg: '#f3f4f6', text: '#374151', border: '#d1d5db' };
}

export default function SuppliersPage() {
  const [categories,       setCategories]       = useState([]);
  const [suppliers,        setSuppliers]        = useState([]);
  const [activeCategory,   setActiveCategory]   = useState('הכל');
  const [search,           setSearch]           = useState('');
  const [showAdd,          setShowAdd]          = useState(false);
  const [openSupplier,     setOpenSupplier]     = useState(null);
  const [showCatManager,   setShowCatManager]   = useState(false);
  const [newCatName,       setNewCatName]       = useState('');
  const [loading,          setLoading]          = useState(true);

  function load() {
    setLoading(true);
    Promise.all([
      api.get('/suppliers/categories'),
      api.get('/suppliers'),
    ]).then(([cRes, sRes]) => {
      setCategories(cRes.data);
      setSuppliers(sRes.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const allCats = ['הכל', ...categories.map(c => c.name)];

  const filtered = suppliers.filter(s => {
    const matchCat = activeCategory === 'הכל' || s.category === activeCategory;
    const q = search.toLowerCase();
    const matchSearch = !q || s.name.toLowerCase().includes(q) || (s.phone || '').includes(q) || (s.email || '').toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  async function addCategory() {
    if (!newCatName.trim()) return;
    await api.post('/suppliers/categories', { name: newCatName.trim() }).catch(() => {});
    setNewCatName('');
    load();
  }

  async function deleteCategory(id, name) {
    if (!window.confirm(`למחוק את הקטגוריה "${name}"?`)) return;
    await api.delete(`/suppliers/categories/${id}`).catch(() => {});
    if (activeCategory === name) setActiveCategory('הכל');
    load();
  }

  function onSupplierCreated(s) {
    setSuppliers(prev => [s, ...prev]);
    setShowAdd(false);
  }

  async function deleteSupplier(id) {
    if (!window.confirm('למחוק ספק זה?')) return;
    await api.delete(`/suppliers/${id}`).catch(() => {});
    setSuppliers(prev => prev.filter(s => s.id !== id));
  }

  return (
    <div className="min-h-screen bg-slate-50" dir="rtl">
      {/* Top bar */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 sticky top-11 z-10">
        <div className="flex items-center gap-2 flex-wrap">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש ספק..."
            className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-violet-400" />
          <button onClick={() => setShowAdd(true)}
            className="px-3 py-1.5 rounded-xl font-bold text-white text-xs shrink-0"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
            + הוסף ספק
          </button>
          <button onClick={() => setShowCatManager(p => !p)}
            className="px-3 py-1.5 rounded-xl font-bold text-slate-600 text-xs border border-slate-200 hover:bg-slate-50 transition shrink-0">
            קטגוריות
          </button>
        </div>

        {/* Category manager */}
        {showCatManager && (
          <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <div className="flex gap-2">
              <input value={newCatName} onChange={e => setNewCatName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCategory()}
                placeholder="שם קטגוריה חדשה"
                className="flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-violet-400" />
              <button onClick={addCategory} disabled={!newCatName.trim()}
                className="px-3 py-1 rounded-lg text-xs font-bold text-white disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
                הוסף
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {categories.map(c => (
                <div key={c.id} className="flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{ background: categoryColor(c.name).bg, color: categoryColor(c.name).text, border: `1px solid ${categoryColor(c.name).border}` }}>
                  {c.name}
                  <button onClick={() => deleteCategory(c.id, c.name)} className="opacity-60 hover:opacity-100 font-black leading-none">×</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Category tabs */}
        <div className="flex gap-1 mt-3 overflow-x-auto pb-0.5 scrollbar-hide">
          {allCats.map(cat => (
            <button key={cat} onClick={() => setActiveCategory(cat)}
              className={`shrink-0 px-3 py-1 rounded-lg text-xs font-bold transition whitespace-nowrap ${
                activeCategory === cat ? 'bg-violet-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}>
              {cat}
              <span className="mr-1 text-[10px] opacity-70">
                ({cat === 'הכל' ? suppliers.length : suppliers.filter(s => s.category === cat).length})
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Supplier grid */}
      <div className="p-4">
        {loading && <p className="text-center text-slate-400 text-sm mt-8">טוען...</p>}
        {!loading && filtered.length === 0 && (
          <p className="text-center text-slate-400 text-sm mt-8">
            {search ? 'לא נמצאו ספקים תואמים' : 'אין ספקים בקטגוריה זו'}
          </p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {filtered.map(s => {
            const col = categoryColor(s.category);
            return (
              <div key={s.id}
                onClick={() => setOpenSupplier(s.id)}
                className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm hover:shadow-md cursor-pointer transition group relative">
                <div className="flex items-start justify-between gap-1 mb-2">
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full shrink-0"
                    style={{ background: col.bg, color: col.text, border: `1px solid ${col.border}` }}>
                    {s.category}
                  </span>
                  <button
                    onClick={e => { e.stopPropagation(); deleteSupplier(s.id); }}
                    className="hidden group-hover:block text-red-400 hover:text-red-600 text-sm font-bold leading-none">
                    ✕
                  </button>
                </div>
                <h3 className="font-black text-slate-800 text-sm leading-tight mb-1 truncate">{s.name}</h3>
                {s.phone && (
                  <a href={`tel:${s.phone}`} onClick={e => e.stopPropagation()}
                    className="text-xs text-slate-500 truncate block hover:text-violet-600" dir="ltr">
                    {s.phone}
                  </a>
                )}
                {s.email && <p className="text-xs text-slate-400 truncate" dir="ltr">{s.email}</p>}
                {s.description && <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{s.description}</p>}
              </div>
            );
          })}
        </div>
      </div>

      {showAdd && (
        <AddSupplierModal
          categories={categories}
          onCreated={onSupplierCreated}
          onClose={() => setShowAdd(false)}
        />
      )}

      {openSupplier && (
        <SupplierCard
          supplierId={openSupplier}
          categories={categories}
          onClose={() => setOpenSupplier(null)}
        />
      )}
    </div>
  );
}
