# Inspection B — Finance review, posting, statement infrastructure (read-only, HEAD 83cec96)

Summary of findings (full detail was reported by the INSP-B investigator; paths under apps/api/src unless noted):

- Payment statuses: PENDING, MATCHED, VERIFIED, REJECTED (schema :2178). No DISPUTED/REVERSED.
  StoreOrderPaymentStatus: PAYMENT_PENDING, PARTIALLY_PAID, FULLY_PAID_RECONCILED, OVERPAID, UNMATCHED,
  PAYMENT_REVIEW.
- Confirm & Post: `PaymentsService.confirm` (payments/payments.service.ts:268-388) locks the order row,
  checks for an existing receipt (`alreadyPosted`), checks currency and receiving account, marks the
  payment VERIFIED, then `StoreOrderCollectionService.postPaymentReceipt` creates and confirms a
  CUSTOMER_RECEIPT (financial-transactions), which the posting engine posts. The accounts are
  Dr ReceivingAccount COA, Cr AR (partner / group / settings), Dr gateway fee, ± realized FX.
- Idempotency: the order `FOR UPDATE` lock, a receipt lookup by the note `STORE_ORDER_PAYMENT:<id>`
  (**not DB-unique**), the posting engine skipping when a POSTED JE exists (application-level only), and
  the claimed-total ≤ order-total guard.
- Risks:
  - Cancelling a receipt leaves the payment VERIFIED, so a later re-confirm posts again.
  - A manual receipt for the same money is not detected.
  - Bank reconcile has no lock against a concurrent confirm.
- FX: the rate and entry date are the **confirmation** time, not the payment date. Missing rates fail
  closed. An FX correction service exists (reverse and re-post).
- Payment confirmation does not change shipping state. However, **fulfillment gates still require
  verified payment**:
  - store-order-shipments.service.ts:87-97 (a PREPAID order needs FULLY_PAID_RECONCILED or OVERPAID);
  - store-orders.service.ts:1152-1185 `canFulfill`, and pickup COLLECTED at :1215.
    This conflicts with spec §2.
- PaymentMethod has no active flag, no reconciliation flag and no currency, and is not linked to
  Payment. A method maps to a PaymentSource by case-insensitive name. Claims auto-pick the
  default ReceivingAccount regardless of method. Tabby, Tamara and Geidea are not seeded.
- Reusable pieces:
  - BankTransaction import/upsert (fingerprint, CONFLICT on changed reconciled rows; no fee, net, name
    or phone fields; no deleted-row detection) and CashFlowReconciliation suggest/confirm/unreconcile.
  - PaymentAutoMatching scorer (amount hard filter, reference, date, sender name, raw phone digits).
  - CarrierReconciliation dedupeKey state machine.
  - Import Center handler contract (dryRun, needs-review, preview).
  - Google Sheets sync orchestrator (per-source lock; row-hash and deleted-row detection only for
    STORE_ORDERS; service-account credentials on the server only).
  - PhoneNumberService E.164, normalizeArabicSearch.
- Missing:
  - a provider-statement model;
  - an allocation table (partial or multiple allocations);
  - a dispute state;
  - a provider clearing account and a settlement posting;
  - an audited correction for VERIFIED payments;
  - a unique receipt↔payment link.
- Historical data: VERIFIED payments already have receipts linked by the note prefix, so they must be
  adopted, never re-posted. Sheet-imported store orders carry payment information only as note text.
- Counting Production payments: `GET /payments?status=…&pageSize=1` returns `total` (with
  sales.receipts.view). A breakdown by method needs read-only SQL.
