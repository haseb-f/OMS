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

## C2 — refinement (owner brief 2026-10-13)

Branch `feat/r19-cards-refine` from `main` 2d276254 (same worktree). The same shared components as C1, refined:
each card gets a colour identity, text is coloured by meaning, the icon gets a short hover / focus motion, and
the currency code is set apart from the amount. Calculations, filters, data scope, permissions, the dashboard
cards and the record-grid cards are unchanged.

### Identity palette (tokens) and mapping (`components/reports/report-identity.ts`)

The identity follows the METRIC / PERIOD a card shows, never its position or value, so it is the same on every tab,
screen and role. It is not a verdict: it stays at zero. Hues are `--report-identity-*` (theme/tokens.css, light +
dark). Green, amber and red are never identities; they stay the semantic text colours.

| Hue      | Light / dark (oklch)           | Used for                                                                               |
| -------- | ------------------------------ | -------------------------------------------------------------------------------------- |
| `teal`   | 0.47 0.085 195 / 0.80 0.08 195 | Live **Today**; Agents row (agent sales); currency EGP                                 |
| `sky`    | 0.47 0.11 235 / 0.80 0.09 235  | Live **Yesterday**; currency SAR                                                       |
| `blue`   | 0.46 0.15 262 / 0.78 0.11 262  | Live **Last 7 days**; a person's valid orders (each employee card + "Your sales"); USD |
| `violet` | 0.46 0.16 305 / 0.79 0.11 305  | Live **This month**; team cards; EUR                                                   |
| `orchid` | 0.47 0.15 335 / 0.80 0.10 335  | Live **Last month**; KWD                                                               |
| `indigo` | 0.45 0.16 285 / 0.78 0.11 285  | **Your rank** (own standing); AED                                                      |
| `slate`  | 0.46 0.03 255 / 0.78 0.025 255 | Unassigned orders row (no owner)                                                       |

- The five Live periods run from near to far: teal, sky, blue, violet, orchid (five distinct hues).
- My performance: own sales (blue) vs own rank (indigo). Employees tab: the unassigned row (slate) vs the agents
  row (teal).
- List groups (one card per employee or per team) share their metric's hue. The name and the rank badge tell
  the cards apart; a different colour per person would carry no meaning and the palette would repeat.
- Payment mix: the common currencies are pinned (EGP, SAR, USD, AED, EUR, KWD). Any other code takes a stable
  hue from a hash of its letters, so the same code always gets the same colour. Two rare codes can share a hue;
  the currency code is the title.
- Wiring: `InsightSurface identity` sets `data-tone="identity"` + `data-identity`, and the recipe maps the hue onto
  `--tone`. Tint, edge, icon chip, figure accent, selected edge and the hover / focus shadow then all follow the
  same state machine as C1.

### Semantic text colours (by meaning, never per line)

| Element                                   | Colour                                                    | Why                                    |
| ----------------------------------------- | --------------------------------------------------------- | -------------------------------------- |
| Main figure (valid orders, rank)          | identity accent (deep shade of the hue)                   | the card's own metric                  |
| Money lines (sales value per currency)    | strong neutral, semibold; currency code smaller and muted | a sales value is not "collected" money |
| Cancelled (> 0)                           | danger `--report-text-danger`                             | a lost sale                            |
| Returned (> 0)                            | attention `--report-text-attention`                       | a reversal still to be processed       |
| Orders, zero counts                       | neutral                                                   | no signal                              |
| Payment mix: prepaid line (> 0)           | success `--report-text-success` (+ green bar / dot)       | paid up front                          |
| Payment mix: cash on delivery line (> 0)  | attention (+ amber bar / dot)                             | still to be collected                  |
| Title / period chip / unit / explanations | readable neutrals (`--insight-title`, muted)              | information, not a verdict             |

Labels and icons always stay, so colour is never the only signal. `ReportCardStat.meaning` sets the colour only
when the value is non-zero.

### Motion

- **Icon** (glyph only, the chip never moves): `lift` −2px for calendars and the trophy, `tilt` −10° for the
  wallet and the handshake, `scale` 1.12 for people. Driven by the individual `translate` / `rotate` / `scale`
  properties (`--report-icon-*`) with the card's 170 ms token transition.
