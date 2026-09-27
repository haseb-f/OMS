# Inventory — Design System & Shared Components

Milestone: enterprise-ui-overhaul · Agent: INV-COMPONENTS · Date: 2026-09-27 · Scope: `apps/web/src` (read-only audit)

All paths are relative to `apps/web/src/`. "Used by" = number of distinct source files that import the module
(resolved through `@/` aliases, relative imports and barrel re-exports; the component's own file and barrel
`index.ts` files excluded). "JSX sites" = files that render the component tag.

---

## 1. Token audit

### 1.1 Where tokens live

| File                      | Contents                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `app/globals.css:8-108`   | `@theme inline` — maps every color var to a Tailwind `--color-*`, radius scale, shadow scale                   |
| `app/globals.css:117-205` | `:root` light palette, sidebar, brand, scrollbar colors                                                        |
| `app/globals.css:207-263` | `.dark` palette                                                                                                |
| `app/globals.css:265-407` | base layer: border/outline defaults, scrollbar system, auth focus ring, reduced motion, number-spinner removal |
| `app/globals.css:418-437` | Sonner toast tone overrides                                                                                    |
| `theme/tokens.css:19-54`  | `@theme` typography scale                                                                                      |
| `theme/tokens.css:56-107` | z-index, motion, control heights, control widths, scrollbar size                                               |
| `theme/tokens.ts:1-15`    | TS mirror of motion only (`duration.base`, `easing.standard`)                                                  |

### 1.2 Color tokens (light / dark)

| Token                                                       | Light (`globals.css`)                                                                  | Dark (`globals.css`)                                           |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `--background`                                              | `oklch(1 0 0)` :120                                                                    | `oklch(0.16 0.004 90)` :208                                    |
| `--foreground`                                              | `oklch(0.2 0.006 90)` :121                                                             | `oklch(0.985 0 0)` :209                                        |
| `--card` / `--popover`                                      | `oklch(1 0 0)` :122/124                                                                | `oklch(0.205 0 0)` :210/212                                    |
| `--primary`                                                 | `#04203c` (brand navy) :126                                                            | `#3c78d0` (brand blue) :214                                    |
| `--primary-foreground`                                      | `#fff` :127                                                                            | `#fff` :215                                                    |
| `--primary-hover/active/soft`                               | color-mix 82% white / 78% black / 8% white :128-130                                    | 88% white / 80% black / 18% transparent :216-218               |
| `--secondary` = `--accent`                                  | `oklch(0.955 0.014 255)` :131/135                                                      | `oklch(0.28 0.025 255)` :219/223                               |
| `--secondary-fg` = `--accent-fg`                            | `oklch(0.32 0.045 255)` :132/136                                                       | `oklch(0.9 0.02 255)` :220/224                                 |
| `--muted`                                                   | `oklch(0.965 0.004 90)` :133                                                           | `oklch(0.269 0 0)` :221                                        |
| `--muted-foreground`                                        | `oklch(0.53 0.008 90)` :134                                                            | `oklch(0.708 0 0)` :222                                        |
| `--success` / `-foreground` / `-soft`                       | `oklch(0.55 0.13 165.6)` / `oklch(0.985 0 0)` / 14% :137-139                           | `oklch(0.696 0.17 162.48)` / `oklch(0.145 0 0)` / 18% :225-227 |
| `--warning` / `-foreground` / `-soft`                       | `oklch(0.77 0.15 78)` / `oklch(0.28 0.06 78)` / 18% :140-142                           | `oklch(0.78 0.14 78)` / `oklch(0.22 0.05 78)` / 20% :228-230   |
| `--info` / `-foreground` / `-soft`                          | `#3c78d0` / `#fff` / 12% :143-145                                                      | `#3cb8c0` (teal!) / `oklch(0.145 0 0)` / 18% :231-233          |
| `--destructive` / `-soft`                                   | `oklch(0.577 0.245 27.325)` / 12% :146-147                                             | `oklch(0.704 0.191 22.216)` / 18% :234-235                     |
| `--report-revenue/expense/profit/loss` (+`-soft`)           | :150-157                                                                               | :236-243                                                       |
| `--border` = `--input`                                      | `oklch(0.928 0.006 90)` :158-159                                                       | `oklch(1 0 0 / 10%)` / `15%` :244-245                          |
| `--ring`                                                    | `color-mix(primary 40%, transparent)` :160                                             | `primary 50%` :246                                             |
| `--chart-1..5`                                              | navy, blue, teal, 2 grays :161-165                                                     | :247-251                                                       |
| `--sidebar*` (9 tokens incl. OMS-only `--sidebar-expanded`) | :176-184                                                                               | :254-262                                                       |
| `--brand-navy/-foreground/blue/teal/canvas`                 | hex :190-194                                                                           | not redefined (same in dark)                                   |
| `--scrollbar-thumb/-hover/-active/-track`                   | foreground 16/28/38% :201-204                                                          | inherits (derived from `--foreground`)                         |
| `--radius`                                                  | `1rem` :166 (vestigial — every `--radius-*` step is hard-set, nothing derives from it) | —                                                              |

### 1.3 Non-color tokens

| Category        | Tokens                                                                                                                                                            | Source                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Radius          | `--radius-xs 6px`, `-sm 8px`, `-md 12px`, `-lg 12px`, `-xl 12px`, `-2xl 12px`, `-3xl 16px`                                                                        | `globals.css:57-63`                  |
| Shadow          | `--shadow-xs … --shadow-2xl` (navy-tinted, low alpha)                                                                                                             | `globals.css:72-80`                  |
| Typography      | `--text-display 32`, `page-title 24`, `section-title 20`, `ui-title 20`, `card-title 16`, `body 14`, `button 14`, `caption 13`, `micro 12` (+ line-height/weight) | `tokens.css:27-53`                   |
| Font            | `--font-sans` ← `next/font` IBM Plex Sans Arabic (`app/layout.tsx:3,12`); `--font-heading: var(--font-sans)`                                                      | `globals.css:9-10`                   |
| Z-index         | `--z-topbar 40`, `--z-action-bar 40`                                                                                                                              | `tokens.css:61-63`                   |
| Motion          | `--duration-base 170ms`, `--ease-standard cubic-bezier(0,0,.2,1)`                                                                                                 | `tokens.css:67-68`; `tokens.ts:6-12` |
| Control heights | `--control-height-sm 32px`, `-md 36px`, `-lg 44px`                                                                                                                | `tokens.css:74-76`                   |
| Control widths  | 16 `--width-control-*` / `--width-picker-*` (search 300, date 170, qty 80 … picker-customer 420)                                                                  | `tokens.css:82-98`                   |
| Scrollbar       | `--scrollbar-size 4px`                                                                                                                                            | `tokens.css:106`                     |

### 1.4 Gaps

1. **No complete semantic status triples.** Only `X` / `X-foreground` / `X-soft` exist for success/warning/info; destructive has **no `--destructive-foreground`** (toast hard-codes `oklch(0.985 0 0)`, `globals.css:425`). No `--{tone}-border`, no `--{tone}-soft-foreground` (text on soft surface). Badges improvise borders as `border-success/20`, `border-warning/30`, `border-info/20` (`components/ui/badge.tsx:14-18`).
2. **No table density tokens.** Row padding is literal `py-1.5` / `py-2.5` (`components/master-data/enterprise-data-table.tsx:736`); header height literal `h-9` (`ui/table.tsx:61`), `h-8` in `compact-detail-table.tsx:66` and `document-line-table.tsx:22`; cell inset literal `px-3` / `px-2`. Nothing like `--table-row-h-compact`, `--table-cell-px`.
3. **No elevation scale for on-page surfaces.** The "raised card" recipe `shadow-[0_1px_0_0_color-mix(in_oklab,var(--border)_80%,transparent)] ring-1 ring-border/60` is copy-pasted 4× (`shared/data-table/list-surface.tsx:22,72`, `shared/detail-workspace.tsx:163,227`). `EnterpriseCard` uses border-only (`ui/card.tsx:21`) — two different resting surfaces.
4. **No focus-ring token.** Six different focus treatments (see §5.3); `--ring` is a 40%-alpha color, then further diluted at call sites (`ring-ring/18` in button = ~7% navy).
5. **No z-index scale beyond the topbar** — `z-10` ×11, `z-20` ×3, `z-50` ×14, `z-[1]`, pinned-column inline `zIndex: 6` (`enterprise-data-table.tsx:843`).
6. **Duration token under-used** — `duration-[170ms]` literals in 10 files (button, input, select, textarea, card, toggle, switch, sidebar, EDT) and `duration-150` in EDT/column header instead of `duration-(--duration-base)`.
7. **No spacing/layout tokens** for shell (topbar height `h-12/h-14`, content max-width `1400px`, gutters) — all literals in `layout/app-shell.tsx:29` and `layout/top-bar.tsx:58`.
8. **Control-height scale is defined but not honored** — see §5.1 (default Button 36px vs. every form control 32px).

