# Tasks — enterprise-ui-overhaul (ACTIVE since 2026-09-27)

| ID          | Task                                                                                      | Owner               | Depends  | Status                            |
| ----------- | ----------------------------------------------------------------------------------------- | ------------------- | -------- | --------------------------------- |
| INV         | Route + component + report + editor inventories; before baseline (tmp/ui-baseline/before) | Explore ×4 + Master | PDR done | done                              |
| DS          | `design-system.md`; tokens, contrast script, primitives, shell                            | Master              | INV      | done                              |
| SC-TABLE    | Table system: density, alignment, sort, truncation, footer, viewport-fill scroll          | Implementer         | DS       | done                              |
| SC-REPORTS  | Financial report presentation system + one formatter + print/export                       | Implementer         | DS       | done                              |
| SC-DOCS     | Document editors, totals, action bars, dashboard, store-order detail status               | Implementer         | DS       | done                              |
| SC-FEEDBACK | Dialogs, status badges, empty/error states, toasts, print templates                       | Implementer         | DS       | done                              |
| PROTO       | Sample screens rendered locally and refined                                               | Master              | SC-*     | done (tmp/ui-baseline/local-int3) |
| ADOPT       | Remaining modules adopt the shared system (investors, raw tables, etc.)                   | Implementers ×3     | PROTO    | done                              |
| REV         | Independent visual / RTL / accessibility review                                           | Reviewer            | ADOPT    | in progress                       |
| REL         | Gates, logical commits, push, deploy, verify SHA                                          | Master              | REV      | pending                           |
| QA          | Production browser pass: workflows, component states, theme × locale × viewport           | Master              | REL      | pending                           |
| DOC         | After baseline, before/after evidence, Arabic user-guide screenshots                      | Master              | QA       | pending                           |
