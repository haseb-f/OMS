# R22 stream T — API operation types (decision D4)

Branch `feat/r22-t` (base `feat/r22` 51e047c5, `feat/r22` @ d863d90b merged in = stream P included). DB `oms_r22_int_t`
(migrations applied incl. P's `20261014100000_r22_p_allocation_effective_date`). No push / merge.

## Types (same FinancialTransaction voucher, service, numbering and Posting Engine)

| Type                | Arabic             | Posting (sourceType = type, sourceId = voucher, entry date = voucher date D1) | Number |
| ------------------- | ------------------ | ----------------------------------------------------------------------------- | ------ |
| `OTHER_RECEIPT`     | تحصيل آخر          | Dr cash/bank (`receivingAccount.chartOfAccountId`) / Cr `counterAccountId`    | OR-    |
| `OTHER_PAYMENT`     | صرف آخر            | Dr `counterAccountId` / Cr cash/bank                                          | OP-    |
| `INTERNAL_TRANSFER` | تحويل بين الحسابات | Dr destination / Cr source — shared `internalTransferLines` rule              | TR-    |

No party, no allocation (DTO `allocations` refused; Allocate / Unallocate / PATCH allocation refused
`ALLOCATION_NOT_ALLOWED`; provider refuses a voucher with allocation rows). Lines in voucher currency at the rate of
the voucher date, frozen on the voucher. Journal = CASH. Drafts never post; Confirm idempotent; Cancel = engine
reversal once; activities logged (created / updated / confirmed / cancelled / archived).

Transfer: two different active receiving accounts with different ledger accounts, one currency (null = functional);
cross-currency → **422 `TRANSFER_CROSS_CURRENCY`** (a currency exchange is not a transfer voucher — manual JE).
The bank-line pairing (`confirmInternalTransfer`, `BANK_TRANSACTION_TRANSFER`) now builds its lines through the same
`internal-transfer-rule.ts`. **Not done (documented limitation):** matching an imported bank line to a recorded
transfer voucher — unreconcile of a voucher-matched line cancels the voucher, which would orphan the other leg; needs
a two-leg match design (stream U / later round).

## Counter-account allow-list (D4) — `financial-transactions/other/counter-accounts.ts`

Posting (`allowsPosting`), not archived; IN: EQUITY / LIABILITY / REVENUE; OUT: EQUITY / LIABILITY / ASSET. Excluded:
`CASH_OR_BANK` (every receiving account's ledger + Settings cash / bank = the cash-flow cash set),
`RECEIVABLE_PAYABLE_CONTROL` (partnerControlType, Settings AR / AP, customer / supplier profile + group defaults,
agent funds payable), `INVENTORY` (Settings inventory account — Inventory Engine only; addition to D4). Enforced at
create / update / confirm (`resolveOtherVoucher`) and again by `OtherVoucherPostingProvider` inside the posting tx.
Refusal: 400 `COUNTER_ACCOUNT_NOT_ALLOWED`, `fields[0].constraints` ∈ `required | not_found | group_account |
account_type | cash_or_bank | receivable_payable_control | inventory`. Other receipt / payment in a currency other
than its receiving account's (when the account has one) → 400 `CURRENCY_MISMATCH`.

## Permission (D4, no new key, no grant)

Controllers use `@PermissionModule('journal-entries')`: list / get / activities / counter-accounts =
`accounting.journal-entries.view`; create / createConfirmed / update / confirm / cancel =
`accounting.journal-entries.create`; delete draft / archive = `accounting.journal-entries.archive`. The generic
receipt / payment / expense / refund routes refuse D4 vouchers (service `VoucherRouteOptions.types`, 404
"not found on this route") — a receipts cashier cannot confirm an other receipt through `/receipts/:id/confirm`.

## Endpoints

`financial-transactions/other-receipts`, `/other-payments`, `/transfers`: `GET /` (status, search, dateFrom, dateTo,
page, pageSize, sortBy, sortOrder, receivingAccountId[]), `GET /:id`, `GET /:id/activities`, `POST /`,
`POST /confirmed` (idempotencyKey), `PATCH /:id` (draft), `DELETE /:id` (draft), `POST /:id/confirm`,
`POST /:id/cancel`, `POST /:id/archive`.
Body (other-_): `counterAccountId`_ , `receivingAccountId` (required to confirm), `currencyId`, `amount`_,
`transactionDate`, `paymentSourceId`, `referenceNumber`, `description` (≤500, on the counter line), `notes`,
`costCenterId`, `projectId`, `idempotencyKey`. Body (transfers): `receivingAccountId`_ (source),
`targetReceivingAccountId`* (destination), same optional fields. Response = voucher incl. `counterAccount {id, code,
name, nameEn, accountType}`, `targetReceivingAccount`, `updatedAt`.
`GET financial-transactions/counter-accounts?direction=IN|OUT` → `[{id, code, name, nameEn, accountType, currencyId}]`.
Catalog `GET financial-transactions/types` gains the three codes (`INTERNAL_TRANSFER` direction `TRANSFER`, not importable).

## Refund of an unapplied customer receipt

`CUSTOMER_REFUND` allocation line `{ receiptId, allocatedAmount }` (existing refunds controller; exactly one of
`invoiceId` / `storeOrderId` / `receiptId` per line). Receipt must be the customer's CONFIRMED `CUSTOMER_RECEIPT`, same
currency, not a store-order receipt (`RECEIPT_REFUND_STORE_ORDER` — refund via the order). Cap = receipt
`amount + fee − Σ allocations` (`REFUND_EXCEEDS_RECEIPT_UNAPPLIED`), checked at draft and under the receipt row lock
at Confirm (after the partner lock); customer ledger-credit cap unchanged. Posting Dr AR (partner, at the receipt's
rate) / Cr cash ± FX. On Confirm the receipt gets a consumption row (`transactionId = receiptId = receipt`, no
invoice) = Σ its confirmed refunds, so Allocate / position / aging unapplied / integrity read the reduced amount;
the row cannot be unallocated or changed (`RECEIPT_REFUND_ALLOCATION`) and the receipt cannot be cancelled while
refunded (`RECEIPT_REFUNDED`); refund Cancel releases it. `GET financial-transactions/refunds/open-receipts?partnerId=`
→ `[{receiptId, transactionNumber, transactionDate, currencyId, amount, unapplied}]`.

## Reports

Cash flow: classified by counter-account (equity → financing), transfers excluded (`internalTransfers` gross);
GL carries the counter lines; never in AR / AP aging (no partner); voucher-integrity covers the three types
(entry once, cash line = amount × rate; transfer = source line); a refunded receipt is not a REVIEW case.
Traceability: three linked-record kinds (view key `accounting.journal-entries.view`) — web routes for them are U's.

## Migration `20261014120000_r22_t_operation_types` (additive, idempotent, sorts after P's)

Enum values ×3; `financial_transactions.counter_account_id` (FK chart_of_accounts), `target_receiving_account_id`
(FK receiving_accounts); `financial_transaction_allocations.receipt_id` (FK financial_transactions + index);
number series OTHER_RECEIPT `OR`, OTHER_PAYMENT `OP`, INTERNAL_TRANSFER `TR` (`ON CONFLICT DO NOTHING`). Re-run
twice on oms_r22_int_t: no error, no diff vs schema.

## Tests

- `financial-transactions/other/r22-t-operation-types.integration.spec.ts` — **22/22** (real DB, engine, HTTP):
  draft unposted, balanced entry + accounts + JE link + voucher date, idempotent confirm, cancel reverses once,
  createConfirmed idempotent (concurrent) + 409 on reuse, 8 allow-list refusals, provider re-check at confirm, money
  account required / currency, generic routes refused, transfer accounts (no income / expense / AR / AP, no partner),
  same-account + cross-currency 422, cash flow / GL / aging / integrity, receipt refund (posting, cap, consumption,
  allocate capped, cancel guards, release), concurrent refunds (exactly one), refusals (other customer / draft /
  currency), HTTP 403 (cashier, viewer) / 404 cross-route / 200 accountant, DTO 400s.
- Mutation checks: counter-account type guard removed → 4 tests fail; receipt refund cap at Confirm removed → race
  test fails (strengthened so the ledger-credit cap alone does not mask it). Both restored.
- Catalog spec updated (3/3). Merged tree: financial-transactions + accounting + bank-transactions + traceability +
  permissions + common **63 suites / 1107 tests pass** (fx-rates / fx-scheduler failed once in the parallel run from
  shared fx_sync_settings state left `enabled=false` by the two specs interleaving — restored, 70/70 serially);
  serial accounting specs 14/14; r22-settlement 29/29. API typecheck, eslint (src), `nest build` clean.
