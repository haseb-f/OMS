# W5a — Store-order stock lifecycle (reservation → transit → delivery → back)

Requirements: 5.1–5.9, 5.13 (pre-delivery part), 5.16, 5.17 · Decisions D15-1 … D15-8, D15-20.
Database for tests: `oms_r15_w5a`. Progress log: `progress-w5a.md`.

## Current state (survey S5)

R14 `FulfillmentRecognitionService` reserves at SHIPPED post-commit (shortage only recorded — the parcel ships
anyway), recognises at DELIVERED (invoice + `SALES_DELIVERY` + COGS + FULFILLMENT/SHIPMENT cost, one locked tx), and
UNWINDs on failure / return code / archive (releases while the parcel is still out). Agent orders issue stock at
dispatch (`AgentFulfillmentService.dispatch`, `SALES_DELIVERY` ref `STORE_ORDER`). No transit concept. Creation paths:
`StoreOrdersService.create` (company, agent via `agentOrder` param, imports), `WorkflowEngineService` lead conversion
(`tx.storeOrder.create`, line ~894). Payment gate: `store-order-fulfillment-gate.ts` (prepaid needs a declaration).

## Foundation already in place (do not change)

`Warehouse.role` STOCK/TRANSIT/DAMAGED + system warehouses `WH-TRANSIT`, `WH-DAMAGED`; `StoreOrder.stockStatus`
(`StoreOrderStockStatus`) / `stockIssue` / `stockStatusAt`; `ShipmentLine` (quantity / deliveredQuantity /
returnedQuantity); `SalesInvoice.shipmentId @unique`; permission `shipping.receive_returns`.

## Required behaviour

### 1. One stock-lifecycle service

New `apps/api/src/store-orders/stock-lifecycle/` (`StoreOrderStockService`) owning every physical step for company
AND agent orders; `FulfillmentRecognitionService` keeps revenue/COGS recognition and calls it. Ledger references:

| Reference type        | Movements                                                                                           | Key pattern (unique `idempotencyKey`)                            |
| --------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `STORE_ORDER`         | RESERVATION / RESERVATION_RELEASE (existing reference)                                              | `STORE_ORDER:<order>:<item>[:<component>]:RESERVATION[:<cycle>]` |
| `STORE_ORDER_TRANSIT` | TRANSFER out of the source warehouse / into WH-TRANSIT, and back                                    | `STORE_ORDER_TRANSIT:<shipmentLineId>[:<component>]:OUT          | IN`, receipt back `…:BACK:<receiptId>` |
| `SALES_INVOICE`       | SALES_DELIVERY (company delivery, from WH-TRANSIT for shipped lines, from the warehouse for pickup) | existing key pattern                                             |
| `STORE_ORDER` (agent) | SALES_DELIVERY at agent delivery, from WH-TRANSIT                                                   | existing agent key pattern, now at delivery                      |

The movements stay the truth; `stockStatus` is recomputed from them after every step (one function, unit-tested).
Kits: components move (existing `StockLineResolver` / `resolveAndLockStockLines`); ASSEMBLED goods move as themselves;
services / digital / non-stock lines never move (order with only those → `NOT_REQUIRED`). Every movement carries the
product's `ownerAgentId` (agent goods stay agent-owned).

### 2. Reservation at creation (D15-1, D15-2)

- Post-commit hook `afterOrderCreated(orderId, userId)` called by `StoreOrdersService.create` (covers company, agent,
  import) and by the lead-conversion path in `workflow-engine.service.ts`. Never throws; failures recorded.
- Per order line (kit = all components or none) inside one transaction with the product row locks: reserve the whole
  line quantity in the line's warehouse (`resolveStoreOrderLineWarehouses`; TRANSIT/DAMAGED warehouses are never
  candidates — fix the fallback in `store-order-warehouse.util.ts` to `role = STOCK`) or not at all.
- All reserved → `RESERVED`; any line short → `SHORT` + `stockIssue` (code `INSUFFICIENT_STOCK`, per line: product,
  sku, warehouse, required, available; Arabic + English messages). Reserved lines of a SHORT order stay reserved.
- `POST /store-orders/:id/stock/reserve` (permission `store-orders.edit`) retries the missing lines;
  `POST /store-orders/stock/reserve-short` (`store-orders.manage`) retries every SHORT order oldest-first (bounded
  batch, returns a summary). Both idempotent.
