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
