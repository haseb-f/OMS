# SPEC E — Professional sales reporting and Live reports

Audit: `audit/E-sales-reporting.md`. `/reports/sales` is a Coming-soon stub, so this round fills it (no duplicate screen). The home dashboard performance panel stays (lead funnel), unchanged.

## Metric definitions (single source: `apps/api/src/sales-reports/sales-metrics.ts`)

- **Sales order**: `StoreOrder` with `deletedAt = null`, counted by `orderDate` in the business calendar (Africa/Cairo).
- **Valid order**: fulfillment status code ≠ `CANCELLED`. Cancelled orders are shown separately, never in sales amount or ranking.
- **Returned**: fulfillment status `RETURNED` — included in orders (it was a sale) and shown as a separate count; refunds are a finance concept and not deducted here.
- **Sales amount**: `payableTotal` (legacy null → Σ item `agreedAmount`), **grouped by order currency**; currencies are never added together.
- **Sales ≠ collections**: collections (verified payments) are not part of these cards.
- **Owner attribution**: current `employeeId` (the record owner at report time); agent orders by `agentId`.
- Periods (Cairo): Today; Yesterday; **Last 7 days = today and the 6 previous days**; This month = 1st → today; Last month = full previous month.

## E1. Live (`/reports/sales` tab "Live / تقارير Live")

One request `GET /sales-reports/live` returns five period buckets: order count, valid count, cancelled count, returned count, per-currency amounts, status breakdown. Refresh: manual button + auto every 60 s **only while the tab is visible**, no overlapping requests, last refresh time, stale (> 3 min) and error banners kept with last data.

## E2/E3. Employees, teams, comparison

`GET /sales-reports/performance?from&to&rankBy=count|amount&currency=` → employees (≤ 200, single grouped query) and teams. Ranking by valid-order count by default; by amount only **within one chosen currency** (no conversion). Tabs: Employees (cards ranked), Teams (cards + members), Comparison (ranked bar chart + table). Payment mix (prepaid vs COD per currency) added as a fourth tab — fills a gap (no such report exists).

## Scope / permissions

New `reports.sales.view` (granted by migration to roles holding `reports.view`). Data scope = `SalesScopeService` (OWN / TEAM / ALL) for company users; agent portal users get the same endpoints under `/agent-portal/sales-reports/*` scoped by `resolveAgentVisibility` (admin = agent's records, sales = own) — no margins / cost exposed. Company reports exclude agent orders (`agentId = null`) unless the viewer has ALL scope (then shown as a separate "Agents" row, not mixed into employees).

## UI

Shared `ReportCard` built on `InsightSurface` (soft glass, semantic tone, icon, large number, per-currency lines), shared lightweight SVG `BarChart` (no new dependency), `useLiveRefresh` hook. RTL/LTR, light/dark, mobile.

## Verification

API test with known seeded orders across Cairo midnight, two currencies, cancelled/returned → exact counts and per-currency sums; scope tests (OWN vs ALL vs agent).
