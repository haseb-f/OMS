# R15 code survey — conclusions (2026-10-07)

Read-only surveys of `main` @ 8c074771. File references are repo-relative (`apps/...`).

## S4 — Company partners and external logins

- R14 module `apps/api/src/company-partners/**`: profiles / agreements / periods / payments / statement, all internal
  (`company-partners.view|manage|close|pay`, nobody granted by migration; `'company-partners': 'finance.view'` implied
  section). No login: `CompanyPartnerProfile` has no user link; `create()` says "No login is ever created".
- Agreement already has start (`effectiveFrom`), end (`effectiveTo`), %, basis, frequency, status DRAFT/ACTIVE/ENDED.
  Expiry is date-driven (in-force by dates); ACTIVE past `effectiveTo` is not auto-ENDED.
- Statement (`partner-statement.service.ts`): range-based; approved = CLOSED periods fully inside range; payments have
  no `periodId`; exposes JE ids and financial-account names; reviewed (PREVIEW) periods never shown.
- Nav: `finance-company-partners` child of Finance (`navigation.config.ts:905`); top-level sections = entries without
  `parent` (`homeTone`, `icon`, `order`); Home tiles = one per authorized root (`home-tiles.ts`), module overview needs
  `home.destinations.<childId>` lines (en + ar). `handshake` icon is taken by Agents.
- Logins: investor portal is a separate identity (own JWT/secret, `/investor` zone, outside AppShell). Agent users are
  `User.userType = AGENT` + `agentId`, JWT `typ:'agent'`; `JwtAuthGuard` denies agent tokens unless the handler is
  `@AgentPortal`/`@AgentShared`, live affiliation re-check; agent users hold only `agent.*` permissions.
- **Chosen design (lead):** third audience `PARTNER` modelled on the agent pattern (User gains `companyPartnerId`, JWT
  `typ:'partner'`, deny-by-default except `@PartnerPortal` handlers, `partner.*` vocabulary, `/partner` web zone inside
  the shell with audience `partner` nav items). Audience switch sites: `home-tiles.ts`, `module-overview.ts`,
  `build-navigation-tree.ts`, `post-login.ts`, `route-access.ts`, `proxy.ts`.

## S6 — Sales-report visibility

- `/sales-reports/live|performance` (`reports.sales.view`): scope from `SalesScopeService` — OWN/TEAM correct, but
  `store-orders.view_all` → ALL (an order-browse key widening reports). OWN gets "rank 1 of 1".
- **Leak:** `GET /sales/performance` (dashboard KPIs + ranking) has no permission guard; NONE scope falls through to the
  full company leaderboard (`sales-performance.service.ts:161-165,198`).
- `crm.leads.manage` without a managed team → ALL (seeded to Sales Manager).
- `/sales-targets/ranking` company-wide for `hr.sales-targets.view`; `/sales-targets/me` correct (own row + `of`).
- Commissions / KPI evaluations: company-wide (HR keys), no self-service.
- Agent portal reports: AGENT_ALL with `agent.records.view_all`, which an agent admin can delegate to a SALES user;
  `agent.statement.view` shows agent-wide money regardless of scope.
- Dashboard and `/sales-reports` disagree: different date field (createdAt vs orderDate) and timezone (server vs Cairo).
- No export / print / drill-down endpoints in sales reports; drill-down lists (`/store-orders`, `/crm/leads`) are
  server-scoped.
- Permission resolution: effective = expand((job-title ∪ GRANT) − DENY) − DENY; no wildcards; super admin bypass.

## S3 — Agent shipping agreements (how it works today)

