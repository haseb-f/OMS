# ADR-0012: Product Master Completion

Date: 2026-07-29
Status: Accepted

## Context

ADR-0011 built the Product Engine foundation with `Category`/`Brand`/`Unit` all
optional and no purchasable/sellable/inventory distinction. This task completes the
Product master data: identity fields, descriptions, type-based purchasable/sellable/
inventory-item flags with manual override, conditional dimension requirements, and
nullable placeholder columns for future Warehouse/Cost/Tax modules — while still
explicitly excluding Pricing, Inventory, Warehouse Balances, Stock Movement,
Accounting, Taxes, Ecommerce, Odoo Integration, Images Gallery, Product Variants, and
Bundles logic.

## Decisions

**`Product.name` (ADR-0011) was kept alongside the new `internalName`/`displayName`.**
The task's Identity section says "Add," not "rename" or "replace" — read literally as
additive. `internalName` and `displayName` are both required (`NOT NULL`); `name`
remains as it was.

**`categoryId` and `unitId` became required (`NOT NULL` FK); `brandId` stays
optional** — a direct reversal of ADR-0011's "all three optional" for exactly the two
fields this task named ("Category: Required. Unit: Required. Brand: Optional."). The
`products` table was empty at migration time, so no backfill decision was needed.
`ProductCategory`/`ProductBrand`/`Unit` themselves were not touched, per "Do NOT change
existing reference-data architecture."

**`isPurchasable`/`isSellable`/`isInventoryItem` have no DB-level `@default`.** The
task specifies a _different_ default per `ProductType`, which a single Prisma column
default can't express. Instead, `ProductsService.create()` resolves
`dto.<flag> ?? DEFAULT_FLAGS_BY_TYPE[dto.type].<flag>` — explicit `true`/`false` in the
request always wins ("Allow manual override"); omitting a flag falls back to its
type's default (PHYSICAL: all `true`; SERVICE/DIGITAL/BUNDLE: `purchasable=false,
sellable=true, inventoryItem=false`, exactly as specified).

**Dimension mandatoriness is enforced in `ProductsService`, not as a DB constraint.**
"If isInventoryItem=true, all four values become mandatory" is conditional on another
column's _value_, not its existence — Postgres would need a `CHECK` constraint for
that, which this task didn't ask for. Both `create()` and `update()` resolve the
effective `isInventoryItem` and the effective weight/width/height/length (request
value if provided, else the existing row's, on update) and reject with 400 if any of
the four is still null while the resolved `isInventoryItem` is `true`. This also
covers flipping `isInventoryItem` from `false` to `true` on an existing product that
never had dimensions set.

**The "For PHYSICAL products only" framing of the Dimensions section is descriptive,
not a type-gate in code.** Dimensions already existed as nullable on every product
type (ADR-0011); this task's validation trigger is stated as `isInventoryItem=true`,
which by default only applies to PHYSICAL but can, via manual override, apply to any
type. The validation was implemented against `isInventoryItem`, matching the literal
condition given, rather than hard-coding a `type === PHYSICAL` check the task didn't
state as the trigger.

**`defaultWarehouseId`/`defaultCostMethod`/`defaultTaxCategory` are nullable columns
only — no FK, no DTO field, no API exposure, no validation.** Per "No foreign keys
required yet. No business logic. No APIs. No validation. No UI behavior."
`defaultWarehouseId` uses the same placeholder-UUID-no-FK pattern already used for
`Lead.productId`/`OrderItem.productId`/`ReceivingAccount.companyId`.
`defaultCostMethod`/`defaultTaxCategory` are plain nullable strings — no enum, since
no closed set of values was specified and inventing one would be a business-rule
decision this task didn't make.

**Search was extended, not replaced.** `GET /products?search=` now matches
`internalName`/`displayName`/`searchKeywords` in addition to the existing
`sku`/`name`/`barcode` (ADR-0011) — "Keep existing search."

**No new `ProductActivity` types were added.** "Log all new update operations" is
already satisfied by the existing generic `PRODUCT_UPDATED` entry logged on every
`update()` call (ADR-0011), which fires regardless of which fields changed — including
the new identity/description/flag/dimension fields this task adds. Inventing more
granular activity types wasn't asked for.

## Consequences

- Every module this task explicitly forbade (Pricing, Inventory, Warehouse Balances,
  Stock Movement, Accounting, Taxes, Ecommerce, Odoo Integration, Images Gallery,
  Product Variants, Bundles logic) was checked against the final schema and code —
  none were touched.
- A future Inventory phase has `defaultWarehouseId` to read from and `isInventoryItem`
  to gate on, but no stock/quantity logic exists yet.
- A future Pricing/Accounting/Tax phase has `defaultCostMethod`/`defaultTaxCategory` to
  populate, but their shape (string vs. enum vs. FK) was deliberately left undecided —
  a future task must make that call once those modules are actually scoped.
- Creating or updating a Product now requires a valid, active-looking Category and
  Unit reference; any future bulk-import or migration path must supply both.