### 1.5 Inconsistencies

- Radius scale collapses: md = lg = xl = 2xl = 12px (`globals.css:59-62`). `rounded-md` (116 uses) therefore means 12px on sidebar items, KPI icons, table cards and sidebar floating panel alike; the doc comment (`:51-55`) says md is "cards" but it is also used on tiny icon tiles (`shared/kpi-card.tsx`, `business/entity-header.tsx`). Off-scale radii: `rounded-[4px]`, `rounded-[2px]`, `rounded-3xl` ×1.
- `--info` is blue in light but **teal** in dark (`:143` vs `:231`) — different hue meaning per theme.
- `--primary` changes hue between themes (navy → mid-blue); `--chart-1` mirrors it.
- `tokens.css:21` comment says typography is "Alexandria"; actual font is IBM Plex Sans Arabic (`app/layout.tsx:3`).
- `--font-sans: var(--font-sans)` self-reference inside `@theme inline` (`globals.css:10`) — works only because next/font sets the var on `<html>`.
- Off-scale font utilities still used: `text-sm` ×83, `text-xs` ×58, `text-lg` ×13, `text-xl` ×8, plus `text-[13px]`/`text-[10px]` in the sidebar (`layout/app-sidebar.tsx:149,237`) and `text-[0.8rem]` in `ui/input.tsx:20`.
- `--brand-*` duplicates `--primary`/`--info`/`--chart-*` values as a parallel palette; only auth uses `--brand-navy` directly (`globals.css:377-380`).
- Company branding fallbacks hard-code hex `#0F8A5F`/`#2563EB` in three pages (`app/(shell)/sales/customers/[id]/page.tsx:157-158`, `purchasing/suppliers/[id]/page.tsx:144-145`, `documents/preview/page.tsx:54-55`).
- Print components use raw Tailwind palette (`text-gray-*` etc.) — 17 in `print/templates/document-print-template.tsx`, 4 each in `print-table.tsx`, `print-footer.tsx`, `print-company-header.tsx` (acceptable for print, but not tokenized).

### 1.6 Gradient / glass / decorative effects defined globally or in primitives

| Effect                                                             | Where                                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Vertical gradient fill on buttons                                  | `ui/button.tsx:16` (`outline`: `bg-linear-to-b from-card to-card/95`), `:18` (`secondary`)                    |
| Gradient on toggles                                                | `ui/toggle.tsx:17`                                                                                            |
| Backdrop blur on overlays                                          | `ui/dialog.tsx:34`, `ui/sheet.tsx:34`, `ui/alert-dialog.tsx:31` (`supports-backdrop-filter:backdrop-blur-xs`) |
| Blur on loading overlay / sticky header                            | `shared/loading-overlay.tsx:14` (`backdrop-blur-[1px]`), `settings/permission-matrix.tsx:156`                 |
| Press-scale animation                                              | `ui/button.tsx:9` (`active:scale-[0.99]`)                                                                     |
| Zoom-in/slide animations on every popover/select/dialog            | `ui/select.tsx:76`, `ui/dialog.tsx:59`, `shared/enterprise-modal.tsx` content class                           |
| Floating sidebar (inset panel, `rounded-2xl` + `shadow-lg` + ring) | `ui/sidebar.tsx:234-244`, selected by `layout/app-sidebar.tsx:142` (`variant="floating"`)                     |
| Stagger fade-in                                                    | `shared/fade-in.tsx` (1 user)                                                                                 |
| Brightness filter hovers                                           | `ui/button.tsx:18-24` (`hover:brightness-90/1.03`)                                                            |

No page-level background gradient (explicitly removed, `globals.css:118-119`).

### 1.7 WCAG contrast (computed from the oklch/hex values; soft/alpha surfaces composited in sRGB over the stated base)

