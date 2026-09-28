# Owner brief — Agents / Fulfillment Partners (الوكلاء)

Received 2026-09-28 in two messages: the addendum "Agent staff separation & shipping price
breakdown" first, then the complete brief (which restates and extends the addendum). The owner
authorized implementation of the milestone in the complete brief. This file is the condensed record;
`spec.md` is the working specification derived from it.

## Order of work (owner)

1. Finish the print-engine work, run its checks, commit it separately, complete its release.
2. Then the Agents milestone, maintained in this folder (spec, plan, tasks, verification, handoff).
3. Ask only about genuinely unresolved business/accounting decisions; continue independent work
   meanwhile. No approval needed merely because the module is new.

## Sections of the brief

1. **Business model** — an Agent is an external business owning products we hold; we fulfill
   (receive stock and orders, pack, ship, track, collect). We earn an agreed % of merchandise/service
   sales excluding separately identified shipping, plus agreed shipping/service charges. Agent Admin
   monitors; Agent Sales enters leads/orders. Internal Shipping and Finance execute. Not the internal
   employee sales-commission module.
2. **Discovery and financial decisions** — document integration points; resolve commission
   rate/earning event, discount/tax/cancellation/return/refund treatment, customer shipping vs carrier
   cost vs agent deductions, funds availability before payout, direct-to-agent payments, negative
   balances after payout. Do not invent policy or activate postings that depend on open decisions.
3. **Agent profile and agreements** — workspace: identity, contacts, status; products/stock; team;
   commission and shipping agreements (effective-dated, snapshotted on transactions); leads, orders,
   shipments, returns; collections, statements, payouts. Reuse account/payment infrastructure.
4. **Users** — shared login, strictly separate affiliation (server-enforced). Agent users never enter
   internal pools/distribution, never inherit internal permissions via role names, cannot change
   affiliation or self-elevate. Agent Sales: own agent's leads/orders, conversion, permitted products,
   full/partial payment declarations with proof, view progress; default own/assigned records. Agent
   Admin: view agent's sales/stock/orders/delivery/collections/statements/payouts, manage team within
   delegated permissions; cannot change commission terms or approve financial transactions. Internal
   Shipping and Finance execute. Enforce in APIs, record URLs, search, pickers, exports, attachments,
   bulk actions and background jobs; never trust client-supplied agent IDs.
5. **Products and inventory ownership** — optional agent ownership; unlinked = company-owned as today;
   ownership tracked through receipts, reservations, transfers, shipments, returns, adjustments;
   owner-aware stock if one SKU can have multiple owners; expose on-hand/reserved/available/shipped/
   returned; services/courses without stock or shipping; mixed-owner orders explicitly defined or
   restricted to one owner per order — never silently assigned.
6. **Leads → orders → internal fulfillment** — attribution persists lead → lines → shipments →
   payments → returns → statements; agent orders enter existing Shipping/Finance queues with agent
   filters. Existing rules preserved (declaration ≠ verification; full declaration readies prepaid;
   only Shipping moves shipping states; no auto shipped/delivered/collected; partial ≠ full; COD and
   pickup rules; payment and fulfillment statuses distinct). Lead distribution scoped to agent team.
7. **Shipping pricing** — separate merchandise, discount/tax, customer shipping charge, payable total.
   Mode A "Shipping added / الشحن يُضاف" (1,000 + 100 = 1,100). Mode B "Shipping included / السعر شامل
   الشحن" (1,000 incl. 100 = 900 + 100). Never add shipping twice, never guess or zero an unknown
   included shipping amount. Configured rates shown before submission; manual overrides restricted and
   audited. Deterministic multi-line allocation and rounding; no invalid/negative breakdowns; existing
   tax rules preserved. Pickup and digital-only: no automatic shipping. Service charges distinct.
   Customer shipping charge ≠ carrier cost ≠ agent deduction.
8. **Payment destination and reconciliation** — Finance verifies regardless of destination.
   Company-controlled vs agent-controlled destinations (where the agreement allows). Agent Sales picks
   authorized methods and submits evidence only. Evidence-based Finance review path for agent
   destinations without statements. Agent-received money is not company cash and not added to what we
   owe the agent. Reuse statements/matching/clearing/settlement; attribute mixed-agent settlement
   batches. Stages: declared → Finance verified/matched → held with provider/courier →
   settled/received → pending agent eligibility → available for payout → paid out. Unsettled funds
   never available because an order or declaration exists.
9. **Accounting, commission, currencies** — agent-owned merchandise is not company sales revenue.
   Separate agent funds/liabilities, company commission/service revenue, shipping charges/costs,
   provider fees/refunds/adjustments. Commission excludes separately identified shipping; resolve
   discount/tax/return treatment before activating. Existing FX rules, rate snapshots, EGP base; keep
   original currencies; never subtract unlike currencies or book FX differences as gateway fees.
   Idempotent, concurrency-safe, audited; reversals preserve history.
10. **Agent statement and dashboard** — separate sales ex-shipping, customer shipping charges, total
    order value incl. shipping, discounts/tax/returns/refunds, commission base/rate and deductions,
    collections by company vs agent, pending/available/payouts. Detailed statement: opening balance,
    date/type/source reference, charges/credits, running balance, currency, collection/settlement
    references, payouts, closing balance; plain-language sign convention; no double credit on later
    collection; drill-down, filters, export, shared print system. Compact dashboard with role-specific
    navigation in the approved design system.
11. **Payouts** — Finance selects eligible amounts, reviews deductions, creates payout on existing
    financial transaction infrastructure: agent, amount, currency, paying account, date, reference,
    allocated sources, evidence. Partial payouts, remaining balances, no concurrent double payout or
    overpayment. Agent Admin views but cannot complete. Define reversal/refund effect on paid amounts.
12. **End-to-end acceptance** — tagged demo Agents A and B with Agent Admin, Agent Sales and internal
    Shipping/Finance personas; real browser journeys over the full lifecycle (setup, agreement,
    products, stock receipt, users, lead → order, direct order, shipping/delivery, full/partial
    declarations, matching/settlement, company vs agent funds, shipping added/included, COD, pickup,
    digital-only, commission and shipping deductions, partial/final payouts, cancellation,
    return/refund, reversal, statement reconciliation). External users cannot perform internal actions
    even via direct API. Cross-agent isolation (records, attachments, search, export, reports),
    duplicate imports/requests, concurrent payouts, effective-dated agreement changes. Independent
    security and financial-integrity review; fix findings before release.
13. **Delivery** — backward-compatible migrations; unlinked products/users/orders unchanged. Tests,
    typecheck, lint, production builds. Commit separately from printing. Deploy through the release
    process, verify Production with tagged demo records. Never modify real historical financial data.
    Arabic guides: Agent Admin, Agent Sales, Internal Shipping, Internal Finance. Final Arabic handoff
    with worked examples (separation, order routing, both payment destinations, shipping
    included/added, agent view with and without shipping, commission/collections/deductions/payouts
    reconciliation), screenshots, sample order/statement references, honest PASS/FAIL/BLOCKED coverage
    and verified deployed SHA.

Completion requires the full lifecycle: AGENT-OWNED GOODS → LEAD/ORDER → FULFILLMENT → COLLECTION →
DEDUCTIONS → PAYOUT → RECONCILED STATEMENT. Not a proposal, CRUD screens or dashboard summaries.
