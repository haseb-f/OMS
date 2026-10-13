# R20 stream C — invoice payment status + receipt allocation (progress log)

Branch `feat/r20-payment-status` (worktree `agent-a07f1349863125a3b`), base `cda38886`. Test DB `oms_r20_c_int`
(clone of `oms_r17_int` + migrate deploy), preview DB `oms_r20_c`. No migration.

## Reproduction (Production, read-only GETs as QA admin — `scripts/acceptance/r20/r20-payment-status-audit.mjs`)

Evidence: `evidence/c/prod-audit-before.json`. 7 sales invoices + 1 purchase invoice, 14 receipts, 0 supplier payments.

| Check                                                                      | Result                                                                                          |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| API `paymentStatus` / `allocatedTotal` / `remainingBalance` (list, detail) | = recomputed from CONFIRMED allocations for all 8 invoices (4 PAID, 1 PARTIALLY_PAID, 3 UNPAID) |
| Open invoices (receipt editor), AR / AP aging                              | = recomputed for every invoice                                                                  |
| Allocations on cancelled vouchers / non-posted or cancelled invoices       | 0                                                                                               |
| Same invoice twice on a voucher, over-allocated vouchers / invoices        | 0                                                                                               |
| Voucher ≠ invoice currency                                                 | 0 (CR-2026-000097 has no currency = functional EGP, invoice EGP)                                |
| `voucher-integrity`                                                        | 14 vouchers / 14 entries, 0 errors, 0 review                                                    |

So the stored data and the API's derivation are right; the defects are on the screens and in entry rules that
let wrong allocations in. Per-customer figures from the same GETs:

| Customer        | Profile "المبلغ المدفوع" (before) | Applied to invoices | Unapplied | Open invoices                          |
| --------------- | --------------------------------- | ------------------- | --------- | -------------------------------------- |
| دار الهدى للنشر | **200,000**                       | 100,000             | 100,000   | INV-2026-000091 PARTIALLY_PAID 100,000 |
| مكتبة النور     | **50,000**                        | 0                   | 50,000    | INV-2026-000093 **UNPAID** 110,000     |

CR-2026-000099 (50,000 cash, مكتبة النور) was recorded 7 minutes after INV-2026-000093 with no invoice selected:
the invoice correctly reads UNPAID, the profile says 50,000 "paid".

## Root causes per surface

| Surface                                | Root cause                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer / supplier profile (Payments) | "Paid" = Σ amounts of the first 50 confirmed receipts (unapplied advances included, currencies summed); "outstanding" summed across currencies.                                                                                                                                                                                                                                        |
| Invoice grid cards (sales + purchase)  | Surface colour = document status: a CONFIRMED but UNPAID invoice was a green ("settled") card. Purchase card had no outstanding figure.                                                                                                                                                                                                                                                |
| Invoice list table                     | Payment badge only — no outstanding amount anywhere in the list.                                                                                                                                                                                                                                                                                                                       |
| Invoice list export (CSV)              | Export keys `paymentStatus` (both) and `customer` (sales) were never filled by the row mapper → empty columns; no paid / outstanding.                                                                                                                                                                                                                                                  |
| Receipt / payment editor               | Open invoices: total + remaining only (no previous payments, no "this voucher"); "no invoice selected" dialog read like a partial case ("0 applied").                                                                                                                                                                                                                                  |
| Entry rules (API, shared FT service)   | Allocations accepted on DRAFT / PENDING / APPROVED invoices (they read paid before posting, money stuck if cancelled); the same invoice on two lines passed the balance check line by line at Confirm (over-payment); no currency check — editors never sent a currency, so a SAR invoice paid by a "functional" receipt was cleared at the SAR rate with the difference booked as FX. |
| Aging                                  | Second, private remaining-balance computation (same result) — now the shared `computeInvoicePaymentSummary`.                                                                                                                                                                                                                                                                           |

