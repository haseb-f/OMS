# Spec 2 — Simple agent product linking and shipping pricing

Supersedes `agents-fulfillment-partners/commission-policy.md` where they differ: A3 shipping rates
(now tariffs by delivery channel × payment arrangement × destination — answers open question C2),
A5 snapshot (now resolved when the delivery channel is known), A7 (actual carrier cost is **no
longer** shown to agent users). A1 examples, A2 item type, A4 overrides, A6 equal-amount settlement
and "carrier invoices never charge the agent" stand unchanged.

## 2A. Product ownership and visibility

Current: `Product.ownerAgentId` (null = company) edited only via a "Owner agent" select in the
product modal for `agents.view` holders; `itemType` PRODUCT/SERVICE nullable; the agent page shows a
read-only product list inside "Products & stock".

Required:

1. Product editor — an **Ownership** segmented choice `Company | Agent`; choosing Agent reveals the
   agent selector (active agents). Item type is shown next to it as an explicit required
   `Product | Service` choice with the helper "independent of stock tracking". The commission
   section (inherit default / item override) is shown for agent-owned products, including new
   products (saved with the product; no second step).
2. Agent page — a dedicated **Products** tab (stock stays in its own tab) listing the agent's
   products with item type, status, effective commission (source: override / agreement) and actions:
   - **Link existing product** — pick a company-owned product (searchable); sets
     `ownerAgentId` through the same product update path (same validation and lock).
   - **New product for this agent** — opens the shared product editor with Ownership = Agent
     pre-selected.
   - **Unlink** — returns to company ownership; refused with the existing 409 when the product is
     referenced (movements, orders, leads, documents) with a readable reason.
   - Commission override per row (reuse `ProductCommissionSection`).
3. Ownership change stays locked once referenced (`assertOwnerUnlocked`, unchanged).
4. Agent employees creating orders/leads automatically see their agent's **active, sellable**
   products (server-scoped — unchanged `findSellableCatalog` + owner re-filter). Empty state:
   agent users — "No products are linked to your agent yet. Ask your agent administrator or the
   company's agent manager to link products." Internal users creating an agent order — same text plus
   a link to the agent's Products tab.

## 2B. Three shipping amounts

| #   | Amount                         | Owner/visibility  | Stored where                                                                              |
| --- | ------------------------------ | ----------------- | ----------------------------------------------------------------------------------------- |
| 1   | Customer shipping charge       | Agent + internal  | `StoreOrder.shippingCharge` (+ source)                                                    |
| 2   | Contractual agent shipping fee | Agent + internal  | `agentTermsSnapshot.agentShippingCharge` (resolved tariff snapshot)                       |
| 3   | Actual carrier cost            | **Internal only** | `Shipment.base/additionalShippingCost` (estimate), CONFIRMED `CarrierCharge` net (actual) |

Company shipping margin = (2) − (3), internal only, shown in order economics/profitability and
internal agent reports, never in any agent-portal response, export, print or error message.

### Tariff model

`AgentShippingRate` gains two dimensions (additive migration, existing rows become `ANY/ANY`):

- `deliveryChannel`: `ANY | CARRIER | INTERNAL_COURIER`
- `paymentType`: `ANY | PREPAID | CASH_ON_DELIVERY`

Unique key `(agreementId, countryId, city, deliveryChannel, paymentType)`. Resolution for
(destination, channel, paymentType): most specific wins — city before country, then exact channel
before `ANY`, then exact payment type before `ANY`. Values are per agreement (configurable), never
global constants.

Worked tariff (agreement example, SAR): Prepaid × Carrier = 25 · COD × Carrier = 35 ·
COD × Internal courier = 25. Prepaid × Internal courier not configured → unresolved (see below).

Delivery channel comes from the shipment's shipping company: `ShippingCompany.type`
`EXTERNAL_COMPANY` → CARRIER, `INTERNAL_DELIVERY` → INTERNAL_COURIER. Internal Shipping chooses the
company (existing `POST store-orders/:id/shipments/shipping-company`, `shipping.edit`). Agents never
choose it.

### Pricing status

New `StoreOrder.shippingPricingStatus`: `NOT_APPLICABLE | PENDING_METHOD | CONFIRMED`
(agent orders under `PREDETERMINED_CHARGE`; company orders and other policies `NOT_APPLICABLE`).

- Pickup / digital-only → `CONFIRMED` with fee 0 (source PICKUP / DIGITAL_ONLY), unchanged behavior.
- At submission, if every channel resolves to the same fee for the destination and payment type →
  `CONFIRMED` immediately (smart default, no waiting).
