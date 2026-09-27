# OMS Design System — Enterprise

Canonical rules for every OMS screen. Implementation lives in:

- `apps/web/src/app/globals.css`: color tokens (`:root` / `.dark`) and the `@theme inline` mappings.
- `apps/web/src/theme/tokens.css`: typography, control/shell/table dimensions, z-index, motion, and
  the `num` utility.
- `apps/web/src/components/ui/*`: shadcn/Radix primitives. `components/shared/*` holds the composed
  OMS components.

Token contrast is verified by `node scripts/design/contrast-check.mjs`. It must pass before any token
change is merged.

## 1. Direction

The target is precise, calm and dense: a finance and operations console, not a consumer app.

- Surfaces are solid. A white surface sits on a very light cool canvas, separated by a 1px line.
  On-page surfaces have no shadow. Only floating layers (menus, popovers, dialogs, toasts) cast one,
  and they all use `--shadow-floating`.
- One brand accent: navy `--primary` (light) or blue (dark). It is used only for the one primary
  action of a context, the active navigation item, links and selection.
- Status colors mean status and nothing else:
  - success: completed, paid or saved
  - warning: needs attention
  - info: informational or in progress
  - destructive: failed, destructive or overdue
  - neutral: draft, inactive or unknown
- Not allowed: gradients, glass or blur, press-scale, zoom or slide pop-in animations, brightness
  hovers, decorative icons in colored bubbles, oversized cards, and whitespace that carries no
  information.
- Motion is limited to color and opacity transitions at `--duration-base` (170ms, ease-out). Drawers
  are the only elements that slide.

## 2. Typography

The font is IBM Plex Sans Arabic, which covers both Arabic and Latin. Use only the scale utilities
below; never add a new size or a `text-[Npx]`.

| Utility              | Size / line height | Weight | Use                                 |
| -------------------- | ------------------ | ------ | ----------------------------------- |
| `text-ui-title`      | 20 / 1.3           | 600    | Page title (h1)                     |
| `text-section-title` | 20 / 1.35          | 600    | Rare: section heading on long forms |
| `text-card-title`    | 16 / 1.4           | 600    | Card / panel / dialog title         |
| `text-metric`        | 22 / 1.2           | 600    | KPI figure, report summary figure   |
| `text-body`          | 14 / 1.5           | 400    | Default text, form values           |
| `text-button`        | 14 / 1.25          | 500    | Buttons, tabs                       |
| `text-table`         | 13 / 1.45          | 400    | Table body cells                    |
| `text-table-head`    | 12 / 1.4           | 500    | Table headers                       |
| `text-caption`       | 13 / 1.5           | 400    | Labels, help text, secondary lines  |
| `text-micro`         | 12 / 1.45          | 500    | Badges, tertiary metadata           |

- **Hierarchy comes from weight and color, not size.** Primary cell content (a document number or a
  name) is `font-medium text-foreground`. Secondary lines are `text-caption text-muted-foreground`.
  Never bold every cell.
- **Numbers:**
  - Every amount, quantity, percentage, date, reference and phone number uses the `num` utility:
    tabular digits in an isolated LTR run, so it never reorders inside Arabic text.
  - Digits are Latin (0–9) in both locales, on screen and in print. This is a deliberate decision:
    one digit system everywhere, so screen and print always match.
  - Amounts use the shared money formatter. Numeric columns align to the logical end (`text-end`),
    which is the left edge in Arabic.

## 3. Color tokens

Every tone is a set:

| Tone        | Solid           | On solid                   | Soft surface         | Text on soft                    | Border                 |
| ----------- | --------------- | -------------------------- | -------------------- | ------------------------------- | ---------------------- |
| primary     | `--primary`     | `--primary-foreground`     | `--primary-soft`     | `--primary`                     | —                      |
| success     | `--success`     | `--success-foreground`     | `--success-soft`     | `--success-soft-foreground`     | `--success-border`     |
| warning     | `--warning`     | `--warning-foreground`     | `--warning-soft`     | `--warning-soft-foreground`     | `--warning-border`     |
| info        | `--info`        | `--info-foreground`        | `--info-soft`        | `--info-soft-foreground`        | `--info-border`        |
| destructive | `--destructive` | `--destructive-foreground` | `--destructive-soft` | `--destructive-soft-foreground` | `--destructive-border` |
| neutral     | —               | —                          | `--neutral-soft`     | `--neutral-soft-foreground`     | `--neutral-border`     |

