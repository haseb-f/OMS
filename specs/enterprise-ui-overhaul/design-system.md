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
  - The balance check is a `ReconciliationCard`, not a floating badge; see §11.5. It shows balanced,
    unbalanced (with the discrepancy and a drill-down) or not applicable.
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

## 11. Round 2 — compact controls, organized headers, feedback, reports (2026-09-27)

These patterns are adapted from Cloudflare Kumo (`kumo-research.md`; `@cloudflare/kumo` 2.14.0,
MIT) onto our shadcn/Radix stack. Tokens and components stay the same; only the recipes are refined.
This is not a second design system.

### 11.1 Selector triggers are buttons; text inputs are fields

This section deliberately diverges from Kumo. Kumo draws select triggers like white inputs; the
owner's brief asks for button-like triggers.

- **Selector.** This covers every select, combobox, filter, month or date-range picker, and domain
  picker trigger. It is a neutral tonal button: `EnterpriseButton variant="field"` or `SelectTrigger`.
  - Surface: `--selector` background with an inset 1px `--selector-border` hairline.
  - Content: the value in medium weight, or the placeholder in `--placeholder`. An optional leading
    icon comes first, and a 16px muted `ChevronDown` sits in a fixed end slot.
  - Hover uses `--selector-hover`. Pressed or expanded uses `--selector-active` plus an inset
    focus-ring hairline.
  - Keyboard focus shows the 2px outline. Invalid shows an inset destructive hairline. Disabled uses
    the muted fill with no hairline.
  - An applied filter is brand-tinted (`bg-primary-soft text-primary`, medium weight).
  - The clear (×) sits in the end slot, appears only when there is a value, and never opens the menu.
- **Text input.** Text, number, money, search and date inputs are white `--card` fields.
  - They use the `--input` border (3:1) and a focus-ring border.
  - Read-only fields use the sunken fill; disabled fields use the muted fill.
- **Heights.** Fields and triggers are 32px on desktop (`--control-height-md`) and 40px on touch.
  Text stays 14px: compact never means smaller text.
- **Menus.**
  - Rows are 32px (40px on touch), with a neutral highlight and a trailing check on the selected item.
  - Height is bounded, and placement avoids collisions with 8px padding.
  - Search and a top-positioned quick-create are kept.

### 11.2 Headers

- **Global TopBar (48px).** In order from the start edge:
  - the navigation toggle (phones and tablets)
  - Back and the breadcrumb, the only location indicator
  - search
  - language, theme and notifications, with the account menu at the end
- **Page header** (list, settings and report pages). One row:
  - the title, with an optional one-line subtitle
  - the actions, at the end
- **Document and record header.** It shows, in order:
  - the identity: title plus reference (the auto-generated number), as the h1
  - labeled status groups, where payment and fulfillment are always separate groups
  - key meta: party, date, currency
  - the actions
- **Actions** (shared `HeaderActions`), placed from the end edge:
  - ONE primary action (filled)
  - up to two frequent secondary actions (outline)
  - an «المزيد / More» overflow menu for the rest
  - destructive actions inside the overflow menu, separated, shown in red and confirmed before running
- **Phones.** The title wraps and is never clipped, and the primary action stays visible. Secondary
  actions collapse into the overflow menu.
- **Sticky headers** are allowed only on record and document pages. They are at most 64px tall and
  sit at `top-(--shell-topbar-height)`.

### 11.3 Cards

`EnterpriseCard` is the only card.

- `rounded-md` (8px), a solid `--card` surface, a 1px `--border` and no resting shadow.
- Padding is 12px (compact) or 16px (default).
- Section headings use `text-card-title`, with an optional one-line description.
- No card nests inside another. Nested groups use a heading plus a hairline divider, not another
  bordered box.

### 11.4 Feedback

- **Field errors.** Shown under the field, with an icon and text.
- **Form error summary.** After a failed submit, a persistent `FormErrorSummary` banner appears at the
  top of the form.
  - It lists each problem as a link that focuses the related field.
  - Focus moves to the first invalid field, and the banner announces through `aria-live="polite"`.
- **Success.** The document header status updates in place, with a link to the resulting record
  where useful. A toast only supplements this.
- **Long tasks** (such as imports) show progress, then completion counts, errors and a retry.
- **Persistent warnings** use `Alert` banners that stay until the issue is resolved or dismissed.
- **Toasts.**
  - Placement: top of the viewport, at the logical end corner on desktop and centered on phones.
  - Style: a solid body, with the tone shown as an icon and a tinted border.
  - They never replace on-page feedback.

### 11.5 Financial report header and reconciliation

- **Header.** One compact block with two rows:
  - Row 1: the title plus a context line (period or as-of date, currency, posted-only), with the
    report picker and export/print actions at the end.
  - Row 2: a single filter row. Secondary filters sit behind «فلاتر إضافية», and phones get the
    Filters sheet.
- **Summary strip.** KPI and reconciliation cards form a compact strip, at most 72px tall, under the
  header and separate from the table. The table stays high in the viewport.
- **Reconciliation.** Shown only where it is mathematically meaningful (TB, GL, journal).
  - Balanced: a subtle success icon plus «مدين = دائن» and the totals. It never claims that "all
    accounting is correct".
  - Unbalanced: a destructive banner with the discrepancy amount shown prominently and a drill-down
    link.
  - Not applicable (for example, filtered accounts): a neutral note, with no badge.

### 11.6 Sidebar

- **Container.** Inset with an 8px gutter, `rounded-lg`, a solid `--sidebar` surface, a 1px border
  and no shadow.
- **Items.** `--radius-sidebar-item` (10px, one step softer than controls; 2026-09-29) and 32px tall;
  nested items are 28px. The item box and height are unchanged, so no usable space is lost.
- **Active item:**
  - a 4px `--sidebar-rail` rail on the outer edge (logical start: right in RTL, left in LTR), with a
    soft `--sidebar-rail-glow` shadow
  - a `--sidebar-active` tint
  - a semibold label and a rail-colored icon
  - the same treatment on nested items and in the mobile drawer
- **Hover and focus.** Hover is a neutral tint; focus is the inset outline. No state shifts the
  layout.

## 12. The OMS design (Round 3 Vercel-reference + Round 4 polish) — CANONICAL (2026-09-28)

Status: **approved by the owner and rolled out app-wide on 2026-09-28** — the only design; the
pilot switch, `data-ui="geist"` scoping and every classic branch were removed. Reference values:
`geist-research.md`. Implementation: tokens in `app/globals.css` (`:root` / `.dark`) and
`theme/tokens.css`; recipes (structural rules tokens cannot express, keyed on `data-slot` /
`data-variant`, unlayered) in `theme/recipes.css`.

