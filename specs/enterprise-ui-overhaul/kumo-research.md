# Cloudflare Kumo — Research for OMS Adaptation

Researched 2026-09-27. Everything below was read from official sources: the
`cloudflare/kumo` GitHub repo (shallow clone of `main`, last commit
2026-09-25), the `@cloudflare/kumo` npm registry entry, and the docs site
`kumo-ui.com`. No APIs are inferred. Class strings are quoted from the component
source. Size tokens use Kumo's own type scale (see §1.3).

## 1. What Kumo is

### 1.1 Official identity and URLs

| Item        | Value                                                                                                                                                           | Source                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Description | "Cloudflare's component library for building modern web applications." Its components are "accessible, design-system-compliant UI components built on Base UI". | `README.md`           |
| Repo        | https://github.com/cloudflare/kumo (pnpm monorepo: `packages/kumo`, `kumo-docs-astro`, `kumo-figma`, `kumo-screenshot-worker`)                                  | GitHub                |
| npm         | `@cloudflare/kumo`, version **2.14.0**, license **MIT** ("Copyright (c) 2026 Cloudflare, Inc.")                                                                 | `npm view`, `LICENSE` |
| Docs        | https://kumo-ui.com (reachable). It identifies itself as Cloudflare's Kumo docs, for example https://kumo-ui.com/components/select                              | WebFetch              |
| Dev guide   | https://github.com/cloudflare/kumo/blob/main/AGENTS.md                                                                                                          | GitHub                |
| CLI docs    | `npx @cloudflare/kumo ls` / `doc Button` / `docs`                                                                                                               | README                |

### 1.2 Stack

- **Base UI** (`@base-ui/react ^1.8.0`) primitives. This is **not Radix**. Kumo also
  re-exports the primitives, for example `@cloudflare/kumo/primitives/popover`.
- **Tailwind CSS v4** with semantic `kumo-*` tokens. Colors use `light-dark()` and
  oklch (`src/styles/theme-kumo.css`, `kumo-binding.css`).
- Icons come from **Phosphor** (`@phosphor-icons/react`, a peer dependency). Other
  dependencies: `motion`, `react-day-picker`, `shiki`, and `echarts`/`zod` (peer).
- Variants are defined as plain objects (`KUMO_*_VARIANTS = { size: {...}, variant: {...} }`)
  and resolved by a `xxxVariants()` function. The library does **not** use cva, but the
  pattern is equivalent.
- Component list in `packages/kumo/src/components`: autocomplete, badge, banner,
  breadcrumbs, button, button-group, chart, checkbox, clipboard-text, code,
  collapsible, combobox, command-palette, date-picker, date-range-picker, dialog,
  dropdown, empty, field, flow, grid, inline-copy-text, input, input-group, label,
  layer-card, layer-dialog, link, loader, menubar, meter, pagination, popover,
  radio, select, sensitive-input, sidebar, surface, switch, table,
  table-of-contents, tabs, tag-input, text, toast, toolbar, tooltip.

### 1.3 Core tokens (light theme, `theme-kumo.css`)

