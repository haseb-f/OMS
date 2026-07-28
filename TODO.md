# TODO

## Foundation (this stage)

- [x] Initialize Git repository
- [x] Create enterprise folder structure (`apps`, `packages`, `docs`, `scripts`, `.github`)
- [x] Add README, LICENSE, CONTRIBUTING, CHANGELOG, DECISIONS
- [x] Configure ESLint, Prettier, EditorConfig
- [x] Configure Husky + lint-staged pre-commit hook
- [x] Add `.env.example`

## Workspace Bootstrap (this stage)

- [x] Scaffold `apps/web` — Next.js (App Router, TypeScript, Tailwind, ESLint)
- [x] Scaffold `apps/api` — NestJS (TypeScript, bootstrap-only, no modules/controllers)
- [x] Create `packages/config` — shared TypeScript config presets
- [x] Create `packages/types`, `packages/shared`, `packages/ui` (empty, workspace-linked)
- [x] Configure pnpm workspace linking for all 7 projects
- [x] Configure `@mercury/*` TypeScript path aliases workspace-wide
- [x] Verify lint, typecheck, and build succeed for every app/package

## Next Stages (not started — out of scope for this task)

- [ ] Decide and record ADR for monorepo tooling (Turborepo/Nx/none)
- [ ] Set up Prisma schema and initial migration
- [ ] Set up Supabase project and connect environment variables
- [ ] Extend CI pipeline (`.github/workflows`) to run typecheck/build/test, not just lint
- [ ] Wire `apps/web` and `apps/api` to actually consume `@mercury/ui` / `@mercury/shared` / `@mercury/types`
- [ ] Define authentication strategy (JWT access/refresh flow)

> Business modules (CRM, Orders, Inventory, Accounting, Reports) are intentionally
> excluded until the foundation is reviewed and approved.
