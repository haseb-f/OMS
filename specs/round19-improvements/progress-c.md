# R19 stream C progress — sales-report cards

Branch `feat/r19-sales-cards` (worktree `D:/Systems/OMS/.claude/worktrees/agent-a2753f06bbcaa3127`), demo DB
`oms_r19_c`. Spec: `README.md` §C. Owner brief: noticeably larger / stronger sales-report summary cards on every
sales-report screen (company + agent), shared components only, no metric / filter / permission change.

## Screen audit (route → component → card)

| Route                              | Tab (scope)                                | Component                                  | Cards                                                                                     |
| ---------------------------------- | ------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `/reports/sales`, `/agent/reports` | Live (every scope)                         | `reports/sales-reports-view.tsx` `LiveTab` | 5 period `ReportCard`s (buttons, select the status panel) — small fixed group → **glass** |
|                                    | My performance (OWN / AGENT_OWN)           | `OwnTab`                                   | own `ReportCard` + `OwnRankCard` → glass                                                  |
|                                    | Employees (TEAM / ALL / AGENT_ALL)         | `EmployeesTab`, `SeparateRow`              | one `ReportCard` per employee → **opaque list**; unassigned / agents rows → glass         |
|                                    | Teams (TEAM / ALL)                         | `TeamsTab`                                 | one `ReportCard` per team (manager + members) → **opaque list**                           |
|                                    | Comparison                                 | `ComparisonTab`                            | no summary cards (bar chart + `CompactDetailTable`) — unchanged                           |
|                                    | Payment mix (payment / collection summary) | `PaymentMixTab`                            | one `ReportCard` per currency with the prepaid / COD split → glass (few currencies)       |
|                                    | loading                                    | `CardSkeletons`                            | `ReportCardSkeleton` (report size)                                                        |
| `/hr/sales-targets`                | —                                          | page                                       | no report summary cards (table / form) — unchanged                                        |
| `/dashboard` (home)                | ranking panel                              | `dashboard/sales-panels.tsx`               | shares `OwnRankCard` / `InsightCard` → stays **default size** (not a sales-report screen) |

The company page (`reports.sales.view`) and the agent portal page (`agent.dashboard.view`) render the same
`SalesReportsView source="company" | "agent"`; scopes, tabs (`reportTabs`) and figures come from the API
unchanged. Record-grid status cards and every other `InsightCard` consumer keep the default size.

## Variant design — `size="report"` of the shared card

- **Components** (`components/shared/insight-card.tsx`): `InsightSurface size="report"` → `data-size="report"` +
  report padding; `InsightCard size="report"`, `InsightCardSkeleton size`, `InsightIcon size` (36px chip / 20px
  icon), `InsightGroup size="report"` (12px gap) and `surface="opaque"`; `INSIGHT_REPORT_TEXT` = the one type /
  rhythm set (title `text-card-title` 16px, figure `text-display` 32px, unit / secondary `text-body` 14px, 10px
  rhythm). `ReportCard` is the sales-report card, so it always draws at the report size (money lines 16px,
  counts 14px; unit and title wrap instead of truncating). `OwnRankCard size` passes through.
- **Recipe** (`theme/recipes.css`, inside the one report-card block): `[data-size="report"]` re-points the
  card-local state tokens to `--insight-report-*` — same state machine (rest / hover / focus = hover + ring /
  press / emphasis / touch / reduced motion), stronger values. Informational report cards rest on a hairline
  depth; actionable cards keep the stronger lift + pointer. `InsightGroup surface="opaque"` → opaque card, no
  backdrop blur; `prefers-reduced-transparency: reduce` → every report card opaque.
- **Tokens** (`theme/tokens.css`, report-card block only — no sidebar / type-scale lines touched):

| Token (`--insight-report-…`)                                               | Light (default card)                              | Dark (default card) |
| -------------------------------------------------------------------------- | ------------------------------------------------- | ------------------- |
| `padding-inline` / `padding-block`                                         | 20 / 18px (14 / 12)                               | —                   |
| `tint-top` / `tint-bottom`                                                 | 30 / 12 % (24 / 9)                                | 34 / 14 % (30 / 11) |
| `tint-border` / `-hover` / `-active`                                       | 60 / 74 / 82 % (50 / 64 / 72)                     | 62 / 76 / 84 %      |
| `tint-top-hover` / `-static-hover`                                         | 40 / 36 % (32 / 28)                               | 40 / 38 % (38 / 34) |
| `icon-fill`                                                                | 34 % (30)                                         | 42 % (38)           |
| `glass` / `glass-filter`                                                   | card 80 %, blur 10px sat 1.2 (86 %, 8px)          | card 74 % (80 %)    |
| `depth` / `rest-shadow` / `static-hover-shadow` / `active-shadow-geometry` | hairline / 6–14px / 12–24px / `0 14px 28px -14px` | dark equivalents    |
| `lift-static` / `lift-active`                                              | −2 / −3px (−1 / −2), `translate` only             | same                |
| `hover-shadow-tone` / `accent-edge`                                        | 70 % (60) / 4px inset (3px)                       | same                |

