# R13 Plan — workstreams, file ownership, gates

Master Agent = this session. Foreground workers only (background workers die with the turn). Explicit-path commits, no
`git stash`, absolute paths (parallel Bash shares cwd). Working DB: `oms_r13` (clone of `oms_r7_final`, Docker `oms-postgres:5434`).
Other worktrees (`OMS-r8-blue`, `OMS-r9-brand-grid`) are untouched.

## Phases and ownership

| Phase | Workstream                                                                                                                                                                        | Owns (exclusive)                                                                                                                                                                                                                                                 | Depends on                        |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 0     | **Master**: spec, schema.prisma, migration SQL, permission catalog entries, seeds for numbering series                                                                            | `prisma/schema.prisma`, `prisma/migrations/*r13*`, `permissions/permission-catalog.ts`, `prisma/seed.ts`                                                                                                                                                         | —                                 |
| 1a    | **A Product master API**                                                                                                                                                          | `src/products/**` (incl. components→recipes read-compat), `import-center/handlers/products-import.handler.ts`, `investment-opportunities/shared/*`, `product-categories/*`                                                                                       | 0                                 |
| 1b    | **B Inventory core + recipes + assembly**                                                                                                                                         | `src/inventory/**`, new `src/recipes/**`, new `src/assembly/**`, new `src/units/unit-conversion.service.ts`, `src/physical-count/**`, `accounting/inventory-valuation/**`, `accounting/posting-providers/assembly-*`, `inventory-adjustment-posting.provider.ts` | 0                                 |
| 2a    | **C Kit fulfillment + sales/costing integration + landed cost**                                                                                                                   | `src/sales/**`, `src/store-orders/store-orders.service.ts` (generateInvoice region only), `src/agents/finance/agent-fulfillment.service.ts`, `accounting/posting-providers/{sales-invoice,sales-return}-*`, `src/landed-cost/**`, `src/purchasing/returns/**`    | 1a, 1b                            |
| 2b    | **D Web UI** (product form, recipe tab, assembly pages, kit availability, owner/eligibility panels, integrity report page, i18n en+ar)                                            | `apps/web/src/**`                                                                                                                                                                                                                                                | API contract in `api-contract.md` |
| 3     | **E Verification**: integrity service/script, migration dry-run + before/after, integration tests (DB), browser journeys A–F (Playwright, demo-tagged `[R13-DEMO]`), Arabic guide | `scripts/acceptance/r13/**`, `src/inventory/integrity/**`, `specs/product-inventory-costing/*`                                                                                                                                                                   | all                               |
| 4     | **Independent reviewers**: inventory/accounting reviewer, security reviewer (read-only, report findings) → fixes                                                                  | —                                                                                                                                                                                                                                                                | 3                                 |
| 5     | **Owner review** of local build (simplified product form + workflows); approvals; release process                                                                                 | —                                                                                                                                                                                                                                                                | 4                                 |

## Approval gates (nothing destructive or historical without the owner)

1. Local review of product form + workflows (desktop/mobile, AR/EN) → owner approval before any push to `main`.
2. Historical-record review list (`migration.md`) presented before any correction is applied.
3. Production DB: no migration is applied outside the established deploy path; no destructive migration (drop
   `product_components`, drop `Product.type`) without explicit approval.

## Quality gates per workstream

typecheck (`pnpm --dir … exec tsc --noEmit`), ESLint, unit/integration tests for the touched area, then the full API
suite on the merged tree, production builds of api + web. Browser verification: one pass at the end (journeys), per CLAUDE.md.
