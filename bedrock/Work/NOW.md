---
note_type: work-now
project: CRM
updated: 2026-09-08
---

# Now

## 2026-09-08 — Phone fixes round 2: settings user list + lead-card files

Reported from the phone: (1) הגדרות מערכת → ניהול משתמשים — rows with several
role pills lost the user's name entirely and the pills + ✏️/🗑 ran off the card;
(2) lead card (sales and production alike, same `FilesSection`) — file names sat
on top of the 🗑 button and ran off the screen.

Causes: (1) the name block was `min-w-0` with no basis, the pill group `shrink-0`
— so the pills won every pixel and the name collapsed to 0. (2) the file-name
`<button>` had `truncate block`, but a button never stretches to its parent, so
truncate never applied and the name spilled. Also four `flex-1` inputs in
AdminPage lacked `min-w-0` (an input keeps its intrinsic width) — the media-link
row and the Gmail/Drive rows overflowed too.

Fixes (phone only, `sm:` restores the original): user row `flex-wrap
sm:flex-nowrap`, name `flex-1 basis-24 min-w-0` so a short pill row stays on one
line and a long one wraps beneath the name; pill group `shrink sm:shrink-0
max-w-full`; inputs `min-w-0`; file name `block w-full wrap-break-word
sm:truncate` (break-word, not anywhere — keeps "60689.pdf" whole).

Verified headless at 360/390 on /admin and the card's files section: zero
overflow. Desktop 1280 pixel-identical on /admin; files section identical except
the pathological long name, which now truncates with … instead of overlapping 🗑.
Harness: mock API + Playwright measure script, rebuilt each round in the cloud
clone; the Mac's node_modules are macOS binaries so builds cannot run there.

## 2026-09-08 — Sales briefing rework, manager-scope fix, sales_manager role

Oran sent a phone screenshot of the morning WhatsApp briefing: the gpt-4o-mini opener
read oddly ("הזדמנות מדהימה לסגור 14 חוזים…") and the list ("חוזה נשלח וטרם נחתם" +
link) gave no way to know what to do. He wanted: when the contract / offer was sent,
when the last contact was and what it was.

Shipped (server/services/salesBriefingService.js):
- AI opener removed entirely — the briefing is now deterministic (`buildBriefingText`,
  exported so it can be rendered offline). Header = title · weekday+date · scope line ·
  three counts. No OpenAI import left in the file.
- Per lead: rep, event type/date (🔴 קרוב), sent date + "לפני N ימים", last contact
  (date · who/what · 70-char snippet), and a "who has the ball" flag
  (❗ הלקוח פנה אחרון / ⏳ הלקוח לא ענה כבר N ימים / 👉 אין קשר מתועד). Max 10 per tier,
  then "… ועוד N" linking to /sales-worklist. The data was already in `getWorklist`
  (contract_sent_at / offer_sent_at / last_contact) — the web worklist used it, the
  WhatsApp digest did not.
- **Gili bug:** the rep loop ran before the manager loop, so a user with both `sales`
  and `manager` got her own leads and was marked sent. Now admin/manager/sales_manager
  are handled first (one aggregate briefing) and excluded from the rep loop.
- New role `sales_manager` (מנהל מכירות): all-leads scope in getWorklist, the briefing,
  chat.js lead tools (`ALL_LEADS_SET`), `/api/sales` gate; Sales + Profits modes in the
  client; label/colour/checkbox in AdminPage. Kept OUT of `ROLE_PRIORITY` on purpose so
  it never lands in the legacy `role` column (CHECK constraint) — `roles[]` only.

Not verified: `vite build` cannot run in the Claude VM (arm64 Linux vs the Mac
node_modules); the client diffs are three one-line role checks. Railway builds on push.
PRD.md updated (roles table, briefing section with a sample message, Phase 27).

## 2026-09-08 — PRD brought back in sync with the code

The PRD had effectively stopped at 2026-05-02 and only received three later patches
(multi-recipient sends, the profit page, lead deep links). Everything built June-September
was undocumented. Audited bedrock -> PRD -> the actual source, and rewrote the gaps.

What was missing entirely: contracts + the public signing page, price offers, GreenInvoice
financial documents with the pending/approval flow, the finance module (reconciliation +
invoice email scan), operations (תפעול), suppliers, RSVP, the event brief, seating charts,
the management dashboard, the AI chat assistant + knowledge base, the AI sales agent, the
reworked analytics, voice notes, Drive, Meta WhatsApp and the WhatsApp auto-reply chatbot.

What was documented but **wrong**:
- **AI is OpenAI, not Claude.** The PRD listed `ANTHROPIC_API_KEY` and claude-haiku/sonnet
  models. Nothing in `server/` references Anthropic; it is gpt-4o-mini / gpt-4o / whisper-1
  on `OPENAI_API_KEY`. bedrock's ai-and-integrations.md said Claude too — also fixed.
- Roles: PRD said admin/sales/production; real is `role` (admin/manager/sales/production)
  **plus** `roles TEXT[]` adding operations/suppliers/rsvp/finance, plus `blocked`.
- Pipeline: 8 stages documented, 13 in the CHECK constraint.
- Navigation: documented as one fixed 2-row bar; it is actually 8 modes with per-mode tabs.
- Data model: 9 tables documented, 48 in the schema.
- Env vars: OPENAI_API_KEY, GREENINVOICE_*, META_RSVP_*, PUPPETEER_EXECUTABLE_PATH missing.

