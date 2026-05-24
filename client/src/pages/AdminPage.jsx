import { useState, useEffect, useRef } from 'react';
import api from '../api';

const ROLE_LABELS = { admin: 'מנהל', sales: 'מכירות', production: 'הפקה' };

function FloorplanUpload({ section, label, existing, onSaved }) {
  const [widthM,       setWidthM]       = useState('');
  const [heightM,      setHeightM]      = useState('');
  const [file,         setFile]         = useState(null);
  const [localPreview, setLocalPreview] = useState(null);
  const [uploading,    setUploading]    = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (existing) {
      setWidthM(String(existing.widthM ?? ''));
      setHeightM(String(existing.heightM ?? ''));
    }
  }, [existing]);

  function handleFileChange(e) {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setLocalPreview(URL.createObjectURL(f));
  }

  async function handleSave() {
    if (!file || !widthM || !heightM) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('widthM',  widthM);
      fd.append('heightM', heightM);
      await api.post(`/admin/settings/floorplan/${section}`, fd);
      onSaved?.(section, { image: localPreview, widthM: parseFloat(widthM), heightM: parseFloat(heightM) });
      setFile(null);
      setLocalPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setUploading(false);
    }
  }

  const displayImage = localPreview || existing?.image || null;
  const canSave = file && widthM && heightM && !uploading;

  return (
    <div className="mb-4 p-3 rounded-xl border border-slate-100 bg-slate-50">
      <p className="text-sm font-bold text-slate-700 mb-2">{label}</p>

      {displayImage && (
        <div className="mb-2">
          <img src={displayImage} alt="" className="w-full h-32 object-cover rounded-lg border border-slate-200 mb-1" />
          {!localPreview && existing && (
            <p className="text-xs text-slate-500 text-center">רוחב: {existing.widthM} מ׳ &nbsp;|&nbsp; עומק: {existing.heightM} מ׳</p>
          )}
        </div>
      )}

      <div className="flex gap-2 mb-2">
        <input value={widthM} onChange={e => setWidthM(e.target.value)} type="number" min="1" step="0.5" placeholder="רוחב (מ')"
          className="w-full text-sm border border-slate-200 rounded-xl px-3 py-1.5 focus:outline-none focus:border-violet-400" />
        <input value={heightM} onChange={e => setHeightM(e.target.value)} type="number" min="1" step="0.5" placeholder="עומק (מ')"
          className="w-full text-sm border border-slate-200 rounded-xl px-3 py-1.5 focus:outline-none focus:border-violet-400" />
      </div>

      <label className="block w-full py-2 rounded-xl font-bold text-sm text-center cursor-pointer border-2 border-dashed border-violet-300 text-violet-600 hover:bg-violet-50 transition mb-2">
        {file ? file.name : 'בחר תמונה...'}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
      </label>

      <button onClick={handleSave} disabled={!canSave}
        className="w-full py-2 rounded-xl font-bold text-sm text-white disabled:opacity-40 transition"
        style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
        {uploading ? 'שומר...' : 'שמור'}
      </button>
    </div>
  );
}
const SEATING_DEFS = [
  { key: 'round_table_4',  label: 'שולחן עגול (4)',    shape: 'circle', wM: 1,   hM: 1,    fill: '#ddd6fe', stroke: '#7c3aed' },
  { key: 'rect_table_10',  label: 'שולחן מלבני (10)',  shape: 'rect',   wM: 0.8, hM: 2.4,  fill: '#ddd6fe', stroke: '#7c3aed' },
  { key: 'rect_table_20',  label: 'שולחן מלבני (20)',  shape: 'rect',   wM: 0.8, hM: 4.8,  fill: '#ddd6fe', stroke: '#7c3aed' },
  { key: 'round_bar',      label: 'בר (עגול)',          shape: 'circle', wM: 1,   hM: 1,    fill: '#fed7aa', stroke: '#ea580c' },
  { key: 'chavit',         label: 'חבית',               shape: 'circle', wM: 1,   hM: 1,    fill: '#d1fae5', stroke: '#059669' },
  { key: 'bama',           label: 'במה',                shape: 'rect',   wM: 3,   hM: 2.4,  fill: '#fce7f3', stroke: '#db2777' },
  { key: 'dj_stand',       label: 'DJ',                 shape: 'rect',   wM: 1,   hM: 0.3,  fill: '#e0e7ff', stroke: '#4f46e5' },
  { key: 'coffee_corner',  label: 'פינת קפה',           shape: 'rect',   wM: 1.5, hM: 0.3,  fill: '#fef3c7', stroke: '#d97706' },
  { key: 'butcher_large',  label: "בוצ'ר גדול",         shape: 'rect',   wM: 1.8, hM: 1,    fill: '#dcfce7', stroke: '#16a34a' },
  { key: 'butcher_small',  label: "בוצ'ר קטן",          shape: 'rect',   wM: 1.3, hM: 0.5,  fill: '#dcfce7', stroke: '#16a34a' },
  { key: 'kasefet',        label: 'כספת',               shape: 'rect',   wM: 0.4, hM: 0.4,  fill: '#f1f5f9', stroke: '#64748b' },
  { key: 'sofa',           label: 'ספה',                shape: 'rect',   wM: 1.8, hM: 0.3,  fill: '#fdf4ff', stroke: '#a21caf' },
  { key: 'butcher_cart',   label: "בוצ'ר עגלה",         shape: 'rect',   wM: 1,   hM: 0.3,  fill: '#dcfce7', stroke: '#16a34a' },
  { key: 'couch',          label: 'ספת ישיבה',          shape: 'rect',   wM: 0.4, hM: 0.3,  fill: '#fef9c3', stroke: '#ca8a04' },
  { key: 'bar_arc',        label: 'בר (קשתי)',          shape: 'arc',    wM: 2.5, hM: 1.25, fill: '#fed7aa', stroke: '#ea580c' },
];

