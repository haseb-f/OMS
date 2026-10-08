# W6 progress — sales-report visibility (company and agent)

Spec: [spec-w6-report-visibility.md](spec-w6-report-visibility.md) · Requirements 6.1–6.5 · Decision D15-18 ·
DB `oms_r15_w6`.

## Status (newest first)

- 2026-10-07 (3) — Web done: dashboard ranking panel shows "Your rank X of N" for OWN (no longer hidden), TEAM header
  says the company position and finds the own row by id; reports tabs follow the API scope (`reportTabs`: own scope →
  Live / My performance / Payment mix; AGENT_ALL → no company Teams tab; TEAM / ALL → all), My performance = own
  figures + `OwnRankCard`, TEAM shows the company-position line, ALL shows "orders without an owner" as a separate
  unranked row, dead NONE branches removed. Web specs + mutations below. **Blocked on integration request 1** (contract
  types in `apps/web/src/services/*`, not in the W6 row).
- 2026-10-07 (2) — Review of the API against the spec: complete. Visibility integration spec
  (`sales-reports/report-visibility.integration.spec.ts`) extended (team manager + `store-orders.view_all` stays TEAM
  on reports and dashboard, Live figures per scope on the fixture day) and green; 4 mutations proven (below).
  Permission audit done (below). Next: web.
- 2026-10-07 — API: one report-scope resolver (`SalesScopeService.resolveReportScope` + `resolveAgentReportScope`),
  `/sales-reports/*` + agent copy on it, own rank (`ownRank {position, of}`), unassigned row split out, dashboard
  (`/sales/performance`) gated + on the report scope + orderDate/Cairo through the reports' own queries. Existing
  `sales-reports` specs updated to the new keys and green.

## Decisions taken inside the spec

- **Report scope** (`sales-scope/sales-report-scope.ts`, one resolver for every figure surface): company ALL only with
  `reports.sales.view_all` (Super Admin included via the resolver); TEAM for an active sales-team manager (own +
  members, the same `managedTeamOwnerIds` the record scope uses); otherwise OWN. Agent: AGENT_ALL only with
  `agent.reports.view_team`, otherwise AGENT_OWN; the agent boundary is never optional. The list / by-id record scope
  (`SalesScopeService.resolve`) is unchanged — `crm.leads.manage` / `store-orders.view_all` / `agent.records.view_all`
  still widen lists, never figures. There is no NONE report scope: `/sales-reports` needs `reports.sales.view`, the
  dashboard needs `crm.leads.view` or `store-orders.view`.
- **Dashboard gate** (`GET /sales/performance`): `crm.leads.view` OR `store-orders.view` (403 otherwise) — the
  narrowest set that keeps today's legitimate users: the web shows the sales panels on exactly these two keys.
  Agent / partner tokens are refused by `JwtAuthGuard`. Figures: the report scope; orders by `orderDate` in Cairo
  business days through `SalesReportsService.periodTally` / `ownStanding` / `employeeRanking` (Today = the Live
  "today" card, This month = "this month", This week = Monday → today); `delivered` = orders placed in the period now
  DELIVERED (the Live card's status count). Lead KPIs use `reportLeadWhere` (internal leads of the scope's owners).
- **Own rank** (6.1): `ownRank {position, of}` = competition rank over the whole company (company) / the whole agent
  (agent) by the report's rank key; `position` null when the caller has no order in the period. OWN responses contain
  the caller's row only; TEAM returns the team ranked within itself + the caller's company position; ALL everyone,
  with agent orders and orders without an owner as separate unranked rows (`agents`, `unassigned`).
- **HR ranking** (`/sales-targets/ranking`): an HR screen (`hr.sales-targets.view`), company-wide by design, not a
  sales report. Sales staff read their standing through `/sales-targets/me` (own row + `of`) and the sales ranking
  through the report scope. The audit checks that no sales job title / sales user holds the HR key (0 on the clone).
- **No export / drill-down endpoint exists** in sales reports; drill-downs open `/store-orders` and `/crm/leads`,
  which are record-scoped server-side (unchanged).

## Tests and mutation proof (API)

`DATABASE_URL=postgresql://oms:oms@localhost:5434/oms_r15_w6?schema=public pnpm --dir D:/Systems/OMS/apps/api exec jest --runInBand src/sales-reports/report-visibility.integration.spec.ts`
→ 13/13. Mutations (each run, each failing, each restored):

| Mutation                                                                                   | Failing tests                                    |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `resolveReportScope` also widens on `store-orders.view_all` (the old rule)                 | 5 (resolver, browse keys, MGR2 report/dashboard) |
| `SalesPerformanceService.dashboard` without `assertCanRead`                                | dashboard gate (NONE / HR-only → 403)            |
| OWN row keeps its in-scope rank (`row.rank`) instead of `ownRank.position`                 | reports OWN, agent OWN                           |
| `resolveAgentReportScope` on `agent.records.view_all` instead of `agent.reports.view_team` | resolver (GVIEW → AGENT_OWN)                     |

