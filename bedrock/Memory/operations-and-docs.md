---
note_type: domain
project: CRM
updated: 2026-07-16
---

# Operations & Documents

Covers the post-booking side: event production, sales documents, and guest RSVP.

## Operations / Production module (תפעול)
- `OperationsPage.jsx`, components in `client/src/components/ops`,
  route `server/routes/operations.js`, `productionChecklist.js`.
- Tasks / maintenance / faults with a status lifecycle and dedicated detail views.
- Inventory checklists: add/edit items, "filled-by" stamp, permanent per-item
  notes with author + timestamp.
- Op reminders via WhatsApp (`meetingReminderService.js`, `reminderService.js`).
- "ops mode" calendar shows an event info card + seating chart.

## Sales documents
- **Contracts** (`contracts.js`) — editable deposit %, VAT, balance; deposit
  calculated from **pre-VAT subtotal**. PDF preview + signature page
  (`SignaturePage.jsx`). PDF generated with `puppeteer-core`.
- **Price offers** (`priceOffer.js`) — packages, extra-guest pricing, VAT
  toggle, editable preview rows.
- **Financial docs** — issued via GreenInvoice, see [[ai-and-integrations]].
  Non-manager submissions go to `pending_documents`; managers get a WhatsApp
  with a `/?pendingDocs=1` deep link that auto-opens the approvals modal.
- Multi-email selector when sending contract / price offer.
- **Chef/bar menu popup texts** (`fields.chefMenu`/`barMenu`) are anchored to
  their "המחיר כולל" bullet by **content match** (`/תפריט שף|chef menu/i`),
  never by array index — the includes list is editable and gets imported from
  price offers with a different layout. Same logic in 5 render sites:
  contracts.js, priceOffer.js, LeadCard contract + offer previews,
  SignaturePage. Keep them in sync.
- Postponement date in the cancellation section: computed (event + 6 months)
  but overridable via `texts.cancellationDateLabel` (same `*Label` pattern as
  remainderAmtLabel).
- `SignaturePage.jsx` is bilingual: all scaffolding/form strings branch on
  `contract_data.language === 'en'`, mirroring buildContractHtml.

## Seating charts
- `SeatingChart.jsx`, `SeatingTemplateGallery.jsx` — drag-and-drop canvas, AI
  assist, per-element guests + image.

## RSVP
- `client/src/pages/RSVPs`, route `server/routes/rsvp.js` — guest RSVP flow.

## Management dashboard (ניהול)
- `ManagementPage.jsx` — employee activity dashboard for admin/manager: calls /
  meetings split into done vs documented, first/last activity per employee.
- App "mode" switching via `client/src/context/AppModeContext.jsx`.
