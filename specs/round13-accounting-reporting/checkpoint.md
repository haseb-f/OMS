# Round 13 — recovery checkpoint

**Last update:** 2026-10-06 — specs written, agents about to start.

## Environment (recreate after a container restart)

- Postgres 16 local: `pg_ctlcluster 16 main start`; role/db `oms:oms@localhost:5432/oms`.
- `apps/api/.env` (gitignored): DATABASE_URL, PORT=3005, JWT_SECRET, CRON_SECRET, SEED_BASE_CURRENCY=EGP. `apps/web/.env.local`: NEXT_PUBLIC_API_URL=http://localhost:3005.
- `cd apps/api && npx prisma migrate deploy && npx prisma db seed`.
- Local test fixture: one POSTED journal entry `LOCAL-GOLIVE-2025` dated 2025-12-31 so FY 2026 counts as opened (without it 14 integration suites fail with "no Opening Balance"). Not production data.

## Baseline (before Round 13 changes)

- typecheck: pass. vitest: 118 files pass. jest: see `evidence.md` baseline line.

## Status

See `plan.md` checklist. Agents are not durable across a restart: after interruption, run `git status`, compare against the ownership table, and re-dispatch only unfinished scopes.

## Next action

Dispatch agents A-ui, A-order, B, C, D, E per `plan.md`.
