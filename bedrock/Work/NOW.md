---
note_type: work-now
project: CRM
updated: 2026-07-13
---

# Now

## Current focus

New **כספים (Finance) module** — built and deployed across July 2026 sessions.
Mode/tab "כספים" (roles: admin/manager + new assignable `finance` role).

1. **Reconciliation** (`server/services/financeReconcile.js`, `/api/finance/*`,
   `FinancePage.jsx`): bank PDF + CAL/MAX credit xlsx vs accountant's karteset;
   amount + 60-day date-window matching; live tracked list of missing invoices
   (amount desc) with free-text status + dated notes + ✓ resolve; fingerprint
   dedupe across runs. Test script: `server/scripts/testReconcile.js` (runs on
   ~/Downloads/Oran samples). ⚠ Bank-PDF parser (pdf-parse port of macOS
   prototype) is the risk area — verify against real bank.pdf.
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
