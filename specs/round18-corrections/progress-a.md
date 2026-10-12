# R18 stream A — partial payments (progress log)

Branch `feat/r18-payments` (main checkout), test DB `oms_r18_a` (clone of `oms_r17_int`).

## Reproduction (Production, read-only API as QA admin — `tmp/r18/prod-probe*.mjs`)

| Record                            | Fact                                                                                                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-2026-000091 (دار الهدى للنشر) | grandTotal 200,000 · allocated 100,000 · remaining 100,000 · PARTIALLY_PAID · created 15:56:50                                                                                         |
| CR-2026-000095                    | amount **200,000**, one allocation **100,000** → INV-2026-000091, receiving account البنك الرئيسي, date 15:56:59, created + confirmed 15:57:23 (one call = "Confirm" on a new receipt) |
| CR-2026-000096                    | amount 100,000, no allocation, الصندوق الرئيسي (cash), 16:08 — a separate unallocated receipt                                                                                          |
| Bank account (from 2026-10-11)    | +200,000 from JV-2026-000415 (CR-2026-000095)                                                                                                                                          |
| Partner statement                 | debit 200,000 (invoice) · credit 300,000 (both receipts) · closing −100,000                                                                                                            |

Lifecycle trace: invoice → receipt (amount 200,000) → allocation (100,000) → JE Dr bank 200,000 / Cr AR
200,000 (100,000 against the invoice + 100,000 unallocated advance) → bank +200,000 → statement credit
200,000 → aging 100,000 open. Every downstream figure is computed correctly from what was entered:
**the defect is in the entry layer**. The "Receive Payment" link prefills the voucher amount with the
invoice balance; lowering the allocation line kept the amount, and Confirm posted the full amount as
received with the remainder as a silent advance. No join multiplication or duplicate posting was found
(`sumConfirmedAllocations` groupBy, aging, statement, receipts list, bank grid all checked).

Same audit, server-side gaps fixed (not the reported cause, same class of risk):

1. `update()` validated an amount-only change against `[]` → a draft could keep 200,000 allocated with a
   100,000 amount; confirm never re-checked Σ allocations ≤ amount + fee.
2. The posting provider ignored a negative remainder (allocations > amount) and booked the gap as FX.
3. Bank "Confirm Match" (legacy COD path) accepted a claim of a different amount than the bank line.

## Fix

- `components/financial-transactions/use-voucher-amount.ts` (shared by the receipt and supplier-payment
  editors): a proposed (prefilled) amount follows the allocation lines until the user types an amount;
  `unappliedPostingConfirmation` — Confirm warns when part of the money stays unapplied while the party
  has invoices ("Post {amount}" / back).
- API: Σ allocations ≤ amount + fee on update (stored lines + stored fee), on confirm, and in posting
  (`clearedFunctional` refuses a negative remainder); bank Confirm Match requires equal amounts.
- `GET /accounting/reports/voucher-integrity` (read-only, financial-reports view): over-allocated
  vouchers / invoices, missing / duplicate / un-reversed entries, cash-line ≠ amount × rate, bank match
  amount mismatch; REVIEW = confirmed vouchers applying part of their money and keeping the rest.
- AR / AP aging: per partner `unapplied` (unallocated receipts / payments + unrefunded credit notes) and
  `net` = open − unapplied; web aging shows "Open invoices · Unapplied credits · Net balance".
- Repair script `scripts/acceptance/r18/r18-repair-cr95.mjs` (dry run default, `--apply`): cancel
  CR-2026-000095 (audited reversal) + replacement 100,000 → INV-2026-000091, same date / account,
  reference CR-2026-000095, idempotency key `r18-repair-CR-2026-000095`; before / after evidence JSON.

## Tests

- `financial-transactions/r18-partial-payments.integration.spec.ts` (real Posting Engine, 9): owner's
  case (status, bank 100,000, AR, aging, statement, idempotent submit + double confirm), supplier
  partial, two partial receipts + refused third, one receipt over two invoices (aging no double count),
  advance then allocate (aging unapplied / net), cancel = reversal once, amount-only draft edit refused,
  over-allocated legacy draft never posts, integrity audit (no errors; R18 shape = review).
- `financial-transaction-posting.provider.spec.ts` +3 (owner's case lines, FX partial: allocated part at
  invoice rate / advance at receipt rate, over-allocation refused).
- `voucher-integrity.spec.ts` (7), web `use-voucher-amount.spec.ts` (6).
- Browser journey `scripts/acceptance/r18/r18-payments-browser.mjs` (local build).
