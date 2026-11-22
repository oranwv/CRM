import { useState } from 'react';
import { useNavigate, Navigate, useLocation } from 'react-router-dom';
import api from '../api';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = location.state?.from && location.state.from !== '/login' ? location.state.from : '/';

  // Thrown out by the server (api.js): say why. Kept until the next successful login so it can be
  // read or photographed; the small grey line is what to send when reporting a disconnect.
  const [kicked] = useState(() => {
    try { const v = JSON.parse(sessionStorage.getItem('crm_session_expired') || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; }
  });
  const kickedText = kicked && ({
    expired:   'החיבור פג — לא נעשה שימוש במערכת מעל 30 יום',
    bad_token: 'פרטי החיבור השמורים בדפדפן אינם תקינים',
    no_token:  'בקשה נשלחה בלי פרטי חיבור',
    blocked:   'החשבון חסום',
    missing:   'המשתמש לא נמצא במערכת',
  }[kicked.reason] || 'החיבור נדחה על ידי השרת');

  // Already logged in (e.g. navigated/back to /login while a valid token exists):
  // go to the app instead of showing the login form again.
  if (localStorage.getItem('crm_token')) return <Navigate to={returnTo} replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { username, password });
      localStorage.setItem('crm_token', data.token);
      // Tells the server this browser uses the app, so `/` serves the CRM and not the public landing page
      document.cookie = 'crm_app=1; path=/; max-age=31536000; SameSite=Lax';
      localStorage.setItem('crm_user', JSON.stringify(data.user));
      localStorage.removeItem('crm_att'); // Phase 84: the attendance tabs are cached per user
      sessionStorage.removeItem('crm_session_expired');
      // Replace so /login does not stay in history (back button won't return here).
      navigate(returnTo, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'כניסה נכשלה');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 via-indigo-50 to-purple-50">
      <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-sm border border-violet-100">
        <div className="text-center mb-7">
          <img src="/logo/app-icon.svg" alt="ProEvent" className="inline-block w-16 h-16 rounded-2xl shadow-lg mb-4"
            style={{ boxShadow: '0 8px 24px rgba(124,58,237,0.35)' }} />
          <h1 className="text-2xl font-black text-slate-900">ProEvent CRM</h1>
          <p className="text-[11px] font-bold tracking-tight text-violet-500 mt-0.5" dir="ltr">pro<span className="text-violet-300">event</span></p>
          <p className="text-slate-400 text-sm mt-1">ברוכים הבאים! התחבר להמשך</p>
        </div>

        {kicked && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-right" dir="rtl">
            <p className="text-sm font-bold text-amber-800">נותקת מהמערכת: {kickedText}</p>
            <p className="text-[10px] text-amber-700/70 mt-0.5 select-all" dir="ltr" style={{ textAlign: 'left' }}>
              {kicked.reason} · {kicked.request} · {kicked.page} · {new Date(kicked.at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-600 mb-1.5">שם משתמש</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full border border-violet-200 bg-violet-50 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 transition"
              required autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-600 mb-1.5">סיסמה</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-violet-200 bg-violet-50 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 transition"
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-3 py-2 rounded-xl">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full text-white font-bold py-3 rounded-xl transition shadow-lg disabled:opacity-60 mt-2"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', boxShadow: '0 4px 14px rgba(124,58,237,0.35)' }}
          >
            {loading ? 'מתחבר...' : 'כניסה'}
          </button>
        </form>
      </div>
    </div>
  );
}
