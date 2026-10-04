# Round 9 — record-card grid research (official examples) and the pattern chosen

Read-only research, 2026-10-04. Only pages that were actually fetched are listed as inspected;
anything that could not be fetched is marked. **No inspected library ships a ready-made, selectable
record-card grid** (orders / customers / invoices / products) — shadcn/ui and Kumo supply primitives
and layout helpers; the card grid is a custom composition everywhere. OMS therefore composes its
own card from the primitives it already has, and installs nothing.

## What was inspected

| Source                                                                                                                                                                                         | What it really shows                                                                                                                                                                                                          | Primitive or composition                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [shadcn/ui Card](https://ui.shadcn.com/docs/components/card)                                                                                                                                   | Slots `CardHeader` / `CardTitle` / `CardDescription` / `CardAction` (end of the header) / `CardContent` / `CardFooter`; `size="sm"`; RTL documented. Static container — no selection, no link, no grid.                       | **Primitive** (anatomy to copy: header with action slot → content → footer)   |
| [shadcn/ui Data Table](https://ui.shadcn.com/docs/components/data-table), [Tasks example](https://ui.shadcn.com/examples/tasks)                                                                | TanStack table with checkbox column, row-actions menu, column visibility, pagination, status/priority badges, "0 of 100 selected". **No card or grid view.**                                                                  | Composition recipe — table only (OMS's table already goes beyond it)          |
| [shadcn/ui Blocks](https://ui.shadcn.com/blocks)                                                                                                                                               | dashboard-01 has KPI "section cards" above a data table; no block renders a grid of product/customer/order records.                                                                                                           | KPI cards are not record cards                                                |
| [shadcn/ui Item](https://ui.shadcn.com/docs/components/item)                                                                                                                                   | `Item`, `ItemMedia`, `ItemContent`, `ItemTitle`, `ItemDescription`, `ItemActions`, `ItemHeader`, `ItemFooter`; variants default / outline / muted; can render as a link; RTL support.                                         | **Primitive** — a row-style list item, not a grid card                        |
| [shadcn/ui Field → Choice Card](https://ui.shadcn.com/docs/components/field), [Checkbox](https://ui.shadcn.com/docs/components/checkbox), [Badge](https://ui.shadcn.com/docs/components/badge) | "Wrap `Field` inside `FieldLabel`" gives a selectable card for form choices; checkbox has a table-row-selection example and an Arabic RTL example; Badge has icon support and RTL.                                            | Primitives — the closest shadcn gets to a selectable card is a _form_ pattern |
| [Cloudflare Kumo Grid](https://kumo-ui.com/components/grid)                                                                                                                                    | Variants `2up` / `3up` / `4up` / `6up` / `2-1` / `1-2` with column counts stepped by breakpoint; gap none / sm / base / lg. No min-width auto-fill.                                                                           | **Primitive** — layout helper, breakpoint-stepped                             |
| [Kumo Table](https://kumo-ui.com/components/table)                                                                                                                                             | Native table elements, `Table.CheckHead` / `CheckCell`, row `variant="selected"`, sticky columns; checkboxes must carry `aria-label`.                                                                                         | **Primitive**                                                                 |
| [Kumo Layer Card](https://kumo-ui.com/components/layer-card), [Resource List block](https://kumo-ui.com/blocks/resource-list)                                                                  | Layer Card = secondary header row + primary body ("navigation or feature highlights"). Resource List is a CLI-installed page block (header + 1:2 grid of `Surface` items) with no selection, badges or actions.               | Primitive / custom composition — **Kumo ships no record-card grid**           |
| [Carbon Tile](https://carbondesignsystem.com/components/tile/usage/)                                                                                                                           | Base / clickable / selectable / expandable. A clickable tile must not hold inner CTAs; a selectable tile can (checkbox icon for multi-select). Gutter modes wide / narrow / condensed.                                        | **Primitive** — the clearest rule for interactive content inside a card       |
| [Fluent UI v9 Card](https://github.com/microsoft/fluentui) (react-card `Card.types.ts`)                                                                                                        | `selected`, `onSelectionChange`, `appearance` (filled / outline / subtle), `size`, `focusMode`, `floatingAction` (top-right), `checkbox`.                                                                                     | **Primitive** with selection and a managed focus model                        |
| [Ant Design List](https://ant.design/components/list)                                                                                                                                          | `grid={{ gutter, xs…xxl, column }}`; the page marks List deprecated and recommends composing `Row`/`Col` with `Card`.                                                                                                         | Primitive — and Ant itself says compose it yourself                           |
| [Atlassian Dynamic Table](https://atlassian.design/components/dynamic-table/usage), [Primer DataTable](https://primer.style/components/data-table)                                             | Table guidance: "never rely on highlighted rows to convey selection"; Primer density (condensed / normal / spacious) and three row-action patterns (kebab, inline icons, one inline + kebab); action header hidden.           | Table guidance — informs selection state and action placement                 |
| Polaris IndexTable / ResourceList                                                                                                                                                              | Docs did not load; only search snippets and [issue #792](https://github.com/Shopify/polaris-react/issues/792) (generic "Select item" labels, repeated shortcut labels, icon-only "…", focus lost when the bulk bar swaps in). | **Partly verified** — used only as a list of accessibility pitfalls to avoid  |
| `ui.shadcn.com/examples/cards` (404), Linear, Stripe Dashboard, Material 3 (no body)                                                                                                           | Not fetched.                                                                                                                                                                                                                  | **Not verified — nothing is claimed about them**                              |

## The pattern chosen for OMS

**A custom `RecordGridCard` composed from shadcn-style card anatomy, with Carbon's selectable-tile
interaction rule and Fluent's selection semantics, on a CSS auto-fill grid.** It is what OMS already
has in embryo (`RecordGridCard`, `EnterpriseDataTable renderGridCard`, per-user view preference); this
round refines it and makes it universal rather than adding a library.

- **Anatomy** (shadcn Card slots → OMS): _header_ = selection checkbox (start), identity link,
  actions kebab (end — shadcn's `CardAction` position); _body_ = reference and key figure, at most four
  label/value fields, separate status badges; _footer_ = the one next action / extra line.
- **Grid** (not Kumo's breakpoint steps, not Ant's fixed columns): `repeat(auto-fill,
minmax(min(100%, 17rem), 1fr))` — columns come from usable width, one column on a phone, never a
  card narrower than 17 rem.
- **Interaction** (Carbon): one primary link (the title) stretched over the card by a pseudo-element;
  checkbox and kebab sit above it, so there are no nested anchors and a control click never opens the
  record.
- **Selection** (Fluent / Kumo / Atlassian): a real checkbox with a record-specific `aria-label`
  (Polaris #792, Kumo Table), a distinct selected treatment (ring + tint, always with the checked box —
  never colour alone), and the table's own bulk strip and scope menu.
- **Status**: the same badge mapping as the table, label + icon, never colour alone.
- **Hover / focus / selected** are three different treatments (small elevation + stronger edge;
  2 px focus ring on the whole card; blue selection ring).
- **RTL**: logical properties only; checkbox at the start, kebab at the end; numerals, phones and
  references isolated with `bdi` / `dir="ltr"`.

Why not a library: none inspected ships the component, and adopting a second UI stack to copy
appearance would fragment the design system (the owner asked for the shared stack).