Unchanged and verified correct: list / detail / print / record preview read the API figures; cancel deletes the
voucher's allocations and reverses its entry once; credit notes (sales returns) and refunds never count as paid;
allocating a posted receipt posts nothing new.

## Fixes (commit `06becd65`, labels in `3df32bb4`)

API (`financial-transactions.service.ts`, `shared/invoice-payment.util.ts`): `PAYABLE_*_INVOICE_STATUSES`
(CONFIRMED / CLOSED) shared by allocation, open invoices and aging; `INVOICE_NOT_POSTED`; `DUPLICATE_ALLOCATION`
at entry; Confirm sums lines per invoice and locks invoices in id order; `Allocate` on a posted voucher grows its
existing line; `settlementCurrency` — none chosen → the invoices' currency, mismatch → `CURRENCY_MISMATCH` (create,
update, allocate, confirm); open invoices carry `currencyId` / `currencyCode`; `GET receipts|payments/position`
(per currency: open invoices, outstanding, received, applied, unapplied).

Web (display only): open-invoices table (total · paid before · remaining · this voucher · status; other-currency
rows disabled; cards below 720 px), editors send the settlement currency and "pay all" stays in it, explicit
"لم تُحدَّد أي فاتورة — دفعة مقدمة غير مخصصة" confirmation, invoice payment columns (badge + outstanding, optional
paid / outstanding money columns, export filled), `invoiceSurfaceTone` (posted invoice card = payment status),
profile panel from `/position` (received apart from applied and unapplied, per currency).

Design-rule change to confirm with the owner: `round9-brand-grid/card-palettes.md` said an invoice surface is its
document status; posted invoices now take their payment status tone (badges unchanged).

## Repair

`scripts/acceptance/r20/r20-repair-payment-status.mjs` (dry run default, `--apply`, business operations only).
Production dry run (`evidence/c/prod-repair-dry-run.json`): **NOTHING_TO_REPAIR** — derived 0, repairable 0,
review 0. INFO 2 (never changed without the owner): CR-2026-000096 100,000 unapplied (دار الهدى, OD-A1) and
CR-2026-000099 50,000 unapplied (مكتبة النور) while INV-2026-000091 / INV-2026-000093 are open. With owner approval:
`--apply --allocate CR-2026-000099=INV-2026-000093 --allocate CR-2026-000096=INV-2026-000091` → Allocate 50,000 /
100,000 (no new cash entry) → INV-093 PARTIALLY_PAID 60,000 left, INV-091 PAID. Local proof: duplicate-line legacy
draft found → merged by PATCH → re-run 0; `--allocate` applied once, re-run SKIP (`evidence/c/local-repair-*.json`).

## Tests

- `r20-payment-status.integration.spec.ts` 9/9 (real Posting Engine): every surface for unpaid → partial → paid →
  cancel; one receipt over two invoices; advance + reallocation (unallocate / allocate, one entry); credit note
  not paid; posted-only + cross-customer; duplicate lines (entry + legacy draft at confirm); idempotent submit +
  concurrent confirms; currency; supplier side. Mutation (per-invoice sum reverted) → 1 failure.
- API: finance suites (financial-transactions, accounting/reports, bank-transactions, store-order-collection)
  149/149; full `jest` 2658/2660 — the 2 failures are `leads/distribution/lead-eligibility.integration.spec.ts`
  (stream A area, untouched here, DB-content dependent). tsc + eslint clean.
- Web: tsc + eslint clean; vitest 1316/1317 (the one is `report-card-consumers.spec.ts` timing out under load;
  11/11 alone); new `settlement-currency.spec.ts`, `use-voucher-amount.spec.ts` +1, `sales-grid-cards.spec.tsx` +1.
- Builds: API + web production builds OK.
- Browser journey `r20-payment-status-browser.mjs` (ar 1440 + en 375 / 1440): before (base build) 16/23, after 23/23
  — `evidence/c/{before,after}/`.

Preview left running: API http://localhost:4825 (DB `oms_r20_c`), web http://localhost:4821.
