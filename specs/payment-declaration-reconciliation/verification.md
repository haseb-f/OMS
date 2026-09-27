# Verification — payment-declaration-reconciliation

## Production acceptance (browser, QA roles, tagged data)

RUN `DEMO-PDR-20260927` against Production SHA `0331a58` (commits 00109b0 → 0331a58), approved by the
owner on 2026-09-27. Evidence is in `docs/user-guide/evidence/PAYMENT-RECON-20260927/` (summary.md,
payment-recon-report.json, statement CSV), with screenshots in `docs/user-guide/screenshots/payments/`.

Rows marked "local" were verified only locally. There are none, apart from the tests listed further down.

| ID  | Criterion                                                                                                                         | Result                 | Key Production evidence                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Sales declares unpaid, partial or full: one pending claim each, no JE                                                             | **PASS** (5/5)         | P020 PARTIAL 200/500 → PAY-2026-000053, JEs=0; FULL → PAY-2026-000054                                                                                                                    |
| C2  | A fully declared prepaid order ships before Finance matching; partial is blocked; pickup; COD unchanged                           | **PASS** (10/10)       | RDY: shipment created 2026-09-27T09:56:42Z, no Finance match/verify, paymentStatus PAYMENT_REVIEW                                                                                        |
| C3  | Provider matching (CSV, manual, suggestions, Confirm Match & Post to clearing); non-reconciled method goes through Finance review | **PASS 7 / BLOCKED 1** | JV-2026-000337: Dr 114 Tamara clearing 500 / Cr 121 AR 500, rate 1. BK: JV-2026-000351 posts to its own account, NOT_APPLICABLE. **Google Sheets: BLOCKED**, needs a shared test sheet   |
| C4  | Batch settlement: 10 × 500, received 4,500, fee 500                                                                               | **PASS** (18/18)       | PST-2026-000002 → JV-2026-000350: Dr Bank 4,500 / Dr 522 commission 500 / Cr clearing 5,000; per-row checkboxes 12/12                                                                    |
| C5  | Retry and double-click cannot duplicate declarations, matches, settlements or postings                                            | **PASS** (6/6)         | dropped-response resubmit gives "already saved — nothing duplicated"; double-click gives 1 claim, 1 settlement, 1 JE                                                                     |
| C6  | Cross-currency: explicit fee, separate FX difference line                                                                         | **PASS** (6/6)         | USD claim X1 posted JV-2026-000347 at 51.7832 (CBE rate for the provider transaction date 26 Sep)                                                                                        |
| C7  | FX: CBE import, dated override only within its range, overlap rejected, posted rates frozen                                       | **PASS** (11/11)       | first CBE import SUCCESS (18 fetched; USD and SAR inserted for 24 Sep). 2019-only override created, then deleted (reason stored). Overlap rejected. JE rates identical after each change |
| C8  | Provider balance and GL reconcile before and after settlement                                                                     | **PASS** (4/4)         | clearing GL equals unsettled claims                                                                                                                                                      |
| S1  | Dispute after shipment flags a discrepancy; shipment untouched                                                                    | **PASS** (4/4)         | discrepancy banner shown in the Sales view                                                                                                                                               |
| S2  | Ambiguous suggestion warning                                                                                                      | **PASS** (3/3)         |                                                                                                                                                                                          |
| S3  | Currency or amount mismatch refused                                                                                               | **PASS** (2/2)         |                                                                                                                                                                                          |
| S4  | Sales cannot correct a declaration after fulfillment; Finance can (audited)                                                       | **PASS** (2/2)         |                                                                                                                                                                                          |
| S5  | Historical posted payments untouched                                                                                              | **PASS** (2/2)         | read-only snapshot before and after                                                                                                                                                      |

Acceptance script defects fixed on the way; these were not app defects:

- The product was matched by SKU text, which the picker did not display. The app now shows the SKU
  next to the price (0331a58).
- A variable shadowed another (`ord`).
- A setup flag was read after a replayed step.
- An already-matched claim was judged against a placeholder instead of its stored reasons.
- B01 shipped after it was matched, so it could not prove "before Finance matching". A fresh order,
  RDY, is used instead. It is never counted as a pass by relabelling.

