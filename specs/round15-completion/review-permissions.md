# R15 — independent permission / data-scope review

Scope: uncommitted R15 API on `integration/r15` (read-only review, 2026-10-08). Each finding was traced end to end in
code; "not verified" marks what could not be confirmed. Tests run: `controller-authorization.spec.ts` 349/349 pass;
`jwt-auth.guard.partner.spec.ts` + `jwt-auth.guard.agent.spec.ts` 25/25 pass (DB `oms_r15_base`).

## Findings

### HIGH

**H1 — Posted COGS leaks to every `store-orders.view` holder (stock panel).**
`apps/api/src/store-orders/stock-lifecycle/store-order-stock.service.ts:800-813, 877` computes `postedCogs` (journal
EXPENSE lines of the order's invoices/returns) and `view()` returns it unredacted; the controller
`store-order-stock.controller.ts:84-93` gates `GET /store-orders/:id/stock` with plain `store-orders.view` + by-id scope.
The same view is returned by `POST :id/stock/reserve` (`reserveNow`, service :330, `store-orders.edit`) and
`POST :id/stock/receive-back` (service :424, `shipping.receive_returns`). Scenario: an ordinary salesperson (OWN, 290
`store-orders.view` holders locally) opens their own delivered order → web `store-order-stock-panel.tsx:237` shows
"COGS — posted: 75.00", i.e. per-order margin. This breaks ADR-0018 (COGS/margin only with
`orders.profitability.view`, see `order-economics.controller.ts`) and the R9 inventory-cost redaction
(`INVENTORY_COST_PERMISSIONS`). Fix: pass a `canViewCost` flag from the controller (`orders.profitability.view`, or the
cost keys) and return `postedCogs: null` otherwise, in all three responses.

### MEDIUM

**M1 — Agent users can back-date an order and get it re-priced on an older agreement.**
`agents/orders/agent-orders.service.ts:343` persists `orderDate: input.orderDate` for every caller, while pricing at
create uses "now" for agent users (:959-963). Amendments re-quote "agreement and commission rates on the order's own
date" (`quoteAmendment` → `prepare(..., { orderDate: order.orderDate })`; `store-order-amendments.service.ts:685`), and
tariffs too when destination / payment type change. Pre-existing on the portal create API, but R15 makes it a template
column for agents: `import-center/sales-import/agent-store-order-import.service.ts:86` (`orderDate: parsed.orderDate`,
spread into the create input at :120). Scenario: an agent user imports a row with Order Date inside a past, more
favourable commission / shipping agreement, then amends the order (`agent.orders.edit`) → the commission and tariff of
the old agreement apply; the order also lands in a past period of the sales reports. Fix: for agent actors persist the
pricing date (ignore `input.orderDate` exactly as `prepare` does) and ignore the Order Date column for the AGENT
audience (keep it out of the agent template). Amendment repricing read from code, not exercised by a test.

**M2 — Stock-backfill dry run ignores the caller's sales scope.**
`store-order-stock.controller.ts:68-82` lets any `store-orders.manage` holder run the dry run;
`stock-backfill.service.ts:56-66` lists every `PENDING` order company-wide, incl. agent orders (and any `orderIds`
given), returning `orderId`, `internalOrderId`, `isAgentOrder` and shortages (product, warehouse, required, available).
R7 rule: `store-orders.manage` is an action right ordinary sales staff may hold and never widens the scope. Window: all
pre-R15 open orders until the Production backfill is applied, then any order left PENDING. Fix: dry run super-admin
only (like apply), or filter candidates with `salesScope.storeOrderWhere(scope)`.

### LOW

- **L1 — New-key migrations ignore job-title templates.** `20261009100000_r15_stock_lifecycle` (shipping.receive_returns
  ← shipping.edit/manage) and `20261009100100_r15_returns_refunds_collections` (sales.receipts.reverse ←
  sales.receipts.cancel) read only individual GRANT rows, unlike `20261009100500` which includes templates; templates
  are not extended. Users holding shipping.edit only via a job title cannot "Receive returned goods" (fail-closed).
  Not verified on Production (local DB has 0 `job_title_permissions` rows).
- **L2 — Shared mapping templates can be overwritten by any importer of the type.**
  `import-center/import-mapping-templates.service.ts:40-45` upserts by (type, name) with no `createdBy` check, while
  `remove` requires ownership. User A saves a template with B's / an admin's name → B's next import uses A's mapping
  (owner/permission rules still apply at B's run). Fix: refuse the update unless creator or `import-center.manage`.
- **L3 — Import "skipped" messages name records outside the importer's scope.** Company store-order import
  `company-store-order-import.service.ts:189-205` matches the external id across all orders incl. agent orders and
  returns their `internalOrderId`; row-key skips (`imported-order.service.ts` `findImportedOrder`, leads
  `leads-import.handler.ts` `findImported`) name another company user's order / lead number; the agent lead import
  probes external ids of company / other agents' leads (`leads-import.handler.ts:327`, number withheld, existence
  revealed). Fix: name the record only when the caller can open it.
- **L4 — Agent dashboard team breakdown shows per-employee lead counts without `agent.leads.view`**
  (`agents/portal/agent-portal.service.ts` dashboard: `canSeeLeads || team` loads lead groups, `teamBreakdown` always
  includes them). Per-employee money there is consistent with `/agent-portal/sales-reports` for `agent.reports.view_team`.
- **L5 — Refund helper reads are not sales-scoped.** `GET /financial-transactions/refunds/store-orders/:storeOrderId`
  and `open-orders` (`customer-refunds.controller.ts`) return order number / collected / invoiced for any order to
  `sales.refunds.view` (Finance module convention; 2 holders locally).
- **L6 — Traceability store-order root has no by-id sales scope** (pre-existing; R15 widened it to archived orders,
  `traceability/traceability.service.ts` `storeOrder` now `where: { id }`). Any internal user with an order UUID gets
  its number, payment status and linked document numbers (filtered by kind permission only).
- **L7 — Import keys are standalone creation rights**: `crm.leads.import` / `store-orders.import` / `agent.*.import`
  create records without the matching `*.create` key (owner, duplicate and declaration rules still apply). Confirm
  intended (company keys granted to nobody; agent ADMIN holds both).
- **L8 — Stale allowlist reason**: `controller-authorization.spec.ts` still describes `sales-performance` as "own
  performance"; it is now report-scoped (team / all) with a service-level permission check. Doc only.

## Checked and correct

1. **Partner audience**: `JwtAuthGuard` denies a `typ:'partner'` token on every handler without
   `@PartnerPortal`/`@PartnerShared` (only `/partner-portal/*` and auth `me`/`logout`/`change-password`), incl.
   `@SkipPermissionCheck`, agent-shared and ungated controllers (all behind `JwtAuthGuard`; no global guard; cron /
   health / investor portal use other secrets). Internal and agent tokens get 403 on partner-only routes. Live re-check
   (active, unlocked, PARTNER, link = token claim) on every request; relink / unlink / disable → 401; temporary
   password gate applies. Partners hold only `partner.*` (users `setPermissions` audience check,
   `assertGrantable`, `findInternalUser`, `computeEffectivePermissions`, resolver never super admin / no template);
   internal users can never hold `partner.*`; `createPartnerUser` is the only PARTNER creation path and the Users API
   refuses PARTNER targets. Portal: partner from the token only; `periods/:periodId` 404 unless own entitlement;
   responses carry own terms, profit-base lines, method CASH/BANK/OTHER — no JE ids, accounts, other partners or
   customers. Login management: all seven routes need `company-partners.users.manage`; link only an unlinked PARTNER
   user (atomic), only with an agreement in force, one login per partner.
2. **Imports**: per-type permission (`crm.leads.import` / `store-orders.import` / `agent.*.import`,
   `import-center.manage` catch-all; `import-center.view` alone imports nothing); jobs and file content only for the
   creator (company admin: company jobs only), agent jobs only for their creator inside the token agent, 404 otherwise;
   atomic run claim; rows scoped to the job; agent from the token; products from the importer's own catalogue;
   owner column via `ImportOwnerService` and re-checked by `StoreOrdersService` / `AgentOrdersService` /
   `assertEligibleEmployee`; no import field maps to agent / shipping / verification / cost columns; paid amount →
   PENDING declaration (declaration permission, agent: `agent.payments.declare` + own destination), never a receipt;
   sheets: first connector owns, others and sync-source sheets refused (connect and refresh).
3. **Report scope**: one resolver; ALL only with `reports.sales.view_all`; `store-orders.view_all` /
   `crm.leads.manage` do not widen; OWN = own row + `{position, of}`; TEAM = members; agents / unassigned rows ALL only;
   agent reports by `agent.reports.view_team`, never another agent; `/sales/performance` needs `crm.leads.view` or
   `store-orders.view` (403 otherwise; agent tokens refused); `/sales-targets/ranking` company-wide is the documented HR
   exception; company agent overview: `agents.view`, money only with `agents.finance.view`, team only with
   `agents.users.view`; no cost / margin / carrier-cost key in agent dashboard figures or portal `/me`.
4. **Shipping agreements**: every write `agents.agreements.manage`, reads `agents.view`, agreement and rates scoped to
   the URL agent, internal tokens only; portal `/me` returns charges only (number, dates, currency, service ×
   destination amounts); the old commission-agreement rate endpoints are removed.
5. **Money / stock**: money panel, returns, stock view / reserve / receive-back behind the order's by-id scope (OWN never
   reaches agent orders); return request `sales.returns.create`, receive `sales.returns.confirm`, agent orders refused;
   refunds `sales.refunds.confirm` + `sales.refunds.create`, capped server-side under partner + order row locks in both
   the record path and the generic confirm, agent orders refused; payment reverse `sales.receipts.reverse`, VERIFIED
   only, refused inside a settlement / statement match or when already refunded, never deletes; COD method only an
   active reconciled method with a postable ASSET clearing account (`shipping-companies.edit`); reserve-short uses
   `store-orders.manage` + the caller's list scope; backfill apply super admin only.
