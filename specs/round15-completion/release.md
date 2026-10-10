# R15 release record

## Scope

W1 agent overviews + one order-entry flow · W2 permission-controlled Excel / Google Sheets imports · W3 agent
shipping agreements · W4 partners section, partner login and portal · W5a store-order stock lifecycle
(reserve → transit → deliver → receive back) · W5b collection, returns, refunds, payment reversal · W6
sales-report visibility. Decisions D15-1 … D15-21 (`decisions.md`), checklist `requirements.md`.

## Pre-release verification (final integrated tree, `integration/r15`)

| Gate                                                   | Result                                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| API `tsc`, ESLint, `nest build`                        | pass (0 errors)                                                                                                                |
| API jest (non-serial, `--maxWorkers=3`)                | 221 suites / 2611 tests pass                                                                                                   |
| API jest (serial)                                      | 20 suites / 229 tests pass                                                                                                     |
| Web `tsc`, ESLint, vitest, `next build`                | pass (0 lint errors), vitest 166 files / 1174 tests, build pass                                                                |
| Migrations                                             | clean install (`oms_r15_clean`) and the deployed-schema clone (`oms_r15_e2e`) — only the pre-existing `prepaid_expenses` drift |
| API journeys `scripts/acceptance/r15/r15-journeys.mjs` | 248/248 (J1–J11) → `evidence/journeys.json`                                                                                    |
| Browser pass `scripts/acceptance/r15/r15-browser.mjs`  | 24 sessions: 887/907 → fixes → targeted rerun 806/808 (the 2 = activity rows written before the bilingual change, local DB)    |
| Independent reviews                                    | `review-accounting.md`, `review-permissions.md` with lead dispositions                                                         |

Defects found by the browser pass and fixed before release: unisolated dates in Arabic phrases (agents overview,
partner titles, report "last updated", import history, partner last payment), squeezed card labels, English
shipping-agreement activity details, mobile order button placement, phone table on the stock panel, near-black
warning text in dark mode (related records / trace groups), rank phrase forced left-to-right.

## Deployment

- Commits `b8c2d82e … 8c43566e` (7 commits) fast-forwarded to `main` and pushed once.
- Vercel Production deployment `6935885121`, SHA `8c43566e`, status **success** (2026-10-08 12:46 UTC).
  `scripts/vercel-build.sh` ran `prisma migrate deploy` (Production build), permission provisioning and the QA
  personas step.
- GitHub `Lint` workflow: the repository-wide Prettier check was already failing before R15 (118 files on
  `8c074771`); this release brought it to 40 files, 4 of them new R15 files — formatted in the follow-up docs
  commit.

## Post-deploy verification (Production)

| Check                                                                       | Result                                                                                                                                                             |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API smoke `r15-prod-smoke.mjs` (QA super admin, read-only + dry runs)       | 21/21 → `evidence/prod-smoke.json`                                                                                                                                 |
| New permission keys present (imports, `reports.sales.view_all`, returns, …) | yes — migrations + provisioning applied                                                                                                                            |
| System warehouses                                                           | `WH-TRANSIT` (TRANSIT), `WH-DAMAGED` (DAMAGED)                                                                                                                     |
| Agent tariffs → shipping agreements                                         | AG-0001: `ASA-AGR-2026-0001` 29–30 Sep (closed window) + `ASA-AGR-2026-0003` from 1 Oct; AG-0002: `ASA-AGR-2026-0002`; no overlap; 8 rates each                    |
| AG-0003                                                                     | no shipping agreement (it had no tariff rows before R15) — new AG-0003 orders are refused with the actionable message until one is activated (owner action)        |
| Browser pass `r15-prod-browser.mjs` (read-only, 17 sessions)                | **621/621** → `evidence/prod-browser/` (ar/en, desktop/390 px/dark; qa-admin, qa-finance, qa-sales-agent, qa-sales-manager, qa-shipping, agent admin, agent sales) |

The Production browser pass writes no business data: dialogs are opened and cancelled, "Next" is pressed only on
an empty customer step, the import wizard is not opened. It proves on the live site: «الشركاء» section + Home
tile, agent overviews on the shared cards with money only for finance, the migrated shipping agreement under
Agent → Settings, the shared four-step order flow (company dialog, agent page, agent-order dialog), stock
column / panel and Collection panel, in-transit / damaged inventory, own rank only for a salesperson (20 other
employee names checked absent), company-wide ranking for `reports.sales.view_all`, agent team breakdown only
for the agent admin, import menus only with an import permission.

