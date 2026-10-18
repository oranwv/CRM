// Small "צפו" (eye) / "חתמו" (signature) indicators shown beside the "חוזה נשלח"
// stage badge. Each icon appears only once it happened: the customer opened the
// signing page (contract_views) / signed the contract. Hover shows when + how often.
const fmt = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
         d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
};

export default function ContractTrackIcons({ lead, size = 16 }) {
  const views = Number(lead?.contract_views) || 0;
  const signedAt = lead?.contract_signed_at;
  if (!views && !signedAt) return null;
  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      {views > 0 && (
        <span className="text-indigo-500"
          title={`נצפה ${views === 1 ? 'פעם אחת' : `${views} פעמים`} · אחרונה ${fmt(lead.contract_last_viewed_at)}`}>
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="צפו">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </span>
      )}
      {signedAt && (
        <span className="text-emerald-600" title={`נחתם ${fmt(signedAt)}`}>
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="חתמו">
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" />
            <path d="M3 22c3-1.5 5-1.5 7 0s4 1.5 7 0 3-1 4-1" />
          </svg>
        </span>
      )}
    </span>
  );
}
