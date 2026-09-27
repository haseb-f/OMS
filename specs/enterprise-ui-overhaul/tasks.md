# Tasks — enterprise-ui-overhaul (COMPLETE 2026-09-27)

| ID          | Task                                                                                      | Owner               | Depends  | Status                                                                 |
| ----------- | ----------------------------------------------------------------------------------------- | ------------------- | -------- | ---------------------------------------------------------------------- |
| INV         | Route + component + report + editor inventories; before baseline (tmp/ui-baseline/before) | Explore ×4 + Master | PDR done | done                                                                   |
| DS          | `design-system.md`; tokens, contrast script, primitives, shell                            | Master              | INV      | done                                                                   |
| SC-TABLE    | Table system: density, alignment, sort, truncation, footer, viewport-fill scroll          | Implementer         | DS       | done                                                                   |
| SC-REPORTS  | Financial report presentation system + one formatter + print/export                       | Implementer         | DS       | done                                                                   |
| SC-DOCS     | Document editors, totals, action bars, dashboard, store-order detail status               | Implementer         | DS       | done                                                                   |
| SC-FEEDBACK | Dialogs, status badges, empty/error states, toasts, print templates                       | Implementer         | DS       | done                                                                   |
| PROTO       | Sample screens rendered locally and refined                                               | Master              | SC-*     | done (tmp/ui-baseline/local-int3)                                      |
| ADOPT       | Remaining modules adopt the shared system (investors, raw tables, etc.)                   | Implementers ×3     | PROTO    | done                                                                   |
| REV         | Independent visual / RTL / accessibility review                                           | Reviewer            | ADOPT    | done — review.md (19 + 4 findings fixed, re-verified)                  |
| REL         | Gates, logical commits, push, deploy, verify SHA                                          | Master              | REV      | done — pushed; Production deploys verified                             |
| QA          | done — review.md (19 + 4 findings fixed, re-verified)                                     | Master              | REL      | done — Production sweep 228/0 overflow; journeys DEMO-UI-20260927 + R3 |
| DOC         | done — pushed; Production deploys verified                                                | Master              | QA       | done — verification.md; guide refreshed (d468b41)                      |
