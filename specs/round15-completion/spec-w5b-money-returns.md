# W5b — Collections, returns, refunds, payment reversal

Requirements: 5.1, 5.10–5.16 (money / return part), 5.17 · Decisions D15-9 … D15-12.
Database for tests: `oms_r15_w5b`. Progress log: `progress-w5b.md`.

## Current state (survey S5)

- Declaration (salesperson) = PENDING `Payment` (origin SALES_DECLARATION) + `declaredPaymentStatus`; Finance
  `PaymentsService.confirmInTx` → VERIFIED → `StoreOrderCollectionService.postPaymentReceipt` → CUSTOMER_RECEIPT
  (Dr receiving account or the method's clearing account / Cr AR), unique `PaymentReceiptLink`; before an invoice the
  receipt is an unallocated advance, `syncVerifiedPayments` allocates it to "the" invoice (`findFirst`).
- Methods with `requiresReconciliation` are confirmed only via a provider statement match, then AWAITING_SETTLEMENT;
  `PaymentSettlement` posts Dr bank + Dr fee / Cr clearing. No carrier-COD concept.
- Reject / dispute only for PENDING / MATCHED; a claim verified through Finance review has no reversal path
  (`financial-transactions.service.ts` refuses cancelling a claim's receipt; `reverseMatch` needs a statement match).
- `SalesReturn` = credit note (DRAFT → CONFIRMED restocks per line warehouse, posting reverses revenue + COGS at the
  invoice snapshot cost). RETURN_PENDING (R14) is never resolved. No condition field (added now: `SalesReturnItem.condition`).
- `CUSTOMER_REFUND` must be fully allocated to a SalesReturn → advances of cancelled / undelivered orders and
  overpayments cannot be refunded. No refund-pending state.

## Foundation already in place

`SalesReturn.storeOrderId` / `reason`, `SalesReturnItem.condition`, `FinancialTransactionAllocation.storeOrderId`,
`PaymentStatus.REVERSED` + `Payment.reversedAt/reversedById/reversalReason`, `PaymentOrigin.CARRIER_COD`,
`ShippingCompany.codPaymentMethodId`, `StoreOrderRecognitionStatus.RETURNED / PARTIALLY_RETURNED`,
permission `sales.receipts.reverse`, WH-DAMAGED (role DAMAGED). W5a introduces one invoice per delivered shipment
(`SalesInvoice.shipmentId`) — an order can have several invoices.

## Required behaviour

### 1. Collection timing (D15-9) — prove and close gaps

- Prepaid: cash posts only at VERIFIED (receipt = advance until delivery, then allocated). A declaration never posts.
  Verify by test; fix any path that posts on declaration.
- `syncVerifiedPayments` / `postPaymentReceipt` must allocate across **all** confirmed invoices of the order
  oldest-first (W5a creates one per delivered shipment), never over-allocate, keep the remainder as advance.
- COD via carrier: when a COD shipment is DELIVERED and its carrier has `codPaymentMethodId`, create (idempotently,
  key `carrier-cod:<shipmentId>`) a PENDING `Payment` origin `CARRIER_COD`, method = that method, amount = the
  order's remaining payable for the delivered quantities (never above remaining) — an _expected_ collection, no
  posting. Expose a hook `onCodShipmentDelivered(shipmentId)` that W5a's delivery path calls post-commit (write the
  exact call in your log; the lead wires it if W5a has not). The carrier's COD report is matched through the existing
  provider-statement import of that method (requiresReconciliation) or verified by Finance → receipt Dr carrier
  clearing (the method's account = "receivable from carrier") / Cr AR. The carrier's remittance = existing
  `PaymentSettlement` (Dr bank + Dr carrier fee / Cr clearing). No path posts cash twice (one receipt per payment,
  settlement only from clearing). Without a COD method the order shows "COD collection not tracked for this carrier —
  record the payment when the carrier pays" (Finance records a normal claim).
- Shipping company form (web + API `shipping-companies`): optional "COD collection method" (only methods with a
  clearing account). Settings copy explains it.
- Order panel "Collection" (`components/store-orders/money/store-order-money-panel.tsx`): payable, declared
  (claims, not collections), verified collected (receipts), with carrier / awaiting settlement / settled to bank,
  invoiced (per shipment), credited (returns), refunded, **balance due** and **refund due**; each figure links to its
  document. Delivery-before-settlement and prepaid-before-delivery read correctly.

### 2. Returns after delivery (D15-10)

- `POST /store-orders/:id/returns` (permission `sales.returns.create`): from the order's delivered invoice lines —
  `{ reason, lines: [{ salesInvoiceItemId, quantity }] }` → DRAFT `SalesReturn` with `storeOrderId`, `reason`
  (required), no stock effect ("return requested"). Full or partial; capped by delivered − already returned
  (existing cap). Works for prepaid and COD alike; works when the order is RETURN_PENDING or not.
- "Receive & inspect" = confirm (`sales.returns.confirm`): per line `condition` SALEABLE (→ chosen STOCK warehouse,
  default the invoice line's origin warehouse — never WH-TRANSIT) or DAMAGED (→ a DAMAGED-role warehouse, default
  WH-DAMAGED); existing confirm restocks + posts the credit note (revenue + COGS reversed at snapshot cost; damaged
  goods still come back into inventory value in the damaged warehouse — a later write-off is a separate inventory
  decision, say so in the UI). Kits come back as their snapshot components.
- After a confirmed return the order's `recognitionStatus` becomes RETURNED (every delivered quantity credited) or
  PARTIALLY_RETURNED; RETURN_PENDING is cleared. Agent-owned goods never reach this flow (agent returns use the agent
  flow) — refuse with a clear message.
- Web: order "Return" action + dialog (lines, quantities, reason), the return document shows status "Requested /
  Received", the receive dialog has the condition per line.

### 3. Refunds (D15-11)

- Refund due for an order = verified collected − refunded − (invoiced − credited) when positive, and only money
  actually collected counts (a COD order whose cash was never collected has nothing to refund; its credit note just
  reduces AR).
- `CUSTOMER_REFUND` gains a second allocation target: `storeOrderId` — refund of the order's verified, not-invoiced
  advance (cancelled / undelivered prepaid order, overpayment), capped at that advance; posting Dr AR (partner) /
  Cr cash-bank exactly like the credit-note refund. Exactly one of `salesReturnId` / `storeOrderId` per line.
- Order action "Record refund" (permission `sales.refunds.create` + confirm): method, account, reference, date,
  amount ≤ refund due; the refund document is a real money-out record. No gateway integration exists (ERP decision):
  the dialog says the money must be returned through the gateway/bank first and recorded here; until recorded the
  order shows "Refund pending: <amount>". A credit note alone never shows "refunded".
- Idempotent (client key); concurrent refunds cannot exceed refund due (row lock on the order).

### 4. Erroneous payment reversal (D15-12)

- `POST /payments/:id/reverse` (permission `sales.receipts.reverse`), reason required, for VERIFIED payments (incl.
  verified via Finance review): reverse the receipt through the existing cancel/reversal path of financial
  transactions (reversing journal entry, allocations removed, invoice payment status recomputed), payment →
  REVERSED with audit fields, order payment status recomputed, activity logged. Refused when the receipt is part of a
  posted settlement batch (reverse the settlement first — message says so) or the period is closed. Never deletes.

### 5. Visibility

Traceability (owned by W5a) lists receipts / refunds / returns already; make sure your new documents link back
(`storeOrderId`) so they appear. Store-order list: optional filters "refund due", "balance due" if cheap.

## Tests (real DB)

Prepaid: declare → no JE; verify → receipt (advance); deliver (W5a recognition) → allocated; return 1 of 2 →
requested (no stock) → receive SALEABLE → stock +1, credit note JE (revenue + COGS reversed), RETURN_PENDING cleared →
PARTIALLY_RETURNED; refund due = credited amount; record refund → refunded, refund due 0; second refund refused;
damaged line → WH-DAMAGED. Prepaid cancelled before delivery → advance refund against the order. Overpayment refund.
COD: deliver → CARRIER_COD claim PENDING, no JE; statement match / verify → Dr clearing / Cr AR; settlement → bank;
total cash posted once. COD returned undelivered → nothing to refund. Payment reversal (Finance-review verified) →
reversing JE, REVERSED, order status recomputed; reversal inside a settled batch refused. Concurrency: two parallel
refunds of the full due → one succeeds. Multi-invoice allocation oldest-first. Every JE balanced.
