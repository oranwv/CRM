---
note_type: domain
project: CRM
updated: 2026-07-16
---

# AI & Integrations

External integrations are the backbone of this CRM. Routes in `server/routes/`,
service clients in `server/services/`.

## WhatsApp
- **Green API** — primary. Webhook in prod (`SERVER_URL` set), long-poll locally.
  `server/services/whatsappPoller.js`, `waSyncService.js`, route `whatsapp.js`.
- **Meta WhatsApp** (Graph API) — `server/services/metaWhatsapp.js`.
- Outbound file send, inbound message-type handling, AI auto-reply chatbot,
  AI extraction of lead details from inbound messages (commit `3bb9a86`).

## Google (Gmail / Calendar / Drive)
- `gmailService.js` polls Gmail every 10 min, parses leads from emails.
- `calendarService.js` / `calendarPollService.js` — event date marking + meeting
  scheduling; ICS + confirm endpoints are public.
- `driveService.js` + `DriveFilePicker.jsx` — attach Google Drive files.
- Auth via OAuth; credentials reconstructed from base64 env on boot (Railway).

## Claude AI (`@anthropic-ai/sdk`, `server/routes/ai.js` + `chat.js`)
- AI chat assistant (floating button, SSE streaming, role-scoped tools).
- Tools: `get_leads` (stage/urgent/no-open-tasks filters), `get_schedule`.
- AI messaging helpers: translate / reply / improve.
- Admin-managed AI knowledge base. KB media lives in the **private** Supabase
  bucket `crm-files` — public URLs 404 ("Bucket not found"); all reads
  (`GET /api/chat/media`, admin knowledge-media routes) sign URLs at read time
  via `storageService.getSignedUrl` (6h expiry). Never store/serve
  `getPublicUrl` output from this bucket.
- **When touching anything Claude/Anthropic-related, consult `claude-api` skill
  and prefer latest models — do not answer model questions from memory.**

## GreenInvoice (financial docs)
- `server/routes/greeninvoice.js` — issues financial documents.
- Gotcha: taxId must be **digits only** (strip ח.פ/ת.ז formatting) or GreenInvoice
  errors with `1111` (commit `77d184b`).
- Issued doc PDFs are downloaded from the pre-signed URL and saved to lead files.
