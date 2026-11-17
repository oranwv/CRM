// Phase 92 — hand a blocked user's work over to someone else, and take it back.
// Settings → משתמשים → (blocked user) → "העברת לידים ומשימות". Every transfer is recorded item by
// item (user_transfers / user_transfer_items) so it can be restored: restoring puts back only the
// items that still belong to the person they were moved to — anything reassigned by hand since is
// left alone.
const pool = require('../db/pool');

const ACTIVE = `l.stage NOT IN ('deposit','production','completed','lost')`;
const CLOSED = `l.stage IN ('deposit','production','completed')`;
// what can be moved; `parts` in the API are these keys
const LEAD_PARTS = {
  leads_active: { col: 'assigned_to', where: ACTIVE },
  leads_closed: { col: 'assigned_to', where: CLOSED },
  leads_lost:   { col: 'assigned_to', where: `l.stage = 'lost'` },
  production:   { col: 'production_manager_id', where: 'TRUE' },
};
// task-like tables: primary assignee column + "still open" condition
const TASK_TABLES = [
  { entity: 'task',        table: 'tasks',          col: 'assigned_to', open: 't.completed_at IS NULL' },
  { entity: 'op_task',     table: 'op_tasks',       col: 'assigned_to', open: `t.status <> 'done'` },
  { entity: 'maintenance', table: 'op_maintenance', col: 'assignee_id', open: 'TRUE' },
  { entity: 'fault',       table: 'op_faults',      col: 'assignee_id', open: `t.status <> 'resolved'` },
];
const PARTS = [...Object.keys(LEAD_PARTS), 'tasks', 'meetings'];

