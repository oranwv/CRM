// Phase 62 — in-app file viewer + send sheet, mounted once in App.jsx.
// Anything in the CRM opens a file with openFileViewer(ref) / openFileSend(ref)
// (client/src/files/fileBox.js); this host renders the full-screen viewer with
// its own ⋮ menu (הורד / שלח / פתח בדפדפן) instead of leaving the app for a
// Chrome tab, and the send sheet (to the customer via Sharabiya's WhatsApp or
// email, or the phone's share sheet to anyone).
import { useEffect, useRef, useState } from 'react';
import api from '../api';
import { isDesktop } from '../utils/device';
import { downloadFile, shareFile, canShareFiles, isHtmlName } from '../files/fileBox';

const Icon = {
  close:  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>,
  dots:   <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>,
  down:   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>,
  send:   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/></svg>,
  ext:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>,
  share:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3M7 8l5-5 5 5M5 13v7h14v-7"/></svg>,
  mail:   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>,
  wa:     <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.8-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 2.9 2.9 0 0 0-.9 2.2 5 5 0 0 0 1.1 2.7 11.5 11.5 0 0 0 4.4 3.9c1.6.7 2.3.8 3.1.6a2.6 2.6 0 0 0 1.7-1.2 2.1 2.1 0 0 0 .2-1.2c-.1-.1-.3-.2-.5-.3z"/></svg>,
};

const fmtName = (s = '') => s.replace(/\.(html?|HTML?)$/, '');