- **Text on a soft surface:** use `text-{tone}-soft-foreground`. Never put `text-{tone}` on
  `bg-{tone}-soft`; that pairing is what failed AA before.
- **Warning as text:** `--warning` is too light for text on white. Use `--warning-soft-foreground`.
- **Surfaces:**
  - `--background` is the canvas; `--card` and `--popover` are surfaces.
  - `--surface-sunken` is used for read-only fields, card footers, and totals rows inside a
    surface.
  - `--muted` is used for neutral chips and disabled fills.
- **Lines:**
  - `--border` separates surfaces and is decorative.
  - `--border-strong` is used for secondary buttons and table header rules.
  - `--input` is the boundary of an editable control and is ≥3:1 against the surface (WCAG 1.4.11).
- **Tables:** `--table-header`, `--table-header-foreground`, `--table-row-hover` and
  `--table-row-selected`.
- **Reports:** `--report-revenue` (soft blue), `--report-expense` (orange), `--report-profit`
  (green) and `--report-loss` (red), each with a `-soft` variant. They are used only on report
  summary tiles, never on individual report rows.
- **Focus:**
  - `--focus-ring` is one visible blue, ≥3:1 on every surface in both themes.
  - Buttons, links and checkboxes use
    `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring`.
  - Fields use
    `focus-visible:border-focus-ring focus-visible:ring-1 focus-visible:ring-focus-ring`, which
    reads as a 2px blue boundary.
- **Dark mode:** neutral gray-blue surfaces, never pure black. The primary is a lighter blue with a
  dark foreground. Every pair is re-verified by the contrast script.

## 4. Space, size, radius, layering

- **Spacing:** Tailwind's 4px scale. Group rhythm is 8 / 12 / 16 px (`gap-2 / gap-3 / gap-4`).
  Surface padding is 12px (compact) or 16px (default).
- **Control heights**, shared by Button, Input, Select, pickers, search and date fields:
  - `--control-height-md` is 32px and the default everywhere.
  - `--control-height-sm` is 28px, for toolbar chips and row actions.
  - `--control-height-xs` is 24px.
  - `--control-height-lg` is 40px.
  - On touch pointers `md` becomes 40px and `sm` 36px automatically, which gives touch targets
    ≥36px.
- **Radius** (closed set):
  - `rounded-xs` 4px: badges, checkboxes, tooltips
  - `rounded-sm` 6px: buttons, fields, menus items
  - `rounded-md` 8px: cards, table surfaces, popovers, menus
  - `rounded-lg` 10px: dialogs, sheets
  - `rounded-full`: avatars, dots and switches only
- **Z-index:** `--z-sticky` (10) for sticky headers, `--z-pinned` (11) for pinned columns,
  `--z-sticky-corner` (12), `--z-topbar` / `--z-action-bar` (40). Radix portals use 50. No other
  values.
- **Shell:**
  - The top bar is `--shell-topbar-height` (48px).
  - The sidebar is `--sidebar-width` (15rem), or 3.25rem when collapsed to icons.
  - Content max width is `--shell-content-max` (1720px).
  - Gutters are `--shell-gutter` (16px) and `--shell-gutter-lg` (24px).
  - Sticky offsets use `top-(--shell-topbar-height)`, never a guessed rem value.

## 5. Components (canonical — one per job)

