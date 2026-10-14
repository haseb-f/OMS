# R22 — root causes and repair plan

Inputs: `investigation-accounting.md` (I-A, 15 failing API cases in `r22-settlement.integration.spec.ts` + 1 web),
`investigation-ui.md` (I-A + I-B: 28 failing web cases + 102 / 300 Playwright checks). Baseline 200,000 / 100,000
holds in both directions (status, remaining, bank 100,000, statement, aging) — the defects are elsewhere.

## Root causes (by layer)

| Layer                   | Defect ids                         | Root cause                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status calculation      | S1, S2                             | `invoice-payment.util.ts` ignores posted sales / purchase returns: a credit-noted invoice still reads open and accepts a second collection                                                                                                                                                                                                          |
| Posting                 | P1, P2, P3, P4                     | FX difference booked only at Confirm — never on a later allocate / unallocate; entries dated at confirmation, not voucher date; rounding residue on instalments                                                                                                                                                                                     |
| Aggregation             | A1, A2, A3                         | aging adds currencies; archived posted invoice with balance disappears; as-of uses voucher date for later allocations                                                                                                                                                                                                                               |
| Allocation guards       | L1, L2, L3, L5, V1                 | allocate races cancel; agent collections can settle customer invoices; drafts over-claim; cross-company allocation; unbounded fees                                                                                                                                                                                                                  |
| Atomicity / stale state | W1, L4, stale-tab, related-records | change-allocation = 2 calls (failure drops the line); bank-line receipt create + confirm in 2 transactions; no refresh signal                                                                                                                                                                                                                       |
| Presentation            | I-B §2–§5                          | generic amount field (type=number: «0.5»→«.5», Arabic digits rejected, «0.00» placeholder, no currency, 32 px); money columns hidden; total without currency; clipped remaining; mirrored numeric columns in RTL (`num` + `text-end`); confirmed row shows pre-voucher balance; settlement history = chips only; sort by party → 500 (no whitelist) |
| Missing operations      | §2                                 | no other receipt / other payment with a counter-account; no manual internal transfer (only pairing imported bank lines); no refund of an unapplied B2B advance; supplier label «حساب الاستلام»                                                                                                                                                      |

Production (read-only): no wrong posted entry, no wrong stored status; A1 visible live (AR unapplied 86,500 EGP +
1,150 SAR summed as 87,650); CR-2026-000101 (20,000) and CR-2026-000103 (60,000) unapplied for مكتبة النور while
INV-2026-000093 owes 60,000 — owner decision, not repaired.

## Decisions (owner questions answered with defaults; owner may override)

- D1 (P3) Receipts / payments / transfers post on the **voucher date** (`transactionDate`); the period lock applies.
  Existing entries are valid and stay as they are.
- D2 (S1, S2) A posted return linked to an invoice **reduces that invoice's open balance**: applied credit =
  min(return total − refunded from that return, invoice total − cash allocated). Surplus stays refundable credit on the
  return. Status: `PAID` «مدفوعة بالكامل» when cash alone covers it; `SETTLED` «مسوّاة» when remaining 0 and credit
  contributed; `PARTIALLY_PAID` / `UNPAID` otherwise; `CANCELLED` unchanged. Credit is never labelled cash paid.
- D3 (A2) A posted invoice with an open balance or any confirmed allocation **cannot be archived**.
- D4 (§2) New voucher types on the SAME FinancialTransaction service + Posting Engine (no new module):
  `OTHER_RECEIPT` (Dr cash/bank / Cr counter-account), `OTHER_PAYMENT` (Dr counter-account / Cr cash/bank),
  `INTERNAL_TRANSFER` (Dr destination cash/bank / Cr source — reuses the existing transfer posting; bank-line pairing
  keeps working and can match a recorded transfer), refund of an unapplied customer receipt (CUSTOMER_REFUND
  allocated to the receipt). Counter-account allow-list: posting (leaf) accounts that are NOT cash / bank (receiving
  accounts' ledgers), NOT AR / AP control, NOT Group; OTHER_RECEIPT: equity, liability, revenue / other income;
  OTHER_PAYMENT: equity, liability, non-cash asset (expenses stay on EXPENSE_PAYMENT). Authorised users = holders of
  the existing manual journal-entry create permission (they can already post the same entry by hand) — no new grant.
  Supplier refund: out of scope (limitation).
- D5 (V1) Receipt fee and payment actual fee ≤ the voucher amount. Provider settlement fee cap (OD-A2) unchanged —
  owner decision.
- D6 (P2) Unallocating on a foreign-currency voucher posts the reversing FX adjustment through the Posting Engine.
- D7 Default money account on a new voucher stays, but the review step names it explicitly.
- D8 (data) No automatic allocation of CR-2026-000101 / 000103 — reported for the owner.

## Shared API contract (streams build against this)

1. Invoice settlement summary on sales + purchase list / detail / export / open-invoices:
   `grandTotal, paidTotal, creditedTotal, remainingBalance, paymentStatus (UNPAID|PARTIALLY_PAID|PAID|SETTLED|CANCELLED),
currencyCode`; `allocatedTotal` kept = `paidTotal` (compatibility).
2. `GET /sales/invoices/:id/settlement`, `GET /purchasing/invoices/:id/settlement` →
   `{ summary, entries: [{ kind: 'PAYMENT'|'CREDIT_NOTE', documentId, documentNumber, documentType, date, status,
amount, currencyCode, allocationId?, canUnallocate, canCancel }] }` (permission-scoped).
3. `PATCH /financial-transactions/{receipts|payments}/:id/allocations/:allocationId` `{ allocatedAmount }` — atomic,
   same guards, no new cash entry.
4. New controllers with the receipts controller shape (list / get / create / createConfirmed / update / confirm /
   cancel): `financial-transactions/other-receipts`, `/other-payments`, `/transfers`; voucher fields
   `counterAccountId` (OTHER_*), `targetReceivingAccountId` (INTERNAL_TRANSFER). `GET
financial-transactions/counter-accounts?direction=IN|OUT` = the allow-list. Customer advance refund: refund
   allocation target `receiptId`.
5. List `sortBy` whitelist per endpoint (party name sorts by relation; unknown → 400, never 500).
6. Voucher responses carry `updatedAt`; every mutating call returns the fresh voucher.

## Streams

- **P — API settlement core** (`feat/r22-p`): S1/S2 (D2), A1/A2/A3, L1/L2/L3/L5, V1, W1 endpoint, L4, P1/P2/P4 FX
  adjustments + P3 (D1), integrity checks, sort whitelist, settlement summary + history endpoints. Makes I-A's
  failing tests pass; updates the R20 credit-note expectation.
- **T — API operation types** (`feat/r22-t`): D4 types, counter-account allow-list, transfer, advance refund,
  migration (enum values + columns), postings, permissions, tests. Keeps changes in new files where possible.
- **U — web** (`feat/r22-u`): one config-driven voucher card (purpose → party / account → amount / currency /
  method / date → allocation → review → confirm) for receipts and payments incl. new types; shared MoneyInput
  (text + parser, prominent, currency adornment, «أدخل المبلغ», direction labels); invoice lists (money columns,
  status columns badge-only), settlement history + credit-note line on invoice details; numeric RTL alignment fix;
  data-changed signal; atomic reallocation call. Makes I-B's failing tests + measurement pass.
- Then: merge → independent accounting review → integrated gates → journeys → release → live checks → handoff.