- Amendments that change items/quantities (`store-orders/amendments/**`, owned by W3 only for tariffs — you own the
  stock part: call `onOrderLinesChanged` from the amendment service after commit; coordinate by adding the call, it is
  one line) release the order's reservation and re-reserve the new lines (cycle suffix).
- Archive / cancel before dispatch → release → `RELEASED`.
- The order list gets a `stockStatus` filter + column chip; available quantities shown in the company product picker
  and the agent catalog must use `available = on-hand − reserved` over STOCK warehouses only (check the inventory
  service `getStock` / availability helpers and the agent `/agent-portal/products` availability).

### 3. Dispatch = transfer to transit (D15-4, D15-5)

- On SHIPPED / OUT_FOR_DELIVERY (manual, bulk, direct status, shipping import) — **inside the shipment transaction**,
  not post-commit: determine the shipment's lines (DTO `lines?: {storeOrderItemId, quantity}[]`; default = every
  reserved, not-yet-dispatched quantity of the order). For each line: release that quantity of the order's reservation
  and transfer it source warehouse → WH-TRANSIT (TRANSFER pair, keyed per shipment line). Write `ShipmentLine` rows.
- Nothing reserved and nothing in transit for the order → try to reserve first; if still short, **refuse the
  transition** with `STOCK_NOT_RESERVED` (Arabic + English, names the product) — a courier status that physically
  cannot have happened is not recorded. The shipping import reports the row error.
- A reshipment from the carrier hub (new attempt while quantities are already in transit for the order) carries the
  in-transit quantities again: lines written, no new transfer.
- Agent orders: same transfer (agent goods, `ownerAgentId`); `agentDispatchedAt` + the agent ledger dispatch events
  stay exactly as today (`AgentFulfillmentService.dispatch` keeps its ledger part, its stock part moves to the
  transfer). Agent orders ship whole (no line selection).
- Remove the payment gate (D15-3): `store-order-fulfillment-gate.ts` must not block reservation, shipping queue entry,
  dispatch, delivery or return on payment/declaration status. Keep any non-payment checks. Update the tests that
  asserted the gate.

### 4. Delivery (D15-5, D15-6)

- DELIVERED (and pickup COLLECTED): company → `FulfillmentRecognitionService.recognize` per **shipment**: invoice
  (`SalesInvoice.shipmentId` = the delivered shipment) for the accepted quantities (DTO `deliveredLines?`, default all
  shipped; line amount = `agreedAmount × accepted / quantity`, rounded to 2 dp with the last delivery of a line taking
  the remainder), `SALES_DELIVERY` out of WH-TRANSIT (pickup: out of the warehouse, releasing its reservation), COGS,
  FULFILLMENT_COST once per order (first delivery), SHIPMENT_COST per delivered shipment. Idempotency moves from
  "one invoice per order" to "one invoice per delivered shipment" (+ one for a pickup order); keep the order row lock
  and the post-commit failure recording (`recognitionStatus FAILED`, banner, retry). `liveInvoice` users that assume a
  single invoice per order must be updated (search `storeOrderId` + `salesInvoice.findFirst` in your files; the
  receipt allocation in `store-order-collection` is W5b's — it must allocate advances across invoices oldest-first;
  write that requirement in your log if you find W5b has not).
- Agent orders → `SALES_DELIVERY` out of WH-TRANSIT at delivery (no invoice, no company COGS); earning logic unchanged.
- Unaccepted quantities of a delivered shipment stay in transit (stockStatus `PARTIALLY_DELIVERED` / `RETURNING`).
- The manual "Generate invoice" retry keeps working (now: recognise every delivered, not-yet-invoiced shipment).

### 5. Failed delivery, cancellation in transit, goods received back (D15-8)

- DELIVERY_FAILED, NEEDS_RESHIPMENT, catalog `*RETURN*` codes, archive/cancel of a dispatched order, pickup
  CANCELLED/RETURNED after handover: **no stock movement** — quantities stay in transit; `stockStatus RETURNING` when
  nothing else is pending. Never release a reservation for goods that left.
