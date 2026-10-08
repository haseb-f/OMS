# W5b progress — collections, returns, refunds, payment reversal

Spec: [spec-w5b-money-returns.md](spec-w5b-money-returns.md) · Decisions D15-9 … D15-12 · Test DB `oms_r15_w5b`.

## Status

| Part                                                                                       | State                                                    |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| 1. Collection timing (multi-invoice allocation, COD expected claim, COD method on carrier) | Done — API + web, tested (real DB)                       |
| 2. Returns after delivery (request → receive & inspect → credit note, recognition status)  | Done — API + web, tested (real DB)                       |
| 3. Refunds (order advance target, record refund from order, refund due)                    | Done — API + web, tested (real DB, concurrency)          |
| 4. Erroneous payment reversal                                                              | Done — API + web, tested (real DB)                       |
| 5. Web (money panel, return / receive / refund / reverse dialogs, editors, carrier form)   | Done — typecheck + lint + vitest; panel insertion = lead |

- 2026-10-07 (session 1) — first agent cut off by an API usage limit; API code left on disk, untested.
- 2026-10-07 (session 2) — recovered, reviewed, completed, tested. Details below.
- 2026-10-08 — accounting review follow-up (`review-accounting.md` H1, M2, L8) fixed and tested; see
  "Review follow-up" below.

## Done

API

- `financial-transactions/shared/store-order-money.ts` — the one order money position (pure `computeStoreOrderMoney`,
  `loadStoreOrderMoneyPosition`, `advanceRateOf`), used by the refund caps at Confirm, "Record refund", the posting
  provider (advance-line AR rate), payment reversal and the panel.
- `accounting/store-order-collection/store-order-collection.service.ts` — a receipt allocates across all posted
  invoices of the order oldest-first (`planAllocations`), never over-allocates, keeps the rest as advance;
  `allocateAdvances` never re-allocates money refunded against the order.
- `accounting/store-order-collection/carrier-cod-collection.service.ts` — `onCodShipmentDelivered(shipmentId, userId)`
  (post-commit, never throws, key `carrier-cod:<shipmentId>`): PENDING `Payment` origin CARRIER_COD, method = the
  carrier's, amount = min(delivered value, remaining to claim); no journal. Skips prepaid / agent / not delivered /
  carrier without a method (`NOT_TRACKED`).
- `shipping-companies` — `codPaymentMethodId` (form `""` clears it to null); must be an active, **reconciled** method
  with a postable ASSET clearing account (`COD_PAYMENT_METHOD_INVALID`).
- `financial-transactions.service.ts` — CUSTOMER_REFUND lines may target `storeOrderId` (company orders, same currency,
  once per refund, capped at `advanceRefundable` at create and again at Confirm under partner + order row locks).
- `financial-transactions/refunds/store-order-refunds.service.ts` + `customer-refunds.controller.ts`:
  `GET /financial-transactions/refunds/open-orders?partnerId=`, `GET …/refunds/store-orders/:id`,
  `POST …/refunds/store-orders/:id` (record refund = create + confirm in one tx, idempotent, credit notes first then
  the advance; needs `sales.refunds.create` + `sales.refunds.confirm`).
- `payments.service.ts` `reverse()` + `POST /payments/:id/reverse` (`sales.receipts.reverse`): VERIFIED only; refused
  in a posted settlement (`PAYMENT_IN_SETTLEMENT`, checked first), when matched to a statement
  (`PAYMENT_MATCHED_TO_STATEMENT` → "Correct match"), or when the money was already refunded
  (`PAYMENT_ALREADY_REFUNDED`); receipt cancelled via `cancelInTx` (reversing JE, closed period refused), payment
  REVERSED with who / when / why, order's other advances re-allocated in the same tx, statuses recomputed, both
  timelines logged. A reversed payment can never be confirmed again.
