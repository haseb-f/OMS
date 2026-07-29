# ADR-0001: Local PostgreSQL via Docker Compose, Prisma schema in apps/api

Date: 2026-07-28
Status: Accepted

## Context

`.claude/OMS.md` → Development Workflow establishes a Local-First policy: local
development must run against a local PostgreSQL database, not Supabase. Supabase is
reserved for cloud environments only, after local verification. The project needed a
reproducible way to run PostgreSQL locally and a place to configure Prisma (already
listed in the project's tech stack) without introducing any business models yet.

## Decision

- A root-level `docker-compose.yml` runs a single `postgres` service
  (`postgres:16-alpine`), exposed on host port `5434` (container port `5432`).
  Port `5434` was chosen instead of the default `5432` because other, unrelated local
  projects on this machine already occupy `5432` and `5433`.
- Prisma is configured inside `apps/api` (`apps/api/prisma/schema.prisma`,
  `apps/api/prisma.config.ts`), since the NestJS API is the service that owns database
  access. The schema currently declares only the `datasource`/`generator` blocks — no
  models.
- `DATABASE_URL` (in `apps/api/.env` / `.env.example`) points at the local Docker
  Postgres: `postgresql://oms:oms@localhost:5434/oms?schema=public`.

## Consequences

- Contributors with Docker installed get a one-command local database:
  `docker compose up -d postgres`.
- Contributors without Docker need a native PostgreSQL install using the same
  credentials/database name (`oms`/`oms`/`oms`), on whatever port they configure in
  their own `.env`.
- Because the local Postgres port is non-default (`5434`), anyone connecting with an
  external tool (psql, a GUI client) must use that port explicitly.
- No migrations or models exist yet; the next feature task that introduces the first
  real model is responsible for creating the initial Prisma migration.
