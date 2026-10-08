# R15 — independent chief-accountant review

Reviewer: chief-accountant guardian (read-only). Scope: the uncommitted R15 diff on `integration/r15` (2026-10-08),
against `.claude/guardians/chief-accountant.md`, `erp-decisions.md`, `.claude/OMS.md` accounting rules and D15-1 … D15-21.
Evidence is file:line in `apps/api/src` unless stated. Each finding has a numeric scenario and a suggested fix.
"Not verified" marks anything I could not confirm by execution or data.

## Test runs (this review)

| Database      | Suites                                                                                                                                                                                                                                                                                                                | Result                                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `oms_r15_w5a` | serial: stock-lifecycle, fulfillment-recognition, kit-fulfillment, agent-finance, agent-commission                                                                                                                                                                                                                    | 5 suites, 76/76 PASS                                                                                                                  |
| `oms_r15_w5b` | serial: store-order-money                                                                                                                                                                                                                                                                                             | 9/9 PASS                                                                                                                              |
| `oms_r15_w5b` | store-order-collection, financial-transactions (incl. refunds), payments, payment-settlements, payment-reconciliation, sales/returns, sales-return posting, payment-declaration, store-order payment / receipts, agent shipping-agreements + pricing, company-partners, partner-portal, stock-state, recognition unit | 36/37 suites PASS (319 tests). `company-partners.integration.spec.ts` FAIL (10 tests): fixture collision, see L6 — not a code verdict |

Read-only data checks on `oms_r15_w5a` (test leftovers, 4 515 orders, 314 transit movements, 73 shipment invoices):
no negative on-hand per product × warehouse; no negative per-order transit balance; every `STORE_ORDER_TRANSIT`
TRANSFER pair nets to 0; no duplicate posted JE per source (SALES_INVOICE, FULFILLMENT_COST, SHIPMENT_COST,
SALES_RETURN, receipts/refunds); one invoice per shipment; invoice quantity = `SALES_DELIVERY` quantity for every
shipment invoice; every agent-owned movement carries `owner_agent_id`; no journal entry sourced from transit or
agent goods. (Nine invoices from a 2026-10-07 W5b fixture run issued from a stock warehouse with lines written
directly by the fixture — not produced by the R15 code path.)

## Findings

### HIGH

**H1 — A refunded order advance stays allocatable on its receipt; the same money is "collected" by two orders
(Matching Engine bypass / duplicate allocation).**
Evidence: an advance refund is allocated to the order (`financial_transaction_allocations.store_order_id`), never to
the receipt it pays back. Only the store-order auto path subtracts it (`accounting/store-order-collection/store-order-collection.service.ts:321-461`,
`availableAdvance`). The generic matching path `POST /customer-receipts/:id/allocate` →
`financial-transactions/financial-transactions.service.ts:940-994` checks `amount + fee − Σ allocations` only. The
order position counts every receipt of the order's payments in full as "collected" wherever its money was applied,
and also counts other receipts allocated to its invoices (`financial-transactions/shared/store-order-money.ts:195-237, 331-341`).
Data (`oms_r15_w5b`): CR-2026-002625 (order W5B-65DA44AE-12) settled 150, allocated 0, advance refunded 150 → 150
still allocatable; CR-2026-002626 settled 200, allocated 150, refunded 50 → 50 still allocatable.
Scenario: customer C, prepaid order O1 100 verified (Dr Bank 100 / Cr AR 100), O1 archived, advance refunded 100
(Dr AR 100 / Cr Bank 100) → AR(C) = 0. C owes COD invoice INV-X 100 (O2) → AR(C) = 100. Finance allocates R1's
"unallocated" 100 to INV-X → INV-X shows PAID, O2 balance due 0 (and no carrier COD claim is created), while the GL
says C owes 100. Reverse direction: R1 allocated manually to INV-X, then O1 is cancelled → O1 still shows
refund due 100 (collected counts R1); it is refundable whenever C holds any other credit (e.g. an unallocated 100 on
O3) — after O3's delivery every invoice is PAID but AR(C) = +100.
Fix: make the order-advance refund consume the receipt's matching capacity (allocate refund lines to the source
receipt(s) oldest-first, or store `sourceReceiptId` and subtract it in `allocate`/receipt "unallocated"); compute an
order's "collected" from where each receipt's money is applied (own invoices + own unallocated − own advance
refunds), never a receipt in full; refuse a generic allocation of a store-order receipt beyond the order's
`availableAdvance`. Add the generic-allocate case to `store-order-money.integration.serial.spec.ts`.

