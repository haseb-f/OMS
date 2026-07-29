# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial project foundation: repository structure, tooling (ESLint, Prettier, Husky,
  lint-staged), documentation scaffolding, and environment variable template.
- Workspace bootstrap: `apps/web` (Next.js, App Router/TypeScript/Tailwind/ESLint),
  `apps/api` (NestJS, bootstrap-only), and `packages/{config,types,shared,ui}` linked
  into a single pnpm workspace with shared TypeScript config and `@oms/*` path
  aliases. No business logic included.
- Core local development environment: Prisma configured in `apps/api` (schema/client
  only, no models), local PostgreSQL via `docker-compose.yml` (ADR-0001), a single
  `GET /health` endpoint, and root `build`/`typecheck`/`test` workspace scripts. No
  business logic included.
- Identity Module (ADR-0002): Prisma models `User`/`Role`/`Permission`/
  `RolePermission`/`UserRole` with UUID PKs, audit columns, and soft delete; initial
  migration applied to local PostgreSQL; NestJS `users`/`roles`/`permissions` modules
  with basic CRUD (no auth, no business logic); `apps/web/features/identity/*` folder
  structure (no pages/UI yet).
- Reference Data Engine (ADR-0003): 9 independent master-data Prisma models
  (`Currency`, `Country`, `Project`, `CostCenter`, `PaymentMethod`, `ShippingMethod`,
  `ProductCategory`, `ProductBrand`, `Warehouse`), migration applied to local
  PostgreSQL; matching NestJS CRUD modules; `apps/web/features/reference-data/*`
  folder structure (no pages/UI yet); idempotent seed mechanism
  (`prisma db seed`) with default Currencies/Countries/Shipping Methods. No Payment
  Methods seeded, no business logic (account mapping, commission, journal entries)
  implemented.
- Workspace finalization (ADR-0004): `packages/constants` and `packages/validation`
  added (empty, workspace-linked); backend infra scaffolding
  `apps/api/src/{core,common,config,database,shared}/` and frontend infra scaffolding
  `apps/web/src/{components,features,hooks,lib,providers,services,styles,types}/`
  added as empty folders. No implementation, nothing moved or renamed.
- CRM Phase 1 — Lead Management Foundation (ADR-0005): Prisma models `Lead`,
  `LeadAssignment`, `LeadActivity`, `LeadNote` (relating to `Country`/`Currency`/
  `User`), `LeadStatus`/`LeadSource` enums, auto-generated Lead Number via a Postgres
  sequence; migrations applied to local PostgreSQL. NestJS `leads` module with full
  CRUD, nested `activities` (read-only timeline), `assignments` (manual, append-only),
  and `notes` (full CRUD) — every mutating operation logs a timeline entry.
  Architecture-only stubs for Excel/Google Sheets import and duplicate detection (not
  implemented, not wired in). `apps/web/features/crm/leads` folder structure (no
  pages/UI yet). No Customers, Orders, Payments, or Authentication implemented.
- CRM Phase 2 — Business Rules (ADR-0006): `Lead.productName` replaced with
  `Lead.productId` (nullable UUID, no FK yet); added `Lead.possibleDuplicate`.
  Implemented real duplicate detection (mobile+name+product exact match rejects with
  409 "Duplicate Lead"; mobile+name match with a different product allows creation and
  flags `possibleDuplicate`). Manual assignment now requires an active (non-deleted)
  sales employee. Added business-operation endpoints (`/leads/:id/assign`,
  `/start-follow-up`, `/archive`, `/mark-paid`) alongside existing CRUD — nothing
  removed — each logging its own timeline entry. Added mobile-format validation.
  Automatic distribution remains architecture-only (no scheduling). No Customers,
  Orders, Payments, Products, Shipping, Accounting, Inventory, Reports, or
  Authentication implemented.
- Sales Orders Phase 1 — Business Workflow Design: design-only blueprint
  (`docs/blueprints/sales-orders-phase1-design.md`) covering order lifecycle, state
  diagram, entities, relationships, business operations, APIs, future reports, and 11
  open questions. No code, models, migrations, or APIs.
