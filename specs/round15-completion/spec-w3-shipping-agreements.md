# W3 — Agent shipping agreements

Requirements: 3.1–3.11 · Decision D15-13. Database for tests: `oms_r15_w3`. Progress log: `progress-w3.md`.

## Current state (survey S3 — read it)

Tariff rows (`AgentShippingRate`) lived inside the commission `AgentAgreement`; resolution in
`agents/pricing/agent-shipping-tariff.ts` (most specific row; ANY wildcards), frozen per channel into
`agentTermsSnapshot.agentShippingCharge.byChannel` at submission (`agent-orders.service.ts` ~1049-1187), confirmed when
Shipping assigns the carrier (`agent-shipping-pricing.service.ts`), PREDETERMINED_CHARGE earning debits
`CUSTOMER_SHIPPING_RETAINED` = customer shipping C with basis F (agent statement), carrier cost / margin internal only
(`agentShippingEconomics`, `leakedKeys`). Agents cannot assign carriers (keep it that way).

## Foundation already in place (migration 20261009100200 — read it)

`AgentShippingAgreement` (number via Numbering Engine `AGENT_SHIPPING_AGREEMENT`, agent, currency, status
DRAFT/ACTIVE/INACTIVE, effectiveFrom/To, supersedes, activation/deactivation audit, deletedAt for discarded drafts) +
`AgentShippingAgreementRate` (service PREPAID_CARRIER / COD_CARRIER / COD_INTERNAL_COURIER /
PREPAID_INTERNAL_COURIER × destination: all (`countryId` null) / country / country+city, `destinationKey` unique per
service, amount, audit). Existing tariffs were migrated (one shipping agreement "ASA-<AGR number>" per commission
agreement with rows; ENDED → ACTIVE with its end date). `AgentShippingRate` and its enums are **gone** — the API does
not compile until you finish (6 files: agent-agreements.service.ts, agents.service.ts, agent-statement.service.ts,
agent-portal.service.ts, agent-shipping-pricing.integration.spec.ts, store-order-amendments.integration.spec.ts).

## Required behaviour

1. **Service** `agents/shipping-agreements/` + controller `agents/:agentId/shipping-agreements` (internal,
   `agents.agreements.manage` to write, `agents.view` to read):
   - list / get (with rates, coverage matrix, status, who/when), create DRAFT (currency = agent currency, number
     generated), edit DRAFT (dates, notes, rates: upsert/delete), discard DRAFT (soft delete), **duplicate as new
     draft** (copies rates, effectiveFrom = tomorrow by default), **activate**, **deactivate** (reason required).
   - Rates: service required (no wildcard), destination all / country / country+city (city trimmed, case-insensitive
     key), amount ≥ 0 (0 = explicitly free, allowed), duplicates rejected with the existing row named.
   - Activate (row-lock the agent): ≥ 1 rate; effectiveTo ≥ effectiveFrom; refuse if another ACTIVE agreement of the
     agent overlaps the date range (`SHIPPING_AGREEMENT_OVERLAP`, names it and its dates) unless `replaceFrom: true`,
     which is allowed only when the overlapping agreement started earlier: it is closed the day before (effectiveTo =
     new.effectiveFrom − 1, `supersedesId` set) in the same transaction. A coverage report (which of the four services
     × destinations are missing) is returned and shown before activation — missing combinations warn, they do not
     block (some agents never use a courier).
   - Deactivate: ACTIVE → INACTIVE (audit), never deleted, never applies to a new order again; orders already priced
     keep their snapshot.
   - Activity / audit: every create / edit / rate change / activate / deactivate / duplicate writes an audit row
     (reuse the agent activity / audit facility in the agents module; if none fits, `AuditLog` style used elsewhere).
2. **Resolution** (pure, `agents/pricing/agent-shipping-tariff.ts`): the agreement in force on the order date = ACTIVE
   with effectiveFrom ≤ date ≤ effectiveTo (or open). Service = (delivery channel, payment type) → one of the four.
   Destination specificity city > country > all destinations. No agreement → blocking issue
   `AGENT_SHIPPING_AGREEMENT_MISSING` ("No active shipping agreement for <agent> on <date> — the company activates one
   under Agent → Settings → Shipping agreement"); agreement without the combination → `AGENT_SHIPPING_TARIFF_MISSING`
   naming the agreement number, service and destination, telling the company to add it in a new version (Duplicate →
   edit → Activate with "replace from") or choose another delivery method. Never zero by default.
   Keep the submission freeze (`byChannel`), PENDING_METHOD → CONFIRMED on carrier assignment, the dispatch / earning
   waits, amendments re-resolution and the no-repricing guarantees; the snapshot additionally stores
   `shippingAgreementId`, `shippingAgreementNumber`, `rateId`, `service`.
   FLAT_FEE_PER_SHIPMENT and NONE policies: the shipping agreement still provides the default customer shipping
   charge exactly as the old rates did; the flat fee stays on the commission agreement.
3. **Commission agreement**: remove its rates endpoints / dialog / preview checks; keep `shippingPolicy`. Activation
   of a PREDETERMINED_CHARGE commission agreement warns when no ACTIVE shipping agreement covers its start date.
4. **Import path** (`shipping-updates-import.handler.ts` is W5a's — just document): carrier set by import must confirm
   the fee like the manual assignment; give W5a / the lead the exact call to add (`onShippingCompanyAssigned`) in your log.
5. **Agent portal** `/me` tariff table (`agent-portal.service.ts` `me()` block only): the ACTIVE agreement in force
   today (number, dates, rates by service and destination) — charges only, never carrier cost or margin. Agent admins
   (`agent.statement.view`) see it; agent sales see it only if they already did.
6. **Web — Agent detail → new "Settings" tab → "Shipping agreement" section** (`components/agents/shipping-agreements/**`):
   current agreement card (number, status badge, dates, currency) + a compact service × destination table (rows =
   destinations, columns = the four services, missing cells marked), actions New / Duplicate / Edit (draft) /
   Activate (shows coverage + overlap, "replace from <date>" choice) / Deactivate (reason) / Discard draft, history
   list (all agreements, statuses, dates, superseded-by). Uses the shared Dialog / Form / DataTable / InsightCard /
   status badge components; form surface; RTL; mobile. Remove the tariff UI from the commission agreement dialogs.
7. **Example (3.11)** — an integration test and a short worked example in `progress-w3.md` (Arabic + numbers): agent
   AG with ASA (COD_CARRIER Egypt 60, COD_INTERNAL_COURIER Cairo 40, PREPAID_CARRIER all 70), order to Cairo COD
   1 000 + customer shipping 60 at 35 %: submission → PENDING_METHOD (40 / 60 by channel) → Shipping assigns the
   carrier → CONFIRMED 60 → delivered → earning → statement: sales 1 060, commission 350, customer shipping retained 60
   (agreed charge 60), agent net 650. Then deactivate / replace the agreement and show the old order unchanged and a new
   order priced from the new one.

## Tests

Pure resolver (specificity, every service, missing → null); service CRUD + activate (overlap refused, replaceFrom
closes the previous, coverage report), deactivate, discard, duplicate; order submission uses the agreement in force
on the order date; missing agreement / combination messages; snapshot never repriced after a new agreement; portal
`/me` shows charges only (`leakedKeys` clean); the two existing suites migrated to the new fixtures; agent statement
example above.
