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
- [ ] Still entirely unscoped: inventory deduction, dashboard, payment reconciliation,
      warehouse stock movement, and Customer record creation
- [ ] Build `apps/web` Sales Orders / Payments UI once auth/design direction is decided

> Business modules (Customers, Inventory, Accounting, Reports) are intentionally
> excluded until each is explicitly scoped as its own task.
