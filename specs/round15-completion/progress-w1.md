# W1 progress — agent overview cards + one order-entry flow

Recovery point for the W1 stream (spec: `spec-w1-agent-overview-entry.md`, decision D15-19). Test DB `oms_r15_w1`.

## Status

| Step | What                                                                                           | State |
| ---- | ---------------------------------------------------------------------------------------------- | ----- |
| 1    | Reading (rules, guardians, README, decisions, survey S1, spec, design-system §12.x)            | done  |
| 2    | API: shared order-figure math (`agents/overview/agent-order-figures.ts`), dashboard() reuse    | done  |
| 3    | API: `GET /agents-overview`, `GET /agents/:id/overview` (new `agents/overview/` module)        | done  |
| 4    | API: portal dashboard — records vs report scope per figure (D15-18), own / team / leads        | done  |
| 5    | API tests: figures unit 6/6; overview scope + leakedKeys integration 11/11; 2 mutations proven | done  |
| 6    | Web: shared overview panels (`components/agents/overview/**`), 3 consumers                     | done  |
| 7    | Web: `OrderEntryFlow` + company / agent adapters, old agent form removed                       | done  |
| 8    | Web tests 81/81 (13 files), web `tsc` 0 errors, eslint clean, mutation proven                  | done  |
| 9    | W3 follow-up: quote `shipping.rateScope` ALL label                                             | done  |

## Design decisions (this stream)

- Route: the cross-agent overview is `GET /agents-overview?ids=…` (not `/agents/overview`): `AgentsController` (W3,
  registered first) owns `GET /agents/:id` with `ParseUUIDPipe`, so `/agents/overview` would be answered 400 by it.
  Per-agent overview keeps the spec path `GET /agents/:id/overview`.
- Order-figure math lives once in `agents/overview/agent-order-figures.ts` (pure): fulfillment buckets (existing
  `aggregateAgentFulfillment`), sales (merchandise ex shipping, shipping, order value), delivered value
  (DELIVERED/COLLECTED), return count, per-employee `teamBreakdown`. `AgentStatementService.dashboard()` (split into
  `dashboard` + `dashboardMoney`), the portal dashboard and the overview service all use it (the portal's duplicated
  `ownFulfillmentAndSales` is gone).
- Portal dashboard — scope decided PER FIGURE (W6 / D15-18):
  - RECORDS scope (`resolveAgentVisibility`, `agent.records.view_all` = whole agent) for counts the user can browse in
    the lists anyway: `fulfillment` (orders by stage, drills into `/agent/orders`) and `leads` (`agent.leads.view`,
    drills into `/agent/leads`); `scope` = OWN | ALL reports it.
  - REPORT scope (`resolveAgentReportScope`, `agent.reports.view_team` = whole team) for every sales / money figure:
    `own` (no team scope: own order value / delivered value / delivered count / return count — no further right),
    `sales` (+ `agent.statement.view`), agent-level money `returns` / `collections` / `position` / `payouts` (team scope +
    `agent.statement.view`), `team` per-employee breakdown (team scope). A sales user delegated `agent.records.view_all`
    therefore sees agent-wide counts but only their own sales; an admin without `view_team` the same.
  - One orders read over the wider of the two scopes, each figure filtered to its own scope in memory.
- Company overviews: money keys (`sales`, `delivered`, `collections`, `position`, `returns`, `payouts`) are ABSENT
  without `agents.finance.view`; the per-agent `team` breakdown needs `agents.users.view`. Totals = DB counts only
  (agents, open = not cancelled & not earned, with returns, leads, awaiting verification with finance) — never money
  summed across currencies.
- Web one flow: `components/order-entry/order-entry-flow.tsx` (shell: steps, focus, error summary routing, one submit,
  dialog or page container) + adapters `company/use-company-order-entry.tsx`, `agent/use-agent-order-entry.tsx`.
  Shared blocks in `entry-fields.tsx`, R11/R12 phone/country rules in `use-entry-country.ts`, availability in
  `use-line-availability.ts` + `config/orders/line-availability.ts`. Step routing generalized in
  `config/orders/order-create-steps.ts` (`orderStepRouting`); agent rules/payloads in `config/orders/agent-order-entry.ts`.

## Log

- 2026-10-07 — reading done; API overview module + portal dashboard + figures done; `tsc` clean for my files (remaining
  errors belong to W2/W3/W5b). Figures unit spec 6/6. Integration spec blocked: AppModule cannot boot (W2
  `ImportJobsService` dependency `ImportSheetConnectionsService` missing) — retry later.
- 2026-10-07 — resumed after API usage limit; web order-entry shell, shared blocks and company adapter written.
- 2026-10-07 — agent adapter (portal page + staff dialog), overview panels, agent dashboard / Agent Overview tab /
  Agents page wired; old `agent-order-form.tsx` + `config/agent-portal/order-form.ts(+spec)` removed (assertions ported
  to `config/orders/agent-order-entry.spec.ts`). Web `tsc` clean for my files; eslint clean (my files). API `tsc` clean
  (no non-spec errors left in the tree); API eslint clean for my files.
