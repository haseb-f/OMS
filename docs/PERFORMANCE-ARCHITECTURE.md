# Performance Architecture

Records the performance/architecture pass done under TASK-063. Describes what
is actually implemented — not a theoretical target.

## Method

Measurement before optimization, per representative page (Dashboard, Store
Orders, Customers, Products, Shipping, Chart of Accounts, Transaction Types,
a Customer/Product detail page), using real browser Network capture against
a production build (`next build && next start`) — dev-mode React Strict Mode
double-invokes effects, so dev-mode network captures were discarded as
non-representative and re-verified against production output.

Local dev data volume (7 store orders, 240 customers, 18 products) is too
small for local query-time benchmarking to mean anything — Postgres seq-scans
a 7-row table faster than it can use an index. Database changes below are
justified by the actual `WHERE`/`ORDER BY`/`JOIN` shapes read out of each
service's source, not by local timing deltas.

## Root causes found (ranked by evidence)

1. **CORS preflight doubles every request.** No `Access-Control-Max-Age` was
   set, so the browser re-issued a full `OPTIONS` round trip before every
   single `GET`/`POST`/`PATCH`/`DELETE` — confirmed via raw `curl` against
   both `apps/api/src/main.ts`'s dev server and the Vercel Function entry
   point. Present in production, not a dev-only artifact.
2. **Duplicate reference-data fetching on specific pages.** The Products list
   page and Product detail page each independently fetched
   Category/Brand/Unit/Tax/AnalyticAccount/Warehouse/Supplier on every mount
   (7 requests × 2 screens, every navigation between them) — proven via
   literal code duplication between the two files. The same
   `taxesService.list()` duplication existed in the Sales line-item grid and
   the Purchase Order editor.
3. **Missing indexes on the real hot filter/sort columns** for
   StoreOrder/Product/Customer/Shipment — verified against each entity's
   actual `service.ts` `where`/`orderBy` construction, not guessed from
   column names.
4. One **redundant index** (`store_orders.external_order_id` was indexed
   twice — once explicitly, once implicitly by its own `@unique` constraint).

## What was NOT found (ruled out, not assumed)

- **No duplicate-fetch bug from missing request dedup.** A session-lifetime
  reference-data cache (`apps/web/src/hooks/use-reference-data.ts`,
  `useCurrencies`/`useCountries`/`useUsersList`) already existed from an
  earlier pass and was verified working correctly via real in-app SPA
  navigation (Store Orders → Customers): zero refetches of currencies/
  countries/current-user. The apparent duplication seen in an initial test
  was this session's own testing artifact (full-page reload via automation,
  which resets JS module state) — corrected before drawing any conclusion
  from it.

5. **No React StrictMode false alarm carried into the report.** Dev mode
   showed every request fired twice; verified via a side-by-side production
   build that this was React 19's dev-only double-invocation, not a real
   duplicate-request bug.
6. **No bundle bloat.** No chart/rich-editor/date-library dependency exists
   in `apps/web/package.json`; largest production chunk is 280 KB; Next.js
   App Router's per-route code splitting already applies by default. No
   dynamic-import refactor was needed.
7. **No dead code found worth deleting.** `depcheck` flagged `shadcn` (CLI
   tool, not a runtime import), `tw-animate-css` (CSS `@import`, not a JS
   import — confirmed present in `globals.css`), and three build-config-only
   packages (`tailwindcss`, `@tailwindcss/postcss`, `@types/node`) — all
   false positives, none removed.
8. **Store Orders list query was already well-projected** — explicit
   `select` on nested relations, `take: 1` for latest shipment/payment,
   parallelized `Promise.all` fetch (no request waterfall on any tested
   page).
9. **Serverless Prisma connection handling was already correct** —
   `api/[...path].ts` caches the bootstrap promise across warm invocations
   (Fluid Compute), so `NestFactory.create()`/`$connect()` runs once per
   instance, not once per request. `DATABASE_URL` in Production is a
   Vercel-managed **Sensitive** env var this session cannot read — whether
   it points at Supabase's pooled connection string could not be verified
   here and is flagged below as unverified, not assumed correct.

## Database

**Migration `20260828204420_perf_add_hot_query_indexes`** — additive only,
applied and verified locally, all 530 API tests still pass after it.

