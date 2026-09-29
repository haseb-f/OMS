# UI-A — Bulk selection and table surfaces

Stream UI-A of `spec.md` (§1 bulk selection, §6 table surfaces). Baseline: design-system §6 and §12.

## 1. Selection control

The header of the injected `select` column (`createSelectionColumn`,
`components/shared/data-table/data-table-selection-column.tsx`) is a **split control**, used by every
`EnterpriseDataTable`:

- **Checkbox**: toggles the rows on the current page. Unchecked, indeterminate (dash, "some rows on
  this page") and checked (filled primary) are distinct. Its hit area is 24px wide (the 16px box
  extends 4px each side) — WCAG 2.2 2.5.8.
- **Menu button**: a 20px bordered outline control with a 24×24 hit area (2px pseudo-element
  extension; the 6px gap is exactly where the two hit areas meet, so they never overlap) (`IconActionButton variant="outline"`) with its
  own surface, hover, pressed/open (inset) and focus-visible states. It has `aria-label` "Selection
  options" / «خيارات التحديد», `aria-haspopup="menu"` and `aria-expanded`. It is reachable by Tab, and
  Enter, Space or ArrowDown opens it (Radix).
- **Menu contents**, in order:
  1. Current scope summary, e.g. "12 selected on this page", or "No rows selected".
  2. Select this page (with the page row count). This **replaces** any wider selection with exactly
     this page.
  3. Select all matching results (with the matching total). Shown only when the caller passes
     `onSelectAllMatching`, which stays opt-in.
  4. Select a specific number… Shown only when the caller passes `selectCustomCount`.
  5. Clear selection.
- The column is 60px wide: 12px outer gutter + 16px box + 6px gap + 20px button + 4px gutter = 58.
  It was 52px. The header height (34px) is unchanged. All positioning uses logical properties (`ms-auto`, `ps-`/`pe-`) and works in RTL.

`components/ui/checkbox.tsx` fix: the state classes used `data-checked:`, but Radix only emits
`data-state="checked|indeterminate"`, so a checked box was never filled. Every state now keys on
`data-[state=…]`, and indeterminate draws a dash (`MinusIcon`).

## 2. Selection scope (never overstated)

The scope is derived from the actual selected ids by `resolveSelectionScope()` in `bulk-selection.ts`
(unit-tested in `bulk-selection.spec.ts`). It never comes from what the user last clicked.

| Scope         | Rule                                                                                                                                                                                                                                                                                                               | Strip text (en / ar)                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `page`        | Every selected id is a row on the current page                                                                                                                                                                                                                                                                     | "{n} selected on this page" / «{n} محدد في هذه الصفحة»                     |
| `acrossPages` | At least one selected id is not on this page (manual picks on several pages, or "first N")                                                                                                                                                                                                                         | "{n} selected across pages" / «{n} محدد عبر عدة صفحات»                     |
| `allMatching` | **Server mode:** the selection equals exactly the id set of a **complete** "select all matching" result (`MatchingSelectionSnapshot`) fetched for the **current** query — never inferred from the selected count reaching the total. **Client mode:** exactly the filtered row ids, nothing selected outside them. | "All {n} matching results selected" / «تم تحديد كل النتائج المطابقة ({n})» |

- **Full page, more matches.** Selecting the whole page while more records match stays `page`. It
  never reads as "all".
- **Count is never proof.** A fully selected page whose size equals the total, or a stale selection
  whose size reaches it, stays `page` / `acrossPages`. Only "Select all matching results" can
  produce `allMatching` (server mode).
- **Truncated or capped results.** When `ids.length < total` (the `/ids` cap, `BULK_LIMITS.selectIdsMax`
  = 10,000) the snapshot is incomplete: the returned ids are selected, the scope reads "across
  pages", and a toast says "Selected the first {count} of {total} matching results — the selection
  limit…". Store Orders' Cost State / Loss-Making filter is evaluated over a bounded window
  (`PROFITABILITY_FILTER_CAP` = 500, as the list itself); when `/ids` reports
  `profitabilityFilterCapped` the selection is likewise labelled "across pages" with a "may be
  incomplete" toast.
- **Unchecking one row** from an "all matching" selection immediately drops the label to "across
  pages".
- **Shared hook.** `useMatchingSelection(listFilters)` (`data-table/use-matching-selection.ts`)
  owns these rules for every page with select-all: it returns `queryKey` (→ `selectionResetKey`),
  `matchingSelection` (→ the table; `null` for any other query), `selectAllMatching()` and
  `fetchForCurrentQuery()` (drops results that arrive after the query changed).
