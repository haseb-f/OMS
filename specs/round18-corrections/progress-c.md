# R18 stream C progress — login field 44 px + one report-card recipe

Branch `feat/r18-cards-login` (worktree `D:/Systems/OMS/.claude/worktrees/agent-a8d7023c390680539`), demo DB
`oms_r18_c` (clone of `oms_r17_b`, R17 migrations applied). Spec: `README.md` §C.

## C1 Login field −2 px

- `--auth-control-height` 2.875rem → **2.75rem** (46 → 44 px) in `theme/tokens.css`; the fields and
  `.oms-auth-submit` both read it (login, forgot-password, reset-password). 16 px text, padding, radius, focus
  ring, validation, autofill and the 40 px reveal/hide button (centred, 2 px clear each side) unchanged.
- Measured (`scripts/acceptance/r18/r18-c-login-check.mjs`, no sign-in, read-only):
  before = Production 46 / 46 / 46 px (fields / submit), after = local build 44 / 44 / 44 px; 16 px text;
  toggle 40 × 40, centre offset 0; desktop 1440 and 375 px (`evidence/c/login-check-*.json`).
- `login-viewport.spec.ts` asserts 44 px; the R17 46 px assertion stays in `scripts/acceptance/r17/` as R17
  evidence — use the R18 script for the post-release check.

## C2 One report-card recipe

All report summary cards already render through `InsightSurface` (`InsightCard`, `SummaryCard`, `ReportCard`,
`OwnRankCard`, skeletons); the R18 change is the ONE recipe block (`theme/recipes.css` "Report cards") + tokens,
so every consumer below moves together.

- **Glass surface**: the tone gradient is mixed into `--insight-card-base` — the opaque `--card`, or under
  `@supports (backdrop-filter)` the translucent `--insight-glass` (card 86 % light / 80 % dark) with
  `--insight-glass-filter` (blur 8 px, saturate 1.15). Tone hairline + inner sheen unchanged.
- **Readable title**: `[data-slot="insight-label"]` → `--insight-title` (muted 40 % / foreground), also on
  `SummaryCard` and the partner-login card titles. Figure stays `text-metric-lg`, deep tone shade.
- **Hover / focus**: informational cards rise 1 px (`--insight-lift-static`) with the gentle tint, edge and
  soft shadow — still no pointer, no chevron, not focusable. Actionable cards (link / filter button) rise 2 px
  (`--insight-lift-active`) with stronger tint and edge, a tone shadow (`--insight-active-shadow-geometry`),
  icon chip filled, figure deepened; `:focus-visible` is the identical rule body plus the shared 2 px outline
  ring; `:active` settles the rise.
- **No layout shift**: the rise is the `translate` property only (no transform, size, margin, padding,
  border-width or position); measured `offsetTop/Left/Width/Height`, the neighbour's offset and page
  `scrollHeight` are equal at rest and on hover on every screen of the pass (`metrics.json`: "layout shifts: none").
- **Reduced motion**: transitions and the rise removed (computed `translate: none`); colour emphasis kept.
- **Touch** (`hover: none`): no hover rules apply (no sticky hover); actionable cards keep the stronger
  resting edge + chevron. 375 px: no horizontal overflow.
- **Print**: `translate: none`, `backdrop-filter: none` (print.css).
- Contrast (`scripts/design/contrast-check.mjs`): new pairs for value / muted / title on the glass tints
  (composited over the canvas) and the neutral title — all pass (lowest 4.80, destructive hover figure).

### Tokens (theme/tokens.css "Report cards", light + dark)

| Token                               | Light                      | Dark               |
| ----------------------------------- | -------------------------- | ------------------ |
| `--insight-glass`                   | card 86 % / transparent    | card 80 %          |
| `--insight-glass-filter`            | `blur(8px) saturate(1.15)` | (same)             |
| `--insight-title`                   | muted 40 % / foreground    | (same formula)     |
| `--insight-lift-static` / `-active` | `-1px` / `-2px`            | (same)             |
| `--insight-active-shadow-geometry`  | `0 10px 20px -10px`        | `0 10px 22px -8px` |
| `--auth-control-height`             | `2.75rem` (44 px)          | —                  |

### Consumer audit (route → component → before / after)

