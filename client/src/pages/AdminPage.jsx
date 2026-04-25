import { useState, useEffect } from 'react';
import api from '../api';

export default function AdminPage() {
  const [aiInstructions, setAiInstructions] = useState('');
  const [saved,   setSaved]   = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/settings')
      .then(r => {
        setAiInstructions(r.data.ai_instructions || '');
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

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
    <div className="min-h-screen pb-20" style={{ background: '#120b04' }} dir="rtl">
      {/* Header */}
      <div className="sticky top-0 z-20 px-4 pt-5 pb-3" style={{ background: '#120b04' }}>
        <h1 className="text-xl font-black" style={{ color: '#d97706' }}>הגדרות מערכת</h1>
      </div>

      <div className="px-4 space-y-4">
        {/* AI Instructions card */}
        <div className="rounded-2xl p-4" style={{ background: '#1c1007', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🤖</span>
            <h2 className="font-black text-base" style={{ color: '#e5c98e' }}>הוראות לבינה מלאכותית</h2>
          </div>
          <p className="text-xs mb-3" style={{ color: '#8a6a3a' }}>
            כתוב כאן כללים, סגנון ודוגמאות שישפיעו על כל תגובה שה-AI יציע ("הצע תשובה" ו"שפר"). ניתן לכתוב כמה כללים שרוצים.
          </p>

          {loading ? (
            <div className="text-xs animate-pulse" style={{ color: '#8a6a3a' }}>טוען...</div>
          ) : (
            <>
              <textarea
                value={aiInstructions}
                onChange={e => setAiInstructions(e.target.value)}
                rows={12}
                placeholder={`לדוגמה:\n- כתוב בגובה העיניים, בשפה יומיומית ולא פורמלית\n- הימנע ממילים כמו "בהחלט", "כמובן", "בוודאי"\n- משפטים קצרים, מקסימום 2-3 משפטים בתגובה\n- תמיד סיים עם שאלה שמקדמת את השיחה\n- אל תשתמש באמוג'ים`}
                className="w-full rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none"
                style={{
                  background: '#0e0804',
                  border: '1.5px solid rgba(255,255,255,0.1)',
                  color: '#e5c98e',
                  fontFamily: 'inherit',
                  lineHeight: '1.6',
                }}
              />
              <button
                onClick={handleSave}
                disabled={saving}
                className="mt-3 w-full py-2.5 rounded-xl font-black text-sm transition disabled:opacity-50"
                style={{ background: '#d97706', color: '#fff' }}
              >
                {saving ? 'שומר...' : saved ? '✅ נשמר' : 'שמור הוראות'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
