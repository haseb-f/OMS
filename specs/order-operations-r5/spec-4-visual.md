# Spec 4 — Report header collapse, soft cards, professional toolbars

Focused evolution of the approved design (`enterprise-ui-overhaul/design-system.md` §11–§12). No new
design system, no dependency. **Released only after owner visual approval** of the local preview.

## 4A. Collapsible financial report summary

`FinancialReport` (shared) gets a collapse toggle on the header block (title/context, filter row,
summary strip). State: `useLocalStorage('oms.report.summaryCollapsed', false)` — one preference for
all financial reports (device preference, listed in `client-data-scope`).

Collapsed strip (single row, ≤ 44px): report title · period · currency · active-filter count badge
(opens the filter row on click) · report switcher · Export / Print · expand button. Material
warnings stay visible: reconciliation difference / unbalanced / drafts-included / partial data
show as a compact warning badge in the strip. Print and export are unaffected (they are built from
data, not from the screen header) — verified.

Accessibility: the toggle is a button with `aria-expanded` / `aria-controls`; keyboard reachable;
reduced motion → no height animation.

## 4B. Soft card treatment

Tokens (light / dark / print): `--surface-soft` (white with a 2–3% tone tint), `--surface-soft-border`
(hairline, slightly translucent), `--surface-soft-gradient` (top-to-bottom, ≤ 3% delta),
`--surface-soft-hover-border`, `--surface-soft-shadow-hover`, per-tone accent vars reusing
`--insight-*`. No backdrop blur beyond 0 (canvas is white — translucency comes from tint, not blur).
Radius stays `--radius-surface` (10px). Hover/focus: border and shadow change only (no transform, no
layout shift); `prefers-reduced-motion` → no transition. Print → plain white, 1px border, no
gradient/shadow. Dark → tints over `--card`, contrast re-checked with
`scripts/design/contrast-check.mjs`.

Applied through shared components only: `EnterpriseCard` (new `tone`/`surface="soft"` option used by
`DashboardPanel`), `InsightCard`/`InsightGroup` recipes, attention rows, the side-column panels
(Attention, Ranking). Metrics stay compact (no size inflation).

## 4C. Professional toolbars

Refine the canonical pieces (no new system):

- `ListToolbar`: remove the spreadsheet-grey band (`bg-muted/30`) → card surface with a bottom
  hairline; consistent 8px gaps between groups, 4px within a group; separators between search,
  filters and view controls.
- `FilterTrigger` / field triggers: label in `--muted-foreground`, selected value in
  `--foreground` 500 weight ("Status: Active"), count badge, `TriggerChevron` aligned; states —
  hover (`--control-hover`), open (`--control-pressed` + focus border), pressed, selected (primary
  soft tint + primary text), focus-visible halo. Fixed height `--control-height-md`, min width by
  content, labels never truncated below 6 characters.
- `ButtonGroup` / `ToggleGroup`: identical silhouettes and heights; selected segment uses
  `--segment-on` with foreground 600 weight.
- Agent order actions and segmented choices (Pickup/Shipping, Prepaid/COD, Included/Added): segmented
  controls with icons; primary action vocabulary unchanged (default = main, success = confirm/approve,
  outline = secondary, destructive = remove) — no arbitrary colors.

## Acceptance

Screenshots before/after: finance report (expanded/collapsed), dashboard, lead list, store-order
list, agent order form — AR/EN, RTL/LTR, 1440px and 390px, light/dark. Contrast check passes; no
horizontal overflow; preference remembered across reloads; print preview of a collapsed report still
has full context.
