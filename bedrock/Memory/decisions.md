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