**H2 — Lines, quantities and fulfillment method can be amended while the goods are still in transit after a failed
delivery.**
Evidence: R15 keeps failed / reshipment goods in WH-TRANSIT (D15-8), but the amendment window still treats
DELIVERY_FAILED / NEEDS_RESHIPMENT as OPEN (`store-orders/amendments/amendment-impacts.ts:75-112`; only
SHIPPED/OUT_FOR_DELIVERY block contents, `store-order-amendments.service.ts:776`). The amendment updates the line
in place, product included (`store-order-amendments.service.ts:1615-1630`). Delivery caps accepted quantity only by
what the parcel carried, not by ordered − delivered (`store-orders/stock-lifecycle/store-order-stock.service.ts:1092-1099`),
a reship must carry every loose unit (`:997-998`), and a pickup order is always recognised whole from its stock
warehouse (`store-orders/fulfillment-recognition/recognition-routing.ts:83-87`, `fulfillment-recognition.service.ts:501-546`).
Scenarios (company order, line 3 × 100 = 300, moving average 60; 3 units in transit after DELIVERY_FAILED):
(a) quantity amended to 2 (agreed 200) → reship carries 3 → default delivery accepts 3 → invoice line qty 3,
amount `proratedLineAmount(200, 2, 0, 3)` = 200, COGS 180, one unit leaves without any document (margin 20 instead of 80);
(b) product A swapped to B on the same line → delivery issues B from transit → INVENTORY_AVAILABLE_INSUFFICIENT,
recognition FAILED forever; receive-back of A refused (`takeFromTransit`) → A × 3 (180) stranded in WH-TRANSIT;
(c) DELIVERY → PICKUP → READY reserves nothing (open = 3 − 0 − 3 = 0) → COLLECTED issues 3 from the stock
warehouse; the 3 in transit become invisible (`issuedWhole`) → stock warehouse understated by 3, WH-TRANSIT
overstated by 3 (phantom 180 once a count adjusts the warehouse). (W5a's open-issues note assumes the window refuses
this; it does not.)
Fix: treat any order with units in transit (`state.lines.inTransit > 0`) as IN_TRANSIT in `amendmentWindow` (block
items / quantities / product / fulfillment method until received back); in `recordDeliveryInTx` cap accepted at
`ordered − delivered` per line; in recognition refuse a WHOLE_ORDER pickup while the order holds transit goods.

### MEDIUM

**M1 — A return code on an undelivered shipment flags RETURN_PENDING against an earlier, unrelated invoice.**
Evidence: `recognition-routing.ts:27` maps any `*RETURN*` catalog code to RETURN_PENDING regardless of the
shipment's delivery; `fulfillment-recognition.service.ts:713-733` flags the order whenever any invoice exists and
tells the user to post a sales return against the latest invoice.
Scenario: shipment #1 delivered 2 of 3 (INV-1 200); shipment #2 carries the last unit (cost 60) and the carrier sets
RETURN_TO_SENDER before delivery → order RETURN_PENDING "post a sales return against INV-1". Following it credits
100 + restocks 1 on INV-1 and the receive-back of #2 restocks the same unit again → inventory +2 for 1 unit, revenue
reversed for goods the customer kept.
Fix: pass the shipment id; flag RETURN_PENDING only when that shipment has an invoice (delivered); otherwise just
refresh the stock status (goods returning).

**M2 — "Cancelled" means different things to stock and money.**
Evidence: stock treats `deletedAt` OR fulfillment `CANCELLED` as inactive (`store-order-stock.service.ts:2033-2034`);
the money position treats only `deletedAt` as inactive (`financial-transactions/shared/store-order-money.ts:334`), so
`expected = max(invoiced, payable)` stays for a cancelled pickup (`store-orders.service.ts:1664`, pickup CANCELLED
without archive).
Scenario: prepaid pickup 500 verified (advance), pickup CANCELLED → stock released, but refund due 0 /
advanceRefundable 0 → "Record refund 500" refused (REFUND_EXCEEDS_DUE) and the panel shows no "Refund pending"
until someone also archives the order (D15-11 says cancelled advances are refundable).
Fix: one shared `isOrderActive` (archived or fulfillment CANCELLED) used by both the stock service and
`loadStoreOrderMoneyPosition`.