async function counts(userId, db = pool) {
  const out = {};
  for (const [key, p] of Object.entries(LEAD_PARTS)) {
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM leads l WHERE l.${p.col} = $1 AND ${p.where}`, [userId]);
    out[key] = rows[0].n;
  }
  out.tasks = 0;
  for (const t of TASK_TABLES) {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM ${t.table} t WHERE (t.${t.col} = $1 OR $1 = ANY(t.extra_assignees)) AND ${t.open}`, [userId]);
    out.tasks += rows[0].n;
  }
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM meetings WHERE host_user_id = $1 AND start_time > NOW()`, [userId]);
  out.meetings = rows[0].n;
  return out;
}

async function history(userId) {
  const { rows } = await pool.query(
    `SELECT x.id, x.to_user, ut.display_name AS to_name, x.created_at, ub.display_name AS by_name,
            x.counts, x.restored_at, ur.display_name AS restored_by_name, x.restored_counts
     FROM user_transfers x
     LEFT JOIN users ut ON ut.id = x.to_user
     LEFT JOIN users ub ON ub.id = x.created_by
     LEFT JOIN users ur ON ur.id = x.restored_by
     WHERE x.from_user = $1 ORDER BY x.created_at DESC`, [userId]);
  return rows;
}

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

async function transfer({ fromUser, toUser, parts, actorId }) {
  fromUser = Number(fromUser); toUser = Number(toUser);
  const want = PARTS.filter(p => (parts || []).includes(p));
  if (!want.length) throw httpError(400, 'לא נבחר מה להעביר');
  if (!toUser || toUser === fromUser) throw httpError(400, 'יש לבחור משתמש אחר להעברה');
  const { rows: us } = await pool.query('SELECT id, blocked FROM users WHERE id = ANY($1::int[])', [[fromUser, toUser]]);
  const from = us.find(u => u.id === fromUser), to = us.find(u => u.id === toUser);
  if (!from || !to) throw httpError(404, 'משתמש לא נמצא');
  if (!from.blocked) throw httpError(400, 'אפשר להעביר רק ממשתמש חסום');
  if (to.blocked) throw httpError(400, 'אי אפשר להעביר למשתמש חסום');

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows: [x] } = await db.query(
      `INSERT INTO user_transfers (from_user, to_user, created_by) VALUES ($1, $2, $3) RETURNING id`, [fromUser, toUser, actorId || null]);
    const done = {};
    const record = async (entity, op, ids, key) => {
      if (!ids.length) return;
      await db.query(
        `INSERT INTO user_transfer_items (transfer_id, entity, op, entity_id) SELECT $1, $2, $3, unnest($4::int[])`,
        [x.id, entity, op, ids]);
      done[key] = (done[key] || 0) + ids.length;
    };
    for (const [key, p] of Object.entries(LEAD_PARTS)) {
      if (!want.includes(key)) continue;
      const { rows } = await db.query(
        `UPDATE leads l SET ${p.col} = $2 WHERE l.${p.col} = $1 AND ${p.where} RETURNING l.id`, [fromUser, toUser]);
      await record(p.col === 'assigned_to' ? 'lead_owner' : 'lead_pm', 'primary', rows.map(r => r.id), key);
    }
    if (want.includes('tasks')) {
      for (const t of TASK_TABLES) {
        // main assignee → the new person (who then must not also appear as an extra)
        let r = await db.query(
          `UPDATE ${t.table} t SET ${t.col} = $2, extra_assignees = array_remove(t.extra_assignees, $2)
           WHERE t.${t.col} = $1 AND ${t.open} RETURNING t.id`, [fromUser, toUser]);
        await record(t.entity, 'primary', r.rows.map(q => q.id), 'tasks');
        // extra assignee → swapped for the new person…
        r = await db.query(
          `UPDATE ${t.table} t SET extra_assignees = array_replace(t.extra_assignees, $1, $2)
           WHERE $1 = ANY(t.extra_assignees) AND t.${t.col} IS DISTINCT FROM $2 AND NOT ($2 = ANY(t.extra_assignees)) AND ${t.open}
           RETURNING t.id`, [fromUser, toUser]);
        await record(t.entity, 'extra', r.rows.map(q => q.id), 'tasks');
        // …or just dropped when the new person is already on the task
        r = await db.query(
          `UPDATE ${t.table} t SET extra_assignees = array_remove(t.extra_assignees, $1)
           WHERE $1 = ANY(t.extra_assignees) AND ${t.open} RETURNING t.id`, [fromUser]);
        await record(t.entity, 'extra_removed', r.rows.map(q => q.id), 'tasks');
      }
    }
    if (want.includes('meetings')) {
      const { rows } = await db.query(
        `UPDATE meetings SET host_user_id = $2 WHERE host_user_id = $1 AND start_time > NOW() RETURNING id`, [fromUser, toUser]);
      await record('meeting', 'primary', rows.map(r => r.id), 'meetings');
    }
    const total = Object.values(done).reduce((a, b) => a + b, 0);
    if (!total) { await db.query('ROLLBACK'); throw httpError(400, 'אין מה להעביר'); }
    await db.query('UPDATE user_transfers SET counts = $2 WHERE id = $1', [x.id, JSON.stringify(done)]);
    await db.query('COMMIT');
    return { id: x.id, counts: done, total };
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { db.release(); }
}

const ENTITY = {
  lead_owner:  { table: 'leads',          col: 'assigned_to' },
  lead_pm:     { table: 'leads',          col: 'production_manager_id' },
  meeting:     { table: 'meetings',       col: 'host_user_id' },
  task:        { table: 'tasks',          col: 'assigned_to' },
  op_task:     { table: 'op_tasks',       col: 'assigned_to' },
  maintenance: { table: 'op_maintenance', col: 'assignee_id' },
  fault:       { table: 'op_faults',      col: 'assignee_id' },
};

async function restore({ transferId, actorId }) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows: [x] } = await db.query('SELECT * FROM user_transfers WHERE id = $1 FOR UPDATE', [transferId]);
    if (!x) throw httpError(404, 'ההעברה לא נמצאה');
    if (x.restored_at) throw httpError(400, 'ההעברה הזו כבר הושבה');
    const { rows: groups } = await db.query(
      `SELECT entity, op, array_agg(entity_id) AS ids FROM user_transfer_items WHERE transfer_id = $1 GROUP BY entity, op`, [transferId]);
    let restored = 0, total = 0;
    for (const g of groups) {
      const e = ENTITY[g.entity]; if (!e) continue;
      total += g.ids.length;
      let sql;
      if (g.op === 'primary') sql = `UPDATE ${e.table} SET ${e.col} = $2 WHERE id = ANY($1::int[]) AND ${e.col} = $3`;
      else if (g.op === 'extra') sql = `UPDATE ${e.table} SET extra_assignees = array_replace(extra_assignees, $3, $2) WHERE id = ANY($1::int[]) AND $3 = ANY(extra_assignees) AND ${e.col} IS DISTINCT FROM $2`;
      else sql = `UPDATE ${e.table} SET extra_assignees = array_append(extra_assignees, $2) WHERE id = ANY($1::int[]) AND NOT ($2 = ANY(extra_assignees)) AND ${e.col} IS DISTINCT FROM $2 AND $3::int IS NOT NULL`;
      const r = await db.query(sql, [g.ids, x.from_user, x.to_user]);
      restored += r.rowCount;
    }
    const rc = { restored, skipped: total - restored };
    await db.query('UPDATE user_transfers SET restored_at = NOW(), restored_by = $2, restored_counts = $3 WHERE id = $1',
      [transferId, actorId || null, JSON.stringify(rc)]);
    await db.query('COMMIT');
    return rc;
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { db.release(); }
}

module.exports = { counts, history, transfer, restore, PARTS };
