// Recording retention (Oran, 2026-11-16) — the audio of a call is deleted, the text stays:
//   • lead that did not close (stage "lost"): one month after it was marked lost
//   • event that took place and was paid (stage "completed"): two months after it was completed
// What stays for good: the transcript, the AI summary/analysis and the timeline entry — that is
// what the sales-improvement AI works from. Open leads and events still in production keep
// their recordings. Private calls (no lead) are not touched.
// Safety: audio is deleted only when the call has a transcript (or was too short to have one,
// under 15 s), and only for calls that are themselves older than the retention period.
const pool = require('../db/pool');

const LOST_DAYS = 30;
const COMPLETED_DAYS = 60;
const NOTE = '🗑️ ההקלטה נמחקה לפי מדיניות השמירה — המלל נשמר';

let running = false;
async function runRecordingRetention() {
  if (running) return { deleted: 0 };
  running = true;
  let deleted = 0;
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.interaction_id, f.id AS file_id, f.stored_name
       FROM calls c
       JOIN files f ON f.id = c.recording_file_id AND f.is_recording
       JOIN leads l ON l.id = c.lead_id
       WHERE (COALESCE(length(c.transcript), 0) > 0 OR COALESCE(c.duration_sec, 0) < 15)
         AND (
           (l.stage = 'lost'
             AND c.started_at < NOW() - ($1 || ' days')::interval
             AND COALESCE((SELECT MAX(h.created_at) FROM lead_stage_history h WHERE h.lead_id = l.id AND h.to_stage = 'lost'), l.updated_at)
                 < NOW() - ($1 || ' days')::interval)
           OR
           (l.stage = 'completed'
             AND c.started_at < NOW() - ($2 || ' days')::interval
             AND COALESCE((SELECT MAX(h.created_at) FROM lead_stage_history h WHERE h.lead_id = l.id AND h.to_stage = 'completed'), l.event_date::timestamptz, l.updated_at)
                 < NOW() - ($2 || ' days')::interval)
         )
       ORDER BY c.started_at LIMIT 300`,
      [String(LOST_DAYS), String(COMPLETED_DAYS)]
    );
    if (!rows.length) return { deleted: 0 };
    const { deleteStored } = require('./storageService');
    for (const r of rows) {
      try {
        if (r.stored_name) await deleteStored(r.stored_name);      // throws if storage refused
        await pool.query('UPDATE calls SET recording_file_id = NULL, recording_deleted_at = NOW() WHERE id = $1', [r.id]);
        await pool.query('DELETE FROM files WHERE id = $1', [r.file_id]);
        if (r.interaction_id) {
          await pool.query(`UPDATE lead_interactions SET body = replace(body, $2, $3) WHERE id = $1`, [r.interaction_id, `[[REC:${r.id}]]`, NOTE]);
        }
        deleted++;
      } catch (err) {
        console.error('[Retention] could not delete recording of call', r.id, '-', err.message);
      }
    }
    console.log(`[Retention] deleted ${deleted} call recording(s); transcripts kept`);
  } catch (err) {
    console.error('[Retention] error:', err.message);
  } finally { running = false; }
  return { deleted };
}

module.exports = { runRecordingRetention, LOST_DAYS, COMPLETED_DAYS };
