#!/usr/bin/env node
// One-time import of the standalone candidate-tracker data into the CRM (מועמדים module).
//
// Copies jobs → candidate_jobs, candidates → candidates, interactions → candidate_interactions,
// and re-uploads every resume from the old Supabase bucket "resumes" into the CRM's "crm-files"
// bucket. Safe to re-run: rows already imported (matched by old id, kept in `import_source_id`)
// are skipped.
//
// Usage (from the CRM folder, with the CRM's own env loaded — DATABASE_URL, SUPABASE_URL,
// SUPABASE_SERVICE_KEY — plus the OLD app's connection details):
//
//   SRC_DATABASE_URL='postgresql://...candidate-tracker DB...' \
//   SRC_SUPABASE_URL='https://xxxx.supabase.co' SRC_SUPABASE_SERVICE_ROLE_KEY='...' \
//   node server/scripts/importCandidateTracker.js [--dry-run]
//
// SRC_SUPABASE_* are optional: without them candidates are imported but resumes are not copied
// (resume_path is left empty).
require('dotenv').config();
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const pool = require('../db/pool');
const { uploadBuffer } = require('../services/storageService');

const DRY = process.argv.includes('--dry-run');

async function main() {
  if (!process.env.SRC_DATABASE_URL) throw new Error('SRC_DATABASE_URL is required (the old candidate-tracker DATABASE_URL)');
  const src = new Pool({
    connectionString: process.env.SRC_DATABASE_URL,
    ssl: process.env.SRC_DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 2,
  });
  const srcStorage = (process.env.SRC_SUPABASE_URL && process.env.SRC_SUPABASE_SERVICE_ROLE_KEY)
    ? createClient(process.env.SRC_SUPABASE_URL, process.env.SRC_SUPABASE_SERVICE_ROLE_KEY).storage.from('resumes')
    : null;
  if (!srcStorage) console.warn('[import] SRC_SUPABASE_URL/KEY not set — resumes will NOT be copied');

  // Idempotency column (kept after import; harmless)
  if (!DRY) {
    await pool.query(`ALTER TABLE candidate_jobs ADD COLUMN IF NOT EXISTS import_source_id INT UNIQUE`);
    await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS import_source_id INT UNIQUE`);
    await pool.query(`ALTER TABLE candidate_interactions ADD COLUMN IF NOT EXISTS import_source_id INT UNIQUE`);
  }

  // 1. Jobs
  const { rows: jobs } = await src.query('SELECT * FROM jobs ORDER BY id');
  const jobMap = new Map(); // old id → new id
  for (const j of jobs) {
    if (DRY) { console.log(`[dry] job "${j.title}"`); continue; }
    const { rows } = await pool.query(
      `INSERT INTO candidate_jobs (title, created_at, import_source_id) VALUES ($1, $2, $3)
       ON CONFLICT (import_source_id) DO UPDATE SET title = EXCLUDED.title RETURNING id`,
      [j.title, j.created_at, j.id]);
    jobMap.set(j.id, rows[0].id);
  }
  console.log(`[import] jobs: ${jobs.length}`);

  // 2. Candidates (+ resumes)
  const { rows: cands } = await src.query('SELECT * FROM candidates ORDER BY id');
  const candMap = new Map();
  let resumesCopied = 0, resumesFailed = 0;
  for (const c of cands) {
    let resumePath = null;
    if (c.resume_path && srcStorage) {
      try {
        const { data, error } = await srcStorage.download(c.resume_path);
        if (error) throw error;
        const buf = Buffer.from(await data.arrayBuffer());
        const ext = path.extname(c.resume_path) || '.pdf';
        const mime = ext === '.pdf' ? 'application/pdf' : 'application/octet-stream';
        if (!DRY) ({ storedName: resumePath } = await uploadBuffer(buf, `resume-${c.id}${ext}`, mime));
        resumesCopied++;
      } catch (err) {
        resumesFailed++;
        console.warn(`[import] resume for candidate ${c.id} (${c.name}) failed: ${err.message}`);
      }
    }
    if (DRY) { console.log(`[dry] candidate "${c.name}" status=${c.status}`); continue; }
    const { rows } = await pool.query(
      `INSERT INTO candidates (name, phone, email, address, ai_summary, resume_path, gmail_message_id, status, status_reason,
                               status_updated_at, arrival_time, job_id, calendar_event_id, meeting_rsvp_status, created_at, import_source_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (import_source_id) DO UPDATE SET
         status = EXCLUDED.status, status_reason = EXCLUDED.status_reason, status_updated_at = EXCLUDED.status_updated_at,
         job_id = EXCLUDED.job_id, resume_path = COALESCE(EXCLUDED.resume_path, candidates.resume_path)
       RETURNING id`,
      [c.name, c.phone, c.email, c.address, c.ai_summary, resumePath, c.gmail_message_id,
       c.status === 'New' ? 'חדש' : (c.status || 'חדש'), c.status_reason, c.status_updated_at || null,
       c.arrival_time || c.created_at, c.job_id ? jobMap.get(c.job_id) || null : null,
       c.calendar_event_id || null, c.meeting_rsvp_status || 'none', c.created_at, c.id]);
    candMap.set(c.id, rows[0].id);
  }
  console.log(`[import] candidates: ${cands.length}, resumes copied: ${resumesCopied}, failed: ${resumesFailed}`);

  // 3. Interactions
  const { rows: ints } = await src.query('SELECT * FROM interactions ORDER BY id');
  let n = 0;
  for (const i of ints) {
    const newCand = candMap.get(i.candidate_id);
    if (!newCand || DRY) continue;
    await pool.query(
      `INSERT INTO candidate_interactions (candidate_id, type, date_time, notes, created_at, import_source_id)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (import_source_id) DO NOTHING`,
      [newCand, i.type, i.date_time, i.notes, i.created_at, i.id]);
    n++;
  }
  console.log(`[import] interactions: ${n}/${ints.length}`);

  await src.end();
  await pool.end();
  console.log(DRY ? '[import] dry run done' : '[import] done ✓');
}

main().catch(err => { console.error('[import] failed:', err); process.exit(1); });