| Job                         | Canonical                                                                                          | Notes                                                                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Button                      | `EnterpriseButton`                                                                                 | Variants:<br>• `default`: the one primary action<br>• `outline`: secondary<br>• `field`: picker/combobox triggers<br>• `ghost`: toolbar/icon<br>• `destructive`<br>• `success`: approve/activate only<br>• `link` |
| Text field                  | `Input` / `Textarea` / `InputGroup`                                                                | Placeholder uses `--placeholder`. Read-only uses the sunken fill, not opacity.                                                                                                                                    |
| Static short choice (≤7)    | `Select`                                                                                           |                                                                                                                                                                                                                   |
| Searchable single choice    | `EntityCombobox` (and domain pickers on top of it)                                                 | Quick-create sits at the top of the list.                                                                                                                                                                         |
| Filters                     | `SelectFilter` / `MultiSelectFilter` / `MultiEntityFilter` on `FilterTrigger` (variant `field`)    | They sit inside the table toolbar.                                                                                                                                                                                |
| Dates                       | `EnterpriseDatePicker`, `EnterpriseDateRangePicker`, `EnterpriseMonthPicker`                       |                                                                                                                                                                                                                   |
| Money                       | `MoneyValue` (display), `MoneyInput` (entry)                                                       |                                                                                                                                                                                                                   |
| Status                      | `StatusBadge` → `EnterpriseBadge` tones                                                            | The label always names the state; color never carries status alone.                                                                                                                                               |
| Page header                 | `PageWorkspace` / `PageHeader`                                                                     | Title + optional one-line subtitle + actions on one row. One primary action.                                                                                                                                      |
| List                        | `EnterpriseDataTable` inside `ListSurface`                                                         | See §6.                                                                                                                                                                                                           |
| Line/detail/report tables   | `ui/table` primitives with the shared table classes                                                | Same header, cell and numeric classes as EDT.                                                                                                                                                                     |
| Card / panel                | `EnterpriseCard`                                                                                   | Border-only surface.                                                                                                                                                                                              |
| Metric tile                 | `KpiCard`                                                                                          | Every tile shows a real figure and links to its drill-down when one exists.                                                                                                                                       |
| Dialog (form)               | `EnterpriseModal`                                                                                  | Max height is the viewport minus 2rem, with an internal body scroll and a sticky footer.                                                                                                                          |
| Confirm                     | `ConfirmationDialog`                                                                               |                                                                                                                                                                                                                   |
| Context panel               | `Sheet`                                                                                            |                                                                                                                                                                                                                   |
| Empty / error / coming soon | `EmptyState` (tones), `ComingSoonPage`                                                             |                                                                                                                                                                                                                   |
| Feedback                    | `toast` from `@/lib/toast`; errors via `reportApiError`                                            | Messages are localized, never hard-coded English.                                                                                                                                                                 |
| Financial report            | `FinancialReport` (components/accounting/financial-report)                                         | See §7.                                                                                                                                                                                                           |
| Document editor             | `CommercialDocumentEditor` + `ProductLineItemsGrid` + `DocumentTotalsFooter` + `DocumentActionBar` |                                                                                                                                                                                                                   |

**States.** Every interactive component supports the following states:

- **hover:** a neutral `bg-accent` or `hover:border-foreground/45` for fields
- **focus-visible:** the focus ring in §3
- **selected:** `bg-table-row-selected`, or `bg-sidebar-active` in the sidebar
- **disabled:** 50% opacity plus `cursor-not-allowed`
- **loading:** skeleton rows or cards in the final shape. Button uses `isLoading` and a spinner.
- **empty:** `EmptyState` with a next action
- **error:** `ErrorState` with retry, and the reason in words

## 6. Tables

- **Density:** compact is the default, with 36px rows, 13px text and 34px headers. The
  comfortable option is 44px rows. The toggle is visible in the toolbar's view menu.
- **Header:**
  - `bg-table-header text-table-head text-table-header-foreground` with a bottom border.
  - The sort indicator is visible whenever the column is sorted. One click on the header sorts;
    the column menu holds hide, pin and filter.
- **Alignment:**
  - Header, body and footer cells share the same inline padding (`--table-cell-px`).
  - Numeric columns (money, number, percent, quantity) declare `meta.type` explicitly and align to
    the end with `num`.
  - Dates and references use `num` but keep start alignment.
- **Hierarchy:** the identity column is `font-medium`, and secondary lines are caption and muted.
  Status is shown as badges. At most two badges per cell; any more move into a status column.
- **Truncation:** the full value is reachable through a tooltip, but only when the text actually
  overflows. Essential amounts and actions are never truncated or hidden.
