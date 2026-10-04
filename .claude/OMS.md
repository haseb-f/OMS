# OMS Project

## Vision

## Architecture

### Frontend (ADR-0016)

- `apps/web` uses Next.js App Router under `src/` (`src/app`), not a top-level
  `app/` — resolved the overlap ADR-0004 left open.
- The application shell (Sidebar + TopBar) is permanent architecture, not a page —
  every business page renders inside `AppShell` as `children`. Never rebuild the
  shell per module.
- Home is not the Dashboard (R8): `/` (company) and `/agent` (agent portal) is the permission-aware
  launcher every login lands on (`HomeLauncher`); the Dashboard is `/dashboard` and
  `/agent/dashboard`. Home is ungated and derives its tiles from the navigation config through the
  sidebar's own filter and the route guard's own access rule (`navigation/home-tiles.ts`) — never a
  second permission list; the destinations stay guarded by the route guard and the API.
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
- Dropdown triggers are blue everywhere (R8, design-system §12.16): a trigger outside a tone row
  takes the one default shade (tone 3); a row of related controls (`ListToolbar`, `SelectorRow`)
  steps through tones 1–5 in logical order. Never colour a trigger locally (guarded by
  `selector-triggers.spec.tsx`); semantic status controls, the primary action, toggles, icon-only
  menus, text inputs and menu content keep their own colours.
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

### Sales Scope, Customer Lookup and Distribution (Round 7)

- Default sales scope is OWN: a user sees only the Leads/Store Orders assigned to them, never
  agent records. The only widening grants are Super Admin, a company-wide `crm.leads.manage`
  (no team), a Sales Team manager (own + team members; the unassigned internal pool only when
  also holding `crm.leads.manage`) and, for Store Orders only, the explicit
  `store-orders.view_all`. `store-orders.manage` is an action right (payment-review status,
  declaration corrections) that ordinary sales staff may hold — it never widens the scope.
- `shipping.view` / `finance.view` never widen the generic lists; by id they open only an
  order in the Shipping queue / an order with payment activity. Every by-id denial is 404.
- Customer discovery (`customers.lookup_advanced`, legacy `customers.lookup_global` and
  `orders.lookup_global`) is minimal-disclosure: masked phone, two letters per name word,
  reference number + coarse status; full details only for a record the caller can already
  open; name search needs first + last name and a query matching more than 5 customers
  returns nothing; one shared, atomic, audited per-user budget (15 / 10 min, 100 / day). The
  discovery permissions are granted to nobody by migration; Super Admin bypasses.
- Lead distribution eligibility is one shared rule: INTERNAL, active, not locked, employment
  ACTIVE, holds `crm.leads.edit` AND is explicitly designated (`User.salesDistributionEligible`,
  Users form). Excluded users are listed with the reason, never silently dropped.

## Accounting Rules

### Account Currency and FX (Round 7)

- Journal lines are stored in the functional currency (EGP); the entry header carries the
  document currency and the frozen rate. `ChartOfAccount.currencyId` is a binding checked at
  posting time by `ACCOUNT_CURRENCY_POLICY` (WARN default = post + activity warning, BLOCK
  fails closed, OFF). FX revaluation and year closing are exempt.
- Native-currency balances of a currency-bound account are derived per line from the entry
  header and claimed only when proven (same currency + recorded rate); otherwise the line is
  reported as unproven. Never relabel a functional sum under a foreign currency and never
  re-translate history at today's rate.
- CBE import: provider = CBE, basis = MID ((buy+sell)/2), cron 14:00 and 20:00 UTC gated by
  `CRON_SECRET`; a scheduled run never overwrites a manual row. Revaluation policy items are
  open owner decisions (`specs/round7-grid-scope-fx/fx-policy-gap.md`); no new revaluation
  postings until answered.

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
