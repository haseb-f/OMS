# ADR-0017: Cost Accounting Engine — Milestone 1 (Landed Cost, Valuation Completion, Cost Explorer)

Date: 2026-09-15
Status: Accepted

## Context

The user's M1 brief asks for a from-scratch-sounding "accounting-grade Cost
Engine" (cost classification, landed cost, moving-average valuation, COGS,
returns/adjustments, a Posting Engine, a Cost Explorer). Phase A of that brief
is a mandatory architecture audit before writing any schema/code, explicitly
warning not to blindly implement the conceptual model if equivalent
infrastructure already exists.

It does. A working perpetual-inventory costing and posting engine already
ships in this codebase, built across earlier undocumented tasks (code
comments reference "TASK-046/047") after ADR-0016 and never given its own
ADR. **M1 is a completion and extension of that engine, not a greenfield
build.** This ADR records the audit findings, the resulting constitution, and
the specific gap M1 must close.

### What already exists (verified by direct code read, not the stale ADR-0014/0015 text)

- **`CostComponent`** (`cost_components`) — Master Data entity (code/name/
  description/isActive/audit), permission-gated CRUD + activity log, but code
  is a plain `@unique` string, not `NumberingEngineService`-generated, and has
  no `accountingClass`/`capitalizable`/`allocationBasis`/`defaultAccountId`
  fields yet (`schema.prisma:3146-3163`).
- **`CostAllocationRule`** (`schema.prisma:3198-3216`) + **`CostAllocationMethod`**
  enum (`BY_QUANTITY | BY_COST | EQUAL | MANUAL`, `schema.prisma:3188-3193`) —
  schema only, zero service/controller/calculation logic anywhere.
- **`ProductCostHistory`** (append-only) / **`ProductCostSnapshot`** (one row
  per product, updated in place) / `Product.currentCost` + `lastCostUpdate`
  (`schema.prisma:3218-3261`) — live and written today, but only from one
  place (see below).
- **`InventoryValuationService`** (`accounting/inventory-valuation/inventory-valuation.service.ts`)
  — "the ONLY place that knows how a product's inventory cost is calculated."
  `applyPurchaseReceipt()` already implements the exact moving-weighted-average
  formula M1 asks for: `newCost = (qtyBefore×prevCost + receivedQty×unitCost) / (qtyBefore+receivedQty)`,
  and writes `Product.currentCost` + `ProductCostSnapshot` + a
  `ProductCostHistory` row in the same call. `getUnitCost()` just reads
  `Product.currentCost` (0 fallback) — sales never move the average, which is
  correct.
- **`PostingEngineService`** (`accounting/posting-engine/`) — the one canonical
  place any business document becomes a `JournalEntry`. Self-registering
  Provider pattern (`registerProvider()`), `post(sourceType, sourceId, userId, tx)`
  → `buildEntries()` → `assertBalanced()` → `assertPartnersRequired()` →
  fiscal-period gating → numbered `JournalEntry` + lines. `reverse()` posts a
  swapped-line reversal linked via `reversalOfEntryId`, never deletes or
  mutates a posted entry. Ten providers already registered, including
  `PurchaseInvoicePostingProvider` and `SalesInvoicePostingProvider`.
- **`AccountMappingService`** — the single resolver every provider must call
  (never read mapping tables directly). Layered fallback per concern (e.g.
  `resolveInventoryAccount`: `ProductCategory.inventoryAccountId` →
  `PostingSettings.inventoryAccountId` → throws a named, actionable
  "configuration missing" error). This is the exact "fail safely, never
  fabricate an account" pattern M1 wants — extend it for landed-cost accounts,
  don't parallel it.
- **`PurchaseInvoicesService.confirm()`** already does, in one transaction:
  `inventoryService.postPurchaseReceipt()` (physical `InventoryMovement`,
  `PURCHASE_RECEIPT`) → `InventoryValuationService.applyPurchaseReceipt()`
  (moving average) → `postingEngine.post('PURCHASE_INVOICE', ...)` (Dr
  Inventory net-of-VAT / Cr AP, Dr VAT Input separately — VAT already
  correctly excluded from capitalized cost). **Only `unitPrice` is
  capitalized — no landed-cost capitalization path exists anywhere.**
