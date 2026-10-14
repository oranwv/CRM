import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import api from '../../api';
import StatusBadge from './StatusBadge';
import InteractionCard from './InteractionCard';
import AddInteractionForm from './AddInteractionForm';
import SendInviteForm, { RSVP_LABELS } from './SendInviteForm';

const PRESET_STATUSES = ['חדש', 'בתהליך', 'ראיון נקבע', 'התקבל', 'נדחה', 'לא רלוונטי'];

export default function CandidateDetail({ candidateId, onClose, onUpdated }) {
  const [candidate, setCandidate]       = useState(null);
  const [interactions, setInteractions] = useState([]);
  const [jobs, setJobs]                 = useState([]);
  const [editingStatus, setEditingStatus] = useState(false);
  const [pendingStatus, setPendingStatus] = useState(null);
  const [statusReason, setStatusReason] = useState('');
  const [customStatus, setCustomStatus] = useState('');
  const [addingType, setAddingType]     = useState(null);
  const [showInvite, setShowInvite]     = useState(false);
  const [loading, setLoading]           = useState(true);
  const [rsvpStatus, setRsvpStatus]     = useState(null);
  const [checkingRsvp, setCheckingRsvp] = useState(false);

  const loadInteractions = useCallback(
    () => api.get(`/candidates/${candidateId}/interactions`).then(r => setInteractions(r.data)).catch(() => {}),
    [candidateId]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.get(`/candidates/${candidateId}`),
      api.get(`/candidates/${candidateId}/interactions`),
      api.get('/candidates/jobs'),
    ]).then(([cRes, iRes, jRes]) => {
      if (cancelled) return;
      setCandidate(cRes.data);
      setInteractions(iRes.data);
      setJobs(jRes.data);
      if (cRes.data.meeting_rsvp_status && cRes.data.meeting_rsvp_status !== 'none') setRsvpStatus(cRes.data.meeting_rsvp_status);
    }).catch(() => { if (!cancelled) onClose(); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId]);

  async function handleStatusConfirm(e) {
    e.preventDefault();
    await api.patch(`/candidates/${candidateId}/status`, { status: pendingStatus, status_reason: statusReason.trim() || null });
    setCandidate(c => ({ ...c, status: pendingStatus, status_reason: statusReason.trim() || null }));
    setPendingStatus(null);
    setStatusReason('');
    setEditingStatus(false);
    setCustomStatus('');
    onUpdated();
  }

  function handleCustomStatusSubmit(e) {
    e.preventDefault();
    if (!customStatus.trim()) return;
    setPendingStatus(customStatus.trim());
    setCustomStatus('');
  }

  async function handleJobChange(job_id) {
    await api.patch(`/candidates/${candidateId}/job`, { job_id: job_id || null });
    setCandidate(c => ({ ...c, job_id: job_id || null }));
    onUpdated();
  }

  async function handleDeleteInteraction(id) {
    await api.delete(`/candidates/interactions/${id}`);
    setInteractions(prev => prev.filter(i => i.id !== id));
  }

  async function handleDeleteCandidate() {
    if (!confirm(`למחוק את ${candidate?.name || 'המועמד'} לצמיתות?`)) return;
    await api.delete(`/candidates/${candidateId}`);
    onClose();
  }

  async function handleCheckRsvp() {
    setCheckingRsvp(true);
    try {
      const { data } = await api.get(`/candidates/${candidateId}/meeting/status`);
      setRsvpStatus(data.status);
    } catch { /* shown as-is */ }
    finally { setCheckingRsvp(false); }
  }

  async function openResume() {
    try {
      const { data } = await api.get(`/candidates/${candidateId}/resume/url`);
      window.open(data.url, '_blank');
    } catch (err) {
      alert(err.response?.data?.error || 'לא ניתן לפתוח את קורות החיים');
    }
  }

  const label = 'text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1.5';

  return (
    <div className="fixed inset-0 z-50 flex" dir="rtl">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="w-full max-w-xl bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-500 px-5 py-4 flex items-center justify-between gap-2">
          <h2 className="text-lg font-black text-white truncate">{loading ? 'טוען...' : candidate?.name || 'מועמד'}</h2>
          <div className="flex items-center gap-2 shrink-0">
            {!loading && (
              <>
                {rsvpStatus && rsvpStatus !== 'none' && (
                  <span className="text-xs bg-white/20 text-white px-2 py-1 rounded-lg font-semibold">
                    {(RSVP_LABELS[rsvpStatus] || RSVP_LABELS.needsAction).icon} {(RSVP_LABELS[rsvpStatus] || RSVP_LABELS.needsAction).text}
                  </span>
                )}
                <button onClick={() => setShowInvite(v => !v)} className="text-xs bg-white/20 hover:bg-white/30 text-white font-bold px-3 py-1.5 rounded-xl transition">
                  📅 הזמן לראיון
                </button>
              </>
            )}
            <button onClick={onClose} className="text-violet-200 hover:text-white text-xl leading-none transition">✕</button>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">טוען...</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-6 bg-gradient-to-b from-violet-50/30 to-white">

            {showInvite && (
              <SendInviteForm
                candidate={candidate}
                onClose={() => setShowInvite(false)}
                onRsvpUpdated={status => setRsvpStatus(status)}
                onCreated={() => { loadInteractions(); setRsvpStatus('needsAction'); onUpdated(); }}
              />
            )}

            {/* Info grid */}
            <div className="grid grid-cols-2 gap-3">
              <InfoRow label="טלפון" value={candidate.phone} icon="📞" isPhone />
              <InfoRow label="אימייל" value={candidate.email} icon="✉️" />
              <InfoRow label="כתובת" value={candidate.address} icon="📍" />
              <InfoRow label="הגיע" value={candidate.arrival_time ? format(new Date(candidate.arrival_time), 'dd/MM/yyyy HH:mm') : null} icon="📅" />
            </div>

            {/* Meeting (if any) */}
            {candidate.calendar_event_id && !showInvite && (
              <div className="flex items-center justify-between bg-white rounded-xl p-3 border border-slate-100 text-sm">
                <span className="text-slate-700 font-medium">
                  🗓️ ראיון {candidate.meeting_start ? format(new Date(candidate.meeting_start), 'dd/MM/yyyy HH:mm') : 'נקבע ביומן'}
                </span>
                <button onClick={handleCheckRsvp} disabled={checkingRsvp} className="text-xs text-violet-600 hover:underline font-semibold disabled:opacity-50">
                  {checkingRsvp ? 'בודק...' : '🔄 בדוק תגובה'}
                </button>
              </div>
            )}

            {/* Job */}
            <div>
              <label className={label}>משרה</label>
              <select
                value={candidate.job_id || ''}
                onChange={e => handleJobChange(e.target.value)}
                className="border-2 border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400 transition w-full"
              >
                <option value="">— ללא משרה —</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
              </select>
            </div>

            {/* Status */}
            <div>
              <label className={label}>סטטוס</label>

              {pendingStatus && (
                <form onSubmit={handleStatusConfirm} className="bg-violet-50 border-2 border-violet-200 rounded-2xl p-4 space-y-2">
                  <p className="text-sm font-semibold text-slate-700">סטטוס: <StatusBadge status={pendingStatus} /></p>
                  <textarea
                    autoFocus
                    value={statusReason}
                    onChange={e => setStatusReason(e.target.value)}
                    placeholder="סיבה (אופציונלי)..."
                    rows={2}
                    className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400 transition resize-none"
                  />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setPendingStatus(null)} className="text-xs text-slate-400 hover:text-slate-600 px-2">ביטול</button>
                    <button type="submit" className="bg-gradient-to-r from-violet-600 to-indigo-500 text-white text-xs font-bold px-4 py-1.5 rounded-xl hover:from-violet-700 hover:to-indigo-600 transition">אשר</button>
                  </div>
                </form>
              )}

              {editingStatus && !pendingStatus ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {PRESET_STATUSES.map(s => (
                      <button key={s} onClick={() => { setPendingStatus(s); setStatusReason(''); }}
                        className="text-sm border-2 border-slate-200 rounded-full px-3 py-1 hover:border-violet-400 hover:text-violet-700 transition font-medium">
                        {s}
                      </button>
                    ))}
                  </div>
                  <form onSubmit={handleCustomStatusSubmit} className="flex gap-2">
                    <input
                      type="text"
                      value={customStatus}
                      onChange={e => setCustomStatus(e.target.value)}
                      placeholder="סטטוס מותאם אישית..."
                      className="flex-1 border-2 border-slate-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-violet-400 transition"
                    />
                    <button type="submit" className="bg-gradient-to-r from-violet-600 to-indigo-500 text-white text-sm px-3 py-1.5 rounded-xl font-bold transition">המשך</button>
                  </form>
                  <button onClick={() => setEditingStatus(false)} className="text-xs text-slate-400 hover:text-slate-600">ביטול</button>
                </div>
              ) : !pendingStatus && (
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge status={candidate.status} />
                  <button onClick={() => setEditingStatus(true)} className="text-xs text-violet-600 hover:underline font-semibold">שנה</button>
                  {candidate.status_reason && <span className="text-xs text-slate-400 bg-slate-100 rounded-lg px-2 py-0.5">{candidate.status_reason}</span>}
                </div>
              )}
            </div>

            {/* Summary */}
            {candidate.ai_summary && (
              <div>
                <label className={label}>✨ סיכום</label>
                <p className="text-sm text-slate-700 bg-gradient-to-br from-violet-50 to-indigo-50 rounded-xl p-4 whitespace-pre-line border border-violet-100">{candidate.ai_summary}</p>
              </div>
            )}

            {/* Resume */}
            {candidate.resume_path && (
              <div>
                <label className={label}>קורות חיים</label>
                <button onClick={openResume} className="inline-flex items-center gap-2 text-sm text-violet-600 hover:text-violet-800 font-semibold bg-violet-50 hover:bg-violet-100 border border-violet-200 px-3 py-1.5 rounded-xl transition">
                  📄 פתח קורות חיים
                </button>
              </div>
            )}

            {/* Interactions */}
            <div>
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">אינטראקציות</label>
                <div className="flex gap-1.5">
                  <button onClick={() => setAddingType('call')} className="text-xs bg-sky-100 hover:bg-sky-200 text-sky-700 px-2.5 py-1 rounded-lg transition font-semibold">📞 שיחה</button>
                  <button onClick={() => setAddingType('meeting')} className="text-xs bg-purple-100 hover:bg-purple-200 text-purple-700 px-2.5 py-1 rounded-lg transition font-semibold">🤝 פגישה</button>
                  <button onClick={() => setAddingType('note')} className="text-xs bg-amber-100 hover:bg-amber-200 text-amber-700 px-2.5 py-1 rounded-lg transition font-semibold">📝 הערה</button>
                </div>
              </div>

              {addingType && (
                <AddInteractionForm
                  candidateId={candidateId}
                  type={addingType}
                  onSaved={() => { setAddingType(null); loadInteractions(); }}
                  onCancel={() => setAddingType(null)}
                />
              )}

              {interactions.length === 0 && !addingType ? (
                <p className="text-sm text-slate-400 italic text-center py-4">אין אינטראקציות עדיין.</p>
              ) : (
                <div className="space-y-2 mt-1">
                  {interactions.map(i => (
                    <InteractionCard key={i.id} interaction={i} onDelete={handleDeleteInteraction}
                      onUpdated={u => setInteractions(prev => prev.map(x => x.id === u.id ? u : x))} />
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-100 text-left">
              <button onClick={handleDeleteCandidate} className="text-xs text-slate-400 hover:text-red-500 transition">🗑️ מחק מועמד</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatPhoneForCall(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('972')) return '+' + digits;
  if (digits.startsWith('0')) return '+972' + digits.slice(1);
  return '+' + digits;
}

function InfoRow({ label, value, icon, isPhone }) {
  const callHref = isPhone && value ? `tel:${formatPhoneForCall(value)}` : null;
  return (
    <div className="bg-white rounded-xl p-3 border border-slate-100 min-w-0">
      <span className="text-xs font-bold text-slate-400 uppercase tracking-wide block mb-0.5">{icon} {label}</span>
      {callHref ? (
        <a href={callHref} className="text-sm text-violet-600 font-bold hover:underline" dir="ltr">{value}</a>
      ) : (
        <span className="text-sm text-slate-700 font-medium break-words">{value || '—'}</span>
      )}
    </div>
  );
}
