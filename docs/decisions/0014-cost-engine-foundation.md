# ADR-0014: Cost Engine Foundation

Date: 2026-07-29
Status: Accepted

## Context

This task builds the architecture a future Purchasing module will drive to calculate
and update product cost, while explicitly forbidding any actual valuation logic:
no FIFO/LIFO/Average, no cost allocation/distribution calculation, no accounting
journal entries, no purchasing, no supplier invoices, no reports, no dashboards, no
taxes, no ecommerce. "The platform must know how product cost is built. Cost
calculation itself will come later after Purchasing. This task only prepares the
complete architecture."

## Decisions

**`ProductCostHistory` is append-only — no `updatedAt`/`updatedBy`/`deletedAt`.**
"Never overwrite history" is explicit in the task text. Same reasoning and precedent
as `InventoryMovement` (ADR-0013) and `SalesOrderStatusHistory` (ADR-0007): a ledger
that can be edited or soft-deleted after the fact is not a reliable history.

**`ProductCostSnapshot` is the opposite: a single mutable row per product, enforced
by a unique `productId`.** "Maintain current product cost. One active snapshot per
product" is read literally as one row, updated in place, rather than many snapshot
rows with an "active" flag — there is exactly one snapshot per product by
construction, not by convention. `ProductCostHistory` is where every past value lives;
`ProductCostSnapshot` only ever holds the current one.

**`Product` gained `currentCost`/`lastCostUpdate`, but not a new `costMethod`
column.** "Prepare Product entity for: CurrentCost, LastCostUpdate, CostMethod
(placeholder)" was checked against ADR-0012 first: `Product.defaultCostMethod` already
exists as exactly this kind of placeholder ("nullable... no business logic... no
FK... left untyped as any specific enum/reference since none was specified"). Adding a
second, differently-named "cost method" column would create two parallel fields
answering the same question. `defaultCostMethod` satisfies "CostMethod (placeholder)"
for this task; only `currentCost`/`lastCostUpdate` are new. `currentCost` denormalizes
the current `ProductCostSnapshot.cost` for fast reads without a join — it is written
only as a side effect of recording a cost, never edited directly.

**`POST /product-cost/:productId` was added despite not appearing in the task's own
endpoint examples**, which list only `POST/PATCH/GET /cost-components` and
`GET /product-cost/:productId` / `GET /product-cost-history/:productId`. The task's own
requirements cannot be satisfied without it: "Every cost change must create history,"
the Validation section demands rejecting negative cost / inactive / deleted products
against an actual submitted value, and the Timeline section names
`PRODUCT_COST_UPDATED`/`SNAPSHOT_CREATED` as activities that must fire — none of which
can happen with read-only endpoints. The endpoint list is introduced with "Examples,"
the same non-exhaustive wording already used for Inventory's business operations
(ADR-0013), where equivalent gap-filling reads were added. Critically, this endpoint
**does not calculate anything** — it records a caller-supplied `cost` value exactly the
way Inventory's `Adjustment` operation records a caller-supplied quantity delta without
computing one (ADR-0013). "Future purchasing will update it" means Purchasing will
become a caller of this same recording path, not that this task builds a different,
calculating path.

**`PRODUCT_COST_UPDATED`/`SNAPSHOT_CREATED` are logged onto the existing
`ProductActivity` timeline (ADR-0011), not a new activity table.** Only `CostComponent`
explicitly lists "Timeline" as one of its own fields in this task; `ProductCostHistory`
and `ProductCostSnapshot` do not. Since a cost change is semantically "something that
happened to this Product," and `ProductActivity` already exists precisely to record
that, reusing it avoids a redundant third timeline table for the same product. A new
`CostComponentActivity` table was created, mirroring the same shape as every other
`*Activity` entity, because `CostComponent` _does_ explicitly ask for one.

**`CostAllocationRule` is schema-only — no DTO, service, or controller.** The task's
own "ALLOCATION RULES" section says "No calculation yet. Only architecture," and the
Business Operations examples list nothing for it (unlike `CostComponent`, which gets
explicit CRUD examples). This is the same treatment already given to
`ASSEMBLY`/`DISASSEMBLY`/`PRODUCTION` (ADR-0013) and `ProductType.BUNDLE` (ADR-0011):
the shape exists for a future task to build logic and endpoints against, this one does
not expose it. Its `costComponentId` FK is nullable — no rule was stated requiring
every allocation rule to target exactly one component.

**Cost values use `Decimal(12, 2)`, matching this codebase's existing money fields**
(`OrderItem.unitPrice`, `Payment.amount`, ...) rather than the `Decimal(12, 3)` used for
Product dimensions — cost is money, not a physical measurement.

**Validation: "Inactive products" and "Deleted products" both refer to `Product`, not
`CostComponent`.** The Validation section's flat list mixes a `CostComponent` concern
(duplicate code) with what are clearly `Product` concerns — `CostComponent` has no
separate "deleted" state distinct from soft-delete, and this task didn't ask for
inactive-component rejection when recording a cost. `assertActiveProduct` checks
`Product.status === ACTIVE` (ADR-0011) and relies on `ProductsService.findOne` already
404ing on soft-deleted products.

## Consequences

- Every module this task explicitly forbade (Costing methods, accounting, purchasing,
  supplier invoices, reports, dashboards, taxes, ecommerce) was checked against the
  final schema and code — none were touched.
- A future Purchasing module can call `POST /product-cost/:productId` (or a shared
  internal method) the same way this task's smoke test did — no schema change needed
  for it to start driving cost.
- A future Costing module (FIFO/LIFO/Average) has `ProductCostHistory` as a
  chronological ledger and `CostComponent`/`CostAllocationRule` as the vocabulary to
  build actual allocation math against — none of that math exists yet.
- `CostAllocationRule` has no CRUD surface yet; a future task must decide its API once
  allocation logic is actually being built.