**M3 — The system warehouses are not protected from manual documents.**
Evidence: role checks exist only in the store-order lifecycle, sales returns and warehouse admin
(`grep WarehouseRole`: `inventory.service.ts`, `stock-availability.ts`, `sales-returns.service.ts`,
`warehouses.service.ts`, stock-lifecycle). Manual inventory adjustments, manual transfers, purchase receipts,
physical counts and manual sales invoice lines can still use WH-TRANSIT / WH-DAMAGED, and transit goods carry no
reservation so `assertUnreservedStock` sees them as free.
Scenario: order O1 has 3 × P (180) in WH-TRANSIT; a manual sales invoice line (or adjustment −3) on WH-TRANSIT issues
them → O1's per-order balance still says 3 → O1's delivery fails at the warehouse non-negative check
(recognition FAILED), and WH-TRANSIT no longer reconciles to the open orders.
Fix: refuse TRANSIT-role warehouses on every document outside `StoreOrderStockService` (and DAMAGED for issue /
sale); allow DAMAGED only for receipts and write-off adjustments.

**M4 — A kit recipe changed between dispatch and delivery blocks recognition and receive-back permanently.**
Evidence: delivery / receive-back resolve the current recipe (`store-order-stock.service.ts:1850-1856`,
`fulfillment-recognition.service.ts:511-526`) and refuse when transit holds the old components (`:1665-1685`,
`assertTransitHolds`). Known open issue in progress-w5a.md.
Scenario: kit K = A + B dispatched (transit A1, B1); recipe changed to A + C → delivery needs C1 → FAILED; the
customer has the goods, no revenue / COGS is ever recognised until a manual correction.
Fix: resolve the delivered / returned kit from the dispatch movements (`recipeId` / `parentProductId` on the
transit IN movements of that shipment line) instead of the live recipe.

### LOW

- **L1 — VAT rounding per shipment invoice.** Tax is computed per prorated invoice
  (`fulfillment-recognition.service.ts:997-1015`): line 10.00 × 3 at 14 % delivered one per shipment → tax
  0.47 + 0.47 + 0.47 = 1.41 vs 1.40 on one invoice (customer billed 11.41). Acceptable per-document VAT; consider
  giving the last delivery of a line the tax remainder like the amount.
- **L2 — Migration 100200, ENDED agreement end date.** `(a."ended_at" AT TIME ZONE 'Africa/Cairo')::date` on a
  `timestamp without time zone` (stored UTC) reads the UTC value as Cairo time: ended 2026-09-30 22:30 UTC
  (01:30 Cairo on 1 Oct) → end date 2026-09-30 instead of 2026-10-01 (only when `effective_to` is null). Use
  `(ended_at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo')::date`. The ANY-wildcard expansion and "most specific
  wins" ordering reproduce the old resolver; already-priced orders keep their snapshot — no accounting effect found.
- **L3 — RETURNED not recomputed after a later shipment is invoiced.** `recognizeInTx` keeps RETURN statuses
  (`fulfillment-recognition.service.ts:567-580`): shipment #1 fully returned (RETURNED), shipment #2 delivered and
  invoiced → stays RETURNED instead of PARTIALLY_RETURNED. Call `recomputeStoreOrderReturnStatus` after recognition.
- **L4 — Cut-off.** A FAILED recognition leaves delivered goods in WH-TRANSIT without revenue / COGS; nothing
  stops a period close, and the retry dates the invoice on the retry day. Add a period-close warning listing
  FAILED / due recognitions.
- **L5 — Damaged goods at full cost.** Returns / receive-back to WH-DAMAGED stay at the moving average (e.g. 60 per
  unit) with no NRV step (IAS 2); write-down is a manual inventory adjustment. Consider a prompt / report.
- **L6 — `company-partners.integration.spec.ts` is not isolated.** On `oms_r15_w5a` / `w5b` (and `w4`) two ACTIVE
  "Accept A" agreements (30 % + 20 % from 2026-09-01, open-ended) make the suite's 2035 agreements exceed 100 % →
  10 failures. Partner statement integration therefore **not verified** here; the pure rules
  (`partner-statement-rules.spec.ts`) and the partner-portal suite pass.
- **L7 — Delivered then moved back.** A permissive DELIVERED → DELIVERY_FAILED before recognition leaves the
  accepted units neither recognised nor receivable (state counts them delivered) until moved back to DELIVERED.
- **L8 — COD expected amount fallback.** When recognition failed before the COD hook, the expected claim uses
  prorated line amounts without VAT / service lines (`accounting/store-order-collection/carrier-cod-collection.service.ts:239-282`):
  one 100 line at 14 % → claim 100 instead of 114 (corrected only by matching / verification).

## Verified correct

Stock lifecycle

- Reservation is the reserved ledger only (RESERVATION / RELEASE excluded from on-hand, no JE); available =
  on-hand − reserved over STOCK warehouses; per line all-or-nothing, SHORT recorded, dispatch of unreserved refused.