- Sales Orders Phase 2 — Core Implementation (ADR-0007): design document updated with
  15 approved decisions before any code was written. New Reference Data entity
  `ShippingCompany`. New Prisma models `SalesOrder`, `SalesOrderItem`, `Shipment`,
  `SalesOrderAttachment`, `SalesOrderNote`, `SalesOrderActivity`,
  `SalesOrderStatusHistory` (the last one deliberately omitting `updated_at`/
  `updated_by`/`deleted_at` — never updated, never deleted). Auto-generated Order
  Number via its own sequence, independent from Lead Number. NestJS `sales-orders`
  module implementing all 13 required business operations (Create Order From Paid
  Lead, Ready For Shipping, Assign Shipping Employee, Assign Shipping Company, Add
  Tracking Number, Upload Shipping Label, Mark Shipped, Mark Delivered, Return Order,
  Create Reshipment, Add Shipping Cost, Add Internal Note, Upload Attachment) — no
  generic CRUD create/update/delete. Pricing (unit price, quantity, discount, offer)
  snapshotted per line item; customer-facing fields snapshotted on the order; Payment
  Method and Warehouse mandatory; Sales Employee and Shipping Employee stored
  separately; returns allowed at any order status; reshipping creates a new Shipment
  under the same order, never a new order. No Customer module, inventory deduction,
  accounting entries, invoicing, reports, dashboard, payment reconciliation, or
  warehouse stock movement implemented.
- Sales Orders Refactor + Payment Verification Phase 1 (ADR-0008, ADR-0009): design
  document updated with 6 approved refactor decisions before any code was written.
  `SalesOrderItem` renamed to `OrderItem`. `Shipment` gained `attemptNumber`,
  `labelUrl`, its own `status` (`ShipmentStatus`, including
  `RETURN_BEFORE_DELIVERY`/`RETURN_AFTER_DELIVERY`, inferred automatically per
  shipment), and `notes`. `SalesOrderStatus` gained `LABEL_CREATED`. `SalesOrder`
  gained 4 operational-user fields (`createdById`, `paymentVerifiedById` — the latter
  auto-snapshotted from a Lead's verified Payment — plus schema-only `packedById`/
  `handedToShippingById`). New Reference Data entity `PaymentSource` (seeded: Bank
  Transfer, Wallet, InstaPay, Cash Deposit, Payment Gateway, Other), distinct from the
  existing generic `PaymentMethod`. New Prisma models `Payment`, `PaymentAttachment`,
  `PaymentNote`, `PaymentActivity`. NestJS `payments` module implementing all 7
  required business operations (Create Payment, Attach Receipt, Add Note, Match
  Payment, Verify Payment, Reject Payment, View Timeline), enforcing the given
  PENDING → MATCHED → {VERIFIED|REJECTED} flow. Verifying a payment automatically
  marks its linked Lead `PAID` (verified live end-to-end through Sales Order
  creation). Architecture-only stub for automatic matching (not implemented, not
  wired in). No bank import, accounting entries, invoices, shipping, inventory,
  reports, or dashboard implemented.
- Payment Sources & Receiving Accounts (ADR-0010): reinforced that OMS is an ERP, not
  a payment gateway — no gateway SDKs, webhooks, OAuth, API tokens, provider adapters,
  or background sync anywhere in the codebase. New minimal Reference Data entity
  `ChartOfAccount` (code/name/description only — no posting, journal entries, or
  balances). `PaymentSource` extended with `code`, `sortOrder`, `isActive`, and
  `defaultChartOfAccountId`, plus a dedicated Deactivate operation distinct from
  Archive. New `ReceivingAccount` entity (`code`, `currencyId`, required
  `chartOfAccountId`, `notes`, `isActive`; `companyId` a placeholder, no FK — no
  Company module exists). `Payment` now requires both `paymentSourceId` and
  `receivingAccountId` — never only one — each validated active at creation. No
  invoices, journal entries, bank import, automatic matching, reconciliation, gateway
  integration, accounting posting, or background jobs implemented.
- Product Engine Foundation (ADR-0011): flexible product model spanning
  PHYSICAL/SERVICE/DIGITAL/BUNDLE product types without implementing bundle
  composition/assembly logic. New reference-data entity `Unit` (seeded: Piece, Box,
  Pack, Book, Carton, Kilogram, Gram, Liter, Meter — unit conversion out of scope).
  New Prisma models `Product` (name, unique SKU, optional barcode, optional
  Category/Brand/Unit, description, `ProductType`/`ProductStatus` enums, image URL,
  nullable weight/width/height/length for future Shipping use) and `ProductActivity`
  (timeline, logging `PRODUCT_CREATED`/`PRODUCT_UPDATED`/`PRODUCT_ARCHIVED`). NestJS
  `units` and `products` modules — plain CRUD (Create/Update/Delete/List/Details),
  a deliberate departure from the named-business-operation API style used for
  Lead/SalesOrder/Payment — with filtering by Category/Brand/Status/Type and search
  by SKU/Name/Barcode. Soft delete only. No inventory quantities, stock movement,
  cost, selling/purchase price, accounting, tax, warehouse balance, or ecommerce
  fields implemented. `Lead.productId`/`OrderItem.productId` left as their existing
  placeholder columns, not wired to the new `Product` table.
