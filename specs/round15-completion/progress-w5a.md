# W5a progress — store-order stock lifecycle

Recovery point for the W5a stream (spec: `spec-w5a-stock-lifecycle.md`).

## Status

- 2026-10-07 — reading, design, API core, R14 suites migrated.
- 2026-10-08 — web part, coordinator follow-ups (settlement / declaration suites, advance refunds in traceability,
  import carrier hook, amendment tariff wording) done. **Stream complete**; only lead integration (below) remains.

- 2026-10-08 — accounting review (`review-accounting.md`) H2, M1, M3, M4, L3, L7 fixed (below). No schema change.

## Accounting review follow-ups (2026-10-08)

- **H2** — goods with the carrier after a failed delivery: the amendment refuses item / quantity / product /
  fulfillment-method changes (`ORDER_IN_TRANSIT`, prices / address / contact still allowed) while
  `StoreOrderStockService.goodsInTransit > 0`; a delivery accepts at most min(carried − returned, ordered − delivered)
  (default = that cap, more → `DELIVERED_EXCEEDS_ORDERED`; the excess stays in transit for receive-back); pickup
  COLLECTED is refused (`GOODS_IN_TRANSIT`) and a WHOLE_ORDER recognition preflight reports `GOODS_IN_TRANSIT`. Web
  delivery dialog default capped the same way.
- **M1** — a `*RETURN*` catalog code flags RETURN_PENDING only for that parcel's own invoice (or the pre-R15
  whole-order invoice of a delivered parcel); an undelivered parcel's goods just stay RETURNING in transit.
- **M3** — system warehouses (rule, `inventory/system-warehouse-policy.ts`, enforced in `InventoryService`
  for every writer): WH-TRANSIT is moved only by the order lifecycle (`postDocumentTransfer`, and
  `postSalesDelivery({ systemWarehouse: true })` from recognition / agent delivery) — every manual document is
  refused (`SYSTEM_WAREHOUSE_REFUSED`, bilingual). WH-DAMAGED receives goods only through inspection (receive-back,
  sales return); manual documents may only take goods OUT (write-off adjustment, damage / expiry, transfer source,
  purchase return, a count that finds less) — never opening balance, positive adjustment, transfer destination,
  purchase receipt, sale, reservation or production. Web: `WarehousePicker` offers STOCK only by default
  (`roles` prop; adjustment + transfer source pass `WRITE_OFF_ROLES` = STOCK + DAMAGED); the physical-count dialog
  hides WH-TRANSIT. (`components/business/warehouse-picker.tsx` is outside the W5a row — edited per the review brief.)
- **M4** — delivery (company recognition via `shipmentStockLines`, agent delivery) and receive-back take out of transit
  exactly what the shipment line carried in (`transit-composition.ts`: its own `…:IN` dispatch movements, a carried
  unit keeps the attempt it came from), never the live recipe; the invoice line's kit snapshot is the dispatched
  recipe (COGS / returns replay it). A reship never mixes compositions on one line (`KIT_RECIPE_CHANGED_IN_TRANSIT`:
  reship the carried units alone or receive them back first). The view counts received-back units per dispatched
  composition.
- **L3** — after every recognition `recomputeStoreOrderReturnStatus` (W5b helper) runs in the same transaction:
  RETURNED → PARTIALLY_RETURNED once another shipment is invoiced.
- **L7** — a company attempt moved off DELIVERED before its invoice exists has its accepted quantities voided
  (`STOCK_DELIVERY_VOIDED` timeline entry): the goods count as with the carrier again and can be received back. Agent
  orders excluded (their goods already left transit).
- Tests (oms_r15_w5a, 2026-10-08): new integration tests — stock-lifecycle `H2`, `M3`, `M4`, `L7`; recognition `M1`,
  `L3`; unit `transit-composition.spec.ts` (3), `system-warehouse-policy.spec.ts` (4); web `shipmentQuantityPlan` cap.
  Runs: serial stock-lifecycle + fulfillment-recognition + kit-fulfillment + agent-finance + inventory-hardening +
  inventory-integrity + assembly + agent-commission = 8 suites / 140 tests PASS; non-serial store-orders, inventory,
  import-center/handlers, agents, traceability, payment-settlements, sales, purchasing, physical-count, assembly,
  workflow, recipes, warehouses = 65 suites / 659 tests PASS; web vitest (store-orders, shipping, business, inventory)
  8 files / 43 tests PASS; API + web `tsc --noEmit` clean; ESLint clean on every touched file.
- Mutations (one at a time, restored; each fails exactly its test): delivery cap, amendment block, pickup refusal,
  whole-order preflight (H2 ×4), warehouse guard (M3), dispatched composition, reship composition guard (M4 ×2),
  delivery void (L7), parcel-scoped return flag (M1), return-status recompute (L3) — 10/10 caught.

## Design (binding for this stream)

