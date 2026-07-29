# Contributing to OMS

This document describes the development workflow for the OMS monorepo.

## AI-Assisted Development

- Before implementing any feature, always read `OMS.md` (`.claude/OMS.md`) first — it is
  the single source of truth for architecture, coding standards, and business rules.
- Do not invent business decisions, workflows, or architecture choices that are not
  documented in `OMS.md`.

## Prerequisites

- Node.js >= 20
- pnpm >= 10 (`corepack enable` recommended)
- Git

## Getting Started

```bash
pnpm install
cp .env.example .env
```

The `prepare` script installs Git hooks (Husky) automatically after `pnpm install`.

## Branching Strategy

- `main` — always deployable, protected.
- `feature/<short-description>` — new work, branched from `main`.
- `fix/<short-description>` — bug fixes.
- `chore/<short-description>` — tooling, config, docs.

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add user authentication endpoint
fix: correct pagination offset in orders query
chore: update eslint config
docs: update README setup instructions
```

## Pull Requests

1. Branch from `main`.
2. Keep PRs focused and small where possible.
3. Ensure `pnpm lint` and `pnpm format:check` pass before requesting review.
4. Fill in the PR template completely.
5. At least one approval is required before merging.
6. Squash-merge into `main`.

## Code Quality Gates

Every commit is checked locally via Husky + lint-staged:

- **ESLint** — static analysis, errors block commits.
- **Prettier** — formatting is auto-applied to staged files.

CI re-runs these checks on every push and pull request.

Every task must additionally pass **Build**, **Type Check**, and **Tests** locally before
its changes are committed. Never commit broken code, never push failing code, and never
deploy unverified code.

## Development Environment & Deployment

This project follows a Local-First workflow: **Local Development → GitHub → Vercel
Preview → Production**. Local development is the primary environment — develop, run,
test, and fix locally before pushing. Use a local PostgreSQL database; Supabase is not
the primary development database and must never be developed against directly or used
with production data during development. Supabase is for cloud database/storage only,
and destructive migrations always require explicit approval.

See `OMS.md` → **Development Workflow** for the full environment, deployment, and
quality-gate policy.

## Adding a New App or Package

- Applications live under `/apps` (e.g. a Next.js frontend, a NestJS API).
- Shared, reusable code lives under `/packages` (e.g. shared types, UI kit, config).
- Do not introduce a new app or package without first recording the decision in `DECISIONS.md`.

## Documentation

- Architecture decisions: `docs/decisions/` (see `DECISIONS.md` for the index).
- Design/spec blueprints: `docs/blueprints/`.
- Reusable AI/dev prompts: `docs/prompts/`.

## Environment Variables

Never commit `.env`. Add new variables to `.env.example` with a placeholder value whenever
a change introduces a new one.
