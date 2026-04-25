import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { username, password });
      localStorage.setItem('crm_token', data.token);
      localStorage.setItem('crm_user', JSON.stringify(data.user));
      navigate('/');
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
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl text-white text-2xl font-black shadow-lg mb-4"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', boxShadow: '0 8px 24px rgba(124,58,237,0.35)' }}
          >
            ש
          </div>
          <h1 className="text-2xl font-black text-slate-900">שרביה CRM</h1>
          <p className="text-slate-400 text-sm mt-1">ברוכים הבאים! התחבר להמשך</p>
        </div>

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
