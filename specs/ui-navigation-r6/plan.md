# Round 6 — Coordinated UI, navigation & daily UX (company workspace + agent portal)

Status: **ACTIVE** (owner brief 2026-10-01 + addendum). Integrator: session "OMS coordinated UI and
navigation refinement". At start (2026-10-01) Production = `main` = `9aac0fa`; all peer sessions idle;
no dirty worktrees except a formatting-only diff in `detail-workspace.tsx` (left untouched, not ours).

Baseline facts were established by code inspection (five read-only investigations) — see `spec.md`
"Findings" per workstream. Screenshots referenced by the brief ("the attached company dashboard")
were **not attached**; the baseline is the code at `9aac0fa` plus `feat/r5-visual`.

## Release units (kept separately releasable)

| Unit                      | Content                                                                                                                           | Gate                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **R6-1 Shipping handoff** | Addendum §3: converted/created eligible orders reach the Shipping queue; repair of affected records                               | functional — release as soon as reviewed + gates green              |
| **R6-2 Functional UX**    | A navigation/settings/permissions · B shared controls/notifications/tables · C leads/distribution · D report numbers/print dates  | functional — release after review + gates                           |
| **R6-3 Visual**           | E dashboards (company + agent) · report summary cards · dropdown trial A/B — built on `feat/r5-visual` (spec-4, still unreleased) | **owner visual approval first**; nothing in R6-1/R6-2 depends on it |

## Ownership and isolation

Every workstream: own branch from `main` (R6-3 from `feat/r5-visual` merged with `main`), own worktree,
own local DB cloned from `oms`, own ports. **Never `git stash`** (shared across worktrees).

| WS   | Branch / worktree                                                            | DB                         | API/web ports | Owns (primary files)                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---- | ---------------------------------------------------------------------------- | -------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SHIP | `feat/r6-shipping-handoff` `D:/Systems/OMS-r6-ship`                          | `oms_r6_ship`              | 3105 / 3101   | `api/src/store-orders/shipments/**`, `store-order-fulfillment-gate.ts`, the queue hook points in `workflow/workflow-engine.service.ts` (convert), `store-orders.service.ts` (create), payment-declaration/payment-sync (hook only), web `app/(shell)/shipping/**`, `config/shipping/**`, `services/shipping-service.ts`, repair script `api/scripts/r6/`                                                                                                      |
| A    | `feat/r6-navigation` `D:/Systems/OMS-r6-nav`                                 | `oms_r6_nav`               | 3205 / 3201   | `navigation/**`, `types/navigation.ts`, `components/layout/app-sidebar.tsx`, `route-access-guard.tsx`, `proxy.ts`, login page redirect logic (not the password field), `permissions/permission-catalog.ts`, settings pages' gating, one permissions migration, agent-portal i18n label, `agent-portal.service.ts` dashboard scoping fix                                                                                                                       |
| B    | `feat/r6-shared-controls` `D:/Systems/OMS-r6-controls`                       | `oms_r6_controls`          | 3305 / 3301   | `components/shared/form-fields/password-field.tsx` (+ standalone `PasswordInput`), new shared `CopyButton`/`useCopyToClipboard`, `semantic-value.tsx`, `components/ui/sonner.tsx`, `lib/toast.ts`, toast block of `globals.css`/`tokens.css`, `components/master-data/enterprise-data-table.tsx`, `components/shared/data-table/**` (except `list-surface.tsx`/`filter-popover.tsx` visuals owned by R6-3), print widths in `generic-list-print-template.tsx` |
| C    | `feat/r6-leads` `D:/Systems/OMS-r6-leads`                                    | `oms_r6_leads`             | 3405 / 3401   | `api/src/leads/**` (follow-ups, distribution), one Lead migration, web `components/crm/**`, `app/(shell)/crm/leads/**`, agent lead screens (read-only display)                                                                                                                                                                                                                                                                                                |
| D    | `feat/r6-report-format` `D:/Systems/OMS-r6-reports`                          | `oms_r6_reports`           | 3505 / 3501   | `lib/money.ts`, `lib/date.ts` (range/as-of labels), `lib/business-date.ts`, `accounting/financial-report/report-money.tsx`, `financial-report-export.ts`, `summary-format.ts`, `report-filter-bar.tsx` period label, `components/print/**` (except list widths owned by B), agent statement formatting                                                                                                                                                        |
| E    | `feat/r6-visual` `D:/Systems/OMS-r6-visual` (from `feat/r5-visual` + `main`) | main `oms` (read-only use) | 3605 / 3601   | `components/ui/**` (select, button `field`, dropdown triggers), `theme/**`, control tokens in `globals.css`, `components/dashboard/**`, `shared/insight-card.tsx`, `shared/kpi-card.tsx`, `financial-report-summary.tsx` + `financial-report.tsx` header (visual), `app/(shell)/page.tsx`, `app/(shell)/agent/page.tsx` (presentation only), `list-surface.tsx`, `filter-popover.tsx`                                                                         |

Cross-ownership rule: a workstream edits another's file only for a minimal, documented hook and says
so in its report. Shared i18n (`ar.ts`/`en.ts`): additive keys only; prefer module files
(`i18n/messages/modules/*`). Each workstream adds at most **one** additive Prisma migration with its
own timestamp; no destructive migration. The integrator resolves `schema.prisma` / i18n merges.

## Integration owner

The integrator (this session) alone merges branches, owns shared tokens arbitration, runs gates on
merged `main`, pushes, and verifies Production. Workstreams never push and never deploy.

## Release sequence

1. SHIP → independent review (rules + authorization) → fix → merge → gates on `main` → push → verify
   Production SHA → run the repair (dry-run report first; apply only the scoped, audited fix).
2. A, B, C, D → independent review (authorization, distribution behaviour) → fix → merge → gates → push.
3. E → local preview, before/after screenshots (company + Agent Admin + Agent Sales, AR/EN, light/dark,
   1440/390) → **owner approval** → merge `feat/r5-visual` + `feat/r6-visual` → gates → push.

## Quality gates (each workstream, then merged `main`)

API: `pnpm --filter api typecheck`, `lint`, `test` (real local Postgres), `build`.
Web: `pnpm --filter web typecheck`, `lint`, `test`, `build`.
Browser: one pass per release unit on the affected pages, roles listed in the brief.

Demo data tagged `DEMO-R6-20261001-*`. No real financial history is edited or deleted.
