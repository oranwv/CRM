import { useState, useEffect } from 'react';
import api from '../../api';

export default function AddCandidateModal({ jobId, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', ai_summary: '' });
  const [selectedJobId, setSelectedJobId] = useState(jobId || '');
  const [jobs, setJobs] = useState([]);
  const [resumeFile, setResumeFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/candidates/jobs').then(({ data }) => setJobs(data)).catch(() => {});
  }, []);

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const formData = new FormData();
      Object.entries(form).forEach(([k, v]) => { if (v) formData.append(k, v); });
      if (selectedJobId) formData.append('job_id', selectedJobId);
      if (resumeFile) formData.append('resume', resumeFile);
      await api.post('/candidates', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה בהוספת מועמד');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden max-h-[92vh] flex flex-col">
        <div className="bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-500 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-white">הוסף מועמד</h2>
          <button onClick={onClose} className="text-violet-200 hover:text-white text-xl leading-none transition">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-3 text-sm overflow-y-auto">
          <Field label="שם מלא" name="name" value={form.name} onChange={handleChange} />
          <Field label="טלפון" name="phone" value={form.phone} onChange={handleChange} type="tel" />
          <Field label="אימייל" name="email" value={form.email} onChange={handleChange} type="email" />
          <Field label="כתובת" name="address" value={form.address} onChange={handleChange} />
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5">משרה</label>
            <select
              value={selectedJobId}
              onChange={e => setSelectedJobId(e.target.value)}
              className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400 transition"
            >
              <option value="">— ללא משרה —</option>
              {jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5">סיכום</label>
            <textarea
              name="ai_summary"
              value={form.ai_summary}
              onChange={handleChange}
              rows={3}
              className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400 transition resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5">קורות חיים (PDF / DOCX)</label>
            <input type="file" accept=".pdf,.doc,.docx" onChange={e => setResumeFile(e.target.files[0])} className="text-sm text-slate-500" />
          </div>

          {error && <div className="bg-red-50 border border-red-200 text-red-600 text-xs px-3 py-2 rounded-xl">{error}</div>}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 border-2 border-slate-200 text-slate-500 hover:bg-slate-50 py-2.5 rounded-xl transition font-semibold">ביטול</button>
            <button type="submit" disabled={saving} className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-500 hover:from-violet-700 hover:to-indigo-600 text-white font-bold py-2.5 rounded-xl transition shadow-md shadow-violet-200 disabled:opacity-60">
              {saving ? 'מוסיף...' : 'הוסף מועמד'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, name, value, onChange, type = 'text' }) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-500 mb-1.5">{label}</label>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400 transition"
      />
    </div>
  );
}