- **Layout**: groups keep the default rhythm from 1440 up (Live 5, employees / own 4, teams / payment mix 3 per
  row) and step one column down below 1440 (`min-[90rem]:`), so a 1,234,567,890.00 amount always fits.

## Value-unchanged proof

- Rendered card text, before (unmodified build) vs after, same DB / personas / tabs / locale
  (`scripts/acceptance/r19/r19-c-compare-figures.mjs evidence/c/before/figures.json evidence/c/after/figures.json`):
  **24 tab views, 74 cards compared, 0 differences** (company admin ALL: live / employees / teams / payment mix;
  company sales OWN: live / own / payment mix; agent AGENT_ALL: live / employees / payment mix; ar + en).
- Unit tests (`components/reports/report-card-size.spec.tsx`): `ReportCard` shows exactly `formatNumber(figure)`,
  every `formatMoney(amount, code)` line and every count it is given; `InsightCard` and `OwnRankCard` read the
  same text at the default and report sizes. No service, metric, filter, permission or API file changed.

## Guards

- `report-card-consumers.spec.ts` (extended): both sales-report routes render `SalesReportsView`; every
  `InsightGroup` / `InsightCard` / `OwnRankCard` / skeleton in the view carries `size="report"`; the employee and
  team lists are `surface="opaque"`; `ReportCard` always renders the report surface and only the sales reports
  use it; the report size / opaque surface never appear on any other screen. Mutation-checked (removing
  `size="report"` from the Live group or `surface="opaque"` from the employee list fails the guard).
- `report-card-size.spec.tsx` (new, 9 tests): geometry by size, skeleton / group sizes, the recipe only re-points
  state tokens to report tokens (no geometry, no literals), light + dark tokens, opaque + reduced-transparency
  fallbacks, hairline depth vs actionable lift.

## Verification (2026-10-13)

- web `tsc --noEmit` OK; `eslint .` 0 errors (9 pre-existing warnings in unrelated files); prettier on changed files.
- full web vitest **181 files / 1289 tests** pass; `next build` OK.
- `node scripts/design/contrast-check.mjs`: all **888** pairs pass, incl. **212 new report pairs** (8 tones ×
  glass + opaque × value rest / hover, money line, muted, title, edge + icon chip; neutral title / muted on the
  report glass; light + dark). Lowest new pair 4.57 (destructive hover figure, dark, opaque).
- Visual pass (`scripts/acceptance/r19/r19-c-sales-cards-shots.mjs`, local build :4721 / API :4725, `oms_r19_c`):
  `evidence/c/before/` (68 PNG, unmodified build) and `evidence/c/after/` (69 PNG). Every tab for company admin
  (ALL), company sales (OWN) and agent (AGENT_ALL) × ar-light-1440, en-light-1440, ar-dark-1440, ar-light-375,
  en-light-375 (OWN without dark); hover (`state-*-hover`) and keyboard focus (`state-live-*-focus`) in ar light +
  en dark; reduced motion; touch 375 (`state-touch-375`, real `hover: none` via Blink settings); long amounts
  (`long-amounts-375` / `-1440`: 1,234,567,890.00 in five currencies).
- Metrics (`evidence/c/after/metrics.json`): no horizontal overflow and no clipped figure / amount / title on any
  screen; hover / focus change no layout box, neighbour offset, page height or card text (rise 2px informational
  / 3px actionable via `translate`); reduced motion → `translate: none`; touch → no rise after a tap, actionable
  resting edge `--border-strong`; employee / team lists `backdrop-filter: none` on the opaque card; reduced
  transparency → opaque card, no blur.

## Open / limits

- Comparison tab has no summary cards (chart + table) — unchanged by design.
- Between 1280 and 1439px the Live group is 3 + 2 (tall rows when one period lists 4 currencies) — chosen so no
  long amount is squeezed; ≥ 1440 it is one row of 5.
- Glass translucency is subtle on the plain light canvas (as in R18); clearer in dark mode.
