---
note_type: project-overview
project: CRM
updated: 2026-06-14
---

# Project

## What this project is

**Sharabiya CRM** (a.k.a. "proevent") — a custom CRM for **Sharabiya**, an event
venue at פנחס בן יאיר 3, תל אביב (Tel Aviv). It manages the full event-business
lifecycle: from first lead inquiry, through booking, signed contract, financial
documents, and on-the-day event production/operations.

- **Live:** https://www.proevent.co.il
- **Hosting:** Railway (auto-deploy from GitHub `main`)
- **DB + Storage:** Supabase (PostgreSQL + Storage bucket `crm-files`)
- **Style:** Mobile-first, Hebrew **RTL**, multi-user.

The single most detailed source of truth is **`PRD.md`** at the repo root
(~780 lines, kept current). Read it for data model, API routes, parsing rules,
and build-phase status. This Memory captures shape + non-obvious facts; do not
duplicate the PRD.

## Tech stack

- **Backend:** Node.js + Express 5 (`server/`), entrypoint `server/index.js`.
  CommonJS. Postgres via `pg` (`server/db/pool.js`). Runtime DB migrations run
  on boot. Background cron jobs started in `startCronJobs()`.
- **Frontend:** React + Vite (`client/`), plain JSX, Tailwind-style classes.
  Pages in `client/src/pages`, components in `client/src/components`.
- **Auth:** JWT (`jsonwebtoken`), bcrypt password hashing. Roles:
  **admin / sales / production**. Middleware in `server/middleware/auth.js`.
- **AI:** Anthropic Claude SDK (`@anthropic-ai/sdk`) — see [[ai-and-integrations]].

## Domain areas (Memory branches)

- [[leads-pipeline]] — lead capture, sources, pipeline stages, the lead data model.
- [[ai-and-integrations]] — WhatsApp (Green API + Meta), Gmail/Calendar/Drive,
  Claude AI chat & messaging, GreenInvoice financial docs.
- [[operations-and-docs]] — production/operations module (תפעול), contracts,
  price offers, financial docs, seating charts, RSVP.

## Important context

- **Hebrew RTL everywhere.** Commit messages and UI mix Hebrew + English.
  Key terms: תפעול = operations/production, ניהול = management dashboard,
  ליד = lead. See [[glossary]].
- **Ephemeral filesystem on Railway:** Google credentials (`credentials.json`,
  `google_token.json`) are reconstructed on every boot from base64 env vars
  (`GOOGLE_CREDENTIALS_B64`, `GOOGLE_TOKEN_B64`).
- **Secrets live in env vars** (see PRD "Infrastructure"). Note a stray
  `greenapi-credentials.txt.txt` exists in repo root — treat as sensitive.
- See [[decisions]] for architectural decisions.
