// In-app calling (Twilio Voice SDK). One Device per logged-in tab: registers with a
// server-issued token so inbound calls can ring here, and connects outbound calls
// from the lead card. UI lives in components/CallBar.jsx.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Device } from '@twilio/voice-sdk';
import api from '../api';

const CallContext = createContext(null);

export function CallProvider({ children }) {
  const [config, setConfig]     = useState({ enabled: false });
  const [ready, setReady]       = useState(false);        // Device registered — can ring
  const [incoming, setIncoming] = useState(null);         // { call, leadName, from }
  const [active, setActive]     = useState(null);         // { call, leadName, leadId, direction, startedAt }
  const [muted, setMuted]       = useState(false);
  const [error, setError]       = useState(null);
  const deviceRef = useRef(null);
  const loggedIn = !!localStorage.getItem('crm_token');

  const loadConfig = useCallback(async () => {
    if (!localStorage.getItem('crm_token')) return;
    try { const r = await api.get('/calls/config'); setConfig(r.data); return r.data; }
    catch { setConfig({ enabled: false }); }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig, loggedIn]);

  // Register the softphone once calling is enabled
  useEffect(() => {
    if (!config.enabled || deviceRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/calls/token');
        if (cancelled) return;
        const device = new Device(data.token, {
          codecPreferences: ['opus', 'pcmu'],
          closeProtection: 'שיחה פעילה — לסגור את הדף?',
          logLevel: 'error',
        });
        device.on('registered', () => setReady(true));
        device.on('unregistered', () => setReady(false));
        device.on('error', e => { console.error('[Calls]', e); setError(e?.message || 'שגיאת טלפוניה'); });
        device.on('tokenWillExpire', async () => {
          try { const r = await api.get('/calls/token'); device.updateToken(r.data.token); } catch {}
        });
        device.on('incoming', call => {
          const p = call.customParameters || new Map();
          const leadName = p.get('leadName') || '';
          const from = (call.parameters?.From || '').replace(/^\+972/, '0');
          setIncoming({ call, leadName, from, callId: p.get('callId') });
          call.on('cancel', () => setIncoming(cur => (cur?.call === call ? null : cur)));
          call.on('disconnect', () => { setIncoming(cur => (cur?.call === call ? null : cur)); setActive(cur => (cur?.call === call ? null : cur)); });
          call.on('reject', () => setIncoming(cur => (cur?.call === call ? null : cur)));
        });
        deviceRef.current = device;
        await device.register();
      } catch (err) {
        console.error('[Calls] device init failed', err);
        setError(err?.response?.data?.error || err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [config.enabled]);

  const attachActive = useCallback((call, meta) => {
    setMuted(false);
    setActive({ call, ...meta, startedAt: null });
    call.on('accept', () => setActive(cur => (cur?.call === call ? { ...cur, startedAt: Date.now() } : cur)));
    call.on('disconnect', () => setActive(cur => (cur?.call === call ? null : cur)));
    call.on('cancel', () => setActive(cur => (cur?.call === call ? null : cur)));
    call.on('error', e => { setError(e?.message || 'שגיאה בשיחה'); setActive(cur => (cur?.call === call ? null : cur)); });
  }, []);

  // Outbound from the browser: the server dials the lead and shows our Israeli number
  const startCall = useCallback(async (lead) => {
    if (!deviceRef.current) throw new Error('הטלפון לא מוכן');
    if (active) throw new Error('יש כבר שיחה פעילה');
    const call = await deviceRef.current.connect({ params: { To: lead.phone, LeadId: String(lead.id) } });
    attachActive(call, { leadName: lead.name, leadId: lead.id, direction: 'outbound' });
    setActive(cur => (cur ? { ...cur, startedAt: Date.now() } : cur)); // ringing counts from now for the UI
    return call;
  }, [active, attachActive]);

  // "Call my mobile first" — Twilio rings the rep's phone, then bridges to the lead
  const bridgeCall = useCallback(async (lead) => {
    const r = await api.post('/calls/bridge', { leadId: lead.id });
    return r.data;
  }, []);

  const acceptIncoming = useCallback(() => {
    if (!incoming) return;
    const { call, leadName, callId } = incoming;
    setIncoming(null);
    attachActive(call, { leadName: leadName || incoming.from, direction: 'inbound', callId });
    call.accept();
  }, [incoming, attachActive]);

  const rejectIncoming = useCallback(() => {
    incoming?.call.reject();
    setIncoming(null);
  }, [incoming]);

  const hangup = useCallback(() => { active?.call.disconnect(); }, [active]);
  const toggleMute = useCallback(() => {
    if (!active) return;
    const next = !muted; active.call.mute(next); setMuted(next);
  }, [active, muted]);

  const setAbroad = useCallback(async (on) => {
    await api.patch('/calls/me', { abroad_mode: on });
    setConfig(c => ({ ...c, abroad_mode: on }));
  }, []);

  const value = {
    enabled: !!config.enabled, ready, config, error, clearError: () => setError(null),
    incoming, active, muted,
    startCall, bridgeCall, acceptIncoming, rejectIncoming, hangup, toggleMute, setAbroad, reloadConfig: loadConfig,
  };
  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCalls() {
  return useContext(CallContext) || { enabled: false, ready: false, config: {}, incoming: null, active: null };
}
