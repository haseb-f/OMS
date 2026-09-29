# Kumo dropdown & button-group refinement: coverage checklist (2026-09-29)

Rules: `design-system.md` §12.11. Reference measurements: `kumo-research.md` §4.
Status: implemented locally. Not committed, not deployed. Waiting for the owner's visual approval.

## 1. Root cause found during rollout

Radix triggers rendered `asChild` (`PopoverTrigger`, `DropdownMenuTrigger`, `TooltipTrigger`, …)
**replace `data-slot="button"` with their own slot**. Every shared button recipe was keyed on
`data-slot="button"`. So every popover-based selector (list filters, EntityCombobox /
SearchableSelect / all `*Picker`s, month and date-range pickers) and every menu- or tooltip-wrapped
button (Export ▾, Import ▾, report switcher, header icon buttons) **never received the
control ring, 3:1 bottom edge, weight, hover/open states or depth**. They fell back to the tonal
class styling. That is the main reason triggers looked faint and weak.
Fix: `EnterpriseButton` now also renders a stable `data-button` attribute, and every recipe keys on it
(`theme/recipes.css`, plus the `[&_[data-button]]` selectors in `enterprise-modal` and
`sync-workspace-card`).

## 2. Shared components (canonical family)

| Component                                          | Change                                                                                                                                                                                 | Reaches                                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `ui/trigger-chevron.tsx` (new)                     | The one trigger caret: `select` (up/down) / `menu` / `disclosure`, 16px or 14px (sm)                                                                                                   | every trigger below                                                                                  |
| `ui/select.tsx` `SelectTrigger`                    | `TriggerChevron`; chosen value 500 / placeholder 400 (recipe)                                                                                                                          | 42 files, all callers pass only width/size/variant (no overrides to migrate)                         |
| `shared/entity-combobox.tsx`                       | `TriggerChevron`, recipe weights, full-text `title` on long values, focusable clear hover; in a list filter bar the empty text is the filter name and a set value gets the filter tint | 29 direct users + `SearchableSelect` (36 files) + 12 `components/business/*-picker` (88 usage files) |
| `shared/data-table/filter-popover.tsx`             | `FilterTrigger`: `TriggerChevron`, label in full foreground at 500 (was placeholder grey)                                                                                              | `SelectFilter` / `MultiSelectFilter` / `MultiEntityFilter` (38 files), report "More filters"         |
| `shared/month-picker.tsx`, `date-range-picker.tsx` | recipe weights (value 500, placeholder 400)                                                                                                                                            | month / date-range users (25 files)                                                                  |
| `shared/disclosure-trigger.tsx` (new)              | The one "More details / Notes & terms" control                                                                                                                                         | 6 instances (below)                                                                                  |
| `ui/button-group.tsx`                              | Kumo seam: -1px overlap (no doubled border), square inner edges, no per-item shadow, lifted hover/open/focus, logical props (RTL)                                                      | pager (every list), report expand/collapse                                                           |
| `ui/button.tsx`                                    | `data-button` hook; removed the smaller radius on sm/xs buttons inside groups (one outer rounding)                                                                                     | all buttons                                                                                          |
| `theme/tokens.css`                                 | `--trigger-weight` 500, `--trigger-placeholder-weight` 400, `--trigger-chevron-size(-sm)`                                                                                              | tokens only                                                                                          |

## 3. Local implementations migrated

| File                                                                        | Was                                | Now                                    |
| --------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------- |
| `inventory/movements/page.tsx` (New movement ▾)                             | hand-placed `ChevronDown`          | `TriggerChevron kind="menu"`           |
| `accounting/financial-report/financial-report-header.tsx` (Export ▾)        | hand-placed muted `ChevronDown`    | `TriggerChevron kind="menu"`           |
| `accounting/financial-report/report-switcher.tsx`                           | `ChevronDown`                      | `TriggerChevron` (selector)            |
| `crm/lead-distribution-menu.tsx`                                            | `ChevronDown` at 70% opacity       | `TriggerChevron kind="menu" size="sm"` |
| `shared/module-import-buttons.tsx` (Import ▾, every list)                   | `ChevronDown` at 60% opacity       | `TriggerChevron kind="menu" size="sm"` |
| `shared/data-table/data-table-selection-column.tsx`                         | `ChevronDown`                      | `TriggerChevron kind="menu" size="sm"` |
| `layout/company-switcher.tsx`                                               | `ChevronsUpDown` with local colour | `TriggerChevron size="sm"`             |
| `finance/journal-entries/journal-entry-editor-page.tsx`                     | ghost button + rotating chevron    | `DisclosureTrigger`                    |
| `documents/commercial-document-editor.tsx` (×2: invoices, quotations, POs…) | same                               | `DisclosureTrigger`                    |
| `financial-transactions/financial-transaction-editor.tsx`                   | same                               | `DisclosureTrigger`                    |
| `store-orders/store-order-create-dialog.tsx` (×2)                           | same                               | `DisclosureTrigger`                    |
| `design-system/control-states-board.tsx`                                    | `ChevronDown`                      | `TriggerChevron`                       |