| Token                                         | Light value                                     | Role                                                                |
| --------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| `--text-xs / sm / base`                       | **12px / 13px / 14px** (base line-height 1.5)   | Type scale. `text-base` is **14px**.                                |
| `kumo-base`                                   | `#fff`                                          | Card and popup background                                           |
| `kumo-elevated`                               | oklch(98% 0 0)                                  | Layered card shell, one step off white                              |
| `kumo-control`                                | `#fff`                                          | Input, select, and dropdown-popup background                        |
| `kumo-tint`                                   | oklch(97% 0 0)                                  | Hover, highlighted row, active nav background                       |
| `kumo-overlay`                                | oklch(97.5% 0 0)                                | Dropdown highlighted item, chips                                    |
| `kumo-fill` / `fill-hover`                    | oklch(92.2%) / oklch(96.5%)                     | Neutral fills                                                       |
| `kumo-line`                                   | oklch(14.5% 0 0 / **0.1**)                      | Default 1px ring (border) on controls and cards. Translucent black. |
| `kumo-hairline`                               | oklch(93.5% 0 0)                                | Separators and inner rings                                          |
| `kumo-focus`                                  | oklch(15% 0 0)                                  | Focus ring, used at `/50` opacity                                   |
| `kumo-brand`                                  | oklch(0.5772 0.2324 260) (blue)                 | Primary button, focus-visible ring                                  |
| `kumo-danger` / `-tint`                       | red-500 / oklch(93.6% 0.032 17.7 / .42)         | Errors                                                              |
| `kumo-info`, `warning`, `success` (+ `-tint`) | blue-500, oklch(73.9% .177 58.2), emerald-600   | Status colors                                                       |
| text: `default`, `subtle`, `placeholder`      | subtle = neutral-500, placeholder = neutral-400 | Text colors                                                         |

**Signature trait:** borders are drawn with a **`ring` (box-shadow 1px) in
`ring-kumo-line`**, which is 10% black, together with `border-0`. Real CSS
borders are not used. Focus thickens the ring to `ring-[1.5px]` in
`kumo-focus/50`, which is neutral near-black, not brand-colored.

## 2. Component families

### 2.1 Button (`components/button/button.tsx`)

- Props: `variant`, `size`, `shape` (`base | square | circle`), `icon`, `loading`,
  and `title` (which gives a tooltip). Icon-only buttons need an accessible name,
  which the types enforce. Defaults are `variant="secondary"`, `size="base"`, and
  `shape="base"`.
- Base classes are `flex w-max shrink-0 items-center font-medium select-none border-0 shadow-xs`,
  `focus-visible:ring-2 focus-visible:ring-kumo-brand`, and
  `disabled:cursor-not-allowed disabled:text-kumo-subtle`.

| Size     | Classes                                 | Height                                        |
| -------- | --------------------------------------- | --------------------------------------------- |
| xs       | `h-5 gap-1 rounded-sm px-1.5 text-xs`   | 20px                                          |
| sm       | `h-6.5 gap-1 rounded-md px-2 text-xs`   | 26px                                          |
| **base** | `h-9 gap-1.5 rounded-lg px-3 text-base` | **36px**, 8px radius, 12px padding, 14px text |
| lg       | `h-10 gap-2 rounded-lg px-4 text-base`  | 40px                                          |

The square and circle shapes use `size-*` classes that match the heights above: `size-6.5`, `size-9`, and `size-10`.

| Variant                 | Look                                                                                                                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `primary`               | Brand fill. The background is `color-mix(brand, white 30%)`, overlaid with a vertical gradient from `mix(brand, white 15%)` to `brand` and an inset 1px top highlight. The ring is `mix(brand, black 10%)` and the text is white. |
| `secondary` (default)   | `bg-kumo-base` (white) with `ring ring-kumo-line`. Hover changes it to `bg-kumo-tint`.                                                                                                                                            |
| `ghost`                 | No background and no shadow. Hover changes it to `bg-kumo-tint`.                                                                                                                                                                  |
| `destructive`           | Same treatment as `primary`, using the `kumo-danger` token.                                                                                                                                                                       |
| `secondary-destructive` | Secondary styling with danger-colored text. Hover changes the ring to `danger/30`.                                                                                                                                                |
| `outline`               | Transparent background with `ring-kumo-line`. Hover changes it to `ring-kumo-focus/25`.                                                                                                                                           |

### 2.2 Input (`components/input/input.tsx`, `input-area.tsx`)

- Props: `size` (`xs | sm | base | lg`), `label`, `description`, `error`
  (a string or `{message, match}`), `labelTooltip`, and `passwordManagerIgnore`.
  `variant="error"` is **deprecated**: passing `error` is enough, and it also
  switches the Field wrapper on.