- Otherwise `PENDING_METHOD`, with a **provisional estimate** = the CARRIER tariff (or the first
  resolvable), stored as `agentShippingCharge.provisional = true` and always labelled
  "Provisional — final when Shipping selects the delivery method".
- When Shipping assigns a shipping company: resolve fee → snapshot
  `{ amount, source: 'TARIFF', rateId, deliveryChannel, paymentType, provisional: false,
resolvedAt, resolvedBy }`, status `CONFIRMED`, activity row with old/new. Missing tariff → the
  assignment is **refused** (`AGENT_SHIPPING_TARIFF_MISSING`, names channel × payment type ×
  destination) so no unpriced agent shipment can dispatch.
- Changing the shipping company before dispatch re-resolves (audited). After dispatch the tariff is
  frozen.
- Dispatch (SHIPPED / pickup handover) of an agent order with `PENDING_METHOD` is refused.

### Shipping-inclusive (`SHIPPING_INCLUDED`)

Agreed customer total never changes. On confirmation: customer shipping component = contractual
fee, merchandise = agreed total − fee (re-allocated across lines by the existing allocation), so
the difference is 0. If the fee exceeds the merchandise room (total − service charge − fee < 0) the
confirmation is refused with both amounts.

### Shipping-added (`SHIPPING_ADDED`)

Merchandise amount shown separately; while `PENDING_METHOD` the customer total is shown as
"Merchandise X + shipping (pending)" — never as final. On confirmation customer shipping = fee.
If the confirmed payable exceeds the provisional payable the order enters
`customerTotalStatus = CONFIRMATION_REQUIRED` (new column: `NONE | CONFIRMATION_REQUIRED |
CONFIRMED`) with old/new totals; an authorized user (internal, or the agent's own order owner/admin)
records "Customer agreed to pay {new total}" (audited). Until then the payment gate treats the
provisional total as the claimable amount. If the customer already paid (declared/verified), the
detail shows paid vs new payable and the outstanding difference; nothing is silently re-billed.
A lower final payable is applied automatically (customer pays less; an existing overpayment follows
the existing refund/overpaid flow).

Pickup and digital-only orders: no automatic physical shipping fee (unchanged).

## 2D. No double deduction

Unchanged mechanics (A6): at earning, one `CUSTOMER_SHIPPING_RETAINED` entry = customer shipping,
applied against the **resolved** contractual fee; no separate shipping debit. Difference ≠ 0 is
allowed since owner decision O1 (2026-10-01): the company bears the shortfall / keeps the excess,
recorded on the basis (`differenceBorneBy: 'COMPANY'`). Carrier invoice imports update actual cost and internal margin only; they never
create an agent ledger entry (regression test). Commission rates, item overrides and snapshots are
unchanged; the commission basis is documented on each commission line (existing).

## 2E. Leak closure (regression-tested)

- Agent portal commission report: remove `shipping.carrier` stages and `summary.carrierCost`
  (portal serializer), hide the carrier-cost column/notes in the portal view.
- Audit every `agent-portal/*` response, export and print payload for `carrier`, `cost`,
  `margin`, `baseShippingCost`, `additionalShippingCost`, `CarrierCharge` — an automated test
  asserts none of these keys appear in portal order/report/statement responses.
- Error messages raised in agent context never include carrier cost values.

## Open business question (ONE)

**D-R5-1 — Customer shipping collected ≠ contractual agent fee** (only possible via a permitted
manual shipping override). Example: fee SAR 25, customer charged SAR 20 (difference −5) or SAR 30
(+5). Options: (a) the agent bears the shortfall / receives the excess; (b) the company bears the
shortfall / keeps the excess; (c) retain only up to the fee, excess goes to the agent, shortfall
charged to the agent. **Answered 2026-10-01 — option (b)** (`amendment-owner-decisions-20261001.md` O1).

## Acceptance

1. Tariff resolution matrix: prepaid carrier 25, COD carrier 35, COD internal 25, prepaid internal
   missing → assignment refused; city beats country; exact beats ANY; legacy ANY rows unchanged.
2. Pending → confirmed on shipping-company assignment; re-assignment before dispatch re-resolves;
   dispatch refused while pending.
3. INCLUDED: agreed total 500, fee 35 → merchandise 465, customer shipping 35, difference 0.
4. ADDED: merchandise 400, provisional 25 → confirmed 35 → confirmation required (425 → 435);
   confirmation recorded; paid 425 shows 10 outstanding.
5. Earning: retained shipping = resolved fee, no second debit; carrier charge import creates no
   agent ledger entry; margin = fee − carrier cost internally (25 − 20 = 5).
6. Portal responses contain no carrier cost/margin keys (automated).
7. Link existing product from the agent tab; unlink refused when referenced; agent employee sees
   only own active sellable products; empty state shown.