/* ─────────────── Viewer ─────────────── */
function Viewer({ fileRef, hint, onClose, onSend }) {
  const [info, setInfo]   = useState(null);
  const [url, setUrl]     = useState(null);
  const [err, setErr]     = useState('');
  const [menu, setMenu]   = useState(false);
  const [busy, setBusy]   = useState('');
  const desktop = isDesktop();

  useEffect(() => {
    let alive = true;
    setInfo(null); setUrl(null); setErr(''); setMenu(false);
    (async () => {
      try {
        const [i, u] = await Promise.all([
          api.get('/filebox/info', { params: { ref: fileRef } }),
          api.get('/filebox/url',  { params: { ref: fileRef } }),
        ]);
        if (!alive) return;
        setInfo(i.data); setUrl(u.data.url);
      } catch (e) {
        if (alive) setErr(e.response?.data?.error || 'לא ניתן לפתוח את הקובץ');
      }
    })();
    return () => { alive = false; };
  }, [fileRef]);

  // Back button / Escape closes the viewer (phones: the system back gesture)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    try { history.pushState({ crmFileViewer: true }, ''); } catch {}
    const onPop = () => onClose(true);
    window.addEventListener('popstate', onPop);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('popstate', onPop); };
  }, []);

  const filename = info?.filename || hint?.filename || '';
  const mime = info?.mime || hint?.mime || '';
  const isHtml = info ? info.isHtml : isHtmlName(filename, mime);
  const isPdf = /pdf/i.test(mime) || /\.pdf$/i.test(filename);
  const isImage = /^image\//i.test(mime) || /\.(jpe?g|png|gif|webp|svg)$/i.test(filename);
  const isAudio = /^audio\//i.test(mime) || /\.(mp3|m4a|ogg|oga|opus|wav|aac|amr)$/i.test(filename);

  async function doDownload() {
    setMenu(false); setBusy('download');
    try { await downloadFile(fileRef); } catch (e) { alert(e.response?.data?.error || 'ההורדה נכשלה'); }
    setBusy('');
  }
  function openInBrowser() { setMenu(false); if (url) window.open(url, '_blank', 'noopener'); }

  let body;
  if (err) body = <p className="text-red-500 font-bold text-center p-8">{err}</p>;
  else if (!url) body = <p className="text-slate-400 text-center p-8">טוען…</p>;
  else if (isImage) body = <img src={url} alt={filename} className="max-w-full max-h-full object-contain mx-auto" />;
  else if (isAudio) body = <audio controls src={url} className="w-full max-w-md mx-auto mt-10" />;
  else if (isHtml || (isPdf && desktop)) body = <iframe title={filename} src={url} className="w-full h-full bg-white border-0" />;
  else body = <iframe title={filename} src={`https://docs.google.com/viewer?embedded=true&url=${encodeURIComponent(url)}`} className="w-full h-full bg-white border-0" />;

  return (
    <div className="fixed inset-0 z-[120] bg-slate-900 flex flex-col" dir="rtl">
      <div className="flex items-center gap-2 px-2 py-2 bg-white border-b border-slate-200 shrink-0" style={{ paddingTop: 'max(8px, env(safe-area-inset-top, 0px))' }}>
        <button type="button" onClick={() => onClose()} className="p-2 rounded-xl text-slate-600 hover:bg-slate-100" aria-label="סגור">{Icon.close}</button>
        <p className="flex-1 min-w-0 font-bold text-slate-800 truncate text-right">{fmtName(filename) || 'קובץ'}</p>
        <div className="relative">
          <button type="button" onClick={() => setMenu(m => !m)} className="p-2 rounded-xl text-slate-600 hover:bg-slate-100" aria-label="אפשרויות">{Icon.dots}</button>
          {menu && (
            <>
              <div className="fixed inset-0 z-[1]" onClick={() => setMenu(false)} />
              <div className="absolute left-0 top-full mt-1 z-[2] w-56 bg-white rounded-2xl shadow-xl border border-slate-200 py-1.5 text-sm font-bold text-slate-700">
                <button type="button" onClick={doDownload} disabled={!!busy} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-violet-50 text-right">
                  <span className="text-violet-600">{Icon.down}</span>{busy === 'download' ? 'מוריד…' : (isHtml ? 'הורד כ-PDF' : 'הורד')}
                </button>
                <button type="button" onClick={() => { setMenu(false); onSend(); }} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-violet-50 text-right">
                  <span className="text-violet-600">{Icon.send}</span>שלח
                </button>
                <button type="button" onClick={openInBrowser} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-violet-50 text-right">
                  <span className="text-violet-600">{Icon.ext}</span>פתח בדפדפן
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto flex items-stretch justify-center bg-slate-100">{body}</div>
    </div>
  );
}

/* ─────────────── Send sheet ─────────────── */
function Chip({ on, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-xs font-bold px-3 py-1.5 rounded-full border transition ${on ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}>
      {children}
    </button>
  );
}

function SendSheet({ fileRef, hint, onClose }) {
  const [info, setInfo]       = useState(null);
  const [err, setErr]         = useState('');
  const [busy, setBusy]       = useState('');
  const [done, setDone]       = useState('');
  const [phones, setPhones]   = useState([]);   // selected lead/supplier phones
  const [emails, setEmails]   = useState([]);
  const [otherPhone, setOtherPhone] = useState('');
  const [otherEmail, setOtherEmail] = useState('');
  const [message, setMessage] = useState('');
  const [subject, setSubject] = useState('');
  const shareOk = canShareFiles();

  useEffect(() => {
    let alive = true;
    api.get('/filebox/info', { params: { ref: fileRef } })
      .then(r => { if (!alive) return; setInfo(r.data); setSubject(fmtName(r.data.filename)); })
      .catch(e => alive && setErr(e.response?.data?.error || 'לא ניתן לטעון את הקובץ'));
    return () => { alive = false; };
  }, [fileRef]);

  const filename = info?.filename || hint?.filename || 'קובץ';
  const contactPhones = info?.contacts?.phones || [];
  const contactEmails = info?.contacts?.emails || [];
  const toggle = (list, set, v) => set(list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  async function doShare() {
    setBusy('share'); setErr('');
    try {
      const shown = await shareFile(fileRef, fmtName(filename));
      if (shown) onClose();
    } catch (e) { setErr(e.response?.data?.error || 'השיתוף נכשל'); }
    setBusy('');
  }
  async function doDownload() {
    setBusy('download'); setErr('');
    try { await downloadFile(fileRef); } catch (e) { setErr(e.response?.data?.error || 'ההורדה נכשלה'); }
    setBusy('');
  }
  async function send(via) {
    const to = via === 'whatsapp' ? [...phones, otherPhone.trim()].filter(Boolean) : [...emails, otherEmail.trim()].filter(Boolean);
    if (!to.length) { setErr(via === 'whatsapp' ? 'בחר מספר או הקלד מספר' : 'בחר מייל או הקלד כתובת'); return; }
    setBusy(via); setErr('');
    try {
      const r = await api.post('/filebox/send', { ref: fileRef, via, to, message, subject, format: 'pdf' });
      const failed = r.data?.failed || [];
      setDone(via === 'whatsapp'
        ? `נשלח בוואטסאפ ל-${r.data.sentTo.length} נמענים${failed.length ? ` (נכשל: ${failed.join(', ')})` : ''}`
        : `נשלח במייל ל-${to.join(', ')}`);
      setTimeout(onClose, 1400);
    } catch (e) { setErr(e.response?.data?.error || 'השליחה נכשלה'); }
    setBusy('');
  }

  return (
    <div className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center" dir="rtl">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] overflow-y-auto"
        style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom, 0px))' }}>
        <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mt-3 sm:hidden" />
        <div className="px-5 pt-4 pb-2">
          <p className="font-black text-slate-800 text-lg leading-tight">שליחת "{fmtName(filename)}"</p>
          <p className="text-xs text-slate-400 mt-0.5">{info?.isHtml ? 'יישלח כ-PDF, בדיוק כמו שהוא נראה במסך' : 'יישלח כמו שהוא'}</p>
        </div>

        {done ? (
          <p className="mx-5 my-6 text-center font-bold text-emerald-700 bg-emerald-50 rounded-2xl py-4">✓ {done}</p>
        ) : (
          <div className="px-5 space-y-4">
            {/* ── To the customer / supplier ── */}
            {(contactPhones.length > 0 || contactEmails.length > 0) && (
              <div className="rounded-2xl border border-slate-200 p-3 space-y-3">
                <p className="text-sm font-black text-slate-700">{info?.kind === 'supplier' ? 'לספק' : 'ללקוח'}{info?.contacts?.name ? ` · ${info.contacts.name}` : ''}</p>
                {contactPhones.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-slate-500 flex items-center gap-1.5"><span className="text-emerald-600">{Icon.wa}</span>וואטסאפ של שרביה</p>
                    <div className="flex flex-wrap gap-1.5">
                      {contactPhones.map(p => (
                        <Chip key={p.value} on={phones.includes(p.value)} onClick={() => toggle(phones, setPhones, p.value)}>
                          {p.label ? `${p.label} · ` : ''}{p.value}
                        </Chip>
                      ))}
                    </div>
                  </div>
                )}
                {contactEmails.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-slate-500 flex items-center gap-1.5"><span className="text-blue-600">{Icon.mail}</span>מייל של שרביה</p>
                    <div className="flex flex-wrap gap-1.5">
                      {contactEmails.map(e => (
                        <Chip key={e.value} on={emails.includes(e.value)} onClick={() => toggle(emails, setEmails, e.value)}>
                          {e.label ? `${e.label} · ` : ''}{e.value}
                        </Chip>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Anyone ── */}
            <div className="rounded-2xl border border-slate-200 p-3 space-y-3">
              <p className="text-sm font-black text-slate-700">לכל אחד</p>
              {shareOk ? (
                <button type="button" onClick={doShare} disabled={!!busy}
                  className="w-full flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-right">
                  <span className="text-violet-700">{Icon.share}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-bold text-slate-800">{busy === 'share' ? 'מכין את הקובץ…' : 'שתף בוואטסאפ / באפליקציה אחרת'}</span>
                    <span className="block text-[11px] text-slate-500">נפתח חלון השיתוף של הטלפון עם הקובץ מצורף — בוחרים כל איש קשר</span>
                  </span>
                </button>
              ) : (
                <button type="button" onClick={doDownload} disabled={!!busy}
                  className="w-full flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-right">
                  <span className="text-violet-700">{Icon.down}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-bold text-slate-800">{busy === 'download' ? 'מוריד…' : 'הורד למחשב'}</span>
                    <span className="block text-[11px] text-slate-500">ואז צרף בוואטסאפ ווב / במייל</span>
                  </span>
                </button>
              )}
              <div className="grid grid-cols-1 gap-2">
                <input id="filebox-other-phone" value={otherPhone} onChange={e => setOtherPhone(e.target.value)} inputMode="tel" dir="ltr"
                  placeholder="מספר וואטסאפ אחר (מהמספר של שרביה)" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-right placeholder:text-right focus:outline-none focus:border-violet-400" />
                <input id="filebox-other-email" value={otherEmail} onChange={e => setOtherEmail(e.target.value)} inputMode="email" dir="ltr"
                  placeholder="מייל אחר (מהמייל של שרביה)" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-right placeholder:text-right focus:outline-none focus:border-violet-400" />
              </div>
            </div>

            {/* ── Message ── */}
            {(phones.length > 0 || emails.length > 0 || otherPhone.trim() || otherEmail.trim()) && (
              <div className="space-y-2">
                {(emails.length > 0 || otherEmail.trim()) && (
                  <input id="filebox-subject" value={subject} onChange={e => setSubject(e.target.value)} placeholder="נושא המייל"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400" />
                )}
                <textarea id="filebox-message" value={message} onChange={e => setMessage(e.target.value)} rows={2} placeholder="הודעה (לא חובה)"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:border-violet-400" />
              </div>
            )}

            {err && <p className="text-sm font-bold text-red-500">{err}</p>}

            <div className="flex gap-2 pb-2">
              {(phones.length > 0 || otherPhone.trim()) && (
                <button type="button" onClick={() => send('whatsapp')} disabled={!!busy}
                  className="flex-1 bg-emerald-600 text-white font-black py-2.5 rounded-xl disabled:opacity-60">
                  {busy === 'whatsapp' ? 'שולח…' : 'שלח בוואטסאפ'}
                </button>
              )}
              {(emails.length > 0 || otherEmail.trim()) && (
                <button type="button" onClick={() => send('email')} disabled={!!busy}
                  className="flex-1 bg-blue-600 text-white font-black py-2.5 rounded-xl disabled:opacity-60">
                  {busy === 'email' ? 'שולח…' : 'שלח במייל'}
                </button>
              )}
              <button type="button" onClick={onClose} className="border-2 border-slate-200 text-slate-500 font-bold py-2.5 px-4 rounded-xl">סגור</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────── Host ─────────────── */
export default function FileBoxHost() {
  const [viewer, setViewer] = useState(null); // { ref, hint }
  const [send, setSend]     = useState(null); // { ref, hint }
  const closingFromPop = useRef(false);

  useEffect(() => {
    const onOpen = (e) => setViewer({ ref: e.detail.ref, hint: e.detail.hint || {} });
    const onSend = (e) => setSend({ ref: e.detail.ref, hint: e.detail.hint || {} });
    window.addEventListener('crm:file-open', onOpen);
    window.addEventListener('crm:file-send', onSend);
    return () => { window.removeEventListener('crm:file-open', onOpen); window.removeEventListener('crm:file-send', onSend); };
  }, []);

  function closeViewer(fromPop) {
    setViewer(null);
    // We pushed a history entry when opening; drop it unless the back button already did
    if (!fromPop && !closingFromPop.current) { try { if (history.state?.crmFileViewer) history.back(); } catch {} }
  }

  return (
    <>
      {viewer && <Viewer fileRef={viewer.ref} hint={viewer.hint} onClose={closeViewer} onSend={() => setSend({ ref: viewer.ref, hint: viewer.hint })} />}
      {send && <SendSheet fileRef={send.ref} hint={send.hint} onClose={() => setSend(null)} />}
    </>
  );
}
