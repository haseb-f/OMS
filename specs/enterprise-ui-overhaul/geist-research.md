# Vercel Geist — reference values (Round 3 research, 2026-09-28)

Source: official pages (vercel.com/geist/*, vercel.com/font, vercel.com/design/guidelines, the
2026 dashboard-navigation changelogs) plus Vercel's live production CSS served with the Geist docs.

- **[CSS]** exact value from Vercel's live stylesheet or demo markup.
- **[DOC]** stated in the Geist docs text.
- **[INFERRED]** deduction, not an official value.

These are reference values. The OMS pilot adapts them (brand navy primary, Arabic-first type, AA
contrast); the adaptations are in `design-system.md` §12.

## 1. Color steps [DOC] vercel.com/geist/colors

- 100 default background · 200 hover background · 300 active background
- 400 default border · 500 hover border · 600 active border
- 700 high-contrast background · 800 hover on high-contrast
- 900 secondary text/icons · 1000 primary text/icons
- background-100 = element/page background · background-200 = secondary background

**Light [CSS]:** background-100 #fff, background-200 #fafafa. Gray 100 #f2f2f2 · 200 #ebebeb ·
300 #e5e5e5 · 400 #ebebeb · 500 #c9c9c9 · 600 #a8a8a8 · 700 #8f8f8f · 800 #7d7d7d · 900 #4c4c4c ·
1000 #171717. Gray-alpha 100 #0000000d · 200 #00000014 · 400 #00000014 · 500 #00000036 ·
600 #00000057. Blue-700 #0072f5, blue-900 #0068d6. Red-800 #da2f35, red-900 #cb2a2f.
Amber-700 #ffb224, amber-800 #ff990a. Green-700 #45a557, green-800 hsl(132 43% 39%),
green-900 hsl(133 50% 32%).

**Dark [CSS]:** background-100 #0a0a0a, background-200 #000. Gray 100 #1a1a1a · 200 #1f1f1f ·
300 #292929 · 400 #2e2e2e · 500 #454545 · 600 #878787 · 900 #a1a1a1 · 1000 #ededed. Gray-alpha
(white) 100 #ffffff0f · 200 #ffffff17 · 400 #ffffff24 · 500 #ffffff3d. Blue-900 #52a8ff,
red-900 #ff6166.

**Usage [CSS]:** controls and cards draw the border as a 1px shadow (`0 0 0 1px gray-alpha-400`,
hover gray-alpha-500). Tables/dividers use gray-400. Page = background-200, surfaces =
background-100. Tinted states = color-100 background / color-900 text / color-400 border. Text:
primary gray-1000, secondary gray-900, placeholder/disabled gray-700.

## 2. Typography [DOC] vercel.com/geist/typography · [CSS]

- Weights 400 / 500 / 600. Sans "Geist", mono "Geist Mono". Geist has **no Arabic glyphs**.
- Headings (600): 32/40 −1.28px · 24/32 −0.96 · 20/26 −0.4 · 16/24 −0.32 · 14/20 −0.28.
- Buttons (500): 16/20 · 14/20 · 12/16. Labels (400): 14/20 · 13/16 · 12/16. Copy (400):
  16/24 · 14/20 · 13/18.
- Negative tracking must not be applied to Arabic (breaks joins) [INFERRED].

## 3. Materials [DOC] vercel.com/geist/materials · [CSS]

- base / small: radius 6 · medium / large: radius 12 · menu 12 · modal 12 · tooltip 6.
- border-base `0 0 0 1px #00000014`; small `0 2px 2px #0000000a`; menu = border +
  `0 1px 1px #00000005, 0 4px 8px -4px #0000000a, 0 16px 24px -8px #0000000f`; modal = border +
  `0 1px 1px #00000005, 0 8px 16px -4px #0000000a, 0 24px 32px -8px #0000000f`. Dark border
  `#ffffff25`.

## 4. Components [CSS] demo markup / [DOC] vercel.com/geist/<name>

- **Sizes:** small 32 · medium 36 · large 40; tiny button 24. Icons 16 in buttons, 14 in fields.
- **Button:** primary gray-1000 on background-100 text (hover 22% gray); secondary background-100 +
  1px gray-400 ring, hover gray-alpha-200; tertiary transparent, hover gray-alpha-200; error red-800
  (hover red-900); warning amber-800 with dark text; disabled gray-100 / gray-700 text. Radius 6,
  weight 500, transitions 150ms.
- **Input:** ring gray-alpha-400 → hover gray-alpha-500; focus `0 0 0 1px gray-alpha-600, 0 0 0 4px
rgba(0,0,0,.16)` (dark `rgba(255,255,255,.24)`); placeholder gray-700; error text red-900 13/20.
- **Select:** same ring as Input, chevron gray-700 → foreground on hover.
- **Menu:** panel padding 6, rows 36 tall, `0 8px` padding, radius 6, 14px text; panel radius 12 +
  shadow-menu.
- **Tabs:** underline tabs, 24px gap, 14px gray-900; selected gray-1000 with a 2px underline.
  Secondary: 32px pill tabs, selected gray-200 fill.
- **Badge:** pill, 12px/500; subtle = color-900 text on a light tint.
- **Note:** tinted 100/900/400, one inline action, placed next to what it describes.
- **Toast:** "{Noun} {past participle}", polite live region, never for critical errors.
- **Modal:** header / body / sticky actions; bottom sheet on mobile; titles are statements.
- **Table:** header 36px, font-medium gray-900, dividers gray-400, hover gray-100, "—" for unknown,
  tabular-nums.
- **Entity list:** identifier · title + description · status/actions, gray dividers.
- **Status dot:** 10px dot + label, 8px gap.
- **Kbd:** 20–24px, ring gray-alpha-400, radius 4.
- **Segmented switch:** 32px container, 4px padding, ring gray-alpha-400; checked segment filled.
- **Fieldset (settings card):** body `p-5`, title 20px, description 14px gray-900; footer
  ≥56px on background-200 with a top border, help on the start side, small Save at the end.
- **Danger zone:** the same fieldset with a red-400 border.

## 5. Dashboard layout [DOC] 2026 navigation changelogs · geist docs shell [CSS]

- Resizable, hideable **left sidebar** replaced horizontal tabs (default since 2026-02-26).
- Scope switcher top-start; ⌘K command menu with grouped Title Case headings.
- Docs-shell proxy: sidebar 260px, items 40px, radius 6, copy-14 gray-900, hover gray-100, active
  gray-1000 on gray-alpha-100. Search trigger 32px with a kbd hint. Breadcrumbs 14px gray-900,
  current gray-1000.
- Not verifiable (behind login): exact dashboard sidebar metrics and page header layout.

## 6. Focus, hover, motion [CSS] · [DOC] vercel.com/design/guidelines

- Focus ring `0 0 0 2px background-100, 0 0 0 4px blue-700` (dark blue-900). Inputs use the focus
  border instead.
- Controls 150ms; popovers 200ms; overlays 300ms from scale .96.
- Hover/active/focus must have more contrast than rest; never `transition: all`; tabular-nums;
  confirm or Undo for destructive actions; keep submit enabled and show a spinner in flight.