- `sales-returns.service.ts` — `createFromInvoiceLines` (proportional lines, last return takes the remainder, invoice
  row lock caps), `receiveInTx` (condition per line; SALEABLE → STOCK warehouse, default the line's / preferred /
  default stock warehouse, never TRANSIT; DAMAGED → DAMAGED-role, default WH-DAMAGED), shared `confirmInTx` recomputes
  the order's RETURNED / PARTIALLY_RETURNED (`store-order-return-status.ts`); manual returns refuse TRANSIT.
- `store-orders/returns/` + `store-orders/collections/` — `StoreOrderMoneyModule` (one appended line in
  `app.module.ts`): `GET /store-orders/:id/money`, `GET/POST /store-orders/:id/returns`,
  `POST /store-orders/:id/returns/:returnId/receive` (agent orders refused: `AGENT_ORDER_USE_AGENT_RETURN`).

Web

- `components/store-orders/money/`: `StoreOrderMoneyPanel` (figures + documents + actions), `StoreOrderReturnDialog`,
  `StoreOrderReceiveReturnDialog`, `PaymentReverseDialog`, `StoreOrderReturnNotice`, `store-order-money.ts` (pure
  rules), `store-order-money-service.ts` (API client for these routes).
- `components/financial-transactions/customer-refund-dialog.tsx` — one refund dialog for a credit note or a store
  order (`target`), with the "no gateway — return the money first, then record it" notice.
- `sales/returns/return-editor-page.tsx` — store-order returns show order, reason, Requested / Received and "Receive &
  inspect"; `sales/refunds/refund-editor-page.tsx` — order-advance lines shown (and kept on a draft save).
- `master-data/shipping-companies/page.tsx` — "COD collection method" select (reconciled methods with a clearing
  account) + help copy + list column.
- `services/financial-transactions-service.ts` — `AllocationInputPayload` also accepts `{ storeOrderId }` (additive).
- i18n `storeOrderMoney.*` (en + ar).

Tests (all run on `oms_r15_w5b`)

- `store-order-money.integration.serial.spec.ts` — 9 real-DB scenarios: COD-method validation; prepaid (declare → no
  JE, verify → advance, deliver → allocated, return requested → no stock → received SALEABLE → stock + credit note
  JE, PARTIALLY_RETURNED, refund once + replay + refusal, damaged → WH-DAMAGED, RETURNED); multi-invoice oldest-first
  (advance then deliveries, deliveries then payment); cancelled prepaid advance refund (2 parallel refunds → 1) +
  reversal refused when refunded; overpayment refund; COD expected claim → statement match (Dr clearing / Cr AR) →
  settlement (Dr bank / Cr clearing), cash once, reversal refused in settlement; untracked carrier + undelivered COD
  nothing to refund; Finance-verified reversal (reversing JE, REVERSED, invoice reopened, status recomputed,
  idempotent, never re-confirmed); agent orders refused. Every JE asserted balanced.
- Unit: `store-order-money.spec.ts`, `store-order-refunds.service.spec.ts`, `store-order-return-status.spec.ts`,
  `store-order-money.service.spec.ts`, `create-shipping-company.dto.spec.ts`, rewritten
  `store-order-collection.service.spec.ts`; web `store-order-money.spec.ts` (vitest).
- Mutations proven: newest-first invoice order → multi-invoice test fails; refunded guard disabled → cancelled-order
  test fails; (unit) `reverseBlockOf` match-before-settlement caught by its spec.

## Review follow-up (2026-10-08)

- **H1 — refunded advance stays allocatable / double-counted collection.**
  `financial-transactions/shared/store-order-receipts.ts` `syncAdvanceRefundConsumption`: an order-advance refund's
  money is carried on the order's receipts as allocation rows (transaction = receipt, `storeOrderId` = order, no
  invoice), oldest receipt first, released newest first when the refund is cancelled; rows always total the order's
  CONFIRMED advance refunds; fails closed (`ADVANCE_REFUND_NOT_COVERED`). Called by refund Confirm and Cancel
  (`financial-transactions.service.ts`), by `allocateAdvances` / `postPaymentReceipt` (auto path) and by the generic
  `allocate` (which now takes the order row lock, then the receipt row lock, before its capacity check). `unallocate`
  refuses such a row (`ADVANCE_REFUND_ALLOCATION`); a receipt whose money was refunded cannot be cancelled / reversed /
  corrected (`RECEIPT_REFUNDED`). Lock order everywhere: refund → partner → order → receipts → invoice.
  `loadStoreOrderMoneyPosition` "collected" = any receipt's allocations to the order's invoices + the order's own
  receipts' unallocated money + the part of them paid back as the order's advance refunds (per-receipt
  `contribution`, used by the reversal guard) — never a receipt in full.
