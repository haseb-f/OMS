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

## Polish release (from the manual's capture pass) — Production `0db15e41`

Deployment 6908789325 (2026-10-07 11:33 UTC) → success; Production smoke rerun 19/19.

- Arabic labels: actions column, missing permission action labels (lookup_global, generate_invoice, match,
  sync, settle, correct, run, reallocate, profitability_*, pay, close), impact-preview labels, movement-type
  chip, inventory-integrity metrics, document-numbering series.
- Job-titles subtitle describes default (inherited) permissions.
- Shipping import entry requires `import-center.view` like its page.
- Partner summary cards responsive (`InsightGroup fit`).
- A partner period closes only after its last Cairo day (`PERIOD_NOT_ENDED`); preview / review stay open.
  Final tree gates: api tsc ✓, web tsc ✓, jest 205 suites / 2469 tests on a fresh clone (one load-sensitive
  suite re-run alone 16/16), web vitest 1097 ✓, both builds ✓.

## User manual (W7)

`docs/user-manual/OMS-دليل-المستخدم-R14.pdf` (84 pages) and `.docx` built from the same Markdown source,
65 annotated screenshots of the final release on a clean fictitious demo database, QA in
`docs/user-manual/QA.md` (every PDF page rendered and reviewed; DOCX RTL / bookmark checks pass).
