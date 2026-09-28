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
- **Items.** `rounded-sm` and 32px tall; nested items are 28px.
- **Active item:**
  - a 4px `--sidebar-rail` rail on the outer edge (logical start: right in RTL, left in LTR), with a
    soft `--sidebar-rail-glow` shadow
  - a `--sidebar-active` tint
  - a semibold label and a rail-colored icon
  - the same treatment on nested items and in the mobile drawer
- **Hover and focus.** Hover is a neutral tint; focus is the inset outline. No state shifts the
  layout.

## 12. Round 3 — Vercel-reference ("geist") design, LOCAL PILOT (2026-09-28)

Status: **pilot, pending owner approval.** Active only under `<html data-ui="geist">` (pilot routes in
a build with `NEXT_PUBLIC_UI_PILOT=geist`; see spec "Round 3"). Reference values:
`geist-research.md`. Implementation: `theme/pilot-geist.css` (tokens + recipes),
`providers/ui-pilot-provider.tsx` (`useUiPilot().active`), `config/ui-pilot.ts` (routes).

### 12.1 Isolation contract

- Tokens and visual recipes live only in `theme/pilot-geist.css`, scoped to `[data-ui="geist"]`.
- A structural change to a **shared** component (used outside the pilot routes) must be gated on
  `useUiPilot().active`, so the classic output is unchanged when the pilot is off.
- A pilot **screen** renders its pilot layout from a separate presentational component
  (`*-pilot.tsx`) that reuses the page's data, handlers and permissions. The classic layout stays
  as is. Rollout later deletes the classic branch.
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
