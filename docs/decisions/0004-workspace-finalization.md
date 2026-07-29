# ADR-0004: Workspace finalization — shared packages and infra scaffolding

Date: 2026-07-28
Status: Accepted

## Context

Before business modules start, the workspace needed two more shared packages
(`constants`, `validation`) and standard infrastructure folders in both apps, so future
tasks have a place to put cross-cutting code without deciding folder layout ad hoc each
time. This task's own instructions were explicit: create only empty scaffolding, don't
move or rename anything that already exists.

## Decisions

**`packages/constants` and `packages/validation`** were created mirroring the exact
shape of `packages/types` (package.json/tsconfig.json/index.ts, `@oms/config`
dev-dependency, `export {}` placeholder, no implementation, no cross-package deps
assumed). `pnpm-workspace.yaml`'s `packages/*` glob picked them up automatically;
`pnpm install` linked them (workspace count went 7 → 9).

**Backend**: `apps/api/src/{core,common,config,database,shared}/` created as empty
folders (`.gitkeep`). **Note:** `apps/api/src/prisma/` (the existing `PrismaModule`/
`PrismaService` from ADR-0002) already covers what `database/` conceptually implies.
Per this task's explicit "do not move existing code" instruction, `prisma/` was left
exactly where it is — `database/` sits empty alongside it. Whether `prisma/` should
eventually move into `database/` (or `database/` gets removed) is a decision for
whoever next touches that area, not decided here.

**Frontend**: `apps/web/src/{components,features,hooks,lib,providers,services,styles,types}/`
created as empty folders (`.gitkeep`). **Note:** this project's Next.js app already
has routes at `apps/web/app/` (not `apps/web/src/app/`), and a separate
`apps/web/features/{identity,reference-data}/` already exists from ADR-0002/0003 at
the app root, not under `src/`. This task's instructions describe `src/features/` as
one of the folders to prepare, so it now exists as an empty sibling to the populated
top-level `features/` — again, not moved or merged, per this task's explicit
constraint. Reconciling the two `features/` locations (or `app/` vs `src/app/`) is a
decision for a future task.

## Consequences

- Both new packages typecheck cleanly and build no artifacts (as intended — no
  implementation yet).
- The workspace now has a consistent place to add cross-cutting backend/frontend
  infrastructure code, without having invented what goes in it yet.
- Two naming/location overlaps (`prisma/` vs `database/` on the backend, `features/`
  top-level vs `src/features/` on the frontend) are flagged but intentionally
  unresolved — resolving them would have required moving existing code, which this
  task explicitly forbade.
