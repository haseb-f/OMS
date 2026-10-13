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
- Layout by the card's own width (container queries): 2 per row from a 19rem card (phones: Today | Yesterday,
  Last 7 days | This month, Last month spanning the row — RTL order follows the grid), 1 per row only below 19rem (very
  small phones / zoomed text), 3 + 2 on tablet / laptop, 5 in one row from a 66rem card (1440 desktop). Amounts wrap,
  never truncate. See "Phone follow-up" below.
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

## Phone follow-up (coordinator review, 2026-10-13)

At 375 px every employee was five full-width boxes (admin page 11,645 px tall in ar, 11,723 in en). Change:

- `PERIOD_BOX_GRID`: `@min-[19rem]:grid-cols-2` + the fifth box spans its row (was `@md`); tablet / desktop unchanged
  (3 + 2 from `@3xl`, 5 from `@min-[66rem]`). Guarded in `report-card-consumers.spec.ts`.
- The outer card is a named container (`@container/frame`). Inside a frame narrower than 32rem only, a report card
  takes the compact report padding (new tokens `--insight-report-padding-inline-compact` 10px /
  `--insight-report-padding-block-compact` 12px, applied by `InsightSurface`), the figure one step down
  (`text-metric-lg` 28px), the title and money lines the body size (14px), and the title shares the icon row. Live,
  Teams and Payment-mix cards (no frame) are unchanged.
- `MoneyValue` split mode (report cards only): figure and currency code are two runs of one LTR value
  (`data-slot="money-split"`), so in a narrow box the code wraps under the figure instead of overflowing. The text
  still reads exactly `formatMoney`; the figure never breaks and keeps tabular digits.
- Result at 375 (`evidence/b/after/*-375.png`, metrics in `metrics-phone.json`): 2 columns × 3 rows per card, no
  horizontal overflow, nothing clipped, including the long-amount probe (1,234,567,890.00 fits a box; an absurd
  7-digit order count wraps rather than overflow). Admin page height **11,645 → 7,590 px** (ar), **11,723 → 8,191 px**
  (en); sales own 1,507 → 1,110; agent 2,595 → 1,809. Touch 375: `hover: none`, no state after a tap.
- Re-run: web `tsc` OK, `eslint .` 0 errors (9 pre-existing warnings), vitest reports + shared 30 files / 270 tests,
  full vitest 183 files / 1311 tests, `next build` OK, contrast check all pass (no colour token changed).

## Limits

- No manager (TEAM) demo persona exists (sales2 holds `view_all`); TEAM is proven by the integration spec only — I did
  not create accounts or change permissions on the demo DB.
- Employees with no order in any of the five periods are not listed (same rule as the old Employees ranking); an own
  scope always shows its own card.
- The own tab no longer shows a custom-date-range own figure (the five fixed periods replace it); Payment mix keeps the
  range for own scopes.

## B2 — employee cards side by side, period rows, currency colours (owner refinement, 2026-10-14)

Branch `feat/r20-employee-cards-2` from `main` 0a0a34d0 (same worktree). Calculations, period boundaries, ranking,
filters, scope and API are unchanged (web only).

### Layout

- **Pair group** (`InsightFrameGroup`, shared): one employee card per row while the group is narrower than 44rem
  (phones, small tablets), two per row from 44rem (768 tablet, 1280 laptop, 1440 desktop), equal widths, 16px gap
  (`--insight-frame-group-gap`). Used for the employee feed, the own card and the unassigned | agents pair.
- **Card** (`InsightFrame rows={5}`): a CSS **subgrid** of the group's rows — header + five period tracks
  (`grid-rows-subgrid`, `grid-row: span 6`, 8px `--insight-frame-row-gap`). Both cards of a pair share the same six
  row tracks, so the headers and each period row (Today, Yesterday, Last 7 days, This month, Last month) have the same
  top and height across the pair (the taller of the two sets it; nothing clipped). Measured: `pairAligned: true` on
  every two-per-row view. The card cannot also be a container (a size container is never a subgrid), so the rows query
  their own width.