1. **Create.** Agent → «الاتفاقيات» tab → New: a DRAFT `AgentAgreement` (agent's settlement currency) holding _every_
   commission/fee/hold/destination term plus `shippingPolicy` (PREDETERMINED_CHARGE | FLAT_FEE_PER_SHIPMENT | NONE).
2. **Tariffs.** Row menu → «Rates» dialog: `AgentShippingRate` rows (country required, city optional, channel
   ANY|CARRIER|INTERNAL_COURIER, payment ANY|PREPAID|COD, amount), DRAFT only; most specific wins
   (city 4 > channel 2 > payment 1).
3. **Activate.** Locks the agent row, re-checks terms, refuses overlapping ACTIVE/ENDED date ranges; ACTIVE terms and
   rates are immutable; End only shortens (accepts past dates). Activation does NOT check tariff coverage.
4. **Apply.** Order submission picks the agreement in force on the order date; every channel's fee is frozen into
   `agentTermsSnapshot.agentShippingCharge.byChannel`; same amount on all channels → CONFIRMED, otherwise
   PENDING_METHOD with a CARRIER estimate. No tariff → blocking `SHIPPING_RATE_REQUIRED` /
   `AGENT_SHIPPING_CHARGE_NOT_CONFIGURED` (never zero).
5. **Confirm.** Shipping assigns the carrier (`shipping.assign_carrier`) → fee for that channel read from the frozen
   `byChannel` → CONFIRMED, activity `AGENT_SHIPPING_TARIFF_RESOLVED`; missing → 422 `AGENT_SHIPPING_TARIFF_MISSING`.
   Dispatch and earning wait for a final fee. Import sets the carrier without confirming the fee.
6. **Statement.** At earning PREDETERMINED_CHARGE debits `CUSTOMER_SHIPPING_RETAINED` = customer shipping C (basis
   carries fee F); agents see C and F only; carrier cost and margin (`agentShippingEconomics`) internal only; portal
   timeline excludes internal rows; `leakedKeys` test helper. Agents cannot assign carriers.

Gaps: no INACTIVE status / deactivate, no draft discard; tariffs buried in the full commission agreement (changing one
charge = re-entering every term); no coverage check at activation; ANY wildcards make the applicable row hard to see;
misleading "add it to the agreement" message; no audit on rate rows; F only inside JSON (no column); import path does
not confirm the fee.

## S2 — Imports and Google Sheets

- Engine `apps/api/src/import-center/**`: job DRAFT → upload (xlsx/csv or Google Sheets URL via service account) →
  MAPPING (global mapping templates) → VALIDATING (dry run `importRow(dryRun)`) → run per row (`ImportJobError` with
  raw row; needs-review rows confirm/reject; errors CSV export). ~30 handler types.
- Permissions: writes = `import-center.manage` (all types, incl. journals/opening balances), reads = `.view`, errors
  export = `.export`; no per-type permission; no `crm.leads.create` / `store-orders.create` check; nobody granted.
- **Privacy gap:** jobs are not owner-scoped — `findAll` returns every user's jobs incl. `fileContent`; `findOne`/`run`/
  `confirmRow` never check `createdBy`; mapping templates are global.
- Leads handler: phone validated vs country, `LeadsService.create` (exact duplicate rejected, near match flagged);
  existing `externalOrderId` → silently returns the existing lead as success; Employee column = owner (scope-checked at
  commit only); blank owner → auto-distribution (not the importer); dry run returns before create (no duplicate /
  owner check in preview); `Lead.externalOrderId` not unique; `run()` has no atomic status guard.
- Store-orders handler: rows grouped by externalOrderId; required Paid Amount / Currency / Payment Method / Employee
  Email; `unitPrice = paidAmount/qty`; payment → note only (never a Payment); `StoreOrdersService.create` (global unique
  externalOrderId, customer reuse by phone, owner scope check, defaults to importer) but skips the controller's
  `duplicates.enforce` and creation idempotency key.
- Google Sheets: service account (`GOOGLE_SERVICE_ACCOUNT_KEY`), sheets shared with its e-mail (never public);
  one-time URL import exists (`POST /import-center/jobs/:id/google-sheets` + refresh). "Sync" = `SyncSourceConfig`
  (global per sheet+gid, no owner/agent), manual preview/commit with `import-center.sync`, no scheduler; store-order
  dedupe by externalOrderId + sheet write-back columns + row hashes; leads by externalOrderId only. List Sheet
  publishes reference values (incl. all user e-mails) OMS → sheet.
- Agents: no import endpoint, permission or UI.

## S1 — Agent overview and order entry

- Card family: `components/shared/insight-card.tsx` (InsightSurface, InsightCard, InsightGroup, InsightBar,
  InsightScope), `components/dashboard/dashboard-panel.tsx` (DashboardPanel, PanelLink), `components/agents/summary-card.tsx`
  (SummaryCard), `components/reports/report-card.tsx` (ReportCard). Rules: design-system §12.8 / §12.13 / §12.17 / §12.23.
- `/agent/dashboard` already uses DashboardPanel + InsightGroup/InsightCard (data `GET /agent-portal/dashboard`).
- Company per-agent Overview tab (`app/(shell)/agents/[id]/page.tsx:158-303`) does NOT: bare InsightGroup row +
  plain `DetailField`s; data only from `GET /agent-finance/agents/:id/dashboard` (`agents.finance.view`) — without it
  even stage counts disappear. No cross-agent overview; company `/dashboard` has no agents panel.
- Agent SALES users (OWN) see no money at all, not even their own sales (no `agent.statement.view`); agent admins have
  no per-employee breakdown.
- Leak tests (`leaked-keys.test-util.ts`) do not cover `/agent-portal/orders/quote`, create/convert responses, leads,
  `/agent-portal/sales-reports/*`.
- Order entry: company `StoreOrderCreateDialog` (1357 lines, EnterpriseModal + StepFlow customer → products →
  delivery & payment → review, RHF + zod, FormErrorSummary, PhoneFormField, ProductLineItemsGrid, PaymentDeclarationFields,
  DeliveryFields, mobile bottom sheet). Agent `AgentOrderForm` (824 lines, page layout, hand-managed state, OMSPhoneInput,
  SearchableSelect products, live `/agent-portal/orders/quote` breakdown, no declaration at create, no FormErrorSummary).
  Both duplicate checks go through `StoreOrderDuplicatesService` (lookupCandidates).
- Agent server rules in `AgentOrdersService.prepare` (ownership, agreement in force, commission coverage, currency,
  tariff/override, pricing modes, below-fee guard, phone vs country, declaration = SALES_DECLARATION).
- Internal `POST /agent-orders` (staff entering an agent order) has no web caller.

## S5 — Store-order lifecycle (stock, money, returns)

- Ledger: append-only, warehouse-level (no location), unique `idempotencyKey`, `ownerAgentId` snapshot, kit trace.
  Reservations = separate RESERVATION/RESERVATION_RELEASE ledger (on-hand unchanged), available = on-hand − reserved;
  `reserve()` refuses beyond available. Valuation: one company-wide moving average (`Product.currentCost`); COGS from
  `SalesInvoiceItem.unitCost` snapshot; missing cost = error. No transit location/account anywhere.
- Today: creation reserves nothing (`StoreOrdersService.create`; lead conversion writes `tx.storeOrder.create` in
  `workflow-engine.service.ts:894`; imports call `create`). Company: SHIPPED → post-commit RESERVE (shortage only
  recorded — parcel ships anyway), DELIVERED → RECOGNIZE (invoice + SALES_DELIVERY + COGS + FULFILLMENT/SHIPMENT
  cost, one locked tx), failed/return/archive → UNWIND (release before delivery while the parcel is still out;
  RETURN_PENDING after). Agent: stock issued at dispatch (SALES_DELIVERY ref STORE_ORDER), shortage blocks shipment.
- Collection: declaration = PENDING Payment (SALES_DECLARATION) + `declaredPaymentStatus`; only Finance
  `PaymentsService.confirmInTx` → VERIFIED → CUSTOMER_RECEIPT (Dr bank or method clearing / Cr AR), unique
  `PaymentReceiptLink`; advance until invoice then allocated. Clearing methods settle via `PaymentSettlement`
  (Dr bank + fee / Cr clearing). **No carrier-COD concept**; prepaid shipping gate trusts a declaration
  (`store-order-fulfillment-gate.ts`). A claim verified without a statement match has no reversal path.
- Returns: SalesReturn = credit note (restock per line warehouse, COGS reversed at snapshot cost); RETURN_PENDING
  never cleared; no saleable/damaged condition; CUSTOMER_REFUND must be fully allocated to a SalesReturn → advances
  of cancelled/undelivered prepaid orders and overpayments cannot be refunded; no refund-pending state.
  Agent `receiveReturn` posts SALES_RETURN (ref AGENT_ORDER_RETURN), reverses commission/fees.
- No partial shipments (Shipment = whole-order attempt, no lines). Kits expand to components; ASSEMBLED ship as self.
- Traceability `storeOrder()` misses archived orders, agent returns, settlements, carrier charges, fulfillment-cost
  record. Cancellation = archive → UNWIND.
