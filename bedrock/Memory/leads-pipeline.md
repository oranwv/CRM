---
note_type: domain
project: CRM
updated: 2026-06-14
---

# Leads Pipeline

The core entity is the **lead** (ליד). All leads are visible to everyone; each
has an assigned owner. Every action is attributed to the logged-in user.

## Lead sources (auto-captured)

- Website popup form + contact form (parsed from Gmail by subject line)
- Call Event supplier (info@hafakot.co.il), Telekol voicemail (email)
- WhatsApp (Green API webhook in prod, long-poll in local dev)
- Manual entry in the CRM
- Planned: Facebook Messenger / Instagram DM (Meta Graph API)

**Match rule:** normalize phone to E.164 Israeli (strip non-digits, leading
`0` → `972`). Match → attach interaction; unknown → new lead at stage `new`.
WhatsApp dedup via `messages.external_id`. See `server/utils/phoneUtils.js`,
`server/services/gmailService.js`.

## Pipeline stages

Defined in PRD "Pipeline Stages". Stage changes are audit-trailed. Leads have
lost reasons when marked lost. Stage advance from `new` is manual (see commit
`f92f2fc`).

## Data model

Full schema in `PRD.md` "Data Model": `leads`, `lead_interactions`, `messages`,
`meetings`, `tasks`, `files`, `calendar_events`, `users`, `processed_emails`.
Files use `[[FILE:id|name]]` marker syntax inside text. Storage is Supabase with
signed URLs (1h expiry).

Frontend: `LeadsPage.jsx` (list/board), `LeadCard.jsx` (full-screen modal with
Info / activity / files tabs).
