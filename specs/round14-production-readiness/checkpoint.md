# R14 checkpoint log

Newest first. Each entry: time (UTC+3 local), stream, verified state, next step.

## 2026-10-07 — lead

- Research done (3 explore reports summarised in the specs). Specs 1–7 + decisions written on `integration/r14`.
- Next: create per-stream DB clones `oms_r14_w1…w5`, launch W3/W2/W4/W1/W5 implementation agents in worktrees.

## 2026-10-07 (later) — lead, integration

- W1–W5 done by agents (progress-w1…w5.md), merged into `integration/r14` in order W3, W2, W4, W1, W5.
  Merge conflicts were additive (i18n, constructor params, schema EOF blocks); schema rebuilt from
  base + per-stream patches and validated; `prisma migrate diff` vs `oms_r14_int` shows only the
  pre-existing `prepaid_expenses_receiving_account_id_fkey` drift.
- Integration fixes: amendment re-invoice no longer waits for payment; parallel-written specs use
  server sessions; **session absolute lifetime decoupled from JWT_ACCESS_TTL** (Prod measured 15 m)
  → `SESSION_ABSOLUTE_HOURS` default 12.
- Verified on merged tree: api tsc / nest build / eslint (0) ✓; jest non-serial 203 suites / 2464 ✓;
  serial 15/16 under load, agent-finance 18/18 alone (rerun pending); web tsc ✓, eslint 0 errors,
  vitest 1085 ✓, next build ✓.
- Next: full serial rerun (alone), journeys script + one browser pass on `oms_r14_e2e`, release.
