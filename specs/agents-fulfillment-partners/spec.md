# Spec — Agents / Fulfillment Partners (الوكلاء)

**Status: ACTIVE** (2026-09-28). Owner brief: [`brief.md`](brief.md). Discovery: §1. Design: §2–§10.
Open decisions: §11.
**Amended 2026-09-29 by [`commission-policy.md`](commission-policy.md)** — per-class commission rates,
item overrides and actual carrier-cost reimbursement supersede the single rate (§2) and the flat
shipping fee (§8) described below. This is NOT the internal employee sales-commission module (`CommissionPlan`,
HR/payroll); nothing here reads or writes those tables.

## 1. Discovery — integration points

| Area                 | Existing                                                                                                                                                                                                                                                                                                   | Used by Agents as                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity             | `User` + direct `UserPermission` grants; JWT `{sub,email}`; `JwtAuthGuard` on ~149 controllers; `PermissionsGuard` + `@PermissionModule`; super admin bypass. No internal/external flag. Investor Portal is a separate identity (own JWT secret) — not reused because the brief requires the shared login. | `User.userType = AGENT` + `agentId` + `agentRole`; deny-by-default guard (§3).                                                                                            |
| Scoping              | `SalesScopeService` (`ALL/TEAM/OWN/NONE` by `employeeId`/`salesEmployeeId`); `shipping.view` ⇒ all orders; `GET /shipping` unscoped; pickers open on any create permission; Import Center gated only by `import-center.manage`; lead round robin pool = every user with `crm.leads.edit`.                  | Agents never reach these endpoints (deny-by-default). Internal pools exclude agent users. Agent data is served only by `/agent-portal/*` with server-derived `agentId`.   |
| Partner              | `Partner` + `PartnerRoleAssignment` (`CUSTOMER/SUPPLIER/EMPLOYEE/OWNER/INVESTOR/OTHER`); control-account subledger via `JournalEntryLine.partnerId`.                                                                                                                                                       | New role `AGENT`; each Agent has one Partner (subledger dimension of Agent funds payable).                                                                                |
| Products / stock     | `Product` has no owner; `InventoryMovement` append-only, signed qty, `referenceType/Id`; on-hand = Σ non-reservation movements. Store orders deduct stock only at `generate-invoice` (`postSalesDelivery`).                                                                                                | `Product.ownerAgentId` (+ immutable once stock/lines exist); `InventoryMovement.ownerAgentId` snapshot. Agent orders deduct stock at dispatch, not via a company invoice. |
| Leads / orders       | `Lead` → `StoreOrder` (`WorkflowEngineService.convertLead`); `StoreOrderItem.agreedAmount` = line total; order total = Σ lines; no shipping/discount/tax columns; tax only at invoice.                                                                                                                     | `agentId` on Lead/StoreOrder; pricing columns on StoreOrder (§5).                                                                                                         |
| Fulfillment          | `evaluateFulfillmentGate` (COD allowed; PREPAID needs declared PAID or verified); shipments state machine under `shipping.edit`.                                                                                                                                                                           | Unchanged; the gate uses the payable total. Agent orders enter the same queues with an Agent filter/badge.                                                                |
| Payments             | `Payment` claims (`PENDING/MATCHED/VERIFIED/REJECTED/DISPUTED`, `declarationKind FULL/PARTIAL`, settlement status); declaration core; reconciliation per `PaymentMethod.requiresReconciliation`; `PaymentSettlement` (clearing → bank, fee).                                                               | Reused. Claims carry `agentId` + `destinationOwnership`. Company-destination posting credits Agent funds payable instead of customer AR.                                  |
| Accounting           | Posting engine (idempotent per sourceType+sourceId), `PostingSettings`, FX with EGP functional currency, rate snapshots.                                                                                                                                                                                   | New sources `AGENT_CHARGE`, `AGENT_PAYOUT`, `AGENT_REFUND`, `AGENT_ADJUSTMENT`; three new PostingSettings accounts (§11 D1).                                              |
| Statements / payouts | `InvestorLedgerEntry` (append-only, unique source key) and `DistributionPayment` are the precedent.                                                                                                                                                                                                        | `AgentLedgerEntry`, `AgentPayout` (+ allocations).                                                                                                                        |
| Print / export       | Shared print engine (statement template), client export over scoped list APIs.                                                                                                                                                                                                                             | Agent statement printed with the statement template.                                                                                                                      |