function ItemEditorModal({ overrides, onSave, onClose }) {
  const [local, setLocal] = useState(() => {
    const init = {};
    SEATING_DEFS.forEach(d => {
      const ov = overrides[d.key] || {};
      init[d.key] = { wM: ov.wM ?? d.wM, hM: ov.hM ?? d.hM, shape: ov.shape ?? d.shape,
                      fill: ov.fill ?? d.fill, stroke: ov.stroke ?? d.stroke, image: ov.image ?? null };
    });
    return init;
  });
  const [saving, setSaving] = useState(false);

  function set(key, field, val) {
    setLocal(p => ({ ...p, [key]: { ...p[key], [field]: val } }));
  }

  function handleImage(key, e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => set(key, 'image', ev.target.result);
    reader.readAsDataURL(file);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.put('/admin/seating/element-overrides', { overrides: local });
      onSave(local);
      onClose();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-auto py-6 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl" onClick={e => e.stopPropagation()} dir="rtl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-black text-slate-800 text-base">עריכת פריטי סקיצה</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>
        <div className="overflow-y-auto max-h-[70vh] p-4 space-y-2">
          {SEATING_DEFS.map(d => {
            const v = local[d.key];
            return (
              <div key={d.key} className="p-3 rounded-xl border border-slate-100 bg-slate-50 space-y-2">
                <p className="font-bold text-sm text-slate-700">{d.label}</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <label className="text-xs text-slate-500">
                    רוחב (מ')
                    <input type="number" min="0.1" step="0.1" value={v.wM}
                      onChange={e => set(d.key, 'wM', parseFloat(e.target.value) || v.wM)}
                      className="w-full mt-0.5 text-sm border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:border-violet-400" />
                  </label>
                  <label className="text-xs text-slate-500">
                    עומק (מ')
                    <input type="number" min="0.1" step="0.1" value={v.hM}
                      onChange={e => set(d.key, 'hM', parseFloat(e.target.value) || v.hM)}
                      className="w-full mt-0.5 text-sm border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:border-violet-400" />
                  </label>
                  <label className="text-xs text-slate-500">
                    צורה
                    <select value={v.shape} onChange={e => set(d.key, 'shape', e.target.value)}
                      className="w-full mt-0.5 text-sm border border-slate-200 rounded-lg px-2 py-1 focus:outline-none">
                      <option value="rect">מלבן</option>
                      <option value="circle">עיגול</option>
                      <option value="arc">קשת</option>
                    </select>
                  </label>
                  <div className="flex gap-2">
                    <label className="text-xs text-slate-500">
                      רקע
                      <input type="color" value={v.fill} onChange={e => set(d.key, 'fill', e.target.value)}
                        className="mt-0.5 w-full h-8 rounded cursor-pointer border border-slate-200" />
                    </label>
                    <label className="text-xs text-slate-500">
                      מסגרת
                      <input type="color" value={v.stroke} onChange={e => set(d.key, 'stroke', e.target.value)}
                        className="mt-0.5 w-full h-8 rounded cursor-pointer border border-slate-200" />
                    </label>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {v.image
                    ? <div className="flex items-center gap-2">
                        <img src={v.image} alt="" className="h-10 w-10 object-contain rounded border border-slate-200" />
                        <button onClick={() => set(d.key, 'image', null)}
                          className="text-xs text-red-500 hover:underline">הסר תמונה</button>
                      </div>
                    : <label className="text-xs px-3 py-1.5 rounded-lg border border-dashed border-violet-300 text-violet-600 cursor-pointer hover:bg-violet-50">
                        העלה תמונה
                        <input type="file" accept="image/*" className="hidden" onChange={e => handleImage(d.key, e)} />
                      </label>
                  }
                </div>
              </div>
            );
          })}
        </div>
        <div className="px-5 py-4 border-t border-slate-100">
          <button onClick={handleSave} disabled={saving}
            className="w-full py-2.5 rounded-xl font-bold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
            {saving ? 'שומר...' : 'שמור שינויים'}
          </button>
        </div>
      </div>
    </div>
  );
}

const ROLE_COLORS = { admin: 'bg-violet-100 text-violet-700', sales: 'bg-indigo-100 text-indigo-700', production: 'bg-slate-100 text-slate-600' };
const emptyUser = { username: '', display_name: '', email: '', phone: '', role: 'sales', password: '' };

export default function AdminPage() {
  const [aiInstructions, setAiInstructions] = useState('');
  const [saved,   setSaved]   = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [loading, setLoading] = useState(true);
  const [staffSig, setStaffSig]         = useState('');
  const [sigUploading, setSigUploading] = useState(false);
  const [syncing,  setSyncing]  = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [waStatus, setWaStatus] = useState(null);
  const [waChecking, setWaChecking] = useState(false);
  const [users, setUsers] = useState([]);
  const [editingUser, setEditingUser] = useState(null); // null=closed, emptyUser=new, {id,...}=edit
  const [userSaving, setUserSaving] = useState(false);
  const [userError, setUserError] = useState('');
  const [driveFolders, setDriveFolders] = useState([]);
  const [driveNewFolder, setDriveNewFolder] = useState({ id: '', name: '' });
  const [driveSaving, setDriveSaving] = useState(false);
  const [calAcl, setCalAcl] = useState([]);
  const [calAclLoading, setCalAclLoading] = useState(false);
  const [calAclNewEmail, setCalAclNewEmail] = useState('');
  const [calAclAdding, setCalAclAdding] = useState(false);
  const [calAclError, setCalAclError] = useState('');
  const [contractEmailBody, setContractEmailBody] = useState('');
  const [contractEmailBank, setContractEmailBank] = useState('');
  const [contractEmailSaving, setContractEmailSaving] = useState(false);
  const [contractEmailSaved, setContractEmailSaved] = useState(false);
  const [googleToken, setGoogleToken]           = useState('');
  const [savingToken, setSavingToken]           = useState(false);
  const [tokenSaveResult, setTokenSaveResult]   = useState('');
  const [fpData, setFpData] = useState({ inside: null, outside: null });
  const [showItemEditor, setShowItemEditor]   = useState(false);
  const [elemOverrides,  setElemOverrides]    = useState({});

  useEffect(() => {
    api.get('/admin/settings')
      .then(r => {
        setAiInstructions(r.data.ai_instructions || '');
        setStaffSig(r.data.staff_signature || '');
        setDriveFolders(r.data.drive_folders ? JSON.parse(r.data.drive_folders) : []);
        setContractEmailBody(r.data.contract_email_body || '');
        setContractEmailBank(r.data.contract_email_bank || '');
        const fp = { inside: null, outside: null };
        try { fp.inside  = r.data.floorplan_inside  ? JSON.parse(r.data.floorplan_inside)  : null; } catch {}
        try { fp.outside = r.data.floorplan_outside ? JSON.parse(r.data.floorplan_outside) : null; } catch {}
        setFpData(fp);
        try { setElemOverrides(r.data.seating_element_overrides ? JSON.parse(r.data.seating_element_overrides) : {}); } catch {}
        setLoading(false);
      })
      .catch(() => setLoading(false));
    checkWaStatus();
    loadUsers();
    loadCalAcl();
  }, []);

  async function loadUsers() {
    try { const { data } = await api.get('/admin/users'); setUsers(data); } catch {}
  }

  async function checkWaStatus() {
    setWaChecking(true);
    try { const { data } = await api.get('/admin/whatsapp-status'); setWaStatus(data); }
    catch (err) { setWaStatus({ state: 'error', error: err.message }); }
    finally { setWaChecking(false); }
  }

  async function handleSyncAll() {
    setSyncing(true); setSyncResult(null);
    try { const { data } = await api.post('/calendar/sync-all'); setSyncResult(data); }
    catch (err) { setSyncResult({ error: err.response?.data?.error || err.message }); }
    finally { setSyncing(false); }
  }

  async function handleSigUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setSigUploading(true);
    try {
      const fd = new FormData();
      fd.append('signature', file);
      const { data } = await api.post('/admin/settings/staff-signature', fd);
      setStaffSig(data.dataUrl);
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setSigUploading(false);
      e.target.value = '';
    }
  }

  async function handleSigDelete() {
    if (!window.confirm('למחוק את חתימת הספק?')) return;
    try {
      await api.delete('/admin/settings/staff-signature');
      setStaffSig('');
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  }

  async function handleSave() {
    setSaving(true); setSaved(false);
    try { await api.put('/admin/settings/ai_instructions', { value: aiInstructions }); setSaved(true); setTimeout(() => setSaved(false), 3000); }
    finally { setSaving(false); }
  }

  async function handleContractEmailSave() {
    setContractEmailSaving(true); setContractEmailSaved(false);
    try {
      await Promise.all([
        api.put('/admin/settings/contract_email_body', { value: contractEmailBody }),
        api.put('/admin/settings/contract_email_bank', { value: contractEmailBank }),
      ]);
      setContractEmailSaved(true);
      setTimeout(() => setContractEmailSaved(false), 3000);
    } finally {
      setContractEmailSaving(false);
    }
  }

  async function handleUserSave() {
    setUserSaving(true); setUserError('');
    try {
      if (editingUser.id) {
        await api.put(`/admin/users/${editingUser.id}`, editingUser);
      } else {
        await api.post('/admin/users', editingUser);
      }
      await loadUsers();
      setEditingUser(null);
    } catch (err) {
      setUserError(err.response?.data?.error || err.message);
    } finally {
      setUserSaving(false);
    }
  }

  async function handleUserDelete(id) {
    if (!window.confirm('למחוק את המשתמש?')) return;
    try { await api.delete(`/admin/users/${id}`); await loadUsers(); }
    catch (err) { alert(err.response?.data?.error || err.message); }
  }

  async function handleDriveFolderAdd() {
    if (!driveNewFolder.id.trim() || !driveNewFolder.name.trim()) return;
    const updated = [...driveFolders, { id: driveNewFolder.id.trim(), name: driveNewFolder.name.trim() }];
    setDriveFolders(updated);
    setDriveNewFolder({ id: '', name: '' });
    await saveDriveFolders(updated);
  }

  async function handleDriveFolderRemove(idx) {
    const updated = driveFolders.filter((_, i) => i !== idx);
    setDriveFolders(updated);
    await saveDriveFolders(updated);
  }

  async function loadCalAcl() {
    setCalAclLoading(true);
    try { const { data } = await api.get('/calendar/acl'); setCalAcl(data); }
    catch {}
    finally { setCalAclLoading(false); }
  }

  async function handleCalAclAdd() {
    const email = calAclNewEmail.trim();
    if (!email) return;
    setCalAclAdding(true); setCalAclError('');
    try {
      const { data } = await api.post('/calendar/acl', { email });
      setCalAcl(prev => [...prev, data]);
      setCalAclNewEmail('');
    } catch (err) {
      setCalAclError(err.response?.data?.error || err.message);
    } finally {
      setCalAclAdding(false);
    }
  }

  async function handleCalAclRemove(ruleId) {
    try {
      await api.delete(`/calendar/acl/${encodeURIComponent(ruleId)}`);
      setCalAcl(prev => prev.filter(r => r.id !== ruleId));
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  }

  async function saveGoogleToken() {
    setSavingToken(true);
    setTokenSaveResult('');
    try {
      await api.post('/admin/google-token', { token: googleToken.trim() });
      setTokenSaveResult('ok');
      setGoogleToken('');
    } catch (e) {
      setTokenSaveResult(e.response?.data?.error || 'שגיאה');
    } finally {
      setSavingToken(false);
    }
  }

  async function saveDriveFolders(folders) {
    setDriveSaving(true);
    try { await api.put('/admin/settings/drive_folders', { value: JSON.stringify(folders) }); }
    catch (err) { alert(err.response?.data?.error || err.message); }
    finally { setDriveSaving(false); }
  }

  const inputCls = 'w-full rounded-xl px-3 py-2 text-sm border border-violet-200 focus:border-violet-400 focus:outline-none text-slate-700';

  return (
    <div className="min-h-screen pb-20 bg-gradient-to-br from-violet-50 to-indigo-50" dir="rtl">
      <div className="sticky top-0 z-20 px-4 pt-5 pb-3 bg-white border-b border-violet-100 shadow-sm">
        <h1 className="text-xl font-black text-violet-700">הגדרות מערכת</h1>
      </div>

      <div className="px-4 pt-4 space-y-4">

        {/* ── User Management ── */}
        <div className="rounded-2xl p-4 bg-white border border-violet-100 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">👥</span>
              <h2 className="font-black text-base text-slate-800">ניהול משתמשים</h2>
            </div>
            <button
              onClick={() => { setEditingUser(emptyUser); setUserError(''); }}
              className="text-xs font-bold text-white px-3 py-1.5 rounded-lg"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
            >+ הוסף משתמש</button>
          </div>

          <div className="space-y-2">
            {users.map(u => (
              <div key={u.id} className="flex items-center justify-between rounded-xl border border-violet-50 bg-violet-50/40 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800 truncate">{u.display_name || u.username}</p>
                  <p className="text-xs text-slate-400 truncate">{u.username}{u.phone ? ` · ${u.phone}` : ''}{u.email ? ` · ${u.email}` : ''}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0 mr-2">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${ROLE_COLORS[u.role] || 'bg-slate-100 text-slate-600'}`}>
                    {ROLE_LABELS[u.role] || u.role}
                  </span>
                  <button onClick={() => { setEditingUser({ ...u, password: '' }); setUserError(''); }} className="text-slate-400 hover:text-violet-600 text-sm">✏️</button>
                  <button onClick={() => handleUserDelete(u.id)} className="text-slate-400 hover:text-red-500 text-sm">🗑</button>
                </div>
              </div>
            ))}
            {users.length === 0 && <p className="text-xs text-slate-400 text-center py-2">אין משתמשים</p>}
          </div>
        </div>

        {/* ── AI Instructions ── */}
        <div className="rounded-2xl p-4 bg-white border border-violet-100 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🤖</span>
            <h2 className="font-black text-base text-slate-800">הוראות לבינה מלאכותית</h2>
          </div>
          <p className="text-xs mb-3 text-slate-400">
            כתוב כאן כללים, סגנון ודוגמאות שישפיעו על כל תגובה שה-AI יציע ("הצע תשובה" ו"שפר"). ניתן לכתוב כמה כללים שרוצים.
          </p>
          {loading ? (
            <div className="text-xs animate-pulse text-slate-400">טוען...</div>
          ) : (
            <>
              <textarea
                value={aiInstructions}
                onChange={e => setAiInstructions(e.target.value)}
                rows={12}
                placeholder={`לדוגמה:\n- כתוב בגובה העיניים, בשפה יומיומית ולא פורמלית\n- הימנע ממילים כמו "בהחלט", "כמובן", "בוודאי"\n- משפטים קצרים, מקסימום 2-3 משפטים בתגובה\n- תמיד סיים עם שאלה שמקדמת את השיחה\n- אל תשתמש באמוג'ים`}
                className="w-full rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none border border-violet-200 focus:border-violet-400 text-slate-700"
                style={{ fontFamily: 'inherit', lineHeight: '1.6' }}
              />
              <button onClick={handleSave} disabled={saving}
                className="mt-3 w-full py-2.5 rounded-xl font-black text-sm transition disabled:opacity-50 text-white"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
                {saving ? 'שומר...' : saved ? '✅ נשמר' : 'שמור הוראות'}
              </button>
            </>
          )}
        </div>

        {/* ── Staff signature ── */}
        <div className="rounded-2xl p-4 bg-white border border-violet-100 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">✍️</span>
            <h2 className="font-black text-base text-slate-800">חתימת הספק לחוזה</h2>
          </div>
          <p className="text-xs mb-3 text-slate-400">תמונה זו תופיע בצד הספק בחוזה החתום שנשלח ללקוח.</p>
          {staffSig ? (
            <div className="flex items-center gap-3 mb-3">
              <img src={staffSig} alt="חתימת הספק" className="h-16 object-contain border border-slate-200 rounded-xl p-1 bg-white" />
              <button onClick={handleSigDelete} className="text-xs text-red-500 hover:underline">מחק חתימה</button>
            </div>
          ) : (
            <p className="text-xs text-slate-400 mb-3">לא הועלתה חתימה</p>
          )}
          <label className={`block w-full py-2.5 rounded-xl font-black text-sm text-white text-center cursor-pointer ${sigUploading ? 'opacity-50 pointer-events-none' : ''}`}
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
            {sigUploading ? 'מעלה...' : staffSig ? 'החלף חתימה' : 'העלה חתימה'}
            <input type="file" accept="image/*" className="hidden" onChange={handleSigUpload} disabled={sigUploading} />
          </label>
        </div>

        {/* ── Contract email content ── */}
        <div className="rounded-2xl p-4 bg-white border border-violet-100 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">📧</span>
            <h2 className="font-black text-base text-slate-800">תוכן אימייל חוזה חתום</h2>
          </div>
          <p className="text-xs mb-3 text-slate-400">הטקסט כאן יופיע באימייל שנשלח ללקוח לאחר החתימה על החוזה.</p>
          <label className="block text-xs font-bold text-slate-600 mb-1">הודעה אישית ללקוח</label>
          <textarea
            value={contractEmailBody}
            onChange={e => setContractEmailBody(e.target.value)}
            rows={4}
            placeholder="לדוגמה: מצפים לאירוע שלכם! לכל שאלה אנחנו זמינים."
            className="w-full rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none border border-violet-200 focus:border-violet-400 text-slate-700 mb-3"
            style={{ fontFamily: 'inherit', lineHeight: '1.6' }}
          />
          <label className="block text-xs font-bold text-slate-600 mb-1">פרטי תשלום / חשבון בנק</label>
          <textarea
            value={contractEmailBank}
            onChange={e => setContractEmailBank(e.target.value)}
            rows={4}
            placeholder="לדוגמה: בנק הפועלים, סניף 123, חשבון 456789, על שם שרביה בע&quot;מ"
            className="w-full rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none border border-violet-200 focus:border-violet-400 text-slate-700 mb-3"
            style={{ fontFamily: 'inherit', lineHeight: '1.6' }}
          />
          <button onClick={handleContractEmailSave} disabled={contractEmailSaving}
            className="w-full py-2.5 rounded-xl font-black text-sm transition disabled:opacity-50 text-white"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
            {contractEmailSaving ? 'שומר...' : contractEmailSaved ? 'נשמר' : 'שמור'}
          </button>
        </div>

        {/* ── WhatsApp status ── */}
        <div className="rounded-2xl p-4 bg-white border border-violet-100 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">💬</span>
            <h2 className="font-black text-base text-slate-800">WhatsApp — סטטוס חיבור</h2>
          </div>
          <p className="text-xs mb-3 text-slate-400">בדוק אם חיבור ה-WhatsApp (Green API) פעיל. אם לא מחובר — יש להיכנס ל-Green API ולסרוק מחדש.</p>
          {waChecking ? (
            <p className="text-xs animate-pulse text-slate-400">בודק סטטוס...</p>
          ) : waStatus ? (
            <div className={`text-xs rounded-lg px-3 py-2 border ${waStatus.state === 'authorized' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
              {waStatus.state === 'authorized' ? (
                <p>✅ WhatsApp מחובר{waStatus.accountInfo?.wid ? ` — ${waStatus.accountInfo.wid}` : ''}</p>
              ) : waStatus.state === 'notConfigured' ? (
                <p>⚙️ Green API לא מוגדר (חסרים ENV variables)</p>
              ) : (
                <>
                  <p>❌ WhatsApp לא מחובר — סטטוס: {waStatus.state || 'שגיאה'}</p>
                  {waStatus.error && <p className="mt-0.5 opacity-80">{waStatus.error}</p>}
                  <p className="mt-1">יש להיכנס ל-Green API ולסרוק מחדש את קוד ה-QR.</p>
                </>
              )}
            </div>
          ) : null}
          <button onClick={checkWaStatus} disabled={waChecking}
            className="mt-3 w-full py-2 rounded-xl font-bold text-sm transition disabled:opacity-50 text-white"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
            {waChecking ? '⏳ בודק...' : 'רענן סטטוס'}
          </button>
        </div>

        {/* ── Google Calendar sync ── */}
        <div className="rounded-2xl p-4 bg-white border border-violet-100 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">📅</span>
            <h2 className="font-black text-base text-slate-800">Google Calendar — סנכרון כולל</h2>
          </div>
          <p className="text-xs mb-3 text-slate-400">שלח את כל הלידים עם תאריך אירוע ל-Google Calendar. אירועים קיימים יעודכנו, חסרים ייווצרו.</p>
          <button onClick={handleSyncAll} disabled={syncing}
            className="w-full py-2.5 rounded-xl font-black text-sm transition disabled:opacity-50 text-white"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
            {syncing ? '⏳ מסנכרן...' : 'סנכרן כל האירועים'}
          </button>
          {syncResult && !syncResult.error && (
            <div className="mt-2 text-xs rounded-lg px-3 py-2 bg-emerald-50 border border-emerald-200 text-emerald-700">
              ✅ סונכרנו {syncResult.synced} אירועים בהצלחה{syncResult.failed > 0 ? `, נכשלו ${syncResult.failed}` : ''}
              {syncResult.errors?.length > 0 && <p className="mt-1 text-amber-600">{syncResult.errors[0]}</p>}
            </div>
          )}
          {syncResult?.error && (
            <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{syncResult.error}</p>
          )}
        </div>

        {/* ── Google Token Re-auth ── */}
        <div className="rounded-2xl p-4 bg-white border border-violet-100 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🔑</span>
            <h2 className="font-black text-base text-slate-800">Google API — חידוש הרשאה</h2>
          </div>
          <p className="text-xs mb-3 text-slate-400">
            כאשר Gmail ו-Calendar מפסיקים לעבוד (שגיאת "invalid grant"), יש להריץ את הפקודה{' '}
            <code className="bg-slate-100 px-1 rounded">node server/scripts/googleAuth.js</code>{' '}
            מקומית ולהדביק את תוכן הקובץ <code className="bg-slate-100 px-1 rounded">server/google_token.json</code> כאן.
          </p>
          <textarea
            value={googleToken}
            onChange={e => setGoogleToken(e.target.value)}
            rows={4}
            className="w-full border border-slate-200 rounded-xl p-3 text-xs font-mono mb-3 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300"
            placeholder='{"access_token":"...","refresh_token":"...","expiry_date":...}'
            dir="ltr"
          />
          <button
            onClick={saveGoogleToken}
            disabled={!googleToken.trim() || savingToken}
            className="px-5 py-2 rounded-xl font-bold text-sm text-white disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
            {savingToken ? 'שומר...' : 'עדכן טוקן'}
          </button>
          {tokenSaveResult && (
            <p className={`text-xs mt-2 ${tokenSaveResult === 'ok' ? 'text-green-600' : 'text-red-500'}`}>
              {tokenSaveResult === 'ok' ? 'הטוקן עודכן בהצלחה' : tokenSaveResult}
            </p>
          )}
        </div>

        {/* ── Calendar Access ── */}
        <div className="rounded-2xl p-4 bg-white border border-violet-100 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🔐</span>
            <h2 className="font-black text-base text-slate-800">גישה ליומן Google</h2>
          </div>
          <p className="text-xs mb-3 text-slate-400">הוסף כתובת Gmail של משתמש כדי שיוכל לראות את היומן באפליקציה. ניתן להסיר גישה בכל עת.</p>

          <div className="space-y-2 mb-3">
            {calAclLoading && <p className="text-xs text-slate-400 text-center py-2 animate-pulse">טוען...</p>}
            {!calAclLoading && calAcl.filter(r => r.scope?.type === 'user').map(r => (
              <div key={r.id} className="flex items-center justify-between rounded-xl border border-violet-50 bg-violet-50/40 px-3 py-2 gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800 truncate">{r.scope.value}</p>
                  <p className="text-xs text-slate-400">{r.role === 'owner' ? 'בעלים' : r.role === 'writer' ? 'עריכה' : 'צפייה'}</p>
                </div>
                {r.role !== 'owner' && (
                  <button onClick={() => handleCalAclRemove(r.id)} className="shrink-0 text-slate-400 hover:text-red-500 text-sm">🗑</button>
                )}
              </div>
            ))}
            {!calAclLoading && calAcl.filter(r => r.scope?.type === 'user').length === 0 && (
              <p className="text-xs text-slate-400 text-center py-2">אין משתמשים עם גישה</p>
            )}
          </div>

          <div className="flex gap-2">
            <input
              className="flex-1 rounded-xl px-3 py-2 text-sm border border-violet-200 focus:border-violet-400 focus:outline-none text-slate-700"
              placeholder="כתובת Gmail"
              value={calAclNewEmail}
              onChange={e => { setCalAclNewEmail(e.target.value); setCalAclError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleCalAclAdd()}
              dir="ltr"
            />
            <button
              onClick={handleCalAclAdd}
              disabled={calAclAdding || !calAclNewEmail.trim()}
              className="shrink-0 px-4 py-2 rounded-xl font-black text-sm text-white disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
            >{calAclAdding ? '...' : 'הוסף'}</button>
          </div>
          {calAclError && <p className="text-xs text-red-600 mt-2">{calAclError}</p>}
        </div>

        {/* ── Google Drive folders ── */}
        <div className="rounded-2xl p-4 bg-white border border-violet-100 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">📂</span>
            <h2 className="font-black text-base text-slate-800">Google Drive — תיקיות</h2>
          </div>
          <p className="text-xs mb-3 text-slate-400">הגדר תיקיות Google Drive שמהן ניתן לצרף קבצים בשליחת הודעות ומסמכים. העתק את ה-ID של התיקיה מה-URL של Google Drive.</p>

          <div className="space-y-2 mb-3">
            {driveFolders.map((f, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl border border-violet-50 bg-violet-50/40 px-3 py-2 gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800 truncate">{f.name}</p>
                  <p className="text-xs text-slate-400 truncate font-mono">{f.id}</p>
                </div>
                <button onClick={() => handleDriveFolderRemove(i)} className="shrink-0 text-slate-400 hover:text-red-500 text-sm">🗑</button>
              </div>
            ))}
            {driveFolders.length === 0 && <p className="text-xs text-slate-400 text-center py-2">אין תיקיות מוגדרות</p>}
          </div>

          <div className="flex gap-2">
            <input
              className="flex-1 rounded-xl px-3 py-2 text-sm border border-violet-200 focus:border-violet-400 focus:outline-none text-slate-700"
              placeholder="שם התיקיה"
              value={driveNewFolder.name}
              onChange={e => setDriveNewFolder(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleDriveFolderAdd()}
            />
            <input
              className="flex-1 rounded-xl px-3 py-2 text-sm border border-violet-200 focus:border-violet-400 focus:outline-none text-slate-700 font-mono"
              placeholder="Folder ID"
              value={driveNewFolder.id}
              onChange={e => setDriveNewFolder(f => ({ ...f, id: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleDriveFolderAdd()}
            />
            <button
              onClick={handleDriveFolderAdd}
              disabled={driveSaving || !driveNewFolder.id.trim() || !driveNewFolder.name.trim()}
              className="shrink-0 px-4 py-2 rounded-xl font-black text-sm text-white disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
            >+</button>
          </div>
          {driveSaving && <p className="text-xs text-slate-400 mt-2 text-center">שומר...</p>}
        </div>

        {/* ── Venue floor plan images ── */}
        <div className="rounded-2xl p-4 bg-white border border-violet-100 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🗺️</span>
            <h2 className="font-black text-base text-slate-800">סקיצת פריסה — תמונות רקע</h2>
          </div>
          <p className="text-xs mb-4 text-slate-400">העלה תמונת בסיס (תוכנית אולם) לכל קטע. הזן את המידות האמיתיות כדי שהפריטים יוצגו בקנה מידה נכון.</p>
          {[['inside', 'פנים'], ['outside', 'חוץ']].map(([sec, lbl]) => (
            <FloorplanUpload key={sec} section={sec} label={lbl}
              existing={fpData[sec]}
              onSaved={(s, data) => setFpData(prev => ({ ...prev, [s]: data }))}
            />
          ))}
          <button onClick={() => setShowItemEditor(true)}
            className="mt-2 w-full py-2.5 rounded-xl font-bold text-sm border-2 border-dashed border-violet-300 text-violet-600 hover:bg-violet-50 transition">
            ערוך פריטים
          </button>
        </div>

      </div>

      {showItemEditor && (
        <ItemEditorModal
          overrides={elemOverrides}
          onSave={newOv => setElemOverrides(newOv)}
          onClose={() => setShowItemEditor(false)}
        />
      )}

      {/* ── User edit/add modal ── */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setEditingUser(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-5 w-full max-w-sm space-y-3" onClick={e => e.stopPropagation()} dir="rtl">
            <h3 className="font-black text-slate-800 text-base">{editingUser.id ? 'עריכת משתמש' : 'משתמש חדש'}</h3>

            <input className={inputCls} placeholder="שם תצוגה" value={editingUser.display_name}
              onChange={e => setEditingUser(u => ({ ...u, display_name: e.target.value }))} />
            <input className={inputCls} placeholder="שם משתמש *" value={editingUser.username}
              onChange={e => setEditingUser(u => ({ ...u, username: e.target.value }))} />
            <input className={inputCls} placeholder="אימייל" value={editingUser.email}
              onChange={e => setEditingUser(u => ({ ...u, email: e.target.value }))} />
            <input className={inputCls} placeholder="טלפון" value={editingUser.phone}
              onChange={e => setEditingUser(u => ({ ...u, phone: e.target.value }))} />
            <select className={inputCls} value={editingUser.role}
              onChange={e => setEditingUser(u => ({ ...u, role: e.target.value }))}>
              <option value="sales">מכירות</option>
              <option value="admin">מנהל</option>
              <option value="production">הפקה</option>
            </select>
            <input className={inputCls} placeholder={editingUser.id ? 'סיסמה חדשה (השאר ריק לשמירה)' : 'סיסמה *'}
              type="password" value={editingUser.password}
              onChange={e => setEditingUser(u => ({ ...u, password: e.target.value }))} />

            {userError && <p className="text-xs text-red-600">{userError}</p>}

            <div className="flex gap-2 pt-1">
              <button onClick={handleUserSave} disabled={userSaving}
                className="flex-1 py-2.5 rounded-xl font-black text-sm text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
                {userSaving ? 'שומר...' : 'שמור'}
              </button>
              <button onClick={() => setEditingUser(null)}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm border border-slate-200 text-slate-600 hover:bg-slate-50">
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