### 12.1 Change contract

- Tokens first: a visual change is a token change in `globals.css` / `tokens.css`; a recipe in
  `theme/recipes.css` only when a token cannot express it (visual properties only — never size or
  layout, so callers' layout classes still apply).
- Screens keep their layout in presentational components (`lead-detail-view.tsx`,
  `dashboard-overview.tsx`, `document-editor-layout.tsx`, …) that reuse the page's data, handlers
  and permissions.
- Never change data flow, API calls, payment rules, shipping states, permissions, calculations,
  validation rules or accounting behavior for a visual reason.

### 12.2 Surfaces, lines, elevation

- Canvas `--background` #fafafa (dark #0a0a0a); every surface (card, table, field, menu) is solid
  `--card` white (dark #111). No gradients, glass, inset/embossed fills or grey tonal controls.
- Hairlines: `--border` #ebebeb for surfaces and dividers; `--border-strong` for secondary buttons;
  `--input` #d1d1d1 for control rings (hover `--input-hover`).
- Elevation: cards a whisper (`--shadow-card`), menus/popovers `--shadow-floating`, dialogs
  `--shadow-modal`. Nothing else casts a shadow.
- Radius: 6px controls and menu rows, 8px cards/menus/popovers, 12px dialogs, pills only for
  badges and status dots.

### 12.3 Type

- Geist for Latin text and digits, IBM Plex Sans Arabic for Arabic (automatic per glyph through
  the `--font-sans` stack). Geist Mono (`font-mono`) only for machine references where a monospace
  helps (SKU, IBAN, hashes) — never for amounts.
- Same size scale as §2. Latin h1/h2 get −0.02em tracking; Arabic never gets negative tracking.
- Hierarchy by weight and color: `text-foreground` primary, `text-muted-foreground` secondary.

### 12.4 Controls

- One height per size (32px desktop, 40px touch). Buttons weight 500, radius 6.
- **Hierarchy per context:** exactly one filled primary (navy; light in dark mode). Confirm,
  Approve, Convert to Order and Post use `variant="success"` (refined green, white text, ≥4.5:1).
  Destructive uses `variant="destructive"` (solid red) and always confirms. Everything else is
  `outline` (white, hairline) or `ghost`.
- **Selector triggers** (Select, EntityCombobox, filters, pickers): white control, `--input` ring,
  fixed 16px chevron at the end. States: hover = darker ring + faint fill; open/pressed = focus-blue
  ring + 3px halo; has value = value in `text-foreground`, placeholder in `--placeholder`; focus
  = 2px outline; invalid = red ring + halo; disabled = muted fill. Applied filter = brand tint.
- **Text inputs:** white, `--input` border, focus = blue border + 3px halo, read-only = sunken,
  invalid = red border + halo.
- **Menus:** 8px panel, 6px rows (32px, 40px touch), neutral highlight, trailing check for the
  selected row, destructive items red and separated.
- **Segmented control** (period, view switches): one ringed track, the selected segment filled.
- **Tabs:** underline tabs, selected = foreground text + 2px underline.
- **Badges:** subtle pills (tone-100 surface, tone-900 text); the label always names the state.

### 12.5 Page anatomy

- **Shell:** flush sidebar on the canvas with a hairline edge; 48px white top bar (breadcrumb,
  ⌘K search, locale/theme/notifications/account). Sidebar labels are one line (nested included,
  truncated with the full text in `title`); the active item keeps the accent rail and a restrained
  grey highlight.
- **Page header:** title (20px/600) + one-line context, actions at the end, one row on desktop.
- **Action toolbar:** from the end edge — primary (filled or green) → up to two outline secondaries
  → «المزيد / More» menu (destructive last, red, separated).
- **Sections:** a heading (16px/600) with an optional one-line description and an optional action,
  then a white card. Settings-style forms use the Geist fieldset: body + a footer band
  (`--surface-sunken`, top hairline) holding help text at the start and the action at the end.

### 12.6 Screen rules

- **Dashboard:** 1) Needs attention — an entity list of actionable queues (count, one-line reason,
  link), zero rows shown as "clear" not hidden noise; 2) Metrics — one strip of real figures for
  the selected period; 3) Operational details — ranking table. No decorative charts, no invented
  data.
- **Lead detail:** identity header (name, number, status) with ONE next action chosen by workflow
  priority (convert when qualified → assign when unassigned → overdue follow-up → follow-up);
  workflow transitions and other actions grouped as secondary / «More». A stage indicator shows
  where the lead is (New → In progress → Qualified → Converted). Details in one card grid.
- **Orders and invoices:** compact proportional fields (party wider, dates/currency/reference
  narrow), item rows aligned on one grid, totals block aligned to the numeric edge with the grand
  total emphasized, a predictable footer: secondary actions at the start, the final action at the
  end.
- **Financial reports:** one reusable layout — title + context line, filter row, actions, summary
  strip (figures + reconciliation status), table. "Balanced" appears as a reconciliation summary
  (debit total = credit total, difference 0) — never a floating badge.
- **Feedback:** validation next to the field and summarized next to the action that failed;
  success shown in place (status, link, inline note). Toasts only supplement.

### 12.7 Workflow tracker (Round 3.1)

One shared, read-only tracker for multi-step operations: `components/shared/workflow-tracker.tsx`.

**API.**

- `WorkflowTracker` — `label` (accessible name), `stages: {key, label, caption?, optional?}[]` (the happy
  path, in order), `current` (stage key), `currentComplete` (the final stage was reached),
  `completed?` (explicit set; default = every stage before `current`), `state?: {label, tone}`
  (a branch/terminal state — Lost, Cancelled, Returned, Payment review… — which becomes the
  current step, drawn by `state.placement`: `before` the first stage for pre-start states
  (Unfulfilled), `inline` after the last completed stage for branches (Payment review,
  Submitted), `after` for terminal states (Cancelled, Returned, Lost)), `fullFrom` (container width for the full form).
- `WorkflowTracks` — independent, labeled tracks of one record (`tracks: {key, label, meta?, …}`),
  e.g. «الدفع / Payment» and «التنفيذ / Fulfillment». Tracks never merge.
- `resolveWorkflowTrack()` — the pure mapping (unit-tested in `workflow-tracker.spec.tsx`).

**Rules.**

- Stages come only from the real status codes the API stores. If a status set is not linear,
  show the linear happy path and the record's branch/terminal state honestly as `state` — never
  invent a stage, never mark a step done that the data does not imply. A stage a record may skip
  (Partially paid; Draft/Approved when Confirm approves implicitly or a document is created
  confirmed) is `optional`: shown only while current or when the caller proves it was passed
  (listed in `completed`). Each screen keeps its
  code → track mapping in one pure function next to the screen (unit-tested).