- `POST /store-orders/:id/stock/receive-back` (permission `shipping.receive_returns`): lines
  `{storeOrderItemId, quantity, condition: SALEABLE|DAMAGED, warehouseId?}` ≤ in-transit quantity for the order.
  SALEABLE → TRANSFER WH-TRANSIT → origin warehouse (or chosen STOCK warehouse); if the order is still active (not
  cancelled/archived) the quantity is re-reserved for it, otherwise not. DAMAGED → transfer to the DAMAGED-role
  warehouse (or a chosen DAMAGED one). Updates `ShipmentLine.returnedQuantity`. Idempotent per receipt
  (client key). Agent goods keep `ownerAgentId`.
- Agent orders: `AgentFulfillmentService.receiveReturn` must distinguish goods still in transit (undelivered → the
  receive-back transfer above, no SALES_RETURN) from delivered goods (existing SALES_RETURN path). Commission / fee
  reversals unchanged.
- Delivered company goods coming back are W5b's sales return (credit note) — not this endpoint.

### 6. Visibility (5.16)

- `GET /store-orders/:id/stock` → per line: ordered, reserved (+ warehouse), in transit, delivered, returned
  (saleable/damaged), short; movements list (number, type, warehouse, qty, date, reference); shipments with lines.
- Traceability `storeOrder()`: add `STORE_ORDER_TRANSIT` movements, agent return movements (`AGENT_ORDER_RETURN`) and
  `AgentOrderReturn` records, the `StoreOrderFulfillmentCost` record, and include archived orders (read-only).
- Web: `apps/web/src/components/store-orders/stock/store-order-stock-panel.tsx` (allocation table + actions "Reserve
  now", "Receive returned goods" dialog with condition per line) and a stock-status chip component reused by the list
  and detail header. Do NOT edit `store-orders/[id]/page.tsx` — state in your log where the panel goes; the lead
  inserts it. Shipment dialogs (`components/shipping/**`): dispatch with line quantities (default all reserved),
  delivery with accepted quantities (default all). Inventory screens: WH-TRANSIT / WH-DAMAGED visible with a role
  badge; available-to-sell excludes them; transit stock shows the order reference.
- Estimated vs posted cost (D15-6): the order profitability panel labels the standard fulfillment cost "estimated" and
  shows posted COGS from the journal separately (check `order-profitability-panel.tsx`; it may already).

### 7. Backfill / repair (D15-20)

Extend `RecognitionRepairService` (or a sibling `StockBackfillService`) + `POST /store-orders/stock-backfill`
(dry run default; apply = super admin): for every non-archived order with `stockStatus PENDING`: reserve open
undispatched orders (SHORT when not possible), move shipped-not-delivered orders' quantities warehouse → transit
(releasing the R14 shipment reservation), mark delivered/recognised orders `DELIVERED`, agent dispatched orders →
their in-transit / delivered state from their movements. Idempotent; report per order. Script wrapper under
`apps/api/prisma/scripts/r15-stock-backfill.ts` (DRY_RUN default, APPLY=1).

## Tests (real DB, serial where they share fixtures)

Integration (`stock-lifecycle.integration.serial.spec.ts`): create company order (stock 10, order 3) → available 7,
reservation visible; second order for 8 → SHORT, available unchanged, dispatch refused `STOCK_NOT_RESERVED`; stock
received + retry → RESERVED; dispatch → warehouse on-hand −3, transit +3, reservation released, available unchanged,
no journal, no payment/receipt row; deliver → transit −3, invoice for 3, COGS = 3 × moving average, total owned stock
reduced exactly once; partial dispatch (2 of 3) then second shipment; partial delivery (accept 1 of 2) → invoice for
1, 1 RETURNING, receive-back SALEABLE → origin + re-reserved, DAMAGED → WH-DAMAGED; cancel in transit → RETURNING,
nothing released until receipt; pickup order (no transit); kit (components reserved/transferred/issued); service-only
→ NOT_REQUIRED; agent order (agent-owned stock: reserve → transit → delivered, no company COGS, `ownerAgentId` on
every movement); prepaid and COD identical stock flow; lead conversion and import reserve; duplicate DELIVERED
callback ×3 + concurrent `Promise.all` dispatch → one transfer, one invoice; backfill dry run + apply + re-apply no-op.
Update the R14 suites (`fulfillment-recognition.integration.serial.spec.ts`, kit fulfillment, shipping handoff,
agent fulfillment/finance) to the new physical semantics — never weaken an assertion about accounting.