- Product Master Completion (ADR-0012): `Product` gained `internalName`/`displayName`
  (both required, additive to `name`), `searchKeywords` (optional), `shortDescription`/
  `longDescription` (both optional). `categoryId` and `unitId` are now required FKs
  (`brandId` stays optional) — the existing reference-data architecture itself
  untouched. Added `isPurchasable`/`isSellable`/`isInventoryItem` flags with
  type-based defaults (PHYSICAL: all true; SERVICE/DIGITAL/BUNDLE:
  purchasable=false/sellable=true/inventoryItem=false), always manually overridable.
  `weight`/`width`/`height`/`length` become mandatory whenever the resolved
  `isInventoryItem` is true (enforced in `ProductsService` on both create and update),
  otherwise remain nullable. Added nullable placeholder columns
  `defaultWarehouseId`/`defaultCostMethod`/`defaultTaxCategory` — no FK, no API, no
  validation, no business logic. `GET /products?search=` extended to also match
  `internalName`/`displayName`/`searchKeywords`, alongside the existing
  `sku`/`name`/`barcode`. No Pricing, Inventory, Warehouse Balances, Stock Movement,
  Accounting, Taxes, Ecommerce, Odoo Integration, Images Gallery, Product Variants, or
  Bundles logic implemented.
- Inventory Engine Foundation (ADR-0013): movement-based inventory — stock quantity is
  never stored or edited directly; every change is an append-only `InventoryMovement`
  row (no `updatedAt`/`updatedBy`/`deletedAt`, same exception as
  `SalesOrderStatusHistory`), and current quantity is derived by summing movements.
  New `InventoryMovementType` enum (OPENING_BALANCE, ADJUSTMENT, TRANSFER,
  RESERVATION, RESERVATION_RELEASE, DAMAGE, EXPIRED, ASSEMBLY, DISASSEMBLY,
  PRODUCTION — the last three exist only as enum values, no logic). New
  `InventoryMovementActivity` timeline. `Warehouse` gained `isDefault`,
  `warehouseType` (free-text), `isActive`, and a prepared-only `parentWarehouseId`
  self-relation. NestJS `inventory` module: 7 business-operation endpoints only
  (`POST /inventory/{opening-balance,adjustment,transfer,damage,expired,reserve,
release}` — no generic movement CRUD), plus read-only `GET /inventory/stock`
  (derived on-hand/reserved/available), `GET /inventory/movements`,
  `GET /inventory/movements/:id`, and `GET /inventory/movements/:id/activities`.
  Reservations track a separate reserved-ledger and do not move on-hand quantity.
  Validates: product exists/active/`isInventoryItem`, warehouse exists/active,
  non-zero quantity, no same-warehouse transfer, and no operation may drive on-hand
  (or reserved) quantity negative. Movement Number generated via
  `inventory_movement_number_seq` ("MV-000001", ...), same pattern as Lead/SalesOrder/
  Payment numbers. No accounting, costing, taxes, purchasing, suppliers,
  manufacturing, ecommerce, Odoo, reports, dashboard, barcode printing, or physical
  counting workflow implemented.