- **Scroll:**
  - **Desktop:** list workspaces fill the viewport (`data-viewport-fill`), and the grid body is
    the only scroller, with a sticky header.
  - **Tablet and phone:** the page scrolls and the list renders as cards.
  - No page ever scrolls sideways; a wide table scrolls inside its own container.
- **Footer:**
  - Pagination with a range label ("1–20 of 345") and page sizes 20/50/100.
  - An optional column-aligned totals row.
- **Selection and bulk actions:** the bulk strip replaces the toolbar while rows are selected. The
  selection count is shown once.

## 7. Financial reports

- **Row kinds and styling:**
  - `section`: uppercase-free label, `font-semibold`, top border, no fill.
  - `parent`: `font-medium`, indent.
  - `detail`: regular, indented one step further.
  - `subtotal`: `font-semibold`, top hairline, `bg-surface-sunken`.
  - `grand-total`: `font-semibold`, double top rule (border-t-2), `bg-surface-sunken`. Only one per
    report.
- **Numbers:** tabular Latin digits, and zero renders as a quiet "—" in `text-muted-foreground`.
- **Negatives:**
  - A negative always carries a sign in text: a leading minus, or parentheses where the report's
    convention is accounting style. Color is secondary.
  - Balance columns that are naturally credit (liabilities, equity, revenue, supplier balances)
    show a Dr/Cr suffix instead of turning red.
- **Conventions (implemented):**
  - **Leading minus:** P&L, BS, CF, aging and Management P&L.
  - **Dr/Cr side (مدين/دائن):** Trial Balance opening and closing, and the GL, account and partner
    running balances.
  - **Red** only for a net loss and an unbalanced discrepancy. A net loss shows as an absolute figure
    under its "Net loss" label.
  - **Zero:** "—" in the grid, summary, print and Excel (third number-format section).
  - **Missing value:** blank.
  - **Formatter:** `formatAmount` in `lib/money.ts` (always en-US digits). `formatMoney` is a thin
    wrapper around it.
- **Summary strip:**
  - `KpiCard`-style tiles above the grid: revenue in `report-revenue`, expense in
    `report-expense`, net profit or loss in `report-profit` / `report-loss`.
  - The balance check (Balanced / Unbalanced + discrepancy) is a tile in this strip, not a floating
    badge.
- **Layout:** the account-label column is pinned at the logical start. The grid scrolls
  horizontally inside its own container, and the header is sticky.
- **Export and print:** they carry language, every active filter, the summary, the balance check and
  the hierarchy (indent and emphasis). Print uses a dedicated layout: portrait for vouchers,
  landscape for reports and statements.

## 8. Document editors

- **Header:** the document number (auto-generated) and a status badge, then the party (customer or
  supplier), the dates, and the currency.
- **Lines:**
  - A dense grid: product picker (SKU · price), quantity, price, discount, tax, and line total.
  - Numeric columns never clip; widths come from tokens that fit 10+ digits.
  - On phones the grid becomes line cards.
- **Totals block:** subtotal, discount, tax, then the grand total in `text-card-title font-semibold`
  above a top rule. It is aligned to the numeric edge.
- **Action bar:** one primary action, with secondary actions grouped. It is sticky at the bottom on
  phones.
- **Validation:** inline, under the field, and never clears entered data.

## 9. Responsive, RTL, accessibility

- **RTL:** logical properties only (`ps/pe/ms/me/start/end`, `text-start/end`). Directional icons use
  `rtl:rotate-180`. The sidebar sits on the start side.
- **Breakpoints:**
  - phone < 768
  - tablet 768–1023: collapsible sidebar sheet
  - laptop ≥ 1024
  - desktop ≥ 1440
- **Dialogs** fit within `100dvh - 2rem`. Primary actions stay in a sticky footer that remains
  visible above the mobile keyboard.
- **Accessibility:**
  - Contrast: AA text 4.5:1 and UI 3:1, verified by the contrast script.
  - Every field has a label, and every icon-only button has an `aria-label`.

## 10. Exceptions (justified)

- Print templates may use print-only colors, because print is independent of the screen theme.
- The auth pages keep a navy primary in both themes (brand moment).