- Read-only: an ordered list, no buttons/links/tabindex, no pointer or hover; status changes
  happen through the page's actions. `aria-current="step"` on the current step; each step carries
  visually hidden «مكتملة / قادمة / المرحلة الحالية». Markers never look selectable: done = filled check, current = solid dot with a soft
  halo, upcoming = small muted dot. The compact count is i18n («2 من 3» / “2 of 3”). Stage labels
  reuse the status badge wording.
- Full form (dot + label + connector, captions such as dates under a stage) when the tracker's own
  container is wide enough; otherwise the compact form «stage · 2 / 3» + a segmented bar
  (`role="progressbar"`), never clipped at 390px. Tokens only; logical properties; no motion.
- Payment and fulfillment are always separate tracks (payment never advances fulfillment).

**Live screens.**

| Screen               | Track(s)          | Source                                                                                                                                                                                                     |
| -------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lead detail          | Stage             | `Lead.status.code`: NEW → (working, optional) → (QUALIFIED, optional) → CONVERTED, optional stages proven by `GET /workflow/LEAD/:id/status-history`; LOST/DISQUALIFIED = state                            |
| Store order detail   | Payment           | `StoreOrder.paymentStatus`: PAYMENT_PENDING → (PARTIALLY_PAID, optional) → FULLY_PAID_RECONCILED; OVERPAID, PAYMENT_REVIEW, UNMATCHED = state after PAYMENT_PENDING; meta = Sales declaration, type        |
|                      | Fulfillment       | `fulfillmentStatus.code`: shipping (READY, optional) → SHIPPED → DELIVERED (shipment dates as captions); pickup AWAITING_PREPARATION → READY_FOR_PICKUP → COLLECTED; others = state; meta = carrier        |
| Sales invoice editor | Document, Payment | `SalesInvoice.status`: (DRAFT, optional) → (APPROVED, optional) → CONFIRMED (PENDING_APPROVAL, CLOSED, CANCELLED = state); `paymentStatus`: UNPAID → (PARTIALLY_PAID, optional) → PAID (CANCELLED = state) |

Mappings: `components/crm/lead-stage-indicator.tsx`,
`components/store-orders/store-order-workflow-tracks.tsx`,
`app/(shell)/sales/invoices/invoice-workflow-tracks.tsx`. The document editor takes it through the
`headerTracker` slot.

**Next screens to adopt the tracker.**

| Screen                 | Status source                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Purchase orders        | `PurchaseOrderStatus`: DRAFT → APPROVED → CLOSED; CANCELLED = state (ADR-0015)                                                                   |
| Purchase invoices      | `PurchaseDocumentStatus` (same shape as sales) + the shared server-computed invoice `paymentStatus` as a second track                            |
| Payment reconciliation | Payment record `PaymentStatus`: PENDING → MATCHED → VERIFIED; REJECTED/DISPUTED = state. Bank line `BankTransactionMatchStatus` as its own track |
| Returns                | Sales/purchase return `status` (`SalesDocumentStatus` / `PurchaseDocumentStatus`): DRAFT → APPROVED → CONFIRMED; CANCELLED = state               |

### 12.8 Summary tiles and metric groups (Round 3.2 / Round 4)

- `InsightCard` (`components/shared/insight-card.tsx`): label → figure (+ muted unit) → at most one
  context line. Tone = small tinted icon; verdict colour on the figure only where it means something;
  `emphasis` (open work / discrepancy) adds a start-edge accent. Only `href` tiles react to hover /
  focus (tone edge, faint tint, soft elevation — no transform, no layout shift).
- `InsightGroup`: related static tiles on ONE surface split by 1px hairlines (block-start and
  inline-start shadows, clipped at the container, so any wrap stays correct). Interactive or verdict
  tiles stay separate cards beside the group. Dashboard: Leads and Orders groups share the 4-column
  rhythm; a shorter group spans its share (`--span`). Report: reconciliation card + one figures group.

### 12.10 Radius and tactile controls (Round 4)

| Token (`tokens.css`; menu/dialog in `globals.css`) | Value     | Was (Round 2) | Used by                                     |
| -------------------------------------------------- | --------- | ------------- | ------------------------------------------- |
| `--radius-control` → `rounded-sm`                  | 8px       | 6px           | buttons, inputs, selects, pickers, toolbars |
| `--radius-surface` → `rounded-md`                  | 10px      | 8px           | cards, tiles, table containers              |
| `--radius-overlay` → `rounded-lg/xl`               | 12px      | 10px          | popovers, drawers                           |
| `--radius-menu` / `--radius-dialog`                | 10 / 14px | 8 / 12px      | menus / dialogs                             |

Never a pill on a control; `rounded-xs` (4px) and badge pills unchanged.

Control recipe tokens (light/dark, `globals.css`): `--control-border`, `--control-border-hover`,
`--control-hover`, `--control-pressed`, `--control-shadow` (neutral controls at rest),
`--control-shadow-solid` (filled actions), `--control-inset` / `--control-inset-solid` (pressed),
`--segment-track` / `--segment-on`. States: rest → hover (fill + edge) → pressed/open (inset sink,
darker fill) → focus-visible (ring + halo). Colour and shadow only — never transform or size; the
chevron rotation on an open trigger is disabled under reduced motion. Green stays reserved for
confirm / approve / convert; ordinary controls stay neutral.

### 12.11 Dropdown triggers and button groups (Kumo refinement, 2026-09-29)

Reference: Cloudflare Kumo, measured on kumo-ui.com (`kumo-research.md` §4). Our 32px/40px-touch
height and 8px radius stay (D2/D4); only the text, chevron and group seams change.

- **One chevron:** every trigger ends with `TriggerChevron` (`components/ui/trigger-chevron.tsx`).
  `kind="select"` = up/down caret (Select, EntityCombobox/SearchableSelect, filters, report
  selector) and never rotates; `kind="menu"` = down caret for action menus / split buttons, turns
  while open; `kind="disclosure"` = the caret before an inline show/hide label. Size 16px
  (`--trigger-chevron-size`), 14px for sm triggers; colour `--muted-foreground`, `--foreground`
  on hover/open; on a solid button it takes the button's text colour. Never a hand-placed
  `ChevronDown` on a trigger.
- **Text:** a chosen value and a filter's name read at `--trigger-weight` (500) in full
  foreground; a real placeholder stays 400 in `--placeholder` (≥4.5:1). A picker inside a list
  filter bar (`FilterBarProvider`) treats its empty text as the filter name and gets the same
  brand tint as `FilterTrigger` once set.
- **Disclosure:** `DisclosureTrigger` (`components/shared/disclosure-trigger.tsx`) is the one
  "More details / Notes & terms" control inside forms and editors.
