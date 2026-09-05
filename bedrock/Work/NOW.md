---
note_type: work-now
project: CRM
updated: 2026-09-05
---

# Now

## 2026-09-05 — Send to several contact people (Cowork session)

First feature session run from Claude Cowork (cloud) against the linked Mac.
A lead can have more than one contact person (leads.phone/email + the extra
lead_contacts rows) — until now every send flow picked exactly ONE of them.

- Client: new `ContactCheckList` component in LeadCard.jsx replaces the radio
  groups and `<select>`s in all 6 send flows (ContractModal, PriceOfferModal,
  WhatsAppTab, TaskActionModal, MeetingActionModal, ScheduleMeetingModal) for
  BOTH phones and emails. Deliberately keeps the old state shape — the value is
  still a comma-separated STRING (`waPhone`, `emailTo`) — so not a single send
  call site needed changing. Renders only when the lead has >1 contact of that
  type; shows "יישלח ל-N נמענים" from two ticks up.
- Server WhatsApp: `parsePhoneList()` splits on commas BEFORE normalizePhone
  (which strips non-digits — a raw comma list would otherwise become one bogus
  number), dedupes; `/send` + `/send-file` loop it. File uploaded to Green API
  ONCE, `sendFileByUrl` per recipient. One `messages` row per recipient, so the
  timeline shows who got what. A single bad number is logged + skipped, the rest
  still send; only all-fail returns 500.
- Server email: `/leads/:id/email/send` accepts array or comma list for `to`,
  joins into one RFC 5322 To: header (Gmail buildRawEmail already handles it).
- Contracts: `whatsapp_phone` now holds a comma-separated list; extra email
  recipients live in `contract_data.fields.clientEmailExtra` (first address
  stays `fields.clientEmail` — that is what is PRINTED on the contract). On
  signing, the signed PDF goes back to ALL of them on the channel used.
- ⚠ Verified by `vite build` only (built in the cloud container — the Mac's
  node_modules hold darwin binaries that the Cowork Linux VM cannot load, so
  builds must run in the container or on the Mac itself). NOT tested against
  real Green API sends — user should send one contract to two contacts and
  check both receive it and two rows appear in the timeline.

## 2026-09-04 — Cowork cloud session linked (infra)

- Claude Cowork (cloud session) is now linked to this Mac with folders CRM,
  sharabiya-website, wiwi-personal-assistant and ~/bedrock connected.
- bedrock vault + agent config (.claude/, .cursor/, AGENTS.md,
  .agent-project.yaml) added to git — docs now sync across devices/sessions.
- Protocol for every session (any device): git pull + read STATUS/PROJECT/NOW
  at start; update Memory/Work + PRD.md, commit + push at end.
- Voice recording feature (38860a7) found already committed+pushed by a local
  session; working tree is clean apart from docs.

## 2026-08-27 — AI sales agent (`729870d`, pushed)

Draft-only AI sales assistant. Files: server/services/salesAdvisor.js (worklist
ranking + analyzeLead + lossInsights), salesBriefingService.js (WhatsApp cron),
sales.js routes, client SalesWorklistPage.jsx + DealAdvisor in LeadCard.
- Worklist ranking is RULE-BASED (no per-lead AI): tier1 contract-sent-unsigned
  > tier2 offer-sent > tier3 urgent/hot; near-event (≤14d) boosted. getWorklist
  scopes sales→own assigned, manager/admin→all (rep-tagged).
- Per-lead advice = gpt-4o-mini JSON (temperature/headline/summary/next_action/
  draft_message), cached in lead_ai_advice; DealAdvisor card in lead info tab;
  "השתמש בטיוטה" pushes draft to WhatsApp composer via draftSeed prop.
- WhatsApp day-opener (morning) + daily-summary (evening) to reps (own) +
  managers (aggregate), once/day via sales_briefing_log; hours from settings
  sales_briefing_morning_hour/evening_hour (default 8/18 Asia/Jerusalem),
  sales_briefing_enabled. Cron every 15min in index.js.
- New tables: lead_ai_advice, sales_briefing_log. 'AI מכירות' tab (💡) in sales
  + management modes → /sales-worklist. loss-insights tab in that page.
- NOT built: auto-drafted cold follow-ups (option 3), AdminPage UI for briefing
  hours. All draft-only — never auto-sends to customers.