- **M2 — one "cancelled" rule.** `store-orders/collections/store-order-active.ts` `isStoreOrderActive` (archived OR
  fulfillment CANCELLED — exactly the stock lifecycle's inline rule) used by the money position.
- **L8 — COD expected amount.** No claim until the shipment's invoice exists (`AWAITING_INVOICE`); amount = the
  invoice's grand total (VAT / service lines included) capped by the order's balance due net of standing claims;
  `syncVerifiedPayments` (run by recognition whenever an invoice is issued, incl. retries / repair) records missing
  claims of delivered + invoiced COD shipments. Verification is capped by max(payable total, posted invoices) so the
  VAT-inclusive collection can be confirmed (`PaymentsService.withInvoicedTotal`).
- Tests: `store-order-money.integration.serial.spec.ts` now 13 scenarios (new: H1 refunded advance never allocatable +
  ledger AR = open documents + refund cancel gives it back; H1 collected per application; M2 cancelled pickup; L8 no
  claim before the invoice → 114 incl. VAT → confirmed). Mutations proven: consumption sync disabled → 2 tests fail;
  `collected` counting receipts in full → H1 collected test fails; old `active` rule → M2 test fails; verification
  cap without invoices → L8 test fails.

## Design (implemented defaults)

- Order money position (one function, `financial-transactions/shared/store-order-money.ts`):
  - collected = where posted receipts' money was applied for the order: any receipt's allocations to its invoices +
    its own receipts' unallocated money + the part paid back by its advance refunds (review H1); refunded =
    confirmed refund lines to the order and to its returns;
  - invoiced / credited = CONFIRMED|CLOSED invoices / order returns;
  - expected = (active order: max(invoiced, payable total); cancelled order — archived or fulfillment CANCELLED,
    `isStoreOrderActive` — invoiced) − credited;
  - balance due = expected − (collected − refunded) when positive; refund due = the opposite when positive;
  - an active, not yet delivered prepaid order therefore shows no refund due (the advance is for the goods).
- Refund lines: credit-note lines (order returns, oldest first, existing caps) before the advance line
  (`storeOrderId`, capped at refund due − unrefunded return credit). "Record refund" locks the customer row then the
  order row; Confirm locks the customer row before any cap is read — concurrent refunds serialize per customer.
  "Refundable now" is also capped by the customer's credit on the posted AR ledger (existing rule).

## Integration requests for the lead

1. **Panel insertion** — `apps/web/src/app/(shell)/store-orders/[id]/page.tsx`, inside the "payments"
   `CollapsibleDetailSection`, right after `<OrderPaymentStatusPanel … />`, company orders only (agent orders keep
   `AgentOrderPanel`, their collections credit the agent ledger):
   ```tsx
   import { StoreOrderMoneyPanel } from "@/components/store-orders/money/store-order-money-panel";
   …
   {!order.agentId ? (
     <StoreOrderMoneyPanel
       storeOrderId={order.id}
       refreshKey={order.updatedAt}
       onChanged={() => void refreshOrder()}
     />
   ) : null}
   ```
2. **COD hook** — already wired by W5a in `FulfillmentRecognitionService.afterShipmentStatus` (post-commit, after
   `dispatch`, so the shipment's invoice exists): `await this.carrierCod.onCodShipmentDelivered(shipment.id, userId);`
   for `shipment.status === 'DELIVERED'`. Every delivery path must reach `afterShipmentStatus` with `shipment.id`
   (manual, bulk, direct status, shipping import). Nothing else to wire.
3. **Traceability (W5a-owned)** — an order-advance refund has no return, so `TraceabilityService.storeOrder` misses it
   today (`refundsFor(returnIds)` only). Add the refunds with `allocations: { some: { storeOrderId: <orderId> } }`
   (type CUSTOMER_REFUND, deletedAt null) to the order's refunds, and in the transaction trace link
   `allocation.storeOrder` (select `{ id, internalOrderId, status }`) as a `STORE_ORDER` document.
4. **Regressions caused by W5a's in-flight changes (not W5b code)** — `payment-settlements.integration.spec.ts`
   fails to boot: `AgentFulfillmentService` now needs `StoreOrderStockService`, which `AgentLedgerModule` cannot
   resolve in a test module without `StoreOrdersModule`; `payment-declaration.integration.spec.ts` (3 tests) still
   expects the prepaid shipping gate W5a removed (D15-3). Both pass logic-wise once W5a fixes the DI / updates the
   expectations.
5. **Shared "cancelled" rule (M2)** — switch W5a's inline rule in `store-order-stock.service.ts` (`const active =
!order.deletedAt && order.fulfillmentStatus?.code !== 'CANCELLED';`) to
   `isStoreOrderActive(order)` from `store-orders/collections/store-order-active.ts` (or move that file to
   `store-orders/` and update both imports) so stock and money can never diverge.
6. **Receipt editor (H1)** — `apps/web/src/app/(shell)/sales/payments/receipt-editor-page.tsx` `allocationToLine`: a
   receipt allocation with `storeOrderId` (and no invoice) is the part paid back by that order's advance refund; show
   it as the order instead of "—":
   ```ts
   const order = allocation as typeof allocation & {
     storeOrderId?: string | null;
     storeOrder?: { internalOrderId: string } | null;
   };
   if (order.storeOrderId)
     return {
       id: allocation.id,
       invoiceId: order.storeOrderId,
       invoiceNumber: order.storeOrder?.internalOrderId ?? "—",
       invoiceHref: `/store-orders/${order.storeOrderId}`,
       remainingBalance: Number(allocation.allocatedAmount),
       allocatedAmount: Number(allocation.allocatedAmount),
     };
   ```
   (removing it is refused by the API with a clear message — cancel the refund instead).
7. **Traceability** (request 3): refunds of an order = `type: 'CUSTOMER_REFUND'` allocations with that `storeOrderId`
   — filter by type, receipts now carry `storeOrderId` rows too.
8. **VAT-exclusive orders** — `StoreOrderPaymentSyncService.recompute` and the declaration cap still compare with the
   order's payable total (ex-VAT); an order invoiced 114 for a payable 100 is shown OVERPAID once 114 is verified.
   Use max(payable, posted invoices) there too (not W5b files).
9. Optional: add `REVERSED` to the web payment vocabulary (`config/payments/payment-vocabulary.ts`) so the Finance
   review pages name it; record chips already show "Reversed" via `docFlow.status.REVERSED`.

## Open questions / defaults

- **COD method must be reconciled** (default): the carrier is a collection provider — its COD report is the method's
  statement (file, sheet or a manual line = "verified by Finance"), matching posts Dr clearing / Cr AR, its remittance
  is the method's settlement. A non-reconciled method's account is the bank itself (would book cash the carrier still
  holds) and has no settlement workspace.
- **Receive & inspect** needs `sales.returns.confirm` only (spec); it does not also demand `sales.returns.approve`
  for the implicit approval of a requested return.
- **Store-order list filters "refund due / balance due"** — not added: the figures are derived from posted documents
  (no stored column), so a list filter is not cheap; the panel and "open orders" refund endpoint show them per order.
- **Payment reversal of a matched claim** stays on "Correct match" (one correction path per case); a claim verified
  through Finance review (no match) uses "Reverse".