- **Button groups:** `ButtonGroup` = one outer rounding, square inner edges, items after the first
  pulled back 1px so the two edges overlap into one seam (no doubled border); items drop their
  drop shadow; hovered / open / focused item is lifted (z-index) so its full edge shows; a disabled
  item keeps the group edge colour. Logical properties — order mirrors in RTL. Only for controls
  that act together (pager, expand/collapse all, split button); unrelated actions stay separate.
- **Not triggers (unchanged on purpose):** row/tree expanders (`TreeToggleButton`, report-table
  and permission-matrix row carets, journal-line detail toggle), sort icons, icon-only menus
  without a caret (row actions ⋯, top-bar theme/language/profile), sheet-opening "Filters"
  buttons on phones.

### 12.12 Report header collapse, soft surfaces, toolbars (Round 5, 2026-09-30)

Spec: `specs/order-operations-r5/spec-4-visual.md`. Released only after owner visual approval.
Reference for the soft treatment: Microsoft Clarity's calm dashboard (white fields, gentle
gradients, delicate borders) — adopted as a restrained tint, not copied. The light canvas stays
white; nothing uses backdrop blur, transforms or new radii.

**Report header collapse (4A).** `FinancialReport` (every financial report) owns a collapse toggle
(`PanelTopClose` / `PanelTopOpen`, an outline button like the other report actions, labelled «طي / توسيع» · Collapse / Expand from `sm` up (icon-only with the label as sr-only text on phones), full hint in a tooltip; a disclosure, so "expanded" is drawn at rest, never pressed;
`aria-expanded`, `aria-controls` = filter row + summary strip). Preference:
`STORAGE_KEYS.reportSummaryCollapsed` = `oms.report.summaryCollapsed` (one device preference for all
reports; listed in `DEVICE_PREFERENCE_LOCAL_KEYS`, kept across logout), read with `useStoredPreference` (`useSyncExternalStore`, server snapshot = default) so a collapsed report never paints expanded first. Collapsed = ONE row ≤ 44px:
title · period (phones too, truncated) · currency (from `sm`) · filter badge (count of `countActiveReportFilters`; opens the filter row
in place without expanding) · caveat badge (`collectReportAlerts`: unbalanced + discrepancy, drafts
included, every report warning / partial-data note, plus the report's own `alerts` prop for caveats that live only in `notice` — cash-availability estimate, cost-explorer truncated data / incomplete cost state; list in a popover) · switcher · actions ·
expand. The summary strip stays in the DOM with `hidden`. No height animation (instant swap), so
reduced motion needs nothing. Print / Excel / CSV are rebuilt from data (`buildDocument`) and are
identical collapsed or expanded (`financial-report-collapse.spec.tsx`).

**Soft surfaces (4B).** Tokens (`globals.css`, light / dark; print overrides in `theme/print.css`):

| Token                                     | Light                                         | Dark                       |
| ----------------------------------------- | --------------------------------------------- | -------------------------- |
| `--surface-soft`                          | brand canvas 45% over `--card` (≈2.3% tint)   | `#52a8ff` 3% over `--card` |
| `--surface-soft-border`                   | navy 11% translucent hairline                 | white 8% translucent       |
| `--surface-soft-hover-border`             | navy 20%                                      | white 15%                  |
| `--surface-soft-gradient`                 | `--surface-soft` → `--card` by 5.5rem         | same formula               |
| `--surface-soft-shadow` / `-shadow-hover` | navy (`--brand-navy` mix) whisper / soft lift | none / dark lift           |
| `--surface-soft-tone-strength`            | 4% (tone tint of a tile, `--insight-*`)       | 6%                         |
| `--surface-soft-row-hover`                | brand canvas 55% (list row hover)             | blue 6% over `--card`      |

Print (`--print-paper` / `--print-rule` tokens): white, 1px rule, no gradient / tint / shadow. Applied only through shared
components: `EnterpriseCard surface="soft"` (`[data-surface="soft"]` recipe) — used by every
`DashboardPanel` (attention, ranking, sales, activity, bank); `InsightCard` (tone-tinted top,
neutral tiles untinted) and `InsightGroup` (one soft surface, cells transparent; a group inside a
soft panel shares the panel's surface); attention rows hover `--surface-soft-row-hover`. Hover /
focus change border and shadow only (no fill change, transform or layout shift);
`prefers-reduced-motion` → no transition. Radius stays `--radius-surface`. Metric sizes unchanged.

**Toolbars (4C).**

- `ListToolbar`: card surface + bottom hairline (the grey band is gone); controls 4px apart, 6px
  between wrapped rows. `EnterpriseDataTable`: search → `ListToolbarSeparator` (hairline, from the
  `@3xl` table width) → the filters flowing in the same row (`ListToolbarGroup` as `contents`, so
  they fill the search row before wrapping and never take a row of their own) → view controls at
  the end edge (no separator there: when the row wraps a leading hairline would be orphaned).
- `FilterTrigger`: unset = the filter's name; set = «Name: Value» (name `--muted-foreground` 400,
  value foreground 500; applied = primary soft tint + primary value); several values = name + count
  badge. The name never truncates; a long value does (full text in `title`), max 18rem. States: hover
  `--control-hover`; open / pressed `--control-pressed` + focus-ring edge (placeholder steps up to
  `--muted-foreground` there to keep 4.5:1); focus-visible = ring + halo. `SelectFilter` shows the
  value alone for a required switch or a filter named by its «All …» text.
- `ToggleGroup` and `SegmentedRadioGroup` share one recipe with the `ButtonGroup` silhouette: 32px
  (40px touch) track, `--control-border` ring, `--radius-control`; selected segment `--segment-on`,
  full foreground at the same weight (500) as the others — no width shift. Segments may carry a leading Lucide icon (agent order form: Shipping / Pickup,
  Prepaid / COD, Shipping added / included).
- Toggle filters (Show archived, Loss-making) are `Toggle` (pressed = primary soft tint), never an
  outline/secondary button swapping variants. `Toggle` uses the control edge and shadow.

Contrast (`node scripts/design/contrast-check.mjs`) adds: text / muted / placeholder on
`--surface-soft`, muted on row hover, filter name and value on the applied tint, open-trigger value /
placeholder / label on `--control-pressed`, segment on / off text. The script now flattens
multi-line `color-mix()` values (Prettier wraps them).

### 12.13 Dashboard scopes, soft tiles and the dropdown trial (Round 6, 2026-10-01)

Spec: `specs/ui-navigation-r6/spec.md` §E. Released only after owner visual approval.

- **Colour follows meaning:**
  - blue (`info`): new things and activity
  - green (`success`): conversion and delivery
  - amber (`warning`): pending work and follow-up
  - red (`destructive`): overdue items, errors and returns
  - neutral: everything else

  Each metric tile is its own soft card. `InsightGroup` is only a grid with an 8px gap and draws
  nothing itself.
  - A toned tile has a top-to-bottom tone gradient:
    - light: 12% at the top, 3.5% at the bottom
    - dark: 18% at the top, 6% at the bottom
  - The tile hairline carries 28% of the tone (32% in dark); the icon chip 18% (26% in dark).
  - Tokens: `--insight-tint-top`, `--insight-tint-bottom`, `--insight-tint-border`,
    `--insight-icon-fill`.
  - Flat at rest: no shadow.
  - Neutral tiles stay a plain card with the standard border.
  - A toned figure that is exactly zero or empty renders neutral (`resolveInsightTone`). Pass
    `amount` when the value is a formatted node, and `keepToneAtZero` where zero is itself the
    news.
  - The value stays in the foreground colour. An emphasized destructive or loss tile is the
    exception: its value is red.
  - Hover applies to interactive tiles only: the edge goes to 45% of the tone, plus a soft lift.
  - Print: white paper and one rule.

- **Scope lives in the header, not the tile.** `DashboardPanel` takes `scope`, rendered as
  `InsightScope`, a neutral outline chip with three values:
  - `period`, the selected period («هذا الشهر»)
  - `current`, the state right now («الآن»)
  - `toDate`, everything so far («حتى تاريخه»)

  A tile whose scope differs from its group's carries the chip in its `meta`. Tile context lines
  never repeat the period.

- **Labels are never truncated.** `InsightCard` labels wrap; context lines may truncate, with the
  full text in `title`.
- **Panel icons.** `DashboardPanel` takes `tone`, which tints its header icon chip (`panel-icon`)
  the same way as a tile icon.
- **Hover.** Static soft panels have no hover affordance; only `data-clickable` cards and `href`
  tiles react. Keyboard focus inside a panel still firms its edge.
- **Agent dashboard** (`/agent`) is built from the same panels and groups:
  - Orders and fulfillment, to date
  - Leads, now, from the scoped leads-list totals
  - Sales and collections, to date
  - Statement position, now

  Money panels appear only when the API returns them. Drill-downs live in the panel headers.

- **Summary surfaces.** `DetailSummaryBar` (`data-slot="detail-summary-bar"`) and the agent
  `SummaryCard` (`DetailSection surface="soft"`) use the soft summary surface and print plain.
- **Dropdown-trigger trial (graduated in Round 7).** The local-only A/B switch, its CSS and its
  `--trial-*` tokens were removed; trial A is now the default, see §12.14.

### 12.14 Navy dropdown triggers and stronger tone accents (Round 7, 2026-10-03)

- **Triggers are solid deep brand navy.** One recipe in `theme/recipes.css`, driven by the
  `--selector*` tokens (light and dark), covers every closed trigger:
  - `SelectTrigger` (default variant)
  - `EnterpriseButton variant="field"`: entity combobox, searchable select, filter trigger, date
    range and month pickers
  - `EnterpriseButton variant="menu"`: labelled action-menu triggers (Export, Import, Columns,
    More, report switcher, phone "Filters", company switcher)
- **Text and icons.** Selected value: white, `--trigger-weight` (500). Placeholder and filter
  label: `--selector-muted`, weight 400. Icons use `--selector-muted`. The chevron sits on a small
  `--selector-chip` square.
- **Radius.** `--radius-control` minus 2px, tighter than a primary button.
- **States.**
  - hover: `--selector-hover` fill
  - open and pressed: `--selector-active` fill with a 1.5px `--selector-open-edge` edge
  - keyboard focus: the 2px focus ring, offset 2px
  - invalid: a 1.5px red edge plus a halo
  - disabled: the muted surface, no navy
  - applied filter: `--selector-applied` fill with the open edge
- **Dark mode.** The navy is lifted to `#0e2a4b` with a light-blue hairline edge, so it never
  disappears on the `#0a0a0a` canvas.
- **Exceptions.**
  - Ghost `SelectTrigger` stays a light borderless control for in-cell edits and carries semantic
    badges.
  - Menu content stays on the light popover surface.
  - Text inputs stay white.
  - Icon-only ghost and outline menu buttons (profile, language, theme, row actions) stay as they
    are.
  - Badges inside a trigger keep their semantic colours.
- **Contrast.** `scripts/design/contrast-check.mjs` verifies value, placeholder, icon, chip, edge
  and open-edge pairs on every state fill, in both themes (text ≥ 4.5, UI ≥ 3).
- **Tone accents one step stronger.** The `--insight-tint-*` and `--insight-icon-fill` tokens were
  raised. `DashboardPanel` now sets `data-tone`, and the recipe gives non-neutral panels a
  tone-tinted header gradient and a faintly toned edge. Meanings:
  - blue: activity / new
  - green: success / completion
  - amber: pending attention
  - red: overdue / error

  Panel title and description pairs are in the contrast check.

- **Dashboard honesty.**
  - A failing sub-panel shows its own error with retry. Failure is never rendered as zero or as an
    empty list.
  - A failed period shows "—" in the activity table.
  - Permissions still loading shows skeletons, never the empty state.
  - A user with no dashboard figures sees shortcuts to the modules they may open.

### 12.15 Toolbar tonal sequence (Round 7 addendum, 2026-10-04)

- **What.** Inside a `ListToolbar` (every `EnterpriseDataTable`, the chart-of-accounts and
  warehouse-location trees, company and agent interfaces alike) the ordinary controls no longer
  share one navy: they step through five blues derived from the brand pair, one solid surface per
  control. The ramp runs from the logical start (deepest, `--toolbar-tone-1`) to the logical end
  (lightest, `--toolbar-tone-5`) and cycles — right-to-left in Arabic, left-to-right in English,
  because the index follows DOM order. The progression is across controls, never a gradient behind
  the strip. This supersedes §12.14's uniform navy for these toolbars only; forms, dialogs, report
  selectors and header actions stay navy.
- **Tokens.** `--toolbar-tone-{1..5}` with `-hover`, `-active`, `-border`, `-muted`, `-chip`,
  plus the shared `--toolbar-tone-foreground` and `--toolbar-tone-applied-edge`, light and dark,
  in `app/globals.css`. Light: `color-mix(in oklab, var(--brand-blue) 36 / 49 / 62 / 75 / 88 %,
var(--brand-navy))`. Dark: the lifted navy `#0e2a4b` mixed toward the brand blue at
  0 / 22 / 44 / 66 / 88 %, each with the light hairline edge. Hover darkens 10 %, pressed / open
  18 %, so text contrast only rises with interaction.
- **Mechanism.** `ListToolbar` runs `useToolbarTones` (`shared/data-table/toolbar-tones.ts`): a
  layout effect plus a `MutationObserver` numbers every eligible descendant
  (`[data-filter-trigger]`, `variant="field" | "menu" | "outline"` buttons, non-ghost
  `SelectTrigger`) as `data-toolbar-tone="1..5"`. One recipe in `theme/recipes.css` maps each
  number onto the `--selector*` tokens the §12.14 recipe already consumes, and adds toned outline
  buttons to that recipe. No page sets a colour.
- **Stability.** Numbering counts controls a responsive class hides (the phone "Filters" button,
  the inline filter group), so hiding, wrapping or overflowing never recolours the rest. Exempt
  controls are not counted either, so toggling them cannot shift their neighbours.
- **Exempt (never toned, never counted).** The search input and checkboxes; the bulk-action strip;
  anything under `data-tone-exempt`; pressed-state toggles (`aria-pressed`, `Toggle`,
  `ToggleGroup`); success / destructive / status / distribution controls and badges; ghost icon
  buttons (refresh, sort, density, options); dropdown content; the filter bottom sheet (a dialog).
- **States, identical on every step.** hover: `-hover` fill · pressed / open: `-active` fill, the
  1.5 px `--selector-open-edge` and the inset sink · keyboard focus: the 2 px focus ring, offset ·
  disabled: the muted surface · **applied filter: the step's own fill with a 2 px
  `--toolbar-tone-applied-edge` ring** (one colour on all steps — a shade is never a state).
- **Contrast.** `scripts/design/contrast-check.mjs` checks, per step and per state fill, the value
  (≥ 4.5), the muted label and icon (≥ 4.5 / ≥ 3), the applied ring, the chevron chip, the edge on
  the card, the open edge on the pressed fill, and that neighbouring steps differ by ≥ 1.15:1.

### 12.16 Blue triggers everywhere (Round 8, 2026-10-04)

- **Owner decision.** The blue tonal progression of §12.15 is approved and applies to **every**
  dropdown trigger in OMS, not only table toolbars. This supersedes §12.14's "deep brand navy" and
  §12.15's "forms, dialogs and report selectors stay navy".
- **Default shade (standalone and stacked controls).** The base `--selector*` tokens now alias
  **tone 3** (`--toolbar-tone-3*`, light and dark). A form select, dialog combobox, lone picker,
  header action menu or inline cell editor therefore takes one fixed mid-ramp blue — vertical
  stacks are not a progression, and a field never changes colour when a conditional field appears.
- **Rows of related controls.** A run of selectors that sit side by side as ONE row steps through
  tones 1…5 in logical order (deepest at the reading start; RTL/LTR mirror for free) — via
  `ListToolbar` (all table toolbars) or the shared `SelectorRow` (`shared/selector-row.tsx`: report
  filter bar, product browser filters). `SelectorRow` is opt-in because a form grid reflows with
  the viewport and is not a row. Numbering counts hidden controls and skips exempt ones, so
  conditional controls appended at the end never recolour earlier ones.
- **Inline editors.** The light in-cell outline trigger is gone: `EntityCombobox` /
  `SearchableSelect` no longer have a `ghost` variant (the shipping company cell now uses the
  default blue trigger).
- **Semantic exceptions (unchanged).** `SelectTrigger variant="ghost"` remains ONLY for the
  shipping-status cell, whose trigger shows a semantic status badge (the colour there is the
  operational status). Pressed toggles, success / destructive / status controls, badges inside
  triggers, the primary "New movement ▾" action, icon-only ghost / outline menu buttons (row
  actions, profile, theme, language, selection ▾), menu content and plain text inputs keep their
  own colours.
- **Guards.** `shared/selector-triggers.spec.tsx` fails if any select / field / menu trigger sets a
  colour utility locally, if the default tokens stop aliasing tone 3, or if `SelectorRow`
  renumbers earlier controls when a later one appears. `contrast-check.mjs` already covers every
  tone, so the default shade is checked in light and dark.

### 12.17 Home launcher and dashboard surfaces (Round 8, 2026-10-04)

- **Home is not the dashboard.** `/` (company) and `/agent` (agent portal) is a permission-aware
  launcher and the landing page of every login; the Dashboard is a separate page at `/dashboard`
  and `/agent/dashboard`, listed after Home in the sidebar and as its own Home tile. Home is never
  gated; it can only list what the user may open.
- **Tiles come from one source.** `navigation/home-tiles.ts` builds one tile per authorized
  top-level entry of `navigation.config.ts` (an internal module, or an agent portal page) with the
  sidebar's own `filterNavigationByAuth` + `buildNavigationTree`; it opens the first authorized
  page and captions up to three authorized pages. Quick actions (new quotation / order / invoice /
  receipt / purchase order / purchase invoice / journal entry / agent order) use the route guard's
  own `resolveRouteAccess` (reviewed create overrides first), the user's audience and the
  super-admin bypass. Adding a module to the sidebar adds its tile; nothing is listed twice.
- **Identity colours.** `homeTone` on a top-level nav item picks one of ten `--hue-*` tokens
  (blue, sky, teal, emerald, amber, orange, rose, violet, indigo, slate; one lightness/chroma band,
  light and dark). An item without one takes a fixed slot from `HOME_TONE_CYCLE`. The hue is
  decoration, never a status; the title stays foreground colour.
- **`LauncherTile`** (`shared/launcher-tile.tsx`, recipe `[data-slot="launcher-tile"]`): a
  translucent tone gradient with a tone hairline, an inner highlight and a light backdrop blur over
  the page's quiet colour wash (`[data-slot="home-surface"]`). Hover and keyboard focus: a 2px
  rise, stronger edge and gradient, tinted shadow, the icon chip filling solid with a card-coloured
  glyph, the arrow nudging in the reading direction. Paint-only; reduced motion removes every
  transform and transition. One tile is one link; the caption is plain text.
- **Layout.** A centred, wrapping flex grid (`max-w-6xl`, tiles `basis-56`, growing to 18rem):
  one column on phones, centred rows when there are few tiles (an Agent Sales user sees three).
- **Dashboard surfaces.** `--insight-tint-top/bottom/border/icon-fill` raised (24 / 9 / 50 / 30 %
  light; 30 / 11 / 52 / 38 % dark), `--panel-header-tint` 20 % / `--panel-edge-tint` 34 %; toned
  panels also get a faint body wash and the inner highlight (`--insight-sheen`). Headline figures
  use `text-metric-lg` (28px) in a deep shade of the tone; the icon chip is 28px.
- **Interactive vs static.** A static summary is flat: no shadow, default cursor, no chevron. A tile
  that opens something has a resting lift, a pointer and a chevron (`insight-go`, or the action
  label), and on hover / focus: a 1px rise, a stronger tone border and gradient (`--insight-tint-
top/bottom-hover`), a tinted shadow, the icon chip filling solid, the figure moving to a more
  vivid shade of the tone. The number, its size and the box never change; nothing reflows.
- **Panel rows.** Attention rows (`data-slot="panel-row"`, `data-tone`) tint with their own tone on
  hover / focus and draw a logical start-edge accent; the icon chip scales 1.08.
- **Secondary text on tone.** `--insight-muted` (muted-foreground pulled toward the foreground) is
  the label / unit / context / panel-description colour on a toned surface, so the stronger tint
  keeps ≥ 4.5:1.
- **Contrast.** `contrast-check.mjs` covers per-tone label, value (rest and hover), icon on chip,
  card-coloured glyph on the solid chip, panel title / description / row text, and per hue: launcher
  title and caption on the strongest tint, icon on chip, glyph on the solid chip and the arrow —
  light and dark.

### 12.18 Control colour — ONE blue family (Round 9, corrected 2026-10-04)

- **Owner correction.** The first R9 pass spread the logo's navy / blue / teal over neighbouring controls.
  That is withdrawn: buttons and dropdowns use **one coherent blue family only**, deep blue → medium blue →
  light blue. (The sampled logo colours — navy `#0a2442`, blue `#336ac4`, teal `#41b3bd`, tokens
  `--logo-*`, from `apps/web/public/brand/oms-logo-light.png` — stay documented for brand use such as
  charts and the sidebar rail, never as a second hue on a control.)
- **The sequence** is the one approved in R7/R8: five solid blues derived from `--ramp-navy #04203c` and
  `--ramp-blue #3c78d0` (`--toolbar-tone-1…5`; dark mode lifts the deep end to `#0e2a4b` with a light
  hairline). A related run of selector controls (`ListToolbar`, the shared `SelectorRow`) steps through
  them in logical order — right → left in Arabic, mirrored in English; each control is ONE solid shade (no
  gradient inside a button). White text on every step; every step carries its own hover / pressed /
  hairline / label / chip / applied ring / open edge, all in `contrast-check.mjs`.
- **Standalone and stacked** controls (a form field, a dialog select, a lone picker, an inline editor) take
  the one default: the middle step (tone 3). Numbering counts hidden controls and skips exempt ones, so a
  control appearing or disappearing never recolours its neighbours.
- **Button roles:** primary = solid navy; secondary = soft blue tint with navy text; outline = blue-tinted
  hairline on the card; ghost = transparent with the soft blue tint on hover/pressed (`--btn-*`). Same blue
  family throughout. Semantic buttons — success (green), destructive (red), warning (amber) — are untouched,
  as are plain text inputs and menu/popover content.
- **States** (distinct): hover, pressed, open (`aria-expanded`), selected (toggle `aria-pressed`, exempt
  from the ramp), focus (2px ring), disabled (muted surface), invalid (red edge).
- **Meaning.** Blue is interaction colour: it never marks a workflow status or a confirmation.
- **Dark primary** stays the light neutral (a navy fill vanishes on the dark canvas).

### 12.19 Table / Grid on every list (Round 9, 2026-10-04)

- **Reference pattern and why.** `specs/round9-brand-grid/research.md`: neither shadcn/ui nor Kumo ships a
  selectable record-card grid; OMS composes `RecordGridCard` from shadcn-card anatomy (header with action
  slot → body → footer), Carbon's selectable-tile rule (one stretched link, controls above it), Fluent's
  selection semantics and an auto-fill CSS grid. No library was added.
- **Universal switch.** `EnterpriseDataTable` shows the Table / Grid switch on every list (`gridView`, default
  on; `false` only where a card would mislead). The choice is remembered per user and per table id
  (`oms.table.<user>.<table>.view`). Both views use the table's own query: server pagination, search,
  filters, sort, scope, totals and exports are identical — the Grid never fetches more (it draws the
  current page).
- **Automatic card.** Without a page template the Grid derives a card from the column types: name →
  title (the record number becomes the reference when the identity column is a code), code/reference →
  reference, status columns → badges, date + money → the key-figure line, then at most four label/value
  fields; the table's own selection checkbox and actions cell are reused. Page **templates**
  (`renderGridCard`, `config/<domain>/*-grid-card.tsx`, contract `specs/round9-brand-grid/card-templates.md`)
  give orders, leads, documents, customers, products, shipping, agents… business meaning.
- **Card anatomy and look.** Header = selection checkbox (start), name (the one link, stretched), actions
  kebab (end); body = reference (wraps), key figure on its own row, ≤ 4 label/value fields (empty ones
  dropped), separate status badges; footer = next action. Surface: **flat** — no gradient — a translucent
  tint of the record's primary workflow state over the card, a clean 1px hairline in that colour, a thin inner
  highlight and one very small shadow, radius `--radius-surface`, over a faint flat canvas. The colour is the
  entity's PRIMARY real state (`card-palettes.md`); a record with no workflow status is a neutral card.
  **Hover** = the tint steps up and the hairline strengthens (plus a small elevation on a card that opens a
  record); **keyboard focus** = the 2px ring around the whole card; **selected** = a 2px blue ring on a
  neutral blue tint, always with the checked checkbox. 160ms transitions, none under reduced motion, nothing
  moves or resizes.
- **Grid sizing.** One rule: `repeat(auto-fill, minmax(min(100%, 17rem), 1fr))` — columns follow the usable
  width, one on a phone, never narrower than 17rem. Report cards use 24rem.
- **Specialised (hierarchical / financial) lists.** Never the generic card:
  - Financial reports (`FinancialReportView`): the Grid is **grouped cards** — one card per top-level
    section/group with its descendants in order and indentation, every amount column named on each row,
    subtotal and grand-total rows keeping their weight and fill, the report totals in a closing card;
    expansion, drill-through, links and sign convention are the table's. Print/export are unchanged.
  - Chart of accounts and warehouse locations (`TreeGridCards`): one card per top-level node containing
    its subtree, drawn by the page's own node renderer (expand/collapse, selection, actions intact).
- **Parity.** Same record actions, selection (page / all matching / first N / clear) and bulk strip, selected
  count and scope, loading skeleton (cards), empty and error states, filtered exports.

### 12.20 Lead-distribution control — one colour per displayed state (Round 9, 2026-10-04)

The control is the outline button structurally; its surface is the recipe `[data-distribution-state]`.
The state model is `RuntimeStatus` (`CONTINUOUS | TIME_LIMITED | MANUAL | PAUSED`) plus the operational
condition "blocked" (an automatic mode whose last run failed / cannot assign) and the two read states.

| Displayed state | Colour                           | Label (button)                          | When                                                                                                                      |
| --------------- | -------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| continuous      | **green** (`--success`)          | Distribution active                     | auto round-robin, no failure                                                                                              |
| timeLimited     | **violet** (`--state-scheduled`) | Distribution active until {time}        | the all-day automatic mode (24 h from confirmation; the only time-bound mode — it is NOT a schedule, no scheduler exists) |
| manual          | **slate** (`--state-manual`)     | Distribution manual                     | no automatic assignment, by choice                                                                                        |
| paused          | **amber** (`--warning`)          | Distribution paused                     | stopped; an expired 24-hour mode also reads paused                                                                        |
| blocked         | **red** (`--destructive`)        | Distribution blocked · {mode}           | an AUTOMATIC mode with a failure — **a failure beats the mode** in colour; the mode is still written                      |
| unavailable     | dashed neutral outline           | Distribution status unavailable · Retry | the snapshot could not be read (no state is claimed)                                                                      |
| loading         | quiet outline                    | Loading distribution status…            | first snapshot pending                                                                                                    |

The pending-lead count is its own chip inside the button — a non-zero backlog alone is never "blocked".
Selecting a mode in the dialog previews it, Confirm applies it, Cancel changes nothing; the button and the
dialog's "current mode" chip always show the server-confirmed state. Permissions (`crm.leads.manage`) and
execution rules are unchanged. Contrast of every label on rest and hover is in `contrast-check.mjs`.

### 12.21 Module overview, metric titles, distribution dialog (Round 10, 2026-10-04)

- **Module overview** (`/modules/<id>`): a Home tile of a module (an entry that groups pages) opens the module's
  overview — never its first submenu — even when only one page is authorized. A page entry (Dashboard, an agent
  portal page) still opens directly; the agent portal has no modules, so its tiles stay direct. The overview is
  derived from `navigation.config.ts` through `buildModuleOverview` (same `filterNavigationByAuth` as the sidebar,
  sub-groups from `NAVIGATION_GROUPS`) — no second menu. Each destination is a `LauncherTile` with a one-line
  description (`home.destinations.<navigation id>`, en + ar; the spec fails on a missing line) and, where the
  destination's own list endpoint reports a total, a count (`DESTINATION_COUNT_SOURCES`; a failed request shows
  nothing, never 0). An unknown or unauthorized module shows the no-access state. The breadcrumb is Home › Module.
