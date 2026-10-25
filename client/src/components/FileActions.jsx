// Phase 62 — the two small buttons next to every file: הורד (saves the file;
// HTML documents as PDF) and שלח (opens the send sheet). Pass a file-box ref
// (client/src/files/fileBox.js) and the file name for the download tooltip.
import { useState } from 'react';
import { downloadFile, openFileSend, isHtmlName } from '../files/fileBox';

export default function FileActions({ fileRef, filename = '', mime = '', size = 'sm', className = '' }) {
  const [busy, setBusy] = useState(false);
  const px = size === 'xs' ? 'w-7 h-7' : 'w-8 h-8';
  const ico = size === 'xs' ? 14 : 16;
  const html = isHtmlName(filename, mime);

  async function onDownload(e) {
    e.stopPropagation(); e.preventDefault();
    if (busy) return;
    setBusy(true);
    try { await downloadFile(fileRef); }
    catch (err) { alert(err.response?.data?.error || 'ההורדה נכשלה'); }
    setBusy(false);
  }
  function onSend(e) {
    e.stopPropagation(); e.preventDefault();
    openFileSend(fileRef, { filename, mime });
  }

  const btn = `${px} shrink-0 inline-grid place-items-center rounded-lg border border-slate-200 bg-white text-violet-600 hover:bg-violet-50 hover:border-violet-300 transition disabled:opacity-50`;
  return (
    <span className={`inline-flex items-center gap-1 shrink-0 ${className}`} data-html2canvas-ignore="true">
      <button type="button" onClick={onDownload} disabled={busy} className={btn} title={html ? 'הורד כ-PDF' : 'הורד'} aria-label="הורד">
        {busy
          ? <span className="w-3 h-3 rounded-full border-2 border-violet-300 border-t-violet-600 animate-spin" />
          : <svg width={ico} height={ico} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>}
      </button>
      <button type="button" onClick={onSend} className={btn} title="שלח" aria-label="שלח">
        <svg width={ico} height={ico} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/></svg>
      </button>
    </span>
  );
}
