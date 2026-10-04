# Round 9 — record-card templates: the contract

Every `EnterpriseDataTable` list has a Table / Grid switch (default on, `gridView={false}` to opt out).
Without a page template the Grid draws the **automatic card** (derived from the column `type`s).
A **template** is a page- or entity-specific `renderGridCard` that fills the shared
`RecordGridCard` (`components/shared/data-table/record-grid-card.tsx`) with business meaning. Templates
exist for the records people work in every day; everything else keeps the automatic card.

## Where a template lives and how it is wired

- File: `config/<domain>/<entity>-grid-card.tsx` (next to `<entity>-columns.tsx`). Existing examples:
  `components/store-orders/store-order-grid-card.tsx`, `components/crm/lead-grid-card.tsx`.
- Wire: `<EnterpriseDataTable renderGridCard={({ row, selected, onToggleSelected }) => <XGridCard … />} … />`
  (`MobileRowRenderArgs`). Server-side pagination, sort, filters, scope and totals are the table's own —
  a template NEVER fetches, filters or sorts.
- Reuse, don't copy: status badges (`StatusBadge` + the entity's `*-status.ts` tone/label maps), money
  (`MoneyValue`), dates (`formatDate`), identifiers/phones (`SemanticValue`), names (`LocaleText`),
  and **the row's own actions control** (export the table's `ActionsCell`/actions builder and pass it as
  `actionsNode`/`actions`), so permissions and action sets are identical in both views.

## Card anatomy (RecordGridCard slots)

| Slot                | Content                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title` + `href`    | the person / company / product name — the card's ONE link (stretched). Row without detail route: no `href`.                                         |
| `subtitle`          | one short line (phone, SKU, type)                                                                                                                   |
| `reference`         | the record number (`SemanticValue kind="id"`)                                                                                                       |
| `meta`              | date and/or the key amount (`MoneyValue`) — the figure people scan for                                                                              |
| `fields` (≤ 4)      | secondary label/value pairs; anything beyond four stays in the table                                                                                |
| `badges`            | SEPARATE badges, each answering one question (document status, payment, fulfilment). Label + icon, never colour only                                |
| `nextAction`        | the one next step as text (only where the entity already has one, e.g. orders/leads) — never a second status                                        |
| `tone`              | workflow meaning only (`success`/`warning`/`info`/`destructive`/`neutral`) from the SAME status→tone map the table badge uses. Never a brand colour |
| `selected` / toggle | pass the table's selection (`selected`, `onToggleSelected`); omit the toggle if the table has no selection                                          |

## Rules

1. **Data parity.** A card shows only fields already on the table's row type and only to whom the table
   shows them. Anything the table hides behind a permission (cost, margin, internal notes, agent
   commission, internal owner) is hidden in the card too — reuse the same permission check, never a
   looser one. **Agent portal templates use the portal row types only** (`PortalOrderRow`, …); never
   import a company row type or a cost/margin field there.
2. **Status honesty.** Opening ≠ contacting; a draft ≠ posted; payment ≠ fulfilment. Use the existing
   status maps; do not invent a combined "status".
3. **No crowded lists.** Header (name, reference, actions) → body (key figure, ≤ 4 fields, badges) →
   footer (next action). Long names/references truncate with the full text available (`title`
   attribute or `bdi`), never wrap the layout.
4. **Controls never open the record.** The checkbox and the actions menu are above the title's stretched
   link (RecordGridCard does this) — do not add other links or buttons inside the card.
5. **i18n.** Labels via `t(...)` with existing keys; new keys go in BOTH `en.ts` and `ar.ts`
   (module files under `i18n/messages/modules`). Arabic first, RTL: logical properties only.
6. **Absent data is not invented.** E.g. the invoice row has no due date → show the remaining balance;
   do not fabricate a date.

## Coverage record

Each template/list is recorded in `coverage.md` with: route, table id, card kind (template / automatic),
slots used, permission notes, and any gap.
