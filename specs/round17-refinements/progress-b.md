# R17 stream B progress — unopened lead, unified report cards, login fields

Branch `feat/r17-ui` (worktree `D:/Systems/OMS-r17-b`, demo DB `oms_r17_b`). Spec: `README.md` §1, §4, §5.

## §1 Unopened lead indicator

- Definition and open-tracking unchanged: `isNewToViewer` (`config/crm/lead-grid-state.ts`, per-viewer
  `viewedByMe`, open leads only; set only by `POST /leads/:id/viewed` on opening the lead — never by a list).
- `LeadNewToYouMarker` (`components/crm/lead-new-to-you.tsx`) is now the shared `EnterpriseBadge` **info**
  variant (AA pair `--info-soft-foreground` on `--info-soft`: 5.77:1 light, passes dark) with an `EyeOff` icon
  and the words «لم يُفتح» / "Unopened" (i18n `tableViews.card.newToYou`; hint kept). No colour-only meaning;
  the dot-only `compact` table form is gone — the table shows the same full badge.
- Table: badge in the customer cell + the row's start-edge info accent — recipe
  `[data-slot="table-row"]:has([data-new-to-you]) > td:first-child` (RTL mirrored, also the mobile row),
  tokens `--row-unopened-accent` (= `--info-soft-foreground`, ≥ 3:1 on the card: 6.24 light / 8.79 dark) and
  `--row-unopened-accent-width` (3px). Declared before the selected-row edge, so selection still wins.
- Grid: `RecordGridCard` renders `marker` in the card header (beside the identity, outside the stretched
  record link, `data-record-marker`) instead of the badge row. Opened leads: no marker (absence = opened).
- Agent portal leads (`/agent/leads`): the portal API returns no `viewedByMe`, so `isNewToViewer` is false and
  no marker renders there (unchanged; no per-viewer tracking exists for agents).

## §4 Unified report cards

- One component family: `InsightSurface` → `InsightCard` / `SummaryCard` / `ReportCard` (+ skeletons).
  `InsightCard` gained `onSelect` + `pressed` (filter button, `aria-pressed`, emphasis edge), `size="compact"`
  (figure `text-metric`) and `loading` (the card skeleton) so the last bespoke tile could go.
- **`KpiCard` retired** (`components/shared/kpi-card.tsx` deleted) — it was a second metric tile with its own
  surface/hover styling.
- Tokens: every report-card token now lives in `theme/tokens.css` ("Report cards" block, light + dark;
  removed from `globals.css`; `--insight-lift` was unused and dropped). New: `--insight-card-padding-inline/
-block` (one padding, 14/12px), `--insight-card-duration`, `--insight-tint-top-static-hover`,
  `--insight-tint-border-active`, `--insight-hover-shadow-tone`. `scripts/design/contrast-check.mjs` now reads
  tokens.css + globals.css (all pairs pass, + the unopened accent pair).
- Recipe: the one "Report cards" block in `theme/recipes.css` — informational cards `cursor: default`, gentle
  hover tint + quiet edge/shadow under `(hover: hover)`; actionable cards resting lift + pointer, identical
  hover / `:focus-visible` (stronger tint + edge, restrained tone shadow); `(hover: none)` → stronger resting
  edge on actionable cards; paint-only, token-timed transitions; `prefers-reduced-motion` block moved inside.
  Record-grid status cards untouched.

### Consumers converged (audit)

| Area              | Consumer                                                                                                                              | Change                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Agents            | `components/agents/overview/overview-panels.tsx`                                                                                      | local tile padding removed                                                 |
| Agents            | `components/agents/overview/agents-overview.tsx`                                                                                      | already shared (checked)                                                   |
| Agents            | `components/agents/agent-statement-tab.tsx`, `agent-commission-report.tsx`                                                            | raw grid → `InsightGroup`                                                  |
| Agents            | `components/agents/summary-card.tsx`                                                                                                  | shared (checked)                                                           |
| Agent portal      | `app/(shell)/agent/statement/page.tsx`                                                                                                | summary-card grid → `InsightGroup`                                         |
| Agent portal      | `/agent/dashboard` (overview-panels)                                                                                                  | via overview-panels                                                        |
| Company partners  | `company-partners/page.tsx`, `periods/page.tsx`, `config/company-partners/period-statement-view.tsx`, `_components/partner-login.tsx` | already shared (checked)                                                   |
| Company partners  | `company-partners/[partnerId]/page.tsx`                                                                                               | grid → `InsightGroup`                                                      |
| Partner portal    | `partner/overview/page.tsx`                                                                                                           | summary-card grid → `InsightGroup`                                         |
| Dashboards        | `components/dashboard/sales-panels.tsx`, `bank-matching-panel.tsx`                                                                    | local padding removed; bank skeleton → card skeletons                      |
| Reports           | `components/reports/report-card.tsx`, `own-rank-card.tsx`, `sales-reports-view.tsx`                                                   | already shared (checked)                                                   |
| Financial reports | `components/accounting/financial-report/financial-report-summary.tsx`                                                                 | local figure colours removed (recipe tone; adverse → `loss`; n/a = phrase) |
| Import summaries  | `components/import-center/import-summary-cards.tsx`                                                                                   | already shared (checked)                                                   |
| Import summaries  | `components/shared/sync-review/sync-summary.tsx`                                                                                      | `KpiCard` in a ghost button + ring → `InsightCard onSelect/pressed`        |
| Inventory         | `app/(shell)/inventory/integrity/page.tsx`                                                                                            | grid → `InsightGroup`; verdict as `phrase`                                 |
| Payments          | `components/payments/review/payment-stage-strip.tsx`                                                                                  | root grid → `InsightGroup`                                                 |
| Payments          | `components/payments/settlement/settlement-parts.tsx`                                                                                 | `KpiCard` → `InsightCard` (fit group)                                      |
| Investors         | `investors/page.tsx`, `list/[id]/page.tsx`, `opportunities/[id]/page.tsx`, `opportunities/new/page.tsx`                               | `KpiCard` → `InsightCard` (fit groups, compact strips, semantic tones)     |
| Investor portal   | `investor/(app)/dashboard`, `statement`, `investments/[id]`                                                                           | `KpiCard` → `InsightCard` + tones                                          |
| Master data       | `components/master-data/master-data-page.tsx` (`stats`)                                                                               | `KpiCard` → `InsightCard`                                                  |
| Gallery           | `business-components/page.tsx`, `design-system/page.tsx`                                                                              | `KpiCard` → `InsightCard`                                                  |