- Dispatch: own reservation released, then one TRANSFER pair warehouse → WH-TRANSIT keyed per shipment line, inside
  the shipment transaction, no JE, moving average untouched (`inventory.service.ts` `postDocumentTransfer`); a
  dispatched attempt is never transferred twice; OUT_FOR_DELIVERY after SHIPPED is a no-op.
- Delivery: one invoice per delivered shipment (`SalesInvoice.shipmentId` unique + order row lock), issued only out of
  this order's transit balance; COGS = quantity × product moving average snapshotted on the invoice line; prorated
  amounts telescope to the line amount over sequential attempts (e.g. 100 / 3 → 33.33 + 33.34 + 33.33).
- FULFILLMENT_COST once per order, SHIPMENT_COST once per delivered shipment (posting-engine idempotency; no
  duplicates in data).
- Undelivered goods: stay in transit, received back per receipt key — saleable → STOCK (re-reserved while active),
  damaged → DAMAGED; transfers only, no COGS / revenue effect.
- Agent goods: same physical path with `ownerAgentId` on every movement (data: 0 missing); no company invoice, COGS
  or JE; valuation excludes agent-owned stock; in-transit agent returns use receive-back, delivered ones SALES_RETURN.
- Kits issue components (snapshot on the invoice line); service-only orders NOT_REQUIRED; pickup issues straight from
  the warehouse after releasing its reservation.
- Inventory GL vs quantity ledger: consistent by construction — one product-wide moving average, transit and damaged
  are on-hand at the same cost inside the same category inventory accounts, transfers are value-neutral, agent goods
  carry no value (exceptions: H2(c), M3, M4).
  Money
- Declarations never post; a VERIFIED payment posts one receipt (Dr bank / method clearing, Cr AR, unique
  `PaymentReceiptLink`); receipts never create revenue.
- Auto allocation oldest-first across the order's invoices, capped by each invoice's remaining and by the order's
  advance after refunds (overpayment refunded once, never re-allocated by the auto path).
- Carrier COD: delivery creates one PENDING CARRIER_COD claim (key `carrier-cod:<shipment>`), no JE; confirmation
  posts Dr clearing / Cr AR; settlement Dr bank (+fee) / Cr clearing; REVERSED excluded from settlement.
- Returns: request = DRAFT (no stock, no JE), references one posted invoice, capped by invoiced − already returned
  (invoice row lock); receive & inspect restocks (STOCK / DAMAGED, never transit) and posts the credit note reversing
  revenue + COGS at the invoice snapshot cost; last return of a line takes the exact remainder; RETURN_PENDING →
  RETURNED / PARTIALLY_RETURNED; agent orders refused.
- Refunds: collected − refunded − expected (expected = invoiced − credited, or payable while active); credit-note
  credit first, then advance; partner + order row locks (concurrent refunds: one succeeds); Dr AR at the advance rate /
  Cr cash; COD never collected → nothing to refund.
- Payment reversal: VERIFIED only, reason required, reversing entry through the cancel path (posting window enforced),
  never deleted, refused when settled / matched / already refunded, invoices reopened and re-settled.
  Agents / partners / migrations
- Statement deduction unchanged: CUSTOMER_SHIPPING_RETAINED = customer shipping C (basis records agreed charge F and
  the difference borne by the company; no second agent debit); carrier cost / margin never read by pricing; charges
  frozen per channel at submission, confirmed on carrier assignment, never repriced by a later agreement; agreement
  currency = agent settlement currency (currency locked once agreements exist).
- Partner statement: approved due = original + adjustments of CLOSED periods; payments (non-reversed, all time) applied
  oldest-first, remainder = advance; open periods estimated per partner with the same per-partner segment math;
  under-review periods carry no approved amount; no posting code changed.
- Migrations 100000 / 100100 / 100300–100600: additive; the only data moves are the system warehouses, linking existing
  returns to their order (correct for the money position) and permission grants; 100200 tariff move see L2.

## Guardian self-review checklist

