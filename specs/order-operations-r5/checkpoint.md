# Round 5 — continuation checkpoint

Updated by the integrator whenever the state changes. If a session is interrupted, resume from here.

## Branches

| Branch                  | Worktree                   | Content                                                      | State                                                                                   |
| ----------------------- | -------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `main` (local)          | `D:/Systems/OMS`           | `9e517a5` specs commit on top of Production `7e8bc1f`        | not pushed                                                                              |
| `release/r5-functional` | `D:/Systems/OMS`           | main + W2 pricing + W1B duplicates + W3 payments (`d11b64a`) | reviewed + fixed; API 143/143 suites, 1,783 tests pass; API build OK; web lint 0 errors |
| `feat/r5-order-amend`   | `D:/Systems/OMS-r5-amend`  | W1A/C amendments on top of release                           | API committed (`1158ee6`, `7912638`); web WIP checkpoint `5bca61b` — in progress        |
| `feat/r5-visual`        | `D:/Systems/OMS-r5-visual` | W4 visual (`cd3cc68`), reviewed + fixed                      | **awaiting owner visual approval — never merge into a release before approval**         |

Local DBs: `oms` (dev, migrated to release), `oms_r5_pricing`, `oms_r5_dup`, `oms_r5_pay`,
`oms_r5_amend`. Local Postgres `max_connections` raised to 300 (parallel suites exhausted 100).

## Next steps

1. Finish W1A/C web + gates → independent review (finance + authorization) → fix → merge into
   `release/r5-functional`.
2. Web test + build on the merged release; one browser pass on affected pages.
3. Fast-forward `main` to the release, push (Production deploy), verify the deployed SHA and
   journeys, apply migrations on Production per the release process.
4. Owner visual approval for `feat/r5-visual` (screenshots in
   `docs/user-guide/evidence/r5-visual-20260930/` on that branch).
5. Arabic handoff.

Never use `git stash` here — stashes are shared by all worktrees.