## Permission audit (6.5) — read-only SQL on `oms_r15_w6` (migrated clone with test data)

Effective = (individual GRANT ∪ job-title template) − DENY, active users. Script: run from the scratch SQL in the
session; numbers below.

**Who widens a sales figure — before → after**

| Key / condition                                     | Before R15                                                                           | After R15 (D15-18)                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------- |
| Super Admin                                         | everything                                                                           | everything (via `hasPermission`)            |
| `crm.leads.manage` without a managed team           | ALL on `/sales-reports`, dashboard KPIs + company leaderboard                        | own figures + own rank (lists unchanged)    |
| `store-orders.view_all`                             | ALL on `/sales-reports` (even for a team manager), dashboard order KPIs company-wide | nothing (lists unchanged)                   |
| active sales-team manager                           | TEAM                                                                                 | TEAM (+ own company position)               |
| no leads/orders view (record scope NONE)            | **dashboard: full company leaderboard with names** (no guard)                        | 403                                         |
| `reports.sales.view_all` (new)                      | —                                                                                    | ALL (reports need `reports.sales.view` too) |
| `agent.records.view_all` (delegable to SALES users) | AGENT_ALL on agent reports (every colleague's figures)                               | nothing for figures (lists unchanged)       |
| `agent.reports.view_team` (new, ADMIN preset)       | —                                                                                    | AGENT_ALL (the caller's agent only)         |
| `hr.sales-targets.view`                             | company-wide HR ranking                                                              | unchanged — HR screen (documented above)    |
| `hr.commissions.view`, `hr.kpi-evaluations.view`    | company-wide HR screens                                                              | unchanged — HR keys, out of D15-18          |
| `agent.statement.view`                              | agent-wide money on the agent dashboard                                              | W1's dashboard (see integration requests)   |

**Holders on the clone** (internal / agent users): `crm.leads.manage` 73 / 0 · `store-orders.view_all` 1 / 0 ·
`reports.sales.view` 3 / 0 · `reports.sales.view_all` 1 / 0 · `hr.sales-targets.view` 5 / 0 ·
`hr.commissions.view` 5 / 0 · `hr.kpi-evaluations.view` 5 / 0 · `agent.records.view_all` 1 / 250 ·
`agent.reports.view_team` 0 / 254 · `agent.statement.view` 1 / 250 · Super Admins 147 · active team managers 14.

**Job-title templates:** `job_title_permissions` is empty on the clone (12 titles, 0 rows) — R14 started every
template empty, so no template holds any widening key. Production templates were not read: that needs an
authenticated Production session, which this stream does not use (lead / owner to check with the same query).

**Migration parity (`20261009100500`)**: company sales reports — 1 user had ALL before (Super Admin with
`crm.leads.manage`) and keeps it; 0 gained `view_all` without having had company-wide reports; 0 narrowed on the
reports page. Dashboard — 147 Super Admins ALL → ALL; 14 managers TEAM → TEAM; 225 OWN → OWN; 200 users without any
leads / orders view went from the company leaderboard to 403 (the leak); **57 `crm.leads.manage` holders without a
team and without `reports.sales.view` went from company-wide dashboard figures to OWN** (incl.
`qa-sales-manager@oms.haseb.org`, `demo-r7-mgr@oms.local`; the rest are test fixtures) — see integration request 2.
Agent: 250 ADMIN users hold both keys (unchanged view), 4 ADMIN users hold `view_team` without `agent.dashboard.view`
(no report access either way); 0 SALES users hold `view_team`.

## Web (6.1 / 6.4)

- `components/reports/sales-report-tabs.ts` (new): `reportTabs(scope)` / `isOwnReportScope` — the one tab rule.
- `components/reports/own-rank-card.tsx` (new): `OwnRankCard` (InsightCard) — "Your rank · 3 of 12" + population
  line, or "Not ranked yet · N ranked"; shared by the dashboard and the reports.
- `components/reports/sales-reports-view.tsx`: scope from the Live answer drives the tabs; `OwnTab`; TEAM company
  position line; `SeparateRow` for the unassigned and agents rows (one component, no duplicate markup); NONE / null
  name branches removed (the API never sends them).
- `components/dashboard/sales-panels.tsx` `RankingPanel` (props unchanged): OWN → `OwnRankCard`; TEAM header "Your
  company rank"; own row by `user.id` (team ranks differ from the company position). `dashboard-overview.tsx`: the
  ranking panel renders for every scope.
- `app/(shell)/agent/reports/page.tsx`: doc comment (team = `agent.reports.view_team`).
- i18n: `salesVisibility.*` (en/ar, new keys); `salesReports.tabs.own`, `employees.unassigned(Hint)`; removed
  `salesReports.scope.NONE`, `salesReports.teams.notAvailable` (unreachable).

Tests: `pnpm --dir D:/Systems/OMS/apps/web exec vitest run src/components/dashboard src/components/reports` → 8 files,
41 tests. New: `sales-report-tabs.spec.ts` (4), `sales-reports-view.spec.tsx` (6), `dashboard-overview.spec.tsx` (1),
`sales-panels.spec.tsx` RankingPanel (3). Mutations (each failing, restored): overview back to
`scope !== "OWN"` → overview spec fails; `reportTabs` without the own branch → 5 tab/view tests fail; `RankingPanel`
without the OWN branch → 2 RankingPanel tests fail.

Typecheck: `tsc --noEmit` with the request-1 contract applied (scratch tsconfig mapping only the two service modules)
→ 0 errors in W6 files. Against the current contract files the W6 web files do not compile (missing `ownRank` /
`unassigned`, nullable `userId` / `name`, `scope.NONE` key) until request 1 is applied.

## Integration requests for the lead

1. **Web API contract types (blocking for the web typecheck)** — `apps/web/src/services/sales-reports-service.ts`
   and `sales-performance-service.ts` are outside the W6 row and used only by W6 components. Apply:

   ```diff
   --- sales-reports-service.ts
   -export type SalesReportScope = "ALL" | "TEAM" | "OWN" | "NONE" | "AGENT_ALL" | "AGENT_OWN";
   +/**
   + * R15 (D15-18) — whose figures the response holds: ALL only with
   + * `reports.sales.view_all`, TEAM for a sales-team manager, otherwise OWN;
   + * agent: AGENT_ALL only with `agent.reports.view_team`, otherwise AGENT_OWN.
   + */
   +export type SalesReportScope = "ALL" | "TEAM" | "OWN" | "AGENT_ALL" | "AGENT_OWN";
    export interface RankedEmployee extends SalesStats {
   -  userId: string | null;
   -  name: string | null;
   +  userId: string;
   +  name: string;
    }
   +/**
   + * The caller's own standing over the whole company (company) or the whole
   + * agent (agent): position + count only, never another employee's name or
   + * figure. `position` is null when the caller has no order in the period.
   + */
   +export interface OwnRank {
   +  position: number | null;
   +  of: number;
   +}
    export interface PerformanceReport {
   +  /** In scope, ranked among themselves; OWN / AGENT_OWN: the caller's row only (rank = own position). */
      employees: RankedEmployee[];
      employeesTruncated: boolean;
   +  ownRank: OwnRank;
      teams: RankedTeam[] | null;
   +  /** Agent orders — ALL only, never ranked. */
      agents: SalesStats | null;
   +  /** Company orders without an owner — ALL only, never ranked. */
   +  unassigned: SalesStats | null;
      paymentMix: PaymentMixRow[];
    }
   --- sales-performance-service.ts
   -  scope: "ALL" | "TEAM" | "OWN" | "NONE";
   +  /** The report scope (R15 D15-18): ALL only with `reports.sales.view_all`. */
   +  scope: "ALL" | "TEAM" | "OWN";
    ranking: {
   -    self: { rank: number; orders: number; of: number };
   -    leaderboard: { rank: number; userId: string | null; displayName: string; orders: number }[];
   +    /** Own company position (null = no order in the period) and valid orders. */
   +    self: { rank: number | null; orders: number; of: number };
   +    /** The caller's scope ranked within itself; always empty for OWN. */
   +    leaderboard: { rank: number; userId: string; displayName: string; orders: number }[];
    };
   ```

2. Migration `20261009100500` grants `view_all` only to `crm.leads.manage` holders who ALSO hold
   `reports.sales.view`. D15-18 names all company-wide sales managers (`crm.leads.manage`, no team); the home
   dashboard is a figure surface too, so the 57 holders above narrow there. For parity drop the
   `reports.sales.view` condition (the reports page still needs `reports.sales.view`, so nobody gains the page).
3. W1 `agent-portal.service.ts dashboard()` scopes its aggregate figures with `resolveAgentVisibility` (records): a
   SALES user delegated `agent.records.view_all` sees agent-wide fulfilment counts (no per-employee rows — the team
   breakdown is already on `agent.reports.view_team`). If agent figures must follow D15-18 like the reports, use
   `resolveAgentReportScope` (exported from `agents/common/agent-visibility.ts`) for the figures.

## Open

- Request 1 (contract types) must land before the web typecheck / build is green.
- Requests 2 and 3 are owner / lead decisions; the W6 code is correct either way.
- Production job-title templates not audited (needs an authenticated Production session).
- No browser pass done (no build / dev server in this stream); the affected pages are `/dashboard`,
  `/reports/sales`, `/agent/reports`.
