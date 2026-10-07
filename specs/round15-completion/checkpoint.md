# R15 checkpoint log

Newest first. Each entry: date, who, verified state, next step. Recovery:

1. `git -C D:/Systems/OMS log --oneline main..integration/r15` and each `feat/r15-*` branch show what landed.
2. [requirements.md](requirements.md) is the status of every acceptance criterion (only the lead moves a row).
3. Never `git stash`, never `git add -A`; commit with explicit paths.

## 2026-10-07 — lead, start

- Branch `integration/r15` from `main` @ 8c074771 (Production code 0db15e41 = R14 + polish).
- Requirement checklist written (requirements.md). Six read-only code surveys launched (agent overview/entry,
  imports, agent shipping agreements, partners/portal auth, store-order lifecycle, sales-report scope).
- Next: write specs + decisions from the surveys, assign file ownership, launch workstreams.
