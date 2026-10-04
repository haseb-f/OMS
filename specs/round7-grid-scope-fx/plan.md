# Round 7 — Table/Grid UX, sales scoping, dashboards, FX verification, dark dropdown triggers

Status: ACTIVE (owner brief 2026-10-03 + dropdown addendum). Integrator: this session. Out of scope: database
architecture/replication/replacement/infrastructure. Baseline: `main` = `d094040`. Same rules as R6
(`specs/ui-navigation-r6/plan.md`): own branch + worktree + local DB clone + ports per workstream, never
`git stash`, workstreams never push/deploy, integrator merges and runs gates on merged `main`.

## Release units

| Unit            | Content                                                               | Gate                                            |
| --------------- | --------------------------------------------------------------------- | ----------------------------------------------- |
| R7-1 Functional | B (scope, lookup, distribution) · D-fix (FX control states, resolver) | review (authz/currency) + gates → release       |
| R7-2 Table UX   | A (density button, Table/Grid, viewed marker)                         | UX review + gates; visual → owner preview       |
| R7-3 Visual     | C (dashboards) · E (dark navy triggers) on `feat/r6-visual` + `main`  | **owner visual approval first** (local preview) |

## Ownership (primary files; cross-edits only as minimal documented hooks)

| WS  | Branch / worktree                                                                      | Ports api/web | Owns                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | `feat/r7-grid` `D:/Systems/OMS-r7-grid`                                                | 3705/3701     | `components/master-data/enterprise-data-table.tsx`, `components/shared/data-table/**` (new density button, view toggle, grid card), `app/(shell)/crm/leads/page.tsx`, `config/crm/lead-columns.tsx`, `app/(shell)/store-orders/page.tsx`, `store-order-mobile-card.tsx`, agent leads/orders pages, lead + agent cards, `table.*` i18n (module file). Viewed-by-me marker (API in `leads/**` read-model only: additive migration `LeadView`). |
| B   | `feat/r7-scope` `D:/Systems/OMS-r7-scope`                                              | 3805/3801     | `api/src/sales-scope/**`, `leads/**` (scope, distribution, eligibility), `store-orders` scoping + new advanced lookup module, `permissions/permission-catalog.ts` (+1 migration), distribution/lookup web dialogs (`lead-distribution-modal.tsx`, new `advanced-customer-lookup-dialog.tsx`), users/employee eligibility flag UI. Does NOT edit leads/orders list pages (A owns) — adds only a lookup button hook.                           |
| C+E | `feat/r7-visual` `D:/Systems/OMS-r7-visual` (from `feat/r6-visual` merged with `main`) | 3905/3901     | `components/dashboard/**`, `shared/insight-card.tsx`, `kpi-card.tsx`, `app/(shell)/page.tsx`, `agent/page.tsx` (presentation + failure-honesty), `theme/**`, `globals.css` control tokens, `components/ui/select.tsx`, `button.tsx` `field`, `recipes.css`, `trigger-trial.*` (graduate to default), action-menu triggers, local-override inventory.                                                                                         |
| D   | `feat/r7-fx` `D:/Systems/OMS-r7-fx`                                                    | 4005/4001     | `api/src/accounting/fx/**`, `accounting-reports` account statement native-currency view, `components/finance/fx/**`, `finance/exchange-rates` page, FX docs/ADR; read-only Production evidence scripts under `scripts/acceptance/`.                                                                                                                                                                                                          |

Shared-file arbitration: `ar.ts`/`en.ts` additive only (module files). `schema.prisma`: one additive migration per
workstream (A: LeadView, B: eligibility flag + permission, D: only if needed), integrator merges. A↔E:
`enterprise-data-table.tsx` is A's; E touches only tokens/ui. B↔A: `crm/leads/page.tsx` is A's.

## Findings that drive the work (from recon)

**A.** Density radio lives inside Columns menu (`data-table-view-options.tsx:65-80`), stored in localStorage
`oms.table.<tableId>.density` (device-wide, not per user; only column widths are per-user). A card branch already
exists in `EnterpriseDataTable` (container-query driven, `renderMobileRow`, selection header) → reuse as Grid.
No "viewed" concept exists; `findOne` is a pure read (keep it so). Lead/order status helpers: `lead-columns.tsx`,
`order-status-badges.ts`, `StatusBadge`.

**B.** Scope resolver `sales-scope.service.ts`. Gaps: TEAM scope sees all unassigned leads; `crm.leads.manage` ⇒ ALL;
`shipping.view` returns `{}` in `storeOrderWhere`; `canAccessStoreOrder` opens by id for finance/manage but list is
OWN (inconsistent); `findOne`/`canFulfill` unscoped when userId absent; `sales-orders` documents unscoped; scope
ignores `agentId`; `global-lookup` unmasked, phone-only, not agent-aware. Distribution eligibility = `crm.leads.edit`
only (two copies of the constant); no Sales role key / flag; employmentStatus ignored; dialog shows no exclusions.

**C/E.** Loading/error states already honest on company dashboard; agent recent-orders swallows failure
(`.catch(()=>setRecent([]))`). The string "No data to display" is not in the repo → must be reproduced on the live
UI before concluding. Selector triggers are `bg-selector` (white) via `ui/select.tsx`, `button.tsx` field,
`recipes.css`; 46 SelectTrigger files use shared recipe (no local overrides found); action-menu triggers
(`DropdownMenuTrigger`, 15 files) are `outline`/`ghost`. `feat/r6-visual` has an inert navy trial A (`trigger-trial.css`);
merge needs 2 conflict resolutions in `financial-report*.tsx`.

**D.** `ChartOfAccount.currencyId` is optional and **descriptive only** — nothing compares it to a posting's currency.
Currency/rate live on `JournalEntry` header; lines are EGP-only (no per-line original amount/rate source) → native
balance is derived as (dr−cr)/header rate. Account statement is EGP-only. Revaluation is manual, single rolling run,
no policy/ADR, no period-close check, no UI. CBE import: provider+parser+service+cooldown+advisory lock+dated
overrides implemented; crons in `vercel.json` (`/api/cron/fx-rates` 14:00 and `?slot=late` 20:00 UTC — `slot` param
ignored), gated by `CRON_SECRET`. Whether it actually runs in Production is **unproven** until `sync/runs` is read.

## Tasks, dependencies, evidence

See `tasks.md` (per-workstream checklists + evidence slots). Dependencies: E before C polish (tokens); A card palette
uses semantic tokens from E → A consumes existing `--*-soft` tokens only (no new colours). D Production evidence is
independent and starts immediately (read-only GETs as QA persona via `tmp/.qa.env`).

## Gates

API: typecheck, lint, test, build. Web: typecheck, lint, test, build. One browser pass per release unit.
Demo data tagged `DEMO-R7-20261003-*`. No posted history edited; no Production writes without a reviewed plan.
