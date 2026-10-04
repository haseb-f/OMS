# Round 7 — final security review, verification and release (2026-10-04)

Follows `evidence-release.md` (Prod `1f806f3`). This pass independently re-reviewed the R7 security
findings on the integrated tree, fixed what was still open, re-validated the FX evidence, ran every gate
on the final tree and released. Verification database: `oms_r7_final` (clone of `oms_r7_int`, migrated).

## 1. Security findings — status after this pass

| Finding                                                                   | Status   | What is live                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy `/partners/global-lookup`, `/store-orders/global-lookup`           | closed   | Kept (the create-order prefill still uses them) but secured: `customers.lookup_global` / `orders.lookup_global` gate, customers-only, agent-only customers invisible, masked shape for records the caller cannot open, same atomic audited budget as the advanced lookup. **New:** fail closed — if the throttle/disclosure services are not wired the route answers 503 instead of running unthrottled.                                                                     |
| Customer enumeration via name prefixes                                    | closed   | Name search needs first + last name (2 words, ≥ 6 letters); a query matching > 5 customers returns no rows; phone needs ≥ 7 digits; 15 lookups / 10 min and 100 / day per user across every discovery route; every call audited. Verified by `customer-lookup.integration.spec.ts` (single word refused, broad name → empty, parallel burst 15 ok / 10 limited).                                                                                                             |
| Overly broad lead/order access                                            | closed   | **New:** `store-orders.manage` no longer widens the scope (Production: an ordinary sales employee in the Sales department holds it and therefore saw every order). The wide view is the new explicit `store-orders.view_all` (catalog row, granted to nobody; Super Admin bypasses; company-wide `crm.leads.manage` keeps the full view). `manage` also no longer grants payment-evidence management.                                                                        |
| Unscoped order sub-resources (found in this pass)                         | closed   | `GET /store-orders/:id/activities`, `GET …/shipments`, `GET …/shipments/attachments` and `GET …/economics` answered for any order id. All routes under `/store-orders/:id/*` now run behind the single by-id gate (`SalesScopeService.assertCanOpenStoreOrder`); shipping mutations too. Regression tests added to `sales-scope.isolation.integration.spec.ts`.                                                                                                              |
| Distribution eligibility + backfill                                       | closed   | One shared rule (`LeadEligibilityService`): INTERNAL, active, unlocked, employment ACTIVE, `crm.leads.edit`, explicit `salesDistributionEligible`. Excluded users are returned with the reason. Production read-only check (below): every Sales-department employee is flagged; the only unflagged `crm.leads.edit` holders are two administrators (one of them Super Admin). No non-sales employee is flagged.                                                              |
| Commit `552114e` (addPayment scope, customers-only phone, atomic limiter) | reviewed | addPayment: `POST :id/payments` is Finance-only (`customer-receipts.create`) and not called by the web; the added `findOne(id, userId)` applies the same by-id gate as every sibling route; declarations create a payment row, so Finance opens declared orders. Phone lookup: customer role check + agent-footprint exclusion verified in tests. Limiter: per-user advisory xact lock + PENDING reservation; a reservation that never finalises still counts (fail closed). |

### Production grants (read-only, `scripts/acceptance/r7-prod-grants-readonly.mjs`, 2026-10-04 ~04:30 UTC)

12 active internal users. `store-orders.manage`: one Sales-department sales employee + the QA admin → after this
release the sales employee sees only their own orders. `crm.leads.manage`: two administrators + one QA
account. `customers.lookup_advanced`: QA admin only. `store-orders.view_all`: nobody (grant it in the Permission
Matrix to whoever must browse every order without being Super Admin). Flagged for distribution: three
Sales-department users + one QA sales-manager account.

## 2. FX — independent validation

