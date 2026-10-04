# Toolbar tonal sequence — evidence (Round 7 addendum, 2026-10-04)

Branch `feat/r7-toolbar`, captured locally (web :4201 / API :4205, database `oms_r7_int`, seed
admin). Design rule: `specs/enterprise-ui-overhaul/design-system.md` §12.15.

## Palette

Light steps are `color-mix(in oklab, var(--brand-blue) p%, var(--brand-navy))` with
p = 36 / 49 / 62 / 75 / 88; dark steps mix the lifted navy `#0e2a4b` toward `--brand-blue` at
0 / 22 / 44 / 66 / 88 %. Hover = step mixed 10 % toward black, pressed/open = 18 % toward black,
muted label = 92 % white over the step, chevron chip = 16 % white over the step. Foreground is
`--toolbar-tone-foreground: #ffffff` on every step. Ratios are from
`node scripts/design/contrast-check.mjs` (WCAG, composited on `--card`).

| Token              | Light (rest / hover / pressed)    | Dark (rest / hover / pressed)     | White text, light rest | Muted label, light rest | White text, dark rest | Muted label, dark rest |
| ------------------ | --------------------------------- | --------------------------------- | ---------------------- | ----------------------- | --------------------- | ---------------------- |
| `--toolbar-tone-1` | `#163e6e` / `#12345e` / `#0e2d52` | `#0e2a4b` / `#0b2340` / `#081e37` | 10.84                  | 9.34                    | 14.47                 | 12.24                  |
| `--toolbar-tone-2` | `#1e4981` / `#183e6f` / `#143661` | `#173a66` / `#123158` / `#0f2a4d` | 9.06                   | 7.89                    | 11.45                 | 9.83                   |
| `--toolbar-tone-3` | `#255494` / `#1f4880` / `#1a3f71` | `#214b83` / `#1b4071` / `#173763` | 7.53                   | 6.62                    | 8.79                  | 7.67                   |
| `--toolbar-tone-4` | `#2d60a8` / `#265392` / `#204880` | `#2b5ca0` / `#244f8b` / `#1e457a` | 6.24                   | 5.55                    | 6.68                  | 5.91                   |
| `--toolbar-tone-5` | `#356dbd` / `#2c5da4` / `#265290` | `#366ebf` / `#2e5fa6` / `#275392` | 5.19                   | 4.66                    | 5.07                  | 4.56                   |

Shared: `--toolbar-tone-applied-edge` `#dbeeff` (light) / `#cfe6ff` (dark) — ≥ 3.97:1 against
every step's rest fill, ≥ 4.37 in light. Per step the script also checks the muted label and icon
on hover and pressed fills, the applied ring on all three fills, the chevron on its chip (≥ 3.59),
the step's edge on the card (≥ 3.73) and the `--selector-open-edge` on the pressed fill (≥ 3.08).
Neighbouring steps differ by ≥ 1.20:1 (light) / ≥ 1.26:1 (dark). All 79 toolbar pairs per theme pass;
the whole suite reports `all pairs pass` in both themes.

## Ordering rule

`ListToolbar` (`apps/web/src/components/shared/data-table/list-surface.tsx`) runs
`useToolbarTones` (`toolbar-tones.ts`): a layout effect plus a `MutationObserver` that numbers
every eligible descendant `data-toolbar-tone="1".."5"` (cycling) in **DOM order**, which is the
logical order — so Arabic starts at the right edge with the deepest step and lightens leftward,
English mirrors it. Eligible: `[data-filter-trigger]`, `EnterpriseButton variant="field" |
"menu" | "outline"`, non-ghost `SelectTrigger`. Numbering counts controls a responsive class hides
(the phone "Filters" button, the collapsed inline filter group), so wrapping, hiding or overflow
never recolours the rest; exempt controls are not counted, so toggling them cannot shift
neighbours. One recipe in `apps/web/src/theme/recipes.css` maps each number onto the `--selector*`
tokens the §12.14 navy recipe already consumes — no page sets a colour. Unit tests:
`toolbar-tones.spec.ts` (8 tests: cycling, exempt skipped and uncounted, hidden keeps its index,
custom count, DOM-order numbering incl. selects/outline, bulk strip + `data-tone-exempt` +
`aria-pressed`, renumbering after DOM changes).

