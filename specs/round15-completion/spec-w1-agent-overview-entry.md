# W1 — Agent overview cards and one order-entry flow

Requirements: 1.1–1.10 · Decision D15-19. Database for tests: `oms_r15_w1`. Progress log: `progress-w1.md`.

## Current state (survey S1 — read it)

- Card family: `components/shared/insight-card.tsx` (InsightSurface, InsightCard, InsightGroup, InsightBar,
  InsightScope), `components/dashboard/dashboard-panel.tsx` (DashboardPanel, PanelLink), `components/agents/summary-card.tsx`,
  `components/reports/report-card.tsx`; rules design-system §12.8, §12.13, §12.17, §12.23
  (`specs/enterprise-ui-overhaul/design-system.md`).
- `/agent/dashboard` already uses DashboardPanel + InsightGroup/InsightCard (`GET /agent-portal/dashboard`).
- Company per-agent Overview tab (`app/(shell)/agents/[id]/page.tsx:158-303`): bare InsightGroup + `DetailField`s, data
  only from `GET /agent-finance/agents/:id/dashboard` (`agents.finance.view`) — without it even stage counts vanish.
  No cross-agent overview on `/agents`.
- Agent SALES users (OWN) see no money at all, not even their own sales; agent admins have no per-employee breakdown.
- Two order forms: company `StoreOrderCreateDialog` (EnterpriseModal + StepFlow: customer → products → delivery &
  payment → review; RHF + zod; FormErrorSummary; PhoneFormField; ProductLineItemsGrid; PaymentDeclarationFields;
  DeliveryFields; mobile bottom sheet) vs agent `AgentOrderForm` (page, hand state, OMSPhoneInput, SearchableSelect,
  live `/agent-portal/orders/quote`, no declaration at create). Agent rules all live server-side in
  `AgentOrdersService.prepare` (W3 owns that file — do not edit it; the quote/create DTOs already accept a declaration).

## Required behaviour

### A. Overview cards (1.1–1.6)

1. **One shared agent-overview component set** (`components/agents/overview/**`): panels built only from
   DashboardPanel / InsightGroup / InsightCard / InsightBar / SummaryCard / InsightScope — orders & fulfilment, leads,
   sales & collections, statement position, per-employee breakdown (team view), recent orders. Semantic tones per
   §12.13 (blue activity, green conversion/delivery, amber pending, red overdue/returns), soft surfaces, static tiles
   flat, drill-down tiles with hover + keyboard focus (§12.17), RTL/LTR, phone layout (one column, no horizontal
   scroll). Used by: company Agent → Overview tab, the new cross-agent overview on `/agents`, `/agent/dashboard`.
2. **Data scope (server)**:
   - Company admin: `GET /agents/overview` (new, `agents.view`) — per agent: open orders by stage, leads, sales
     (orders value), collections and statement position **only when the caller holds `agents.finance.view`**
     (otherwise those fields are absent, not zero); `GET /agents/:id/overview` (`agents.view`) for the tab — stage
     counts and activity always, money with `agents.finance.view`. Put it in new `agents/overview/` (reuse
     `AgentStatementService.dashboard` aggregation; do not duplicate the statement math).
   - Agent admin (`agent.records.view_all`): their agent's figures as today + **per-employee breakdown** only with
     `agent.reports.view_team` (new key, ADMIN preset).
   - Agent employee (OWN): their own orders/leads/fulfilment **and their own sales value / delivered value / returns
     count** (from their own orders — never agent-level statement, payouts, other employees). Agent-level money stays
     behind `agent.statement.view`.
3. **No cost leak (1.6)**: extend the `leakedKeys` checks to `/agent-portal/dashboard`, the new overview endpoints as
   seen by agents (if any), `/agent-portal/orders/quote`, the create/convert responses, leads endpoints and
   `/agent-portal/sales-reports/*` (W6 owns the reports code; you only add the test — if it fails, record it in your
   log for W6/lead). Internal company figures (carrier cost, margin, COGS, company commission revenue beyond what the
   statement already shows) never reach an agent token.

### B. One order-entry flow (1.7–1.10)

1. Extract the company dialog's stepped form into `components/order-entry/` (`OrderEntryFlow` + steps), driven by an
   **adapter** interface: customer step (company: new/existing + PartnerPicker + identity summary + lookup; agent:
   typed customer + lead prefill), product source (company `ProductPicker`; agent catalog `/agent-portal/products`
   with availability and owner filter — or `ProductPicker agentId` for staff), pricing (company unit price; agent
   SHIPPING_ADDED / SHIPPING_INCLUDED with live quote + breakdown + override behind `agent.orders.override_shipping`),
   delivery (shared `DeliveryFields`, country → calling code/currency proposals per R12 rules; agent: country =
   tariff destination), payment (company `PaymentDeclarationFields`; agent declaration at create when the user holds
   `agent.payments.declare`, destinations per agreement), extras (company: external order id, order date, receipts),
   review (company summary; agent live server breakdown + quote issues), submit endpoint + idempotency key.
2. Shared: zod schemas per adapter, `FormErrorSummary`, focus-first-invalid, `required` / `optional` marks on the
   shared form fields, the same duplicate-customer check (`useDuplicateCheck` + `DuplicateCustomerPanel`, agent via
   `checkAsAgent`), `PhoneFormField` with R11/R12 phone rules (Arabic digits, calling code proposal, never re-read),
   StepFlow header, compact layout, sticky footer, mobile bottom sheet / full-height page on phones.
3. Company `StoreOrderCreateDialog` and lead-conversion flows keep working on the shared flow (company adapter);
   `/agent/orders/new` (and agent lead conversion) render the same flow with the agent adapter in the page;
   company staff can enter an order for an agent from Agent → Orders using the agent adapter + internal
   `POST /agent-orders` (`agents.edit` or `store-orders.create` + `agents.view`, owner picker of that agent's users).
4. Availability: product lines show available-to-sell (W5a makes availability exclude transit/damaged; just display
   what the APIs return) and warn before submit when a line exceeds it ("will be saved as awaiting stock").
5. Remove the old agent form code once the agent page uses the flow (no dead code).

## Tests

Vitest: adapter schemas (required fields, phone/country rules, agent pricing modes), step validation, the flow renders
both adapters (RTL), duplicate panel wiring, declaration only with permission. API: overview endpoints scope (company
with / without finance permission, agent admin with / without `agent.reports.view_team`, agent employee own-only),
`leakedKeys` coverage. Existing `store-order-create-dialog.spec.tsx` / agent portal specs keep passing (update to the
new structure, never drop an assertion).