- `inputVariants()`: `border-0 bg-kumo-control text-kumo-default ring ring-kumo-line outline-none`.
  Placeholder text uses `--text-color-kumo-placeholder`. Focus is
  `focus:ring-[1.5px] focus:ring-kumo-focus/50`. The error state is
  `!ring-kumo-danger focus:ring-kumo-danger/50`.
- **Sizes are identical to Button**: `h-5` / `h-6.5` / **`h-9 rounded-lg px-3 text-base`** / `h-10 px-4`.
  In other words, inputs and buttons share one height scale.

### 2.3 InputGroup (`components/input-group/*`)

- Parts: `InputGroup`, `InputGroup.Input`, `.Addon` (`align="start"|"end"`),
  `.Button`, and `.Suffix`.
- The container reuses `inputVariants({size})` and adds `px-0 flex items-center gap-0`.
  In `focusMode="container"` it adds `overflow-hidden focus-within:ring-[1.5px] focus-within:ring-kumo-focus/50`,
  so the whole group shows **one shared focus ring**. It also sets
  `has-[input[aria-invalid=true]]:ring-kumo-danger`.
- InputGroup has its own height scale, which differs from Input's: `h-6`, `h-7`, **`h-9`** (base), and `h-11`.
- Spacing model (from the comment in `context.ts`), for base size: the input has
  12px (`px-3`) on its outer side and 8px on the side next to an addon. The addon
  has 8px on its outer side and 0 on the side next to the input. The addon icon
  is sized automatically to **18px** at base size (10/13/18 for xs/sm/base).
  Addon styling is `text-kumo-subtle pointer-events-none`, with
  `*:pointer-events-auto` so its children stay clickable.
- Caveat: Kumo uses physical `pl-`/`pr-`/`right-` here, not logical properties.

### 2.4 Select (`components/select/select.tsx`), a button-style trigger

- Documented props (kumo-ui.com): `size`, `placeholder`, `label`, `error`,
  `loading`, `disabled`, `labelTooltip`, `renderValue`, and `multiple`. Parts are
  `Select.Option`, `.Group`, `.GroupLabel`, and `.Separator`.
- The **trigger** calls `selectVariants()`, which is `buttonVariants({size})`
  plus `bg-kumo-control ... justify-between font-normal` and
  `focus-visible:ring-inset`. The trigger is therefore a **Button rendered with
  control styling**: the same height (36px), `rounded-lg`, `px-3`, `shadow-xs`,
  and 1px `ring-kumo-line`, with the button's `font-medium` replaced by
  `font-normal`. Its background is white (`kumo-control`), the same as an
  Input's, so it **looks like a field, not a tonal grey button**.
- **Chevron:** Phosphor `CaretUpDownIcon`, a double up/down caret rather than a
  single down arrow. It is 16px at base size (12/14/16/18 by size), in
  `text-kumo-subtle`, pushed to the end by `justify-between`.
- **Placeholder:** `data-[placeholder]:text-kumo-placeholder`, truncated.
- **Loading:** a skeleton line (`w-32`) replaces the value.
- **Error:** `!ring-kumo-danger`.
- **No clear button** on Select.
- **Popup:** `bg-kumo-base rounded-lg shadow-lg ring ring-kumo-line py-1.5`, with
  `min-w-(--anchor-width)` so it is at least as wide as the trigger. It opens
  **below the trigger** (`side="bottom"`) and deliberately does not use Base UI's
  native-style `alignItemWithTrigger` overlay, though consumers can opt back in.
- **Option row:** `mx-1.5 flex justify-between gap-2 rounded px-2 py-1.5 text-base`.
  At 14px × 1.5 line-height plus 12px vertical padding, a row is about **33px** tall.
  Hovered or highlighted rows use `data-highlighted:bg-kumo-tint`.
  **Selected option:** a `CheckIcon` at the **end** of the row (trailing).
