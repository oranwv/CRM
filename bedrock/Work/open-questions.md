---
note_type: open-questions
project: CRM
updated: 2026-06-14
---

# Open Questions

Questions that are not resolved yet.

## Open

- Question
  - Why it matters:
  - Related context:

- 2026-10-19: ניהול column "פגישות שבוצעו" (`meetings_done` = lead_interactions type=meeting source=calendar) actually counts the booking note written when a meeting is booked, so it equals "פגישות נקבעו". Oran approved; redefined 2026-10-19 (Phase 54).

## Repeated logouts (opened 2026-11-22, Phase 107)
- Which request / reason throws users back to the login screen? Evidence to collect: the amber line on the login screen, `localStorage.crm_logout_log` on the affected browser, or `[Auth] 401` lines in the Railway log. Which user and which PC is it (one laptop or everyone)?
