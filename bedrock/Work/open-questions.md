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
- Which request / reason throws users back to the login screen? Evidence to collect: the amber line on the login screen, `localStorage.crm_logout_log` on the affected browser, or `[Auth] 401` lines in the Railway log. Oran (22.11): only on ONE Windows laptop, under Emili's user — so it is something stored in that browser or specific to her account, not a general fault. Checked and ruled out: non-session 401s on lead-card routes, unguarded async handlers (Express 5 would forward an outside API's `.status`) — only 6 exist, none on the lead card. Still to do there: read the amber reason line after 1.28.4, try Emili on another device and another user on that laptop.
