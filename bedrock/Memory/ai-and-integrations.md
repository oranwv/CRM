---
note_type: domain
project: CRM
updated: 2026-09-14
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
- Lead events on Google carry `extendedProperties.private.crmLeadId` (manual events:
  `crmManual`). Sync is DB-first; if the stored `google_event_id` is gone on Google
  (404/410) the sync relinks to a surviving event of the lead or recreates one, and
  `GET /calendar/leads/:id/status` verifies + heals on lead-card load (2026-09-12).
- Unmark: clicking the active אופציה/סגור button again → confirm popup → `POST
  /calendar/leads/:id/unmark` (`unmarkEventDate`) deletes the Google event(s) and the
  `calendar_events` row. The לא סגרו transition uses the same `removeLeadEventsFromGoogle`.
- `driveService.js` + `DriveFilePicker.jsx` — attach Google Drive files.
- Auth via OAuth; credentials reconstructed from base64 env on boot (Railway).

## AI — all OpenAI (`openai` SDK, `OPENAI_API_KEY`)
**The AI layer is NOT Anthropic.** `@anthropic-ai/sdk` is still in package.json but
nothing in `server/` references it, and `ANTHROPIC_API_KEY` is read nowhere. Every AI
call is OpenAI: `gpt-4o-mini` almost everywhere, `gpt-4o` for /reply, `whisper-1` for
voice notes. (Verified 2026-09-08 against the source; earlier notes here said Claude.)
- AI chat assistant (`routes/chat.js`, floating button, SSE streaming, role-scoped tools).
- WhatsApp sales briefings (`services/salesBriefingService.js`) are **deterministic, no AI text** since 2026-09-08; roles admin/manager/sales_manager get one aggregate briefing, plain `sales` their own leads.
  Tools: get_leads, get_lead_details, get_lead_documents, get_urgent_leads, get_my_tasks,
  get_today_schedule, get_schedule, get_sales_worklist, get_analytics_kpis, get_op_tasks,
  get_maintenance, get_event_brief, get_suppliers, get_rsvp_summary, get_finance_summary,
  get_employee_activity — plus **proposal** tools propose_task / propose_note /
  propose_fault (2026-09-13): they never write; the route emits an SSE `action` event, the
  chat shows a confirm card, and only "אשר" hits `POST /api/chat/actions`.
- Knowledge files with `stored_name` are listed in the prompt as `[[file:ID]]` and render as
  chips; media/file chips have "שלח בוואטסאפ" → `POST /api/chat/send` (`services/waOutbound.js`,
  Green API uploadFile + sendFileByUrl; external media URLs go as text).
- Deal advisor (`services/salesAdvisor.js`): full-deal context (offer/contract totals via
  `offerTotal`/`contractTotal`, signing-page opens in `contract_views`, meetings, tasks,
  reply-speed), evidence + suggested_task + suggest_meeting in the response, worklist ranked
  near-event → temperature → deal value → freshness. `settings.sales_loss_lessons` holds
  the last loss-insight lessons for the advisor prompt.
- Payment signals (`services/paymentSignals.js`): opened in `PATCH /leads/:id` when an
  employee ticks "מקדמה התקבלה" / "תשלום מלא התקבל" or moves the stage to התקבלה מקדמה
  and no receipt-type doc (קבלה / חשבונית-מס-קבלה / pending 400|320) covers it →
  `payment_signals` (kind deposit|full_payment) → amber banner in the lead card ("הפק
  קבלה" prefills InvoiceModal) + header badge/modal for admin/manager/finance. 15-min cron
  closes signals once the receipt exists. NOT based on customer messages (Oran, 14.9).
- AI messaging helpers (`routes/ai.js`): transcribe (Whisper) / translate / reply / improve.
- Server-side AI: salesAdvisor (deal advice + loss insights), salesBriefingService,
  eventCostService (cost lines, JSON mode), financeInvoiceScanner (invoice classification),
  whatsapp.js (lead-detail extraction from inbound messages), reminderService.
- Admin-managed AI knowledge base. KB media lives in the **private** Supabase
  bucket `crm-files` — public URLs 404 ("Bucket not found"); all reads
  (`GET /api/chat/media`, admin knowledge-media routes) sign URLs at read time
  via `storageService.getSignedUrl` (6h expiry). Never store/serve
  `getPublicUrl` output from this bucket.
- **Do not answer model questions from memory — check the source.**

## Meta WhatsApp Cloud API
`server/services/metaWhatsapp.js` — used by the RSVP campaigns (approved templates,
`META_RSVP_*` env vars) and by the AI chat's sendText. Separate from Green API.

## GreenInvoice (financial docs)
- `server/routes/greeninvoice.js` — issues financial documents.
- Gotcha: taxId must be **digits only** (strip ח.פ/ת.ז formatting) or GreenInvoice
  errors with `1111` (commit `77d184b`).
- Issued doc PDFs are downloaded from the pre-signed URL and saved to lead files.
