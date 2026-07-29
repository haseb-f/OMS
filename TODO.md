# TODO

## Foundation (this stage)

- [x] Initialize Git repository
- [x] Create enterprise folder structure (`apps`, `packages`, `docs`, `scripts`, `.github`)
- [x] Add README, LICENSE, CONTRIBUTING, CHANGELOG, DECISIONS
- [x] Configure ESLint, Prettier, EditorConfig
- [x] Configure Husky + lint-staged pre-commit hook
- [x] Add `.env.example`

## Workspace Bootstrap (this stage)

- [x] Scaffold `apps/web` — Next.js (App Router, TypeScript, Tailwind, ESLint)
- [x] Scaffold `apps/api` — NestJS (TypeScript, bootstrap-only, no modules/controllers)
- [x] Create `packages/config` — shared TypeScript config presets
- [x] Create `packages/types`, `packages/shared`, `packages/ui` (empty, workspace-linked)
- [x] Configure pnpm workspace linking for all 7 projects
- [x] Configure `@oms/*` TypeScript path aliases workspace-wide
- [x] Verify lint, typecheck, and build succeed for every app/package

## Core Development Environment (this stage)

- [x] Verify `apps/web` (Next.js, App Router, TypeScript, Tailwind) starts successfully
- [x] Verify `apps/api` (NestJS) starts successfully
- [x] Install and configure Prisma in `apps/api` (schema + generator only, no models)
- [x] Add local PostgreSQL via `docker-compose.yml` (see ADR-0001) and verify Prisma
      connects to it
- [x] Add `apps/api/.env.example` for local database configuration
- [x] Add `GET /health` endpoint (`{ "status": "ok" }`) — the only API route
- [x] Verify build, lint, and type check succeed workspace-wide (root `build` /
      `typecheck` / `test` scripts added)

## Identity Module (this stage)

- [x] Create Prisma models: `User`, `Role`, `Permission`, `RolePermission`, `UserRole`
      (UUID PK, `created_at`/`updated_at`/`created_by`/`updated_by`/`deleted_at` on
      every table, snake_case via `@map`/`@@map`) — see ADR-0002
- [x] Generate and apply the initial migration to local PostgreSQL
- [x] Add NestJS `users`/`roles`/`permissions` modules (basic CRUD, no auth, no business
      logic) plus a shared `PrismaModule`/`PrismaService` (Prisma 7 driver-adapter setup)
- [x] Add `apps/web/features/identity/{users,roles,permissions}` folder structure — no
      pages, no UI yet
- [x] Verify build, prisma generate/migrate, backend start, frontend start, lint, and
      type check all succeed

## Reference Data Engine (this stage)

- [x] Create Prisma models: `Currency`, `Country`, `Project`, `CostCenter`,
      `PaymentMethod`, `ShippingMethod`, `ProductCategory`, `ProductBrand`, `Warehouse`
      — same audit/soft-delete/snake_case conventions as the Identity Module, all
      independent of each other and of future modules — see ADR-0003
- [x] Generate and apply the migration to local PostgreSQL
- [x] Add 9 NestJS modules (basic CRUD, no auth, no business logic), each with
      controller/service/dto/module, using the shared `PrismaModule`
- [x] Add `apps/web/features/reference-data/<entity>` folder structure — no pages, no
      UI yet
- [x] Add a seed mechanism (`prisma.config.ts` → `migrations.seed`, `prisma/seed.ts`,
      idempotent upserts) and seed Currencies/Countries/Shipping Methods exactly as
      specified — no Payment Methods seeded (none were named)
- [x] Verify build, prisma generate/migrate, backend start, frontend start, lint, and
      type check all succeed

## Workspace Finalization (this stage)

- [x] Add `packages/constants` and `packages/validation` (empty, workspace-linked,
      same shape as `packages/types`) — see ADR-0004
- [x] Add backend infra scaffolding: `apps/api/src/{core,common,config,database,shared}/`
      (empty folders, nothing moved/renamed)
- [x] Add frontend infra scaffolding:
      `apps/web/src/{components,features,hooks,lib,providers,services,styles,types}/`
      (empty folders, nothing moved/renamed)
- [x] Verify build, lint, typecheck, and test succeed workspace-wide (9 workspace
      projects now, up from 7)

## CRM Phase 1 — Lead Management Foundation (this stage)

- [x] Create Prisma models: `Lead`, `LeadAssignment`, `LeadActivity`, `LeadNote`
      (relating to existing `Country`/`Currency`/`User`) — see ADR-0005
