---
note_type: risks
project: CRM
updated: 2026-07-16
---

# Risks

Known project risks.

## Open risks

- Risk: no Node/npm installed on the dev machine — client and server changes
  ship without local build/lint/tests.
  - Why it matters: syntax or JSX errors surface only after Railway deploy.
  - Mitigation: careful static diff review; user smoke-tests in prod right
    after deploy. Consider installing Node locally.
  - Related context: 2026-07-16 contract-fix session.
- Risk: chef/bar menu anchoring logic is duplicated in 5 render sites
  (contracts.js, priceOffer.js, LeadCard ×2, SignaturePage).
  - Why it matters: editing one site and not the others reintroduces the
    wrong-bullet bug or preview/PDF divergence.
  - Mitigation: grep for `chefIdx` when touching includes rendering; see
    Memory/operations-and-docs.md.
