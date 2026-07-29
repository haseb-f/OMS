# ADR-0015: Purchasing Phase 1 — Suppliers + Purchase Orders

Date: 2026-07-29
Status: Accepted

## Context

This task builds the first phase of Purchasing: Suppliers and Purchase Orders, under
one governing rule stated up front — "Purchase Order is only an agreement to buy. It
NEVER changes: Inventory, Product Cost, Accounting, Stock." Goods Receipt, Purchase
Invoice, Supplier Payments, Cost Allocation, Accounting, Inventory Transactions, and
Tax are all explicitly out of scope, to be built in later phases against this
foundation.

## Decisions

**Supplier gets named business operations (Create, Update, Archive, Activate,
Search), not plain CRUD** — matching the Lead/SalesOrder/Payment pattern rather than
the Product/CostComponent plain-CRUD pattern used in recent tasks. This task
explicitly names exactly these five operations for Supplier, distinct from how
TASK-011/012/014 asked for "CRUD only."

**"Archive" is soft-delete (`deletedAt`); "Activate" sets `status` back to `ACTIVE`.**
The task lists "Support: Soft Delete, Active/Inactive" as two separate concepts, but
only one archiving-direction verb pair ("Archive"/"Activate") and no "Deactivate."
Read literally: Archive is the standard soft-delete meaning used everywhere else in
this codebase (Lead, Product, ...); Activate is the named shortcut for the common case
of reactivating a supplier, while deactivating (setting `status: INACTIVE`) is just a
field change available through the generic `Update` operation — there's no dedicated
endpoint for it because the task didn't name one. `Activate` logs `SUPPLIER_UPDATED`
(not a new event type), since the Timeline section lists only `SUPPLIER_CREATED`/
`UPDATED`/`ARCHIVED` — no fourth "activated" event exists to log.

**`GET /suppliers/:id` was added despite not appearing in the five named Supplier
operations.** The task's own field list requires updating and archiving a _specific_
supplier, and Purchase Order creation must validate a specific supplier — both are
impossible without a way to fetch one by id. Same reasoning as ADR-0013/0014's
gap-filling reads: "Search" returning a list doesn't substitute for "Details" on a
single record.

**`Supplier.defaultPayableAccountId`/`defaultExpenseAccountId` are nullable columns
only — no FK, no DTO field, no API exposure.** The task explicitly labels both
"(nullable placeholder only)," the same wording pattern as `Product.defaultWarehouseId`
(ADR-0012), which received identical treatment despite `Warehouse` already existing as
a real table. `ChartOfAccount` already exists here too, but the instruction is about
the _field's_ maturity, not the _target table's_ existence.

**Purchase Order's "Preparation For Future" fields (Receiving Warehouse, Price List,
Incoterms, Buyer, Shipping Method, Expected Receipt Date) are schema columns only —
absent from `CreatePurchaseOrderDto` entirely.** "Prepare nullable placeholders only.
DO NOT implement business logic" is the same instruction, and the same treatment,
already established for Product's Future Columns (ADR-0012).

**`PurchaseOrderItem.productId` is a required, real foreign key to `Product`** —
unlike the pre-existing `OrderItem.productId` (nullable, no FK, predating the Product
Engine). This task's own Validation section requires rejecting "Inactive Product" and
"Deleted Product" for line items, which only makes sense if a line item always
references a real, checkable `Product` row. `Product` now fully exists (ADR-0011/0012)
with the `status` field this validation reads directly.

**Only "Negative Quantity" and "Negative Price" are rejected on `PurchaseOrderItem` —
zero is allowed.** This task's Validation section, unlike Inventory's (ADR-0013,
which explicitly separately listed "Zero quantity" as its own rejection case), names
only "Negative Quantity." Read literally, `@Min(0)` was used instead of the stricter
`@Min(1)` seen on the pre-existing `OrderItemInputDto` (a different module with
different, separately-stated rules) — this is a deliberate difference per-task, not an
inconsistency.

**`PurchaseOrderItem.subtotal` is caller-supplied, never computed by the server.**
The existing `OrderItem` (Sales) stores `quantity`/`unitPrice`/`discount` as raw values
with no computed total anywhere in that service — the same convention was followed
here. Storing what the client sends is not "Cost Calculation" (explicitly forbidden);
computing a total from `quantity × unitPrice` minus discounts would still just be
"line-item arithmetic," not costing, but was avoided anyway to match the zero-server-
arithmetic precedent already set for money fields in this codebase.

**Purchase Order status transitions are strictly gated**: `Approve` only from `DRAFT`;
`Cancel` from `DRAFT` or `APPROVED`; `Close` only from `APPROVED`. "Only status
management" was read as requiring _some_ guard rails (a `CLOSED` order can't be
re-cancelled, a `DRAFT` order can't be closed without being approved first) rather than
allowing arbitrary status jumps, while deliberately keeping the rule set minimal — no
inventory, cost, or accounting side effect fires on any transition, verified live: after
`Approve`, the referenced product's on-hand inventory quantity and cost snapshot were
both confirmed unchanged.

**Supplier Number (`SUP-000001`) and PO Number (`PO-000001`) are application-generated
via dedicated Postgres sequences** (`supplier_number_seq`, `purchase_order_number_seq`),
created in their own follow-up migration — the same pattern as every other
auto-numbered entity in this codebase (Lead, SalesOrder, Payment, InventoryMovement).

## Consequences

- Every module this task explicitly forbade (Goods Receipt, Purchase Invoice,
  Supplier Payments, Cost Allocation, Accounting, Inventory Transactions, Tax,
  Reports, Dashboard, Odoo, Ecommerce) was checked against the final schema and code
  — none were touched, and live smoke testing confirmed `Approve` leaves inventory
  and cost completely untouched.
- A future Goods Receipt phase has a `PurchaseOrder`/`PurchaseOrderItem` structure to
  receive against, including a `receivingWarehouseId` placeholder column to eventually
  populate and act on.
- A future Purchase Invoice / Supplier Payment phase can reference `Supplier` and
  `PurchaseOrder` directly; `Supplier.defaultPayableAccountId`/`defaultExpenseAccountId`
  remain undecided placeholders for that phase to wire to real accounting.
- `OrderItem.productId` (Sales) remains the old nullable, no-FK placeholder — this
  task did not touch it; only the new `PurchaseOrderItem.productId` got a real FK.