- [x] `LeadStatus` (NEW/UNDER_FOLLOW_UP/PAID/ARCHIVED) and `LeadSource`
      (MANUAL/EXCEL/GOOGLE_SHEETS) enums — closed sets, exactly as specified
- [x] Auto-generated Lead Number via a Postgres sequence (`lead_number_seq`)
- [x] Generate and apply both migrations to local PostgreSQL
- [x] NestJS `leads` module: full CRUD on Lead, nested `activities` (read-only),
      `assignments` (create+read, manual only), `notes` (full CRUD) — every mutating
      operation logs a `LeadActivity` timeline entry in the same transaction
- [x] Prepared (not implemented) import architecture: `LeadImportService` interface,
      `ExcelImportService`/`GoogleSheetsImportService` stubs (throw
      `NotImplementedException`)
- [x] Prepared (not implemented, not wired in) `LeadDuplicateDetectionService` —
      Phase 2 completes the logic
- [x] Add `apps/web/features/crm/leads` folder structure — no pages, no UI yet
- [x] Verify build, prisma generate/migrate, backend start, frontend start, lint, and
      type check all succeed; smoke-tested full lead lifecycle live (create → assign →
      note → status change → timeline) against local PostgreSQL

## CRM Phase 2 — Business Rules (this stage)