## 2. Domain model

- **Agent** `AG-####`: partner link, legal/commercial name, contacts, currency (settlement currency),
  status `ACTIVE/INACTIVE`, notes. Inactive agent ⇒ its users cannot log in or call the API; no new
  orders; Finance can still settle and pay out.
- **AgentAgreement**: effective-dated (`effectiveFrom`, optional `effectiveTo`), status
  `DRAFT/ACTIVE/ENDED`; server rejects overlapping active ranges (serialized per agent). Terms, all
  explicit (no silent defaults, §11):
  - `commissionRatePercent` (0–100, 4 dp) on the **commission base** = merchandise/service net amount
    (lines' agreed amounts after discounts), excluding tax, customer shipping charge and service
    charge.
  - `commissionEarningEvent`: `DELIVERED` (shipment delivered / pickup handed over / digital-only
    order verified paid) or `PAYMENT_VERIFIED`.
  - `returnCommissionTreatment`: `REVERSE` or `RETAIN` (for returned merchandise after the earning
    event).
  - `customerShippingChargeOwner`: `COMPANY` (retained by us as a separate deduction) or `AGENT`.
  - `shippingFeePerShipment`, `returnFeePerShipment`, `serviceFeePerOrder` — amounts charged to the
    agent (may be 0, must be entered).
  - `providerFeesBorneBy`: `AGENT` or `COMPANY`.
  - `allowAgentDestinations` (payments straight to the agent).
  - `payoutHoldDays` (≥ 0).
  - `AgentShippingRate` rows: customer shipping charge by country (+ optional city); used as the
    configured rate on orders.
- **AgentPaymentDestination**: agent × `PaymentMethod` with `ownership` `COMPANY` or `AGENT`, label,
  active. Only internal `agents.edit` manages them; AGENT-owned rows require the active agreement's
  `allowAgentDestinations`.
- **Snapshot**: an order stores `agentAgreementId` and the terms it used (`commissionRatePercent`,
  earning event, return treatment, shipping-charge owner, fees) at submission. Agreement edits never
  touch existing orders or ledger entries. An ACTIVE agreement's terms are immutable — change = end it
  and create a new one.

## 3. Identity and separation (server-enforced)

- `User.userType` `INTERNAL` (default, all existing users) | `AGENT`; `agentId`, `agentRole`
  `ADMIN/SALES`. `userType`/`agentId` are set at creation and immutable; an agent user can never be
  super admin.
- Login embeds `typ: "agent"` and `agentId` in the JWT for agent users. For agent tokens the guard
  re-reads the user and agent on every request (active, not locked, affiliation unchanged, agent
  ACTIVE) — a disabled user or agent loses access immediately.
- **Credentials**: a new or reset agent user holds a temporary password (`mustChangePassword`); until
  it is replaced through `POST /auth/change-password`, every agent request except `/auth/me`,
  `/auth/logout` and `/auth/change-password` answers 403 `MUST_CHANGE_PASSWORD`. A user the company
  deactivated can only be re-activated by the company (the Agent Admin gets 403
  `AGENT_USER_DEACTIVATED_BY_COMPANY`); `agent.team.manage` is never effective for a SALES user.
  The internal Users API refuses every mutation on agent users (409 `AGENT_USER_MANAGED_IN_AGENTS`)
  and lists internal users unless `userType=AGENT|ALL` is requested.
- **Deny-by-default**: an agent token may call only handlers marked `@AgentPortal()` (the
  `/agent-portal/*` controllers, `/auth/*` self-service, attachment staging). Every other endpoint —
  internal lists, shipping, finance, imports, exports, pickers, bulk actions, ids endpoints — returns
  403 for agent tokens even if permission rows exist. Internal tokens cannot call `@AgentPortal()`
  handlers (internal staff use the internal endpoints).
- Permissions: agent users hold only `agent.*` permissions. The resolver ignores any non-`agent.*`
  row for agent users; the users service rejects granting internal permissions to agent users and
  agent permissions to internal users. Agent permissions:
  `agent.dashboard.view`, `agent.leads.view|create|convert`, `agent.orders.view|create`,
  `agent.orders.override_shipping`, `agent.payments.declare`, `agent.records.view_all`,
  `agent.stock.view`, `agent.statement.view`, `agent.payouts.view`, `agent.team.view|manage`.
  Presets: SALES = leads + orders + declare + dashboard; ADMIN = all views + records.view_all + team.
- Agent Admin team management (`agent.team.manage`): creates/deactivates SALES users of their own
  agent and grants only permissions they hold themselves, never `agent.team.manage`; cannot touch
  ADMIN users, other agents, or their own permissions.
- Record visibility inside an agent: `agent.records.view_all` ⇒ all of the agent's records; otherwise
  records the user created or is assigned. Every portal query is built from the server-side
  `agentId`; a record of another agent returns 404.
- Internal pools: lead round robin, sales performance/targets and HR commissions exclude agent users
  and agent orders/leads.
- Internal administration: `/agents/:id` "Agent team" tab (`agents.users.manage`) and the normal
  Users page (shows the user type/agent; internal-permission matrix hidden for agent users).

## 4. Products and inventory ownership

- `Product.ownerAgentId` (nullable = company-owned, unchanged behavior). It can be set/changed only
  while the product has no inventory movement and no order line; afterwards it is immutable (409).
  **Initial release: one owner per SKU**, so owner-aware stock = the product's movements.
- `InventoryMovement.ownerAgentId` is written from the product at insert (history never rewritten).
- Agent stock (portal and workspace): on-hand, reserved, available, shipped (Σ `SALES_DELIVERY`),
  returned (Σ `SALES_RETURN`) per product/warehouse. Stock receipt for agent goods = internal
  inventory "opening balance/adjustment (receipt)" on the agent-owned product (existing endpoints,
  owner stamped automatically).
- SERVICE / non-inventory products (courses) never move stock and never require shipping.
- **Company documents never carry agent goods**: company leads, lead → order conversion, store
  orders, sales quotations / orders / invoices / returns and purchase documents reject agent-owned
  products (422 `AGENT_PRODUCT_IN_COMPANY_DOCUMENT`); a product's owner locks once any movement,
  lead or order/document line references it.
- **One owner per order**: the order's `agentId` is derived server-side from its lines' owner. Mixed
  owners, or company products in an agent order, are rejected (`MIXED_OWNER_ORDER`). Never inferred
  from a client field.

## 5. Order pricing (agent orders)

Stored on `StoreOrder`: `pricingMode` (`SHIPPING_ADDED` | `SHIPPING_INCLUDED`; null for legacy
orders), `merchandiseAmount`, `discountAmount`, `taxAmount`, `shippingCharge`,
`shippingChargeSource` (`NONE` | `RATE` | `MANUAL`), `shippingRateAmount` (the configured rate at
entry), `serviceCharge`, `payableTotal`. Legacy orders keep `payableTotal = null` and use Σ lines as
today (`storeOrderPayableTotal()`).

- **A — Shipping added / الشحن يُضاف**: each line's agreed amount is entered; merchandise = Σ lines;
  payable = merchandise + tax + shipping + service charge. 1,000 + 100 = 1,100.
- **B — Shipping included / السعر شامل الشحن**: the agreed final total and the included shipping
  are entered; merchandise = total − shipping − service charge; payable = the agreed total.
  1,000 incl. 100 ⇒ 900 + 100.
- **Allocation (B, several lines)**: merchandise is split over lines in proportion to their weights
  (entered line amounts, else list price × qty, else qty), rounded to 0.01 with the largest-remainder
  method; ties broken by line order. Σ lines always equals merchandise exactly.
- **Shipping charge**: SHIPPING orders take the configured rate (agreement rate for the
  destination country/city). A different amount, or an amount when no rate exists, needs
  `agent.orders.override_shipping` and a reason and is audited (`MANUAL`, rate snapshot kept). If no
  rate exists and the user may not override, submission is blocked — the included shipping is never
  guessed or silently zero. PICKUP and digital-only (no inventory line) orders: shipping = 0,
  `NONE`. A separately agreed service charge is its own field.
- **Validation**: all amounts ≥ 0; merchandise > 0; in B, shipping + service < total; currency =
  agreement currency.
- **Discount / tax**: `discountAmount` = Σ max(0, list price × qty − line amount) (informational;
  the net line amounts are the commercial amounts, as for existing store orders). Tax: agent orders
  do not create a company sales invoice (the merchandise is not company revenue), so no company
  output tax is computed on the merchandise; `taxAmount` stays 0 and is shown. See §11 D2.
- Breakdown shown live before submission, on the order, on the slip, and on the statement.

## 6. Order lifecycle (reuses existing workflows)

1. Agent Sales creates a lead (agent-scoped, never distributed to internal staff; duplicate check
   inside the same agent only; optional preferred fulfillment used as the conversion default) or a
   direct order; conversion reuses `WorkflowEngineService.convertLead` with the agent pricing input.
2. Payment declaration reuses the declaration core: Unpaid / Paid in full (= payable total) /
   Partial (explicit amount), method limited to the agent's active destinations, date, reference,
   proof. Declaration ≠ verification. Full declaration of a prepaid order satisfies the existing
   gate; partial never does; COD and pickup rules unchanged.
3. The order appears in the internal Store Orders and Shipping queues (Agent column, filter,
   badge). Only internal Shipping (`shipping.edit`) moves shipment states.
4. **Dispatch** (shipment → SHIPPED, or pickup handover): stock is issued once (`SALES_DELIVERY`,
   idempotent per order), agent charges start (§8). Agent orders cannot use `generate-invoice`
   (no company sales invoice / revenue for agent merchandise).
5. Returns: internal Shipping records a return receipt (full or per-line quantities) ⇒
   `SALES_RETURN` movements + ledger effects. Cancellation before dispatch creates no charges.

**Agent customers.** The agent enters name, mobile, country, city and address only. The customer is
resolved among that agent's own customers (a CUSTOMER-only partner whose orders and leads all belong
to the agent), otherwise a new CUSTOMER partner is created — agent flows never adopt, update or add
roles to a shared Partner. The customer exactly as typed (and each line's stock flag) is frozen in the
order snapshot; the portal shows only that. The order's destination city is `city ?? customer city`
(lead city on conversion) for both the rate lookup and what is stored. An agent order is owned by a
user of that agent (or unowned when created internally without one) — never by an internal user.

## 7. Payment destinations and verification

- COMPANY destination: existing Finance flow (match/confirm or reconciliation). Posting:
  Dr method clearing / Cr **Agent funds payable** (partner = agent). Provider settlement unchanged
  (clearing → bank, fee); a settlement batch may mix agents — each payment line keeps its agent.
- AGENT destination: no company cash — company match / reject / dispute, bank statement matching and
  cash-flow adoption refuse or skip these claims (`AGENT_DESTINATION_USE_AGENT_COLLECTIONS`). Finance reviews the evidence in the **Agent collections**
  queue and verifies or rejects. Verified = memo line on the statement (collected by agent), no
  cash JE, no credit to the agent.
- Stages shown per payment: Declared → Finance verified/matched → Held with provider/courier →
  Settled/received → Pending eligibility → Available for payout → Paid out.

## 8. Agent ledger, commission and statement

`AgentLedgerEntry` (append-only, unique `(sourceType, sourceId, entryType)`, amounts in the agreement
currency, `availableAt`). **Balance = credits − debits = what we owe the agent**; negative = the agent
owes us.

| Event                                | Entry                                                                                         | Effect                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Company-destination payment verified | `COLLECTION_RECEIVED`                                                                         | credit (available once settled/received, earning event reached and hold days elapsed) |
| Agent-destination payment verified   | `COLLECTION_BY_AGENT`                                                                         | memo (0)                                                                              |
| Earning event                        | `COMMISSION` = rate × commission base                                                         | debit                                                                                 |
| Earning event, shipping order        | `CUSTOMER_SHIPPING_RETAINED` (only if owner = COMPANY)                                        | debit                                                                                 |
| Dispatch                             | `SHIPPING_FEE`                                                                                | debit                                                                                 |
| Earning event                        | `SERVICE_FEE` (+ customer `serviceCharge` retained)                                           | debit                                                                                 |
| Settlement with fee, borne by agent  | `PROVIDER_FEE` (payment's share)                                                              | debit                                                                                 |
| Return received                      | `COMMISSION_REVERSAL` (if REVERSE, returned share), `RETURN_FEE` (once per returned shipment) | credit / debit                                                                        |
| Refund paid by company               | `CUSTOMER_REFUND`                                                                             | debit                                                                                 |
| Payment verification reversed        | `COLLECTION_REVERSAL`                                                                         | debit                                                                                 |
| Payout confirmed / reversed          | `PAYOUT` / `PAYOUT_REVERSAL`                                                                  | debit / credit                                                                        |
| Finance adjustment (reason)          | `ADJUSTMENT`                                                                                  | either                                                                                |

A sale is never credited twice: the order itself credits nothing; only received money does.
GL: charges post `AGENT_CHARGE` (Dr Agent funds payable / Cr commission revenue or fulfillment
service revenue), refunds `AGENT_REFUND`, payouts `AGENT_PAYOUT` (Dr Agent funds payable / Cr paying
account). Every posting is idempotent through the posting engine; while the agent accounts are not
configured, ledger entries are recorded with `postingStatus = PENDING_CONFIGURATION` and Finance posts
them later (§11 D1) — nothing is posted to guessed accounts.

Ledger dates: every entry backed by a journal carries that journal's date (collections = the Customer
Receipt's journal date; collection / provider-fee / payout reversals = the reversal journal's date).
Statement periods are calendar days `YYYY-MM-DD` bounded like every other OMS report (UTC day,
same as the accounting reports and `buildDateRangeFilter`), so the statement and the GL cut the same
day. The ledger is append-only at the database: amounts, type, source, links (order / payment /
payout), basis and memo never change, `postingStatus` only moves forward from
`PENDING_CONFIGURATION`, the journal link is set once, `availableAt` (computed) may be refreshed;
DELETE and TRUNCATE are refused.

Statement: period filter, opening balance, lines (date, type, source reference with link, order,
debit, credit, running balance, currency, collection/settlement reference, memo lines), payouts,
closing balance; summary: merchandise sales ex-shipping, customer shipping charges, total order
value, discounts, tax, returns/refunds, commission base/rate, deductions, collections by company vs
agent, pending, available, paid out. Export + print (shared statement template).

## 9. Payouts

Finance (`agents.payouts.create`) opens the agent's payout screen: available balance, eligible
entries, deductions; enters amount (≤ available), currency (= agreement currency), paying account,
date, reference, evidence. Creation locks the agent row (`SELECT … FOR UPDATE`) and uses an
idempotency key; allocations record which credits are paid (FIFO by `availableAt`). Partial payouts
leave the remainder available. Confirmation posts `AGENT_PAYOUT` and the `PAYOUT` ledger entry;
reversal posts the reversal and `PAYOUT_REVERSAL`. Agent Admin sees payouts and evidence, read-only.
A refund/return after a payout makes the balance negative; it is carried forward and netted against
later collections (or settled by an agent repayment recorded as `ADJUSTMENT`) — §11 D5.

## 10. UI

- Internal: `الوكلاء / Agents` list → workspace tabs: Overview, Agreements, Payment destinations,
  Products & stock, Agent team, Orders, Statement, Payouts. Finance: Agent collections queue, payout
  dialog, agent posting accounts in Accounting settings. Store Orders / Shipping lists: Agent
  column + filter.
- Agent portal (agent users only, same AppShell, role-specific navigation): Dashboard, Leads,
  Orders (+ new order with the two pricing modes and live breakdown), Order detail (progress,
  declaration), Stock, Statement, Payouts, Team.
- Approved design system, Arabic/English, RTL/LTR, desktop → mobile, toasts for every outcome.

## 11. Open decisions (recommended defaults applied; owner to confirm)

| #   | Decision                                                                                                                | Default in this release                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | GL accounts for **Agent funds payable** (liability), **Agent commission revenue**, **Fulfillment service revenue**      | Settings fields added; local/demo use new tagged accounts. Production postings stay `PENDING_CONFIGURATION` until the owner names the accounts; company-destination verification of agent orders is blocked with a clear message until D1 is set. |
| D2  | Tax on agent merchandise and on our commission/fees                                                                     | OMS records no company output tax on agent merchandise; commission/fee tax is not calculated (no tax invoice to the agent yet).                                                                                                                   |
| D3  | Contract terms per agent (rate, earning event, return treatment, shipping-charge owner, fees, provider fees, hold days) | Explicit agreement fields — no system default; demo agents use tagged demo values.                                                                                                                                                                |
| D4  | Multi-owner SKUs and mixed-owner orders                                                                                 | Not supported: one owner per SKU and per order.                                                                                                                                                                                                   |
| D5  | Negative balance after payout                                                                                           | Carried forward and netted; no automatic claw-back; Finance may record an agent repayment.                                                                                                                                                        |
| D6  | Agent orders in a currency other than the agreement currency                                                            | Rejected in this release.                                                                                                                                                                                                                         |

### Finance notes (B2 implementation — owner to confirm)

Explicit treatments the implementation had to state; none silently invents policy.

- **Retained customer shipping is not reversed on return** — the shipping service was performed.
  (`CUSTOMER_SHIPPING_RETAINED_REVERSAL` exists in the vocabulary but nothing writes it.) Owner to confirm.
- **Commission base excludes returns received before the earning event**; returns after it reverse
  the returned share (REVERSE) cumulatively, never above the commission. Owner to confirm.
- **Two service-fee lines at earning**: the agreement's per-order service fee and the customer
  service charge (retained by the company) — separate `SERVICE_FEE` entries. Owner to confirm.
- **PAYMENT_VERIFIED earning before dispatch**: if such an order is later cancelled, the commission
  stays until Finance records a refund/adjustment (no automatic reversal). Owner to confirm.
- **Provider fee share** = settlement fee × line amount / settlement gross (claim currency,
  largest-remainder rounding); FX differences are never part of it. Recovery posts Dr Agent funds
  payable / Cr Payment Gateway Fees. A reversed settlement credits the share back (`ADJUSTMENT`,
  mirrored JE). Owner to confirm.
- **Availability**: a company collection is available once (a) received (non-reconciled method, or
  fully settled), (b) the order's earning event is reached, and (c) hold days have elapsed since the
  later of the two. Reversals of charges and Finance credit adjustments are available from their
  entry date. Available = available credits − all other debits (incl. payouts), floored at 0 (D5).
- **Collections are keyed by the Customer Receipt** (`PAYMENT_RECEIPT`, receipt id), not the payment,
  so a corrected re-match credits exactly once more after its `COLLECTION_REVERSAL`.
- **Company-paid refunds and payouts require configured agent accounts** (they move real money);
  charges may be recorded `PENDING_CONFIGURATION`. Refunds are bounded by what was collected on the
  order (company vs agent separately).
- **Finance adjustments** post against Fulfillment service revenue as specified. An agent's cash
  repayment (D5) would need a cash/bank counter account instead; this is not implemented. Owner to decide.
- **Return fee = once per returned shipment** (the agreement's "per shipment" fee). A return receipt
  may name the returned parcel (`shipmentId` = the order's shipment attempt): the fee is keyed by that
  shipment, so several partial receipts of one parcel charge it once. Without a shipment, only the
  order's first receipt charges by default; `chargeReturnFee` overrides either default explicitly
  (e.g. a second parcel after a reship). Owner to confirm.
- **Provider-fee reversal** (settlement reversed): a posted fee share is reversed by mirroring its own
  journal (posting-engine reverse, original amounts and rate), never re-posted at today's rate; a
  share still pending configuration is credited back pending as well.
- **Agent GL accounts are locked once used**: the three agent accounts cannot be changed while any
  agent ledger entry is POSTED (409 `AGENT_ACCOUNTS_LOCKED`), and each must be unrestricted or locked
  to the functional currency (`AGENT_ACCOUNT_CURRENCY`). Paying accounts for payouts/refunds take the
  account's currency, else its ledger account's (as settlements).
- **Management reporting**: agent orders are not company sales. Order Economics (per order and the
  Orders list profitability), Management P&L / Profitability analytics and investor sale allocation
  cover company orders only (`agentId` null); an agent order's economics endpoint answers 422
  `AGENT_ORDER_NO_COMPANY_ECONOMICS`. The company's income from agent orders is its commission, fees
  and retained charges — on the agent statement and posted to the GL (`AGENT_CHARGE`).
- **Agent pickups** are returned only through the agent return receipt (the pickup `RETURNED`
  status is refused for agent orders), so stock, return fee and commission reversal stay in one place.
- **Non-EGP agents**: the agent payable is credited/debited at each entry's own rate. FX differences
  on the payable are not realized at payout (existing FX revaluation only). Owner to confirm.
