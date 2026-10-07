# R14 release record

## Scope

W1 entry/session/shared UI · W2 job-title permission templates + `shipping.assign_carrier` · W3 delivery-time
recognition (invoice + stock + COGS) with reservation, failure surfacing and repair · W4 full-disclosure
authorized lookup, repeat-customer label, customer history · W5 company partners ("الشركاء").

## Pre-release verification (local integrated build, `integration/r14`)

| Gate                                                        | Result                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------- |
| API `tsc`, `nest build`, ESLint                             | pass (0 errors)                                                 |
| API jest (non-serial)                                       | 203 suites / 2464 tests pass                                    |
| API jest (serial, run alone)                                | 16 suites / 178 tests pass                                      |
| Web `tsc`, ESLint, vitest, `next build`                     | pass (0 lint errors), vitest 1085+2 pass, build pass            |
| Migrations vs schema (`prisma migrate diff`, `oms_r14_int`) | only pre-existing `prepaid_expenses` FK drift                   |
| Permission parity (W2, 1133 users)                          | 1125 identical, 8 changed only by intended new grants, 0 lost   |
| API journeys `scripts/acceptance/r14/r14-journeys.mjs`      | 128/128 (A12 B19 C22 D33 E15 F27) → `evidence/journeys.json`    |
| Browser pass `scripts/acceptance/r14/r14-browser.mjs`       | 33/33 (ar/en, light/dark, desktop/390 px) → `evidence/browser/` |

Defects found by the browser pass and fixed before release: deliberate logout landed on `/login?next=…`
(in-flight 401 after server revocation) → fixed + regression test. Found at integration: Production
`JWT_ACCESS_TTL` is 15 m → session absolute lifetime decoupled (`SESSION_ABSOLUTE_HOURS`, default 12 h).

Not covered by the journeys (data absent locally): kit sale (covered by W3 integration tests), legacy
sales-order carrier route with a real order (permission refusal verified with a random id).

## Deployment

(filled after the push)

## Post-deploy verification

(filled after the smoke run)
