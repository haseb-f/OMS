# Round 13 — recovery checkpoint

**Last update:** 2026-10-06 (R13b) — release candidate green (see evidence.md R13b). Next: merge to `main`, push (Vercel Production), verify deployment status.

## Environment (recreate after a container restart)

- Postgres 16 local: `pg_ctlcluster 16 main start`; role/db `oms:oms@localhost:5432/oms`.
- `apps/api/.env` (gitignored): DATABASE_URL, PORT=3005, JWT_SECRET, CRON_SECRET, SEED_BASE_CURRENCY=EGP. `apps/web/.env.local`: NEXT_PUBLIC_API_URL=http://localhost:3005.
- `cd apps/api && npx prisma migrate deploy && npx prisma db seed`.
- Local test fixture: one POSTED journal entry `LOCAL-GOLIVE-2025` dated 2025-12-31 so FY 2026 counts as opened (without it 14 integration suites fail with "no Opening Balance"). Not production data.

## Baseline (before Round 13 changes)

- typecheck: pass. vitest: 118 files pass. jest: 165 suites / 2040 tests pass (with the go-live fixture).

## Status

See `plan.md` checklist. Agents are not durable across a restart: after interruption, run `git status`, compare against the ownership table, and re-dispatch only unfinished scopes.

## Local preview

- API: `cd apps/api && set -a && . ./.env && set +a && node dist/src/main` (nest build emits `dist/src/main.js`; `start:prod` path is pre-existing and stale) → :3005.
- Web: `cd apps/web && npx next start -p 3001` after `pnpm build`.

## Next action

Review X and Y, integrate, full gates + migration on fresh DB + browser pass, independent review, then merge to `main` and push (Vercel Production build runs `prisma migrate deploy`), verify via GitHub deployment status (`gh api repos/haseb-f/oms/deployments`). Sandbox network blocks oms.haseb.org (HTTP verification needs the host allowed).
