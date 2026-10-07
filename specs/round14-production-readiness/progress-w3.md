# W3 progress log — order → inventory → costing → collection

Branch `feat/r14-inventory`, worktree `D:/Systems/OMS-r14-w3`, DB `oms_r14_w3`.

## M1 — schema (done)

- `StoreOrder.recognitionStatus` / `recognitionError` / `recognitionAttemptedAt` + enum
  `StoreOrderRecognitionStatus`; migration `20261008120000_r14_store_order_recognition` (additive; marks orders
  that already hold a live company invoice RECOGNIZED). Applied to `oms_r14_w3`, client generated, no drift on
  `store_orders`.
- Next: `store-orders/fulfillment-recognition/` service + hooks.