- **Count shown once.** The count appears once, in the bulk strip, with digits in `num` runs. The
  footer only shows "{selected} of {total} selected" on tables that have no bulk strip.
- **Down-scope link.** When the scope is `allMatching` and the page shows fewer rows than are
  selected, the strip offers "Use current page selection only".

## 3. Filter, search and sort changes

**Rule:** any change to filters, search or sort **clears the selection, whatever its scope**, and an
info toast says so: "Selection cleared because the filters, search or sort changed." /
«تم إلغاء التحديد لأن الفلاتر أو البحث أو الترتيب تغيّر.»

- **Pagination and page size never clear.** Picking rows across pages is intentional.
- **Why every scope clears.** Keeping a page selection after a filter change would leave rows
  selected that the user can no longer see. Keeping an "all matching" selection would silently stop
  meaning "all matching". Clearing is the only reading that cannot mislead. Sort is included because
  "first N" is defined by the sort, and because a page selection would otherwise scatter across
  pages. This matches the TASK-064 snapshot rule and extends it to hand-made selections.
- **Where it runs.** `EnterpriseDataTable` builds `selectionQuerySignature()` from three inputs: the
  caller's new `selectionResetKey`, the table's own committed (debounced) search and column filters,
  and the sort. A change to that signature clears the selection. The signature ignores key order,
  multi-select value order and empty values (`undefined`, `null`, `""`, `[]`); it keeps `false` and
  `0`.
- **In-flight requests.** `useMatchingSelection` drops `listIds` results (select all and first N)
  that return after the query changed mid-request, so stale ids are never selected.
- **Dates.** The signature serializes `Date` values (date-range filters) as ISO strings.
- **Earlier behaviour removed.** Both pages had their own "virtual selection" effects and toasts
  (`storeOrders.bulkSelection.selectionCleared`, `masterData.bulkSelection.selectionCleared`). These
  are replaced by the shared rule; the unused keys were removed.

**Tables wired with `selectionResetKey`:**

- With select-all (`useMatchingSelection`): Store Orders, Shipping, Sales Orders, Journal Entries,
  every `MasterDataPage` table (Customers `/sales/customers`, CRM Leads, other master-data lists).
- `selectionResetKey={listFilters}`: Products (incl. the include-archived toggle), Sales invoices /
  quotations / returns / payments, Purchase orders / quotations / invoices / returns / payments.
- Explicit keys: Inventory movements (date range, products, warehouses, type, reference), Physical
  count (date range).
- Store Orders › Needs review already clears its selection whenever the job or view changes.

Every other `EnterpriseDataTable` still gets clearing on its own search, column-filter and sort
changes.

## 3a. Bulk limits

Server caps live in ONE place, `apps/api/src/common/bulk/bulk-limits.ts` (`BULK_LIMITS`), read by the
DTO validators and every `/ids` endpoint; the web mirrors them in `apps/web/src/lib/bulk-limits.ts`.

| Limit                         | Value  | Enforced by                                                                                           |
| ----------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| `selectIdsMax`                | 10,000 | store orders, leads, shipments, journal entries, sales orders, master-data `/ids`; `BulkSelectionDto` |
| `bulkArchiveMax`              | 10,000 | `BulkIdsDto` (all bulk-archive endpoints)                                                             |
| `shipmentBulkUpdateMax`       | 1,000  | `BulkUpdateShipmentsDto` (`POST /shipping/bulk-update`)                                               |
| `storeOrderShippingStatusMax` | 1,000  | `BulkSetShippingStatusDto` (`POST /shipping/bulk-status`)                                             |
| `leadStatusChangeMax`         | 5,000  | `BulkChangeLeadStatusDto` (`POST /leads/bulk-status`)                                                 |

