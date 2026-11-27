---
note_type: decisions-log
project: CRM
updated: 2026-06-14
---

# Decisions

Durable architectural / product decisions. Most are encoded in `PRD.md` and the
git history; this captures the ones a new agent should not have to rediscover.

### Stack: Express + React/Vite + Supabase + Railway

**Decision:** Monorepo with Node/Express API (`server/`) and React/Vite SPA
(`client/`), Postgres + file storage on Supabase, auto-deploy to Railway from
GitHub `main`.

**Why:** Small team, single venue; wanted cheap managed Postgres/storage and
push-to-deploy with no ops.

**Impact:** Railway filesystem is ephemeral → credentials reconstructed from
base64 env vars on boot. No CI gate beyond the build; `main` is production.

### Runtime DB migrations on boot

**Decision:** Schema changes applied at server startup (`server/db/migrate.js`,
plus inline column-ensure logic), not via a separate migration pipeline.

**Why:** Single deploy target, no separate migration step in Railway.

**Impact:** New columns must be added defensively (ensure-column) so old rows /
restarts don't break. Several commits fix type mismatches (e.g. TIME columns).

### Phone-based lead identity

**Decision:** Leads are de-duplicated by E.164-normalized Israeli phone number.

**Why:** Same person contacts via WhatsApp, web form, and phone — phone is the
stable key across channels.

**Impact:** All inbound channels normalize phone before matching/insert. See
[[leads-pipeline]].

### GreenInvoice taxId must be digits-only

**Decision:** Strip all non-digits from taxId before calling GreenInvoice.

**Why:** Formatted IDs (ח.פ/ת.ז with separators) cause GreenInvoice error 1111.

**Impact:** Enforced server-side in `greeninvoice.js` (commit `77d184b`).

## 2026-11-14 — Attendance (נוכחות) is real clock-in/out, separate from the presence estimate
- Clocked hours come from NFC punches (`attendance_shifts`); the ניהול "hours" estimate from heartbeat sessions (Phase 78) stays as it is until Oran decides otherwise.
- The punch happens on opening the tag URL (no confirm button); cheating is handled by GPS radius + registered phone, with exceptions going to a manager, not by blocking.
- Vacation and sick days both need approval; any admin/manager approves. The system counts days only — no sick-pay or overtime-pay calculation.
- Attendance rows are never hard-deleted: void status + `attendance_edits` audit.

## 2026-11-19 — Readable passwords for the admin (Phase 104)
- Oran wants to see employees' passwords in הגדרות. Decision: keep bcrypt for login, add an AES-256-GCM encrypted copy (`users.password_view`, key from `PASSWORD_VIEW_KEY` or `JWT_SECRET`) revealed one user at a time to system admins only. Alternative offered and declined: reset-password button with no readable copy. Do not change `JWT_SECRET` without knowing the copies become unreadable. Revisit for multi-business.

## 2026-11-23 — הערות מנהל: code-locked private notes (Phase 119)
- Oran wants a private window per event that only code holders and general managers (admin / manager) can open, deletable without a trace. Decisions: personal 6-digit PIN per manager; random 4-digit event code valid 8 hours, usable by anyone who holds it; phones only; entries signed with writer + time; old entries visible only while holding a button; auto-lock after 2 minutes.
- "No trace" is done by crypto-shredding: the per-event key salt is kept in Supabase Storage, outside the database and its backups, and is deleted with the notes.
- Screenshots cannot be blocked in a web app — told to Oran; he chose deterrence (hold-to-read, watermark, auto-lock) over turning the CRM into an installed app.
- These tables must stay out of search, export, PDF, activity history and every AI context.

## 2026-11-26 — ניהול משימות (Phase 134)
- A task hub beside the existing משימות tab, built in stages. Principle from the research Oran asked for: the screen must not become a warehouse — short "today" list, max 3 in progress, everything else folded and surfacing by date.
- Boards: the system places cards in הפקה (column per event) and מכירות (column per urgency tier, card = lead); free dragging only in personal/shared boards.
- Personal tasks are visible to their owner only (not managers, not admin). Anyone can give a task to anyone; optional "requires my approval". Hierarchy by a "direct manager" field per user.
- The hub reads the existing task tables through `routes/myTasks.js` queries; no table merge.
- 2026-11-27 (Phase 135): the hub's main view is a kanban of all my tasks by context, showing only non-empty columns; given tasks get their own column "נתתי לאחרים" and finished-awaiting-approval ones "לאישור שלי". Tasks that belong to no lead live in `hub_tasks`; personal ones are filtered to their owner in every query (admins included).