`grep -rn ChevronDown apps/web/src` now returns only the exceptions in §5 and the primitives.

## 4. Module coverage (files using the trigger family)

CRM/leads 10 · Store orders 5 · Shipping 3 · Products 2 · Inventory 7 · Sales (invoices,
quotations) 10 · Purchasing 9 · Finance/reconciliation 18 · Reports 3 · Agents (internal) 14 ·
Agent portal 3 · HR 11 · Investors 5 · Settings 2 · Expenses 2 · Data management 2. All of them go
through the shared components in §2. None keeps a private trigger style.

## 5. Explicit exceptions (not dropdown triggers, unchanged on purpose)

- Row/tree expanders: `TreeToggleButton`, `financial-report-table` row caret,
  `permission-matrix` module rows, `journal-entry-lines-grid` line-detail toggle.
- Sort indicators (`data-table-column-header`) and expand/collapse-all icons.
- Icon-only menus with no caret: row actions ⋯, top-bar theme / language / profile /
  notifications, table "Columns" options, header "More" (⋯).
- Phone "Filters" buttons that open a sheet (not a dropdown).
- Segmented controls (`ToggleGroup`: dashboard period, cash-flow view) already follow the
  track + raised-segment rule (§12.4); not converted to button groups.
- (Resolved) `shared/date-range-picker.tsx`: its empty label now uses placeholder styling; it was edited after the parallel session committed its work (274324f).

## 6. Independent review follow-ups (applied)

- Keyboard focus lost to hover on a hovered trigger → the hover rule now yields to `:focus-visible`
  (ring + halo verified with real Tab navigation).
- An open trigger stacked a second halo beside the focused search box in its popover → the open
  state is now an accent edge only; the halo is reserved for keyboard focus.
- "More filters" opens more controls, not a value list → `FilterTrigger chevron="menu"`.
- Expand/collapse-all used the same up/down glyph as selector carets → `UnfoldVertical` /
  `FoldVertical` (report header, permission matrix).
- RTL option rows: code/phone subtitle aligned left → the subtitle line now follows the row
  direction; only the value is isolated LTR (`ui/command.tsx`).
- The selected "All" row in a single-select filter looked disabled → foreground when selected.
- Kept deliberately: chosen values at 500 in form pickers. The shared EntityCombobox already
  showed its values at 500 before this change; Select is now aligned with it. Plain text inputs
  stay at 400.
- Kept deliberately: action menus (Export ▾) open with the pressed fill and turned caret, while
  selectors open with the accent edge (§12.10 buttons sink, selectors ring).

## 7. Verification

- `tsc --noEmit` ✓ · `eslint src` ✓ · `vitest run` 451/451 ✓ · `next build` ✓.
- Playwright probe (`tmp/kumo/probe.mjs`, AR-light / EN-dark / mobile-AR), all read-only:
  - Filter labels read at weight 500 in full foreground.
  - Open state shows the focus ring plus halo.
  - Escape returns focus to the trigger.
  - Pager seams: -1px, with order mirrored between LTR and RTL.
  - The menu caret rotates only while its menu is open.
  - A combobox popover inside the store-order dialog is on top of the dialog.
  - Touch targets are 40px on mobile.
  - No horizontal overflow on any probed page.
- Before/after: `tmp/ui-baseline/kumo-before|kumo-after/shots` (8 routes × 3 variants) and
  crops in `tmp/kumo/after/`.
