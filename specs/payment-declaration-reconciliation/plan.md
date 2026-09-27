# Plan — payment-declaration-reconciliation

Baseline `83cec96`. Inspection evidence is in `inspection-finance.md` and in the INSP-A summary
(`inspection-sales.md`).

## Architecture

### Data model (one additive migration, owned by the Master; agents never edit the schema)

| Change                                                                                                                                                                                                                                                                                                                                          | Purpose                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PaymentMethod.requiresReconciliation`, `isActive`                                                                                                                                                                                                                                                                                              | Enables the per-method workspace (§3)                                                                                                                                                                                               |
| `Payment.paymentMethodId?`, `origin` (SALES_DECLARATION / FINANCE_DECLARATION / LEAD_CONVERSION / LEGACY), `declarationKind` (FULL / PARTIAL), `idempotencyKey @unique`, `receivingAccountId` becomes nullable, `settlementStatus` (NOT_APPLICABLE / AWAITING_SETTLEMENT / PARTIALLY_SETTLED / SETTLED), `settledAmount`, new status `DISPUTED` | A claim is a Payment row. Legacy rows are unchanged.                                                                                                                                                                                |
| `PaymentReceiptLink(paymentId @unique, financialTransactionId @unique)`                                                                                                                                                                                                                                                                         | DB-enforced "one receipt per payment" for new postings. Historical receipts are still found by the note prefix (read-only adoption; old rows are never rewritten).                                                                  |
| `FinancialTransaction.debitAccountId?`, `rateAsOf?`, `rateSource?`                                                                                                                                                                                                                                                                              | The receipt debits the method clearing account; the FX date and source are frozen                                                                                                                                                   |
| `StoreOrder.declaredPaymentStatus` (UNPAID / PARTIALLY_PAID / PAID), `declaredAmount`, `paymentDiscrepancy`, `paymentDiscrepancyReason`                                                                                                                                                                                                         | Declared status is kept separate from verified status. Finance findings flag the order.                                                                                                                                             |
| `PaymentStatementImport`, `PaymentStatementLine`                                                                                                                                                                                                                                                                                                | Provider transactions, stored separately from claims, with provenance (import, sheet, row, raw row, hash), fee and net, E.164 phone, status (UNMATCHED / MATCHED / EXCEPTION / IGNORED), and a dedupe key that is unique per method |
| `PaymentMatch` (line ↔ payment allocation, ACTIVE / REVERSED, reasons, receipt link)                                                                                                                                                                                                                                                            | Supports partial and multiple allocation; over-allocation is guarded under row locks                                                                                                                                                |
| `PaymentSettlement`, `PaymentSettlementLine`                                                                                                                                                                                                                                                                                                    | Batch settlement, a unique idempotency key, a JE link, and settled amounts per payment                                                                                                                                              |
| `ExchangeRateOverride` with a Postgres `EXCLUDE USING gist` (btree_gist) on (pair, daterange) where not deleted                                                                                                                                                                                                                                 | Rejects overlapping ranges at the DB level, which makes it safe under concurrency                                                                                                                                                   |
| `FxSyncSettings`, `FxSyncRun`; `ExchangeRate.sourceTimestamp`, `syncRunId`                                                                                                                                                                                                                                                                      | Automatic daily import with provenance and sync status                                                                                                                                                                              |

### Services

- **Declaration service** (store-orders): `declarePayment(orderId, {kind: UNPAID|FULL|PARTIAL,
amount?, methodId, currencyId, paymentDate, reference?, proof?}, idempotencyKey)`.
  - Locks the order row, validates amounts against the order total and the declared remainder, and
    creates at most one Payment per idempotency key.
  - Recomputes `declaredPaymentStatus`. No accounting entries.
  - Lead conversion uses the same service.
- **Fulfillment gate**:
  - A prepaid order may ship or be collected when `declaredPaymentStatus = PAID` (claims not
    REJECTED or DISPUTED cover the total) OR the verified status is paid.
  - COD is unchanged, the PICKUP label ban stays, and there are no auto transitions.
  - A later rejection or dispute sets `paymentDiscrepancy`; shipments are left untouched.
- **Confirm & post** (payments):
  - When `paymentMethodId` is set, debit `PaymentMethod.accountId` (validated: exists, active,
    postable leaf, ASSET, currency-compatible; otherwise a clear error). Otherwise use the legacy
    receiving account.
  - FX as-of: the matched statement transaction date for reconciled methods, else the payment's
    actual date. The date is frozen on the receipt.
  - Create `PaymentReceiptLink` inside the same transaction; its unique constraint blocks a double
    post.
  - Set `settlementStatus = AWAITING_SETTLEMENT` when the debit account is a method clearing account.
- **Statements** (new `payment-reconciliation` module):
  - File import (CSV/XLSX) with mapping, preview and row validation.
  - Google Sheets sync (new sync source type `PAYMENT_STATEMENT`, reusing GoogleSheetsService
    credentials).
  - Manual entry.
  - Dedupe by (method, provider reference) or by row hash. Changed or deleted source rows become
    EXCEPTION, and matched rows are never modified.
- **Suggestions**: exact reference or order number → E.164 phone → Arabic-normalized name, each
  cross-checked on method, amount, currency, date window and provider status, with reasons shown.
  Ambiguous suggestions stay suggestions. Name or phone alone never auto-confirms.
- **Settlement**: select AWAITING_SETTLEMENT payments of one method (same clearing currency), enter
  the received amount, bank receiving account, date and reference. Then preview and post one JE:
  - Cr Clearing at the carrying value (the sum of the frozen receipt functional amounts for the
    settled portions);
  - Dr Bank at received × rate(received currency, settlement date);
  - Dr Commission at fee × rate(clearing currency, settlement date);
  - ± FX difference to `exchangeDifferenceAccountId`.

  Same currency: fee = gross − received, which must be ≥ 0. Cross-currency: the fee must be entered
  in the clearing currency (defaulting to the statement fees), the rates come from the FX service on
  the settlement date, and the FX difference is the balancing line. A unique idempotency key and row
  locks on the payments guard against duplicates. Partial settlement is explicit per payment.

- **FX**:
  - `resolveRateDetailed(from, to, date)` returns {rate, effectiveDate, source, overrideId, stale}.
  - Precedence: an override whose range contains the date → the latest official or manual daily rate
    within `maxStaleDays` (default 3) on or before the date → otherwise fail closed with
    `MISSING_EXCHANGE_RATE` or `STALE_EXCHANGE_RATE`.
  - Canonical pairs are FOREIGN → EGP only, for overrides and imports.
  - The daily cron `/api/cron/fx-rates` is protected by the existing cron secret. Settings UI:
    enable/disable, run now, status, history, overrides.

### Web

- A shared declaration dialog (Unpaid / Full / Partial, method, currency, date, reference, proof)
  used by Sales and Finance on the order detail and in lead conversion. The Sales voucher dialog is
  removed.
- Order detail and list show separate "declared by Sales" / "verified by Finance" / "settlement"
  badges and a discrepancy banner.
- The payment method form gets a "Requires reconciliation" toggle and an active flag.
- `/finance/payment-reconciliation` lists reconciliation-enabled methods. Each method has a workspace
  at `/[methodId]` with tabs: statement (import, sync, manual), matching, awaiting settlement (select
  → settle with preview), settlements, and exceptions. There are related-record links throughout.
- The Finance payment review for non-reconciled methods keeps the same page with the new posting
  rules.
- FX settings: an auto-sync card, run history and a date-range override editor on the exchange-rates
  page.

## Ownership (bounded; the Master owns schema, i18n namespace files and integration)

| Task      | Scope                                                                                                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IMPL-DECL | Declaration service, fulfillment gate, confirm & post changes (debit override, FX date, link table), lead conversion, web declaration dialog, order detail and list, payment-method form |
| IMPL-REC  | Statement import, sync and manual entry, suggestions, match confirm (calls the IMPL-DECL confirm), reject or dispute, and the workspace tabs statement, matching and exceptions          |
| IMPL-SET  | Settlement service, the `PAYMENT_SETTLEMENT` posting provider, the awaiting-settlement and settlements tabs, and provider balance/report reconciliation                                  |
| IMPL-FX   | FX source adapter, cron, overrides with the exclusion constraint, resolution precedence and staleness, settings UI                                                                       |
| REV       | Independent accounting and security review of the integrated diff                                                                                                                        |
| QA        | Production acceptance script covering criteria 1–8 with tagged data                                                                                                                      |

## Risks

- Historical receipts are linked only by the note text. New posts use the link table, and the lookup
  still falls back to the note text, so nothing is posted twice.
- Existing PENDING or MATCHED vouchers keep their receiving account, and the legacy posting path stays
  valid for them.
- Tightening FX staleness could block confirms for older dates. The error states the missing date and
  pair, and a manual override resolves it.
- Period locks: posting on the source date may hit a closed period. That fails clearly and is never
  silently re-dated.
