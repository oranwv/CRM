import { useState, useEffect } from 'react';
import api from '../api';

export default function DriveFilePicker({ onSelect, onClose }) {
  const [folders, setFolders] = useState([]);
  const [activeFolder, setActiveFolder] = useState(null);
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [previewFile, setPreviewFile] = useState(null);

  useEffect(() => {
    setLoading(true);
    api.get('/drive/folders')
      .then(r => setFolders(r.data))
      .catch(err => setError(err.response?.data?.error || err.message))
      .finally(() => setLoading(false));
  }, []);

  async function openFolder(folder) {
    setActiveFolder(folder);
    setFiles([]);
    setError('');
    setPreviewFile(null);
    setLoading(true);
    try {
      const { data } = await api.get(`/drive/folders/${folder.id}/files`);
      setFiles(data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleFile(file) {
    setSelected(prev => {
      const next = { ...prev };
      if (next[file.id]) delete next[file.id];
      else next[file.id] = { type: 'drive', fileId: file.id, name: file.name, mimeType: file.mimeType };
      return next;
    });
  }

  function handleConfirm() {
    const picks = Object.values(selected);
    if (picks.length) onSelect(picks);
    onClose();
  }

  const selectedCount = Object.keys(selected).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col" style={{ maxHeight: '80vh' }} onClick={e => e.stopPropagation()} dir="rtl">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          {previewFile ? (
            <button onClick={() => setPreviewFile(null)} className="text-slate-500 hover:text-violet-600 text-sm font-bold">
              &rarr; חזרה
            </button>
          ) : activeFolder ? (
            <button onClick={() => { setActiveFolder(null); setFiles([]); setError(''); }} className="text-slate-500 hover:text-violet-600 text-sm font-bold">
              &rarr; חזרה
            </button>
          ) : (
            <span className="text-sm font-black text-slate-800">בחר מ-Google Drive</span>
          )}
          {previewFile
            ? <span className="text-sm font-black text-slate-800 truncate mx-2">{previewFile.name}</span>
            : activeFolder
              ? <span className="text-sm font-black text-slate-800 truncate mx-2">{activeFolder.name}</span>
              : null
          }
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
        </div>

        {/* Preview panel — uses cached Supabase URL directly */}
        {previewFile && previewFile.previewUrl && (
          <div className="flex-1 flex items-center justify-center min-h-0">
            {previewFile.mimeType?.startsWith('image/')
              ? <img src={previewFile.previewUrl} alt={previewFile.name} className="max-w-full max-h-full object-contain p-2" />
              : (previewFile.mimeType === 'application/pdf' || previewFile.name?.toLowerCase().endsWith('.pdf'))
                ? <iframe
                    src={previewFile.previewUrl}
                    className="w-full border-0"
                    style={{ minHeight: '50vh', height: '60vh' }}
                    title={previewFile.name}
                  />
                : <iframe
                    src={`https://docs.google.com/viewer?url=${encodeURIComponent(previewFile.previewUrl)}&embedded=true`}
                    className="w-full border-0"
                    style={{ minHeight: '50vh', height: '60vh' }}
                    title={previewFile.name}
                  />
            }
          </div>
        )}

        {/* Body — folder/file list */}
        {!previewFile && (
          <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
            {loading && <p className="text-xs text-slate-400 text-center py-6 animate-pulse">טוען...</p>}
            {error && <p className="text-xs text-red-500 text-center py-4">{error}</p>}

            {!loading && !error && !activeFolder && (
              <>
                {folders.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-6">אין תיקיות מוגדרות. הגדר תיקיות בהגדרות המערכת.</p>
                )}
                {folders.map(f => (
                  <button key={f.id} onClick={() => openFolder(f)}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-violet-50 text-right transition">
                    <span className="text-2xl">📁</span>
                    <span className="text-sm font-bold text-slate-700">{f.name}</span>
                  </button>
                ))}
              </>
            )}

            {!loading && !error && activeFolder && (
              <>
                {files.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-6">
                    {loading ? 'טוען...' : 'התיקיה ריקה — קבצים יסונכרנו תוך 5 דקות'}
                  </p>
                )}
                {files.map(f => (
                  <div key={f.id}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-right mb-1 border ${selected[f.id] ? 'bg-violet-100 border-violet-300' : 'border-transparent hover:bg-slate-50'}`}>
                    <button
                      onClick={() => toggleFile(f)}
                      className={`w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center text-xs transition ${selected[f.id] ? 'bg-violet-600 border-violet-600 text-white' : 'border-slate-300 hover:border-violet-400'}`}>
                      {selected[f.id] ? '✓' : ''}
                    </button>
                    <button
                      onClick={() => setPreviewFile(f)}
                      className="text-sm text-slate-700 truncate flex-1 text-right hover:text-violet-600 hover:underline">
                      {f.name}
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex gap-2 px-4 py-3 border-t border-slate-100">
          <button onClick={handleConfirm} disabled={selectedCount === 0}
            className="flex-1 py-2.5 rounded-xl font-black text-sm text-white disabled:opacity-40 transition"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
            {selectedCount > 0 ? `הוסף ${selectedCount} קבצים` : 'בחר קבצים'}
          </button>
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl font-bold text-sm border border-slate-200 text-slate-600 hover:bg-slate-50">
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}
