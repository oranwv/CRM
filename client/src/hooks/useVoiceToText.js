// Record from the microphone and get the Hebrew transcript back (POST /api/ai/transcribe).
// Same recording approach as the lead card's VoiceRecorder, as a hook so any input can use it.
//   const voice = useVoiceToText(text => ...);
//   voice.state: 'idle' | 'recording' | 'transcribing' · voice.elapsed (sec) · voice.error
//   voice.toggle() starts, or stops and transcribes
import { useEffect, useRef, useState } from 'react';
import api from '../api';

export default function useVoiceToText(onText) {
  const [state, setState] = useState('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const recRef = useRef(null), chunksRef = useRef([]), streamRef = useRef(null), timerRef = useRef(null);
  const secondsRef = useRef(0), startedAtRef = useRef(0);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const pickMime = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
    .find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';

  async function transcribe(mimeType) {
    try {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      if (!blob.size) return;
      const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
      const fd = new FormData();
      fd.append('audio', blob, `rec.${ext}`);
      fd.append('context', 'dictation'); // stronger model + offer/contract vocabulary on the server
      fd.append('seconds', String(secondsRef.current));
      const { data } = await api.post('/ai/transcribe', fd);
      if (data.text?.trim()) onTextRef.current?.(data.text.trim());
      else setError('לא זוהה טקסט בהקלטה');
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה בתמלול');
    } finally {
      setState('idle');
    }
  }

  async function start() {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { setError('הדפדפן לא תומך בהקלטה'); return; }
    try {
      // mono speech, cleaned up by the browser — noticeably better transcripts on phones
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      streamRef.current = stream;
      const mimeType = pickMime();
      const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64000 });
      startedAtRef.current = Date.now();
      chunksRef.current = [];
      rec.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => transcribe(rec.mimeType || mimeType || 'audio/webm');
      recRef.current = rec;
      // 1-second slices: the audio is collected as it is recorded, so nothing is lost if the
      // browser is slow to hand over one big final chunk (long recordings came back cut short).
      rec.start(1000);
      setState('recording');
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    } catch (err) {
      setError(err.name === 'NotAllowedError' ? 'הגישה למיקרופון נדחתה' : 'שגיאה בפתיחת המיקרופון');
    }
  }

  function stop() {
    secondsRef.current = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
    clearInterval(timerRef.current);
    try { recRef.current?.stop(); } catch {}
    streamRef.current?.getTracks().forEach(t => t.stop());
    setState('transcribing');
  }

  useEffect(() => () => { clearInterval(timerRef.current); streamRef.current?.getTracks().forEach(t => t.stop()); }, []);

  const toggle = () => { if (state === 'idle') start(); else if (state === 'recording') stop(); };
  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  return { state, elapsed, mmss, error, toggle };
}
