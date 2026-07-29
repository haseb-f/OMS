# ADR-0011: Product Engine Foundation

Date: 2026-07-29
Status: Accepted

## Context

This task built the Product Engine that every future module (Inventory, Pricing,
Ecommerce, Shipping, ...) will depend on, while explicitly forbidding those same
modules from being touched yet: no inventory quantities, stock movement, cost, selling
price, purchase price, accounting, tax, warehouse balance, or ecommerce fields. It also
asked for a flexible model spanning Physical/Service/Digital/Bundle products without
implementing bundle logic, and a plain CRUD API — a deliberate departure from the
named-business-operations pattern used for Lead/SalesOrder/Payment in prior tasks.

## Decisions

**`Product.categoryId`, `brandId`, and `unitId` are all optional**, unlike this
codebase's usual practice of marking specific fields "(Required)" when a task intends
them to be mandatory (e.g. ADR-0010's `ReceivingAccount.chartOfAccountId`). No field in
this task carried that annotation, and mandating any of the three would conflict with
SERVICE/DIGITAL product types that may have no meaningful category, brand, or unit.

**`weight`/`width`/`height`/`length` are nullable**, even though the task states
"Dimensions are required because Shipping will need them later." Read as explaining
_why the columns exist on every product_ (so Shipping has somewhere to read them from
in a future phase), not as a `NOT NULL` mandate today — SERVICE and DIGITAL products
have no physical form to measure, and this task named no per-type field rules. A future
Shipping-phase task can decide whether physical products specifically should require
them; that decision was not asked for here.

**`ProductType.BUNDLE` exists only as an enum value.** No bundle composition table,
no "contains" relation, no bundle pricing or assembly logic was added anywhere — per
"without implementing bundle logic yet."

**The Product API is plain CRUD** (`POST/GET/GET:id/PATCH/DELETE`), not the named
business-operation style used for Lead, SalesOrder, and Payment in prior tasks. This
task explicitly asked for "Create, Update, Delete, List, Details" rather than naming
specific business actions — read literally as an intentional, different shape for this
module, not an oversight or regression from the established pattern.

**`ProductActivity` still logs a timeline** ("log every business operation") despite the
plain-CRUD API, using the same string-`type` + `metadata: Json?` shape as every other
`*Activity` entity in this codebase. Because create/update/delete here are not a named
set of business actions, exactly three activity types were defined:
`PRODUCT_CREATED`, `PRODUCT_UPDATED`, `PRODUCT_ARCHIVED` — one per CRUD operation, not
invented beyond what is actually performed.

**Units were seeded** with the nine named examples (Piece, Box, Pack, Book, Carton,
Kilogram, Gram, Liter, Meter), as idempotent `upsert`s. The task phrased this as
"Support examples: [list]" — closer to a prior task's mandate-style "Support: [list]"
(which was seeded) than to phrasing that introduces a list as purely illustrative
(which was not). Future unit conversion (e.g. Kilogram ↔ Gram) is explicitly out of
scope; `Unit` is a flat named list with no conversion factor field.

**`Lead.productId` and `OrderItem.productId` were left untouched** as their existing
nullable, no-FK placeholders — not wired to the new real `Product` table. This task is
scoped to "ONLY the Product Engine"; CRM and Sales Orders were not named as in-scope,
and wiring their placeholder columns to a real FK is a schema change to those modules,
which this task did not ask for. Flagged below as Phase 2 remaining work.

## Consequences

- Every module this task explicitly forbade (Inventory, Accounting, Shipping, Reports,
  Dashboard, Authentication, Customer, Supplier, Odoo Integration, Ecommerce, Pricing
  Engine) was checked against the final schema and code — none were touched.
- A future Shipping phase has real dimension fields to read, but nothing enforces they
  are populated; that validation, if wanted, is future work.
- A future Inventory/Pricing/Ecommerce phase has a stable `Product` table to attach
  quantity, cost, price, and channel data to, without needing to alter this table's
  existing columns.
- A future Bundle phase has `ProductType.BUNDLE` to select against, but must design and
  add all composition/assembly logic and tables from scratch — none exist yet.
- `Lead.productId` and `OrderItem.productId` remain unconnected to the real `Product`
  table; a future CRM/Sales Orders task must decide whether and how to wire them.