- Production run history (read-only, `fx-prod-readonly.mjs`, re-run 2026-10-04): 18 runs, 14 `CRON/SUCCESS`
  (14:02 and 20:22 UTC daily 28 Sep → 3 Oct), 4 `MANUAL/SUCCESS`, no failures; newest effective date 2026-10-01
  (CBE publishes on working days; Fri/Sat kept Thursday's rate), age 3 days, stale alert at 4, hard stop at 10.
- Saved rates cross-checked against the live CBE page with the repo parser (`tmp/r7-final/cbe-run.cjs`):
  CBE 2026-10-01 USD buy 52.2571 / sell 52.3971, SAR 13.9167 / 13.9555 — identical to the Production rows;
  stored `rate` = (buy + sell) / 2 (MID basis) for every row checked.
- Account-currency behaviour (not the label): `account-currency.integration.spec.ts` — foreign receipts post at each
  date's own rate and the native balance is the sum of native amounts; opening carried from earlier entries; a
  functional-currency posting into a SAR-bound account is reported and its native amount is **unproven** (WARN
  default); `ACCOUNT_CURRENCY_POLICY=BLOCK` refuses it; cash availability shows a foreign receiving account in its
  own currency, never the functional sum relabelled; a cancelled receipt nets via its original rate.
  `fx-scheduler.integration.spec.ts` — cron bearer/secret/slot handling, late-slot catch-up, never overwrites
  a manual row. Production audit (earlier, read-only): 0 mismatching lines on currency-bound accounts.
- Gaps: `CRON_SECRET` and `ACCOUNT_CURRENCY_POLICY` are now documented in `apps/api/.env.example`.
  Revaluation policy items 1–10 (`fx-policy-gap.md`) remain owner decisions; no revaluation was posted and no
  history was rewritten.

## 3. Gates on the final tree

| Gate                                                                              | Result                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API typecheck / lint                                                              | pass / 0 errors                                                                                                                                                                                                                                                                                                                                                             |
| Web typecheck / lint / unit tests                                                 | pass / 0 errors (11 pre-existing warnings) / 100 files, 718 tests pass                                                                                                                                                                                                                                                                                                      |
| API production build / web production build                                       | pass / pass                                                                                                                                                                                                                                                                                                                                                                 |
| API jest (163 suites incl. the DB-dependent ones)                                 | final tree: 161/163 in the parallel run (2005/2007 tests); the two load-sensitive suites `partner-phone-keys.integration` (transaction-start timeout) and `import-center/sync/data-synchronization` (30 s test timeout) pass alone with `--runInBand` (2/2 suites, 40/40 tests) — same signature as the first R7 release                                                    |
| API `test:serial` (9 suites)                                                      | 9/9, 60 tests                                                                                                                                                                                                                                                                                                                                                               |
| Migration `20261004093000_r7_store_orders_view_all`                               | applies cleanly (additive: one catalog row, no data change)                                                                                                                                                                                                                                                                                                                 |
| Live API journeys `r7-journeys.mjs`                                               | 45/45 on the final build                                                                                                                                                                                                                                                                                                                                                    |
| Browser pass (`tmp/r7-final/browser-journeys.mjs`, evidence in `evidence/final/`) | 14/14: Sales A sees 3 own leads / 2 own orders, other owner's order and lead not opened ("تعذر العثور على هذا العنصر"); Finance lands on its dashboard, no generic order list, payment review renders; Agent Admin / Agent Sales land on `/agent`, internal leads route not served, agent token 403 on `/leads`; Super Admin exchange-rates page shows the CBE status panel |

Minor UX (not blocking): a lead detail URL the caller cannot open renders an empty page instead of the
"not found" state the order page shows.

## 4. Visual addendum — blue tonal toolbar sequence (NOT released)

Implemented on `feat/r7-toolbar` (`27af7ce` + `7a16653`), one shared mechanism: `ListToolbar` numbers its
ordinary controls in logical order and a single recipe maps `data-tone="1..5"` to `--toolbar-tone-*` tokens derived
from `--brand-blue` (light and dark), applied-filter = uniform pale ring, semantic controls / search / checkboxes /
dropdown content untouched, contrast checked for all pairs. Before/after evidence (Leads, Orders, Customers,
agent Leads/Orders; AR/EN; 1440 and 375; dark) in `specs/round7-grid-scope-fx/evidence/toolbar/` on that branch.
Awaits the owner's visual approval before merge.

## 5. Release

Filled in after deployment (SHA, deployment id, Production checks).
