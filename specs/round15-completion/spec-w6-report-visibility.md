# W6 — Sales-report visibility (company and agent)

Requirements: 6.1–6.5 · Decision D15-18. Database for tests: `oms_r15_w6`. Progress log: `progress-w6.md`.

## Current state (survey S6 — read it)

- `/sales-reports/live|performance` (`reports.sales.view`): scope from `SalesScopeService` — OWN/TEAM correct, but
  `store-orders.view_all` → ALL; OWN gets a meaningless "rank 1 of 1".
- **Leak**: `GET /sales/performance` (dashboard KPIs + ranking, `sales-performance/**`) has no permission guard and a
  NONE scope falls through to the full company leaderboard with names; it ignores `canViewAllOrders` for the ranking;
  it uses `createdAt` + server time while `/sales-reports` uses `orderDate` + Cairo.
- `crm.leads.manage` without a managed team → ALL everywhere.
- `/sales-targets/ranking` company-wide for `hr.sales-targets.view`; `/sales-targets/me` correct.
- Agent portal: AGENT_ALL with `agent.records.view_all` (delegable to SALES users) shows every employee's figures;
  `agent.statement.view` shows agent-wide money.

## Foundation already in place

`reports.sales.view_all` (catalog + migration: granted to holders of `reports.sales.view` + `crm.leads.manage` who
manage no active team — read migration 20261009100500), `agent.reports.view_team` (ADMIN preset + existing admins).

## Required behaviour

1. **One report-scope resolver** (`sales-reports/report-scope.ts` or inside `SalesScopeService` as a separate
   method — list/by-id scopes stay exactly as they are): company → ALL only with `reports.sales.view_all` (or super
   admin); TEAM for a sales-team manager (own + members); otherwise OWN; no `reports.sales.view` → no report endpoint.
   `store-orders.view_all` and `crm.leads.manage` never widen reports. Agent → TEAM (whole agent) only with
   `agent.reports.view_team`; otherwise OWN. Used by every report surface below.
2. **Surfaces** (6.4): `/sales-reports/*`, `/agent-portal/sales-reports/*`, `GET /sales/performance` (add the guard:
   authenticated internal user with `dashboard.view` OR `reports.sales.view` OR `crm.leads.view` OR
   `store-orders.view` — pick the narrowest that keeps today's legitimate users, document it; NONE → empty), dashboard
   panels, `/sales-targets/ranking` (HR ranking: `hr.sales-targets.view` keeps company-wide for HR — but a holder who is
   also only a sales employee? Document: HR ranking is an HR screen; the sales ranking follows the report scope),
   any drill-down / export added.
3. **Own rank (6.1)**: OWN scope returns the caller's own figures plus `rank: { position, of }` computed over the
   whole company (company) or the whole agent (agent) without returning any other employee's name or figures. TEAM
   returns members' rows + rank within the team (and own company position). ALL returns everyone. Dashboard ranking
   panel shows "Your rank: 3 of 12" for OWN instead of hiding it.
4. **Consistency**: dashboard KPIs use the same date field (`orderDate`) and Cairo business days as `/sales-reports`
   (reuse `sales-metrics.ts` helpers), so the same user sees the same numbers in both places.
5. **Audit (6.5)**: `progress-w6.md` lists every permission that can widen any sales figure today and after the
   change, the job-title templates holding them (query the local DB clone and, read-only through the API, Production
   job-title templates if accessible), and the parity of the migration (who gained `view_all`, who narrowed).
6. **Web**: dashboard ranking panel (own rank card for OWN), reports page tabs (Employees / Teams / Comparison only
   when the scope has others), agent reports (team tab only with `agent.reports.view_team`). Never rely on hiding: the
   API already omits the data.

## Tests

Per surface × scope: salesperson (OWN) sees own figures + own rank only (no other names anywhere in the JSON); team
manager sees team; `reports.sales.view_all` sees all; `store-orders.view_all` alone does NOT widen reports;
`crm.leads.manage` without team and without `view_all` → OWN for reports; NONE user → `/sales/performance` empty or
403; agent SALES with `agent.records.view_all` but without `agent.reports.view_team` → own only; agent admin → team;
another agent never visible. Dashboard vs report figures equal for the same user / period.