## 2026-08-13 — Analytics: closings by close-date (`9c0db2f`, pushed)

overview.closed/lost were cohort (leads created in period, current stage) → a
lead signed in Aug but created earlier showed on Profit page but not Analytics
Aug. Now event-based, mirroring sales.js fetchClosedEvents CLOSED_CTE (signed_at
else '← התקבלה מקדמה' note): closed = close_date in period, lost = '← אבוד'
note date in period, total = created in period, active = period inflow still
open (server-computed field, client reads overview.active directly). byMonth
purple = closings by close_date via generate_series spine. bySource kept cohort
by design (source-quality, not monthly output). ⚠ Analytics "closed" now = the
Profit page count for the same window.

## 2026-08-13 — Analytics rework (`71b8675`, pushed)

server/routes/analytics.js GET /overview + client/src/pages/AnalyticsPage.jsx:
- KPI cards: total received / closed / not-closed / still-active
  (=total−closed−lost) / close% / drop%. Removed new + in-process cards.
- New `activity` object = distinct-lead sales funnel: offers_sent
  (price_offers.created_at), contracts_sent (contracts.created_at),
  contracts_signed (contracts.status='signed' + signed_at) — all range-filtered
  on each table's own date. Client "פעילות" card renders 3-step funnel + conv%.
- byStage query REMOVED; bySource now returns closed/offers/contracts (distinct
  leads via LEFT JOIN DISTINCT lead_id subqueries) instead of progressed/paid.
- byMonth unchanged (fixed 6mo) + hover tooltip (total/closed).
- "closed" everywhere = stage IN (deposit,production,completed); signed≈deposit
  per user. No stage-history table exists — funnel uses price_offers/contracts
  tables, NOT stage parsing.


## 2026-08-08 — Gmail lead-intake fixes (pushed to main)

Diagnosed via prod DB (Railway CLI, project welcoming-fulfillment / service CRM;
DATABASE_URL = Supabase pooler). Call Event leads intermittently missing had
THREE causes in server/services/gmailService.js:
- `is:unread` in the poll query → any email read before the 10-min poll was
  never fetched. Fixed (`45bcb62`): scan all mail in 7-day window + pagination.
- catch block marked emails `processed_emails` even on error → permanent silent
  drop. Fixed (`0d1ce93`): don't mark on error, retry next poll.
- lost-lead inquiries were invisible → now reopen lost→new with a note (`45bcb62`).
⚠ Two example emails (אלמוג 849, נורית 883) are stuck in processed_emails from
the old error-mark bug; both leads already exist. נורית (883) still lost — a
manual reopen was BLOCKED by auto-mode (direct prod mutation); left to user.
Note: Railway CLI works locally; prod DB reachable read-only via saved
DATABASE_URL for diagnosis. Direct prod writes are blocked by auto-mode.


## Latest session (2026-08-01) — all pushed to main