- **Group label:** `px-3.5 py-1.5 text-sm font-semibold text-kumo-subtle`.
- **Separator:** `-mx-1 my-1 h-px bg-kumo-hairline`.

### 2.5 Combobox (`components/combobox/combobox.tsx`)

- Parts: `Combobox` (Root), `.TriggerInput` (searchable input trigger),
  `.TriggerValue` (button-like trigger), `.TriggerMultipleWithInput` (chips),
  `.Content`, `.List`, `.Item`, `.Empty`, `.Input` (search box inside the popup),
  `.Group`, `.GroupLabel`, and `.Chip`. It also exposes `useFilter` and
  `createItems`. Props include `size` (xs–lg, the same scale as Input) and
  `inputSide` (`right | top`).
- **TriggerValue:** uses `inputVariants()` (the Input look: white, 1px ring,
  36px) with a `CaretUpDownIcon` absolutely positioned at the end, and
  `data-[placeholder]:text-kumo-placeholder`.
- **TriggerInput:** an Input with end padding `pr-12` (base) to reserve space for
  **two end icons**:
  - A **clear** button (`XIcon`, 16px, `right-8`, hidden via
    `data-[disabled]:opacity-0` when there is nothing to clear). Its label comes
    from the `clearLabel` prop and defaults to "Clear selection".
  - A caret trigger (`right-2`). Its label comes from `showOptionsLabel`.
- **Item:** `mx-1.5 grid grid-cols-[1fr_16px] gap-2 rounded px-2 py-1.5 text-base`,
  highlighted with `bg-kumo-tint`. The selected item shows a trailing
  `CheckIcon` in a fixed 16px column. Disabled items use `text-kumo-subtle opacity-60`.
- **Empty:** `px-4 py-2 text-[0.925rem] text-kumo-subtle`.
- **Groups:** each group after the first gets `border-t border-kumo-hairline mt-2 pt-2`.
- **Chips:** `rounded-sm ring-1 ring-kumo-hairline bg-kumo-overlay`, with a 10px `XIcon` remove button.

### 2.6 Dropdown menu (`components/dropdown/dropdown.tsx`)

- **Popup:** `bg-kumo-control rounded-lg shadow-lg ring ring-kumo-line min-w-36 p-1.5`,
  with fade and zoom-95 open animations.
- **Item:** `rounded-md px-2 py-1.5 text-base`, which gives rows of about 33px.
  Hovered or highlighted items use `data-highlighted:bg-kumo-overlay`. A leading
  icon can be added with `mr-2 h-4 w-4`. The **danger item variant** is
  `text-kumo-danger data-highlighted:bg-kumo-danger/5`.
- **Checkbox item:** `pl-8`, with a **leading** indicator at `absolute left-2` (14px).
  Radio and selected items use a trailing `ml-auto` `Check` (16px).
- **Shortcut:** `ml-auto text-xs tracking-widest opacity-60`.
- **Submenu trigger:** trailing `CaretRight`, `data-[state=open]:bg-kumo-tint`.
- **Separator:** `h-px bg-kumo-hairline`.

### 2.7 Card / Surface (`layer-card`, `surface`)

- **`LayerCard`** (current):
  - Standalone surface: `rounded-lg bg-kumo-base shadow-xs ring ring-kumo-line`.
  - Layered root: `rounded-lg bg-kumo-elevated ring ring-kumo-hairline`.
  - Secondary strip, used as a header band: `bg-kumo-elevated p-4 text-base font-medium text-kumo-subtle`.
  - Primary panel: `rounded-lg bg-kumo-base p-4 ring ring-kumo-fill`.

  Together these give a light-grey shell holding a secondary header line and a
  white inner panel inset within it.

- **`Surface`** is marked **deprecated** (`data-deprecated="surface"`). It is now
  a thin wrapper over `LayerCard`, with `color: primary|secondary`, where both
  colors have empty classes.
- Radius is 8px (`rounded-lg`) and card padding is 16px (`p-4`). There are no
  heavy shadows (`shadow-xs`).