Gates at 0331a58: API 1479/1479 (plus 24/24 serial), web 116/116, API and web production builds,
lint 0 errors.

## Known limitations

These are documented gaps from the REV-PDR accounting and security review. Each was accepted as
documented, not fixed, in FIX-PDR.

| ID  | Limitation                                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L2  | Idempotency replay returns the first result without comparing payloads. A declaration or match-confirm retried with the same key but a different body gets the original outcome back and no error. The key is scoped: a declaration key is refused for another order, and a match key is refused for another statement line.                    |
| L4  | Hash dedupe merges genuinely identical rows that have no provider reference. Two real provider transactions with the same amount, date, customer and status, and no reference, become one statement line. Finance adds the second one manually.                                                                                                 |
| L6  | `FxSyncSettings.maxStaleDays` defaults to 10 days, not the 3 days in plan.md. This follows `fx-source-research.md`: CBE skips Egyptian holidays and weekends, and those gaps can reach about a week. The owner can change it in FX settings.                                                                                                    |
| L9  | The `finance.payment-reconciliation.match` permission posts receipts by design. Confirm Match & Post creates the Customer Receipt and JE in the same transaction. There is no separate `sales.receipts.confirm` check on that path.                                                                                                             |
| L10 | Accounting periods under a soft-deleted fiscal year are still considered by the period-lock checks. This predates this work and is unchanged here.                                                                                                                                                                                              |
| M3  | Formula injection: statement cells are stored raw, and nothing exports statement rows to CSV today. Any future CSV/XLSX export of `rawRow` or the line fields must prefix cells that start with `=`, `+`, `-` or `@`.                                                                                                                           |
| M3  | The zip-bomb pre-scan trusts the uncompressed sizes declared in the .xlsx central directory, capped at 50 MB in total. A crafted archive can under-declare them, so the second line of defence is the sheet-dimension check (at most 5,000 data rows and 100 columns) before any cell is read. The 5 MB upload cap bounds the compressed input. |

## FIX-PDR regression coverage (API)

| Finding | Tests                                                                                                                                                                                                                                         |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1      | `payment-reconciliation.integration.spec.ts`: a claim receipt cannot be cancelled directly when it is unsettled, when it is note-linked or when it is settled; the correction path still cancels it; an ordinary receipt still cancels.       |
| H2      | `payment-reconciliation.integration.spec.ts`: reject and dispute are refused while a match is active and allowed after it is reversed. Correcting a match never revives a REJECTED claim, and it recomputes the declared status.              |
| M1      | `payment-reconciliation.integration.spec.ts` and `payment-declaration.integration.spec.ts`: a claim is refused from payment review, the matching path is allowed, and an already-posted retry returns its receipt.                            |
| M2      | `payment-declaration.integration.spec.ts`: setting the total below the standing claims is refused (409). Lowering it to the declared amount gives PAID. Raising it gives PARTIALLY_PAID, the fulfillment gate closes and no claim is created. |
| M3      | `statement-limits.spec.ts` (zip pre-scan, row and column caps, corrupt xlsx) and `payment-reconciliation.integration.spec.ts` (size, rows and columns for CSV; a 1,200-row batched import; raw values kept).                                  |
| M4      | `statement-limits.spec.ts` (canonicalisation, rejects bad ids) and the Sheets integration case (the stored and rendered URL is canonical).                                                                                                    |
| L1      | A future manual statement date is refused (`payment-reconciliation.integration.spec.ts`), and so is a future settlement date (`payment-settlements.integration.spec.ts`).                                                                     |
| L3      | `payment-methods.service.spec.ts`: changing the account is refused (409 with a count) while claims await settlement, and allowed once they are settled.                                                                                       |
| L5      | `cbe.provider.spec.ts` (host pinning, manual redirects, 2 MB body cap, deadline) and `fx-rates.integration.spec.ts` (2-minute cooldown with 429, backfill limited to 7 days or fewer, a stale RUNNING run is closed after 2 minutes).         |
| L7      | `payment-declaration.integration.spec.ts`: a prepaid pickup needs the payment gate for READY_FOR_PICKUP; COD is not gated.                                                                                                                    |
| L8      | `payment-declaration.integration.spec.ts`: after fulfillment or a VERIFIED claim, any new declaration needs correction permission.                                                                                                            |