| Table          | Change                                    | Matches this real query                                                                   |
| -------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `store_orders` | removed `@@index([externalOrderId])`      | duplicate of the `@unique` constraint's own index                                         |
| `store_orders` | + `(deletedAt, createdAt)`                | `StoreOrdersService.buildFindWhere` default list (no filters)                             |
| `store_orders` | + `(paymentStatus, createdAt)`            | payment-status filter + default sort                                                      |
| `store_orders` | + `(shippingStage, createdAt)`            | shipping-stage filter + default sort                                                      |
| `store_orders` | + `(orderDate)`                           | `dateFrom`/`dateTo` range filter                                                          |
| `products`     | + `(deletedAt, createdAt)`                | default list (no filters)                                                                 |
| `products`     | + `(categoryId)`, `(brandId)`, `(status)` | `ProductsService.findAll` where-clause filters                                            |
| `customers`    | + `(deletedAt, name)`                     | `MasterDataCrudService` default list (Customer uses the base class's default `name` sort) |
| `shipments`    | + `(status, createdAt)`                   | `StoreOrderShipmentsService.buildFlatWhere` (the `/shipping` list page)                   |
| `shipments`    | + `(shippingCompanyId)`                   | same filter set                                                                           |
| `shipments`    | + `(deletedAt, createdAt)`                | same query's base scope + sort                                                            |

No index was added for `Shipment.shippingStatusId` — audited every call site
and it is never used as a list filter (only as a single-row lookup when
setting a shipment's status), so an index there would be speculative.

**Not addressed:** production table row counts are unknown to this session.
If any of these tables are large in production, prefer
`CREATE INDEX CONCURRENTLY` outside a transaction over Prisma's default
`migrate deploy` transactional flow to avoid a write lock during rollout —
not done here since it would have required bypassing the project's
established migration process, and local evidence gives no reason to
believe these tables are large yet.

## API

- **CORS preflight caching** — `maxAge: 86400` added to `enableCors()` in
  both `apps/api/src/main.ts` (local dev server) and `api/[...path].ts` (the
  Vercel Function every production request actually goes through). Verified
  via raw `curl -X OPTIONS` that the response now carries
  `Access-Control-Max-Age: 86400`. Could not demonstrate the resulting
  request-count drop live in this session's browser — the automation
  extension runs with the DevTools Protocol's cache disabled, which also
  disables the browser's CORS-preflight cache, independent of this fix. This
  is standard, well-documented Chrome/Firefox behavior once cache is
  enabled (i.e. for every real user), not a claim resting on local
  measurement.
- No API endpoint shape changed. No business logic changed.

## Cache

Extended the **existing** reference-data cache
(`apps/web/src/hooks/use-reference-data.ts`) rather than introducing a new
caching layer — no query library (TanStack Query/SWR) exists in this project
and none was added; this narrower, purpose-built cache matches "surgical,"
not "redesign."

| Data                                                                                     | Layer                                        | Freshness        | Invalidation                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Currencies, Countries, Users (pre-existing)                                              | In-memory, session-lifetime, per browser tab | Until tab reload | None (accepted staleness for master data that essentially never changes mid-session)                                                                                                                                         |
| Product Categories, Brands, Units, Taxes, Analytic Accounts, Warehouses, Suppliers (new) | Same                                         | Same             | `useProductCategories.add(item)` — a quick-created category is appended to every mounted consumer immediately, no refetch; `.invalidate()` exists for the rarer full edit/archive case, not currently wired to any UI action |
| Store Orders / Customers / Products / Shipping lists                                     | None (server is always queried)              | Always live      | N/A — deliberately never cached; these are the operational, high-change lists section 18/19 of the task itself says must stay live                                                                                           |
| Accounting posting, financial transaction creation, any write                            | Database only                                | Real-time        | N/A — never served from cache                                                                                                                                                                                                |

No blanket `clearEverything()` exists anywhere in this cache. `.invalidate()`
is per-entity, opt-in, and not currently called from any code path — it
exists for a future "edit this category from its own management page while
a product editor is open elsewhere" case, which was not part of this pass'
proven duplication and was not force-wired in without a real call site.

## Frontend

- Migrated 4 call sites (`products/page.tsx`, `products/[id]/page.tsx`,
  `sales/product-line-items-grid.tsx`,
  `purchasing/purchase-orders/order-editor-page.tsx`) off independent
  `useState` + `useEffect` fetches onto the shared hooks above. Net line
  count decreased (duplicated fetch/state boilerplate removed, not
  abstracted into something new).
- No rendering/table/bundle change was made — audited (see "What was NOT
  found") and no evidence justified one.

## Tests

- Typecheck: pass (all workspaces)
- Lint: pass (root `eslint .`, the project's canonical gate)
- Build: pass (`apps/web` + `apps/api`)
- API tests: 530/530 passing (41 suites), including the full
  store-orders/customers/products/shipments/transaction-types set re-run
  after the index migration
- Browser QA: Store Orders list, Products list, Product detail (with
  category/unit/brand resolved correctly through the new hooks), Journal
  Entry line grid — all verified live against the dev server post-migration

## Remaining bottlenecks (found, not fixed here)

- **`DATABASE_URL` pooling mode is unverified.** Vercel marks it Sensitive;
  this session could not read it. If it is not already the Supabase pooled
  connection string, this is the single highest-risk item for connection
  exhaustion under concurrent serverless load and should be confirmed before
  Cash Import/Matching/Reconciliation adds write-heavy traffic.
- **Dashboard was not a bottleneck** — it fires exactly one request
  (`/auth/me`) and renders from local empty-state widgets, so it was out of
  scope for further work, but this also means it currently shows no real
  KPI data; that's a product-scope question, not a performance one.
- Products page still fires ~9 parallel reference-data-adjacent requests on
  first load (categories/brands/units/taxes/analytic-accounts/suppliers/
  warehouses/products/import-center) — all parallelized (no waterfall) and
  now cached for the rest of the session, but the first visit in a session
  still pays for all of them. Not reduced further in this pass.
- A repo-wide N+1 audit was not performed beyond the pages explicitly named
  in the task (Store Orders, Shipping list) — both were already
  well-projected. Other list endpoints (Sales/Purchase invoices, Journal
  Entries, Leads) were not individually audited.