- **`SalesInvoicesService.confirm()`** (B2B Quotation→Order→Invoice pipeline)
  symmetrically does: `inventoryService.postSalesDelivery()` (physical
  `InventoryMovement`, `SALES_DELIVERY`) → `postingEngine.post('SALES_INVOICE', ...)`
  (Dr AR/Cr Revenue/Cr VAT Output, **and** Dr COGS / Cr Inventory using
  `getUnitCost() × quantity`, immediately snapshotted onto
  `SalesInvoiceItem.unitCost` so a later Sales Return reverses the exact
  historical amount, never today's average — this already satisfies Rule 4).
- **`StoreOrdersService.generateInvoice()`** (the live e-commerce / Leads-
  conversion pipeline — the one nearly all recent work in this session
  targets) is a manual, explicit business action, only callable once
  `paymentStatus === FULLY_PAID_RECONCILED`, that creates a `SalesInvoice`
  (`storeOrderId`-linked) and posts it through the identical
  `postingEngine.post('SALES_INVOICE', ...)` / `SalesInvoicePostingProvider`
  — so **COGS recognition is already unified across both sales pipelines**;
  there is no "which pipeline" ambiguity to resolve. But `generateInvoice()`
  **does not call `inventoryService.postSalesDelivery()`** the way
  `SalesInvoicesService.confirm()` does — confirmed by direct read of
  `store-orders.service.ts:1310-1400`, no `postSalesDelivery`/`InventoryMovement`
  call anywhere in the method. This is the one real, confirmed defect: every
  Store Order invoice ever generated has correctly reduced the GL Inventory
  balance and posted COGS, but has **never** reduced the physical
  `InventoryMovement`-derived on-hand quantity. GL Inventory value and the
  physical stock ledger have been silently diverging for every Store Order
  sale since this feature shipped.
- **Investor Engine** already computes its own `cogs` on `ProfitCalculation`,
  but from `OpportunityProduct.fundedUnitCost` — a manually-negotiated,
  legally-locked funding price captured per Opportunity, deliberately
  independent of `Product.currentCost` (schema comment: "Product master-data
  changes later must never silently rewrite historical investment terms").
  Zero references to `ProductCostSnapshot`/`Product.currentCost` anywhere in
  the Investor module. This is a second, intentionally separate "cogs"
  concept — M1 must not conflate or rename it.
- **No Decimal/Money library exists anywhere in the API.** The universal
  convention is plain JS `number` + a shared `round2()` helper
  (`sales/shared/sales-totals.util.ts`), applied at each computed field; every
  service converts Prisma `Decimal` columns to `Number()` on read. The
  spec's "reuse the canonical Money/Decimal architecture" premise doesn't
  hold — no such architecture exists to reuse.
- **No multi-currency exchange-rate infrastructure exists anywhere** (no
  `exchangeRate`/`baseAmount` field on Purchase/Sales Invoices or Orders) —
  confirmed by two independent audits. Not a costing-specific gap; a
  system-wide one.
- **Tax has no recoverable/non-recoverable flag.** Every `Tax` with an
  `inputAccountId` configured is implicitly treated as fully recoverable
  (routed to VAT Input, never capitalized) — which happens to already satisfy
  Rule 9 by construction, no new field is strictly required for M1.
- **The existing "Costs" surface is not a manual CRUD page** as the brief
  assumed. It's `/expenses/cost-components` (CostComponent master list) and
  `/expenses/product-cost` (the manual `POST /product-cost/:productId`
  cost-entry UI, permission-gated separately from the automatic engine), plus
  an unrelated `/finance/cost-centers` (a Journal Entry dimension, not
  inventory costing). No Cost Explorer/ledger/dashboard exists — genuine gap.
- **Negative inventory is already fully blocked** at every outbound movement
  path (`quantityAfter < 0` guard) — no new policy needed, just preserve it.
- **`Product`, never `ProductVariant`, is the sole stock-keeping/costing
  unit** — variants are a display/attribute bag with zero relation to
  `InventoryMovement` or cost.

## Decisions

**Recognition events are already correct and unified — reuse them, don't
re-derive them.** Purchase-side cost input = `PurchaseInvoicesService.confirm()`.
Sales-side COGS recognition = confirming/generating a `SalesInvoice`,
regardless of which pipeline produced it (B2B `SalesInvoicesService.confirm()`
or Store Order's `generateInvoice()`). M1 adds Landed Cost as a new
capitalization step feeding the same `InventoryValuationService`, not a new
recognition event.

**Fix `StoreOrdersService.generateInvoice()` to call
`inventoryService.postSalesDelivery()`, mirroring `SalesInvoicesService.confirm()`
exactly.** This is the one confirmed, unambiguous bug M1 must close — going
forward every Store Order invoice will correctly decrement physical stock the
same way a B2B invoice already does. This is additive and low-risk for new
invoices. It does **not** retroactively fix historical Store Order invoices
already generated in Production — those already reduced GL Inventory value
without ever reducing physical `InventoryMovement` quantity, so Production's
current on-hand quantities are almost certainly overstated relative to true
stock by however many Store Order invoices have been generated to date. Per
Section 53-54 (no silent historical backfill), M1 will produce a **read-only
count/report** of affected historical `SalesInvoice` rows (`storeOrderId IS
NOT NULL`) with their un-recorded quantities, and stop there — reconciling
Production's actual stock is a decision for the user (e.g. via a Physical
Count) explicitly out of M1's own scope, never silently backfilled.

**Extend `CostComponent`/`CostAllocationRule` rather than adding parallel
models.** `CostComponent` gains `accountingClass` (the M1 spec's
INVENTORY_ACQUISITION/COGS/FULFILLMENT/TRANSACTION/OPERATING_EXPENSE/OTHER —
the accounting-behavior enum, separate from the user-editable Arabic/English
label per the spec's own "renaming a label must not change accounting
treatment" rule), `capitalizable` (boolean), and `defaultAccountId` (nullable
FK, `AccountMappingService`-resolved fallback chain, never hardcoded).
`code` becomes `NumberingEngineService`-generated for new rows, matching
every other Master Data entity built since (existing rows keep their manual
codes). `CostAllocationRule.method` keeps the existing enum values —
`BY_COST` **is** the spec's "BY_PURCHASE_VALUE" (same semantics, existing
name kept to avoid a parallel enum); `BY_QUANTITY` matches directly;
`BY_WEIGHT`/`BY_VOLUME` are deferred (Product does have weight/dimension
fields per ADR-0012, so they're feasible later, but M1 only needs quantity
and value allocation).

**New: a Landed Cost Document model** (none exists today) —
`LandedCostDocument` (reference/date/currency/supplier/status
DRAFT→APPROVED→POSTED→CANCELLED mirroring `JournalEntryStatus`'s
never-mutate-after-posted convention) with `LandedCostLine`
(costComponentId, amount net of recoverable VAT, allocation method) and
`LandedCostAllocation` (per Purchase Invoice line: allocated amount,
reconciling exactly to the line's total — no lost cents, deterministic
largest-remainder rounding). Posts through a new
`LandedCostPostingProvider` registered on the same `PostingEngineService`
(Dr Inventory / Cr Payable-or-Accrued-Expense, `AccountMappingService`-
resolved), then calls a new `InventoryValuationService.applyLandedCost()`
that adds the allocated amount to _current_ inventory value and recomputes
the moving average over _current_ on-hand quantity (not the original receipt
quantity, since some may have already sold) — the standard practical
handling for landed cost arriving after the original receipt already
averaged in without it.

**Money arithmetic: scoped deviation, not a rewrite.** The spec's Rule 13
("never floating-point money arithmetic") is real risk for a _repeated_
weighted-average recomputation (compounding rounding across many receipts),
unlike a single invoice total. New M1 calculation code (moving-average
recompute, landed-cost allocation) will use deterministic fixed-point integer
arithmetic (work in minor units / halalas, never binary floats) even though
the rest of the codebase uses `number + round2()` — this is a narrow,
additive deviation confined to new code, not a system-wide Decimal-library
migration, and every read/write at the boundary (DB `Decimal` columns,
existing services calling in) stays exactly as-is.

**Multi-currency: explicitly out of scope for M1.** No FX infrastructure
exists anywhere in the system to reuse or extend, and building one is not
what "Cost Accounting Foundation" asked for. Landed Cost documents get a
`currencyId` field (matching the Purchase Invoice's own single-currency
convention) but no exchange-rate conversion; flagged for a future milestone
if/when the system gains real multi-currency support.

**Investor Engine `cogs` stays separate, documented, not merged.** No code
change to `OpportunityProduct.fundedUnitCost`/`ProfitCalculation.cogs` in
M1. This ADR is the documentation the spec asked for: Investor profitability
uses a negotiated, contribution-locked funding price; canonical inventory
COGS uses actual moving-average cost; the two will only be reconciled in a
later, explicitly-scoped milestone.

**Cost Explorer / Product Cost UI extend the existing `/expenses` pages
rather than replacing them wholesale** — `/expenses/cost-components` becomes
the Cost Categories management screen (same entity, new fields), a new
`/expenses/cost-explorer` (or equivalent under the existing Costs nav
section) adds the read-only ledger/dashboard, and `/expenses/product-cost`'s
manual-entry path stays as the explicit, permission-gated exception path
(Rule 13 — manual adjustment is an exception, never the primary mechanism).

**Permissions follow the existing `finance.view` precedent** used for every
other money-movement-sensitive Master Data entity (`masterdata.currencies`,
`purchasing.payments`, `accounting.journal-entries`, ...) — no Sales Agent
gains inventory-valuation or margin visibility merely by holding
`crm.leads.*`/`store-orders.*`. New granular permissions
(`masterdata.cost-components.*`, `landed-cost.manage`, `landed-cost.approve`,
`cost-explorer.view`) follow the catalog's existing key/labelKey/actions
shape and nav-gate map.

## Consequences

Phase B onward extends live schema/services rather than introducing parallel
ones — smaller diff, lower regression risk, and the moving-average/posting
correctness already proven in Production (B2B pipeline) carries over
directly. The cost of this approach is that the one real defect found
(`generateInvoice()` never decrementing physical stock) is now a documented,
public fact about current Production behavior; the historical-quantity
drift it created is explicitly _not_ silently corrected by this milestone.
