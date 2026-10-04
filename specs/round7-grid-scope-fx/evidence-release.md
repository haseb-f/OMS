# Round 7 — release evidence (integrated tree `release/r7`)

Integrated from `feat/r7-grid`, `feat/r7-scope`, `feat/r7-visual`, `feat/r7-fx` on top of `main` (which
already carried the unpushed R6-2 merges). Everything below was run on the final integrated tree.

## Gates

| Gate                                                        | Result                                                                                                                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API typecheck / web typecheck                               | pass / pass                                                                                                                                                |
| API lint / web lint                                         | 0 errors (11 pre-existing web warnings)                                                                                                                    |
| API production build / web production build                 | pass / pass                                                                                                                                                |
| Web unit tests                                              | 100 files, 718 tests pass                                                                                                                                  |
| API jest (parallel, 163 suites incl. the DB-dependent ones) | 162 pass; `import-center/sync/data-synchronization` failed once under parallel load and passes alone (33/33)                                               |
| API `test:serial` (9 suites, incl. lead distribution)       | 9/9 pass, 60 tests                                                                                                                                         |
| Migrations                                                  | 4 new (R6 follow-up outcome, R6 settings permissions, R7 lead views, R7 scope/lookup/distribution) apply cleanly on a fresh clone; backfill result checked |

## Security fixes (review findings) and proof

- `POST /store-orders/:id/payments` skipped the record-scope check: any holder of `sales.receipts.create` could post a
  payment on any order. Regression test fails without the fix (201) and passes with it (denied).
- Legacy `/partners/global-lookup` and `/store-orders/global-lookup`: full details only for a record the caller can already
  open; everyone else gets masked name/phone (+ order number and coarse status for orders). Same atomic, audited budget as
  the advanced lookup (shared `LookupThrottleService`, advisory-lock reservation; a 25-request parallel burst yields exactly 15 ok / 10 limited).
- Advanced lookup: phone matches are customers only; name search needs two words (first + last) and a query matching more than
  5 customers returns no rows, so prefix sweeping yields nothing.
- Distribution eligibility: one shared function; explicit sales designation; backfill also flags users who already own a
  company lead (Production's Sales department code is `DEPT-0001`, not `DEPT-SALES`) and never auto-flags super admins.

## Live API journeys (`scripts/acceptance/r7-journeys.mjs`, local integrated build, demo personas): 45/45

Sales A/B see only their own leads/orders (lists, by-id, notes, payments); Finance and Shipping get no generic sales list;
lookup shape is fixed/masked/not openable, single-word and short queries refused, agent token denied; agent-only customers are
invisible to company staff; Agent A cannot read Agent B records; agent tokens cannot reach internal routes; distribution lists
Sales A/B eligible, Finance excluded as `NOT_SALES_DESIGNATED`, no agent user in the internal pool.

## Browser journeys (built-in browser against the integrated build)

Sales A (dashboard shows scoped 3 leads / 2 orders; leads list = 3 rows; grid cards with "New to you" and status badge;
density and view persist per user per table after reload; Store Orders 2 rows; advanced lookup returns the masked,
"not assigned to you" row), Agent Admin and Agent Sales (own agent only, `/agent` landing), Finance (finance dashboard),
super-admin (FX status panel). Closed navy triggers: computed `rgb(4, 32, 60)`, white text, weight 500, radius 6; dark mode
resolves to `rgb(14, 42, 75)`; text inputs and outline buttons unchanged; English/LTR and 375 px mobile: no horizontal overflow.

## CBE import (Production, read-only, re-run independently)

`scripts/acceptance/fx-prod-readonly.mjs`: 14 `CRON/SUCCESS` runs (14:02 and 20:22 UTC daily, 28 Sep – 3 Oct), imports on
publication days, duplicates skipped on the second daily run, weekend keeps Thursday's rate, SAR→EGP resolves today to the CBE rate with no override.