PRD.md went 850 -> ~1,610 lines. Every claim was verified against the source, not against
bedrock — bedrock's NOW.md was the map, the code was the truth.

**Note for next time:** the PRD drifts because feature sessions update NOW.md and skip it.
Treat "update PRD.md" as part of shipping, not as a separate documentation task.


## 2026-09-08 — LeadCard: mobile layout fixes

Reported from the phone with screenshots: on the lead card the "מחק ליד" button
sat on top of the title, and scrolling down the details/activity the content ran
off the right edge with a strange sideways scroll.

Root cause, same family as the profit-card bug: the card was built for desktop
width and never given a phone breakpoint. The header packed avatar + three
priority badges + delete/＋/× onto one non-wrapping row, squeezing the title
column to ~76px. Long unbroken strings (emails, the calendar ICS URLs we send in
WhatsApp) had nothing to break on, so they widened their container and the whole
`overflow-y-auto` body scrolled sideways.

Fix (client/src/components/LeadCard.jsx, mobile-only — every change is a bare
phone rule overridden at `sm:`, so desktop is untouched):
- header `flex-wrap sm:flex-nowrap`; the name group is `contents sm:flex` so on a
  phone its children (name, badges, avatar) join the header's own wrap row.
- priority badges become a horizontal row on their own line (`basis-full
  order-last`), the original vertical column from `sm:` up.
- delete button is icon-only on a phone (`🗑`), full "🗑 מחק ליד" from `sm:` up.
- avatar 10×10 on a phone, 12×12 from `sm:`.
- scroll body gets `overflow-x-hidden`; long values/messages get `wrap-anywhere`
  (+ `min-w-0` on flex children); timeline meta pills `flex-wrap`.
- WhatsApp tab bubble: `min-w-0` + `wrap-anywhere` so a long link wraps.

Verified headless against the built bundle at 360/390/430px, info + משימות +
וואטסאפ tabs: zero sideways scrollers, zero elements outside the viewport. Desktop
(1280px) checked before/after — first 400 element boxes identical except the
delete button (now slightly wider from its title/aria attrs) and the taller feed
from wrap-anywhere reflowing long test strings; no layout shift otherwise.

Note: a large unrelated PRD.md rewrite was already sitting uncommitted in the Mac
working tree (roles, modes, env-var docs) — left untouched, not committed here.

## 2026-09-08 — Lead links landed on the wrong page

Reported from the phone: the "פתח ליד ב-CRM" link in a Google Calendar event
(`/?lead=1025`) opened the רווחים page, not the lead. Historically it landed on
"other places" too — always whichever mode was open last.

Cause: `RootRedirect` in client/src/App.jsx bounces `/` to the last-used mode's
page from `crm_mode` in localStorage, ignoring the query string. `LeadsPage`
(which handles `?lead=`) is its child, so the redirect fired and dropped the
param whenever the last mode wasn't מכירות.

Fix: when `?lead=` is present, skip the redirect and switch the mode to מכירות.
Verified headless against the built bundle from רווחים/הפקה/ספקים/מכירות — all
land on `/` with the param consumed and mode = מכירות; the control case (no
`?lead`, mode רווחים) still redirects to /sales-performance as before.

Note: client/node_modules on the Mac holds macOS-arm64 binaries (rolldown), so
`npm run build` cannot run in the Linux VM that reaches the Mac — build checks
run in a throwaway cloud clone; the Mac's files are only edited, never rebuilt.

## 2026-09-07 — Profit page: summary cards overflowed on a phone

Reported from the phone with a screenshot: on the רווחים page the totals bled
outside their cards. Cause — three cards to a row on a 360px screen leaves ~100px
per card, and `text-2xl` is 27px here (index.css sets `html { font-size: 18px }`,
so every `text-*` is 1.125x what the Tailwind name suggests — worth remembering).
₪244,847 needs ~147px at that size.

Fix in client/src/pages/SalesPerformancePage.jsx: `grid-cols-2 sm:grid-cols-3`
with the count card `col-span-2 sm:col-span-1` — phone gets count on its own row,
the two money cards share the next (~160px each); `sm:` and up is byte-identical
to before. Amounts got `text-[clamp(1rem,5.7vw,1.5rem)]` + `whitespace-nowrap`,
cards got `overflow-hidden`. User approved the layout change from a preview.

Verified by rebuilding the client and rendering the card row headless at 360/390/
430px with 6- AND 7-figure sums (scrollWidth == clientWidth everywhere). Worth
reusing that trick: mock the markup against the built Tailwind CSS and measure,
rather than eyeballing. Note Tailwind v4 only emits arbitrary classes it finds in
the real source, so a mock must inline the font-size it wants to test.

Built from the phone with the Mac offline, in a cloud clone, so the fix sat
unpushed and the live site kept showing the old layout — the owner reported it
again the next day. Shipped 2026-09-08: patch applied on the Mac with `git am`,
pushed as 5be5b5b, Railway rebuilt, and the deployed CSS was confirmed to carry
the clamp rule.

**Lesson for cloud sessions:** the work is not done until it is on origin/main.
A cloud container cannot push (the GitHub token is ~/Projects/.claude-git-token
on the Mac) and has no network route to the Railway app, so it cannot verify a
deploy either. When the Mac is offline, say plainly that nothing will change on
the live site until it is back — and pick the work back up as soon as it is.

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
