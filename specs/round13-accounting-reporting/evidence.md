# Round 13 — verification evidence

Local stack: web :3001 (`next start`, production build), API :3005 (`node dist/src/main`), PostgreSQL 16 `oms` (seeded + go-live fixture). Not deployed.

## Gates (integrated tree, after review fixes `0212f2b`)

| Gate                     | Result                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck (all packages) | pass                                                                                                                                                                                  |
| ESLint                   | 0 errors (82 warnings, pre-existing style)                                                                                                                                            |
| Build (api + web)        | pass                                                                                                                                                                                  |
| Vitest (web)             | 127 files / 905 tests pass                                                                                                                                                            |
| Jest (api)               | 176 suites / 2123 tests pass (2 of 3 full runs; 1 run had one intermittent failure in `store-order-duplicates.integration` that passes alone — cross-suite DB interference, recorded) |
| Jest serial              | 10 suites / 71 tests pass                                                                                                                                                             |
| Baseline before R13      | jest 165 / 2040, vitest 118 files — all pass                                                                                                                                          |

## Spec evidence

- A: browser journeys 1–4, 10 (phone override customer/supplier/user, password generate/reveal/copy, mobile dropdown wheel + touch scroll in dialog, 4-step mobile order with double-click → one order, blue direction RTL/LTR); vitest step-flow, order-create-steps, password generator, phone calling code, popover scroll.
- B: `evidence-B.md` (invariant → test table), `r13-coa-invariants` (15), `r13-ft-posting` (8: expense routing, AP-only supplier payment, partial / advance, wrong partner, idempotency), FX state vitest (19); browser journeys 5–6.
- C: `evidence-C.md` — `asset-schedules.serial` (draft future rows, due posting, retry no duplicate, locked period, disposal catch-up + CANCELLED, invoice-line asset without double capitalization, linked draft asset adopted, prepaid lifecycle, race 409); browser journey 7.
- D: `evidence-D.md` — `r13-payment-methods-statements` (backfill, channel derivation, saved mapping, idempotent re-import, refund lines + net, match index, cross-engine guard); grouped settlement suite; browser journey 8.
- E: `sales-metrics.spec` (10, Cairo midnight + DST), `sales-reports.integration` (8: per-bucket counts and per-currency sums on known orders, ranking, OWN / TEAM / ALL, agent A ≠ agent B, token crossing 403); browser journey 9 (ar/en, light/dark, 390 px).
- FX local execution: cron without secret → 401; with secret → run recorded FAILED with message (sandbox network blocks CBE: HTTP 403). No production access from this environment.

## Browser

`evidence/browser-acceptance.md` / `.json`: **74 / 74** on the final rebuilt stack; 14 screenshots `evidence/r13-*.png`. Bugs found in the first pass and fixed: Arabic comma in English order review; Live card title collapsing beside a long date badge (currency list now folds after 4).

## Review

`review.md` — independent review: 0 blockers; 5 should-fix + minors fixed in `0212f2b`; 2 lock races documented.