### 2.8 Feedback

- **Banner** (the inline alert):
  - Variants: `default` = `bg-kumo-info-tint text-kumo-info`, `alert` = warning
    tint, `error` = danger tint, and `secondary` = `bg-kumo-contrast/5 text-kumo-default/70`.
  - Sizes: `base` = `items-start gap-3 rounded-lg px-4 py-3 text-base`, and
    `sm` = `items-center gap-2 rounded-md px-3 py-2 text-sm` (for dialogs).
  - Each banner has an icon, a `font-medium` title, a description, and an
    optional `action` slot, plus a `BannerAction` part.
  - Banners are **tinted backgrounds with no border**.
- **Toast:**
  - Root: `rounded-xl ring ring-kumo-line p-4 shadow-lg`.
  - Variants:
    - `default`: `bg-kumo-base`.
    - `success`, `error`, `warning`: `ring-[0.3px] ring-kumo-<tone> bg-kumo-base`. The icon and the title take the tone color. The body stays neutral.
    - `info`: uses `bg-kumo-control`.
  - The icon sits on a translucent tinted chip (success `-tint/20`, others `-tint/50`).
  - Text: title `text-[0.975rem] leading-5 font-medium`; description `text-[0.925rem] text-kumo-default/70`.
  - Close button: `absolute top-2 right-2 size-5`.
  - Toasts can carry an actions row (`mt-2 flex gap-2`).
  - **Viewport:** bottom-right (`right-4 bottom-4`, `sm:right-8 sm:bottom-8`), `sm:w-[340px]`, and full width minus 2rem on mobile.
- **Inline field error** (`field/field.tsx`): Field is a `grid gap-2` layout with the
  label (`text-base font-medium`), then the control, then **either** an error
  (`text-sm leading-snug text-kumo-danger`) **or** a description
  (`text-sm text-kumo-subtle`), never both. The error replaces the description.
  An optional field shows an "optional" marker when `required === false`. The
  control's ring turns `kumo-danger`.

### 2.9 Sidebar (`components/sidebar/sidebar.tsx`)

- Parts: `Sidebar.Provider`, `Sidebar` (root), `.Header`, `.Content` (Base UI
  ScrollArea), `.Footer`, `.Loading` (skeleton), `.Group`, `.GroupLabel`, `.Menu`,
  `.MenuItem`, and `.MenuButton`, among others. Variants include `floating`
  (`m-2 rounded-lg border shadow-lg`). It can collapse to icons or off-canvas,
  and can be resizable.
- **Width:** 16.25rem (260px). **Icon rail:** 57px. **Easing:** cubic-bezier(0.77, 0, 0.175, 1).
- **Menu button:** `rounded-lg gap-2.5`.
  - Base size: `min-h-8.5` (**34px**), `px-3`, 13px text (`text-sm font-medium`). Small size: `min-h-7` (28px).
  - The icon is `size-4 opacity-40` (faded).
  - Hover and active states both use `bg-(--sidebar-active-bg)` = `kumo-tint`.
    There is **no accent bar and no brand color** for the active item.
- **Group label:** in the expanded sidebar it is a text label. When collapsed, it
  becomes a `border-b border-kumo-line` divider with `my-3`.
- **Footer:** `h-12 border-t border-kumo-line`.

### 2.10 Page headers / layout

The component list has no dedicated page-header or page-layout component. The
closest parts are `breadcrumbs`, `toolbar`, `layer-card`, `grid`, and `empty`,
which were not examined in depth. I found no official page-header pattern to report.

## 3. Adaptation notes for OMS

These map Kumo patterns onto the OMS primitives (`apps/web/src/components/ui/*`,
`components/shared/entity-combobox.tsx`). Kumo runs on Base UI and OMS on Radix,
so we adopt the **visual tokens and patterns only, not the code**. Kumo also
uses physical `pl-`/`pr-`/`right-`, which we must translate to `ps-`/`pe-`/`end-`
for RTL.