## Exempt (never toned, never counted)

Search input and checkboxes · the bulk-action strip (`[data-bulk-strip]`) · anything under
`data-tone-exempt` · pressed-state toggles (`aria-pressed` buttons such as "Duplicate review" /
"Show archived", `Toggle`, the view `ToggleGroup`) · success / destructive / info / warning /
secondary variants, status badges and distribution controls · ghost icon buttons (refresh, sort,
density, options) · dropdown content · the filter bottom sheet (a dialog, outside the toolbar).
Other contexts — forms, dialogs, report `FilterSurface`, header actions — keep the §12.14 navy.

## States (identical on every step)

- hover: `-hover` fill (darker)
- pressed / open: `-active` fill + 1.5 px `--selector-open-edge` + inset sink
- keyboard focus: 2 px focus ring, offset 2 px
- disabled: the muted surface (no blue)
- applied filter: the step's own fill with a 2 px `--toolbar-tone-applied-edge` ring — one colour
  on all steps, so a shade never reads as "selected"; hover still darkens under the ring

## Screenshots

Full viewport plus a `-toolbar` crop of the first `ListToolbar` for each. `before-*` is `main`
(1f806f3) untouched; `after-*` is this branch.

| Page / variant                                              | Before                             | After                             |
| ----------------------------------------------------------- | ---------------------------------- | --------------------------------- |
| Leads, Arabic RTL, 1440                                     | `before-leads-ar-1440.png`         | `after-leads-ar-1440.png`         |
| Leads, English LTR, 1440                                    | `before-leads-en-1440.png`         | `after-leads-en-1440.png`         |
| Leads with an applied filter (`?followUp=overdue`), AR 1440 | `before-leads-applied-ar-1440.png` | `after-leads-applied-ar-1440.png` |
| Store Orders, Arabic RTL, 1440                              | `before-orders-ar-1440.png`        | `after-orders-ar-1440.png`        |
| Store Orders, English LTR, 1440                             | `before-orders-en-1440.png`        | `after-orders-en-1440.png`        |
| Customers, Arabic RTL, 1440                                 | `before-customers-ar-1440.png`     | `after-customers-ar-1440.png`     |
| Customers, English LTR, 1440                                | `before-customers-en-1440.png`     | `after-customers-en-1440.png`     |
| Leads, Arabic, 375 (mobile)                                 | `before-leads-ar-375.png`          | `after-leads-ar-375.png`          |
| Store Orders, Arabic, 375 (mobile)                          | `before-orders-ar-375.png`         | `after-orders-ar-375.png`         |
| Leads, English, 1440, dark mode                             | `before-leads-en-1440-dark.png`    | `after-leads-en-1440-dark.png`    |

Tone assignment observed in the after captures (logical order): Leads — Status 1, Follow-up
classification 2, Follow-up 3, Assigned employee 4, phone "Filters" 5 (hidden at this width),
Columns 1. Store Orders — Payment status 1 … Agent 5, Date range 1, Cost completeness 2,
Duplicate customers 3, phone "Filters" 4, Columns 5 ("Loss making only" toggle and the
`aria-pressed` "Duplicate review" stay exempt).

**Agent interface: not captured.** `oms_r7_int` contains the demo agent personas
(`agent-a-admin.demo-agt@oms.local` …) but their password was set by whoever ran
`ensure-agents-demo.ts` against that database and is not available to this session; the database
is read-only for this task, so no credential was reset. The agent tables (`/agent/leads`,
`/agent/orders`) render through the same `EnterpriseDataTable` → `ListToolbar`, so they receive
the identical sequence (see the `after-leads-*` captures); the owner can confirm with an agent
login.
