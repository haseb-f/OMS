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
| AC-UI-9 behavior preserved            | PASS            | vitest 32/32, tsc, build; REV-01 verified all financial payloads unchanged                     | journey re-run pending (AUD-02)                                                                                        |

## W1 — Audit & guide

| AC          | Status      | Evidence                                 |
| ----------- | ----------- | ---------------------------------------- |
| AC-AUD-1..6 | IN PROGRESS | AUD-01 running (tag DEMO-AUDIT-20260926) |

## Release

| AC                          | Status | Evidence                                                                         |
| --------------------------- | ------ | -------------------------------------------------------------------------------- |
| AC-REL-1 (controls release) | PASS   | HEAD = origin/main = Production = `7e61bd5` (GitHub deployment status `success`) |
