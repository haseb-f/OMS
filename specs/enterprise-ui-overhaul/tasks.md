# Tasks — enterprise-ui-overhaul (Round 1 COMPLETE 2026-09-27; Round 2 COMPLETE 2026-09-28)

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

| ID     | Task                                                                                                                  | Owner             | Depends | Status |
| ------ | --------------------------------------------------------------------------------------------------------------------- | ----------------- | ------- | ------ |
| R2-INV | Kumo research (kumo-research.md); before capture `tmp/ui-controls/r2-before` (controls, headers, dialogs, reports)    | Master + Research | —       | done   |
| R2-DS  | Selector/rail tokens (AA-checked); selector triggers; filter applied state; sidebar rail; top toasts; §11             | Master            | R2-INV  | done   |
| R2-HDR | Shared `HeaderActions` + page / document / record header anatomy across routes                                        | Implementer       | R2-DS   | done   |
| R2-RPT | Financial report header, reconciliation card, report cards; design-system showcase (balanced/unbalanced)              | Implementer       | R2-DS   | done   |
| R2-FB  | FormErrorSummary + first-invalid focus, persistent alerts, import progress, success status/link                       | Implementer       | R2-DS   | done   |
| R2-DOC | Lead→Store Order dialog, sales invoice, purchase quotation/invoice, payment declaration/reconciliation, card language | Implementer       | R2-HDR  | done   |
| R2-REV | Independent visual / RTL / a11y review — review-r2.md (12 findings, all fixed and verified)                           | Reviewer          | R2-DOC  | done   |
| R2-REL | Gates, logical commits, push, deploy, verify SHA (a3b22dc + follow-ups)                                               | Master            | R2-REV  | done   |
| R2-QA  | Production after capture (r2-after, 228/0 sweep), journeys DEMO-UI-20260928 (+R2/R3), Arabic guide screenshots        | Master            | R2-REL  | done   |

## Round 3 — Vercel-reference redesign (LOCAL PILOT, branch `ui/vercel-pilot`)

| ID      | Task                                                                                                                                                 | Owner             | Status                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------- |
| R3-REF  | Official Geist research (`geist-research.md`); spec "Round 3"; design-system §12                                                                     | Master + Research | done                                     |
| R3-BASE | Before capture `tmp/pilot/before` (local, matched viewports)                                                                                         | Master            | done                                     |
| R3-FND  | Scoped pilot mode (`config/ui-pilot.ts`, provider, boot script), Geist font, pilot tokens + recipes, flush sidebar, one-line labels, reviewer switch | Master            | done                                     |
| R3-DASH | Dashboard pilot (attention → metrics → ranking); control-states board on /design-system                                                              | Master            | done                                     |
| R3-LEAD | Lead list + lead detail pilot (next action, stage, details card, inline outcomes)                                                                    | Implementer       | done                                     |
| R3-DOC  | Lead→Order dialog + sales invoice editor pilot                                                                                                       | Implementer       | done                                     |
| R3-RPT  | Financial report pilot layout + reconciliation summary (TB, IS, other finance tabs)                                                                  | Implementer       | done                                     |
| R3-REV  | Independent review (15 findings; 1–5, 6–10, 12–15 fixed; 11 fixed)                                                                                   | Reviewer          | done                                     |
| R3-GATE | tsc clean · eslint 0 errors · vitest 256/256 · after capture `tmp/pilot/after`, `tmp/pilot/compare.html`                                             | Master            | done                                     |
| R3-OK   | **Owner visual approval of the local pilot**                                                                                                         | Owner             | **WAITING — nothing deployed or merged** |
| R3-ROLL | After approval: promote tokens/recipes, delete classic branches + pilot switch, all routes, gates, review, release                                   | —                 | blocked on R3-OK                         |
