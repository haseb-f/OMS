# TODO

## Foundation (this stage)

- [x] Initialize Git repository
- [x] Create enterprise folder structure (`apps`, `packages`, `docs`, `scripts`, `.github`)
- [x] Add README, LICENSE, CONTRIBUTING, CHANGELOG, DECISIONS
- [x] Configure ESLint, Prettier, EditorConfig
- [x] Configure Husky + lint-staged pre-commit hook
- [x] Add `.env.example`

## Next Stages (not started — out of scope for this task)

- [ ] Decide and record ADR for monorepo tooling (Turborepo/Nx/none)
- [ ] Scaffold first app under `/apps` (e.g. Next.js frontend)
- [ ] Scaffold first API under `/apps` (e.g. NestJS backend)
- [ ] Set up Prisma schema and initial migration
- [ ] Set up Supabase project and connect environment variables
- [ ] Add CI pipeline (lint, typecheck, build, test) in `.github/workflows`
- [ ] Define shared packages (`packages/config`, `packages/types`, `packages/ui`, etc.)
- [ ] Define authentication strategy (JWT access/refresh flow)

> Business modules (CRM, Orders, Inventory, Accounting, Reports) are intentionally
> excluded until the foundation is reviewed and approved.
