# Tasks — enterprise-ui-overhaul (Round 1 COMPLETE; Round 2 ACTIVE 2026-09-27)

## Round 1

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
| QA          | Production browser pass: workflows, component states, theme × locale × viewport           | Master              | REL      | done — Production sweep 228/0 overflow; journeys DEMO-UI-20260927 + R3 |
| DOC         | After baseline, before/after evidence, Arabic user-guide screenshots                      | Master              | QA       | done — verification.md; guide refreshed (d468b41)                      |

## Round 2 — compact controls, organized headers, feedback, report UI, sidebar rail

| ID     | Task                                                                                                                  | Owner             | Depends | Status      |
| ------ | --------------------------------------------------------------------------------------------------------------------- | ----------------- | ------- | ----------- |
| R2-INV | Kumo research (kumo-research.md); before capture `tmp/ui-controls/r2-before` (controls, headers, dialogs, reports)    | Master + Research | —       | done        |
| R2-DS  | Selector/rail tokens (AA-checked); selector triggers; filter applied state; sidebar rail; top toasts; §11             | Master            | R2-INV  | done        |
| R2-HDR | Shared `HeaderActions` + page / document / record header anatomy across routes                                        | Implementer       | R2-DS   | in progress |
| R2-RPT | Financial report header, reconciliation summary, report cards; design-system showcase (balanced/unbalanced)           | Implementer       | R2-DS   | in progress |
| R2-FB  | FormErrorSummary + first-invalid focus, persistent alerts, import progress, success status/link                       | Implementer       | R2-DS   | in progress |
| R2-DOC | Lead→Store Order dialog, sales invoice, purchase quotation/invoice, payment declaration/reconciliation, card language | Implementer       | R2-HDR  | pending     |
| R2-REV | Independent visual / RTL / a11y review                                                                                | Reviewer          | R2-DOC  | pending     |
| R2-REL | Gates, logical commits, push, deploy, verify SHA                                                                      | Master            | R2-REV  | pending     |
| R2-QA  | Production after capture (ui-controls + ui-baseline), journeys, Arabic guide screenshots                              | Master            | R2-REL  | pending     |
