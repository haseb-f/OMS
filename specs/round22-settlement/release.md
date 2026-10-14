# R22 release — receipts, payments, invoice settlement

- Production: `main` = `8ac30bfa` (fast-forward from `f77ee307`), Vercel Production deployment **success** (2026-10-14).
  Migrations applied by the Production build: `20261014100000_r22_p_allocation_effective_date` (allocation dates +
  append-only allocation history; additive, idempotent — reviewed), `20261014120000_r22_t_operation_types` (enum values,
  nullable columns, OR / OP / TR series; additive).
- Streams: P (settlement core, D1–D8), T (other receipt / other payment / internal transfer / receipt refund), U (voucher
  card, MoneyInput, invoice settlement UI, list tabs), independent accounting review (APPROVED WITH FINDINGS → T1 / T2 / R1
  fixed as D9 / D10 / R1), journeys O1 fixed (D11).

## Gates (merged tree)

| Gate                                                                   | Result                                                                            |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| API typecheck / ESLint / `nest build`                                  | clean / 0 errors / OK                                                             |
| API jest (full, fresh oms_r17_int clone)                               | 2,761 / 2,763 — only `lead-eligibility` (known fixture gap on oms_r17_int clones) |
| API serial (fresh clone)                                               | 238 / 238                                                                         |
| Web typecheck / ESLint / vitest / `next build`                         | clean / 0 errors (9 old warnings) / 1,432 / 1,432 / OK                            |
| Integrated API journeys (`r22-journeys.mjs`, local)                    | 16 journeys, 382 / 382                                                            |
| Local browser (`r22-u-evidence.mjs` on the combined build + list tabs) | 30 / 30 + 3 tabs, no horizontal scroll at 1440 / 375                              |

## Live (read-only, Production)

- `r22-prod-live.mjs` 25 / 25: invoice list / detail settlement fields, settlement history, sort whitelist (400 never
  500), counter-account allow-list, other / transfer lists, receipt card amount field (text / decimal, empty,
  «أدخل المبلغ», Arabic digits, 44 px), no horizontal scroll ar 1440 / 375.
- `r14-prod-smoke.mjs` 19 / 19. `r20-prod-live.mjs` 18 / 19 — the one failure is a stale expectation: INV-2026-000091 was
  already fully paid (200,000 / 200,000) before this release (see `evidence/prod/before-release.json`); voucher integrity
  0 errors.
- Settlement probe before / after: identical vouchers, statuses and ledger gaps (0 wrong postings, 0 wrong statuses); A1
  fixed live — AR unapplied total now 86,500 EGP (was 87,650 mixing 1,150 SAR).

## Data correction

None needed: no wrong posted entry or stored status was found. CR-2026-000101 (20,000) and CR-2026-000103 (60,000) of
مكتبة النور stay unapplied while INV-2026-000093 owes 60,000 — owner decision (D8); allocation is one click on the receipt
once approved. CR-2026-000097's entry date (2026-10-12) ≠ voucher date (2026-10-11): valid per D1, left as is.

## Open

- Owner may override D9–D11 (journal-entry rights per action; strict counter-account list — Production offers 3 accounts).
- Bank-line import cannot yet be matched to a recorded transfer voucher; supplier refund out of scope.
- R1-type residual (F9): legacy vouchers posted on `confirmed_at` are picked by voucher date in as-of aging (Low).
- I-B measure leftovers: party names truncate at 1440, expenses all-columns clipping, invoice line discount addon.