- **When**: on hover under `(hover: hover) and (prefers-reduced-motion: no-preference)`, and on keyboard focus of
  an actionable card. Never looping. Under reduced motion there is no icon motion and no card rise.
- **Card**: unchanged from C1 (2px / 3px `translate` rise, stronger tint / edge / shadow). The figures never
  animate.
- **Measured** (`evidence/c2/after/metrics.json`): hover lift `0 -2px` / scale `1.12` / rotate `-10deg`; focus
  lift on Live; reduced motion → icon and card `none`; touch → no motion after a tap; no layout shift and no
  text change on any probe.

### Demo data (local `oms_r19_c` only, through the API)

`scripts/acceptance/r19/r19-c2-seed-demo-orders.mjs` created 14 tagged («R19C2 demo») orders:

- 9 valid company orders: today, yesterday, 3 days ago and last month; two sales employees; prepaid + COD.
- One cancelled pickup order and one returned pickup order (today).
- 3 agent-portal orders, which the portal dates today.
- Plus one back-dated agent order for yesterday, created by the admin (`scripts/acceptance/r19/r19-c2-seed-agent-backdated.mjs`).

Result: company Live today 4 / yesterday 2 / last 7 days 63 / this month 63 / last month 3 (with cancelled 1 and
returned 1 today); agent today 3 / yesterday 1 / last 7 days 13.

Limit: the agent's last month stays 0. The API refuses (NO_ACTIVE_AGREEMENT) because the demo agent has no
agreement in force on a September date, and I did not change business data to force it.

### Value-unchanged proof

- `r19-c-compare-figures.mjs evidence/c2/before/figures.json evidence/c2/after/figures.json`: **24 tab views,
  74 cards, 0 differences**, on the populated data.
- Unit tests (`report-identity.spec.tsx`): the split currency reads exactly `formatMoney`; the figures are
  unchanged; the rank text is the same at both sizes.

### Contrast

`node scripts/design/contrast-check.mjs`: all **1204** pairs pass, including **280 new identity pairs**. They
cover 7 hues × glass + opaque × (figure at rest / hover, money line, muted, title, success, attention, danger,
edge), plus the icon on its chip and the solid-chip glyph, in light and dark. The lowest text pair is 4.57 (muted
on the teal hover tint). The semantic text tokens were tuned for it (light: success 64 %, attention 62 %,
danger 56 % toward the foreground; dark: success 66 %, attention 80 %, danger 46 %).

### Guards

- `report-card-consumers.spec.ts`:
  - every `ReportCard` / `OwnRankCard` in the sales-reports view takes an identity from `report-identity.ts` and
    never a tone (mutation-checked);
  - identities, icon motion and the split currency are never used outside the sales-report files.
- `report-identity.spec.tsx` (new, 10 tests):
  - the mapping: 5 distinct periods, distinct cards within each fixed group, stable currencies, no semantic hue
    used as an identity;
  - the rendering: identity at zero, meaning only when non-zero, the split currency;
  - the recipe and tokens for every hue, light + dark;
  - the motion rules: glyph only, gated on no-preference, removed under reduced motion, never looping.

### Verification (2026-10-13)

- web `tsc` OK; `eslint .` 0 errors (9 pre-existing warnings in other files).
- full vitest **183 files / 1308 tests** pass; `next build` OK; contrast check all pass.

### Evidence (`evidence/c2/before/` = main 2d276254 build, `evidence/c2/after/`, 69 PNG each, populated data)

- Every tab for company admin (ALL: live, employees, teams, comparison, payment mix), company sales (OWN: live, my
  performance, payment mix) and agent (AGENT_ALL: live, employees, comparison, payment mix).
- Each in ar-light-1440, en-light-1440, ar-dark-1440 (no dark for the own scope), ar-light-375 and en-light-375.
- States: `state-{live,employee,payment}-{ar-light,en-dark}-hover`, `state-live-*-focus`,
  `state-reduced-motion-hover`, `state-touch-375`, `long-amounts-{375,1440}`.
- Plus `figures.json` and `metrics.json`. Reduced transparency is probed in the metrics (opaque card, no blur).