6. **Controller coverage**: `controller-authorization.spec.ts` — 349 passed, no controller without an explicit
   authorization decision (new ungated entries `partner-portal`, `import-jobs`, `agent-portal-imports` are documented
   and enforced in code as described).

## Lead disposition (2026-10-08)

| Finding                                                     | Disposition                                                                                                                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1 posted COGS on stock responses                           | Fixed — `StoreOrderStockController.withCostVisibility`: `postedCogs` only with `orders.profitability.view` or the inventory-cost rule (view / reserve / receive-back).                            |
| M1 agent back-dating                                        | Fixed — agent users' orders are stored with today's date (`agent-orders.service.ts`); regression test "an agent user cannot back-date an order" (mutation: test fails without the fix).           |
| M2 backfill dry-run scope                                   | Fixed — dry run and apply are super-admin only.                                                                                                                                                   |
| L1 job-title templates                                      | Fixed — migration `20261009100600_r15_job_title_new_keys` (SQL verified in a rolled-back transaction).                                                                                            |
| L2 mapping template overwrite                               | Fixed — only the creator or `import-center.manage` replaces a template; test added.                                                                                                               |
| L3 skipped messages                                         | Fixed for company store orders (order named only when the importer may open it); leads already name only same-scope leads; row-key skips stay within the same import scope (company / one agent). |
| L4 team lead counts                                         | Fixed — omitted without `agent.leads.view` (API + web); unit test added.                                                                                                                          |
| L5 refund lookups not sales-scoped                          | Accepted — Finance module pattern (`sales.refunds.view` is a finance key), decision D15-21.                                                                                                       |
| L6 traceability by UUID                                     | Accepted (pre-existing R7 design: every linked record is filtered by the caller's own view permission; only the order header is shown) — D15-21.                                                  |
| L7 import keys without create keys                          | Accepted — an explicitly granted import key is the authorization to create records through an import — D15-21.                                                                                    |
| L8 stale allowlist reason                                   | Fixed.                                                                                                                                                                                            |
| Journey defect: receive-back / stock 404 on archived orders | Fixed — `assertCanOpenStoreOrder(..., { includeArchived: true })` for stock view, receive-back and the money panel.                                                                               |
