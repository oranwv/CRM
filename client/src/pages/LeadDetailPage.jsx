import { useParams, useNavigate } from 'react-router-dom';
import LeadCard from '../components/LeadCard';

// Standalone full-page lead view, used when a lead is opened in its own browser tab
// (desktop). LeadCard already renders as a fixed full-screen overlay.
export default function LeadDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  function handleClose() {
    // The tab was opened via window.open → close it and return to the original tab.
    window.close();
    // Fallback when the browser refuses to close (e.g. URL was opened directly).
    setTimeout(() => { if (!window.closed) navigate('/'); }, 100);
  }

  return <LeadCard leadId={Number(id)} onClose={handleClose} onUpdated={() => {}} />;
}