- API: `agent-overview-leaks.integration.spec.ts` 10/10 (AppModule boots again). Mutation: finance gate removed from
  `agentRows` → "money absent without agents.finance.view" fails (`sales` present); restored.
- Existing `agent-portal.integration.spec.ts`: 33/34 — both dashboard tests pass; the 1 failure is the order timeline
  order (`PAYMENT_DECLARED` vs `SHIPMENT_CREATED`) in "declares full payment with proof" — order-detail timeline code,
  not W1 (shipping / declaration streams).
- Company dialog spec on the shared flow: 5/5.
- 2026-10-08 — W6 item (D15-18): portal dashboard figures split records vs report scope (see design). New test
  "a sales user delegated agent.records.view_all sees agent-wide counts, never colleagues sales figures" + tightened
  admin-without-view_team test. Mutation: sales figures over the records scope → both tests fail (1950 agent-wide vs
  1700 own); restored. Overview specs 17/17 (6 unit + 11 integration); existing portal spec 28/28.
- 2026-10-08 — W3 item: `OrderQuote.shipping.rateScope` is `ShippingRateScope = CITY | COUNTRY | ALL`
  (`services/agent-portal-service.ts`, as the lead asked); `components/agent-portal/order-breakdown.tsx` (used by the
  flow's `AgentQuoteSummary` and the order detail) labels ALL with `agentShippingAgreements.allDestinations` instead of
  "country rate". Covered by `components/order-entry/agent/agent-quote-summary.spec.tsx`.
- 2026-10-08 — agent flow spec hung once: the quote effect depended on `t` and re-set `idle` every run (render loop with
  an unstable `t`); fixed (no `t` in the effect, no-op idle update, failure message translated at render).
- Web mutation: declaration permission gate removed → "offers the payment declaration at create only with
  agent.payments.declare" fails; restored. Web `tsc` whole project: 0 errors.

## Requests to the lead / other streams

- `apps/web/src/services/agent-portal-service.ts` (unowned): fold the R15 dashboard fields into `PortalDashboard`
  (`own`, `leads`, `team` — today typed in `components/agents/overview/overview-api.ts` as `AgentPortalDashboard`) and
  `declaration?: DeclarationInput` into `CreateOrderInput` / `ConvertLeadInput` (typed today as
  `AgentCreateOrderPayload` / `AgentConvertLeadPayload` in `config/orders/agent-order-entry.ts`).
- `apps/web/src/services/agents-service.ts` (unowned): `agentFinanceService.dashboard` + `AgentDashboard` are now unused
  (the Overview tab reads `GET /agents/:id/overview`) — remove; the API route `GET /agent-finance/agents/:id/dashboard`
  (W3's controller) is then unused by the web too — keep or drop at the lead's discretion.
- `apps/web/src/components/agents/agent-orders-tab.tsx` (unowned): add `<AgentOrderEntryButton agent={…} onCreated={reload} />`
  (from `components/order-entry/agent/agent-order-entry-dialog.tsx`) to the Orders tab toolbar — today the staff entry
  point is the Overview tab's orders panel ("New agent order").
- `apps/web/src/components/agent-portal/declare-payment-dialog.tsx` (unowned): render the new shared
  `components/order-entry/agent/agent-declaration-fields.tsx` instead of its inline copy of the same fields (one
  declaration form for create and for the order detail).
- `apps/web/src/components/crm/lead-convert-dialog.tsx` (company lead conversion, unowned) still has its own form; it
  can move onto `useCompanyOrderEntry` later (spec only required it to keep working — untouched).
- W5a: when the company product picker carries available-to-sell, `components/order-entry/use-line-availability.ts`
  (today `GET /inventory/stock` / kit availability per chosen product) can read it from the line instead.
- `agents/[id]/page.tsx`: besides the Overview tab I added `key={requestedTab}` on `EntityTabs` so the overview
  drill-downs (`?tab=orders|statement|payouts`) open their tab.

- `apps/api/src/agents/finance/agent-statement.service.ts`: besides `dashboard()` I removed the now-unused
  `agentFulfillmentFacts` / `aggregateAgentFulfillment` names from its `agent-terms` import (lint).

## Open issues

- The earlier portal-spec timeline failure (`PAYMENT_DECLARED` vs `SHIPMENT_CREATED`) no longer reproduces (28/28 on
  2026-10-08).
- No browser pass (lead does the final one): page container (agent `/agent/orders/new`), staff dialog from Agent →
  Overview, cross-agent cards on `/agents` (rendered as the page's supporting `secondary` panel, below the list).
