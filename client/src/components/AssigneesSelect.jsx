// Phase 81 — several assignees on one task. Looks exactly like the single "אחראי" select it
// replaces; once someone is chosen a small "+ אחראי נוסף" link adds another select under it.
// `ids` = chosen user ids, first one is the main assignee. The task stays one shared task:
// whoever completes it closes it for everyone.
import { useState } from 'react';

export const assigneeIdsOf = (item, key) =>
  (item?.assignee_ids?.length ? item.assignee_ids : (item?.[key] ? [item[key]] : [])).map(String);

export default function AssigneesSelect({ ids = [], onChange, users, selectCls, className = '', emptyLabel = 'ללא', nameOf = u => u.display_name }) {
  const [adding, setAdding] = useState(false);
  const list = [...new Set(ids.map(String).filter(Boolean))];
  const pending = adding && list.length > 0;
  const rows = pending ? [...list, ''] : (list.length ? list : ['']);
  const setAt = (i, v) => {
    if (i >= list.length) { setAdding(false); if (v) onChange([...list, v]); return; }
    const next = [...list]; if (v) next[i] = v; else next.splice(i, 1);
    onChange([...new Set(next)]);
  };
  const removeAt = i => { if (i >= list.length) setAdding(false); else onChange(list.filter((_, j) => j !== i)); };
  const free = users.filter(u => !list.includes(String(u.id)));
  return (
    <div className={className}>
      {rows.map((id, i) => (
        <div key={i} className={`flex items-center gap-1 ${i ? 'mt-1.5' : ''}`}>
          <select value={id} onChange={e => setAt(i, e.target.value)} className={`${selectCls} min-w-0`}>
            <option value="">{i ? 'בחר…' : emptyLabel}</option>
            {users.filter(u => String(u.id) === id || !list.includes(String(u.id))).map(u => <option key={u.id} value={u.id}>{nameOf(u)}</option>)}
          </select>
          {i > 0 && (
            <button type="button" onClick={() => removeAt(i)} aria-label="הסר אחראי"
              className="shrink-0 w-7 h-7 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 text-lg leading-none">&times;</button>
          )}
        </div>
      ))}
      {list.length > 0 && !pending && free.length > 0 && (
        <button type="button" onClick={() => setAdding(true)}
          className="mt-1 text-xs font-bold text-violet-700 hover:underline">+ אחראי נוסף</button>
      )}
    </div>
  );
}
