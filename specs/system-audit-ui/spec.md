# Spec — System Audit & Guide + Search/Dropdown Refactor

Milestone: `system-audit-ui` · Started 2026-09-26 · Baseline `a247d4a` (HEAD = origin/main = Production)

## Problem

1. The Arabic user guide (`docs/user-guide/`) is built largely on API tours and page-load sweeps. Several
   modules (HR, purchasing/investors as their own persona, settings, inventory dialogs) were never
   exercised as real UI journeys, and statuses are not uniform.
2. Selection and search controls are mostly shared (`EntityCombobox`, `SearchInput`, `SelectFilter`,
   `ui/select`) but are applied inconsistently: raw Radix `Select` for long dynamic lists, page-level
   class overrides, non-Arabic-aware filtering, missing labels/clear/empty states.

## Scope

- **W1 Audit & guide:** inventory every module/feature/transaction/report; exercise journeys in the
  Production browser as Super Admin and QA personas; record PASS/FAIL/BLOCKED/NOT TESTED with
  evidence; update the Arabic role guides in place with screenshots and demo links.
- **W2 Controls:** audit all search/select/combobox/picker usages; fix at the shared component level;
  migrate call sites to the appropriate shared component.

## Non-goals

- No new business features, no changes to financial rules, no rewrite of existing financial records.
- No global batch jobs (depreciation / prepaid recognition), no real messages, carrier bookings,
  Sheets writes or charges.
- Native `<select>` does not exist today; no new picker library is introduced (shadcn/Radix + cmdk only).

## Component policy (which control for which interaction)

| Interaction                                                               | Shared component                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Short closed enum in a form (≤ 7 options)                                 | `ui/select` (via `SelectField` in RHF forms)                  |
| Long or dynamic list in a form (accounts, currencies, users, warehouses…) | `EntityCombobox` (via business pickers / `ComboboxFormField`) |
| Remote entity search (partners, products, invoices)                       | Business picker over `EntityCombobox` + `cachedLookup`        |
| List-page single-value filter                                             | `SelectFilter`                                                |
| List-page multi-value filter                                              | `MultiSelectFilter` / `MultiEntityFilter`                     |
| Free-text list search                                                     | `SearchInput` (+ `useDebouncedValue` for API)                 |
| Expanded product browsing                                                 | `ProductBrowserDialog` (kept)                                 |

## Acceptance criteria

W2 — controls

- **AC-UI-1** Every select/search control in `apps/web/src` uses one of the shared components above;
  no hand-rolled search field, Command popover or dropdown outside `components/ui|shared|business`.
- **AC-UI-2** Long/dynamic lists (> 7 options or API-backed) are searchable; list-page filters use
  `SelectFilter`/`MultiSelectFilter` with an "All"/clear path.
- **AC-UI-3** Shared triggers share one height token, border, focus ring, icon size; no page-level
  `h-*`/fixed-pixel/physical-direction overrides on select triggers.
- **AC-UI-4** Searching is Arabic-normalized (أ/إ/آ/ا, ة/ه, ى/ي) in every client-side filter.
- **AC-UI-5** Remote pickers debounce (`SEARCH_DEBOUNCE_MS`), dedupe via `cachedLookup`, and ignore stale
  responses; a selected value stays displayed even if not in the current result page.
- **AC-UI-6** Loading, empty, no-match and error states render in pickers; clear/reset available where
  the field is optional; "Create new" pinned at the top where a quick-create exists and permission allows.
- **AC-UI-7** Every trigger has an accessible name; keyboard: open with Enter/Space/ArrowDown,
  arrows to move, Enter to select, Escape to close.
- **AC-UI-8** Visually verified light/dark × ar/en × phone(390)/tablet(820)/desktop(1440) on
  representative pages: no clipping, overlap or horizontal scroll; popovers fit the viewport.
- **AC-UI-9** Existing filtering, permissions, validation and selected values are preserved (tests green).

W1 — audit & guide

- **AC-AUD-1** Every sidebar module/feature appears in `coverage.md` with PASS/FAIL/BLOCKED/NOT TESTED and
  evidence (report path, screenshot, record link); local vs Production evidence distinguished.
- **AC-AUD-2** Required journeys are exercised through the Production UI (not page loads/API only):
  sales, store orders, shipping, purchasing, inventory, finance journal + reports, CRM, HR, investors,
  per-persona permissions.
- **AC-AUD-3** Role guides (`roles/*.md`) explain each tab's purpose/when to use, tasks (prerequisites,
  numbered steps, expected result), transaction stages/owner/downstream effects, reports (purpose,
  filters, interpretation), common errors and recovery.
- **AC-AUD-4** Screenshots for key steps are captured after the W2 deploy and indexed.
- **AC-AUD-5** Tagged demo records (`DEMO-AUDIT-20260926`) are listed with direct links in `demo-records.md`.
- **AC-AUD-6** Defects found are fixed within scope or listed in `issues.md` with status.

Release

- **AC-REL-1** typecheck, lint, tests, production build pass; HEAD = origin/main = Production SHA verified.