| Route(s)                                                                                   | Component                                                                       | Before (R17)                                                                             | After (R18)                                                                         |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `/agents/overview`                                                                         | `agents/overview/agents-overview.tsx`, `overview-panels.tsx`                    | shared InsightCard                                                                       | recipe (glass, rise)                                                                |
| `/agents/[id]?tab=statement`, commission tab                                               | `agents/agent-statement-tab.tsx`, `agent-commission-report.tsx` (`SummaryCard`) | shared                                                                                   | recipe + title slot                                                                 |
| `/agent/dashboard`                                                                         | `overview-panels.tsx`                                                           | shared                                                                                   | recipe                                                                              |
| `/agent/statement`                                                                         | page (`SummaryCard`, `InsightGroup`)                                            | shared                                                                                   | recipe + title slot                                                                 |
| `/agent/commission`                                                                        | `agent-commission-report.tsx`                                                   | shared                                                                                   | recipe                                                                              |
| `/agent/reports`, `/reports/sales`                                                         | `reports/sales-reports-view.tsx`, `report-card.tsx`, `own-rank-card.tsx`        | shared                                                                                   | recipe                                                                              |
| `/investors`, `/investors/list/[id]`, `/investors/opportunities/[id]`, `/new`              | pages (`InsightCard`)                                                           | shared                                                                                   | recipe                                                                              |
| `/investor/dashboard`, `/investor/statement`, `/investor/investments/[id]`                 | investor portal pages (`InsightCard`)                                           | shared                                                                                   | recipe                                                                              |
| `/company-partners`, `/[partnerId]`, `/periods`, `/partner/overview`, `/partner/statement` | pages, `period-statement-view.tsx`, `partner-login.tsx`                         | shared                                                                                   | recipe (+ title slot on partner login)                                              |
| `/dashboard`                                                                               | `dashboard/sales-panels.tsx`, `bank-matching-panel.tsx`                         | shared                                                                                   | recipe                                                                              |
| `/reports/finance/*` (all tabs), statements                                                | `accounting/financial-report/financial-report-summary.tsx`                      | shared                                                                                   | recipe                                                                              |
| Import center / sheet sync summaries                                                       | `import-center/import-summary-cards.tsx`, `shared/sync-review/sync-summary.tsx` | shared                                                                                   | recipe                                                                              |
| Sheet sync review → confirm step                                                           | `shared/sync-review/sync-result-summary.tsx`                                    | **bespoke** tinted `dl` boxes (`rounded-lg border bg-*/5`, `text-ui-title tabular-nums`) | **`InsightGroup fit` + `InsightCard size="compact"`** (same counts, zero → neutral) |
| `/inventory/integrity`                                                                     | page (`InsightCard`)                                                            | shared                                                                                   | recipe                                                                              |
| Payments review / settlement                                                               | `payments/review/payment-stage-strip.tsx`, `settlement/settlement-parts.tsx`    | shared                                                                                   | recipe                                                                              |
| Master-data list stats                                                                     | `master-data/master-data-page.tsx`                                              | shared                                                                                   | recipe                                                                              |
| `/business-components`, `/design-system` (gallery)                                         | pages                                                                           | shared                                                                                   | recipe                                                                              |

Audited, intentionally not report cards (unchanged): investor portal `/investor/profits`, `/investments`,
`/documents` (tables only); `/agents/[id]` overview tab (detail fields); `/reports/customers`, `/reports/suppliers` (financial report tabs → shared summary);
`/reports/{executive,analytics,crm,expenses,purchasing,shipping}` (coming-soon pages); `TaskProgress` counters
(task feedback strip in the import wizard), `DetailSummaryBar`, `PageHeaderStat`, `MethodSummaryStrip`,
`financial-report-cards.tsx` (mobile statement rows), `document-totals.tsx` (totals row), year-closing opening
summary (`dl` fields), `fx-status-panel.tsx`, record-grid status cards and Home `LauncherTile` (own recipes).

No data fetching, permission, scope or calculation changed; drill-down `href`s and filter `onSelect`s are
untouched (only CSS, tokens and the presentational markup of one confirm-step summary changed).

### Guard (`components/shared/report-card-consumers.spec.ts`, extended)

- New: no figure-sized numeric run (`text-metric|metric-lg|ui-title|section-title|page-title|display` with
  `num|tabular-nums` in one class string) outside the shared card implementations (+ document totals) —
  mutation-checked: re-adding the old sync summary fails with its six bespoke tiles.
- New: the card slots (`insight-card|value|label|icon`) are drawn only by the shared cards.
- Kept: card `className` = grid placement only; groups never set gap / surface; `KpiCard` retired; only the
  one recipe block (and print) styles the slot.
- `report-card-unified.spec.tsx` / `report-card-treatment.spec.tsx`: R18 rules (translate-only rise, 1 / 2 px
  tokens, press settles, reduced motion removes the rise, glass with opaque fallback, title token, print, no
  transform / size / spacing / border-width in the block).

## Verification (2026-10-12)

- web `tsc --noEmit` OK; eslint on the changed areas 0 errors (6 pre-existing warnings elsewhere); prettier OK.
- full web vitest **177 files / 1266 tests** pass; `node scripts/design/contrast-check.mjs` all pairs pass.
- `next build` OK (local review build, API :3015 / web :3011 on `oms_r18_c`).
- One local visual pass (`scripts/acceptance/r18/r18-c-card-shots.mjs`): agents overview, agent statement
  (admin + portal), agent dashboard / statement / commission (ar light + en dark), investors, company partners,
  partner portal overview, dashboard, sales reports, inventory integrity, reduced motion, 375 px touch. Before
  shots = R17 released state (`evidence/c/before/`, copied from R17 `evidence/after/`), after in `evidence/c/after/`.

## Open / not verified

- Investor portal pages (`/investor/*`): no investor portal account in the demo DB — covered by the shared
  recipe + unit tests only.
- Glass blur is subtle on the plain white canvas (light); visible on tinted panel bodies and in dark mode.
