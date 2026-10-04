# Dropdown-trigger inventory (Round 7 addendum)

Method: grep over `apps/web/src` on the integrated tree (`release/r7`), plus the contrast checker
`scripts/design/contrast-check.mjs` (all pairs pass: value 14.5:1 rest / 12.0 hover / 16.2 open,
placeholder 8.1:1, chevron 8.1:1 against a 3:1 floor, edge 3.9:1 on surface).

## How the closed trigger becomes navy

One token set in `app/globals.css`: `--selector` = `--brand-navy` (light) and a lifted `#0e2a4b`
with a lighter edge (dark), with `-hover`, `-active`, `-foreground`, `-muted`, `-border`,
`-open-edge`, `-chip`, `-applied` companions. The shared recipes in `theme/recipes.css`
(`[data-slot="select-trigger"]`, `[data-button][data-variant="field" | "menu"]`) consume them for
rest / hover / pressed / open / applied / disabled / invalid / keyboard-focus. The R6 inert
"trigger trial" machinery (`trigger-trial.css/tsx`, `data-trigger-trial`, env/query switches) is removed.

## Inventory and disposition

| Trigger family                                                                                                    | Where                                                                                                        | Count          | Disposition                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `SelectTrigger` (forms, dialogs, filters, pagination size, report selectors, HR/finance/inventory/shipping pages) | `components/ui/select.tsx`                                                                                   | 41 files       | Navy via shared recipe. **No local `bg-`/`border-` override on any of them** (grep).                                                         |
| `variant="field"` buttons (searchable select / entity combobox, filter popover, date-range, month picker)         | `shared/entity-combobox.tsx`, `data-table/filter-popover.tsx`, `date-range-picker.tsx`, `month-picker.tsx`   | 4 + demo board | Navy. Combobox inside a table cell (`variant="ghost"`) deliberately stays the light outline button (inline cell editor, not a form trigger). |
| `variant="menu"` buttons (action menus that look like dropdowns)                                                  | report header/switcher/filter bar, company switcher, table Columns/view menu, header actions, import buttons | 9              | Navy chevron/label recipe via the `menu` variant. Icon-only ghost buttons stay unchanged.                                                    |
| `DropdownMenuTrigger` users                                                                                       | 16 files                                                                                                     | 16             | Either `menu` variant (above) or an icon-only/ghost row action (unchanged by design).                                                        |
| Native `<select>`                                                                                                 | —                                                                                                            | 0              | None exist.                                                                                                                                  |
| Ordinary text inputs / textareas                                                                                  | `ui/input.tsx`, `ui/textarea.tsx`                                                                            | —              | **Not recoloured** (requirement).                                                                                                            |
| Dropdown/popover _content_                                                                                        | `ui/select.tsx` content, `popover`, `dropdown-menu`                                                          | —              | **Not darkened** (stays on the light card surface).                                                                                          |
| Semantic status controls (badges inside triggers, status filters)                                                 | —                                                                                                            | —              | Semantic colours preserved; badges inside triggers are untouched.                                                                            |

## Verification still required in a browser

Computed-style check on the closed trigger in a form, a dialog, a filter toolbar, a report
selector and an action menu, in AR/EN, light/dark, 1440/390 — recorded in `evidence-release.md`.

## Round 8 update (2026-10-04) — blue everywhere

Default shade = tone 3 (base `--selector*` alias `--toolbar-tone-3*`); rows use tones 1…5 via
`ListToolbar` / `SelectorRow`. Audit on `feat/r8-blue-dropdowns`:

| Family                                                                     | Result                                                                                       |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `SelectTrigger` default (forms, dialogs, pagination size, line grids)      | tone 3 via shared recipe; no local colour override (guarded by `selector-triggers.spec.tsx`) |
| `field` buttons (EntityCombobox, SearchableSelect, FilterPopover, pickers) | tone 3, or the row's tone inside `ListToolbar` / `SelectorRow`                               |
| `menu` buttons (Export, Import, Columns, switcher, company switcher, More) | tone 3 (header) or row tone (toolbar)                                                        |
| `EntityCombobox` / `SearchableSelect` `variant="ghost"` (shipping company) | **removed** — inline editors are blue too                                                    |
| `SelectTrigger variant="ghost"` (shipping status cell)                     | kept — semantic status badge inside                                                          |
| Primary "New movement ▾", icon-only ghost/outline menus, selection ▾       | unchanged (primary action / icon controls)                                                   |
| Native `<select>`                                                          | none                                                                                         |
| `SelectorRow` adopters                                                     | report filter bar (`report-filter-row`), product browser filters                             |
