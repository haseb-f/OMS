# Integration contracts (Master-owned; implementers code against these, never change them unilaterally)

Foundation committed by the Master: schema + migration `20260927100000_payment_declaration_reconciliation`
(applied locally; DB enforces override non-overlap, settled/matched ≤ amount, positive amounts),
permission catalog entries, i18n module files, stubs below.

## Schema (read `apps/api/prisma/schema.prisma`; do NOT edit — ask the Master)

Payment: `paymentMethodId?`, `origin`, `declarationKind?`, `idempotencyKey @unique`, `disputeReason?`,
`settlementStatus`, `settledAmount`, `receivingAccountId` now nullable, status `DISPUTED`.
StoreOrder: `declaredPaymentStatus`, `declaredAmount`, `paymentDiscrepancy`, `paymentDiscrepancyReason`.
PaymentMethod: `requiresReconciliation`, `isActive`. FinancialTransaction: `debitAccountId?`, `rateAsOf?`, `rateSource?`.
New: PaymentReceiptLink, PaymentStatementImport, PaymentStatementLine, PaymentMatch, PaymentSettlement(+Line),
ExchangeRateOverride, FxSyncSettings (singleton row seeded), FxSyncRun; ExchangeRate `sourceTimestamp`, `buyRate`, `sellRate`, `syncRunId`.

## API contracts

1. **FX** — `ExchangeRatesService.resolveRateDetailed(fromId, toId, asOf, client)` and
   `snapshotRateDetailed(currencyId, asOf, client)` → `ResolvedRate {rate, effectiveDate, source, rateId, overrideId}`
   (apps/api/src/accounting/fx/exchange-rates.service.ts). IMPL-FX owns internals; callers freeze
   `rate`, `rateAsOf` (= asOf date), `rateSource` (= source[:overrideId|rateId]) on the document.
2. **Confirm claim (IMPL-DECL)** — `PaymentsService.confirmInTx(tx, paymentId, userId, opts: { rateAsOf?: Date; statementLineId?: string }) : Promise<{ payment, receiptId, alreadyPosted }>`
   Must run inside the caller's `tx` (IMPL-REC wraps match + confirm atomically). Behaviour: lock order row;
   if `payment.paymentMethodId` set → debit `PaymentMethod.accountId` (validated) via `FinancialTransaction.debitAccountId`,
   FX as of `opts.rateAsOf ?? payment.paymentDate`; create `PaymentReceiptLink` (unique ⇒ no double post);
   set `settlementStatus = AWAITING_SETTLEMENT`; never touch fulfillment. Legacy (no method) → existing path.
   `PaymentsService.confirm(id, userId)` keeps working (wraps confirmInTx).
3. **Receipt debit override (IMPL-DECL)** — financial-transaction posting provider debits
   `debitAccountId ?? receivingAccount.chartOfAccountId`; FX uses `rateAsOf` when set.
4. **Settlement (IMPL-SET)** — reads payments `settlementStatus IN (AWAITING_SETTLEMENT, PARTIALLY_SETTLED)` with a
   `PaymentReceiptLink`; carrying functional value per unit = receipt `exchangeRate`. Posts through a new
   `PAYMENT_SETTLEMENT` posting provider (own file). Settlement numbers via NumberingEngineService.
5. **Dispute/reject (IMPL-DECL owns service; IMPL-REC calls)** — `PaymentsService.dispute(paymentId, userId, reason)`
   and existing `reject`. Both set `StoreOrder.paymentDiscrepancy` when the order already has a shipment / collection.

## Permissions (catalog already updated)

- Declarations: `store-orders.edit` (Sales) or `sales.receipts.create` (Finance) — any-of.
- Confirm/reject/dispute: `sales.receipts.confirm`.
- Reconciliation module `payment-reconciliation`: `finance.payment-reconciliation.{view,import,match,settle,correct}`.
- FX: `exchange-rates.view|create|manage`.
- QA: qa-finance has all of the above (ensure-qa-users.ts, additive).

## Web contracts

- i18n: each implementer edits ONLY its module files `apps/web/src/i18n/messages/modules/<ns>.{en,ar}.ts`
  (namespaces `paymentDeclaration`, `paymentReconciliation`, `paymentSettlement`, `fxSettings`; delete the `_placeholder` key).
- `apps/web/src/components/payments/settlement/index.tsx` exports `AwaitingSettlementTab` and `SettlementsTab`
  (`{ methodId }`) — IMPL-SET owns; IMPL-REC renders them in `/finance/payment-reconciliation/[methodId]`.
- Folders: `components/payments/declaration` (IMPL-DECL), `components/payments/reconciliation` (IMPL-REC),
  `components/payments/settlement` (IMPL-SET), FX UI inside `app/(shell)/finance/exchange-rates/**` + `components/finance/fx/**` (IMPL-FX).
- Navigation: IMPL-REC adds the reconciliation menu item(s) in `navigation.config.ts`; nobody else edits it.
