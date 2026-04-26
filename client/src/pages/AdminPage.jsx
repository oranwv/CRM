import { useState, useEffect } from 'react';
import api from '../api';

export default function AdminPage() {
  const [aiInstructions, setAiInstructions] = useState('');
  const [saved,   setSaved]   = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing,  setSyncing]  = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [waStatus, setWaStatus] = useState(null);
  const [waChecking, setWaChecking] = useState(false);

  useEffect(() => {
    api.get('/admin/settings')
      .then(r => {
        setAiInstructions(r.data.ai_instructions || '');
        setLoading(false);
      })
      .catch(() => setLoading(false));
    checkWaStatus();
  }, []);

  async function checkWaStatus() {
    setWaChecking(true);
    try {
      const { data } = await api.get('/admin/whatsapp-status');
      setWaStatus(data);
    } catch (err) {
      setWaStatus({ state: 'error', error: err.message });
    } finally {
      setWaChecking(false);
    }
  }

  async function handleSyncAll() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const { data } = await api.post('/calendar/sync-all');
      setSyncResult(data);
    } catch (err) {
      setSyncResult({ error: err.response?.data?.error || err.message });
    } finally {
      setSyncing(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await api.put('/admin/settings/ai_instructions', { value: aiInstructions });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen pb-20 bg-gradient-to-br from-violet-50 to-indigo-50" dir="rtl">
      {/* Header */}
      <div className="sticky top-0 z-20 px-4 pt-5 pb-3 bg-white border-b border-violet-100 shadow-sm">
        <h1 className="text-xl font-black text-violet-700">הגדרות מערכת</h1>
      </div>

      <div className="px-4 pt-4 space-y-4">
        {/* AI Instructions card */}
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
              <button
                onClick={handleSave}
                disabled={saving}
                className="mt-3 w-full py-2.5 rounded-xl font-black text-sm transition disabled:opacity-50 text-white"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
              >
                {saving ? 'שומר...' : saved ? '✅ נשמר' : 'שמור הוראות'}
              </button>
            </>
          )}
        </div>
        {/* WhatsApp status card */}
        <div className="rounded-2xl p-4 bg-white border border-violet-100 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">💬</span>
            <h2 className="font-black text-base text-slate-800">WhatsApp — סטטוס חיבור</h2>
          </div>
          <p className="text-xs mb-3 text-slate-400">
            בדוק אם חיבור ה-WhatsApp (Green API) פעיל. אם לא מחובר — יש להיכנס ל-Green API ולסרוק מחדש.
          </p>
          {waChecking ? (
            <p className="text-xs animate-pulse text-slate-400">בודק סטטוס...</p>
          ) : waStatus ? (
            <div className={`text-xs rounded-lg px-3 py-2 border ${
              waStatus.state === 'authorized'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}>
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
          <button
            onClick={checkWaStatus}
            disabled={waChecking}
            className="mt-3 w-full py-2 rounded-xl font-bold text-sm transition disabled:opacity-50 text-white"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
          >
            {waChecking ? '⏳ בודק...' : 'רענן סטטוס'}
          </button>
        </div>

        {/* Google Calendar sync card */}
        <div className="rounded-2xl p-4 bg-white border border-violet-100 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">📅</span>
            <h2 className="font-black text-base text-slate-800">Google Calendar — סנכרון כולל</h2>
          </div>
          <p className="text-xs mb-3 text-slate-400">
            שלח את כל הלידים עם תאריך אירוע ל-Google Calendar. אירועים קיימים יעודכנו, חסרים ייווצרו.
          </p>
          <button
            onClick={handleSyncAll}
            disabled={syncing}
            className="w-full py-2.5 rounded-xl font-black text-sm transition disabled:opacity-50 text-white"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
          >
            {syncing ? '⏳ מסנכרן...' : 'סנכרן כל האירועים'}
          </button>
          {syncResult && !syncResult.error && (
            <div className="mt-2 text-xs rounded-lg px-3 py-2 bg-emerald-50 border border-emerald-200 text-emerald-700">
              ✅ סונכרנו {syncResult.synced} אירועים בהצלחה{syncResult.failed > 0 ? `, נכשלו ${syncResult.failed}` : ''}
              {syncResult.errors?.length > 0 && (
                <p className="mt-1 text-amber-600">{syncResult.errors[0]}</p>
              )}
            </div>
          )}
          {syncResult?.error && (
            <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{syncResult.error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