| Check      | Result | Note                                                                                              |
| ---------- | ------ | ------------------------------------------------------------------------------------------------- |
| Workflow   | FAIL   | H2 (amendments while goods are in transit), M1 (RETURN_PENDING on undelivered parcel), M2         |
| Posting    | PASS   | Posting Engine only, idempotent, balanced; no duplicate posted JE in data                         |
| Inventory  | FAIL   | H2(b)(c) stranded / mislocated transit stock, M3 unguarded system warehouses, M4 kit recipe       |
| COGS       | PASS   | qty × moving-average snapshot per invoice, reversed at snapshot cost; never for agent goods       |
| Receivable | PASS   | GL AR correct for receipts, credit notes, refunds, reversals (subledger issue is H1 / Matching)   |
| Payable    | PASS   | No payable logic changed; partner payable read-only                                               |
| VAT        | PASS   | Line-level, optional; per-invoice rounding drift ±0.01 (L1)                                       |
| Matching   | FAIL   | H1 — refunded advance remains allocatable; receipts double-counted across orders                  |
| Journal    | PASS   | Immutable; corrections by reversing entries                                                       |
| Periods    | PASS   | Posting window enforced on every new posting / reversal; cut-off note L4                          |
| Reports    | PASS   | Posted COGS read from the journal; valuation includes transit / damaged; agent goods excluded     |
| Audit      | PASS   | Keyed movements, activities, traceability incl. transit, agent returns, advance refunds, reversal |

Not verified: GL inventory balance vs Σ company on-hand × average on real data (test DBs are fixture-polluted);
web panels (estimated vs posted cost labels); partner-statement integration on these DBs (L6); H1 / H2 / M1–M4 were
established by code path and DB state, not by executing the failing scenario (read-only review).

## Lead disposition (2026-10-08)

| Finding                                                      | Disposition                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1 refunded advance re-allocatable / collected counted twice | Fixed (W5b) — advance refunds consume their source receipts (allocation rows to the order, oldest receipt first, released on refund cancel); every allocation path sees the money as used; "collected" computed per order from where each receipt's money was applied. Tests: refund 150 → never allocatable again, AR ledger = open documents, cross-order advance; mutation-proven. |
| H2 amendments while goods in transit                         | Fixed (W5a) — items / quantity / product / fulfilment refused (`ORDER_IN_TRANSIT`) while any unit is in transit; delivery capped at min(parcel carries, ordered − delivered); pickup collection refused with transit stock. Mutation-proven.                                                                                                                                          |
| M1 RETURN code on an undelivered parcel                      | Fixed (W5a) — RETURN_PENDING only against that parcel's own invoice.                                                                                                                                                                                                                                                                                                                  |
| M2 cancelled pickup refund due 0                             | Fixed (W5b + lead) — one rule `store-orders/store-order-active.ts` used by money and stock.                                                                                                                                                                                                                                                                                           |
| M3 system warehouses on manual documents                     | Fixed (W5a + lead) — `inventory/system-warehouse-policy.ts` in every InventoryService writer (transit: lifecycle only; damaged: in only by inspection, out by write-off / transfer / purchase return / count down); STOCK-only warehouse pickers; master-data guard (no deactivate / archive / default) + unit spec.                                                                  |
| M4 kit recipe changed in transit                             | Fixed (W5a) — delivery / receive-back move exactly the components dispatched for that shipment line.                                                                                                                                                                                                                                                                                  |
| L1 VAT rounded per shipment invoice                          | Accepted — each invoice is its own tax document (line-level tax, ERP decision); the 0.01 difference is the legal per-invoice rounding.                                                                                                                                                                                                                                                |
| L2 migration time-zone direction                             | Fixed (lead) — `(ended_at AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Cairo'`.                                                                                                                                                                                                                                                                                                           |
| L3 RETURNED after a later shipment                           | Fixed (W5a) — return status recomputed in every recognition transaction.                                                                                                                                                                                                                                                                                                              |
| L4 failed recognition at period close                        | Accepted with existing control — inventory integrity check I8 lists delivered, unrecognised orders; the order shows the red recognition banner + retry. Period-close warning deferred (owner decision on blocking vs warning).                                                                                                                                                        |
| L5 damaged goods at full cost                                | Accepted — moving damaged goods is a location change; the write-down is a separate, explicit inventory decision (DAMAGE write-off), stated in the receive dialog.                                                                                                                                                                                                                     |
| L6 partner suite not isolated                                | Fixed for the number series (suite restores any series it re-keyed under its fake 2035 clock); the suite still needs a database without other open-ended partner agreements (environmental, documented in release.md). Partner-portal suite made serial (shared posting settings).                                                                                                    |
| L7 DELIVERED → DELIVERY_FAILED before recognition            | Fixed (W5a) — accepted quantities reset, `STOCK_DELIVERY_VOIDED` logged.                                                                                                                                                                                                                                                                                                              |
| L8 COD claim without VAT                                     | Fixed (W5b + lead) — no claim before the shipment's invoice; claim = invoice total; settlement total (payment status, declaration cap, verification) = max(payable, posted invoices) in the one shared `computeStoreOrderSettlement`.                                                                                                                                                 |
