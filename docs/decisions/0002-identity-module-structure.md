# ADR-0002: Identity Module — schema conventions, Prisma driver adapters, module layout

Date: 2026-07-28
Status: Accepted

## Context

The Identity Module (Users, Roles, Permissions) is the first real module in OMS. It
needed a repeatable set of conventions for tables, audit columns, and module layout
that later modules can follow, plus resolution of a few Prisma 7-specific issues
discovered while wiring it up.

## Decisions

**Table/column conventions** (applies to every table going forward):

- UUID primary key: `id String @id @default(uuid()) @db.Uuid` (Prisma-generated, not
  DB-generated — no Postgres extension required).
- Audit columns on every table: `created_at`, `updated_at`, `created_by`, `updated_by`,
  `deleted_at`. `created_by`/`updated_by` are plain nullable `@db.Uuid` columns with
  **no foreign key** — there is no authentication yet to supply a "current user," and a
  self-referencing FK on `User` creates a bootstrapping problem for the first row.
  These stay unpopulated until an auth layer exists to set them.
- Soft delete via `deleted_at`: `remove()` in every service sets `deletedAt`, it never
  hard-deletes. `findAll`/`findOne` always filter `deletedAt: null`.
- Prisma models use camelCase fields/PascalCase names (idiomatic Prisma Client API),
  mapped to snake_case tables/columns via `@map`/`@@map` — standard Prisma convention
  for a snake_case Postgres schema.
- `RolePermission` and `UserRole` are explicit join models (not implicit
  many-to-many) so they can carry the same audit columns as every other table, with a
  `@@unique` on the two foreign keys.

**Prisma 7 driver adapters:** Prisma 7 removed the built-in engine connection method for
all client generators — a driver adapter is now mandatory. `PrismaService` constructs
`PrismaClient` with `@prisma/adapter-pg` (`PrismaPg`), reading `DATABASE_URL` via
`dotenv/config` loaded in `main.ts`.

**Generator output location:** the schema uses the default `prisma-client-js` output
(inside `node_modules/@prisma/client`), not a custom `output` path. A custom path (e.g.
`apps/api/generated/prisma`) breaks at runtime because relative imports from compiled
`dist/` code don't resolve back to a source-tree-relative folder — `@prisma/client`
resolves identically from `src/` and `dist/` via normal `node_modules` lookup.

**Backend module layout:** one Nest module per resource (`users`, `roles`,
`permissions`), each with `module/controller/service/dto`, injecting a single `@Global()`
`PrismaModule`/`PrismaService`. Basic CRUD only — no guards, no auth, no cross-module
business logic. `RolePermission`/`UserRole` are Prisma models only; no Nest modules were
created for them (not requested, and there's no business logic yet to assign roles or
permissions).

**Frontend layout:** `apps/web/features/<domain>/<module>/` (e.g.
`features/identity/users/`) as the convention for module-owned frontend code, kept
separate from Next.js's `app/` routing tree so empty/future feature folders never
accidentally become routes. Currently empty (`.gitkeep` only) — no pages or UI yet.

## Consequences

- Every future table follows the same audit-column/soft-delete/naming shape without
  re-deciding it per module.
- `created_by`/`updated_by` are inert until a future task adds authentication and a
  request-scoped "current user" — that task must decide how to populate them.
- Any future module needing a custom Prisma output path should first check this ADR's
  reasoning before reintroducing one.
- The `features/` frontend convention is now established; later tasks adding real pages
  should decide then whether pages live under `app/` and import from `features/`, or
  another pattern — not decided here.
