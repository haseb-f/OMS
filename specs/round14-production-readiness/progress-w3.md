# W3 progress log — order → inventory → costing → collection

Branch `feat/r14-inventory`, worktree `D:/Systems/OMS-r14-w3`, DB `oms_r14_w3`.

## M1 — schema (done)

- `StoreOrder.recognitionStatus` / `recognitionError` / `recognitionAttemptedAt` + enum
  `StoreOrderRecognitionStatus`; migration `20261008120000_r14_store_order_recognition` (additive; marks orders
  that already hold a live company invoice RECOGNIZED). Applied to `oms_r14_w3`, client generated, no drift on
  `store_orders`.
- Next: `store-orders/fulfillment-recognition/` service + hooks.

## M2 — API recognition (done, verified)

- `store-orders/fulfillment-recognition/`: `FulfillmentRecognitionService` (recognize / reserve / unwind / preflight,
  post-commit hooks), routing, bilingual error codes, `RecognitionRepairService` + `POST /store-orders/recognition-repair`
  (dry run default; apply = super admin), script `prisma/scripts/r14-recognition-repair.ts` (DRY_RUN default, APPLY=1).
- Hooks wired: markShipped / OutForDelivery / Delivered / DeliveryFailed / NeedsReshipment / setShippingStatus (and
  bulk via these), shipping import (also posts SHIPMENT_COST), pickup transitions, archive.
- `generateInvoice` = manual retry (payment gate removed, refused before delivery).
- Posting provider: zero-total invoice still posts COGS. Traceability: FAILED + reason, SHIPMENT_COST, STORE_ORDER
  movements. Integrity I8 (delivered orders recognised).
- Tests: unit 14/14, integration `fulfillment-recognition.integration.serial.spec.ts` 13/13, kit-fulfillment serial
  updated (delivered shipment). Mutation: disabling the markDelivered hook fails the COD core test (no invoice).
- Local dry run on oms_r14_w3: 35 candidates — 8 blocked (inactive/no-cost/no-stock products), 27 empty test orders
  (now blocked EMPTY_ORDER).
- Next: web banner / chip / retry, i18n; full suite runs.

## M3 — web + full verification (done)

- Web: order detail red banner (reason + "Retry recognition", `store-orders.generate_invoice`), amber banners for
  reservation failure / RETURN_PENDING, recognition chip in the header, next action = retry when a delivered company
  order has no invoice (never payment-gated), trace panel shows the FAILED reason, integrity I8 label; i18n module
  `storeOrderRecognition` (en + ar).
- Verified: api tsc OK; api jest non-serial 194 suites (2 fixed → green), serial 16/16 (178 tests); web typecheck OK,
  lint OK, vitest 141 files / 1006 tests.
- Open: amendments `regenerateInvoice` still checks FULLY_PAID (not W3-owned; generateInvoice now enforces delivery);
  repair apply on Production awaits owner D3-2.
