# Tasks — Agents / Fulfillment Partners

Status legend: ☐ open · ◐ in progress · ☑ done. Owners hold the listed files; anything outside
them is changed only through the master.

## Wave 0 — foundation (master) ☑

- ☑ Schema + migration `20260928120000_agents_fulfillment_partners`.
- ☑ Identity: `JwtAuthGuard` deny-by-default + live agent check, `@AgentPortal()` /
  `@AgentShared()`, JWT agent claim, `/auth/me` user type, resolver separation,
  `getUsersWithPermission` internal-only, users service cross-type grant rejection.
- ☑ Permission catalog: `agents`, `agent-users`, `agent-finance`, `agent-portal` + presets.
- ☑ `src/agents/common` (CurrentAgent, AgentPermissionGuard/RequireAgentPermission, visibility).
- ☑ Pricing library `src/agents/pricing/agent-order-pricing.ts` + 13 unit tests.

## Wave 1 — backend

### B1 Agent admin + orders ☑

Done 2026-09-28: `/agents` (CRUD, status, archive, stock, agreements + rates, destinations),
`/agents/:agentId/users`, `/agent-orders` (quote, create, lead convert, declaration);
`AgentOrdersService` / `AgentLeadsService` / `AgentTeamService` exported for B3; product
ownership lock + catalog exclusion; movement owner stamping + `getAgentStock`; payable total in
declaration/settlement/sync/list; agent destination on declarations; `generate-invoice` and
legacy payment paths blocked for agent orders; agent filter/badge on store-order + shipping
lists; agent leads/users excluded from distribution, assignment and sales performance/targets.
Spec `src/agents/orders/agent-orders.integration.spec.ts` (26 tests).
Owns: `src/agents/admin/**`, `src/agents/orders/**`, product ownership edits in `src/products/**`,
owner stamping in `src/inventory/**`, agent-order integration in `src/store-orders/**` (except
`shipments/**` and pickup handover, which B2 owns), `src/workflow/workflow-engine.service.ts`
conversion path, `src/leads/**` distribution exclusions, `src/sales-performance/**` /
`src/sales-targets/**` exclusions.

### B2 Agent finance ☑

Owns: `src/agents/finance/**`, `src/accounting/posting-providers/agent-*.ts`, agent accounts in
`src/accounting/account-mapping/**` + posting settings DTO/service, agent hooks in
`src/store-orders/shipments/**` and the pickup handover path, agent branch in
`src/payment-reconciliation/claim-posting.adapter.ts` and payment verify/confirm path,
`src/payment-settlements/**` provider-fee attribution.
Done 2026-09-28: ledger service (idempotent, PENDING_CONFIGURATION + postPending), AGENT_* posting
provider, PostingSettings agent accounts (+ type validation), dispatch/earning/returns hooks
(shipments + pickup), company collections credit Agent funds payable (receipt JE), agent-destination
verification (memo), reconciliation-correction reversal, settlement provider-fee shares, payouts
(lock/FIFO/idempotent/reversal), statement/summary/dashboard/payment stages, `/agent-finance/*` +
`/agent-returns/*`. Tests: `agent-ledger.math.spec.ts` (17), `agent-finance.integration.spec.ts` (11).

## Wave 2

- ☑ B3 Portal API — `src/agents/portal/**`. Done 2026-09-28: `/agent-portal/*` (me, dashboard,
  products, stock, payment-destinations, attachments/:id/file, leads list/get/create/assign/convert,
  orders quote/create/list/detail/payment-declaration, statement + summary + print-data, payouts
  list/detail, team list/create/permissions/activate/deactivate/reset-password). Every controller
  `@AgentPortal()` + `JwtAuthGuard` + `AgentPermissionGuard`; agentId only from `@CurrentAgent()`;
  own vs view_all visibility on every read; responses shaped for external users (no notes, journal/
  posting internals, staff emails). Spec `src/agents/portal/agent-portal.integration.spec.ts`
  (19 HTTP tests over AppModule: separation matrix, isolation, permissions, happy path, live
  deactivation).
- ☑ W1 Internal web — `apps/web/src/app/(shell)/agents/**`, `components/agents/**`, finance agent
  collections page, settings posting accounts, store-order/shipping agent column.
  Done 2026-09-28: `/agents` list (server paged, status filter, create dialog, export/print),
  `/agents/[id]` workspace (Overview KPIs + active terms, Agreements with explicit-terms draft
  editor / activate / end / shipping rates, Payment destinations, Agent team with presets +
  one-time password, Products & stock with receive-stock adjustment, Orders with breakdown,
  Statement with summary + ledger + drill-down + export + landscape print, Payouts with
  preview / idempotent create / evidence / reverse / detail, pending-postings banner),
  `/agents/collections` (verify / reject with evidence preview). Store orders + shipping: Agent
  column, filter, badge; store-order detail: breakdown, "no company invoice", receive return.
  Accounting settings: D1 agent accounts. Users: user type column, agent-only permission matrix.
  Product modal: owner agent. Package slip collects `payableTotal`. Strings:
  `i18n/messages/modules/agents.{ar,en}.ts`. Tests: `config/agents/*.spec.ts`,
  `package-slip-print.spec.ts`. Follow-up: customer refund dialog (order panel + Orders tab),
  statement Adjustment with plain-language sign confirmation, per-order payment-stages timeline;
  agent catalog labels merged into `permissions.*` centrally in `i18n/messages.ts`.
- ☑ W2 Agent portal web — `apps/web/src/app/(shell)/agent/**` (portal routes), navigation
  audience, route guard.
  Done 2026-09-28: `/agent` dashboard (fulfillment stages + money KPIs only when returned + recent
  orders), `/agent/leads` (+ create dialog, `[id]` detail → Convert), `/agent/orders` (server
  paged, filters, export/print over all rows), `/agent/orders/new` (+ `?leadId=` conversion; two
  pricing modes, debounced live quote breakdown + issues + worked hint, override/service charge by
  progressive disclosure, idempotency key per form), `/agent/orders/[id]` (breakdown, lines,
  progress + shipments, declared vs Finance-verified per claim with stage, proof downloads via the
  portal file route, returns, timeline, Declare payment dialog with destinations), `/agent/stock`,
  `/agent/statement` (summary, sign note, ledger with memo rows + portal links, export, landscape
  print via `runPrint`), `/agent/payouts` (+ `[id]`), `/agent/team`. Nav entries (audience
  `agent`), `/agent/orders/new` create override, agent identity in the sidebar context slot,
  statement template `orientation` option. Strings: `i18n/messages/modules/agent-portal.{ar,en}.ts`.
  Tests: `config/agent-portal/*.spec.ts`.
  Fix pass: shared `/profile/password` (forced while `mustChangePassword`, global 403
  MUST_CHANGE_PASSWORD redirect, profile-menu link); portal countries from `/agent-portal/countries`;
  lead `fulfillmentMethod` (create/show/conversion default); Users page `userType=ALL` + type filter,
  agent rows → agent team tab (`?tab=team`); no economics tab for agent orders; return receipt
  shipment picker + charge-return-fee checkbox.

## Wave 3

- ☐ Integration specs (separation, isolation, lifecycle, statement reconciliation, concurrency).
- ☐ Independent security review; ☐ financial-integrity review; ☐ fixes.
- ☐ Gates; ☐ commit; ☐ release; ☐ Production acceptance; ☐ Arabic guides; ☐ handoff.
