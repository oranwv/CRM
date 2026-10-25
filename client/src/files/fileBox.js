// Client side of the "file box" (Phase 62): one way to view, download and send
// any file the CRM shows, wherever it lives. A file is addressed by a ref —
// lead:<fileId> | supplier:<supplierId>:<fileId> | ops:<activityLogId> — that
// the server resolves (see server/services/fileBox.js).
import api from '../api';

export const leadFileRef     = (fileId) => `lead:${fileId}`;
export const supplierFileRef = (supplierId, fileId) => `supplier:${supplierId}:${fileId}`;
export const opsFileRef      = (activityLogId) => `ops:${activityLogId}`;

export function isHtmlName(filename = '', mime = '') {
  return /html/i.test(mime || '') || /\.html?$/i.test(filename || '');
}

// Open the in-app viewer (FileBoxHost listens for this event).
export function openFileViewer(ref, hint = {}) {
  window.dispatchEvent(new CustomEvent('crm:file-open', { detail: { ref, hint } }));
}

// Open the send sheet directly (without the viewer).
export function openFileSend(ref, hint = {}) {
  window.dispatchEvent(new CustomEvent('crm:file-send', { detail: { ref, hint } }));
}

// Fetch the file as a Blob. HTML documents (designed menus etc.) come back as a
// PDF that looks like the page; everything else as stored.
export async function fetchFileBlob(ref) {
  const res = await api.get('/filebox/download', { params: { ref, format: 'pdf' }, responseType: 'blob' });
  const cd = res.headers?.['content-disposition'] || '';
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const filename = m ? decodeURIComponent(m[1]) : (/filename="([^"]+)"/.exec(cd)?.[1] || 'file');
  return { blob: res.data, filename, mime: res.data.type || res.headers?.['content-type'] || 'application/octet-stream' };
}

// Save the file to the device (PDF for HTML documents).
export async function downloadFile(ref) {
  const { blob, filename } = await fetchFileBlob(ref);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return filename;
}

// True when this browser can hand a file to the system share sheet (phones, mostly).
export function canShareFiles() {
  try {
    if (typeof navigator === 'undefined' || !navigator.share || !navigator.canShare) return false;
    const probe = new File(['x'], 'probe.pdf', { type: 'application/pdf' });
    return navigator.canShare({ files: [probe] });
  } catch { return false; }
}

// Open the system share sheet with the file attached (WhatsApp → any contact, mail, …).
// Resolves true when the sheet was shown, false when the user dismissed it.
export async function shareFile(ref, title) {
  const { blob, filename, mime } = await fetchFileBlob(ref);
  const file = new File([blob], filename, { type: mime });
  try {
    await navigator.share({ files: [file], title: title || filename });
    return true;
  } catch (err) {
    if (err?.name === 'AbortError') return false;
    throw err;
  }
}
