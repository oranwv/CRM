import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../api';

// Routes where no logged-in user is present — don't track presence there.
const PUBLIC = ['/login', '/postpone', '/task-action', '/sign'];
const PING_INTERVAL_MS = 2 * 60 * 1000; // heartbeat cadence
const ACTIVE_WINDOW_MS = 5 * 60 * 1000; // only ping if the user interacted within this window

// Sends a lightweight presence heartbeat while the user is actively using the app
// (tab visible + recent interaction), so the server can compute "connected hours".
// A closed laptop / hidden or abandoned tab stops pinging, ending the work session.
export default function usePresencePing() {
  const location = useLocation();
  const lastActiveRef = useRef(Date.now());

  useEffect(() => {
    const bump = () => { lastActiveRef.current = Date.now(); };
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(e => window.addEventListener(e, bump, { passive: true }));
    return () => events.forEach(e => window.removeEventListener(e, bump));
  }, []);

  useEffect(() => {
    const isPublic = PUBLIC.some(p => location.pathname.startsWith(p));
    function maybePing() {
      if (isPublic) return;
      if (!localStorage.getItem('crm_token')) return;
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastActiveRef.current > ACTIVE_WINDOW_MS) return;
      api.post('/presence/ping').catch(() => {});
    }
    maybePing(); // ping immediately on load / route change
    const id = setInterval(maybePing, PING_INTERVAL_MS);
    return () => clearInterval(id);
  }, [location.pathname]);
}
