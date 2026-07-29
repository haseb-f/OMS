# ADR-0013: Inventory Engine Foundation

Date: 2026-07-29
Status: Accepted

## Context

This task built the movement-based inventory foundation every future module (Sales,
Purchases, Manufacturing, Ecommerce, Accounting) will rely on, while explicitly
forbidding accounting entries, costing (FIFO/LIFO/Average), taxes, purchasing,
suppliers, Odoo/ecommerce integration, reports, dashboards, ecommerce-linked
reservations, barcode printing, and physical counting workflows. The task mandated the
core architectural rule up front: stock quantity must never be manually edited; every
change is an `InventoryMovement`; current quantity is derived from movements.

## Decisions

**`InventoryMovement` is append-only — no `updatedAt`/`updatedBy`/`deletedAt`.** The
task explicitly asked for this decision to be made and documented, not invented
silently. Since current quantity is _derived_ by summing movements for a
product+warehouse, editing or soft-deleting any past movement would silently corrupt
every later movement's `quantityBefore`/`quantityAfter` snapshot for that same
product+warehouse — there is no safe way to mutate movement history without breaking
the ledger's own invariant. This is the same exception already used for
`SalesOrderStatusHistory` (ADR-0007): the table must never be updated or deleted.
`InventoryMovementActivity` (the timeline) keeps full audit columns, matching every
other `*Activity` entity in this codebase — only the ledger itself is append-only.

**`RESERVATION`/`RESERVATION_RELEASE` do not change on-hand quantity.** The task lists
both as movement types alongside physically-moving ones (OPENING_BALANCE, ADJUSTMENT,
TRANSFER, DAMAGE, EXPIRED, ...) but excludes "Reservations linked to ecommerce" and any
picking/fulfillment workflow. Read literally, a reservation in this foundation holds
stock for later use without physically moving it. Both types write
`quantityBefore == quantityAfter` (on-hand unchanged) and use `quantity` as a separate
reserved-ledger delta (`+` for RESERVATION, `-` for RESERVATION_RELEASE). "Current
quantity" therefore means two derived numbers: **on-hand** (sum of all non-reservation
movements) and **reserved** (sum of the two reservation types) — `available = onHand -
reserved`. Reserving more than `available`, or releasing more than currently reserved,
is rejected.

**`ASSEMBLY`/`DISASSEMBLY`/`PRODUCTION` exist only as enum values — no endpoints, no
logic.** The task's Business Operations section only names opening-balance,
adjustment, transfer, damage, expired, reserve, and release; it separately states
"Bundle logic is NOT part of this task" and forbids "Manufacturing logic." These three
types are schema-level placeholders for a future Bundle/Manufacturing module, the same
treatment already given to `ProductType.BUNDLE` in ADR-0011.

**`Transfer` writes two `InventoryMovement` rows, not one**, because the entity has a
single `warehouseId` column (a movement belongs to one warehouse) — a TRANSFER out of
the source warehouse (negative quantity) and a TRANSFER into the destination (positive
quantity), correlated via a shared generated `referenceId` (`referenceType: 'TRANSFER'`)
so the two sides of the same event can be found together later.

**Inventory eligibility is gated on `Product.isInventoryItem` and `Product.status`,
not on `ProductType` directly.** "Inventory products only. Service and Digital
products must not generate stock" is satisfied because SERVICE/DIGITAL/BUNDLE default
`isInventoryItem` to `false` (ADR-0012) — but the check itself reads the flag, since
that flag is exactly what ADR-0012 introduced to answer "does this product carry
stock," and a manually-overridden non-PHYSICAL product should be treated consistently
with a PHYSICAL one. `Product.status !== ACTIVE` satisfies "Inactive product" from the
Validation section using the field ADR-0011 already established — no new Product field
was added for this.

**`Warehouse` gained `isDefault` (boolean, no enforced single-default constraint),
`warehouseType` (nullable free-text — no closed set of values was specified, same
reasoning as `Product.defaultCostMethod`/`defaultTaxCategory` in ADR-0012), `isActive`
(boolean, satisfies "Inactive warehouse" validation), and `parentWarehouseId` (nullable
self-relation, real FK since `Warehouse` already exists).** The hierarchy field is
"prepared only" per the task's own qualifier — no depth limit, no cycle detection, no
traversal API, no UI. `ProductCategory`/`ProductBrand`/`Unit`/existing `Warehouse`
CRUD were otherwise untouched.

**Movement Number is application-generated via a dedicated Postgres sequence
(`inventory_movement_number_seq`, format `MV-000001`), created in its own follow-up
migration** — exactly the same pattern already used for `lead_number_seq` /
`sales_order_number_seq` / `payment_number_seq`, since Prisma can't declare a raw
sequence as a column default.

**Quantity fields are `Int`, not `Decimal`.** The existing `OrderItem.quantity`
convention in this codebase is `Int`; introducing fractional quantities here (even
though some seeded Units are Kilogram/Liter) would be a new precision decision this
task didn't ask for.

**No generic CRUD exists for `InventoryMovement`.** Only the seven named business
operations create movements (`POST /inventory/{opening-balance, adjustment, transfer,
damage, expired, reserve, release}`); `GET /inventory/movements`,
`GET /inventory/movements/:id`, and `GET /inventory/stock` are read-only and don't
violate "business operations only" — a way to observe the ledger's effects is
necessary to use it at all.

## Consequences

- Every module this task explicitly forbade (Accounting, Costing, Taxes, Purchases,
  Suppliers, Manufacturing logic, Ecommerce, Odoo, Reports, Dashboard, barcode
  printing, physical counting) was checked against the final schema and code — none
  were touched.
- A future Sales/Purchases module can call `reserve`/`release` and read
  `GET /inventory/stock` to check availability before committing an order, without
  this foundation knowing anything about orders.
- A future Costing module has `quantity`/`quantityBefore`/`quantityAfter` per movement
  to build FIFO/LIFO/Average valuation from, but no unit cost is tracked anywhere yet.
- A future Manufacturing/Bundle module has `ASSEMBLY`/`DISASSEMBLY`/`PRODUCTION` to
  select against, but must design and add all consumption/output logic from scratch.
- `Warehouse.isDefault` has no enforced uniqueness — a future task must decide whether
  multiple "default" warehouses should be prevented.
