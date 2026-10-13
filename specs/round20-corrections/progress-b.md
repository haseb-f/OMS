# R20 stream B progress — employee performance by period

Branch `feat/r20-employee-periods` (worktree `D:/Systems/OMS/.claude/worktrees/agent-a47bd2a1236c17c02`), demo DB
`oms_r20_b`, integration DB `oms_r20_int`. Spec: `README.md` §B.

## What changed

The **Employees** tab (company TEAM / ALL, agent AGENT_ALL) and **My performance** (OWN / AGENT_OWN) of the shared
`SalesReportsView` (`/reports/sales`, `/agent/reports`) now show one outer card per employee with five period boxes —
Today / اليوم, Yesterday / أمس, Last 7 days / آخر 7 أيام, This month / هذا الشهر, Last month / الشهر الماضي. Each box:
valid orders (the figure), sales value per order currency (one line each, never added together), orders / cancelled
(danger when > 0) / returned (attention when > 0). Live, Teams, Comparison and Payment mix are unchanged (the custom
date range + rank-by stays on Comparison / Teams / Payment mix). For ALL, orders without an owner and agent orders are
two separate period cards after the list (never ranked, never in the list).

## Period boundaries (= the Live report, `livePeriodRanges`, Africa/Cairo business days)

| Period      | Inclusive Cairo dates                           | Example on 13 Oct 2026 |
| ----------- | ----------------------------------------------- | ---------------------- |
| Today       | today                                           | 13 Oct                 |
| Yesterday   | today − 1                                       | 12 Oct                 |
| Last 7 days | **today and the 6 previous days (incl. today)** | 7 – 13 Oct             |
| This month  | the 1st → today                                 | 1 – 13 Oct             |
| Last month  | the full previous calendar month                | 1 – 30 Sep             |

Query bounds: `order_date >= start(from) AND order_date < start(to + 1)` (Cairo midnight in UTC). The boundaries are
in the response (`periods`) and stated once above the cards ("Last 7 days = today and the 6 previous days").

Qualifying-order rule = the Live report's (`sales-metrics.ts`): not deleted; valid = fulfillment code ≠ CANCELLED
(cancelled counted apart, never in an amount); RETURNED stays a sale (counted, amount included, shown apart); refunds
are finance and not deducted; amount = `payableTotal`, else Σ live line agreed amounts; owner = current `employeeId`.

## API — `GET /sales-reports/employee-periods`, `GET /agent-portal/sales-reports/employee-periods`

`?page=1&pageSize=10` (pageSize ≤ 50). Response: `scope`, `periods` (bounds), `rankPeriod: thisMonth`,
`employees[] {userId, name, reference (HR employee code, else username), rank, periods[5]}`, `page`, `pageSize`,
`total`, `ownRank`, `unassigned` / `agents` (ALL only).

Query design (`SalesReportsService.employeePeriods`): ONE grouped SQL statement — orders joined to a `VALUES` table of
the five ranges (each order joins every period it falls in; shared helper `periodJoinSql`, now also used by the Live
tallies), restricted to the window min(start)…max(end) on the indexed `order_date`, grouped by employee × period ×
currency × status; window functions give this month's competition rank (`RANK() … month_valid DESC`, only employees
with an order this month) and the page order (`ROW_NUMBER`: ranked first, then by name); `LIMIT`/`OFFSET` by employee
in SQL, `total` from the same statement. Plus, in parallel: the caller's own standing (existing `ownStanding`, this
month) and — ALL only — one grouped query for the unassigned / agents rows; then one `findMany` for the page's names /
references. 3–4 queries per page regardless of employees × periods; never a request per employee or per period. The
web asks once per page (60 s refresh while visible, like Live).

## Scope rules (the existing report scope, unchanged)

`companyScope` → `SalesScopeService.resolveReportScope`; `agentScope` → `resolveAgentReportScope`; filter = the same
`orderFilter` as Live / performance.

- OWN (company) / AGENT_OWN: only the caller's card (shown even with no orders) and the caller's position this month
  over the whole company / agent (position + count only).
- TEAM (sales-team manager): own + team members, ranked within the team; the manager's company position said once.
- ALL (`reports.sales.view_all` / Super Admin): every company employee; agents and unassigned as separate rows.
- AGENT_ALL (`agent.reports.view_team`): the caller's agent's employees only; another agent never.
- Agent tokens never reach the company endpoint and vice versa (403). This tab has no export (checked: the sales
  reports have no export endpoint or button), so nothing else can leak.

## Value proof

