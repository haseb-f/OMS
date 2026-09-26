# UI-01 — Select/search control inventory (baseline a247d4a)

Source: read-only Explore pass over `apps/web/src`, 2026-09-26. Counts are at baseline.

| Category                                                 | Baseline count                                                                                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Direct `ui/select` usages                                | 105 in 54 files (≈15 list filters, ≈50 long/dynamic lists, ≈40 short enums OK) + ≈40 long-entity `MasterDataForm` `type:"select"` configs |
| Hand-rolled search / datalist / native select            | 0 (SearchInput already universal)                                                                                                         |
| Local picker wrappers / inline EntityCombobox duplicates | 1 (`EntitySearchPicker`, bank-transactions) / ≈20 (employee ×7, currency ×4, partner ×2, tax, investor)                                   |
| Async pickers without `cachedLookup`                     | 11 call sites + 2 service helpers (only Partner/Product cached)                                                                           |
| Whole-list fetches bypassing `use-reference-data`        | 9                                                                                                                                         |
| Missing "Create new" where quick-create exists           | 8 (category ×2, supplier ×5, kit product)                                                                                                 |
| Fixed-width / patched triggers                           | 22 fixed widths, 3 style patches (`h-8`, transparent), 12 unsized `w-fit` triggers in forms                                               |
| Unlabeled triggers                                       | 0 of 105 had `id`/`aria-label`; ≈37 had no visible label; `MasterDataForm` FormControl mis-wired                                          |
| `toLowerCase` instead of Arabic normalization            | 2 shared filters + 5 page-level                                                                                                           |
| Selected value lost / shown as id / capped list          | ≈14                                                                                                                                       |

## Top findings

1. `MasterDataForm` `type:"select"` rendered long lists unsearchable; label not attached to the trigger.
2. No select trigger had an accessible name.
3. Bank transactions `EntitySearchPicker` displayed a UUID, never cleared parent state, filtered EXPENSE accounts client-side after 20 rows.
4. Product create/edit forms: 11 raw selects for supplier/warehouse/category/brand/unit/tax/cost center; category create inconsistent.
5. No EmployeePicker; 7 inline copies + 4 raw selects of employees/users, uncached.
6. Capped lists passed as `items` (JE editor 200 accounts, opening balances 500, kit products 200, physical count 500 products).
7. 15 list filters on raw `Select` with fixed widths.
8. Duplicate lookups (payment sources ×3, eligible assignees ×2, currencies/taxes/warehouses/suppliers direct).
9. Missing create on supplier/partner/category selectors.
10. Page-level trigger patches (`shipment-quick-edit-cells`, mobile `h-10`, `min-w-[10rem]`, `mt-2`).

Per-file detail was delegated to implementers UI-03a/b/c (see tasks.md).
