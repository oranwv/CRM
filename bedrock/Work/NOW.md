---
note_type: work-now
project: CRM
updated: 2026-07-16
---

# Now

## Latest session (2026-07-15/16) — bug fixes, all pushed to main

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
