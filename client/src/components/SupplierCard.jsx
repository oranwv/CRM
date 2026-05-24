import { useState, useEffect, useRef } from 'react';
import api from '../api';

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

const STAGE_LABELS = {
  new: 'חדש', contacted: 'יצירת קשר', meeting_scheduled: 'פגישה נקבעה',
  meeting: 'בוצעה פגישה', offer_sent: 'הצעת מחיר', negotiation: 'מו"מ',
  contract_sent: 'חוזה נשלח', deposit: 'מקדמה', production: 'הפקה', completed: 'הסתיים',
};

function fileIcon(type) {
  if (!type) return '📎';
  if (type.includes('pdf')) return '📄';
  if (type.includes('word') || type.includes('document')) return '📝';
  if (type.includes('sheet') || type.includes('excel')) return '📊';
  if (type.startsWith('image/')) return '🖼️';
  return '📎';
}

export default function SupplierCard({ supplierId, onClose, categories }) {
  const [supplier, setSupplier]         = useState(null);
  const [interactions, setInteractions] = useState([]);
  const [events, setEvents]             = useState([]);
  const [files, setFiles]               = useState([]);
  const [tab, setTab]                   = useState('timeline');
  const [editing, setEditing]           = useState(false);
  const [editForm, setEditForm]         = useState({});
  const [saving, setSaving]             = useState(false);
  const [intType, setIntType]           = useState('call');
  const [intBody, setIntBody]           = useState('');
  const [waMsg, setWaMsg]               = useState('');
  const [waSending, setWaSending]       = useState(false);
  const [uploading, setUploading]       = useState(false);
  const fileInputRef                    = useRef(null);

  useEffect(() => {
    if (!supplierId) return;
    Promise.all([
      api.get(`/suppliers/${supplierId}`),
      api.get(`/suppliers/${supplierId}/interactions`),
      api.get(`/suppliers/${supplierId}/events`),
      api.get(`/suppliers/${supplierId}/files`),
    ]).then(([sRes, iRes, eRes, fRes]) => {
      const s = sRes.data;
      setSupplier(s);
      setEditForm({ name: s?.name || '', phone: s?.phone || '', email: s?.email || '', description: s?.description || '', category: s?.category || 'כללי' });
      setInteractions(iRes.data);
      setEvents(eRes.data);
      setFiles(fRes.data);
    }).catch(() => {});
  }, [supplierId]);

  async function saveEdit() {
    setSaving(true);
    try {
      const res = await api.put(`/suppliers/${supplierId}`, editForm);
      setSupplier(res.data);
      setEditing(false);
    } catch {}
    finally { setSaving(false); }
  }

  async function addInteraction() {
    if (!intBody.trim()) return;
    try {
      const res = await api.post(`/suppliers/${supplierId}/interactions`, { type: intType, body: intBody });
      setInteractions(prev => [res.data, ...prev]);
      setIntBody('');
    } catch {}
  }

  async function deleteInteraction(id) {
    await api.delete(`/suppliers/${supplierId}/interactions/${id}`).catch(() => {});
    setInteractions(prev => prev.filter(i => i.id !== id));
  }

  async function sendWhatsApp() {
    if (!waMsg.trim()) return;
    setWaSending(true);
    try {
      await api.post('/whatsapp/send', { supplierId, message: waMsg, phone: supplier?.phone });
      setInteractions(prev => [{
        id: Date.now(), type: 'whatsapp', direction: 'outbound', body: waMsg,
        created_at: new Date().toISOString(), created_by_name: 'אתה',
      }, ...prev]);
      setWaMsg('');
    } catch (e) {
      alert('שגיאה בשליחת WhatsApp');
    } finally {
      setWaSending(false);
    }
  }

  async function uploadFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post(`/suppliers/${supplierId}/files`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setFiles(prev => [res.data, ...prev]);
    } catch {}
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  }

  async function openFile(file) {
    try {
      const res = await api.get(`/suppliers/${supplierId}/files/${file.id}/url`);
      window.open(res.data.url, '_blank');
    } catch {}
  }

  async function deleteFile(id) {
    await api.delete(`/suppliers/${supplierId}/files/${id}`).catch(() => {});
    setFiles(prev => prev.filter(f => f.id !== id));
  }

  if (!supplier) return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-white" dir="rtl">
      <p className="text-slate-400 text-sm">טוען...</p>
    </div>
  );

  const col = categoryColor(supplier.category);

  function intIcon(type) {
    if (type === 'call') return '📞';
    if (type === 'whatsapp') return '💬';
    return '📝';
  }

  function formatDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return `${dt.getDate().toString().padStart(2,'0')}/${(dt.getMonth()+1).toString().padStart(2,'0')}/${dt.getFullYear()}`;
  }

  return (
    <div className="fixed inset-0 z-[65] flex flex-col bg-white" dir="rtl">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-slate-200 bg-white">
        <div className="flex items-start gap-3">
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none mt-0.5">&times;</button>
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="space-y-2">
                <input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full text-lg font-black border-b border-violet-300 focus:outline-none focus:border-violet-500 bg-transparent" />
                <div className="flex gap-2">
                  <input value={editForm.phone} onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))}
                    placeholder="טלפון" dir="ltr"
                    className="flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none" />
                  <input value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))}
                    placeholder="אימייל" dir="ltr"
                    className="flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none" />
                </div>
                <select value={editForm.category} onChange={e => setEditForm(p => ({ ...p, category: e.target.value }))}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none">
                  {(categories || []).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
                <textarea value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="תיאור" rows={2}
                  className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none resize-none" />
                <div className="flex gap-2">
                  <button onClick={saveEdit} disabled={saving}
                    className="px-3 py-1 rounded-lg text-xs font-bold text-white disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
                    {saving ? '...' : 'שמור'}
                  </button>
                  <button onClick={() => setEditing(false)} className="px-3 py-1 rounded-lg text-xs font-bold text-slate-500 border border-slate-200">ביטול</button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-black text-slate-800 text-lg leading-tight">{supplier.name}</h2>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ background: col.bg, color: col.text, border: `1px solid ${col.border}` }}>
                    {supplier.category}
                  </span>
                  <button onClick={() => setEditing(true)}
                    className="text-xs text-violet-600 hover:text-violet-800 font-bold">עריכה</button>
                </div>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {supplier.phone && (
                    <a href={`tel:${supplier.phone}`} className="text-xs text-slate-600 hover:text-violet-600 font-medium">
                      📞 {supplier.phone}
                    </a>
                  )}
                  {supplier.email && (
                    <a href={`mailto:${supplier.email}`} className="text-xs text-slate-600 hover:text-violet-600 font-medium" dir="ltr">
                      ✉️ {supplier.email}
                    </a>
                  )}
                </div>
                {supplier.description && (
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">{supplier.description}</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-3">
          {[['timeline','ציר זמן'], ['events','אירועים'], ['files','קבצים']].map(([key, lbl]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${tab === key ? 'bg-violet-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
              {lbl}
              {key === 'events' && events.length > 0 && (
                <span className="mr-1 bg-white/30 text-white text-[10px] px-1 rounded-full">{events.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">

        {/* Timeline tab */}
        {tab === 'timeline' && (
          <div className="space-y-4">
            {/* Add interaction */}
            <div className="bg-slate-50 rounded-xl p-3 space-y-2">
              <div className="flex gap-2">
                <select value={intType} onChange={e => setIntType(e.target.value)}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none bg-white">
                  <option value="call">📞 שיחה</option>
                  <option value="note">📝 הערה</option>
                </select>
                <input value={intBody} onChange={e => setIntBody(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addInteraction()}
                  placeholder={intType === 'call' ? 'תוכן השיחה...' : 'הערה...'}
                  className="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-400" />
                <button onClick={addInteraction} disabled={!intBody.trim()}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>הוסף</button>
              </div>
            </div>

            {/* WhatsApp send */}
            {supplier.phone && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 space-y-2">
                <p className="text-xs font-bold text-green-800">WhatsApp — {supplier.phone}</p>
                <div className="flex gap-2">
                  <input value={waMsg} onChange={e => setWaMsg(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendWhatsApp()}
                    placeholder="הודעה..."
                    className="flex-1 text-xs border border-green-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-green-400 bg-white" />
                  <button onClick={sendWhatsApp} disabled={!waMsg.trim() || waSending}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-green-600 hover:bg-green-700 disabled:opacity-40 transition">
                    {waSending ? '...' : 'שלח'}
                  </button>
                </div>
              </div>
            )}

            {/* Interaction list */}
            {interactions.length === 0 && (
              <p className="text-center text-slate-400 text-xs mt-6">אין פעולות עדיין</p>
            )}
            {interactions.map(int => (
              <div key={int.id} className="flex gap-3 group">
                <div className="text-lg leading-none mt-0.5">{intIcon(int.type)}</div>
                <div className="flex-1 bg-white border border-slate-100 rounded-xl px-3 py-2 shadow-sm">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[10px] text-slate-400 font-medium">
                      {formatDate(int.created_at)} {int.created_by_name ? `· ${int.created_by_name}` : ''}
                    </span>
                    <button onClick={() => deleteInteraction(int.id)}
                      className="hidden group-hover:block text-[10px] text-red-400 hover:text-red-600 font-bold">מחק</button>
                  </div>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{int.body}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Events tab */}
        {tab === 'events' && (
          <div className="space-y-2">
            {events.length === 0 && (
              <p className="text-center text-slate-400 text-xs mt-6">הספק לא קושר לאירועים עדיין</p>
            )}
            {events.map(ev => (
              <div key={ev.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 text-sm">{ev.name}</span>
                  <span className="text-xs text-slate-400">{formatDate(ev.event_date)}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {ev.event_type && <span className="text-xs text-slate-500">{ev.event_type}</span>}
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                    {STAGE_LABELS[ev.stage] || ev.stage}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Files tab */}
        {tab === 'files' && (
          <div className="space-y-3">
            <div
              className="border-2 border-dashed border-violet-200 rounded-xl p-6 text-center cursor-pointer hover:bg-violet-50 transition"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { const dt = new DataTransfer(); dt.items.add(f); fileInputRef.current.files = dt.files; uploadFile({ target: fileInputRef.current }); } }}
            >
              <input ref={fileInputRef} type="file" className="hidden" onChange={uploadFile} />
              <p className="text-xs text-slate-500 font-medium">
                {uploading ? 'מעלה...' : 'לחץ להעלאת קובץ או גרור לכאן'}
              </p>
            </div>
            {files.length === 0 && !uploading && (
              <p className="text-center text-slate-400 text-xs">אין קבצים עדיין</p>
            )}
            {files.map(f => (
              <div key={f.id} className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-3 py-2.5 group">
                <span className="text-xl">{fileIcon(f.file_type)}</span>
                <div className="flex-1 min-w-0">
                  <button onClick={() => openFile(f)} className="text-xs font-bold text-violet-700 hover:underline truncate block text-right w-full">
                    {f.filename}
                  </button>
                  <p className="text-[10px] text-slate-400">{formatDate(f.created_at)}{f.uploaded_by_name ? ` · ${f.uploaded_by_name}` : ''}</p>
                </div>
                <button onClick={() => deleteFile(f.id)}
                  className="hidden group-hover:block text-red-400 hover:text-red-600 text-sm font-bold">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