| Pair                                                                                 | Ratio                     | AA text (4.5) / UI (3.0)     |
| ------------------------------------------------------------------------------------ | ------------------------- | ---------------------------- |
| L `--foreground` / `--background`                                                    | 18.10                     | pass                         |
| L `--muted-foreground` / `--background`                                              | 5.28                      | pass                         |
| L `--muted-foreground` / `--muted`                                                   | 4.77                      | pass (thin)                  |
| L placeholder (`muted-foreground/80`) / card                                         | 3.49                      | **fail** 4.5                 |
| L `--primary-foreground` / `--primary`                                               | 16.44                     | pass                         |
| L `--secondary-foreground` / `--secondary`                                           | 11.13                     | pass                         |
| L `--success-foreground` / `--success` (success button, green toast)                 | 4.27                      | **fail**                     |
| L `--success` text on `--success-soft` (success badge)                               | 3.71                      | **fail**                     |
| L `--success` text on white                                                          | 4.45                      | **fail** (just)              |
| L `--warning-foreground` / `--warning`                                               | 6.96                      | pass                         |
| L `--warning-foreground` on `--warning-soft` (warning badge)                         | 12.90                     | pass                         |
| L `--warning` as text on white                                                       | 2.11                      | **fail** (don't use as text) |
| L `--info-foreground` / `--info` (info button)                                       | 4.38                      | **fail**                     |
| L `--info` text on `--info-soft` (info badge, info toast)                            | 3.78                      | **fail**                     |
| L `--destructive` text on white                                                      | 4.76                      | pass                         |
| L white / `--destructive` (error toast)                                              | 4.56                      | pass (thin)                  |
| L `--destructive` on `--destructive-soft` (destructive badge / button)               | 3.84                      | **fail**                     |
| L `--primary` on `--primary-soft` (active nav, selected row)                         | 14.03                     | pass                         |
| L `--border`/`--input` vs white (input boundary)                                     | 1.24                      | **fail** 3:1 (1.4.11)        |
| L `--ring` (40% navy) vs white                                                       | 2.48                      | **fail** 3:1                 |
| L report revenue / expense / profit / loss on white                                  | 6.53 / 5.91 / 6.35 / 6.62 | pass                         |
| L sidebar fg / sidebar                                                               | 17.34                     | pass                         |
| D `--foreground` / `--background`, / `--card`                                        | 18.59 / 17.16             | pass                         |
| D `--muted-foreground` / card, / muted                                               | 6.91 / 5.83               | pass                         |
| D `--primary-foreground` / `--primary` (every primary button in dark)                | 4.38                      | **fail**                     |
| D `--primary` as text on card (links, active tab text)                               | 4.09                      | **fail**                     |
| D `--primary` on `--primary-soft` over card (active nav/selected)                    | 3.37                      | **fail**                     |
| D success / warning / info foreground on fill                                        | 8.03 / 8.54 / 8.30        | pass                         |
| D success / info / destructive text on their soft over card                          | 5.44 / 5.51 / 4.80        | pass                         |
| D `--destructive` text on card                                                       | 6.19                      | pass                         |
| D white on `--destructive` (error toast forces `oklch(.985 0 0)`, `globals.css:425`) | 2.77                      | **fail**                     |
| D `--border` (10% white) vs card                                                     | 1.32                      | **fail** 3:1                 |
| D `--input` (15% white) vs card                                                      | 1.57                      | **fail** 3:1                 |
| D `--ring` (50% blue) vs card                                                        | 1.93                      | **fail** 3:1                 |

Net: every light-mode status badge except warning fails AA; dark-mode primary buttons fail; input boundaries and the focus ring fail 3:1 in both themes.

---

## 2. Component catalog

Showcase-only = sole consumer is `app/(shell)/business-components/page.tsx` or `app/(shell)/design-system/page.tsx`.

### 2.1 `components/ui` (shadcn on radix-ui, restyled)

| Component             | Purpose                                                                           | Used by        | Notes                                                                                            |
| --------------------- | --------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------ |
| alert-dialog          | Radix AlertDialog                                                                 | 3              | Only via `ConfirmationDialog`, `EnterpriseModal` discard prompt, import wizard. Blur overlay :31 |
| alert                 | Inline callout                                                                    | 8              |                                                                                                  |
| avatar                | Avatar + group                                                                    | 2              |                                                                                                  |
| badge                 | `EnterpriseBadge` (renamed shadcn Badge), 9 variants                              | 22             | h-5, `rounded-xs`, text-caption :8. 22 files bypass `StatusBadge` and use it directly            |
| breadcrumb            | Breadcrumb primitives                                                             | 1              | only `layout/breadcrumb-bar.tsx`                                                                 |
| button-group          | Grouped buttons                                                                   | 1              | pagination only                                                                                  |
| button                | `EnterpriseButton`, 9 variants × 9 sizes, `isLoading`                             | 222            | default = 36px (`--control-height-md`), gradients on outline/secondary, press-scale              |
| calendar              | react-day-picker                                                                  | 2              | date + month pickers                                                                             |
| card                  | `EnterpriseCard*` (renamed shadcn Card)                                           | 40             | border-only, `rounded-md` (12px), `--card-spacing` 16/12px                                       |
| checkbox              | Radix checkbox                                                                    | 26             |                                                                                                  |
| collapsible           | Radix collapsible                                                                 | 5              | sidebar sections                                                                                 |
| command               | cmdk + `CommandPopoverContent`, `CommandResultRow`, `CommandDialog`               | 6              | base of EntityCombobox & filters                                                                 |
| dialog                | Radix Dialog                                                                      | 16             | `p-5`, `rounded-lg`, blur overlay, footer bleeds `-mx-5 -mb-5` :96                               |
| dropdown-menu         | Radix menu                                                                        | 13             |                                                                                                  |
| form                  | RHF `Form*` + `FieldLabel`/`FieldMessage`                                         | 22             | label text-caption, message with icon                                                            |
| input-group           | Input with addons                                                                 | 5              | h-32, **no `bg-card` in light**, focus `ring-ring/50` (:17) — differs from Input                 |
| input                 | `Input` + `inputVariants` (xs/sm/md/lg/compact-md)                                | 71             | **default `compact-md` = 32px** (:30)                                                            |
| kbd                   | Key hint                                                                          | 1              | command palette                                                                                  |
| label                 | Radix label                                                                       | 49             |                                                                                                  |
| pagination            | shadcn pagination                                                                 | 1              | EDT pagination only                                                                              |
| popover               | Radix popover                                                                     | 12             |                                                                                                  |
| progress              | Progress bar                                                                      | 1              |                                                                                                  |
| radio-group           | Radix radio                                                                       | 1              |                                                                                                  |
| scroll-area           | Radix ScrollArea                                                                  | **0**          | dead code                                                                                        |
| select                | Radix Select, trigger `default`/`sm` + `ghost` variant                            | 40             | both sizes = 32px (:49); zoom/slide animation                                                    |
| separator             |                                                                                   | 5              |                                                                                                  |
| sheet                 | Radix Dialog as side sheet                                                        | 6              | blur overlay, `w-3/4 sm:max-w-sm`                                                                |
| sidebar               | shadcn sidebar (697 lines)                                                        | 3              | physical `left/right` positioning :232 (RTL handled by flipping `side`), floating variant        |
| skeleton              |                                                                                   | 10             |                                                                                                  |
| sonner                | Toaster                                                                           | 1              | tones overridden in globals.css:418-437                                                          |
| spinner               |                                                                                   | 5              |                                                                                                  |
| switch                |                                                                                   | 1              |                                                                                                  |
| table                 | `Table*` + `tableColumnInsetClass`, `tableCellContentClass`, `tableCellWrapClass` | 25             | head h-9 px-3 text-caption; cell px-3 py-2; container `overflow-x-auto`                          |
| tabs                  | Radix tabs, `default`/`line`                                                      | 13             | list h-8, `rounded-lg`, trigger `rounded-md`                                                     |
| textarea              |                                                                                   | 36             | min-h-16, same focus recipe as Input                                                             |
| toggle-group / toggle |                                                                                   | 1 / 0 (direct) | toggle has gradient :17                                                                          |
| tooltip               |                                                                                   | 7              |                                                                                                  |

### 2.2 `components/shared`

| Component                   | Purpose                                                                                                                                                                                        | Used by                          | Notes                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| access-denied               | 403 full-page state                                                                                                                                                                            | 1                                | via PermissionGate                                                                                    |
| back-button                 | History-aware Back (IconActionButton, primary-soft tint)                                                                                                                                       | 3                                | only in breadcrumb bar + 2 pages                                                                      |
| carrier-charge-match-dialog | Domain dialog (carrier rematch)                                                                                                                                                                | 1                                | domain component living in `shared/`                                                                  |
| coming-soon-page            | Placeholder page (PageWorkspace + dashed EmptyState)                                                                                                                                           | 15                               |                                                                                                       |
| coming-soon                 | Placeholder block (dashed EmptyState)                                                                                                                                                          | 1                                | duplicate of above's body                                                                             |
| confirmation-dialog         | `ConfirmationDialog`, `DeleteConfirmationDialog` (AlertDialog)                                                                                                                                 | 76                               | canonical confirm                                                                                     |
| create-operation            | `CreateOperationLayout/Summary/Totals/Footer`                                                                                                                                                  | 15                               | yet another label/value summary recipe (`bg-muted/30` box)                                            |
| date-picker                 | `EnterpriseDatePicker` (InputGroup + typed value + calendar popover)                                                                                                                           | 21                               | h-32, width `--width-control-date`                                                                    |
| date-range-picker           | `EnterpriseDateRangePicker` (Button trigger + presets Select + calendar)                                                                                                                       | 22                               | trigger is Button (not InputGroup); inner fields `h-7 bg-input/30` (:40)                              |
| detail-workspace            | `DetailWorkspace`, `EditorWorkspace`, `EditorHeader`, `DetailSection`, `DetailSummaryBar`, `DetailField(Grid)`, `RecordHighlightsHeader`, `DetailSplitLayout`, `DetailGroup`, `DetailFieldRow` | 41                               | 3 different headers in one file; sticky offsets disagree (`lg:top-0` :226 vs `lg:top-[4.75rem]` :268) |
| empty-state                 | Icon + title + description + action                                                                                                                                                            | 41                               | canonical                                                                                             |
| enterprise-modal            | Create/Edit modal (md/lg/xl), dirty-guard, sticky header/footer                                                                                                                                | 64                               | re-implements DialogContent classes instead of composing `ui/dialog`                                  |
| entity-combobox             | Popover+cmdk single-select, async search, create action, clear                                                                                                                                 | 27                               | engine behind 12 pickers + SearchableSelect + ComboboxFormField + PhoneCountrySelector                |
| error-state                 | Error + retry                                                                                                                                                                                  | 2                                | EDT only                                                                                              |
| export-dialog               | Column picker for export                                                                                                                                                                       | 2                                | EDT                                                                                                   |
| fade-in                     | Motion stagger                                                                                                                                                                                 | 1                                | decorative                                                                                            |
| icon-action-button          | Icon button + tooltip (`icon-sm` 32px)                                                                                                                                                         | 10                               |                                                                                                       |
| import-dialog               | CSV preview import                                                                                                                                                                             | 1                                | EDT                                                                                                   |
| kpi-card                    | Metric tile with tone icon, value, trend                                                                                                                                                       | 9                                | canonical metric tile                                                                                 |
| list-sheet-sync-button      | Push list to Google Sheet                                                                                                                                                                      | 1                                |                                                                                                       |
| loading-overlay             | Blurred overlay + spinner                                                                                                                                                                      | 6                                |                                                                                                       |
| locale-text                 | Direction-detected prose                                                                                                                                                                       | 3                                |                                                                                                       |
| modal-section               | Titled field group inside modal                                                                                                                                                                | 21                               |                                                                                                       |
| module-import-buttons       | Import menu (template/upload/sheets)                                                                                                                                                           | 20                               |                                                                                                       |
| money-input                 | Numeric input, end-aligned, tabular                                                                                                                                                            | 7                                |                                                                                                       |
| money-value                 | LTR tabular money display                                                                                                                                                                      | 29                               | canonical money display                                                                               |
| month-picker                | `EnterpriseMonthPicker`                                                                                                                                                                        | 5                                | Button trigger h-32                                                                                   |
| page-header                 | Title/subtitle/actions                                                                                                                                                                         | 3 (JSX 3; +59 via PageWorkspace) | `text-ui-title` 20px                                                                                  |
| page-loading                | Full-content loading                                                                                                                                                                           | 3                                |                                                                                                       |
| page-workspace              | Header → main → secondary list-page frame                                                                                                                                                      | 59                               | canonical list page frame                                                                             |
| permission-gate             | Page/section permission gate                                                                                                                                                                   | 56                               |                                                                                                       |
| phone-country-selector      | Country combobox (EntityCombobox)                                                                                                                                                              | 3                                |                                                                                                       |
| phone-input                 | `OMSPhoneInput` (InputGroup)                                                                                                                                                                   | 7                                | **h-36** (`--control-height-md`, :126) — only 36px form control                                       |
| record-preview              | Quick preview + trace helpers (545 lines)                                                                                                                                                      | 11                               | contains its own raw `<table>`                                                                        |
| related-documents           | Related-docs panel                                                                                                                                                                             | 2                                | overlaps related-records-panel                                                                        |
| related-records-panel       | Traceability panel/button                                                                                                                                                                      | 11                               |                                                                                                       |
| search-input                | The one search box (InputGroup-like)                                                                                                                                                           | 11                               | h-32, width clamps by breakpoint (:80)                                                                |
| searchable-select           | Static-options adapter over EntityCombobox                                                                                                                                                     | 25                               |                                                                                                       |
| semantic-value              | LTR isolation for ids/money/dates                                                                                                                                                              | 46                               |                                                                                                       |
| stacked-cell                | Two-line table cell                                                                                                                                                                            | 45                               |                                                                                                       |
| sync-button                 | Sync preview/run action                                                                                                                                                                        | 5                                |                                                                                                       |
| sync-workspace-card         | Sync card + button class constant                                                                                                                                                              | 3                                | exports a className string constant (`SYNC_ACTION_BUTTON_CLASS`) = one-off button style               |
| tree-toggle-button          | Expand/collapse all                                                                                                                                                                            | 2                                |                                                                                                       |
| truncate-text               | 1–2 line clamp with title                                                                                                                                                                      | 4                                | overlaps EDT tooltip truncation                                                                       |

### 2.3 `components/shared/data-table` (barrel `index.ts`, 72 barrel imports)

| Module                      | Purpose                                                 | Used by                 | Notes                                                      |
| --------------------------- | ------------------------------------------------------- | ----------------------- | ---------------------------------------------------------- |
| bulk-selection.ts           | Bulk selection state helpers                            | **0**                   | dead                                                       |
| clear-filters-button        | Reset filters w/ count                                  | 14                      |                                                            |
| column-engine.ts            | Column intent → widths, alignment, responsive hide      | 3                       | extends TanStack `ColumnMeta` (:15-47)                     |
| compact-detail-table        | Read-only mini table for detail pages                   | 9                       | own header style `h-8 bg-muted text-foreground px-2` (:66) |
| data-table-column-header    | Sort/pin/hide/filter header                             | 1 (EDT injects for all) |                                                            |
| data-table-column-value.ts  | Plain-text value from accessor                          | 12                      |                                                            |
| data-table-pagination       | Result count, page size, page X/Y, first/prev/next/last | 1                       |                                                            |
| data-table-selection-column | Selection column + scope menu                           | 1                       |                                                            |
| data-table-view-options     | Column visibility + reorder menu                        | 1                       |                                                            |
| document-detail-regions     | Expanded-row regions for documents                      | 9                       |                                                            |
| document-row-access.ts      | Row-menu capability flags                               | 8                       |                                                            |
| filter-popover              | `FilterTrigger` + `FilterPopoverFooter`                 | 3                       |                                                            |
| list-surface                | `ListSurface/ListToolbar/ListFooter/FilterSurface`      | 5                       |                                                            |
| multi-entity-filter         | Async multi-select filter                               | 12                      |                                                            |
| multi-select-filter         | Static multi-select filter                              | 17                      |                                                            |
| row-actions-menu            | Kebab menu (rows + table options)                       | 40                      |                                                            |
| row-identity-link           | Identity cell `<a>`                                     | 4                       |                                                            |
| select-custom-count-dialog  | "Select N rows" dialog                                  | 2                       |                                                            |
| select-filter               | Single-value filter                                     | 15                      |                                                            |
| semantic-cell               | RTL/LTR plain-cell semantics                            | 2                       |                                                            |
| table-detail-regions.ts     | Expanded row → column-aligned regions                   | 3                       |                                                            |
| table-detail-section        | Detail region primitives                                | 3                       |                                                            |

### 2.4 `components/shared/form-fields` (barrel, 9 barrel imports)

| Module                     | Used by | Notes          |
| -------------------------- | ------- | -------------- |
| text-field `TextFormField` | 5       |                |
| password-field             | 4       |                |
| textarea-field             | 1       |                |
| select-field               | 1       | Radix Select   |
| number-field               | **0**   | dead           |
| date-field                 | 1       |                |
| phone-field                | 1       |                |
| combobox-field             | 1       | EntityCombobox |
| file-url-field             | 1       |                |
| file-drop-field            | 3       |                |
| submit-button              | 7       |                |
| use-zod-form.ts            | 6       |                |

Most forms (MasterDataForm 45 users, EnterpriseModal bodies) compose `FormField` + `Input` directly; the `*FormField` wrappers are barely adopted.

### 2.5 `components/shared/sync-review` (barrel, 1 barrel import)

All used only inside the Import Center sync flow: `sync-review-dialog` (628 lines, has its own raw `<table>` at :419), `sync-review-table` (card-list, not a table), `sync-row-details`, `sync-summary` (uses KpiCard), `sync-result-summary`, `sync-error-digest`, `sync-bulk-actions`, `sync-source-context`, `sync-status-badge` (StatusBadge mapper), `messages.ts`, `types.ts` (11 importers incl. app pages).

### 2.6 `components/layout`

| Component                                                        | Used by                      | Notes                                                    |
| ---------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------- |
| app-shell                                                        | 1 (`app/(shell)/layout.tsx`) | see §6                                                   |
| app-sidebar                                                      | 1                            | floating, icon-collapsible, accordion (one open section) |
| top-bar                                                          | 1                            | h-12 / sm:h-14                                           |
| breadcrumb-bar                                                   | 1                            | own row under top bar                                    |
| navigation-trail                                                 | 1                            | "back to …" origin strip                                 |
| command-palette                                                  | 1                            | ⌘K launcher, h-11 trigger                                |
| company-switcher                                                 | 1                            | h-16 card in sidebar                                     |
| locale-switch / theme-switch / notifications-menu / profile-menu | 2 / 1 / 1 / 1                | notifications is placeholder                             |
| route-access-guard                                               | 1                            | config-driven 403                                        |

### 2.7 `components/business` (barrel `index.ts` imported only by the showcase page)

| Component                                                                                                   | Used by           | Notes                          |
| ----------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------ |
| status-badge `StatusBadge`                                                                                  | 122               | canonical status pill          |
| dynamic-status-badge                                                                                        | 7                 | colorKey → tone adapter        |
| classification-badge (+ColorPicker)                                                                         | 4                 | dot + DynamicStatusBadge       |
| invoice-payment-summary (+`InvoicePaymentBadge`)                                                            | 4                 |                                |
| timeline (Timeline/ActivityFeed/AuditTimeline/ApprovalTimeline)                                             | 13                |                                |
| entity-tabs                                                                                                 | 11                |                                |
| currency-display                                                                                            | 2                 | overlaps MoneyValue            |
| money-badge                                                                                                 | 1 (showcase)      |                                |
| entity-header                                                                                               | 1 (showcase)      |                                |
| info-section                                                                                                | 1 (showcase)      |                                |
| party-card / address-card / quick-actions / quick-stats-card / summary-card                                 | 1 each (showcase) | effectively dead in product UI |
| account-picker                                                                                              | 10                | EntityCombobox                 |
| partner-picker                                                                                              | 9                 | EntityCombobox                 |
| product-picker (+InlineProductCreate)                                                                       | 10                | EntityCombobox                 |
| currency-picker                                                                                             | 12                | SearchableSelect               |
| warehouse-picker                                                                                            | 8                 | EntityCombobox                 |
| employee-picker                                                                                             | 7                 | EntityCombobox                 |
| department / user picker                                                                                    | 3 / 3             | EntityCombobox                 |
| cost-center / cost-category / project / purchase-invoice picker                                             | 1 each            | EntityCombobox                 |
| product-browser-dialog                                                                                      | 1                 |                                |
| product-create-dialog (657 lines)                                                                           | 2                 |                                |
| partner-quick-create / category-quick-create / lead-order-create / assign-lead / attachment-preview dialogs | 1 / 2 / 1 / 2 / 2 | domain dialogs                 |
| payment-receipts-field                                                                                      | 4                 |                                |
| workflow-actions-panel                                                                                      | 1                 |                                |

### 2.8 `components/documents`

| Component                                        | Used by | Notes                                                                  |
| ------------------------------------------------ | ------- | ---------------------------------------------------------------------- |
| commercial-document-editor                       | 2       | the one document editor shell                                          |
| document-action-bar                              | 4       | status actions + phone bottom bar (`--z-action-bar`)                   |
| document-line-table (+head/cell class constants) | 3       | own header `sticky h-8 bg-muted/40 px-2` (:22), cell `px-2 py-1` (:23) |
| document-line-review-table                       | 5       | read-only line table for conversion dialogs                            |

### 2.9 `components/accounting` (+ `financial-report/`)

| Component                                             | Used by      | Notes                                                                                                          |
| ----------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------- |
| journal-entry-lines-grid                              | 2            | editable grid on `ui/table`                                                                                    |
| journal-trace-cell / journal-trace-links              | 3 / 1        |                                                                                                                |
| report-filter-bar `AccountingReportFilterBar`         | 4            | built on FilterSurface + SelectFilter                                                                          |
| financial-report `FinancialReport`                    | 9            | summary + table + export                                                                                       |
| financial-report-table                                | 1 (internal) | own `CELL_X` padding constant and own `HIDE_BELOW_CELL` (viewport `md:`/`lg:`, not container queries like EDT) |
| financial-report-summary                              | 1 (internal) | report tone tiles (4th metric-tile variant)                                                                    |
| report-money `ReportMoney`                            | 2            | money with negative/zero/emphasis rules                                                                        |
| financial-report-export.ts / line-label.ts / types.ts | 2 / 2 / 8    |                                                                                                                |

### 2.10 `components/print`

| Component                                                             | Used by            | Notes                        |
| --------------------------------------------------------------------- | ------------------ | ---------------------------- |
| print-page / print-company-header / print-footer / print-table        | 2 each (templates) | raw palette colors           |
| templates/document-print-template (Invoice/Statement/Receipt/Voucher) | 1                  |                              |
| templates/generic-list-print-template (List/Report)                   | 1                  |                              |
| use-trigger-print.ts                                                  | 2                  | only `window.print()` caller |

### 2.11 `components/master-data` (the actual table/form engine)

| Component                                                | Used by     | Notes                         |
| -------------------------------------------------------- | ----------- | ----------------------------- |
| enterprise-data-table `EnterpriseDataTable` (1554 lines) | 48          | the shared list grid — see §4 |
| master-data-page `MasterDataPage`                        | 45 (38 JSX) | config-driven list+modal page |
| master-data-form `MasterDataForm`                        | 45          | config-driven form            |

Note: the table engine lives in `master-data/` while its parts live in `shared/data-table/` — split ownership.

---

## 3. Duplication map

| #   | Group (same job)                                | Members (JSX-site files)                                                                                                                                                                                                                                                                                                                                                                                                                  | Canonical                                                                                                                                                                                                   | Migration cost                                                                                                                                             |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Metric / summary tiles                          | `KpiCard` (9), `DetailSummaryBar` (2), `RecordHighlightsHeader` metrics (2), `FinancialReportSummary` (internal), `QuickStatsCard` (1, showcase), `SummaryCard` (1, showcase), `MoneyBadge` (1, showcase), `CreateOperationSummary/Totals` (7 via CreateOperationLayout)                                                                                                                                                                  | `KpiCard` for tiles (add `size`/`inline` variant to absorb DetailSummaryBar + QuickStatsCard); `DetailFieldRow` for label/value summaries                                                                   | Delete 3 showcase-only (≈0 prod sites). DetailSummaryBar 2, RecordHighlights 2, FinancialReportSummary 1, CreateOperationSummary/Totals ~7 → **~12 files** |
| D2  | Money display                                   | `MoneyValue` (29), `CurrencyDisplay` (2), `ReportMoney` (2), `MoneyBadge` (1), `SemanticValue kind="money"` (46 total SemanticValue)                                                                                                                                                                                                                                                                                                      | `MoneyValue` with `tone`/`emphasize`/`zeroAsDash` props (absorbs ReportMoney rules)                                                                                                                         | CurrencyDisplay 2 + ReportMoney 2 + MoneyBadge 1 → **5 files**                                                                                             |
| D3  | Single-select pickers                           | `EntityCombobox` (22), `SearchableSelect` (25), 12 domain pickers (all EntityCombobox), `ComboboxFormField` (1), `SelectFormField` (1), raw Radix `<Select>` (42), `PhoneCountrySelector` (3)                                                                                                                                                                                                                                             | Keep **EntityCombobox** as the only popover-list engine; keep Radix `Select` only for ≤7 static options (`SEARCHABLE_OPTION_THRESHOLD`, `searchable-select.tsx`). Domain pickers stay as thin data adapters | Low: pickers already converge. Audit 42 raw `<Select>` files for >7-option cases; unify trigger chrome with D4                                             |
| D4  | Filter pickers (second combobox implementation) | `SelectFilter` (15), `MultiSelectFilter` (17), `MultiEntityFilter` (12) — Popover + Command + `FilterTrigger`, separate from EntityCombobox                                                                                                                                                                                                                                                                                               | One `FilterCombobox` built on the EntityCombobox list engine (multi mode) + `FilterTrigger`                                                                                                                 | 3 components, **~30 call-site files** unaffected if props kept                                                                                             |
| D5  | Page / record headers                           | `PageHeader` (3 direct, 59 via `PageWorkspace`), `DetailWorkspace` header (11), `EditorHeader` (6), `RecordHighlightsHeader` (2), `EntityHeader` (1, showcase), `EnterpriseModal` header, raw `<h1>` in auth + investor portal (13 files)                                                                                                                                                                                                 | `PageHeader` with `variant: list                                                                                                                                                                            | record                                                                                                                                                     | editor`, slots for `status`, `meta`, `back` | DetailWorkspace 11 + EditorHeader 6 + RecordHighlights 2 + EntityHeader 1 → **20 files** (+13 portal/auth pages if in scope) |
| D6  | Status badges                                   | `StatusBadge` (103), `DynamicStatusBadge` (7), `ClassificationBadge` (4), `SyncStatusBadge` (1), `InvoicePaymentBadge` (≤4), direct `EnterpriseBadge` (22)                                                                                                                                                                                                                                                                                | `StatusBadge` with `colorKey` (absorb Dynamic) and `dot` (absorb Classification); mappers stay as tone functions not components                                                                             | Dynamic 7 + Classification 4 → **11 files**; audit 22 direct `EnterpriseBadge` files                                                                       |
| D7  | Modal surfaces                                  | `EnterpriseModal` (64), raw `Dialog/DialogContent` (15 non-ui files: import-job-wizard, sync-sources-manager, workflow-transitions, product-opening-balance, product-success, bulk-lead-status, cost-allocation-runs, generated-password, carrier-charge-match, select-custom-count, export, import, shipment-manage, bulk-shipping-status, design-system), `Sheet` (5), `ConfirmationDialog` (76)                                        | `EnterpriseModal` (forms), `ConfirmationDialog` (confirm), `Sheet` (context panels). EnterpriseModal must **compose** `ui/dialog` instead of duplicating its content classes                                | **~14 files** raw Dialog → EnterpriseModal                                                                                                                 |
| D8  | Empty / placeholder / state panels              | `EmptyState` (41), `ComingSoonPage` (15), `ComingSoon` (1), `ErrorState` (2), `AccessDenied` (1), `PageLoading` (3), `LoadingOverlay` (6)                                                                                                                                                                                                                                                                                                 | `EmptyState` (+`tone`) and `ComingSoonPage`; delete `ComingSoon`                                                                                                                                            | ComingSoon 1 file; ErrorState/AccessDenied can become EmptyState tones (3 files)                                                                           |
| D9  | Tables                                          | `EnterpriseDataTable` (48), `CompactDetailTable` (9), `DocumentLineTable` (3), `DocumentLineReviewTable` (5), `FinancialReportTable` (via FinancialReport 9), `JournalEntryLinesGrid` (2), `ProductLineItemsGrid`, `AllocationGrid`, `OpenInvoicesTable`, raw `ui/table` (25 files), raw `<table>` (12 files incl. investors pages, exchange-rates, workflow-transitions, reports tabs, record-preview, sync-review-dialog), `PrintTable` | EDT for all lists; a tokenized `DataGrid` primitive layer (`ui/table` + density tokens + shared head/cell/numeric classes) for line/detail/report tables                                                    | Raw `<table>` **12 files**; direct `ui/table` **25 files** to adopt shared head/cell classes; 4 header-style variants to collapse                          |
| D10 | Label/value detail fields                       | `DetailField` (14), `DetailFieldRow` (6), `InfoSection` (1, showcase), `TableDetailField`, `CreateOperationSummary` rows, `SummaryCard` rows                                                                                                                                                                                                                                                                                              | `DetailField` (stacked) + `DetailFieldRow` (inline)                                                                                                                                                         | InfoSection/SummaryCard delete; CreateOperation rows ~7                                                                                                    |
| D11 | On-page surfaces                                | `EnterpriseCard` (border only), `ListSurface`/`FilterSurface`/`DetailSummaryBar`/`RecordHighlightsHeader` (border + ring + 1px shadow literal), `DetailGroup` (border), `CreateOperation*` (`bg-muted/30` box), `ModalSection`                                                                                                                                                                                                            | One `Surface` recipe backed by an elevation token                                                                                                                                                           | 4 literal copies + ~6 components                                                                                                                           |
| D12 | Truncation with full-value access               | EDT per-cell Tooltip (`enterprise-data-table.tsx:1394-1408`), `TruncateText` (4, uses `title`), `StatusBadge` (`title`), `StackedCell` `line-clamp`                                                                                                                                                                                                                                                                                       | One `TruncateText` that shows tooltip only when overflowing                                                                                                                                                 | 4 + EDT                                                                                                                                                    |
| D13 | Related-records panels                          | `RelatedRecordsPanel` (11), `RelatedDocuments` (2), `JournalTraceLinks` (1)                                                                                                                                                                                                                                                                                                                                                               | `RelatedRecordsPanel`                                                                                                                                                                                       | 3 files                                                                                                                                                    |
| D14 | "Enterprise*" naming                            | `EnterpriseButton/Card/Badge` are renamed shadcn primitives (no plain `Button`/`Card`/`Badge` exists) while `Input`, `Select`, `Dialog`, `Table` keep shadcn names; `EnterpriseDatePicker`, `EnterpriseModal`, `EnterpriseDataTable`, `EnterprisePagination`, `EnterpriseTableColumnHeader` in shared                                                                                                                                     | Not a functional duplicate — naming inconsistency only; no wrapper-vs-plain pairs to merge                                                                                                                  | Rename is a codemod (Button 222 files) — not recommended during overhaul                                                                                   |

---

## 4. The table system

### 4.1 How it works today

The grid is `components/master-data/enterprise-data-table.tsx` (TanStack Table v8) on top of `components/ui/table.tsx`, with helpers in `components/shared/data-table/`.

| Concern                 | Implementation (file:line)                                                                                                                                                                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surface                 | `ListSurface` card = toolbar + grid + footer (`list-surface.tsx:16-29`), `@container/enterprise-table` on it (`enterprise-data-table.tsx:940`)                                                                                                                                                                                         |
| Toolbar                 | One strip: `SearchInput` (flex, max 22–28rem) + caller `filterBar` + Refresh + "Columns" + overflow `RowActionsMenu` with Print/Import/Export/Density/Reset (`:892-930`, `:945-973`). `ListToolbar` = `bg-muted/30 px-3 py-1.5` (`list-surface.tsx:36`)                                                                                |
| Density                 | `compact` (default) / `comfortable`, persisted `oms.table.{id}.density` (`:271-274`); only lever is cell `py-1.5` vs `py-2.5` (`:736`). Header height fixed at `h-9` (`ui/table.tsx:61`) regardless of density. Toggle is hidden in overflow menu                                                                                      |
| Column layout           | Smart Column Engine (`column-engine.ts`): column meta intent (grow/min/max/fixed/align/importance/type), type inferred from column id (`:110+`), presets (`:99-109`), `<colgroup>` widths + `table-fixed border-separate` (`enterprise-data-table.tsx:1133-1150`), `min-width` = sum of min widths (`:1135`)                           |
| Responsive hide         | `importance` → container-query classes: low hidden < `@5xl`, medium hidden < `@3xl` (`column-engine.ts:340-350`)                                                                                                                                                                                                                       |
| Sticky header           | `<TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_0_var(--border)]">` (`:1156`) inside a scroll box `max-h-[70vh] overflow-auto` (`:1128-1131`) whose max-height is re-measured from viewport minus top offset minus footer minus 28px (`:377-405`; resize listener + one 300ms re-measure, no ResizeObserver) |
| Resizing                | Custom pointer-drag handle per non-utility header (`:1195-1213`), RTL-aware delta (`:336-360`), double-click resets, widths persisted `oms.table.{id}.columnWidths`, clamped 60–640px (`:88-89`). No keyboard resize                                                                                                                   |
| Visibility / order      | `EnterpriseTableViewOptions` dropdown: checkbox per column + move start/end arrows (`data-table-view-options.tsx:41-83`); header menu "Hide column" (`data-table-column-header.tsx:168-171`); persisted `columnVisibility`/`columnOrder`; `meta.defaultHidden` supported (`:626-631`)                                                  |
| Pinning                 | Header menu pin start/end (`data-table-column-header.tsx:150-166`), sticky via inline `insetInlineStart/End` using **estimated** widths (`:806-870`), `zIndex: 6`, `background: var(--card)`                                                                                                                                           |
| Sorting                 | Header is a dropdown trigger; sort requires open-menu → choose (2 clicks). Multi-sort client-only. Server mode: `manualSorting` + `onSortChange` (`:679`)                                                                                                                                                                              |
| Column filter           | Per-column popover with `SearchInput`, **client mode only** (`data-table-column-header.tsx:188-231`, `canFilter={!isServerMode}` `:607`)                                                                                                                                                                                               |
| Header injection        | EDT replaces every caller `header` with `EnterpriseTableColumnHeader` using `meta.titleKey` and resolved `align` (`:596-611`)                                                                                                                                                                                                          |
| Alignment               | `alignClass` start/center/end; **end adds `tabular-nums`** (`:102-106`); applied to `th` and `td`; header title sits on the alignment edge, icons on the opposite side via `flex-row-reverse` (`data-table-column-header.tsx:96-120`)                                                                                                  |
| Cell insets             | `tableColumnInsetClass` — data `px-3`, utility columns `ps-1/pe-1` with 12px outer gutter (`ui/table.tsx:109-114`)                                                                                                                                                                                                                     |
| Truncation              | Every non-utility, non-stacked, non-wrap cell is wrapped in `Tooltip` + `tableCellContentClass` (`inline-block w-max max-w-full truncate`) showing the plain display value; double-click copies (`:1391-1409`). Tooltip is attached whether or not the text overflows. `meta.wrap` for prose, `meta.stacked` for two-line cells        |
| Selection               | `createSelectionColumn` checkbox column, optional scope menu (page / all matching / custom N / clear) (`data-table-selection-column.tsx`); row `data-state=selected` → `bg-primary-soft`                                                                                                                                               |
| Bulk actions            | Strip appears under toolbar when `selectedCount > 0 && bulkActions` (`:983-1022`): caller actions, count, "use page selection" (after select-all-matching), Clear                                                                                                                                                                      |
| Row navigation          | `getRowHref` → whole-row click with interactive-target guard (`:1296-1327`); identity column renders `RowIdentityLink` `<a>`; `identityOnlyNavigation` opt-out                                                                                                                                                                         |
| Expandable rows         | `__expand` chevron column; `renderExpandedRegions` laid out onto master column axes (`table-detail-regions.ts`, `:1412-1470`)                                                                                                                                                                                                          |
| Loading                 | 6 skeleton rows (stacked columns get 2 bars) (`:1229-1265`); mobile: 4 skeleton cards (`:1028-1037`); Refresh icon spins                                                                                                                                                                                                               |
| Error / empty           | `ErrorState` with Retry; `EmptyState` (Inbox) with caller `emptyTitle` (`:1266-1283`)                                                                                                                                                                                                                                                  |
| Pagination              | `EnterprisePagination` in `ListFooter` (`:1476-1478`): result count or "n / N selected", rows-per-page Select (10/20/30/50 hard-coded), "page X of Y", first/prev/next/last (`data-table-pagination.tsx`). Default page size 20 (`:142`), persisted in client mode. Client and server modes (`isServerMode = page && onPageChange`)    |
| Mobile                  | Below `@3xl` container width the `<table>` is hidden and a card list is shown: identity cell as title, select + actions, first 6 other visible cells as a 2-col `dl` (`:1027-1120`); or caller `renderMobileRow`                                                                                                                       |
| Print / export / import | Print via Print Engine with visible columns (`:872-889`); CSV export dialog; CSV import dialog                                                                                                                                                                                                                                         |
| Persistence             | `oms.table.{tableId}.{columnVisibility,density,columnWidths,columnPinning,columnOrder,columnFilters,pageSize,sorting}` in localStorage; session-restorable page index, search, expanded                                                                                                                                                |

Parallel table implementations outside EDT (each with its own chrome):

| Table                                                            | Header style                                          | Cell style          |
| ---------------------------------------------------------------- | ----------------------------------------------------- | ------------------- |
| `ui/table.tsx` default                                           | `h-9 px-3 text-caption text-muted-foreground` bg none | `px-3 py-2`         |
| EDT                                                              | same + `bg-card` sticky                               | `px-3` + density py |
| `compact-detail-table.tsx:66,92`                                 | `h-8 bg-muted px-2 text-foreground`                   | `px-2 py-1.5`       |
| `document-line-table.tsx:22-23`                                  | `sticky h-8 bg-muted/40 px-2`                         | `px-2 py-1`         |
| `financial-report-table.tsx:122`                                 | own `CELL_X`, viewport `md:/lg:` hide                 |                     |
| `sync-review-dialog.tsx:419-428`                                 | raw `<table text-xs>`, `bg-muted/50`, `p-2`           |                     |
| investors / exchange-rates / workflow-transitions / reports tabs | raw `<table>` with `p-2`                              |                     |
| `print/print-table.tsx`                                          | dark header, zebra                                    | print-only          |

### 4.2 Gaps vs target

| Target                                                     | Status        | Gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Compact default + optional comfortable                     | Partial       | Compact is default, but only vertical padding changes; header fixed `h-9`; no tokens; toggle buried in overflow menu; the ~12 non-EDT tables have no density at all                                                                                                                                                                                                                                                                                                                                                |
| Exact header/body/footer alignment incl. sort/filter icons | Mostly        | th/td share `tableColumnInsetClass` + `alignClass`. But: sort icon is invisible until hover (`opacity-0`, `data-table-column-header.tsx:85`) and the filter button (`size-6`) only exists in client mode, so header content width differs by mode; pinned columns use estimated widths so sticky offsets drift (`:800-815`); **no table footer/totals row** in EDT (the `ListFooter` is pagination, not column-aligned); other tables use `px-2` vs EDT `px-3`, so detail/line tables don't align with list tables |
| Numeric right-alignment with tabular digits                | Partial       | `money`/`number` presets align `end` + `tabular-nums` (`column-engine.ts:104-105`, EDT `:105`), but type is **inferred from the column id** — columns whose id doesn't match the keyword list fall to `default` (start-aligned, proportional digits). `end` resolves to the physical _left_ in RTL; the target "right-aligned numbers" needs an explicit decision (numeric edge = logical end vs physical right). Non-EDT tables set `text-end tabular-nums` ad hoc                                                |
| Sticky header with internal scroll, no nested scroll       | **Not met**   | Table body is its own `overflow-auto` box inside the page, which itself scrolls (AppShell `main` has no fixed height, `app-shell.tsx:28-29`) → nested scroll on every list; the height is measured by JS (`:377-405`) with a 28px magic number and `max-h-[70vh]` pre-hydration fallback; the mobile card list also has its own `max-h-[70vh] overflow-auto` (`:1027`). Horizontal overflow falls back to scrolling inside the card when `columnSetMinWidth` exceeds width                                         |
| Column resize / visibility                                 | Met (desktop) | No keyboard resize, no ARIA value on separator; resize widths not bounded by column `maxWidth` presets once dragged; reorder only via arrows (no drag)                                                                                                                                                                                                                                                                                                                                                             |
| Selection + bulk actions                                   | Met           | Bulk strip only appears when caller passes `bulkActions`; no sticky/floating bulk bar when scrolled; selection count shown in two places (bulk strip + pagination footer)                                                                                                                                                                                                                                                                                                                                          |
| Pagination                                                 | Partial       | No page-number input/jump, page sizes hard-coded `[10,20,30,50]` (no 100), no "1–20 of 345" range label; footer wraps on mobile                                                                                                                                                                                                                                                                                                                                                                                    |
| Truncation with full-value access                          | Partial       | Tooltip on every cell (even non-overflowing) — hundreds of Radix Tooltip instances per page; value is `getColumnDisplayValue` text (loses formatting); not reachable by keyboard (cell not focusable); double-click-to-copy is undiscoverable                                                                                                                                                                                                                                                                      |
| Mobile                                                     | Partial       | Card view only below `@3xl` container width; shows max 6 fields; pagination footer and toolbar not adapted                                                                                                                                                                                                                                                                                                                                                                                                         |
| Loading / empty                                            | Met           | Consistent in EDT only; other tables handle their own                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

---

## 5. Inputs & selectors

### 5.1 Heights / padding / icons

| Control                                            | File:line                                    | Height                                  | Padding / text                              | Icon                                 |
| -------------------------------------------------- | -------------------------------------------- | --------------------------------------- | ------------------------------------------- | ------------------------------------ |
| `Input` (default `compact-md`)                     | `ui/input.tsx:27-30`                         | **32**                                  | `px-3 py-1.5 text-body`                     | —                                    |
| `Input` `md` / `lg` / `sm` / `xs`                  | `ui/input.tsx:21-23,20,19`                   | 36 / 44 / 32 / 24                       | sm uses `text-[0.8rem]` (off-scale)         | —                                    |
| `Textarea`                                         | `ui/textarea.tsx:10`                         | min 64                                  | `px-3 py-1.5`                               | —                                    |
| `SelectTrigger` `default` / `sm`                   | `ui/select.tsx:49`                           | **32 / 32**                             | px-3 / px-2.5, sm text-caption; min-w 28/20 | Chevron `size-3.5`                   |
| `InputGroup`                                       | `ui/input-group.tsx:17`                      | 32                                      | addon `text-sm` (off-scale)                 | `size-4`                             |
| `EntityCombobox` / `SearchableSelect` / 12 pickers | `shared/entity-combobox.tsx:208,220`         | 32                                      | Button outline `size="sm"` + `text-body`    | Chevron/X/Spinner `size-3.5`         |
| `FilterTrigger` (Select/Multi/MultiEntity filters) | `shared/data-table/filter-popover.tsx:28-32` | 32                                      | Button outline sm, `min-w-36`               | ChevronsUpDown `size-3.5 opacity-50` |
| `SearchInput`                                      | `shared/search-input.tsx:80`                 | 32                                      | width 100% → 300px → 14–28rem by breakpoint | Search `size-4 opacity-50`           |
| `EnterpriseDatePicker`                             | `shared/date-picker.tsx:164,171`             | 32                                      | InputGroup, width 170px                     | Calendar icon-xs button              |
| `EnterpriseDateRangePicker`                        | `shared/date-range-picker.tsx:148,40`        | 32 trigger; inner fields **28** (`h-7`) | Button trigger, `bg-input/30` inner         | Calendar `size-4`                    |
| `EnterpriseMonthPicker`                            | `shared/month-picker.tsx:78-83`              | 32                                      | Button trigger                              | Calendar `size-3.5`                  |
| `MoneyInput`                                       | `shared/money-input.tsx:21,33`               | 32                                      | end-aligned, tabular                        | —                                    |
| `OMSPhoneInput`                                    | `shared/phone-input.tsx:126`                 | **36**                                  | InputGroup                                  | —                                    |
| `EnterpriseButton` default                         | `ui/button.tsx:36`                           | **36**                                  | px-3                                        | `size-4`                             |
| Tabs list                                          | `ui/tabs.tsx:25`                             | 32                                      |                                             |                                      |
| Command palette trigger                            | `layout/command-palette.tsx:80`              | **44**                                  | `rounded-lg px-4`                           |                                      |

Inconsistencies: the `--control-height-md` (36px) tier exists "for form controls" (`tokens.css:70-76`) but every form control defaults to 32px while the default Button is 36px — a default Save button next to an input is 4px taller. PhoneInput is the lone 36px field. Date-range inner fields are 28px. `SelectTrigger size` changes padding/text but not height.

### 5.2 Surfaces

- `Input`/`Textarea`/`SelectTrigger`: `bg-card` light, `bg-input/30` dark, `shadow-xs`, `rounded-xs`.
- `InputGroup`: **no background in light** (transparent), no `shadow-xs` (`input-group.tsx:17`) — date picker and phone input look different from Input.
- Combobox/Filter triggers: Button `outline` → **gradient** `from-card to-card/95` + `hover:bg-primary-soft hover:text-primary` (`ui/button.tsx:16`) — pickers turn navy-tinted on hover while Select/Input only darken the border.
- Date-range inner fields: `bg-input/30` in light mode (`date-range-picker.tsx:40`).
- Placeholder color: `muted-foreground/80` everywhere (3.49:1).

### 5.3 Focus styles (6 recipes)

| Recipe                                                                   | Where                                                                                                                               |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `focus-visible:border-ring focus-visible:shadow-[0_0_0_3px_var(--ring)]` | Input `ui/input.tsx:14`, Textarea `:10`, SelectTrigger `ui/select.tsx:49`                                                           |
| `focus-visible:border-ring ring-3 ring-ring/18`                          | Button `ui/button.tsx:9`, Toggle `ui/toggle.tsx:17` (≈7% navy — nearly invisible) — applies to every combobox/picker/filter trigger |
| `has-[…:focus-visible]:border-ring ring-3 ring-ring/50`                  | InputGroup `ui/input-group.tsx:17` (date picker, phone, search)                                                                     |
| `ring-[3px] ring-ring/50`                                                | Badge `ui/badge.tsx:8`                                                                                                              |
| `ring-[3px] ring-ring/50 outline-1 outline-ring`                         | Tabs trigger `ui/tabs.tsx:59`                                                                                                       |
| global `outline-ring/50`                                                 | `app/globals.css:267`                                                                                                               |
| navy `box-shadow 0 0 0 3px brand-navy 20%`                               | auth forms only `globals.css:377-380`                                                                                               |

### 5.4 Validation styles

- Input/Textarea/Select: `aria-invalid:border-destructive ring-3 ring-destructive/20` (dark /40) — consistent.
- InputGroup: `has-[[aria-invalid=true]]:ring-3 ring-destructive/20` but no border change.
- EntityCombobox: passes `aria-invalid` to Button → Button's `aria-invalid:border-destructive` works.
- Messages: `FieldMessage` text-caption destructive with `CircleAlert` icon (`ui/form.tsx:165-180`); `EnterpriseDatePicker` renders its own `<p className="text-caption text-destructive">` without icon (`date-picker.tsx:229`); `phone-input.tsx` has its own error message helpers.
- Labels: `FieldLabel` text-caption, required `*` and "(optional)" suffix (`ui/form.tsx:81-112`).

### 5.5 Filter/selection components list

`Select` (Radix), `SearchableSelect`, `EntityCombobox`, 12 domain pickers, `ComboboxFormField`, `SelectFormField`, `PhoneCountrySelector`, `SelectFilter`, `MultiSelectFilter`, `MultiEntityFilter`, `ClearFiltersButton`, column `ColumnFilterPopover`, `AccountingReportFilterBar`, `EnterpriseDatePicker`, `EnterpriseDateRangePicker` (with presets), `EnterpriseMonthPicker`, `SearchInput`, `CommandInput`, `ClassificationColorPicker`.

---

## 6. Shell

### 6.1 Structure

```
SidebarProvider
├─ AppSidebar (ui/sidebar variant="floating", collapsible="icon", side flips with dir)
│   ├─ SidebarHeader: BrandMark + name (text-[13px]) + full-width collapse trigger row
│   ├─ Separator
│   ├─ CompanySwitcher (h-16 card)
│   ├─ SidebarContent: accordion NavTreeItem tree (one section open at a time, pin-able children)
│   └─ SidebarFooter (empty) + SidebarRail
└─ SidebarInset
    ├─ TopBar  sticky h-12 / sm:h-14 : [mobile trigger] CommandPalette(max-w-md, h-11) … Locale Theme Notifications | Profile
    ├─ BreadcrumbBar  px-6 py-1 : [BackButton 32px] Home › crumbs › dynamic crumb
    └─ main bg-muted/25 → container max-w-[1400px] px-3/6/8 pt-1 pb-5/6 gap-2.5/3
        ├─ NavigationTrail (conditional "back to origin" strip)
        └─ RouteAccessGuard → page (PageWorkspace → PageHeader …)
```

Files: `layout/app-shell.tsx:22-35`, `layout/app-sidebar.tsx:139-189`, `layout/top-bar.tsx:57-75`, `layout/breadcrumb-bar.tsx`, `layout/navigation-trail.tsx`, `layout/command-palette.tsx:60,80-84`.

### 6.2 Navigation config (`navigation/navigation.config.ts`, 1133 lines)

- 127 flat items, 14 top-level, max depth 2 (no third level; the `NavigationItem` type has no grouping/section field — `types/navigation.ts`).
- Children per section: finance **31**, settings 13, reports 12, products 10, hr 10, sales 9, purchasing 7, master-data 6, shipping 4, investors 4, crm 3, expenses 3, data-management **1**, dashboard 0.
- Finance mixes operations (receipts, payments, bank transactions, reconciliation), accounting core (JEs, GL, CoA, fiscal periods, year closing), master data (currencies, taxes, payment methods/terms, analytic plans/accounts), cost engine (allocation rules, fulfillment cost rules), assets/prepaids/accruals, and settings — 31 undifferentiated links.
- Master data is split across `master-data` (workflow statuses/transitions, countries, cities, languages, transaction types), `settings` (departments, job titles, customer classifications, no-purchase reasons, follow-up types) and `finance` (currencies, taxes, payment methods/terms) — ids prefixed `master-data-*` live under three parents.
- `data-management` is a section with a single child (Import Center) — one wasted expand click.
- Accordion behaviour (`expandedId`, one open section, `app-sidebar.tsx:87-107`) forces collapsing one module to see another.

### 6.3 Problems

1. **Vertical chrome before content (desktop):** TopBar 56px + BreadcrumbBar ≈40px (32px BackButton + `py-1`) + main `pt-1` 4px + PageHeader ≈46px (20px title + 13px subtitle) + gap 12px ≈ **158px**, +≈36px when NavigationTrail shows, + EDT toolbar ≈45px + bulk strip. On a 768px laptop viewport ~30% is chrome before the first table row.
2. **Two navigation rows:** breadcrumb + back button live in their own bar below the top bar, while the top bar's centre holds only the ⌘K launcher; breadcrumbs could share the top bar. NavigationTrail adds a third "where did I come from" affordance overlapping Back + breadcrumb.
3. **Oversized header controls:** CommandPalette trigger `h-11` (44px, `rounded-lg`) inside a 56px bar (`command-palette.tsx:80`), vs 32–36px controls everywhere else.
4. **Gutter mismatch:** BreadcrumbBar is always `px-6` (`breadcrumb-bar.tsx`), TopBar `px-3 sm:px-6`, main `px-3 sm:px-6 lg:px-8` — crumbs don't align with page content on mobile (12 vs 24px) or desktop ≥lg (24 vs 32px).
5. **Floating sidebar wastes space and adds decoration:** `p-4` padding around the panel (`ui/sidebar.tsx:235`), `rounded-2xl shadow-lg ring` (`:244`), icon-collapsed width = 3.75rem + 2rem; 17rem expanded. Header spends a full row on the collapse trigger and another on a 64px CompanySwitcher card before the first nav item.
6. **Content max-width 1400px** (`app-shell.tsx:29`) caps wide tables on large monitors while the page background is `bg-muted/25` — tables can't use full width for many-column lists.
7. **Sticky offset conflicts:** `RecordHighlightsHeader` is `lg:sticky lg:top-0 z-20` (`detail-workspace.tsx:226`) — slides under the sticky TopBar (`z-40`, 56px); `DetailSplitLayout` aside uses `lg:top-[4.75rem]` (`:268`), a hard-coded guess of TopBar+gap. No `--shell-header-height` token.
8. **Nested scroll** (see §4.2): page scrolls on the document while EDT scrolls internally with a JS-measured height.
9. **RTL:** `ui/sidebar.tsx:232` uses physical `left/right` classes; correct only because `app-sidebar.tsx:143` flips `side` by direction. Sheet `side="right"` default is logical-mapped (`ui/sheet.tsx:59`), fine.
10. **Placeholders:** NotificationsMenu is a static placeholder (`layout/notifications-menu.tsx`); SidebarFooter empty.
11. Header typography: sidebar brand uses `text-[13px] tracking-[0.04em]`, nav badge `text-[10px]` — off the type scale.
