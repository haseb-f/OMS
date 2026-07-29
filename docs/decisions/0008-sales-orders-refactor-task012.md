# ADR-0008: Sales Orders Refactor (pre-Payment Verification)

Date: 2026-07-29
Status: Accepted

## Context

TASK-012 required six specific changes to the Sales Orders module (ADR-0007) before
building the Payment Verification module, and required the design document to be
updated with the approved decisions before any code was written (same discipline as
TASK-011). This ADR records the implementation choices the six decisions left open.

## Decisions

**`SalesOrderItem` → `OrderItem`, table `sales_order_items` → `order_items`.** A
straight rename (Prisma generated `DROP`/`ADD` rather than `RENAME`, safe since the
table was empty). The relation field name on `SalesOrder` stayed `items` — only the
underlying model/table name changed, so `sales-orders.service.ts`'s nested
`items: { create: [...] }` needed no changes at all.

**`Shipment.status` (`ShipmentStatus`) is separate from `SalesOrder.status`
(`SalesOrderStatus`).** They're deliberately two different enums for two different
scopes: `SalesOrderStatus` tracks the _order's_ overall stage (one value at a time);
`ShipmentStatus` tracks _that specific shipment attempt's_ progress — necessary once
`RETURN_BEFORE_DELIVERY`/`RETURN_AFTER_DELIVERY` (decision #6) needed to attach to a
specific attempt, not the order as a whole (an order with two shipment attempts could
have one attempt returned-after-delivery and a later one returned-before-delivery,
demonstrated live in testing — the order-level status can't hold both).

**Label is stored two ways, not one.** `Shipment.labelUrl` (decision #2, a direct
field) is set every time "Upload Shipping Label" is called, always reflecting the
_current_ label. The existing `SalesOrderAttachment` (tagged `SHIPPING_LABEL`, linked
via `shipmentId`) is _also_ still created every time, preserving every label ever
uploaded — including for earlier, superseded shipments after a reship. Removing the
attachment mechanism in favor of the new field alone would have silently dropped that
history.

**"Upload Shipping Label" now performs three things in one transaction**: sets
`Shipment.labelUrl` + `Shipment.status = LABEL_CREATED`, creates the attachment, and
transitions `SalesOrder.status = LABEL_CREATED` (with its `StatusHistory` row). This
is the first operation that touches both status-history mechanisms
(`SalesOrderStatusHistory` for the order, `Shipment.status` for the attempt) in a
single call.

**`Create Reshipment` now transitions the order to `READY_FOR_SHIPPING`, not
`SHIPPED`** (a change from ADR-0007's original behavior). With `LABEL_CREATED` now a
required stage between `READY_FOR_SHIPPING` and `SHIPPED`, a fresh `Shipment` row
(new attempt, no label/tracking/company yet) can't honestly be called `SHIPPED` the
moment it's created — it needs to go through label creation again first, same as the
original attempt did.

**`Return Order`'s before/after-delivery classification is inferred, not asked for.**
`ShipmentsService.markReturned()` checks the current shipment's own `status`
immediately before overwriting it: `DELIVERED` → `RETURN_AFTER_DELIVERY`, anything
else → `RETURN_BEFORE_DELIVERY`. The caller (and the API) never needs to state which
one applies — the system already has that fact. Verified with two shipments on the
same order producing different classifications (one delivered-then-returned, one
shipped-but-not-delivered-then-returned).

**`packedById` and `handedToShippingById` are schema-only in this phase.** Decision #4
says "SalesOrder must support" these fields — read as a schema requirement, not a
mandate to invent two new business operations ("Mark Packed", "Hand To Shipping")
that weren't in either task's required-operations list. `createdById` and
`paymentVerifiedById` _are_ populated (the former via direct DTO input, the latter via
an automatic snapshot from the Lead's verified Payment) because both had a clear,
already-existing point in the flow to populate them; the other two don't yet.

**`createdById` is a real FK relation, distinct from the generic `created_by` audit
column.** Every table already has an unenforced `created_by`/`updated_by` pair per
ADR-0002 (nullable, no FK, never populated — no auth exists). `SalesOrder.createdById`
is a second, separate, _enforced_ FK to `User` — because decision #4 singled it out by
name alongside three other named operational-user fields, giving it explicit business
meaning this generic audit column doesn't carry.

## Consequences

- Any future task adding "Mark Packed" / "Hand To Shipping" operations has the schema
  ready and just needs the service methods + endpoints.
- `Shipment` attempts now form a genuine numbered sequence (`attemptNumber`), so
  reporting on "how many reships did this order need" no longer depends on counting
  rows or trusting `createdAt` ordering.
- The Payment Verification module (ADR-0009) depends directly on
  `SalesOrder.paymentVerifiedById` existing — this refactor was a prerequisite for it,
  not an independent change.
