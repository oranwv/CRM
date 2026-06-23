import { useState } from 'react';
import api from '../api';

export default function AddSupplierModal({ categories, onCreated, onClose, initial = {} }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', description: '', category: categories[0]?.name || 'כללי', sug: '', payment: '', ...initial });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function set(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) { setErr('שם וטלפון הם שדות חובה'); return; }
    setSaving(true); setErr('');
    try {
      const res = await api.post('/suppliers', form);
      onCreated(res.data);
    } catch (e) {
      setErr(e.response?.data?.error || 'שגיאה');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-black text-slate-800 text-base">הוסף ספק</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">שם מלא *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} required
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">טלפון *</label>
            <input value={form.phone} onChange={e => set('phone', e.target.value)} required type="tel"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400" dir="ltr" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">קטגוריה</label>
            <select value={form.category} onChange={e => set('category', e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
              {categories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">אימייל</label>
            <input value={form.email} onChange={e => set('email', e.target.value)} type="email"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400" dir="ltr" />
          </div>
          {form.category === 'כללי' && (
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">סוג</label>
              <input value={form.sug} onChange={e => set('sug', e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400" />
            </div>
          )}
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">תשלום</label>
            <input value={form.payment} onChange={e => set('payment', e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">תיאור</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400 resize-none" />
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving}
              className="flex-1 py-2 rounded-xl font-bold text-white text-sm disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
              {saving ? '...' : 'הוסף'}
            </button>
            <button type="button" onClick={onClose}
              className="flex-1 py-2 rounded-xl font-bold text-slate-600 text-sm border border-slate-200">
              ביטול
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