- `apps/api/src/sales-reports/employee-periods.integration.spec.ts` (9 tests, HTTP + DB): exact figures across Cairo
  midnight, the exact first instant of "last 7 days", the 7-day / month / previous-month edges, cancelled / returned /
  deleted, two currencies; **every box of every employee on every page (ALL) equals `live()` of that employee alone**;
  rank = `employeeRanking(this month, count)`; pagination (no duplicates, rank order, total); OWN / TEAM / ALL / agent
  admin / agent sales / other agent isolation over HTTP; validation (pageSize 51, page 0 → 400). Mutation-checked
  (rank order reversed → fails).
- Demo stack (`scripts/acceptance/r20/r20-b-verify-periods.mjs`, independent SQL with `AT TIME ZONE 'Africa/Cairo'`
  dates): **100 boxes, 0 mismatches** over admin (ALL, 8 employees), sales (OWN), sales2 (ALL), agent (AGENT_ALL,
  2 employees of its own agent), agent2 (AGENT_OWN); the own card = that persona's Live report (sales, agent2).
  `evidence/b/after/value-proof.json`.

## Visual spec

- Shared components only: new `InsightFrame` / `InsightFrameSkeleton` (outer card, `components/shared/insight-card.tsx`)
  and `PeriodsCard` (`components/reports/employee-periods-card.tsx`: frame + `InsightGroup size="report"
surface="opaque"` of five `ReportCard`s). `PERIOD_ICON` moved to `report-identity.ts`; `useReportStatLines` shared.
- Outer card: opaque card, faint identity wash under the header (person = blue identity, `--insight-frame-tint` 8 % /
  dark 11 %), tinted hairline, identity header (icon chip, name 16px semibold, employee code / username, rank chip
  "#1 this month" / "Your rank this month: 3 of 12"). Box colours = R19 C2 `PERIOD_IDENTITY` (teal, sky, blue, violet,
  orchid), identical for every employee.
- Layout by the card's own width (container queries): 1 column on a phone, 2 on a narrow tablet (lone 5th spans), 3 + 2
  on tablet / laptop, 5 in one row from a 66rem card (1440 desktop). Amounts wrap, never truncate.
- States: frame hover / keyboard focus → stronger tinted edge + soft tone shadow (no rise) + header icon scale; focus
  adds the shared ring (cards are focusable `article`s in a `role="feed"`); boxes keep the R19 hover (2px rise, icon
  lift). Reduced motion: no transition, no icon motion, no rise. Touch (`hover: none`): stronger resting edge.
- Guards: `report-card-consumers.spec.ts` (+R20 test: the two tabs render `EmployeePeriodsTab`, one request per page,
  every employee is a `PeriodsCard` with an identity and no local class, boxes take `PERIOD_IDENTITY` / `PERIOD_ICON`,
  base grid 1 column and five only at `@min-[66rem]`, the frame slot drawn only by the shared component);
  `report-card-treatment.spec.tsx`, `report-identity.spec.tsx` updated for the frame; `sales-reports-view.spec.tsx`
  rewritten for the period cards (exact box figures, identities, feed, pager).
- Contrast (`scripts/design/contrast-check.mjs`): **1288 pairs pass**, 84 new frame pairs (7 hues × name / reference /
  rank on the wash, header icon on chip, hover-focus and touch edges; light + dark). Lowest new: header icon on chip 3.76.

## Verification (2026-10-13)

- API: `tsc` OK; eslint `src/**/*.ts` 0 errors; `nest build` OK; sales-reports + sales-scope suites **7 files / 79
  tests** pass on `oms_r20_int`.
- Web: `tsc` OK; `eslint .` 0 errors (9 pre-existing warnings); full vitest **183 files / 1311 tests** pass;
  `next build` OK.
- Evidence (`scripts/acceptance/r20/r20-b-employee-periods-shots.mjs`, build :4811 / API :4815, `oms_r20_b`):
  `evidence/b/before/` (unmodified cda38886 build) and `evidence/b/after/`: admin (ALL, Employees), sales (OWN, My
  performance), agent (AGENT_ALL, Employees) × ar/en × light/dark × 1440/375; hover (frame header + box), keyboard focus,
  reduced motion, touch 375, long amounts (1,234,567,890.00 × 5 currencies) 375 + 1440. Metrics: no horizontal
  overflow, nothing clipped, 5 columns at 1440 / 1 at 375, no layout shift or text change on hover / focus.

## Limits

- No manager (TEAM) demo persona exists (sales2 holds `view_all`); TEAM is proven by the integration spec only — I did
  not create accounts or change permissions on the demo DB.
- Employees with no order in any of the five periods are not listed (same rule as the old Employees ranking); an own
  scope always shows its own card.
- The own tab no longer shows a custom-date-range own figure (the five fixed periods replace it); Payment mix keeps the
  range for own scopes.
