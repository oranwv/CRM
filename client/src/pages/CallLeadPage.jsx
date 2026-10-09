import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';
import { useCalls } from '../context/CallContext';
import { tryOpenDialerApp } from '../components/LeadCard';

// /call/:leadId — the link in the missed-call WhatsApp message. Dials the lead the same way the
// lead card's "התקשר" button does: on Android the ProEvent Dialer app if installed, otherwise
// the browser softphone; then lands on the lead card so the call bar and timeline are visible.
export default function CallLeadPage() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const calls = useCalls();
  const [lead, setLead] = useState(null);
  const [status, setStatus] = useState('טוען את הליד…');
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    api.get(`/leads/${leadId}`).then(r => setLead(r.data)).catch(() => setError('הליד לא נמצא'));
  }, [leadId]);

  async function dial() {
    if (!lead) return;
    setError('');
    if (!lead.phone) { setError('לליד אין מספר טלפון'); return; }
    if (/Android/i.test(navigator.userAgent)) {
      setStatus('פותח את אפליקציית החייגן…');
      if (await tryOpenDialerApp(lead)) { navigate(`/?lead=${lead.id}`, { replace: true }); return; }
    }
    if (!calls.enabled) { setError('שיחות מהדפדפן אינן זמינות במשתמש הזה'); return; }
    setStatus('מתקשר מהדפדפן…');
    try {
      await calls.startCall(lead);
      navigate(`/?lead=${lead.id}`, { replace: true });
    } catch (err) {
      setError(err.message || 'לא ניתן להתקשר');
      setStatus('');
    }
  }

  // Auto-dial once the lead is loaded; the button below covers browsers that need a tap first.
  useEffect(() => { if (lead && !started.current) { started.current = true; dial(); } }, [lead]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div dir="rtl" className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 bg-slate-50 text-center">
      <div className="text-5xl">📞</div>
      <h1 className="text-2xl font-bold text-slate-800">{lead?.name || ''}</h1>
      {lead?.phone && <p className="text-slate-500 text-lg" dir="ltr">{lead.phone}</p>}
      {status && !error && <p className="text-slate-500">{status}</p>}
      {error && <p className="text-red-600">{error}</p>}
      <button onClick={dial} disabled={!lead}
        className="mt-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-semibold disabled:opacity-50">
        התקשר עכשיו
      </button>
      <button onClick={() => navigate(`/?lead=${leadId}`)} className="text-sm text-violet-600 hover:underline">פתח את הליד בלי להתקשר</button>
    </div>
  );
}