- [x] Refactor: `Lead.productName` (text) → `Lead.productId` (nullable UUID, no FK —
      Product module doesn't exist yet); added `Lead.possibleDuplicate` (boolean) —
      see ADR-0006
- [x] Implement real duplicate detection (`LeadDuplicateDetectionService.check`):
      mobile+name+product identical → reject (409 "Duplicate Lead"); mobile+name match,
      product differs → allow, flag `possibleDuplicate: true`
- [x] Manual assignment now validates the target is an "active sales employee"
      (existing, non-soft-deleted `User`)
- [x] Prepared (not implemented) `LeadAutoDistributionService` — architecture only, no
      scheduling, per the deferred "distribute equally over the last 24h" rule
- [x] Added business-operation endpoints: `POST /leads/:id/assign`,
      `/start-follow-up`, `/archive`, `/mark-paid` — beside existing CRUD, nothing
      removed
- [x] Every business operation logs a specific `LeadActivity` timeline entry
      (`FOLLOW_UP_STARTED`, `MARKED_PAID`, `ARCHIVED`, alongside Phase 1's
      `LEAD_CREATED`/`LEAD_ASSIGNED`/`NOTE_ADDED`)
- [x] Added mobile-format validation (`@IsPhoneNumber()`, international format)
- [x] Generate and apply migration to local PostgreSQL
- [x] Verify build, prisma generate/migrate, backend start, frontend start, lint, and
      type check all succeed; smoke-tested duplicate detection (both cases), active/
      inactive assignment, and all 4 business operations live against local PostgreSQL

## Sales Orders Phase 1 — Business Workflow Design (this stage)

- [x] Design-only: order lifecycle, state diagram, entities, relationships, business
      operations, APIs, future reports, 11 open questions — no code, models,
      migrations, or APIs — `docs/blueprints/sales-orders-phase1-design.md`

## Sales Orders Phase 2 — Core Implementation (this stage)

- [x] Updated the Phase 1 design document with all 15 approved decisions before
      writing any code (resolving 9 of the 11 open questions; 2 remain deferred)
- [x] Added `ShippingCompany` Reference Data entity (decision #2) with full CRUD,
      same shape as `Warehouse`
- [x] Created `SalesOrder`, `SalesOrderItem`, `Shipment`, `SalesOrderAttachment`,
      `SalesOrderNote`, `SalesOrderActivity`, `SalesOrderStatusHistory` — see ADR-0007
- [x] `SalesOrderStatusHistory` deliberately omits `updated_at`/`updated_by`/
      `deleted_at` — the first exception to ADR-0002's universal audit-column
      convention, since this table must never be updated or deleted (decision #1)
- [x] Auto-generated Order Number via its own Postgres sequence
      (`sales_order_number_seq`), independent from `lead_number_seq` (decision #12)
- [x] Generated and applied both migrations to local PostgreSQL
- [x] Implemented all 13 required business operations (Create Order From Paid Lead,
      Ready For Shipping, Assign Shipping Employee, Assign Shipping Company, Add
      Tracking Number, Upload Shipping Label, Mark Shipped, Mark Delivered, Return
      Order, Create Reshipment, Add Shipping Cost, Add Internal Note, Upload
      Attachment) — business operations first, no generic CRUD create/update/delete
- [x] Every operation logs a `SalesOrderActivity` timeline entry; every status
      transition additionally logs an append-only `SalesOrderStatusHistory` entry
- [x] Verify build, prisma generate/migrate, backend start, type check, and lint all
      succeed; smoke-tested the full lifecycle live against local PostgreSQL,
      including returning a `DELIVERED` order (decision #3) and a full reship cycle

## Sales Orders Refactor + Payment Verification Phase 1 (this stage)

- [x] Updated the Sales Orders design document with all 6 approved refactor decisions
      before writing any code — see ADR-0008
- [x] Renamed `SalesOrderItem` → `OrderItem` (table `order_items`)
- [x] `Shipment` gained `attemptNumber`, `labelUrl`, `status` (`ShipmentStatus`), and
      `notes`; `SalesOrderStatus` gained `LABEL_CREATED`
- [x] `SalesOrder` gained 4 operational-user FKs: `createdById`, `paymentVerifiedById`
      (auto-snapshotted from the Lead's verified Payment), `packedById` and
      `handedToShippingById` (schema-only, no operation sets them yet)
- [x] `Return Order` now infers `RETURN_BEFORE_DELIVERY` vs `RETURN_AFTER_DELIVERY`
      per-shipment from that shipment's own status — verified live with two different
      classifications on the same order's two shipment attempts
- [x] `Create Reshipment` now returns the order to `READY_FOR_SHIPPING` (not
      `SHIPPED`), since a new shipment needs its own label again
- [x] Added `PaymentSource` Reference Data entity (Bank Transfer, Wallet, InstaPay,
      Cash Deposit, Payment Gateway, Other — seeded), distinct from the existing
      generic `PaymentMethod` — see ADR-0009
- [x] Created `Payment`, `PaymentAttachment`, `PaymentNote`, `PaymentActivity`
- [x] Implemented all 7 required business operations (Create Payment, Attach Receipt,
      Add Note, Match Payment, Verify Payment, Reject Payment, View Timeline) — Match/
      Verify/Reject enforce the given PENDING → MATCHED → {VERIFIED|REJECTED} flow
- [x] `Verify Payment` cascades: Lead automatically becomes `PAID` (`LeadsModule` now
      exports `LeadsService` for this) — verified live end-to-end: create Payment →
      match → verify → Lead flips to PAID → Sales Order created from it with
      `paymentVerifiedById` auto-populated
- [x] Prepared (not implemented) `PaymentAutoMatchingService` — architecture only, no
      matching logic, per "Current implementation: Manual Matching only"
- [x] Generated and applied 3 migrations to local PostgreSQL (35 tables total)
- [x] Verify build, prisma generate/migrate, backend start, type check, and lint all
      succeed

## Payment Sources & Receiving Accounts (this stage)

- [x] Reinforced architecture rule: OMS is an ERP, not a payment gateway — no gateway
      SDKs, webhooks, OAuth, API tokens, provider adapters, or background sync
      anywhere; gateway/card-brand names (MyFatoorah, Visa, Apple Pay, ...) are valid
      only as `PaymentSource.name` text — see ADR-0010
- [x] Added minimal `ChartOfAccount` Reference Data entity (code/name/description
      only — no posting, no journal entries, no balances)
- [x] Extended `PaymentSource` (ADR-0009): `code` (nullable — 6 rows predate it),
      `sortOrder`, `isActive`, `defaultChartOfAccountId`; added dedicated
      `POST /payment-sources/:id/deactivate` (Deactivate is distinct from Archive)
- [x] Created `ReceivingAccount`: `code`, `companyId` (placeholder, no FK — no
      Company module exists), `currencyId` (optional), `chartOfAccountId`
      (**required**), `notes`, `isActive`; Create/Edit/Archive only (no dedicated
      deactivate — not named for this entity)
- [x] `Payment` now requires both `paymentSourceId` and `receivingAccountId` — DTO and
      DB level; `Create Payment` validates both exist and are active
- [x] Generated and applied migration to local PostgreSQL (37 tables total);
      existing 6 seeded `PaymentSource` rows preserved with safe column defaults
- [x] Verify build, prisma generate/migrate, backend start, type check, and lint all
      succeed; smoke-tested the full chain live (ChartOfAccount → ReceivingAccount →
      PaymentSource with default COA → Payment referencing both →
      deactivate/reactivate/archive)

## Product Engine Foundation (this stage)

- [x] Added `Unit` Reference Data entity (seeded: Piece, Box, Pack, Book, Carton,
      Kilogram, Gram, Liter, Meter — future unit conversion out of scope)
- [x] Created `Product` (name, unique `sku`, optional `barcode`, optional
      `categoryId`/`brandId`/`unitId`, `description`, `ProductType`/`ProductStatus`
      enums, `imageUrl`, nullable `weight`/`width`/`height`/`length`) and
      `ProductActivity` — see ADR-0011
- [x] `ProductType` (PHYSICAL/SERVICE/DIGITAL/BUNDLE) and `ProductStatus`
      (ACTIVE/INACTIVE) enums — closed sets, exactly as specified; BUNDLE has no
      composition/assembly logic implemented
- [x] Generated and applied migration to local PostgreSQL (39 tables total)
- [x] NestJS `units` module (standard reference-data CRUD) and `products` module —
      plain CRUD (Create/Update/Delete/List/Details), not the named-business-operation
      style used for Lead/SalesOrder/Payment, per this task's explicit "CRUD only"
      request
- [x] `GET /products` supports filtering by `categoryId`/`brandId`/`status`/`type` and
      case-insensitive partial search across `sku`/`name`/`barcode`
- [x] Read-only `ProductActivity` timeline nested at `/products/:productId/activities`,
      logging `PRODUCT_CREATED`/`PRODUCT_UPDATED`/`PRODUCT_ARCHIVED`
- [x] SKU uniqueness and non-empty name enforced; soft delete only (no hard delete)
- [x] `Lead.productId`/`OrderItem.productId` deliberately left as their existing
      placeholder columns, not wired to the new `Product` table (Phase 2)
- [x] Verify build, prisma generate/migrate, backend start, lint, and type check all
      succeed; smoke-tested full lifecycle live against local PostgreSQL (Units CRUD;
      Product create/details/update/soft-delete; filtering by category/brand/status/
      type; search by sku/name/barcode; SKU-uniqueness and invalid-FK rejection;
      SERVICE-type product with no dimensions; activity timeline)

## Product Master Completion (this stage)

- [x] Added `internalName`/`displayName` (both required, additive to existing `name`)
      and optional `searchKeywords` — see ADR-0012
- [x] Added optional `shortDescription`/`longDescription` (additive to existing
      `description`)
- [x] `categoryId` and `unitId` are now required FKs on `Product`; `brandId` stays
      optional — existing `ProductCategory`/`ProductBrand`/`Unit` reference-data
      architecture untouched
- [x] Added `isPurchasable`/`isSellable`/`isInventoryItem` with type-based defaults
      (PHYSICAL: all true; SERVICE/DIGITAL/BUNDLE: purchasable=false/sellable=true/
      inventoryItem=false), computed in `ProductsService` and always manually
      overridable
- [x] `weight`/`width`/`height`/`length` become mandatory whenever the resolved
      `isInventoryItem` is true — enforced in `ProductsService` on both create and
      update (covers flipping `isInventoryItem` on an existing product too);
      nullable otherwise
- [x] Added nullable placeholder columns `defaultWarehouseId`/`defaultCostMethod`/
      `defaultTaxCategory` — no FK, no API, no validation, no business logic
- [x] Extended `GET /products?search=` to also match `internalName`/`displayName`/
      `searchKeywords`, keeping the existing `sku`/`name`/`barcode` match
- [x] Generated and applied migration to local PostgreSQL (still 39 tables — no new
      tables, only new `Product` columns)
- [x] Verify build, prisma generate/migrate, backend start, lint, and type check all
      succeed; smoke-tested live: required category/unit/internalName/displayName
      rejection; PHYSICAL default `isInventoryItem=true` rejecting a create with no
      dimensions; manual override of `isInventoryItem=false` allowing no dimensions;
      SERVICE/DIGITAL/BUNDLE default flags; manual flag override; search by
      internalName/displayName/searchKeywords; update-time dimension validation when
      flipping `isInventoryItem` false→true on an existing product; timeline entries
      logged for all of the above

## Inventory Engine Foundation (this stage)

- [x] Movement-based architecture: stock quantity never stored/edited directly;
      every change is an append-only `InventoryMovement` row (no `updatedAt`/
      `updatedBy`/`deletedAt` — movement history must never be edited or deleted);
      current on-hand quantity derived by summing movements — see ADR-0013
- [x] Added `InventoryMovementType` enum (OPENING_BALANCE, ADJUSTMENT, TRANSFER,
      RESERVATION, RESERVATION_RELEASE, DAMAGE, EXPIRED, ASSEMBLY, DISASSEMBLY,
      PRODUCTION) — the last three are enum-only, no Assembly/Manufacturing logic
- [x] Created `InventoryMovement` (movement number, type, warehouse, product,
      quantity, quantityBefore, quantityAfter, referenceType/referenceId, notes) and
      `InventoryMovementActivity` timeline
- [x] `Warehouse` gained `isDefault`, `warehouseType` (free-text, no closed set
      specified), `isActive`, and a prepared-only `parentWarehouseId` self-relation
      (no depth/cycle logic) — existing reference-data architecture untouched
- [x] NestJS `inventory` module: 7 business-operation endpoints only (Opening
      Balance, Adjustment, Transfer, Damage, Expired, Reserve, Release) — no generic
      CRUD for movements
- [x] Reservations (`RESERVATION`/`RESERVATION_RELEASE`) track a separate reserved
      ledger and do not change on-hand `quantityBefore`/`quantityAfter`; derived
      `available = onHand - reserved`
- [x] Read-only `GET /inventory/stock` (derived on-hand/reserved/available),
      `GET /inventory/movements` (filter by product/warehouse/type),
      `GET /inventory/movements/:id`, `GET /inventory/movements/:id/activities`
- [x] Validated: product exists/active/`isInventoryItem`, warehouse exists/active,
      non-zero quantity, no same-warehouse transfer, no operation may drive on-hand
      or reserved quantity negative
- [x] Movement Number generated via `inventory_movement_number_seq` ("MV-000001",
      ...) in its own follow-up migration, same pattern as Lead/SalesOrder/Payment
      numbers
- [x] Generated and applied 2 migrations to local PostgreSQL (39 tables total)
- [x] Verify build, prisma generate/migrate, backend start, lint, and type check all
      succeed; smoke-tested live: SERVICE (non-inventory) product rejection,
      invalid product/warehouse (404), inactive warehouse rejection, zero/negative
      quantity rejection, opening balance, adjustment (including negative-result
      rejection), transfer (same-warehouse rejection, valid two-sided transfer,
      insufficient-stock rejection), damage, expired, reserve/release (including
      over-reserve and over-release rejection), stock derivation, movement list/
      detail/filter, and timeline activities — all test data cleaned up afterward

## Cost Engine Foundation (this stage)

- [x] Added `CostComponent` reference-data entity (code unique, name, description,
      isActive) with its own `CostComponentActivity` timeline — see ADR-0014
- [x] Seeded 8 system components: PRODUCT_COST, PRINTING, PACKAGING, CUSTOM_BOX,
      CUSTOMS, INBOUND_SHIPPING, OUTBOUND_PREPARATION, OTHER — editable by admins
      via the standard CRUD (not locked/protected)
- [x] Added `CostAllocationMethod` enum (BY_QUANTITY, BY_COST, EQUAL, MANUAL) and
      `CostAllocationRule` model — schema only, no DTO/service/controller, per "No
      calculation yet. Only architecture"
- [x] Added append-only `ProductCostHistory` (previousCost/newCost/reason/
      referenceType/referenceId; no updatedAt/updatedBy/deletedAt — never
      overwritten) and single-row-per-product `ProductCostSnapshot` (unique
      productId, updated in place, no direct edit endpoint)
- [x] `Product` gained `currentCost`/`lastCostUpdate` (denormalized mirror of the
      active snapshot); the existing `defaultCostMethod` (ADR-0012) satisfies this
      task's "CostMethod (placeholder)" — no duplicate column added
- [x] NestJS `cost-components` module: full reference-data CRUD
      (POST/GET/GET:id/PATCH/DELETE) plus nested read-only
      `/cost-components/:id/activities`
- [x] NestJS `product-cost` module: `POST/GET /product-cost/:productId` (record/read
      current cost — no calculation) and `GET /product-cost-history/:productId`
- [x] Validated: duplicate component code, negative cost value, inactive product,
      deleted product
- [x] `PRODUCT_COST_UPDATED`/`SNAPSHOT_CREATED` logged onto the existing
      `ProductActivity` timeline (ADR-0011) rather than a new one;
      `COST_COMPONENT_CREATED`/`COST_COMPONENT_UPDATED` on the new
      `CostComponentActivity`
- [x] Generated and applied migration to local PostgreSQL
- [x] Verify build, prisma generate/migrate, backend start, lint, and type check all
      succeed; smoke-tested live: seeded components present, duplicate-code
      rejection, component update/soft-delete, component timeline, cost-not-yet-
      recorded 404, negative-cost rejection, inactive-product rejection, deleted-
      product rejection, valid cost recording (snapshot created), second cost
      update (same snapshot row updated in place, not recreated), history showing
      previousCost/newCost chain, Product.currentCost/lastCostUpdate mirrored, and
      Product timeline showing both cost activity types — all test data cleaned up
      afterward, only the 8 seeded components remain

## Purchasing Phase 1 — Suppliers + Purchase Orders (this stage)

- [x] Added `Supplier` entity: auto-numbered `supplierNumber` ("SUP-000001", ...),
      unique user-editable `code`, name/commercial name/contact/tax/registration
      fields, optional Currency/Country, `status` (ACTIVE/INACTIVE), `isPreferred`,
      placeholder-only `defaultPayableAccountId`/`defaultExpenseAccountId` (no FK,
      no API) — with its own `SupplierActivity` timeline — see ADR-0015
- [x] NestJS `suppliers` module: named business operations only — Create, Update,
      Archive (soft-delete), Activate (sets status back to ACTIVE), Search (by
      code/name/commercial name, filter by status) — no generic CRUD; added
      `GET /suppliers/:id` as a necessary gap-fill (needed by Update/Archive/PO
      validation, not itself one of the five named operations)
- [x] Added `PurchaseOrder`/`PurchaseOrderItem`: auto-numbered `poNumber`
      ("PO-000001", ...), Supplier (required)/Project/CostCenter/Currency
      (optional), `PurchaseType` enum (INVENTORY, SAMPLE, OFFICE_SUPPLY, SERVICE,
      FIXED_ASSET — classification only), `PurchaseOrderStatus` (DRAFT, APPROVED,
      CANCELLED, CLOSED), "Preparation For Future" fields (Receiving Warehouse,
      Price List, Incoterms, Buyer, Shipping Method, Expected Receipt Date) as
      schema-only nullable placeholders, not exposed via API — with
      `PurchaseOrderActivity` timeline
- [x] `PurchaseOrderItem.productId` is a required, real FK to `Product` (unlike the
      older `OrderItem.productId` placeholder, left untouched) — quantity/unitPrice
      reject negative only (zero allowed, per this task's literal wording);
      `subtotal` is caller-supplied, never computed server-side
- [x] NestJS `purchase-orders` module: Create, Approve (DRAFT→APPROVED), Cancel
      (DRAFT/APPROVED→CANCELLED), Close (APPROVED→CLOSED), Search (supplier/status/
      purchaseType filters, PO/reference number search), Details, Timeline — no
      generic CRUD, no Update
- [x] Validated: inactive/deleted supplier, inactive/deleted product (per line
      item), negative quantity, negative price, duplicate PO number, duplicate
      supplier code
- [x] Confirmed live: Approving a Purchase Order does not create inventory
      movements, does not update product cost, and does not touch accounting —
      product on-hand stock and cost snapshot verified unchanged after Approve
- [x] Generated and applied 2 migrations to local PostgreSQL (5 new tables: 49
      total)
- [x] Verify build, prisma generate/migrate, backend start, lint, and type check
      all succeed; smoke-tested live: supplier create/update/archive/activate/
      search/timeline, duplicate supplier code rejection, PO create/approve/
      cancel/close, invalid transition rejection (Close before Approve, re-Approve,
      Cancel after Close), inactive supplier/product rejection, invalid supplier/
      product 404, negative quantity/price rejection, sequential PO numbering,
      Details/Search/Timeline — all test data cleaned up afterward

## OMS Frontend Foundation (this stage — backend feature development paused)

- [x] Restructured `apps/web` onto `src/` (`app/` → `src/app/`, top-level
      `features/` merged into `src/features/`) — resolves the overlap ADR-0004
      left unresolved; `tsconfig.json` `@/*` now points at `./src/*`
- [x] Bootstrapped shadcn/ui via its own CLI (Nova preset, Radix base, `--rtl`);
      added Sidebar, Command, Sheet, Dialog, Dropdown Menu, Tooltip, Popover,
      Breadcrumb, Collapsible, Avatar, Badge, and related primitives; installed
      `motion` and `next-themes` — see ADR-0016
- [x] Introduced a single indigo accent color over shadcn's neutral Nova base
      (light + dark)
- [x] Design tokens: typography aliases as real Tailwind utilities (`@theme` in
      `theme/tokens.css`); z-index/motion duration/easing as plain CSS custom
      properties, mirrored in `theme/tokens.ts` for JS/Motion use; spacing/shadow/
      border-width/opacity/breakpoints deliberately reuse Tailwind's own defaults
- [x] Full frontend architecture folders under `src/`: `components/{ui,shared,
    layout,business}`, `providers`, `hooks`, `lib`, `services`, `navigation`,
      `config`, `types`, `theme`, `constants`, `assets`
- [x] `navigation.config.ts` — flat, `parent`-id-based list (id/title/subtitle/
      icon/route/parent/order/permissions/featureFlag/badge/visible/children)
      covering every backend module built so far (CRM, Sales, Products,
      Inventory, Purchasing, Costing, Finance, Settings, Identity);
      `buildNavigationTree()`/`flattenNavigationTree()`/`findNavigationItemByRoute()`/
      `getNavigationBreadcrumb()` assemble/search/breadcrumb it
- [x] Enterprise Sidebar (on shadcn's `Sidebar` primitive): hierarchical nested
      menus, only one parent expanded at a time (auto-synced to the active
      route), icon-collapsed mode, mobile Sheet, cookie-persisted state,
      Cmd/Ctrl+B shortcut, Pinned Modules + Recent Pages (client-side
      preferences, no backend), in-sidebar search, collapsed-mode tooltips
- [x] TopBar: company name, breadcrumb, page title/subtitle, a fully functional
      Cmd/Ctrl+K command palette (searches/navigates the same nav tree),
      Notifications and Quick Actions (empty-state placeholders), a real
      light/dark/system theme switch, a Language Switch placeholder that drives
      genuine RTL layout mirroring (verified live) with no translated content,
      and a Profile Menu with an honest generic placeholder identity (no
      Authentication module exists yet — every menu action disabled)
- [x] Fixed two bugs found during live smoke testing: icon-less pinned nav items
      rendering as clipped text in collapsed mode (added a fallback icon), and a
      `cmdk` runtime error from `CommandDialog` not implicitly wrapping children
      in the `Command` root in this shadcn version (added it explicitly)
- [x] `apps/web` dev/start scripts moved to port 3001 (was colliding with
      `apps/api` on 3000); `README.md` and a new `apps/web/.env.example` updated
      to match
- [x] Verify build, lint, and type check succeed workspace-wide; smoke-tested
      live in-browser: sidebar hierarchy/expand-collapse/pin/search, icon-collapsed
      mode with tooltips, command palette (open/filter/navigate), theme switch
      (light/dark), full RTL flip (breadcrumb/sidebar/icons/topbar controls all
      mirrored correctly), state persistence across reload — mobile/tablet
      breakpoint behavior verified by code review only (the sandboxed browser
      tool could not resize its window), not a live screenshot
- [ ] Vercel connection **not performed** — connecting a GitHub repo to a Vercel
      account requires the user's own OAuth authorization, which this assistant
      cannot perform; exact manual steps were given directly to the user instead
- [ ] No business pages built — `/` is a placeholder shell-demo route; every
      other nav route 404s until a later phase builds it (explicitly out of
      scope: "Do not start business pages yet")

## Next Stages (not started — out of scope for this task)

- [ ] Decide and record ADR for monorepo tooling (Turborepo/Nx/none)
- [ ] Set up Supabase project and connect environment variables
- [ ] Extend CI pipeline (`.github/workflows`) to run typecheck/build/test, not just lint
- [ ] Wire `apps/web` and `apps/api` to actually consume `@oms/ui` / `@oms/shared` /
      `@oms/types` / `@oms/constants` / `@oms/validation`
- [ ] Define authentication strategy (JWT access/refresh flow) — needed before
      `created_by`/`updated_by` can be populated, and before Users/Roles/Permissions can
      actually be assigned/enforced, and before "Manager can assign" is an enforced
      rule rather than just the intended actor
- [ ] Build `apps/web` Identity UI (pages, forms) once auth/design direction is decided
- [ ] Decide real Payment Method entries (business decision, not made here) — note
      this is the older generic `PaymentMethod` entity, distinct from the now-seeded
      `PaymentSource` (see ADR-0009)
- [ ] Build the Internal Delivery Representative module (deferred — `ShippingMethod`
      only carries the `type` discriminator so far)
- [ ] Add Account Mapping / Commission Rules / Automatic Journal Entries to
      `PaymentMethod` once that feature is actually scoped
- [ ] Reconcile `apps/api/src/prisma/` vs. the now-empty `apps/api/src/database/`, and
      `apps/web/features/*` vs. the now-empty `apps/web/src/features/` (see ADR-0004) —
      both overlaps were left unresolved since resolving them means moving code
- [ ] CRM Phase 3: implement real Excel/Google Sheets import, real scheduled automatic
      distribution, and convert PAID leads into Orders/Customers (see ADR-0005/0006)
- [ ] Build `apps/web` CRM Leads UI once auth/design direction is decided
- [ ] Fix `apps/api`'s pre-existing `start:prod` script (`node dist/main` — actual
      build output is `dist/src/main.js`); noticed during CRM work, unrelated to it
- [ ] Sales Orders Phase 3: add/remove line items after creation, edit/delete notes
      and attachments, a cancel/delete operation, `ShippingMethod` linkage on
      `Shipment` (if needed), bounding the return→reship cycle, Lead:Order cardinality
      constraints, operations to set `packedById`/`handedToShippingById` (see ADR-0008)
- [ ] Payment Verification Phase 2: real bank import, real automatic matching (see
      `PaymentAutoMatchingService`, ADR-0009), accounting journal entries, invoices
- [ ] Accounting posting logic against `ChartOfAccount` (balances, journal entries) —
      the entity exists (ADR-0010), the posting engine does not
- [ ] A real Company/multi-entity module, if multi-company support is ever needed —
      `ReceivingAccount.companyId` is currently just a placeholder (see ADR-0010)
- [ ] Reports: "Sales by Payment Source," "Balances by Receiving Account" — the data
      structure supports them (ADR-0010), no report endpoint exists yet
- [ ] Still entirely unscoped: dashboard, payment reconciliation, and Customer record
      creation
- [ ] Build `apps/web` Sales Orders / Payments UI once auth/design direction is decided
- [ ] Product Phase 3: wire `Lead.productId`/`OrderItem.productId` to the real
      `Product` table; Bundle composition/assembly logic; Product Variants; Images
      Gallery (ADR-0011/ADR-0012 explicitly left all unimplemented)
- [ ] Build `apps/web` Product Engine UI (Products, Units) once auth/design direction
      is decided
- [ ] Pricing/Ecommerce phases attach to the now-stable `Product` table (selling/
      purchase price, tax, channel data) — none of that exists yet (see ADR-0011);
      `defaultTaxCategory` is a nullable placeholder only, no FK/enum/logic decided
      yet (see ADR-0012)
- [ ] Inventory Phase 2: wire Sales Orders to actually call `reserve`/`release`/
      `adjustment` (Inventory Foundation has no knowledge of Sales Orders yet);
      Purchases/Suppliers creating `OPENING_BALANCE`/`ADJUSTMENT` movements;
      physical counting workflow; barcode printing; `defaultWarehouseId` wiring;
      enforce single default warehouse if ever needed (see ADR-0013)
- [ ] Build `apps/web` Inventory UI (movements, stock views) once auth/design
      direction is decided
- [ ] A real ASSEMBLY/DISASSEMBLY/PRODUCTION workflow for Bundle/Manufacturing —
      the movement types exist (ADR-0013), no logic implemented
- [ ] Cost Engine Phase 2: real cost calculation once Purchasing exists (FIFO/LIFO/
      Average against `InventoryMovement`/`ProductCostHistory`); actual cost
      allocation math and a CRUD surface for `CostAllocationRule` (schema exists,
      no API yet); wiring `POST /product-cost/:productId` as a side effect of real
      Purchase Order receipt instead of direct/manual calls; accounting journal
      entries against `ChartOfAccount` driven by cost changes (see ADR-0014)
- [ ] Build `apps/web` Cost Engine UI (cost components, product cost history) once
      auth/design direction is decided
- [ ] Purchasing Phase 2: Goods Receipt (the actual event that should create
      `InventoryMovement`/`OPENING_BALANCE`-or-similar rows and record product
      cost via `POST /product-cost/:productId` — neither happens today); Purchase
      Invoice; Supplier Payments; wiring `PurchaseOrder.receivingWarehouseId`/
      `priceListId`/`incoterms`/`buyerId`/`shippingMethodId`/
      `expectedReceiptDate` placeholders; `Supplier.defaultPayableAccountId`/
      `defaultExpenseAccountId` wiring once accounting exists (see ADR-0015)
- [ ] Build `apps/web` Purchasing UI (Suppliers, Purchase Orders) once auth/design
      direction is decided

> Business modules (Customers, Accounting, Reports) are intentionally excluded until
> each is explicitly scoped as its own task.