Audited, intentionally not converted: `finance/fx/fx-status-panel.tsx` (settings status panel with a live
switch, not a report card), `PageHeaderStat` (header chip), `MethodSummaryStrip` (divider strip),
`financial-report-cards.tsx` (mobile statement rows), `DetailSummaryBar`, record-grid cards.

## §5 Login fields

- `--auth-control-height` 3.125rem → **2.875rem** (46px) in `theme/tokens.css`; fields and `.oms-auth-submit`
  both read it; 16px text, padding, reveal/hide and no copy icon unchanged.

## Tests

- `components/crm/lead-new-to-you.spec.tsx` (6): table badge on unopened rows only, converted/closed never
  marked, row-accent recipe + RTL + selection order, words ar/en, grid header badge, opened card clean.
- `components/shared/report-card-unified.spec.tsx` (11): informational vs link vs filter button, loading /
  compact, pointer rules, token padding, tokens defined light + dark, short paint-only transitions,
  reduced motion, hover: none, record-grid untouched.
- `components/shared/report-card-consumers.spec.ts` (5): guard — no consumer styles a card locally, groups
  never set gap / surface, `KpiCard` gone, only the one block styles the card slot.
- Updated: `record-grid-card.spec.tsx` (marker in header), `report-card-treatment.spec.tsx` (tokens in
  tokens.css), `insight-card.spec.tsx` (fit rule: no 5+ fixed columns), `login-viewport.spec.ts` (46px).

## Verification (2026-10-11)

- web `tsc --noEmit` OK; eslint on every changed file: 0 errors (1 pre-existing react-hooks/incompatible-library
  warning in `investors/opportunities/new/page.tsx`); prettier applied.
- full web vitest: 175 files / 1250 tests pass.
- `node scripts/design/contrast-check.mjs`: all pairs pass (incl. the new unopened-row accent pair).
- `next build` OK.
- No browser pass (lead's single pass: ar/en, light/dark, desktop/390px, keyboard focus, reduced motion).

## Follow-up (lead review of the integrated build)

1. Leads table: the badge squeezed the customer name («عبير ا…» at 1440 px). The badge now has its own
   line under the lead number (`StackedCell` in the `leadNumber` cell); the customer cell is the name +
   phone only; the start-edge row accent is unchanged. Grid unchanged.
2. Card groups left a lone orphan (6 partner cards → 5 + 1 at 1440 px). `InsightGroup fit` is now
   balanced, once for every screen: a frame (`insight-group-frame`, CSS container `insight-group`, takes the
   caller's className) holds the grid with its card count (`data-count`, fragments flattened); generated
   container-query rules in `theme/recipes.css` ("Balanced fit groups") apply `balancedInsightColumns` —
   rows = ceil(n / room), columns = ceil(n / rows) (6 → 6 or 3 + 3, 5 → 5 or 3 + 2); a lone last card
   that cannot be avoided (prime count, narrow group) spans its row. 1–12 cards; more fall back to auto-fit.
   Tests: `insight-card.spec.tsx` (rule, fragment counting, CSS ≡ rule for every count × width),
   `lead-new-to-you.spec.tsx` (badge under the lead number, customer cell clean).

## Open

- Visual review + owner approval: unopened badge/accent, report-card hover/focus/touch, investor tiles now
  tone-tinted (semantic tones added where `KpiCard` was icon-only), dashboards' card padding 16/12 → 14/12px,
  summary-card groups' gap 12 → 8px (one group gap).
- Agent portal leads carry no per-viewer "opened" state (API) — marker not shown there; add only if asked.
