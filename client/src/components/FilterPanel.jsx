const STAGE_LABELS = {
  new: 'חדש', contacted: 'בוצעה שיחה ראשונית',
  meeting_scheduled: 'נקבעה פגישה', meeting: 'בוצעה פגישה',
  offer_sent: 'נשלחה הצעת מחיר', negotiation: 'מו"מ',
  contract_sent: 'חוזה נשלח', deposit: 'התקבלה מקדמה',
  production: 'הפקה', lost: 'לא סגרו',
};

const DATE_OPTIONS = [
  { value: '30',  label: '30 יום' },
  { value: '60',  label: '60 יום' },
  { value: '90',  label: '90 יום' },
  { value: '180', label: '6 חודשים' },
];

export default function FilterPanel({ users, stageOptions, filter, onChange, onClear }) {
  const hasAny = filter.persons.length > 0 || filter.stages.length > 0 || filter.dateRange !== null;

  function togglePerson(name) {
    const persons = filter.persons.includes(name)
      ? filter.persons.filter(p => p !== name)
      : [...filter.persons, name];
    onChange({ ...filter, persons });
  }

  function toggleStage(key) {
    const stages = filter.stages.includes(key)
      ? filter.stages.filter(s => s !== key)
      : [...filter.stages, key];
    onChange({ ...filter, stages });
  }

  function toggleDate(val) {
    onChange({ ...filter, dateRange: filter.dateRange === val ? null : val });
  }

  return (
    <div
      className="absolute right-4 left-4 z-30 mt-1 bg-white rounded-2xl shadow-xl border border-violet-100 p-4 space-y-4"
      dir="rtl"
    >
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="font-bold text-slate-700 text-sm">סינון</span>
        {hasAny && (
          <button
            onClick={onClear}
            className="text-xs text-rose-500 hover:text-rose-700 font-semibold transition"
          >
            נקה הכל
          </button>
        )}
      </div>

      {/* אחראי */}
      {users.length > 0 && (
        <div>
          <p className="text-xs font-bold text-slate-400 mb-2">אחראי</p>
          <div className="flex flex-wrap gap-2">
            {users.map(u => {
              const active = filter.persons.includes(u.display_name);
              return (
                <button
                  key={u.id}
                  onClick={() => togglePerson(u.display_name)}
                  className={`text-xs px-3 py-1.5 rounded-full font-semibold border transition ${
                    active
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300 hover:text-violet-600'
                  }`}
                >
                  {u.display_name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* סטטוס */}
      {stageOptions.length > 1 && (
        <div>
          <p className="text-xs font-bold text-slate-400 mb-2">סטטוס</p>
          <div className="flex flex-wrap gap-2">
            {stageOptions.map(key => {
              const active = filter.stages.includes(key);
              return (
                <button
                  key={key}
                  onClick={() => toggleStage(key)}
                  className={`text-xs px-3 py-1.5 rounded-full font-semibold border transition ${
                    active
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300 hover:text-violet-600'
                  }`}
                >
                  {STAGE_LABELS[key] || key}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* תאריך אירוע */}
      <div>
        <p className="text-xs font-bold text-slate-400 mb-2">תאריך אירוע (הבאים)</p>
        <div className="flex flex-wrap gap-2">
          {DATE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => toggleDate(opt.value)}
              className={`text-xs px-3 py-1.5 rounded-full font-semibold border transition ${
                filter.dateRange === opt.value
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300 hover:text-violet-600'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