- `apps/api/src/store-orders/stock-lifecycle/` — `StoreOrderStockService` owns every physical step (company + agent):
  reservation at creation, SHORT + "Reserve now" (+ bulk oldest-first), release on cancel, re-reservation after an
  amendment, dispatch to WH-TRANSIT inside the shipment transaction (refused `STOCK_NOT_RESERVED` when nothing can be
  secured), accepted quantities at delivery (agent goods leave transit then), receive-back (saleable → STOCK warehouse,
  re-reserved while active; damaged → WH-DAMAGED), read model, backfill. `StoreOrderStockModule` is `@Global`
  (imports Inventory, StockLines, SalesScope; imported by `StoreOrdersModule` and `AgentLedgerModule`).
- Ledger keys: reservation `STORE_ORDER:<order>:<item>[:comp]:RESERVATION:<seq>` / `…:RESERVATION_RELEASE:<seq>`;
  transit `STORE_ORDER_TRANSIT:<shipmentLine>[:comp][:n]:OUT|IN`, back `…:BACK:<receipt>-<i>:OUT|IN`; company delivery
  `SALES_INVOICE:<invoice>:<invoiceItem>[:comp]:SALES_DELIVERY` out of WH-TRANSIT; agent delivery
  `STORE_ORDER:<order>:<shipmentLine>[:comp]:SALES_DELIVERY`; pickup / pre-R15 agent dispatch
  `STORE_ORDER:<order>:<item>[:comp]:SALES_DELIVERY`.
- Per-line state is pure (`stock-state.ts`, `stock-reservations.ts`): reserved = keyed balances capped by the real
  balance (R14 released unkeyed), dispatched = ShipmentLine minus units a reship carried, in transit = dispatched −
  accepted − received back, open / missing → SHORT. A reship carries the failed attempt's loose units (no transfer);
  a "next shipment" (after DELIVERED) ships remaining reserved units.
- Recognition = one invoice per delivered shipment (`SalesInvoice.shipmentId`), amounts prorated (last delivery takes
  the remainder), issued out of transit after checking the order's own transit balance; pickup / pre-R15 delivery =
  whole order from the warehouse. FULFILLMENT_COST once, SHIPMENT_COST per delivered shipment.
- D15-3: `evaluateFulfillmentGate` = prepaid payment basis for the package slip only; never gates queue, shipment
  creation, dispatch, pickup, delivery.

## Done

- API: `inventory.service.ts` (`postDocumentTransfer`, release of a deactivated product, `getStock` / stock cards with
  `inTransit` / `damaged` and available excluding them, agent stock available only on STOCK rows, warehouse role on
  balances and movements, `nonStockWarehouses`), `stock-availability.ts` (STOCK warehouses only),
  `store-order-warehouse.util.ts` (STOCK role), `stock-lifecycle/**` (service, controller, DTOs, backfill, module,
  ledger, state, reservations, errors), recognition service + routing + repair, shipments (ops: stock step in every
  transition tx, `lines` / `deliveredLines`, `createNextShipment`; service: gate removed; controller: bodies +
  `POST next`; `dto/shipment-lines.dto.ts`), `shipping-handoff.ts`, `store-order-fulfillment-gate.ts`,
  `store-orders.service.ts`, `find-store-orders-query.dto.ts` (+`stockStatus`), `workflow-engine.service.ts`
  (afterConversion), amendments (onOrderLinesChanged; AGENT_SHIPPING_TARIFF_MISSING impact built with
  `missingTariffMessage` / `describeDestination`), `agent-fulfillment.service.ts`, `agent-ledger.module.ts`
  (+StoreOrderStockModule), import handler (stock step; `onShippingCompanyAssigned` after a carrier is set; COD hook
  id), traceability (archived orders, transit + agent-return movements, per-shipment recognition failure, advance
  refunds `allocations.some.storeOrderId`), `prisma/scripts/r15-stock-backfill.ts`.
- Web: `components/store-orders/stock/` (`stock-api.ts`, `stock-status-chip.tsx`, `store-order-stock-panel.tsx`,
  `receive-back-dialog.tsx`, `stock-quantity-table.tsx`, `warehouse-role-badge.tsx`, panel spec),
  `components/shipping/shipment-quantities-dialog.tsx`, inventory stock page (In transit / Damaged), inventory
  movements + reports/inventory warehouse role badge, `config/traceability/record-routes.ts` (STORE_ORDER /
  STORE_ORDER_TRANSIT movements link to the order), profitability panel "estimated" caption, i18n
  `store-order-stock.{en,ar}`.

## Verification (oms_r15_w5a)

- Serial: stock-lifecycle 11, fulfillment-recognition + kit-fulfillment + agent-finance 54 (= 65), inventory-hardening
  - inventory-integrity + assembly + agent-commission 69.
