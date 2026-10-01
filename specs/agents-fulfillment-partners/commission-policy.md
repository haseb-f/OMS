# Spec amendment — Agent commission and shipping policy (2026-09-29)

**Status: ACTIVE.** Owner brief received 2026-09-29 (Part A), corrected the same day by the owner's
confirmed decisions (explicit item type, predetermined agent shipping charge, customer shipping owned
by the company). This amendment **supersedes** `spec.md` where they differ: §2 (commission and
shipping terms), §8 (COMMISSION, SHIPPING_FEE and CUSTOMER_SHIPPING_RETAINED rows) and the matching
Finance notes in §11. Everything else in `spec.md` stands (earning event, returns, discounts, taxes,
collections, availability, payouts, statement, FX).

## A1. Authoritative examples (acceptance anchors)

**Commission by item type** (no shipping): products 100,000 @ 35% = 35,000; services 100,000 @ 25% =
25,000 → commission 60,000.

**Shipping** (excluding tax and other adjustments):

| Item                                                  | Amount  |
| ----------------------------------------------------- | ------- |
| Product sales                                         | 1,000   |
| Customer shipping (collected, belongs to the company) | 100     |
| Total collected                                       | 1,100   |
| Product commission 35%                                | 350     |
| Predetermined agent shipping charge                   | 100     |
| **Company retains** 350 commission + 100 shipping     | **450** |
| **Agent entitlement**                                 | **650** |

The 100 customer shipping retained **is applied against** the 100 predetermined agent shipping
charge — the agent is **not** charged another 100.

Four amounts are always kept distinct:

1. Merchandise/service **sales** and their **commission** (company commission revenue).
2. **Customer shipping collected** for the company (retained from collected funds).
3. The **predetermined agent shipping charge** (settled by the retained customer shipping).
4. The **actual carrier cost** incurred by the company — company Shipping Expense and order
   profitability only; it **never** creates an agent deduction.

## A2. Explicit item type

`Product.itemType`: `PRODUCT` | `SERVICE` (nullable = not yet classified).

- A product may be stocked or non-stocked; stocking stays the separate `isInventoryItem` setting.
  Courses and similar offerings are `SERVICE`.
- Commission rates resolve from `itemType`, **never** from the inventory-item flag.
- Migration classifies only what is reliable: existing `type = SERVICE` → `SERVICE`; stocked items
  (`isInventoryItem = true`, not `SERVICE`) → `PRODUCT`. Every other item (non-stock, non-service)
  stays **unclassified** and is listed for review (Products filter "Item type: not set", impact
  script).
- An agent order line whose product has no item type is **rejected** (`AGENT_ITEM_TYPE_REQUIRED`) —
  never guessed.

## A3. Agreement terms

`AgentAgreement` (effective-dated; ACTIVE terms immutable):

- `productCommissionRatePercent` (existing `commission_rate_percent` column) and
  `serviceCommissionRatePercent` — 0–100, 4 dp, both required. Migration backfills the service rate
  with each agreement's single legacy rate (identical economics).
- `shippingPolicy`:
  - `PREDETERMINED_CHARGE` (the confirmed model): the agent shipping charge is the agreement's
    configured shipping rate for the order's shipping type and destination (Shipping → the
    country/city rate; Pickup and digital-only → 0). Requires `customerShippingChargeOwner = COMPANY`
    and `shippingFeePerShipment = 0` (the charge is not a second per-shipment fee).
  - `FLAT_FEE_PER_SHIPMENT`: legacy — every existing agreement is migrated to it (unchanged).
  - `NONE`: no agent shipping charge; `shippingFeePerShipment` must be 0.
- Percentages only; no formulas. **Preview before activation**
  (`GET /agents/:id/agreements/:agreementId/preview`): each agent product's item type, rate source and
  rate, plus the worked example (defaults: the A1 shipping example).

## A4. Item-level override and resolution order

`AgentProductCommissionOverride` (append-only history, effective-dated, scoped to the owning agent):
rate 0–100 (**0% valid**), `effectiveFrom` ≥ today (history is never rewritten), optional reason. A
new setting closes the open one the day before it starts; "inherit" ends it.

Resolution per line on the order date: item override → agreement rate for the item type → otherwise
the order is rejected (`AGENT_COMMISSION_RATE_MISSING` / `AGENT_ITEM_TYPE_REQUIRED`). Missing
configuration never becomes 0%.

## A5. Per-line calculation and snapshot