- **Metric titles**: `InsightCard` labels use the shared `text-metric-label` token (14 px, one step above caption);
  they wrap, never clip.
- **Conversion rate card** is a drill-down to the leads list like its sibling figures (same `leadsHref`
  authorization), so it gets the same hover, focus ring and chevron; without leads access it is a static summary
  like the others.
- **Lead-distribution dialog**: a server-confirmed success closes the dialog with one toast; a blocked run
  (saved but failing) and a failed request keep it open with the reason and the selection. The page owns the open
  state and only an explicit click sets it true. Duplicate submissions are guarded in the hook.

### 12.22 Customer entry, phone and numeric inputs (Round 11, 2026-10-05)

- **Customer entry**: a form that takes a customer offers **New customer / Existing customer**. Existing shows a
  picker, then a concise identity summary (`CustomerIdentitySummary`); name, phone and address are never asked again —
  only what is missing or an intentional, order-specific change. New asks name and phone side by side.
- **Phone**: the calling code is a compact selector **inside** the phone field (`CallingCodePicker` via
  `OMSPhoneInput countries`); there is no separate full-width "phone country" dropdown. It only changes how the
  national number is read.
- **Delivery** (`DeliveryFields`): City + Address once, side by side; the delivery country follows the phone country
  until **Different delivery country** is opened. An order's destination is stored on the order, never on the
  customer master. Pickup / all-service orders hide it.