- Non-serial: store-orders, traceability, inventory, workflow, import-center/handlers, agents/{finance,pricing,orders,
  portal}, payment-settlements — 41 suites / 465 tests; then payment-settlements 12, payment-declaration 18,
  amendments 16, agent-shipping-pricing 13, shipping-handoff integration 16.
- Web vitest: stock panel spec 6 (+ movement-trace 6).
- Backfill dry run over 4047 PENDING junk orders: 0 failures (3612 MARK, 421 RESERVE, 14 MOVE_TO_TRANSIT).
- Mutations (all restored): creation hook removed → 5/11 stock tests fail; dispatch "has lines" guard removed →
  concurrency test fails; import carrier hook removed → the new pricing import test fails.

## Lead integration requests

1. `app/(shell)/store-orders/[id]/page.tsx`:
   - imports: `StoreOrderStockPanel` (`@/components/store-orders/stock/store-order-stock-panel`), `StockStatusChip`
     (`@/components/store-orders/stock/stock-status-chip`), `ShipmentQuantitiesDialog`
     (`@/components/shipping/shipment-quantities-dialog`).
   - header (`RecordHighlightsHeader status`, after the fulfillment `StatusBadge`): `<StockStatusChip
status={order.stockStatus} />`.
   - body, right after the `{isPickup ? <StoreOrderPickupPanel …/> : null}` block and before the payments section:
     `<StoreOrderStockPanel orderId={order.id} refreshKey={relatedRefreshKey} onChanged={() => void refreshOrder()} />`.
   - hand-over: replace the `ConfirmationDialog open={handOverOpen} … onConfirm={markHandedOver}` with
     `<ShipmentQuantitiesDialog orderId={order.id} mode="dispatch" open={handOverOpen} onOpenChange={setHandOverOpen}
onDone={() => void refreshOrder()} />` (default = everything reserved; fewer = partial dispatch); add a
     "Delivered" action for a SHIPPED / OUT_FOR_DELIVERY attempt opening the same dialog with `mode="deliver"`.
   - the web `StoreOrderRow` type needs `stockStatus` (+ `stockIssue`).
2. D15-3 on the web: `config/store-orders/status.ts isReadyForShipping` and the pickup panel's `PAYMENT_GATED` /
   `paymentAllowsCollection` still disable ship / pickup on payment — make them always allowed (keep
   `isPrepaidFulfillmentAllowed` for the package slip only); `next-action.ts` may still nudge "declare before
   shipping"; the API never emits the `PAYMENT_REQUIRED` handoff blocker.
3. Store Orders list: filter `stockStatus` (API query param, enum list) + a column rendering `<StockStatusChip
status={row.stockStatus} />` (row cells / list page are not W5a files).
4. W1 order entry: `POST /store-orders/stock/availability` `{ lines:[{productId, quantity}] }` → per line `{ available,
sufficient, warehouseCode, stockLine }` (client `storeOrderStockApi.availability`); the agent catalog `available`
   already excludes transit / damaged.
5. Warehouses master-data list (shared `config/master-data/entities.tsx`): show `role` (`WarehouseRoleBadge`).
6. Traceability records for AgentOrderReturn / StoreOrderFulfillmentCost need new TraceKinds + web `RECORD_ROUTES`
   entries (an unknown kind crashes the panel) — not added; their movements / journals are linked.
7. Edited outside the README row (no stream owns them / coordinator-directed): `store-orders/dto/
find-store-orders-query.dto.ts`, `agents/finance/agent-ledger.module.ts`, `app/(shell)/reports/inventory/page.tsx`,
   `components/store-orders/order-profitability-panel.tsx`, `config/traceability/record-routes.ts`,
   `payment-settlements` (module fix only, spec untouched), `payment-declaration.integration.spec.ts`,
   `store-order-amendments.integration.spec.ts` (`addShipment` uses the attempt queued at creation),
   `agent-shipping-pricing.integration.spec.ts` (+1 import test), `prisma/scripts/r15-stock-backfill.ts`.
8. For W5b: invoices carry `shipmentId`; invoice item `warehouseId` = the line's STOCK warehouse (goods leave from
   WH-TRANSIT) — a sales return restocks there; refused units are never invoiced (they come back via receive-back);
   `onCodShipmentDelivered` runs from `recognition.afterShipmentStatus(DELIVERED)` on every path. A full serial run on
   oms_r15_w5a showed W5b's `store-order-money` "allocation across several invoices" failing (expected 100, got 50);
   that test builds its invoices directly (no W5a path).

## Open issues

- (Resolved by review M4) kit recipe changed between dispatch and delivery.
- Agent per-line frozen stock flag (F-L7) is not used for reservation / dispatch (live product flag).
- Amendments hard-delete removed lines; a line with shipment lines cannot be deleted (FK) — only reachable after
  dispatch, which the amendment window refuses.
- Docker Desktop stopped once during the run (2026-10-07 evening); it was relaunched (not killed) and recovered.