- Cost Engine Foundation (ADR-0014): prepares the architecture a future Purchasing
  module will drive — no FIFO/LIFO/Average calculation, no cost allocation math, no
  accounting journal entries, no purchasing/supplier logic implemented. New
  `CostComponent` reference-data entity (code/name/description/isActive, own
  `CostComponentActivity` timeline) seeded with 8 system components (PRODUCT_COST,
  PRINTING, PACKAGING, CUSTOM_BOX, CUSTOMS, INBOUND_SHIPPING,
  OUTBOUND_PREPARATION, OTHER). New `CostAllocationMethod` enum (BY_QUANTITY,
  BY_COST, EQUAL, MANUAL) and `CostAllocationRule` model — schema only, no API, per
  "No calculation yet. Only architecture." New append-only `ProductCostHistory`
  (previousCost/newCost/reason/reference, never overwritten) and single-row-per-
  product `ProductCostSnapshot` (maintained in place, no direct edit endpoint).
  `Product` gained `currentCost`/`lastCostUpdate` (denormalized mirror of the active
  snapshot); the existing `defaultCostMethod` (ADR-0012) satisfies this task's
  "CostMethod (placeholder)" — no duplicate column added. NestJS `cost-components`
  module (full reference-data CRUD) and `product-cost` module:
  `POST/GET /product-cost/:productId` (records/reads current cost — no calculation,
  same non-calculating nature as Inventory's Adjustment) and
  `GET /product-cost-history/:productId`. Validates: duplicate component code,
  negative cost, inactive product, deleted product. Logs `PRODUCT_COST_UPDATED`/
  `SNAPSHOT_CREATED` onto the existing `ProductActivity` timeline (ADR-0011) rather
  than a new one.
- Purchasing Phase 1 — Suppliers + Purchase Orders (ADR-0015): "Purchase Order is
  only an agreement to buy" — it never touches Inventory, Product Cost, Accounting,
  or Stock; verified live that Approve leaves both untouched. New `Supplier` entity
  (auto-numbered `SUP-000001`, unique user-editable code, name, contact/registration
  fields, optional Currency/Country, `status` ACTIVE/INACTIVE, `isPreferred`,
  placeholder-only `defaultPayableAccountId`/`defaultExpenseAccountId`) with its own
  `SupplierActivity` timeline. NestJS `suppliers` module: named business operations
  (Create, Update, Archive = soft-delete, Activate = reactivate, Search) rather than
  plain CRUD. New `PurchaseOrder`/`PurchaseOrderItem` (auto-numbered `PO-000001`;
  `PurchaseType` enum: INVENTORY/SAMPLE/OFFICE_SUPPLY/SERVICE/FIXED_ASSET,
  classification only; `PurchaseOrderStatus`: DRAFT/APPROVED/CANCELLED/CLOSED;
  "Preparation For Future" fields schema-only, not exposed via API) with
  `PurchaseOrderActivity` timeline. NestJS `purchase-orders` module: Create, Approve
  (DRAFT→APPROVED), Cancel (DRAFT/APPROVED→CANCELLED), Close (APPROVED→CLOSED),
  Search, Details, Timeline — no generic CRUD. Validates: inactive/deleted
  supplier, inactive/deleted product per line item, negative quantity, negative
  price, duplicate PO number, duplicate supplier code. `PurchaseOrderItem.productId`
  is a required real FK to `Product` (unlike the older, still-untouched
  `OrderItem.productId` placeholder). No Goods Receipt, Purchase Invoice, Supplier
  Payments, Cost Allocation, Accounting, Inventory Transactions, or Tax implemented.
- OMS Frontend Foundation (ADR-0016): the permanent frontend architecture — backend
  feature development paused for this task. `apps/web` restructured onto `src/`
  (`app/` → `src/app/`, `features/` merged into `src/features/`), resolving the
  overlap ADR-0004 left unresolved. shadcn/ui bootstrapped via its own CLI (Nova
  preset, Radix base, `--rtl`) with a single indigo accent over its neutral base;
  design tokens split between real Tailwind utilities (`@theme` — typography
  aliases) and plain CSS custom properties (z-index, motion duration/easing,
  mirrored in `theme/tokens.ts`). New `navigation.config.ts` — a flat,
  `parent`-id-based list (not a nested tree) covering every backend module built so
  far (CRM, Sales, Products, Inventory, Purchasing, Costing, Finance, Settings,
  Identity), assembled into a tree by `buildNavigationTree()`. Permanent
  application shell: an enterprise Sidebar built on shadcn's `Sidebar` primitive
  (icon-collapsed mode, mobile Sheet, cookie-persisted state, Cmd/Ctrl+B) with
  OMS-specific layers — one-parent-expanded-at-a-time (auto-synced to the active
  route), Pinned Modules and Recent Pages (client-side preferences only, no
  backend), in-sidebar search — and a TopBar (breadcrumb, page title/subtitle,
  a fully functional Cmd/Ctrl+K command palette, notifications and quick-actions
  placeholders using the empty-state pattern, a real light/dark/system theme
  switch, and a Language Switch placeholder that drives genuine, verified-live RTL
  layout mirroring with no translated content). Profile menu shows an honest
  generic placeholder identity — no Authentication module exists yet. Vercel
  connection was not performed — it requires the user's own OAuth authorization;
  exact manual steps were given directly instead. No business pages were built
  (`/` is a placeholder shell-demo route) — every other nav route 404s until a
  later phase.