At submission each line snapshot stores
`{ productId, inventoryLine, commission: { commissionClass (PRODUCT|SERVICE), rateSource, ratePercent, overrideId } }`;
the order snapshot stores the `agentShippingCharge` (`amount`, `source` = RATE / PICKUP /
DIGITAL_ONLY, `rateId`). Later configuration changes never touch existing orders.

At the earning event (unchanged trigger): per line `base = net line amount − returns before earning`,
`commission = round2(base × rate)`, aggregated into one `COMMISSION` entry whose per-line detail is in
`agent_commission_lines`. Returns after earning (REVERSE) reverse per line. Discounts (net amounts),
taxes (excluded, D2) and RETAIN are unchanged. Orders submitted before this amendment keep their
single rate with order-level rounding.

## A6. Shipping settlement

- **Customer shipping ≠ predetermined charge** (e.g. a permitted manual shipping override) —
  decided 2026-10-01 (owner decision O1, `order-operations-r5/amendment-owner-decisions-20261001.md`):
  allowed; the **company bears a shortfall and keeps an excess** (platform policy). One
  `CUSTOMER_SHIPPING_RETAINED` = customer shipping, basis `{ agentShippingCharge,
appliedToAgentShippingCharge: min(C, F), difference: C − F, differenceBorneBy: 'COMPANY' }`; no extra
  agent debit or credit, so the agent's entitlement is as if C = F. The agent sees C and F only.
- **Equal amounts** (the normal case): at the earning event one `CUSTOMER_SHIPPING_RETAINED` debit
  (= customer shipping) is recorded, with basis
  `{ agentShippingCharge, appliedToAgentShippingCharge, difference: 0 }` — no further agent shipping
  debit. GL: Dr Agent funds payable / Cr Fulfillment service revenue (existing `AGENT_CHARGE`).
- Cancellation before the earning event records nothing. The retained shipping is not reversed on a
  return (the shipment was performed); a customer refund of shipping follows the existing refund
  flow.
- **Actual carrier costs**: imported and matched as today (`CarrierCharge`, kinds
  `BASE`/`SURCHARGE`/`CREDIT`, paid tracking) for order profitability and carrier accounting only. A
  surcharge/credit needs a confirmed base in the same currency and never takes the net below zero. No
  carrier invoice ever writes an agent ledger entry.

## A7. Agent commission report and statement

`GET /agent-finance/agents/:id/commission-report` (internal) and `GET /agent-portal/commission-report`
(agent Admin): per line — item, item type, sales, base, rate + source, commission, reversed; per
order — customer shipping collected, predetermined agent shipping charge, retained (applied),
difference, actual carrier cost (company expense, carrier currency, informational); summary —
products vs services sales/commission, total commission, shipping retained, other charges, **agent
net entitlement** (sales + customer charges − returns − commission − shipping retained − other
charges) and, separately, the cash view (collected by company/agent, pending, available, paid out).

## A8. Acceptance (automated, real Postgres)

A1 commission example; A1 shipping example (650); stocked product, non-stock product and service
rates by item type; unclassified item refused; override incl. 0% and effective dates; shipping added
and shipping included; pickup/digital (no shipping); difference refused; carrier charges (base, late
surcharge, credit, duplicate import, re-confirm) never touching the agent ledger; return and partial
refund; partial collection and prior payout; legacy single-rate order.

## A9. Historical records

- Old interpretation: one rate on all merchandise + optional flat per-shipment fee + customer
  shipping owned per agreement. Migration keeps every existing agreement identical (service rate =
  legacy rate, policy `FLAT_FEE_PER_SHIPMENT`); no ledger entry, posting or payout is recalculated.
- Production holds only tagged demo agents (`DEMO-AGT-20260928`); their charges are
  `PENDING_CONFIGURATION` (D1) — nothing was posted to the GL.
- `prisma/scripts/agent-commission-impact.ts` (read-only) lists earned orders under the legacy
  interpretation, what the corrected terms would give, and unclassified items. Correction plan if the
  owner applies the new terms retroactively: one reasoned Finance `ADJUSTMENT` per order — never an
  edit of the original entry.

## A10. Open questions for the owner

| #   | Question                                                                                                                                   | Current behavior                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| C1  | Customer shipping ≠ predetermined agent charge: who bears/receives the difference?                                                         | Refused with both amounts shown (A6 options a–c) |
| C2  | "Shipping type/service": is destination (country/city) + Shipping/Pickup the full set, or should rates also vary by carrier/service level? | Destination + Shipping/Pickup                    |
