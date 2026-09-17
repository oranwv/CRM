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
  const [outputs, setOutputs]   = useState({ supported: false, devices: [], activeId: null }); // speakers/headset picker
  const [micLost, setMicLost]   = useState(false);        // OS suspended our microphone (phone went to another app)
  const deviceRef = useRef(null);
  const refreshOutputsRef = useRef(() => {});
  const refreshTokenRef = useRef(async () => false);
  const tokenAtRef = useRef(0);
  const activeRef = useRef(null);
  const incomingRef = useRef(null);
  const loggedIn = !!localStorage.getItem('crm_token');

  const loadConfig = useCallback(async () => {
    if (!localStorage.getItem('crm_token')) return;
    try { const r = await api.get('/calls/config'); setConfig(r.data); return r.data; }
    catch { setConfig({ enabled: false }); }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig, loggedIn]);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { incomingRef.current = incoming; }, [incoming]);

  // Refresh the access token well before it expires, and whenever the tab comes back to the
  // foreground with a stale one (phones freeze timers while the screen is off).
  useEffect(() => {
    if (!config.enabled) return;
    const STALE = 3 * 60 * 60 * 1000;  // token lives 4h server-side
    const maybeRefresh = () => {
      if (!deviceRef.current || !tokenAtRef.current) return;
      if (Date.now() - tokenAtRef.current > STALE) refreshTokenRef.current();
    };
    const t = setInterval(maybeRefresh, 5 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') maybeRefresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [config.enabled]);

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
        // Access tokens last an hour. A phone that slept, a backgrounded tab or a dropped
        // network can miss the refresh, and Twilio then raises 20104/20101 repeatedly — which
        // is our problem to fix silently, not a message for the user.
        const refreshToken = async (attempt = 0) => {
          if (cancelled) return false;
          try {
            const r = await api.get('/calls/token');
            device.updateToken(r.data.token);
            tokenAtRef.current = Date.now();
            return true;
          } catch (err) {
            if (attempt < 3) {
              setTimeout(() => refreshToken(attempt + 1), 3000 * (attempt + 1));
            } else {
              console.warn('[Calls] token refresh failed', err?.message);
            }
            return false;
          }
        };
        refreshTokenRef.current = refreshToken;

        const TOKEN_ERRORS = [20101, 20103, 20104, 31204, 31205];
        device.on('error', e => {
          const code = e?.code;
          if (TOKEN_ERRORS.includes(code)) { console.info('[Calls] token expired — refreshing'); refreshToken(); return; }
          console.error('[Calls]', e);
          // Only surface errors the user can act on: something went wrong during a live call.
          if (activeRef.current || incomingRef.current) setError(e?.message || 'שגיאת טלפוניה');
        });
        device.on('tokenWillExpire', () => refreshToken());
        device.on('incoming', call => {
          const p = call.customParameters || new Map();
          const leadName = p.get('leadName') || '';
          const from = (call.parameters?.From || '').replace(/^\+972/, '0');
          setIncoming({ call, leadName, from, callId: p.get('callId') });
          call.on('cancel', () => setIncoming(cur => (cur?.call === call ? null : cur)));
          call.on('disconnect', () => { setIncoming(cur => (cur?.call === call ? null : cur)); setActive(cur => (cur?.call === call ? null : cur)); });
          call.on('reject', () => setIncoming(cur => (cur?.call === call ? null : cur)));
        });
        // Output device picker (Chrome desktop / Android; iOS Safari has no setSinkId)
        const refreshOutputs = () => {
          const a = device.audio;
          if (!a?.isOutputSelectionSupported) return setOutputs({ supported: false, devices: [], activeId: null });
          const devices = [...a.availableOutputDevices.values()].map(d => ({ id: d.deviceId, label: d.label || 'רמקול' }));
          const active = [...a.speakerDevices.get()][0]?.deviceId || devices[0]?.id || null;
          setOutputs({ supported: true, devices, activeId: active });
        };
        device.audio?.on('deviceChange', refreshOutputs);
        refreshOutputs();
        // Labels/devices only appear after the mic permission is granted (i.e. once a call
        // starts) — re-read a few times after each call begins.
        refreshOutputsRef.current = refreshOutputs;
        deviceRef.current = device;
        tokenAtRef.current = Date.now();
        await device.register();
      } catch (err) {
        console.error('[Calls] device init failed', err);
        setError(err?.response?.data?.error || err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [config.enabled]);

  // Phones (Android Chrome especially) suspend the mic track when the tab goes to the
  // background — the other side stops hearing us and nothing in the UI says so. Watch the
  // local track; when it is muted by the OS, or when we come back to the foreground, re-acquire
  // the microphone through the SDK so the call continues.
  const reacquireMic = useCallback(async (call) => {
    const a = deviceRef.current?.audio;
    if (!a || !call) return;
    try {
      const current = a.inputDevice?.deviceId || 'default';
      await a.setInputDevice(current);
      if (call.isMuted && call.isMuted()) call.mute(false);
      setMicLost(false);
    } catch (err) { console.warn('[Calls] mic re-acquire failed:', err.message); }
  }, []);

  const watchMic = useCallback((call) => {
    const check = () => {
      const track = call.getLocalStream?.()?.getAudioTracks()[0];
      const lost = !track || track.readyState === 'ended' || track.muted;
      setMicLost(lost);
      if (lost) reacquireMic(call);
    };
    const track = call.getLocalStream?.()?.getAudioTracks()[0];
    if (track) {
      track.addEventListener('mute', check);
      track.addEventListener('unmute', () => setMicLost(false));
      track.addEventListener('ended', check);
    }
    const onVisible = () => { if (document.visibilityState === 'visible') setTimeout(check, 300); };
    document.addEventListener('visibilitychange', onVisible);
    const poll = setInterval(check, 4000);
    call.on('disconnect', () => { clearInterval(poll); document.removeEventListener('visibilitychange', onVisible); setMicLost(false); });
  }, [reacquireMic]);

  const attachActive = useCallback((call, meta) => {
    setMuted(false);
    setActive({ call, ...meta, startedAt: null });
    call.on('accept', () => {
      setActive(cur => (cur?.call === call ? { ...cur, startedAt: Date.now() } : cur));
      [500, 2000, 5000].forEach(ms => setTimeout(() => refreshOutputsRef.current(), ms));
      watchMic(call);
    });
    call.on('disconnect', () => setActive(cur => (cur?.call === call ? null : cur)));
    call.on('cancel', () => setActive(cur => (cur?.call === call ? null : cur)));
    call.on('error', e => { setError(e?.message || 'שגיאה בשיחה'); setActive(cur => (cur?.call === call ? null : cur)); });
  }, []);

  // Outbound from the browser: the server dials the lead and shows our Israeli number
  const startCall = useCallback(async (lead) => {
    if (!deviceRef.current) throw new Error('הטלפון לא מוכן');
    if (active) throw new Error('יש כבר שיחה פעילה');
    if (Date.now() - tokenAtRef.current > 3 * 60 * 60 * 1000) await refreshTokenRef.current();
    const call = await deviceRef.current.connect({ params: { To: lead.phone, LeadId: String(lead.id) } });
    attachActive(call, { leadName: lead.name, leadId: lead.id, direction: 'outbound' });
    setActive(cur => (cur ? { ...cur, startedAt: Date.now() } : cur)); // ringing counts from now for the UI
    return call;
  }, [active, attachActive]);

  // "Call my mobile first" — Twilio rings the rep's phone, then bridges to the lead
  const bridgeCall = useCallback(async (lead) => {
    const r = await api.post('/calls/bridge', { leadId: lead.id, phone: lead.phone });
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

  // Route call audio (and the ringtone) to a specific speaker / headset
  const setOutput = useCallback(async (deviceId) => {
    const a = deviceRef.current?.audio;
    if (!a?.isOutputSelectionSupported) return;
    try {
      await a.speakerDevices.set(deviceId);
      await a.ringtoneDevices.set(deviceId).catch(() => {});
      setOutputs(o => ({ ...o, activeId: deviceId }));
    } catch (err) { setError('לא ניתן להחליף רמקול: ' + (err.message || '')); }
  }, []);

  const setAbroad = useCallback(async (on) => {
    await api.patch('/calls/me', { abroad_mode: on });
    setConfig(c => ({ ...c, abroad_mode: on }));
  }, []);

  const value = {
    enabled: !!config.enabled, ready, config, error, clearError: () => setError(null),
    incoming, active, muted, outputs, setOutput, micLost, fixMic: () => active && reacquireMic(active.call),
    startCall, bridgeCall, acceptIncoming, rejectIncoming, hangup, toggleMute, setAbroad, reloadConfig: loadConfig,
  };
  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCalls() {
  return useContext(CallContext) || { enabled: false, ready: false, config: {}, incoming: null, active: null };
}
