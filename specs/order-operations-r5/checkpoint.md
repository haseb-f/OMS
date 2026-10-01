# Round 5 — continuation checkpoint

Updated by the integrator whenever the state changes. If a session is interrupted, resume from here.

## State (2026-09-30)

| Branch                 | Worktree                   | Content                                                                    | State                                                                                                                                                                                  |
| ---------------------- | -------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main` = `origin/main` | `D:/Systems/OMS`           | Increment 1: specs + W2 pricing + W1B duplicates + W3 payments + E2E fixes | **Released** `5aa1c3b` (Production deployment success); Production verification in progress                                                                                            |
| `feat/r5-order-amend`  | `D:/Systems/OMS-r5-amend`  | Increment 2: W1A/C amendments + compact detail                             | reviewed twice, all findings fixed (`9e07903`); gates green (API 146 suites / 1,814 tests; web 77 / 532; builds); fast-forwarded into local `main` (not pushed); local E2E in progress |
| `feat/r5-visual`       | `D:/Systems/OMS-r5-visual` | Spec 4 visual (`cd3cc68`), reviewed + fixed                                | **awaiting owner visual approval — never release before approval**                                                                                                                     |

Gates at release of `5aa1c3b`: API 143 suites / 1,784 tests (4 fixture failures fixed → suite 20/20;
3 more fixtures hardened), API build; web typecheck, lint 0 errors, 74 files / 512 tests, build.
Local E2E journeys A (tariffs, agent order), B (duplicates, idempotency), C (declaration → match →
confirm → settle) passed; 27 page captures with 0 overflow / 0 console errors
(`tmp/r5-e2e/`).

Local DBs: `oms` (dev, migrated), `oms_r5_pricing`, `oms_r5_dup`, `oms_r5_pay`, `oms_r5_amend`.
Local Postgres `max_connections` raised to 300.

## Next steps

1. Production verification of `5aa1c3b` (read-only).
2. Increment 2: amendment fixes → merge main → gates → re-review of fixes → local E2E (edit unpaid /
   declared / posted undelivered; currency/item/amount; delivered refused) → release → verify.
3. Owner visual approval for `feat/r5-visual` (screenshots in
   `docs/user-guide/evidence/r5-visual-20260930/` on that branch).
4. Arabic handoff.

Known LOW (not fixed): payment-review date cell can clip next to the sticky actions column at 1440 when many columns are visible; an engine-level fix was tried and discarded as unverified.

Open owner decisions: D-R5-1 (customer shipping ≠ contractual agent fee); default phone country
(currently last-used, else browser region).

Never use `git stash` here — stashes are shared by all worktrees.
