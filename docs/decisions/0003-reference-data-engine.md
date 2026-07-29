# ADR-0003: Reference Data Engine — master data modules, seeding

Date: 2026-07-28
Status: Accepted

## Context

OMS needs system master data (Currency, Country, Project, Cost Center, Payment
Method, Shipping Method, Product Category, Product Brand, Warehouse) that later
business modules (Products, Customers, Orders, Accounting, Shipping, Reports) will
reference. This module had to follow the table/audit/module conventions already
established in ADR-0002, and explicitly avoid inventing relationships or business
rules the task didn't ask for.

## Decisions

**All 9 entities are independent — no relations between them.** The task's own
examples ("Projects are independent," "Warehouses are independent," "Currencies are
independent") describe every entity given, and no counter-example of a relationship
between two of these entities was given. A plausible-looking relation (e.g. Country →
default Currency) was deliberately **not** added: it wasn't requested, and adding it
would be inventing structure beyond "only implement the architecture described."

**Field shapes** follow the ADR-0002 audit/soft-delete conventions, plus a minimal,
consistent per-entity shape:

- `Currency`: `code` (unique), `name`, `symbol` (optional)
- `Country`: `code` (unique), `name`
- `Project`, `CostCenter`, `Warehouse`: `code` (unique), `name`, `description` (optional)
  — these carry a business code because they're referenced by code in transactions
- `PaymentMethod`, `ProductCategory`, `ProductBrand`: `name` (unique), `description`
  (optional) — no business code convention for these

**PaymentMethod stays a bare placeholder.** Per the task's explicit instruction, no
account-mapping, commission, or journal-entry fields were added — those are deferred
to whichever future task actually implements that behavior.

**ShippingMethod gets a `type` enum** (`INTERNAL_DELIVERY` | `EXTERNAL_COMPANY`) — this
was explicitly requested ("must support two future types... only prepare the
architecture"), so it's not an invented relation. The internal delivery representative
module itself was **not** created; the enum is the only preparation made.

**Seeding**: configured via `prisma.config.ts`'s `migrations.seed` (`ts-node
prisma/seed.ts`), run with `prisma db seed`. All inserts are idempotent (`upsert` on
each entity's natural unique key), so re-running the seed never duplicates rows.
Currencies (EGP, SAR, USD, AED), Countries (Egypt, Saudi Arabia, UAE), and Shipping
Methods (Internal Delivery, Shipping Company) were seeded exactly as specified.
**No Payment Methods were seeded** — the task described entity/placeholder
requirements but never named specific payment methods, and inventing real ones would
be a business decision, not an architectural one.

**Backend module layout** mirrors ADR-0002 exactly: one Nest module per entity
(`module`/`controller`/`service`/`dto`), basic CRUD only (create / list / get / update /
soft-delete), no guards, no cross-module logic, all using the shared `PrismaModule`.

**Frontend layout**: `apps/web/features/reference-data/<entity>/` (plural, matching
the backend route/folder names), empty (`.gitkeep` only) — extends the `features/`
convention from ADR-0002 with a second domain grouping alongside `identity/`.

## Consequences

- Future business modules (Products, Customers, Orders, etc.) can reference these 9
  entities by ID once they're built — no schema changes needed here for that.
- If a real relationship between two of these entities (e.g. Country ↔ Currency) turns
  out to be needed, that's a new decision for whichever task introduces it — it wasn't
  decided here.
- Payment Methods and the internal-delivery-representative shipping type remain
  placeholders; the tasks that actually implement account mapping / commission rules /
  journal entries / the delivery representative module should start from here rather
  than redesigning the base entity.