## Production data (D15-20) — awaiting the owner's go-ahead

Dry runs on Production (no writes):

- **Stock backfill:** 7 orders with stock status "not evaluated" (all created 2026-10-07): 6 open orders
  (`STO-2026-000156` … `000161`, product `PRD-2026-000041`, 1–4 units each) would be **reserved** — 499 units
  available, so none would be short (the dry-run report lists every line still to reserve under `short`, with
  its required and available quantities); `STO-2026-000162` (delivered, movement present) would be **marked
  delivered**.
- **R14 recognition repair:** `STO-2026-000156` is delivered but was never invoiced / issued → **would be
  recognised** (invoice, stock issue, COGS journal), no blockers.

Applying both writes Production stock movements, an invoice and journal entries; the apply step was held back
for the owner's explicit confirmation. Until then the six open orders show «لم يُقيَّم بعد» and a
dispatch asks for «احجز الآن» first (per order).

## Not verified on Production (needs writes) — listed honestly

Transactional journeys were proved on the integrated local build (journeys J2–J10, browser dialogs) but not
repeated on Production, because they create business records there: creating an order through the form
(reservation), dispatch → in transit → delivery (invoice / COGS), prepaid verification and COD carrier
matching, return → receive & inspect → credit note → refund, Excel / Google Sheets imports, creating a partner
profile + login and signing in as a partner (no company partner exists on Production yet).

## Follow-up release — fixes found while capturing the user manual (`f26b0ec5`)

Capturing the R15 manual on a clean demo database (all R15 flows exercised end to end) found defects the
acceptance passes had missed; fixed before the manual's screenshots were final:

| Defect                                                                                   | Fix                                                                    | Proof                                                       |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| Import upload stored an Arabic file name as mojibake (busboy default Latin-1)            | `defParamCharset: 'utf8'` on the company and agent import uploads      | HTTP test in `agent-portal.integration.spec` + mutation run |
| Agent quote issue in English in the Arabic UI («Enter the agreed amount of every line.») | issue text by code (`orderAmendments.pricingIssue.*`), server fallback | `agent-order-entry.spec` + screen                           |
| Worked price line / list price reordered («450.00 EGP 50.00 + منتجات …»)                 | reading direction kept, amounts isolated                               | manual figure 10-07                                         |
| Dates / phones / codes reordered inside Arabic sentences on 9 screens                    | `ltrIsolate` at the call sites                                         | manual figures (agent header, shipping agreement, stock)    |
| Shipping-agreement activity showed both language halves                                  | UI-language half only                                                  | screen                                                      |
| Shortage hint promised a status «بانتظار المخزون» and automatic reservation              | text matches R15 («ناقص», «احجز الآن»)                                 | i18n                                                        |

Gates after the fixes: API tsc 0, ESLint 0, import-center + agent-portal + controller-authorization suites
19 / 586 pass, `nest build`; web tsc 0, ESLint 0 errors, vitest 166 files / 1175 tests, `next build`.
Pre-existing (not R15 screens, not changed): unisolated dates in FX settings, asset schedules and expense
voucher rate captions.

## User manual (R15)

`docs/user-manual/OMS-دليل-المستخدم-R15.pdf` (110 pages) and `.docx` from the same source; 85 figures
(20 new, 6 redefined, all recaptured) on the demo database migrated forward from the R14 manual database;
chapters 1–13 updated to the released behaviour; QA in `docs/user-manual/QA.md` (every page rendered and
reviewed, legends = callouts by script, DOCX invariants pass). The R14 files are removed from the folder
(kept in git history).

### Production data applied (owner approval 2026-10-10)

`APPLY=1 r15-prod-smoke.mjs` 28/28 → `evidence/prod-smoke-apply.json`: stock backfill reserved 6 open orders
(none short) and marked 1 delivered; R14 recognition repair recognised `STO-2026-000156` (invoice, stock issue,
COGS). Re-runs are no-ops. Stock states now: 5 reserved, 2 delivered, 0 pending.