- **Sales profit page** (`bcd8dc2`): /sales-performance ("רווחים" tab in
  sales + management modes; API /api/sales guarded admin/manager/sales —
  all salespeople see ALL closed events per user's choice). Close month =
  MIN(contracts.signed_at) per lead, fallback = deposit stage-change note in
  lead_interactions (no stage-history table exists — flagged gap). Amount =
  latest-signed contract calculated.subtotal (pre-VAT). New event_costs table
  (lead_id UNIQUE, lines JSONB [{id,label,amount}]); PUT /sales/costs/:leadId,
  POST /sales/costs/:leadId/generate = gpt-4o-mini JSON-mode over
  ai_knowledge_files.content_text (cost-model doc) + contract data. Profit =
  subtotal − Σlines. Commissions computed manually from this (no % automation).
- **KB files now viewable** (`bcd8dc2`): ai_knowledge_files.stored_name; POST
  uploads original to crm-files bucket; GET /:id/url signed link; AdminPage
  filename clickable; old rows show "העלה מחדש" hint. ⚠ User must RE-UPLOAD
  the cost-model PDF once (original was never stored before).
- **Profit page refinements** (`d63c1fb`): רווחים is a top-dropdown MODE (not
  bottom tabs); cost lines have editable `basis` ("100 אורחים × 140 ₪");
  generation moved to services/eventCostService.js and runs automatically on
  contract signing with onlyIfEmpty (hand edits never overwritten).
- **Structured cost lines** (`95332cc`): AI arithmetic was wrong (7×500=1500)
  → lines now carry qty + unit_price; SERVER multiplies (normalizeLine, used
  by AI generation AND manual PUT); amount locked/computed in UI when both
  present. POST /sales/costs/generate-missing?year&month + amber banner
  backfills months closed before the signing hook existed.
- **Close-month fix + save hardening** (`157f8a6`, user-verified working):
  deposit fallback LIKE anchored to note END ('%← התקבלה מקדמה') — was also
  matching deposit→production moves, misattributing close month. Cost-save
  endpoint hardened (body validation, full server-side error logging);
  client alerts now include the underlying HTTP error.

## Previous session (2026-07-26..28) — all pushed to main

- **Supplier card from brief/lead chips** (`5da57d8`, `6ed9573`): chip name
  opens SupplierCard overlay (X returns to origin); phone is a tel: link;
  link-styled. SupplierCard self-fetches categories when prop absent.
- **Deposit form fixes** (`827ed1e`): PATCH /leads/:id coerces ''→NULL for
  typed cols; deposit date uses PickerDateInput; event-brief auto values read
  correct contract_data paths (fields.*/calculated.* — chef/bar/guests/balance
  were always empty) + prefer signed contract; production balance = live
  contract_total − received deposit, override still wins.
- **Contract deposit-line + numbering** (`780ff2e`): depositAmt/Pct/AmtVat
  label overrides now honored in PDF+signing page; hierarchical clause
  numbering 1-6 + 3.x/5.x/6.x in preview/signing/PDF, he+en.
- **Hebrew entry on import** (`34deb91`): importing from an English
  contract/offer keeps Hebrew default texts/includes, reverts row labels via
  DEFAULT_ROWS map; only data imported. EN applied at preview as designed.
- **Contract download button** (`8ba136d`): download:true on POST contracts →
  inline PDF streamed back + record/file saved; preview footer הורדה button;
  stage not advanced.

## Previous session (2026-07-25) — all pushed to main

- **WA chatbot stage guard** (`e53c089`): auto-replies (greeting+followup+AI
  extraction) only while lead stage ∈ ('new','new_no_answer').
- **Lead search** (`57e4877`): also matches lead_contacts (extra phones/emails
  + labels, with 972 normalization), ranked ~55.
- **Signed contract via WhatsApp** (`0b985d6`): contracts.sent_via +
  whatsapp_phone persisted at creation; after signing, WA-sent contracts get
  the signed PDF with the full email body (incl. contract_email_bank payment
  details) as caption via Green API sendFileByUrl, logged to messages.
  Pre-existing contracts keep old no-email fallback.
- **Event brief supplier rows** (`e970254`): 'ספקי האירוע' section in
  EventBriefModal — rows מלצרים/ברמנים/קייטרינג(קייטרינג\שף)/מאבטח(שומרים)/
  מארחת(new 'מארחות' category, seeded) + 'הוסף ספק אחר' (all suppliers,
  search+category filter). Multi-select SupplierPickerModal; selections
  stored as snapshots in brief data.categorySuppliers. Free-text section kept.

## Previous session (2026-07-15/16) — bug fixes, all pushed to main

- **AI KB media 404 fixed** (`8b5faea`): private `crm-files` bucket → serve
  knowledge media via signed URLs at read time (chat + admin routes); delete
  now also removes the stored object.
- **Contract/offer fixes** (`271e2b2`): chef/bar menu popup text now anchored
  to its bullet by content match instead of fixed index (5 render sites — was
  landing on אבטחה/צוות נקיון after import-from-offer); postponement date now
  editable in preview (`cancellationDateLabel`); customer signing page now
  fully English for English contracts.
- **Approval deep link** (`7d3c91a`): manager WhatsApp "מסמך פיננסי ממתין
  לאישורך" now includes `/?pendingDocs=1` which auto-opens the approvals modal.
- **Calendar** (`d309019`, `9224026`): Israeli holidays as green chips —
  API fetch of Google's public holiday calendar didn't work in prod, so
  holidays now import at startup from server/data/holidays.json (built from
  user's ICS export, 2025-2031, Jewish/Israeli only, Hebrew names; rebuild
  script pattern: filter by DESCRIPTION 'Public holiday'/'Observance' +
  translate). + button → Google-style add-event dialog, manual events written
  to real GCal with crmManual extendedProperty, rendered brown, deletable;
  month-nav chevrons were bidi-mirrored by RTL → glyphs swapped.
- ⚠ No local Node on this machine — changes reviewed statically only; user
  should verify after Railway deploy: import-from-offer contract → menus on
  right bullets in preview/signing page/signed PDF; edit postpone date;
  package price-offer PDF; English contract signing page.

## Current focus

New **כספים (Finance) module** — built and deployed across July 2026 sessions.
Mode/tab "כספים" (roles: admin/manager + new assignable `finance` role).

1. **Reconciliation** (`server/services/financeReconcile.js`, `/api/finance/*`,
   `FinancePage.jsx`) — as of 2026-07-19 fully verified on the user's REAL files:
   - Bank PDF parsers: transfers list ("רשימת ההעברות", tab rows with ₪ + payee)
     AND checking-account statement ("יתרה ותנועות בעו"ש", signed amounts,
     expenses = negatives only). Some bank exports are IMAGE-based (32KB, no
     text layer) → explicit warning; user must download the full report.
     Debug tool: `server/scripts/debugBankPdf.js <pdf>`.
   - Payee enrichment: when both bank reports uploaded, checking transfers get
     the payee name from the transfers list (amount + ±4d match, deduped).
   - Rows display labeled מוטב/בית עסק; separate upload slots for karteset
     (multi-month, merged) vs expense files; CAL/MAX summary rows skipped;
     dd-mm-yyyy dates supported; card-charge rows in DEFAULT_EXCLUSIONS.
   - **Saved periods** (finance_periods): each reconciliation round is a
     workspace (chips bar, create/delete, per-period item scoping via
     (period_id, fingerprint) unique); per-source tabs (בנק/כאל/מקס); re-upload
     of the accountant's UPDATED karteset auto-resolves items now covered
     (status 'נסגר אוטומטית — נמצא בכרטסת המעודכנת', source-scoped).
   - Node.js now installed on the user's Mac (brew) — local build/tests work:
     `npx vite build`, `node server/scripts/testReconcile.js`.
2. **Invoice email scan** (`server/services/financeInvoiceScanner.js`): scans
   business Gmail + extra OAuth-connected mailboxes; keyword prefilter → OpenAI
   gpt-4o-mini JSON-mode confirms supplier invoices (user chose OpenAI — same
   provider/key as the chat); downloads attachments + body links; files into
   Drive by email date — target folder configurable in AdminPage ("תיקיית
   חשבוניות בדרייב", settings finance_drive_root_link/_id; fallback:
   auto-created "חשבוניות") with MM-YYYY month subfolders; daily auto-scan
   (20:00 server) + manual presets. Tables: finance_gmail_accounts /
   finance_scanned_emails / finance_invoice_files.

## Blockers — one-time user setup for invoice scan (NOT yet done as of 2026-07-13)

1. Re-auth Google token with `drive.file` scope: `node server/scripts/googleAuth.js`
   → update `GOOGLE_TOKEN_B64` on Railway (current token is drive.readonly!).
2. Add redirect URI in Google Cloud Console:
   `https://www.proevent.co.il/api/finance/gmail/oauth/callback`.
   (OPENAI_API_KEY already configured — AI classification works out of the box.)

## Also shipped this period (all deployed)

- Analytics: instagram source split (CTA detection + backfill), date-range +
  progressed/paid quality metrics, label tweaks.
- Contracts: per-price VAT incl/excl entry (rows + extra-guest, contract+offer);
  free-text lines in preview (event + costs sections, all 3 render surfaces);
  payment-terms rewritten to גמר חשבון block (security + reserve cheques, all
  editable); row add/delete step-desync fixes; paymentExtras now in PDF.
- Financial docs: default item "אירוע"; client name/phone/email editable with
  override-through-approval (taxId precedence bug fixed).
- AI KB: media (images/videos) the assistant can show via [[media:ID]] tags.
- WhatsApp: Green API outage playbook verified (bulkImport.js for >24h gaps).

## Next recommended actions

1. User completes the 3 invoice-scan setup steps, then tests a manual scan.
2. Verify reconciliation engine vs prototype output (`node server/scripts/testReconcile.js`).
3. Consider: VAT option for package fields (deferred by choice).

## Context to load first

- Memory/PROJECT.md, server/routes/finance.js, server/services/financeReconcile.js,
  server/services/financeInvoiceScanner.js, client/src/pages/FinancePage.jsx
