# ADR-0007: Sales Orders Phase 2 — Core Implementation

Date: 2026-07-29
Status: Accepted

## Context

TASK-011 approved 15 specific business decisions for the Sales Orders core module
(see `docs/blueprints/sales-orders-phase1-design.md`, updated with those decisions
before this schema was written, per that task's explicit instruction). This ADR
records the implementation choices made while turning those decisions into code —
places where a decision left room for a specific technical shape.

## Decisions

**`ShippingCompany` added as Reference Data**, not scoped to Sales Orders — same
shape as `Warehouse` (code/name/description, full CRUD), consistent with the other 9
reference-data entities from ADR-0003. Required by decision #2; created now rather
than as a separate task since Sales Orders can't function without it.

**`SalesOrderStatusHistory` omits `updated_at`/`updated_by`/`deleted_at` entirely** —
the one deliberate deviation from ADR-0002's "every table gets this shape" rule.
Enforced by the service layer simply never defining update/delete methods for this
table (no DB trigger) — matches decision #1's "never update, never delete" literally,
rather than having unused columns that contradict it.

**"Current shipment" resolution**: operations that touch shipment-level data (Assign
Shipping Company, Add Tracking Number, Upload Shipping Label, Add Shipping Cost) all
act on the most-recently-created `Shipment` for the order (`ORDER BY created_at DESC
LIMIT 1`), created on demand if none exists yet. `Create Reshipment` always creates a
brand new row, which then becomes "current" for anything that follows. This is a
single, uniform rule — no separate "is this shipment closed" bookkeeping — and it's
what makes reshipping transparently pick up a fresh `Shipment` without any of the
four operations needing to know whether a reship happened.

**`Create Reshipment` requires the order to currently be `RETURNED`.** Decision #3
(returns allowed before/during/after delivery) is about _when a return can happen_,
not _when a reship can happen_ — reshipping something that was never returned doesn't
make sense, so this precondition was added, by the same reasoning `Create Order From
Paid Lead` requires the Lead to be `PAID`. `Return Order` itself has no status
precondition (decision #3, implemented literally: `returnOrder()` never checks the
current status).

**No `RESHIP` status value.** The approved decisions don't introduce one — "Create
Reshipment" is an action that creates a `Shipment` row and moves `SalesOrder.status`
back to `SHIPPED`, distinguishable from the original shipment via `Shipment.isReship`
and the timeline/status-history metadata, not via a distinct order-level status.

**"Active" checks apply to Shipping Employee and Shipping Company, not to Country/
Currency/CostCenter/Project/PaymentMethod/Warehouse at order creation.** Same
reasoning as CRM Phase 2's active-sales-employee check: a soft-deleted row still
satisfies a raw FK constraint, so "active" has to be checked explicitly wherever it
matters. It was extended to `ShippingCompany` for the same reason (newly introduced,
directly assignable, could be deactivated) but not to the other six order-creation
references, which rely on the existing FK-constraint-violation → 400 pattern (no
established "active" requirement was stated for those).

**Business operations only — no generic CRUD create/update/delete for `SalesOrder`.**
Creation is exclusively "Create Order From Paid Lead" (validates the Lead exists and
is `PAID`). There is no `PATCH /sales-orders/:id` — every mutation is one of the 13
named operations. There is no delete/cancel endpoint — not in the required operations
list; decision #14 ("never physically delete") restates the existing workspace-wide
soft-delete convention, it doesn't imply a cancel operation must exist yet.
`SalesOrderNote` and `SalesOrderAttachment` are create + list only in this phase (no
update/delete) — narrower than `LeadNote`'s full CRUD in CRM Phase 1, since no
edit/remove operation was in the required list here.

**Pricing snapshot lives on `SalesOrderItem`, not `SalesOrder`.** Decision #5 says
"every Sales Order stores" unit price/quantity/discount/offer, but these vary per
product line — they were placed on the item, matching where quantity already had to
live for "multiple products in one order" (a Phase 1 requirement). No computed line
total or order total was added — not requested, and would require deciding a discount
calculation method (percentage vs. fixed) that wasn't specified.

**Snapshot fields (customer name/phone/country/city/address, decision #13) plus
currency and sales employee are copied onto `SalesOrder`'s own columns at creation,
never re-read through the `leadId` relation.** Currency and sales employee aren't
explicitly listed in decision #13, but the same reasoning applies (Sales Orders
Phase 1 design, §0) and there's no other point where they'd be captured.

## Consequences

- Every shipment-level operation is safe to call in any order (assign company before
  or after ready-for-shipping, tracking number before or after label upload, etc.) —
  the get-or-create-current rule doesn't enforce a sequence.
- `SalesOrderActivityType` has 14 known values; still a plain string column, so more
  can be added later without a migration, same as `LeadActivityType`.
- Adding/removing `SalesOrderItem` rows after creation, editing/removing notes and
  attachments, and a cancel/delete operation for `SalesOrder` are all Phase 3
  candidates — none exist because none were in the required operations list.
- Inventory deduction, accounting entries, invoicing, reporting, dashboard, payment
  reconciliation, and warehouse stock movement remain entirely unimplemented, as
  explicitly excluded.
