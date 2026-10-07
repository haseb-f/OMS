# W3 — Order → inventory → costing → collection integrity (priority 1)

## 1. Reported defect and root cause

A company (non-agent) online store order was delivered and its collection journal posted, but stock did
not move and COGS was never posted.

Root cause, verified in code (2026-10-07):

- Delivery (`StoreOrderShipmentOperationsService.markDelivered` / `setShippingStatus` / bulk status /
  `ShippingUpdatesImportHandler`) only syncs fulfillment, runs `agentProgress` (returns at once for a
  company order, `agent-fulfillment.service.ts:299`) and posts `SHIPMENT_COST`.
- Stock (`SALES_DELIVERY`), revenue (`SALES_INVOICE`) and COGS for a company order are created ONLY by
  the manual `StoreOrdersService.generateInvoice`, which requires
  `paymentStatus === FULLY_PAID_RECONCILED` (`store-orders.service.ts:2096`). COD orders, partially paid
  and over-paid orders (exact-equality check, `store-order-payment-sync.service.ts:62`) can never reach it.
- Payment verification posts the customer receipt as an unallocated advance (Dr Bank / Cr AR) with no
  link to stock — hence "collection journal present, stock untouched".
- Traceability shows the stock group as `PENDING` (not failed) for such an order, so it looks healthy.

This is a policy defect (recognition tied to payment), not a report defect. Reports are not patched.

## 2. Recognition policy (R14, replaces the ADR-0017 payment gate)

| Event                                                            | Company store order                                                                                                                                                                                                                                                              | Agent store order                               | B2B sales order                          |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------- |
| Created                                                          | nothing                                                                                                                                                                                                                                                                          | nothing                                         | nothing (draft)                          |
| Shipped (or pickup READY handed to courier)                      | **reservation** of stock lines (post-commit, idempotent)                                                                                                                                                                                                                         | stock issued at dispatch (unchanged)            | n/a                                      |
| Delivered / pickup COLLECTED                                     | **revenue recognition**: sales invoice CONFIRMED + `SALES_DELIVERY` movements (kits → components) + reservation release + `SALES_INVOICE` JE (Dr AR / Cr revenue, Dr COGS / Cr inventory) + `FULFILLMENT_COST` + `SHIPMENT_COST`; verified receipts then allocate to the invoice | commission earning (unchanged); no company COGS | invoice confirm issues stock (unchanged) |
| Payment verified                                                 | receipt JE (Dr bank / Cr AR); allocates to the invoice if one exists, advance otherwise (unchanged)                                                                                                                                                                              | same                                            | receipt (unchanged)                      |
| Delivery failed / returned to sender before delivery / cancelled | reservation released; no invoice                                                                                                                                                                                                                                                 | agent return flow (unchanged)                   | cancel releases reservations (unchanged) |
| Returned after delivery                                          | order flagged `RETURN_PENDING`; the user posts the sales return against the invoice (existing returns flow, restocks + reverses COGS)                                                                                                                                            | agent return (unchanged)                        | sales return (unchanged)                 |

Rationale: accrual basis — control passes to the customer at delivery (IFRS 15), so revenue, the stock
issue and COGS are recognised together at delivery and never wait for collection. The shipped → delivered
interval is covered by a reservation so available stock is not oversold, without a goods-in-transit
account.

`generateInvoice` (manual button) becomes the retry of the same recognition: allowed once the order is
delivered/collected regardless of payment status; refused before delivery with a clear message.

## 3. Failure handling — never silent

Recognition and reservation run **after** the delivery/shipping transaction commits, so a courier
status is never lost because stock or configuration is missing. Each attempt records its outcome on the
order:

- `StoreOrder.recognitionStatus` (`NOT_DUE` | `RESERVED` | `RECOGNIZED` | `FAILED` | `RETURN_PENDING`),
  `recognitionError` (code + Arabic/English message), `recognitionAttemptedAt`.
- Failures: missing warehouse, insufficient stock, missing cost (`currentCost` null — never zero-cost
  success), missing account mapping, inactive product. Each has an actionable message naming the product
  and the setting/screen to fix.
- An activity-log entry per attempt; the order detail shows a red banner with the reason and a
  "Retry recognition" action (`store-orders.generate_invoice`).
- Traceability `storeOrder()` reports the stock / COGS groups as `FAILED` with the reason, includes
  `SHIPMENT_COST` journals, reservation movements and agent `STORE_ORDER` dispatch movements.

Zero-total invoices: the posting provider's `grandTotal === 0 → null` skip must still post COGS for a
free-of-charge delivery. Fix in `sales-invoice-posting.provider.ts` (COGS lines posted even at 0 revenue).

## 4. Idempotency and concurrency

- One recognition per order: inside the recognition transaction lock the order row
  (`SELECT … FOR UPDATE`) and re-check for a non-cancelled invoice; a second concurrent call returns the
  existing invoice (no error) when triggered by a status hook, `DUPLICATE` when triggered manually.
- Movement keys: existing `SALES_INVOICE:<invoiceId>:<lineId>[:component]:SALES_DELIVERY`; reservation
  keys `STORE_ORDER:<orderId>:<itemId>[:component]:RESERVATION` / `…:RESERVATION_RELEASE`.
- Posting engine already skips an already-posted source.
- Repeated courier callbacks / imports / bulk updates call the same hook → no duplicates.

## 5. Product classes

- Stock-tracked physical (`isInventoryItem`): reservation, delivery movement, COGS at moving average.
- Services / digital / non-stock: revenue only, no movement, no COGS.
- Kit: components reserved / issued (existing `stock-line-resolver`), COGS from components.
- Assembled finished goods (recipe produced via assembly): the finished SKU is stocked; it is issued as
  itself, components are NOT deducted again (resolver already treats only `KIT` as expandable — test it).
- Agent-owned goods on a company order remain rejected (`assertCompanyOwnedProduct`).

## 6. Existing affected orders — repair

`apps/api/prisma/scripts/r14-recognition-repair.ts` (and the same service behind
`POST /store-orders/recognition-repair` with `dryRun`, permission `store-orders.generate_invoice` +
super admin for apply):

1. Find company orders whose fulfillment is DELIVERED/COLLECTED with no non-cancelled invoice; agent
   orders delivered without `agentDispatchedAt`.
2. Dry run: list each order with lines, required qty per warehouse, current on-hand, cost availability,
   predicted invoice total and COGS; flag blockers.
3. Apply: run the same recognition service per order (idempotent); orders with blockers are reported,
   not forced.
4. Reconciliation report (before/after on-hand per product, inventory GL, COGS, AR, receipts) written to
   `specs/round14-production-readiness/evidence/`.
5. Never deletes or re-posts existing receipts; existing advances are allocated by the existing
   `syncVerifiedPayments`.

Applying it on Production changes financial records → owner confirmation required (decisions.md D3-1).

## 7. Tests (acceptance)

- Integration (serial, real DB): company order with stocked item, kit, service, assembled good →
  ship (reservation) → deliver (invoice, movements, JE balanced, COGS = qty × moving avg) → verify
  payment (receipt allocates) → return (reverse). COD order delivered before payment. Duplicate
  delivered callback ×3 + concurrent `Promise.all` → one invoice, one movement set. Missing cost →
  `FAILED` with code, no invoice, delivery still saved. Agent order unchanged. B2B regression.
- Unit: hook routing per status, manual retry rules.
- Repair: dry run lists the seeded broken order; apply fixes it; second apply is a no-op.