1. **One height scale for fields and buttons.** Kumo's base size is 36px (`h-9`)
   for Button, Input, Select trigger, Combobox, and InputGroup, with
   `rounded-lg`, `px-3`, and 14px text. Recommendation: make `EnterpriseButton`
   default, `Input`, `SelectTrigger`, and the `EntityCombobox` trigger share one
   height token, so a button next to a field always aligns. Kumo's sm size
   (26px) is its compact-row size.
2. **Select and EntityCombobox trigger.** Kumo's triggers are **not** neutral tonal
   (grey) buttons. Select reuses Button geometry, but its background is
   `kumo-control` (white, the same as Input) with a 1px `ring-kumo-line` border,
   `font-normal`, a placeholder-colored empty state, and a trailing subtle
   `CaretUpDown`. `Combobox.TriggerValue` uses the Input styling outright. The
   takeaway is that selectors should look like fields, with no tonal fill. Two
   refinements fit OMS:
   - Use an up/down caret, 16px, `text-subtle`, at the end of the trigger.
   - For the searchable `EntityCombobox`, add a clear (X) control inside the
     trigger, before the caret. It appears only when a value is set and has a
     translatable label (Kumo's `clearLabel`).

   Select itself has no clear button.

3. **Borders as a translucent ring.** Kumo's `kumo-line` is 10% black drawn with
   `ring`, and focus is `ring-[1.5px]` neutral at 50%. The OMS Input uses
   `border border-input` plus a `focus-ring` token. We could adopt a lighter,
   translucent border and a thicker neutral focus ring through tokens in
   `globals.css`/`tokens.css`, not per component.
4. **EnterpriseButton variants.** Kumo's `secondary` is the default: white with a
   ring, turning to a tint on hover. `primary` and `destructive` are brand or
   danger fills with a subtle vertical gradient and a 1px inset highlight.
   `ghost`, `outline`, and `secondary-destructive` (danger text on a neutral
   button) complete the set. `secondary-destructive` maps well to OMS's
   less-prominent delete actions. The gradient is decorative, so it is optional
   under our "no decorative effects" policy.
5. **Menus (DropdownMenu, Select, Command items).** Rows are about 33px
   (`px-2 py-1.5`, 14px text), inset `mx-1.5` inside a `p-1.5`/`py-1.5` popup,
   with `rounded-md`. The highlight is a neutral tint, and the selection is a
   **trailing** check (a leading indicator only for checkbox items). Danger
   items use red text with a 5% red highlight. The popup is at least the
   trigger's width.
6. **EnterpriseCard.** A white card with an 8px radius, a 1px ring, `shadow-xs`,
   and 16px padding. The "layered" variant puts a grey header strip inside a
   hairline-ringed elevated shell, which is a good fit for a card with a header
   band.
7. **Alert → Banner.** Use tinted backgrounds with **no border** and tone-colored
   text and icon. There are 4 tones (info/warning/danger/neutral) and 2 sizes;
   sm is for dialogs. The title is `font-medium`, and an action slot sits at
   the end.
8. **Toast (sonner).** Use a neutral white body with a hairline (0.3px) tone ring,
   and color only the icon chip and the title. The toast has a 12px radius and
   `shadow-lg`, sits bottom-end, is 340px wide on desktop and full-width on
   mobile, and supports action buttons. In RTL, "bottom-end" means bottom-left.
9. **Field errors.** The error message **replaces** the helper description
   (13px, danger), and the control ring turns danger. InputGroup shows the error
   on the whole group through `has-[aria-invalid]`.
10. **Sidebar.** 260px wide with a 57px rail and 34px items. The icon is at 40%
    opacity, and the active item gets a neutral tint only, with no accent bar.
    Collapsed group labels become dividers. OMS navigation stays config-driven.
    Only the visual tokens transfer.
