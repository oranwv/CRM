// Phase 81 — several assignees per task. The first one stays in the old single column
// (tasks/op_tasks.assigned_to, op_maintenance/op_faults.assignee_id); the others live in
// `extra_assignees INT[]`. The task itself is one shared row: whoever completes / postpones /
// cancels it does so for everyone.
// SQL fragments take the table alias and the name of the primary column.

// "$n is one of the assignees"
const has = (a, col, param) => `(${a}.${col} = ${param} OR ${param} = ANY(${a}.extra_assignees))`;
// "$n is not one of the assignees" (NULL-safe)
const hasNot = (a, col, param) => `(${a}.${col} IS DISTINCT FROM ${param} AND NOT (${param} = ANY(${a}.extra_assignees)))`;
// all ids, primary first
const ids = (a, col) => `array_remove(array_prepend(${a}.${col}, ${a}.extra_assignees), NULL)`;
// "שיר, גילי" — primary first
const names = (a, col) => `(SELECT string_agg(ux.display_name, ', ' ORDER BY (ux.id = ${a}.${col}) DESC, ux.display_name)
    FROM users ux WHERE ux.id = ${a}.${col} OR ux.id = ANY(${a}.extra_assignees))`;

// Reads the assignees from a request body. `assignee_ids` (array, primary first) wins; otherwise the
// old single field. Returns { primary, extras } — extras is null when the body did not say
// (old clients): an UPDATE then keeps what is stored, minus the new primary.
function fromBody(body, singleKey) {
  if (Array.isArray(body.assignee_ids)) {
    const list = [...new Set(body.assignee_ids.map(Number).filter(n => Number.isInteger(n) && n > 0))];
    return { primary: list[0] || null, extras: list.slice(1) };
  }
  const p = Number(body[singleKey]);
  return { primary: Number.isInteger(p) && p > 0 ? p : null, extras: null };
}
// SET fragment value for extra_assignees given params $x (extras or null) and $y (primary)
// (no primary → no assignees at all)
const setExtras = (px, py) => `CASE WHEN ${py}::int IS NULL THEN '{}'::int[] ELSE array_remove(COALESCE(${px}::int[], extra_assignees), ${py}::int) END`;

module.exports = { has, hasNot, ids, names, fromBody, setExtras };
