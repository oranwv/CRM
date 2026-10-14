const STATUS_COLORS = {
  'חדש':        'bg-sky-100 text-sky-700 border border-sky-200',
  'בתהליך':     'bg-amber-100 text-amber-700 border border-amber-200',
  'ראיון נקבע': 'bg-violet-100 text-violet-700 border border-violet-200',
  'התקבל':      'bg-emerald-100 text-emerald-700 border border-emerald-200',
  'נדחה':       'bg-red-100 text-red-600 border border-red-200',
  'לא רלוונטי': 'bg-slate-100 text-slate-500 border border-slate-200',
};

export default function StatusBadge({ status }) {
  const cls = STATUS_COLORS[status] || 'bg-purple-100 text-purple-700 border border-purple-200';
  return (
    <span className={`inline-block text-xs font-bold px-2.5 py-0.5 rounded-full whitespace-nowrap ${cls}`}>
      {status || 'חדש'}
    </span>
  );
}
