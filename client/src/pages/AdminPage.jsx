import { useState, useEffect } from 'react';
import api from '../api';

const ROLE_LABELS = { admin: 'מנהל', sales: 'מכירות', production: 'הפקה' };
const ROLE_COLORS = { admin: 'bg-violet-100 text-violet-700', sales: 'bg-indigo-100 text-indigo-700', production: 'bg-slate-100 text-slate-600' };
const emptyUser = { username: '', display_name: '', email: '', phone: '', role: 'sales', password: '' };

export default function AdminPage() {
  const [aiInstructions, setAiInstructions] = useState('');
  const [saved,   setSaved]   = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing,  setSyncing]  = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [waStatus, setWaStatus] = useState(null);
  const [waChecking, setWaChecking] = useState(false);
  const [users, setUsers] = useState([]);
  const [editingUser, setEditingUser] = useState(null); // null=closed, emptyUser=new, {id,...}=edit
  const [userSaving, setUserSaving] = useState(false);
  const [userError, setUserError] = useState('');

  useEffect(() => {
    api.get('/admin/settings')
      .then(r => { setAiInstructions(r.data.ai_instructions || ''); setLoading(false); })
      .catch(() => setLoading(false));
    checkWaStatus();
    loadUsers();
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

  async function handleSave() {
    setSaving(true); setSaved(false);
    try { await api.put('/admin/settings/ai_instructions', { value: aiInstructions }); setSaved(true); setTimeout(() => setSaved(false), 3000); }
    finally { setSaving(false); }
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

      </div>

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