- **Widths**: related short fields share a row (container-query grid, content-aware spans); no selector fills a dialog
  without a reason; fields reflow on phones and the footer actions stay reachable.
- **Numeric money inputs** start genuinely empty with a `0.00` placeholder (illustration only, never saved). A saved
  value, including an explicit 0, is shown as saved; blank and zero stay distinct (a required amount must be > 0).
  Quantity = 1 and calculated totals are unchanged. Use `MoneyInput` — never a bare number input for money.
- **Caret**: the native text caret takes `--caret-color` (the focus-ring blue) on every input / textarea; never a
  simulated cursor.

### 12.23 Contextual selectors, country defaults, one lookup, agent cards (Round 12, 2026-10-05)

- **Two selector appearances, chosen by the container** (`ControlSurface` → `data-surface`, `theme/recipes.css`):
  `toolbar` is the stronger blue progression of §12.14 / §12.15 (list toolbars, selector rows, filters, report headers —
  the default); `form` is a very light blue surface (`color-mix` of `--ramp-blue` into white / card), ordinary
  foreground text, a subtle blue hairline and a muted chip — for create / edit forms, dialogs, sheets, editor pages,
  settings forms and inline cell editors. Only the `--selector*` tokens change, so hover / open / invalid / disabled /
  keyboard focus are the same recipe in both, light and dark. `DialogContent`, `SheetContent`, `Form`,
  `EditorWorkspace` and `PageWorkspace controlSurface="form"` provide `form`; `ListToolbar` and `SelectorRow`
  restore `toolbar` inside a dialog. A control may pass `surface` explicitly; a status (`ghost`) trigger and the
  labelled action `menu` never take a surface. Never colour a trigger locally; never key CSS on a route.
- **Country → calling code + currency** (`config/orders/country-entry-defaults.ts`): the customer's country proposes
  the phone's calling code (library metadata) and the order currency (`Country.defaultCurrencyId`, maintained in
  Master data → Countries). Both stay editable; a manual choice is never overwritten; a typed number is never re-read
  under another code; a country without a configured currency leaves the field empty with a hint (asked, never
  guessed). Saved records keep their saved values. Phone country and delivery country are separate (delivery follows the
  customer's country until "Different delivery country").
- **One advanced lookup** ("بحث متقدم عن عميل"): phone in any format / Arabic digits, first + last name, or an OMS order
  number, in one dialog with a compact paginated table (cards on phones). Previous orders are listed only for records
  the caller can already open; everything else is masked and read-only. No second "search by phone / order number" button.
- **Agent screens use the dashboard card language**: `InsightCard` / `InsightGroup` for headline figures and
  `SummaryCard` (on the shared `InsightSurface`) for titled figure lists — tone follows meaning, static cards stay flat,
  only drill-downs get hover / focus. Visibility of figures is unchanged (agent-visible vs company-only).
