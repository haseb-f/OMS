# ADR-0018: Order Economics Engine — Milestone 2 (direct-cost contribution profitability)

Date: 2026-09-16
Status: Accepted

## Context

M2 asks for a per-Order management-profitability layer — "how much did this
Order actually contribute after the costs directly caused by fulfilling
it" — built on top of M1's Cost Engine (ADR-0017). The business policies
this ADR encodes (revenue basis, cost formula, estimate-vs-actual handling,
what stays out of scope) were specified directly by the user, not derived
by an audit; this ADR's job is to record them precisely and record exactly
how much of the surrounding system this milestone actually builds.

**M2 is being closed in two tiers, not built in full.** The read-side
calculation — Revenue, historical COGS, Gross Product Profit, and Shipping
Cost wherever `Shipment.baseShippingCost`/`additionalShippingCost` are
already populated — is implemented and tested this milestone, because it
consumes data that already exists in this schema today. Everything that
would require _inventing a new data-capture mechanism_ (how does an actual
shipping cost or a payment gateway's actual fee even reach this system? a
manual form? a carrier API? a CSV import?) is deliberately deferred: those
are integration-design decisions, not business-policy decisions, and
guessing the wrong shape of capture flow is worse than building none yet.
Building a `Contribution Profit` formula against fields that don't exist
yet would mean fabricating zeros where the spec explicitly says "unknown
cost is not zero" — so this milestone reports cost completeness honestly
instead.

## Decisions — canonical formula

```
Net Revenue              = sum(StoreOrderItem.agreedAmount)
− Historical COGS         = sum(SalesInvoiceItem.unitCost × quantity), per item, from the
                            StoreOrder's generated SalesInvoice (never today's Product cost)
= Gross Product Profit
  Gross Margin %          = Gross Product Profit / Net Revenue × 100 (Net Revenue > 0 only)

− Direct Shipping Cost     = sum(baseShippingCost + additionalShippingCost) across EVERY
                            Shipment row linked to the Order (every attempt, delivered or
                            not — a failed attempt's cost was still incurred; never latest-
                            attempt-only, never overwritten by a reshipment)
− Packaging / Fulfillment  = not yet captured anywhere in this schema — UNKNOWN, not 0
− Payment Transaction Fee  = no PaymentMethod/Payment fee field exists yet — UNKNOWN, not 0
− Direct Return Costs      = no StoreOrder return/refund lifecycle exists yet (ADR-0017
                            §"no complete StoreOrder return operational lifecycle") — UNKNOWN
= Contribution Profit     (sum of only the components actually known)
  Contribution Margin %   = Contribution Profit / Net Revenue × 100 (Net Revenue > 0 only)
```

**Revenue basis.** `StoreOrderItem.agreedAmount` is the authoritative
transaction amount — no `listPrice − agreedAmount = discount` is fabricated
anywhere; no discount entity exists in this schema to source one from.

**VAT.** `StoreOrder`/`StoreOrderItem` do not separate a VAT component from
`agreedAmount` anywhere in the current schema (confirmed by direct read —
no `taxId`/`taxAmount` field on either model). Net Revenue is therefore
`agreedAmount` as-is; this ADR does not subtract an assumed rate. If
StoreOrder gains real tax separation later, this service starts reading it
without a re-decision.

**COGS.** Sourced exclusively from `SalesInvoiceItem.unitCost` — the exact
snapshot `SalesReturnPostingProvider` already replays for return reversals
(ADR-0017/this milestone's own Sales Return fix) — reached via
`StoreOrder.invoices` (`SalesInvoice.storeOrderId`). Never `Product.currentCost`.
`unitCost` is nullable (non-inventory items, and invoice lines predating the
TASK-057 snapshot); a null line means that line's COGS is **UNKNOWN**, not
zero, and the Order's overall cost state reflects that.

**Shipping.** Every `Shipment` row for the Order counts, regardless of
`status` — `ShipmentStatus` (`DELIVERY_FAILED`, `NEEDS_RESHIPMENT`, …) marks
delivery outcome, not whether a cost was incurred. A failed attempt's cost
is never zeroed out or overwritten by the next attempt's row. Because this
schema has no `estimated` vs `actual` distinction on `Shipment` — only the
two already-existing nullable cost fields — "Actual supersedes Estimate" has
no live case yet; documented for when that distinction is added, not
implemented against fields that don't exist.

**Cost completeness.** Every Order Economics result carries a `costState`
(`COMPLETE | PARTIAL | UNKNOWN`) per component and overall — `COMPLETE`
requires every contributing line/shipment to have real data, `UNKNOWN` when
none does, `PARTIAL` otherwise. Because Packaging and Payment Fee have zero
data sources today, no Order can show an overall `COMPLETE` state yet — that
is correct, not a bug, per "unknown cost is not zero."

**Excluded from Contribution Profit, permanently, not just this milestone**:
Marketing, general payroll, rent, G&A, depreciation, finance costs, and any
other company-level overhead. This is a direct-cost layer, never a full P&L
allocation.

## Explicitly deferred (not built this milestone)

- Shipping cost _capture_ (who enters `baseShippingCost`/`additionalShippingCost`,
  and how) — the fields exist and are read when populated; no UI/API to
  populate them was added.
- Payment transaction fee estimation/reconciliation — no schema field exists
  for it; adding one is a real data-model decision, not made here.
- Packaging/direct-fulfillment cost capture — same reasoning.
- Return-event integration (Contribution impact of a StoreOrder return) —
  blocked on ADR-0017's own documented gap: no complete StoreOrder return
  lifecycle exists to integrate against yet.
- Order Details "Profitability" UI tab, Orders-table optional columns, Cost
  Explorer extension to Order/Shipment/Payment sources, CSV export of
  profitability fields.
- Persisted/cached economics snapshots and their recalculation triggers —
  today's implementation computes on demand from live rows; this is fine at
  current scale and avoids inventing a cache-invalidation design against a
  UI that doesn't exist yet.

## What this milestone does ship

- `OrderEconomicsService.getForStoreOrder()` — the one canonical,
  server-side calculation; nothing about Revenue/COGS/Shipping/Contribution
  is computed twice or computed client-side.
- `GET /store-orders/:id/economics`, gated by the new `orders.profitability.view`
  permission (a Sales Agent's existing `store-orders.view` does not imply
  it — company-wide COGS/margin visibility follows the same "separate,
  sensitive action" precedent as `landed-cost`/`cost-explorer.view` in
  ADR-0017).
- Deterministic test coverage for the Gross-Profit/Shipping/Contribution
  formula, multiple shipment attempts, and the legacy-unknown-COGS cost
  state.
