# OMS Project

## Vision

## Architecture

### Frontend (ADR-0016)

- `apps/web` uses Next.js App Router under `src/` (`src/app`), not a top-level
  `app/` — resolved the overlap ADR-0004 left open.
- The application shell (Sidebar + TopBar) is permanent architecture, not a page —
  every business page renders inside `AppShell` as `children`. Never rebuild the
  shell per module.
- Navigation is entirely config-driven from `src/navigation/navigation.config.ts` —
  a flat, `parent`-id list assembled into a tree at render time. Adding a module to
  the sidebar means adding entries there, never editing a layout/sidebar component.

## Technology Stack

### Frontend (ADR-0016)

Next.js (App Router) · Tailwind CSS v4 · shadcn/ui (Radix UI primitives) · Lucide
Icons · Motion · next-themes.

## Coding Standards

## UI Standards

### OMS Design System (ADR-0016)

- Never hardcode colors, spacing, radius, shadow, duration, or z-index inside a
  component — reference the design tokens (`src/app/globals.css` theme block,
  `src/theme/tokens.css`, `src/theme/tokens.ts`).
- Reuse shadcn/ui + Radix primitives; build OMS-specific behavior as a layer on top
  rather than hand-rolling common patterns (dialogs, menus, tooltips, command
  palettes, etc.).
- RTL must be real, not cosmetic — verify any new shell/layout component in both
  directions using logical properties (`ps-`/`pe-`/`ms-`/`me-`/`start-`/`end-`),
  never `left`/`right` or `ml-`/`mr-`.
- No fabricated identity, notification, or business data in placeholder UI —
  placeholders must read unambiguously as placeholders (e.g. "Guest User," empty
  states) until the real backend feature exists.

## Business Rules

### Product Engine (ADR-0011)

- Product SKU must be unique; Name cannot be empty.
- Products are soft-deleted only — no hard delete.
- `ProductType` (PHYSICAL/SERVICE/DIGITAL/BUNDLE) is a closed set; Bundle
  composition/assembly behavior is not implemented.
- No inventory quantity, stock movement, cost, selling/purchase price, accounting,
  tax, warehouse balance, or ecommerce field belongs on `Product` — those are future,
  separately-scoped modules.

### Product Master Completion (ADR-0012)

- `internalName` and `displayName` are required; `name` (ADR-0011) is unchanged.
- Category and Unit are required on a Product; Brand stays optional.
- `isPurchasable`/`isSellable`/`isInventoryItem` default by `ProductType` (PHYSICAL:
  all true; SERVICE/DIGITAL/BUNDLE: purchasable=false/sellable=true/
  inventoryItem=false) but can always be manually overridden.
- `weight`/`width`/`height`/`length` are mandatory whenever `isInventoryItem` is
  true; otherwise nullable.
- `defaultWarehouseId`/`defaultCostMethod`/`defaultTaxCategory` are nullable
  placeholders only — no FK, no business logic, no API, no validation yet.

### Inventory Engine Foundation (ADR-0013)

- Inventory is movement-based: stock quantity is never stored or edited directly;
  every change is an append-only `InventoryMovement` row; current quantity is
  derived by summing movements.
- `InventoryMovement` history must never be updated or deleted — no
  `updatedAt`/`updatedBy`/`deletedAt` on that table.
- Only Products with `isInventoryItem=true` and `status=ACTIVE` can generate
  movements; only active Warehouses can receive them.
- Reservations (`RESERVATION`/`RESERVATION_RELEASE`) track a separate reserved
  ledger and never change on-hand quantity; `available = onHand - reserved`.
- No accounting, costing, taxes, purchasing, suppliers, manufacturing, ecommerce,
  or reporting logic belongs in the Inventory foundation — those are future,
  separately-scoped modules.

### Cost Engine Foundation (ADR-0014)

- The Cost Engine only prepares architecture: no FIFO/LIFO/Average calculation, no
  cost allocation math, no accounting journal entries yet — those come after a
  future Purchasing module exists.
- `ProductCostHistory` is append-only and must never be overwritten;
  `ProductCostSnapshot` is the single current-cost row per product, updated in
  place, with no direct edit endpoint.
- `Product.currentCost`/`lastCostUpdate` mirror the active snapshot;
  `Product.defaultCostMethod` (ADR-0012) is the one and only "cost method"
  placeholder — no second column was added for it.
- `CostComponent` (seeded: PRODUCT_COST, PRINTING, PACKAGING, CUSTOM_BOX, CUSTOMS,
  INBOUND_SHIPPING, OUTBOUND_PREPARATION, OTHER) and `CostAllocationRule` exist as
  vocabulary/architecture for a future allocation engine — `CostAllocationRule` has
  no API yet.
- Recording a cost via `POST /product-cost/:productId` never calculates anything —
  it stores a caller-supplied value, the same way Inventory's Adjustment records a
  caller-supplied quantity.

### Purchasing Phase 1 — Suppliers + Purchase Orders (ADR-0015)

- A Purchase Order is only an agreement to buy — it must never create inventory
  movements, update product cost, create accounting entries, generate invoices,
  reserve inventory, or generate payments, on any status transition including
  Approve.
- Purchase Order status is Draft → Approved → Closed, with Cancel available from
  Draft or Approved; no other transitions are allowed.
- Supplier uses named business operations (Create, Update, Archive, Activate,
  Search), not plain CRUD — Archive is soft-delete, Activate sets status back to
  ACTIVE.
- `PurchaseOrderItem.productId` is a required, real reference to `Product` and must
  be active and not deleted; the same is true of the Purchase Order's Supplier.
- "Preparation For Future" fields on Purchase Order (Receiving Warehouse, Price
  List, Incoterms, Buyer, Shipping Method, Expected Receipt Date) and Supplier's
  default account fields are nullable placeholders only — no FK, no API, no logic.

## Accounting Rules

## Development Workflow

### Environment Policy — Local-First

This project follows a Local-First development workflow:

```
Local Development
      ↓
    GitHub
      ↓
Vercel Preview
      ↓
  Production
```

- Local development is the primary environment. Every task must be developed, run,
  tested, and fixed locally before being pushed.
- The project uses a **local PostgreSQL** database during development. Supabase is
  **not** the primary development database.
- Supabase is used only for cloud environments, after successful local testing.
- Never develop directly against Supabase.
- Never use production data during development.

### Deployment Policy

**GitHub**

- Commit only after successful local verification.
- Keep commits clean and meaningful.

**Vercel**

- Use Preview Deployments during development.
- Never deploy to Production automatically.

**Supabase**

- Use for cloud database and storage only.
- Never execute destructive migrations without explicit approval.

### Quality Gates

Every task must finish with:

- ✓ Build Success
- ✓ Lint Success
- ✓ Type Check Success
- ✓ Tests Passed

Only then: commit changes.

- Never commit broken code.
- Never push failing code.
- Never deploy unverified code.

## Decisions

## Pending Tasks
