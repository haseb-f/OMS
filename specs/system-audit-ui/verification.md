# Verification — system-audit-ui

Status legend: PASS / FAIL / BLOCKED / NOT TESTED. "Local" and "Prod" evidence are listed separately.

## W2 — Controls (Production SHA 7e61bd5)

| AC                                    | Status          | Local evidence                                                                                 | Prod evidence                                                                                                          |
| ------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| AC-UI-1 shared components only        | PASS            | UI-01 inventory → UI-03a/b/c migrations; REV-01 grep: no remaining hand-rolled search/combobox | —                                                                                                                      |
| AC-UI-2 long/dynamic lists searchable | PASS (with gap) | SearchableSelect/pickers; MasterDataForm auto-searchable > 7                                   | Gap: short data-driven lists (follow-up types, workflow statuses, fiscal years, templates) stay `Select` while ≤ 7     |
| AC-UI-3 unified sizing                | PASS            | fixed widths / `h-8` / `mt-2` patches removed; ghost variant                                   | all triggers 32px desktop (report `heights=32`)                                                                        |
| AC-UI-4 Arabic-normalized search      | PASS            | `lib/arabic-search.spec.ts` 4/4; 7 toLowerCase sites migrated                                  | —                                                                                                                      |
| AC-UI-5 debounce/cache/stale guard    | PASS            | `cachedLookup` in all async pickers; stale-seq guard in EntityCombobox                         | —                                                                                                                      |
| AC-UI-6 states + create on top        | PASS            | loading/empty/no-match/error; "unavailable" fallback; create pinned                            | empty state asserted in every popup check                                                                              |
| AC-UI-7 names + keyboard              | PASS            | ids/aria on all pickers                                                                        | keyboard ArrowDown/Enter/Escape PASS; unnamed-trigger check PASS on 7 pages × 12 combos                                |
| AC-UI-8 visual matrix                 | PASS            | local 30/30 (`tmp/acceptance/LOCAL-CONTROLS-20260926c`)                                        | **86/86** `evidence/SYSTEM-AUDIT-UI-20260926/controls/controls-visual-report.json` (390/820/1440 × ar/en × light/dark) |
| AC-UI-9 behavior preserved            | PASS            | vitest 32/32, tsc, build; REV-01 verified all financial payloads unchanged                     | final journey audit 134/0/3 on 91b5086; controls 86/86 on 8679510                                                      |

## W1 — Audit & guide (Production SHA 91b5086; controls re-run on 8679510)

| AC                                                             | Status | Evidence                                                                                                                                                                               |
| -------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-AUD-1 every sidebar feature has an honest status            | PASS   | `docs/user-guide/coverage.md`: 113 sidebar routes → 61 PASS (59 Production UI + 2 API), 0 FAIL, 0 BLOCKED, 52 NOT TESTED; 44 features/flows → 37 PASS, 0 FAIL, 2 BLOCKED, 5 NOT TESTED |
| AC-AUD-2 required journeys exercised in the Production UI      | PASS   | final run DEMO-AUDIT-20260927-FINAL: **134 PASS / 0 FAIL / 3 BLOCKED** across 8 QA personas (`evidence/SYSTEM-AUDIT-UI-20260926/journeys/`)                                            |
| AC-AUD-3 role guides (purpose, tasks, stages, reports, errors) | PASS   | `docs/user-guide/roles/*.md` (8 roles), workflows.md, reports.md                                                                                                                       |
| AC-AUD-4 screenshots captured after the deploy                 | PASS   | 132 final shots in `docs/user-guide/screenshots/audit/`; 405 guide links, 0 broken                                                                                                     |
| AC-AUD-5 tagged demo records with links                        | PASS   | `demo-records.md` → final dataset DEMO-AUDIT-20260927-FINAL                                                                                                                            |
| AC-AUD-6 defects fixed or listed                               | PASS   | D1 was a defect in the audit script (fixed); D2–D11 fixed and verified in the final run; J056 landed-cost currency fixed (91b5086); popover gutter fixed (8679510); `issues.md`        |

BLOCKED, not defects:

- J041 inventory transfer: Production has only one active warehouse. Adding a second is an owner decision.
- J077/J081 qa-shipping cannot start a shipment: the role lacks `shipping.manage`. This is a role-configuration decision.

## Security hardening (Production SHA 64679e7)

| Check                                                                                                                                                                   | Status | Local evidence                                                         | Prod evidence                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Partner catalog scope and projection: allowed and denied per persona, no investor/employee/tax/notes fields, roles narrowed, GET /partners denied without partners.view | PASS   | API specs (partner-catalog-scope, find-or-create, sec03-authorization) | **62 PASS / 0 FAIL** `evidence/SYSTEM-AUDIT-UI-20260926/security/partner-catalog-access.json` |
| Same-tab admin → logout → sales agent: no /users, no admin rows, caches reset, per-user storage cleared                                                                 | PASS   | web vitest 87/87 (client-data-scope, session-sync, session-isolation)  | **25/25** `security/session-isolation-report.json`                                            |
| /new routes require the API create permission (14 routes); detail routes still require view                                                                             | PASS   | route-access.spec                                                      | 14/14 allowed/denied as expected (qa-sales-agent)                                             |
| Write routes without permission checks: now permissioned, with a static guard test                                                                                      | PASS   | sec03-authorization.spec                                               | covered by journey re-run (AUD-02)                                                            |
| Cost components migration (ON CONFLICT DO NOTHING)                                                                                                                      | PASS   | applied twice locally, idempotent                                      | GET /cost-components → 9 rows with the approved classification                                |

Full gates at 64679e7: API tsc/eslint clean, jest 1310/1310 plus serial 24/24, nest build; web tsc/eslint
clean, vitest 87/87, next build; root lint 0 errors.

## Release

| AC                          | Status | Evidence                                                                         |
| --------------------------- | ------ | -------------------------------------------------------------------------------- |
| AC-REL-1 (controls release) | PASS   | HEAD = origin/main = Production = `7e61bd5` (GitHub deployment status `success`) |