- **Row** (`ReportCard layout="row"`, shared): compact padding (10 / 12px tokens), its period identity colour
  (`PERIOD_IDENTITY`). From a 22rem row (`@container/row`): three columns as fractions of the row (1 : 0.7 : 1.3) —
  period icon + title with the quiet counts under it | valid-order count (28px) + unit | amounts, one line per
  currency at the inline end. Below 22rem (phones, a 768 pair): period + count on the first line, amounts and counts
  full width. Same DOM order as the card, so the text reads identically (`report-identity.spec.tsx`).
- Measured card sizes (after): 1440 → 568 × 602 (ar) / 659 (en); 1280 → 488 × 659–680; 768 → 360 × 904; 375 → 343
  wide, one per row. Admin Employees page: 1440 3,753 → 3,221 px (ar); 1280 5,778 → 3,640; 768 7,587 → 4,434;
  375 7,890 → 8,163 (all five periods readable, one card per row as asked).

### Currency colours (all report cards: Live, employee rows, Teams, Payment mix)

Mapping by code = `currencyIdentity` (report-identity.ts, unchanged from R19 C2): EGP teal, SAR sky, USD blue, AED
indigo, EUR violet, KWD orchid; any other code a stable hue from its letters. The currency code (always written) takes
`--report-currency-<hue>` = the hue mixed 64 % with the foreground (theme/tokens.css), through `MoneyValue
currencyHue` → `data-currency` and one recipe rule per hue. Amounts stay the strong neutral; a negative amount keeps
the danger meaning (`data-meaning="danger"` on its line) while its code keeps the currency colour; cancelled /
returned keep their semantic colours; titles (`--insight-title`), counts (identity accent), amounts (strong neutral),
dates (muted period chips) and supporting counts (muted) stay distinct by meaning.

### Verification

- Contrast: **1680 pairs pass** (+392: 7 currency colours × 7 identity backgrounds × rest / hover tint × glass /
  opaque × light / dark); lowest new 4.89.
- Web: `tsc` OK; `eslint .` 0 errors (9 pre-existing warnings); full vitest **184 files / 1324 tests**; `next build`
  OK. Guards: `report-card-consumers.spec.ts` (rows layout, `PERIOD_ROWS = 5`, pair group 1 → 2 columns at 44rem,
  subgrid, opaque rows, `currencyHue` / `data-currency` only on the sales-report screens), `report-card-size.spec.tsx`
  (opaque frame rows), `report-identity.spec.tsx` (+3: currency colour per code incl. fallback, negative = danger,
  recipe + token per hue, row text = card text).
- Values: `r20-b-verify-periods.mjs` **100 boxes, 0 mismatches** before and after; R19 figures comparison
  (`r19-c-compare-figures.mjs`, before = main build, after = B2 build, same Cairo day): **24 tab views, 188 cards,
  0 differences**.
- Demo data: `scripts/acceptance/r20/r20-b2-seed-multicurrency.mjs` added 11 tagged («R20B2 demo») SAR / USD / AED /
  EGP orders for sales and sales2 (incl. 1,250,000 SAR) on the local `oms_r20_b` through the API; `oms_r20_b` also got
  the R20 lead migration (`prisma migrate deploy`, additive).
- Evidence `evidence/b2/{before,after}/` (51 files each, `scripts/acceptance/r20/r20-b2-employee-cards-shots.mjs`):
  admin Employees ar/en × light/dark at 1440 (+ `-pair` crops), ar/en 1280 and 768, ar/en 375 + ar dark 375; sales
  own and agent team (ar light 1440, en dark 1440, ar / en 375); Live / Teams / Payment mix at 1440 (ar light, en
  dark); hover (frame header + a row), keyboard focus, reduced motion; long names + 1,234,567,890.55 in up to four
  currencies + zero periods at 1440 / 375 (ar, en). Metrics: no horizontal overflow, nothing clipped, no layout shift
  on hover / focus, reduced motion → no rise / icon motion.

### Limits

- Below 44rem the cards stack one per row (phones; very narrow tablets). At 768 the pair is narrow, so its rows use
  the stacked row layout.
- The Cairo day rolled over during the session; before and after evidence were both taken on 14 Oct (Cairo), so the
  demo "today" orders of 13 Oct show under Yesterday.
