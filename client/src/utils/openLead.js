// Phase 63 — open a lead card from anywhere and remember where the user came from, so the
// card's × (and the phone's back gesture) return to that screen instead of staying on the
// leads list. `navigate` is react-router's navigate; `mode` the current app mode (restored on return).
export function openLead(navigate, leadId, mode) {
  const here = window.location.pathname + window.location.search;
  let currentMode = mode || null;
  if (!currentMode) { try { currentMode = localStorage.getItem('crm_mode') || null; } catch {} }
  const state = here.startsWith('/?') || here === '/' ? undefined : { returnTo: here, returnMode: currentMode };
  navigate(`/?lead=${leadId}`, state ? { state } : undefined);
}
