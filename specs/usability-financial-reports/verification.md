# Verification — usability refinements & financial report correctness

Date: 2026-09-29 · Base: `a126bdd` (Agents release) · Environment: local (web :3001, API :3005, local
Postgres). The local data is test fixtures (for example negative total assets), so the numbers below
prove the arithmetic and cross-report ties, not the business data.

## Quality gates

| Gate                                                 | Result                                    |
| ---------------------------------------------------- | ----------------------------------------- |
| Web `tsc --noEmit`                                   | 0 errors                                  |
| Web ESLint                                           | 0 errors (9 pre-existing warnings)        |
| Web vitest                                           | 61 files, 446/446                         |
| API `tsc --noEmit`                                   | 0 errors                                  |
| API ESLint (changed files)                           | clean                                     |
| API jest (full, `--maxWorkers=4`)                    | 132 suites, 1650/1650                     |
| Web `next build` / API `nest build`                  | success                                   |
| Contrast check (`scripts/design/contrast-check.mjs`) | pass, including new toast and table pairs |
| Prettier (changed files)                             | clean                                     |

## Independent reviews

1. **Bulk selection and permissions** (read-only reviewer). No bulk-action permission was removed or
   weakened; each bulk endpoint is guarded server-side with the same permission the UI checks.
   Defects found and fixed: select-all ignored the profitability filter server-side (HIGH); "all
   matching" was inferred from counts; external filter bars did not clear selections; bulk-endpoint
   limits were not surfaced; header hit targets below 24px. See `tables-selection.md` §3a/§3b.
2. **Financial calculations** (read-only reviewer, direct SQL against the local DB). Every recomputed
   figure matched the API. Defects found and fixed: unstable Journal Report paging (existing bug —
   print/export duplicated and dropped entries), opening-balance entries counted as cash flows,
   borrowings classified as operating, tautological cash check, current-year profit after a reversed
   closing, header nesting, warnings missing from print/export, year-closing carry-forward double
   count. See `accounting-review.md` §11.

## Live cross-report reconciliation (`tmp/acc/reconcile.mjs`, 2026-09-01..2026-09-30)

| Check                                                               | Figures                       | Result |
| ------------------------------------------------------------------- | ----------------------------- | ------ |
| TB period debits = credits                                          | 12,202,681.71 = 12,202,681.71 | pass   |
| TB opening / closing net to zero                                    | 0 / 0                         | pass   |
| BS assets = liabilities + equity                                    | −557,345.25 = −557,345.25     | pass   |
| TB closing assets / liabilities / equity = BS                       | match                         | pass   |
| IS net profit YTD = BS current-year profit                          | −4,044,559.64 = −4,044,559.64 | pass   |
| IS lines partition = account-type totals                            | difference 0                  | pass   |
| CF opening + activities + FX = closing = independent ledger balance | 1,485,225.39                  | pass   |
| CF closing = BS cash and cash equivalents                           | 1,485,225.39                  | pass   |
| Journal Report paging                                               | 3,214 rows, 3,214 unique      | pass   |

12/12 checks pass (also run for 2026-08-15..09-15 and all-time during development). The reports flag
36 unclassified P&L accounts and 43 unclassified balance-sheet accounts locally (agent/settlement
fixture accounts) — visible in an "Unclassified" section, never dropped.

Known-result unit tests: `apps/api/src/accounting/reports/financial-statements.spec.ts` (gross profit
610 vs net profit 305, returns/discounts, selling vs admin, unclassified surfacing, BS equation with
current-year earnings, TB opening/movement/closing across a boundary, cash-flow reconciliation with an
internal transfer excluded, reversal netting, opening-balance entries, borrowings, reversed closing).

## Browser pass (`tmp/usability/verify.mjs`, Playwright, one pass)

38/40 automated checks pass; the two non-passes are expected:

- `console.noErrors` — the only console error is the HTTP 500 the script injects deliberately to test
  the failure toast.
- `phone.paste.foreign.noSilentSwitch` — the script looked for the "+20" prefix; after the review fix
  the locked prefix is hidden once the typed number carries its own "+CC" (showing both read as two
  codes). The phone country stays Egypt; a warning icon and "Switch country to Saudi Arabia" are shown.

Covered: selection control (surface, menu, page scope, all-matching scope, clearing on search, error and
success toasts from real flows), row hover / no layout shift on selection, phone field (LTR, prefix +
placeholder from a smart default country, no error while typing, error on blur, Arabic digits,
same-code paste without duplication, foreign paste conflict), report switcher (group headings, active
report, keyboard selection), the four statements in AR-light and EN-dark, and store orders / customers in
AR/EN × light/dark × desktop/mobile with zero horizontal overflow.

Screenshots: `tmp/usability/out/*.png`; before/after baselines: `tmp/ui-baseline/usability-before*/` and
`tmp/ui-baseline/usability-after/` (gitignored evidence).

Findings fixed during the browser pass: no default phone country in the manual order dialog (no prefix,
misleading "doesn't match the selected country" error); name/country/phone not grouped; conflicting
"+20 +966…" display with a green check on a conflicting number.

## Production (after deploy)

Release `f75db61` is live in Production: deployment `6728773695`, state `success`, created
2026-09-29T07:05Z. A read-only reconciliation was run through the Production API as the QA admin
persona (GET requests only), with the same `tmp/acc/reconcile.mjs`, for 2026-09-01..2026-09-30.
All 12/12 checks pass:

| Check                                                         | Production figures                   |
| ------------------------------------------------------------- | ------------------------------------ |
| TB period debits = credits                                    | 31,548,992.34 = 31,548,992.34        |
| BS assets = liabilities + equity                              | 377,120.90 = 9,649.50 + 367,471.40   |
| IS net profit YTD = BS current-year profit                    | 367,470.40 = 367,470.40              |
| IS: net revenue → gross profit → operating profit (September) | 777,773.18 → 372,968.27 → 370,253.63 |
| CF closing = independent ledger cash = BS cash                | 77,094.33                            |
| Unclassified accounts                                         | 0 (IS and BS)                        |
| Journal Report paging                                         | 347 rows, 347 unique                 |

## Not verified / limitations

- Compliance: the statements follow the IAS 1 / IAS 7 structure documented in `accounting-review.md`,
  but that is not a compliance certification — open policy points P2–P12 remain owner decisions.
