# Round 8 — blue dropdowns on every trigger: evidence

Owner decision (2026-10-04): the R7 toolbar blue tonal progression is approved for **every**
dropdown trigger, not only table toolbars. Design record: `design-system.md` §12.16.

## What changed

- Base `--selector*` tokens now alias **tone 3** (light and dark) — every trigger outside a tone row
  (form fields, dialog selects, lone pickers, header menus, inline editors) is one fixed mid-blue.
- Rows of related controls step through tones 1–5 in logical order (RTL: right → left; LTR mirrored):
  `ListToolbar` (all table toolbars) and the new shared `SelectorRow` (report filter bar, product
  browser filters). Hidden controls keep their index; exempt controls are not counted, so a
  conditional control appended at the end never recolours earlier ones.
- Inline cell editors: `EntityCombobox` / `SearchableSelect` lost the light `ghost` variant (the
  shipping company cell is now a blue trigger). `SelectTrigger variant="ghost"` remains ONLY for the
  shipping-status cell, whose trigger shows a semantic status badge.
- Unchanged by design: plain text inputs, menu / popover content, pressed toggles, success /
  destructive / status controls, the primary "New movement ▾" action, icon-only ghost / outline menu
  buttons (row actions, profile, theme, language, selection ▾).

## Audit (not just one shared component)

`trigger-inventory.md` (Round 8 update). Source guard `shared/selector-triggers.spec.tsx` scans every
`SelectTrigger` / `field` / `menu` trigger for a local colour utility (none), asserts the default
tokens alias tone 3 in light and dark, and tests `SelectorRow` numbering and stability.

## Gates (worktree `D:/Systems/OMS-r8-blue`, commit `204ccca`)

| Gate                 | Result                                                  |
| -------------------- | ------------------------------------------------------- |
| Web typecheck        | clean                                                   |
| Web lint             | 0 errors (11 warnings — identical to `main`)            |
| Web tests            | 102 files / 731 tests pass                              |
| Web production build | success                                                 |
| Contrast check       | all pairs pass (every tone × every state, light + dark) |
| Prettier             | clean on touched files (lint-staged)                    |

## Browser evidence (fresh, local build of this branch; `evidence/*.png`)

Computed `background-color` of every trigger on each page (AR light and EN dark, 1440):

| Page                       | Result                                                                            |
| -------------------------- | --------------------------------------------------------------------------------- |
| `/store-orders` toolbar    | tones 1…5 in DOM order; remaining triggers default tone 3                         |
| `/sales/orders/new` form   | 6/6 triggers default tone 3                                                       |
| `/reports/finance` filters | row tones 1 → 4 (RTL: `x` 1049 → 636, deepest on the right); header menus default |
| new-user dialog            | form selects default tone 3 (toolbar behind keeps its own sequence)               |

## Production (deployment 6838735744, `204ccca`, success)

Read-only probe as the QA admin on https://oms.haseb.org (`evidence/prod/*.png`): store-orders
toolbar tones 1…5 + default; new-order form 5/5 default tone 3; finance report filter row tones 1 → 4.
Identical computed colours to the local build.