Before opening/submitting, the action checks the selected count with `useBulkLimitGuard()` and, when
over, shows the localized `table.bulkLimitExceeded` error ("{count} records are selected, but this
action accepts at most {limit} at a time…") instead of calling the API: Store Orders › Change
shipping status (on open and on submit), Shipping › bulk status update, Leads › bulk status. Bulk
archive limits equal the select-all cap, so they cannot be exceeded.

## 3b. Server: select-all uses the list's exact filter

`GET /store-orders/ids` previously ignored `costState` / `lossMaking`, so "select all matching" under
a loss-making filter selected every scoped order (and bulk shipping-status would change them all).
Now `StoreOrdersController.findAllIds` resolves `includeProfitability` exactly like `findAll`
(`resolveIncludeProfitability`, `orders.profitability.view`), and `StoreOrdersService.findAllIds`
uses the same `buildScopedFindWhere`, `buildFindOrderBy` and the ONE shared
`profitabilityFilteredIds` filter as the list, returning `total` = the filtered count and
`profitabilityFilterCapped`. Jest: `store-order-findall-profitability.spec.ts` (ids = list set under
lossMaking/costState, limit, unauthorized ignores filters) and
`store-orders.controller.findall-profitability.spec.ts` (permission decision passed to `findAllIds`).

## 4. Bulk-action permissions (unchanged)

No permission check was added, removed or widened. The UI gates are convenience hides only; the API
enforces the real checks.

| Table                 | Action                 | Gate                                                                                                                                                                            |
| --------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store Orders          | Page access            | `PermissionGate permission="store-orders.view"` (`store-orders/page.tsx`, default export)                                                                                       |
| Store Orders          | Change shipping status | `canBulkShipping = hasPermission("shipping.manage")` → `StoreOrdersBulkActions canChangeShippingStatus`                                                                         |
| Store Orders          | Print / Export         | Ungated. Acts on every selected id: `resolveSelectedItems` fetches rows not loaded yet and stops with `table.bulkRowsUnavailable` if any are missing (never a partial printout) |
| MasterDataPage tables | Bulk archive           | `canArchive = !disableArchiveRestore && hasPermission(`${permissionPrefix}.archive`)` (`master-data-page.tsx`)                                                                  |
| Customers             | Page access            | `PermissionGate permission="partners.view"`; `permissionPrefix="partners"`                                                                                                      |
| Leads                 | Assign                 | `canAssign` gate in `extraBulkActions` (`crm/leads/page.tsx`)                                                                                                                   |
| Leads                 | Bulk status / Export   | Unchanged                                                                                                                                                                       |

## 5. Table surfaces and row states

**Tokens** (`app/globals.css`, `:root` / `.dark`; the `@theme` color aliases were added with them):

| Token                              | Light                        | Dark                                  |
| ---------------------------------- | ---------------------------- | ------------------------------------- |
| `--table-surface` (new)            | `var(--card)` = #ffffff      | `var(--card)` = #111111 (never white) |
| `--table-divider` (new)            | #e8e8e8                      | #242424                               |
| `--table-header`                   | #f7f7f7 (was #fafafa)        | #0c0c0c (was #0d0d0d)                 |
| `--table-header-foreground`        | #5c5c5c (was #666)           | #a1a1a1                               |
| `--table-row-hover`                | #f4f4f4 (was #fafafa)        | #1b1b1b (was #161616)                 |
| `--table-row-selected`             | 7% #0072f5 on white (was 6%) | 13% #52a8ff on #111 (was 12%)         |
| `--table-row-selected-hover` (new) | 11% #0072f5 on white         | 18% #52a8ff on #111                   |

`node scripts/design/contrast-check.mjs` passes in both themes. Table header text is 6.24:1 light /
7.57:1 dark; selected-row text is 16.46:1 / 13.74:1.

**Surfaces.** `ListSurface` and pinned body cells use `bg-table-surface`. Body cells and `TableRow`
use `border-table-divider`, so dividers are hairlines a step firmer than surface borders.

**Row states** (recipe in `theme/recipes.css` → "Tables: row states"):

- **Painted on cells.** Fills are painted on the cells, so pinned and sticky cells always match their
  row.
- **Hover.** Only `data-interactive` rows get the hover fill and `cursor-pointer`. `TableRow` sets
  `data-interactive` from `interactive`, which defaults to "has an `onClick`". In
  `EnterpriseDataTable` a row is interactive only when it navigates (`getRowHref` and not
  `identityOnlyNavigation`). Non-interactive rows get no hover emphasis. A row whose menu or expander
  is open keeps the hover fill.
- **Selected.** `data-state="selected"`: brand tint plus a 2px start-edge marker, so selection reads
  without colour; the marker flips in RTL. Selected plus hover deepens the tint.
- **Keyboard focus.** `:has(:focus-visible)` draws a 2px inset focus outline around the row. This is
  independent of hover and selection.
- **No layout shift.** States change colour, box-shadow and outline only, never border width or
  size. Rows stay compact (36px, `--table-row-height`).

## 6. Open points

- **Cost Explorer rows.** `app/(shell)/expenses/cost-explorer/page.tsx` passes `onClick` to every
  row, so all rows now show the pointer and hover. Only rows in the ORDER dimension navigate; that
  page should pass `interactive={dimension === "ORDER"}`.
