# Plan — enterprise-ui-overhaul

Baseline is `0426316` (HEAD = origin/main = Production). The inventories are `inventory-routes.md`,
`inventory-components.md`, `inventory-reports.md` and `inventory-docs-forms.md`. The design is in
`design-system.md`.

## Approach

The app already routes almost every screen through shared components: `AppShell`, `PageWorkspace`,
`EnterpriseDataTable`, `CommercialDocumentEditor` and `FinancialReport`. So the overhaul works from the
shared layers outward:

1. **Foundation (Master), done first.**
   - Tokens: a color set per tone, focus, placeholder, table, sidebar, shell, density, radius,
     z-index, and the `num` utility.
   - Primitives: flat buttons with a `field` variant, one field recipe, AA badges, overlays without
     blur or zoom.
   - Shell: flush sidebar, breadcrumbs inside the 48px top bar, token gutters, 1720px content,
     viewport-fill hook.
2. **Shared systems**, built by parallel implementers. Ownership doesn't overlap (see the table
   below).
3. **Sample screens:**
   - dashboard `/`
   - `/crm/leads`
   - `/store-orders`
   - `/sales/invoices/new`
   - `/reports/finance?report=trialBalance`
   - `/store-orders/[id]` on a phone

   Render them locally and fix what shows.

4. **Module adoption:** the remaining gaps from `inventory-routes.md`:
   - investors raw tables
   - raw `ui/table` users
   - raw Dialogs
   - bespoke editors
   - ComingSoon stubs, which stay as they are
5. **Independent review:** visual, RTL and accessibility, read-only, then fixes.
6. **Release:**
   - Gates: web tests, typecheck, lint, the web and API builds, and the contrast check.
   - Logical commits, then push, then check the Production SHA.
   - Production browser pass across representative workflows and every variant.
   - "After" baseline plus the Arabic guide screenshots.

## Ownership (non-overlapping)

| Track       | Owns (may edit)                                                                                                                                                                                                                                                                                                                                                 | Must not edit                 |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Master      | `app/globals.css`, `theme/*`, `components/ui/*` (except table.tsx), `components/layout/*`, `specs/enterprise-ui-overhaul/*`, `scripts/design/*`, `scripts/acceptance/ui-baseline.mjs`                                                                                                                                                                           | —                             |
| SC-TABLE    | `components/master-data/enterprise-data-table.tsx` (+ `components/master-data/*` table/list parts), `components/shared/data-table/*`, `components/ui/table.tsx`, `components/shared/page-workspace.tsx`, `page-header.tsx`, `truncate-text.tsx`, `stacked-cell.tsx`, `semantic-value.tsx`                                                                       | tokens, reports, editors      |
| SC-REPORTS  | `components/accounting/financial-report/*`, `components/accounting/report-filter-bar.tsx`, `app/(shell)/reports/**`, `lib/money.ts` (+ number formatting helpers), report print/export builders                                                                                                                                                                 | EDT, editors, tokens          |
| SC-DOCS     | `components/documents/*`, `components/sales/*`, `components/financial-transactions/*`, `components/accounting/journal-entry-lines-grid.tsx`, `components/purchasing/*` editor parts, `components/store-orders/*`, `app/(shell)/page.tsx` + dashboard components, `components/shared/kpi-card.tsx`, `detail-workspace.tsx`, `money-input.tsx`, `money-value.tsx` | EDT, reports, tokens          |
| SC-FEEDBACK | `components/shared/enterprise-modal.tsx`, `confirmation-dialog.tsx`, `empty-state.tsx`, `error-state.tsx`, `coming-soon*.tsx`, `components/business/status-badge.tsx` + badge mappers, `components/ui/sonner.tsx`, `lib/toast*`, `components/print/*`, the 15 raw-Dialog files listed in inventory-components D7                                                | EDT, reports, editors, tokens |

Page files outside these folders are changed only by whichever track's shared change requires it,
limited to prop or class adoption. Anything more is left to the adoption phase (ADOPT).

## Risks

- **Financial accuracy:** presentation only. Report values come from the same API, and the reports
  track must keep every figure unchanged. Reconciliation is checked against the API on Production
  after release.
- **Automation selectors:** keep `data-testid`s and the ARIA names the acceptance scripts use, or
  update the scripts in the same change.
- **Viewport fill:** a list page that renders content after the grid could be cut off. The
  viewport-fill hook only activates when a list workspace opts in with `data-viewport-fill`.
