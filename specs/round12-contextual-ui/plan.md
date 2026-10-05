# Round 12 — compact order entry, unified lookup, agent cards, contextual dropdowns

Branch `feat/r12-contextual-ui` (canonical `D:\Systems\OMS`, based on `main` + the unreleased `feat/r11-entry`) · local review stack web :4701 / API :4705 (DB clone `oms_r7_final`) · **not deployed — awaiting owner visual approval**.

R11 (compact entry, recognition, in-field calling code, order-level delivery, empty money inputs, advanced lookup for order staff) is the base; R12 adds only what was still missing.

## 1. Order entry — country → calling code + currency

- Row 1 of a new customer: **Name → Country → Phone** (calling-code selector inside the phone). Country is the one country field; the delivery country is a separate, explicit "Different delivery country" option.
- `config/orders/country-entry-defaults.ts`: country proposes the calling code (phone-library metadata) and the order currency (`Country.defaultCurrencyId`). Applied only while untouched: a manual calling code / currency is never overwritten; once a number is typed its calling code is pinned; a country with no configured currency leaves the field empty with a hint (asked, never guessed).
- `Country.defaultCurrencyId` already existed (seeded SA/EG/AE/US); it is now exposed, validated and editable in Master data → Countries (API `defaultCurrencyId`, '' clears; unchanged stale value never blocks other edits).
- Existing customer: saved values kept (country, phone reading, address); order-specific delivery lives on the order only. A new customer with a different delivery country does not get the delivery address stored on the master record.
- Agent order form: destination country (tariff) and calling code decoupled; currency stays fixed by the agreement. Lead conversion keeps the lead's saved country / currency.
- Money inputs stay blank with a `0.00` placeholder (R11, unchanged).

## 2. One advanced lookup

- `POST /customer-lookup/advanced` now also accepts an OMS document number (`STO-…`, `LD-…`), returns `previousOrders` (only orders the caller can already open, one scoped query), lists up to 20 rows for exact identifiers (names stay at 5), day in the Cairo calendar. Same audited, rate-limited ledger (`ORDER_NUMBER` method).
- UI: one dialog "بحث متقدم عن عميل" — phone any format / Arabic digits, name, order number; compact paginated table (`ListPager`), rows stack as cards on phones, truthful loading / empty / validation / 403 / 429 / error states. Legacy "Search by phone/order number" dialog + button removed (its order-number capability lives here; "new order for this customer" is the recognition flow in the create form). The empty-search fallback link carries the same label.
- Role grants: the R11 migration grants `customers.lookup_advanced` to internal order staff (verified on the clone with ordinary Sales personas); **Production grant still needs owner approval**.

## 3. Agent screens

`InsightSurface` extracted from `InsightCard`; `SummaryCard` (agent statement, commission report, portal statement) uses it with tone + icon; agent overview and portal statement headline figures are `InsightCard`s (`InsightCardSkeleton` for loading). Visibility unchanged.

## 4. Dropdown surfaces

`ControlSurface` (`toolbar` default | `form`) → `data-surface` on `SelectTrigger` / `EnterpriseButton variant="field"`; recipe in `theme/recipes.css` re-points only the `--selector*` tokens (light and dark). Providers: `DialogContent`, `SheetContent`, `Form`, `EditorWorkspace`, `PageWorkspace controlSurface="form"` (+ accounting settings, KPI template form, inline carrier cell); `ListToolbar` / `SelectorRow` restore `toolbar`. Audit: `scripts/acceptance/r12/dropdown-audit.mjs` (135 routes).

## 5. Decisions / limits

- A page-level selector outside a toolbar / form (cost explorer product pickers, fiscal-year pickers, exchange-rate currency pickers, funnel date range) stays `toolbar` — they are filters.
- Order-number discovery uses sequential numbers: bounded by the shared 15 / 10 min and 100 / day budget and masked output; a tighter budget is an owner option.
- `StoreOrderCreateDialog`'s `prefillCustomer` prop is no longer used by any caller (kept, harmless).
- Windows desktops render the calling-code flag as letters (`SA`); phones show the flag.
