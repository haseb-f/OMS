# Implementer brief — UI-03 (select/search call-site migration)

Repo `D:\Systems\OMS`, web app `apps/web/src` (Next.js App Router, Tailwind v4, shadcn/Radix, Arabic RTL default).
Read `specs/system-audit-ui/spec.md` (component policy + AC-UI-1..9) first.

## Shared components (owned by Master — DO NOT EDIT these files)

- `components/ui/select.tsx` — `Select/SelectTrigger/SelectContent/SelectItem`. Default popper, `variant="ghost"` for inline table cells.
- `components/shared/searchable-select.tsx` — `SearchableSelect` (value-string contract like `<Select value onValueChange>`; options `{value,label,description?,searchText?,icon?}`; `allowClear`, `loading`, `createAction`, `selectedLabel`, `variant`, `id`, `aria-label`, `aria-describedby`, `aria-invalid`), `SEARCHABLE_OPTION_THRESHOLD = 7`. Works inside `<FormControl>`.
- `components/shared/entity-combobox.tsx` — object-valued searchable combobox (`items` or async `onSearch`; `createAction` pinned on top; `allowClear`; `loading`; `variant="ghost"`; `id`; `triggerProps` for aria).
- `components/shared/data-table/select-filter.tsx` `SelectFilter` (single list filter, "All" row, `searchable`), `multi-select-filter.tsx`, `multi-entity-filter.tsx`.
- `components/shared/search-input.tsx` `SearchInput`.
- Business pickers (all accept `id` and `aria-label`): `AccountPicker`, `WarehousePicker`, `CostCenterPicker`, `ProjectPicker`, `DepartmentPicker`, `PartnerPicker` (role, has quick-create), `ProductPicker` (has create), `PurchaseInvoicePicker`, `CostCategoryPicker`, NEW `CurrencyPicker` (value string, `valueKey="code"|"id"`), NEW `EmployeePicker` (object value; async cached search or `items`), NEW `UserPicker` (value = user id, from cached `useUsersList`).
- `lib/lookup-cache.ts` `cachedLookup(key, fetcher)` / `invalidateLookups(prefix)`; `hooks/use-reference-data.ts` session-cached lists (useCurrencies, useTaxes, useUnits, useWarehouses, useSuppliers, useUsersList, useEmployees, useJobTitles, usePayrollComponents, useProductCategories, useProductBrands, useAnalyticAccounts, …); `lib/arabic-search.ts` `filterByArabicSearch(items, query, getText)` / `normalizeArabicSearch`.
- `components/master-data/master-data-form.tsx` — `type:"select"` now auto-switches to SearchableSelect when > 7 options or `quickCreate`; `type:"account"` renders AccountPicker (prefer it over a select of accounts).

## Rules

1. Choose per interaction (spec table): short closed enum in a form → keep `Select` (add `id` + `<Label htmlFor>` or `aria-label`, `className="w-full"` in forms); long/dynamic/reference list in a form → `SearchableSelect` or the named business picker; list-page single filter / view switch → `SelectFilter` (drop fixed `w-*`); inline table cell → `variant="ghost"` instead of className patches.
2. Every trigger must have an accessible name: link visible `<Label htmlFor=...>` to trigger `id` (use `useId()`), or `aria-label` using the existing visible label's i18n key.
3. Preserve behavior exactly: value types, validation, permissions (`hasPermission` gates on create), sentinel values (e.g. `__all__` / `"ALL"` → map to SelectFilter's `""` all-state without changing API params), default values, disabled states.
4. Replace whole-list fetches that duplicate a `use-reference-data` hook with the hook. Wrap remote picker searches in `cachedLookup`. Never fetch per table row — prefetch once and pass `items`.
5. Replace `.toLowerCase()` client search with `filterByArabicSearch`/`normalizeArabicSearch`.
6. No page-specific CSS for controls: no fixed `w-40..w-72`, `h-8/h-10`, `min-w-[..]`, `mt-2` on triggers (layout wrappers like grid/flex gap are fine). Use logical properties only.
7. DO NOT edit `apps/web/src/i18n/**` (Master owns it). Reuse existing keys. If a key is truly missing, use the closest existing key and list the desired key in your report.
8. Do not commit, push or deploy. Do not touch files outside your assigned list except to read. If a shared component lacks something you need, do NOT edit it — work around minimally and report the gap.
9. After edits run from `apps/web`: `npx tsc --noEmit` and `npx eslint <your files>`; fix everything in your files. Run `npx vitest run` for any spec next to your files.

## Report back

Files changed with one line each (what control → what component), behavior-preservation notes, any skipped item with reason, i18n keys wanted, shared-component gaps, typecheck/lint output tail.
