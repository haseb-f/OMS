# Mercury System

## Project Goal

Mercury System is an enterprise business platform foundation. This repository currently
contains **only the project foundation** — repository structure, tooling, and
documentation scaffolding. No business modules (CRM, Orders, Inventory, Accounting,
Reports, etc.) have been implemented yet; they will be built as separate, deliberate
stages on top of this foundation.

## Tech Stack

The foundation is prepared for the following stack (to be scaffolded in later stages):

- **Frontend**: Next.js (TypeScript)
- **Backend**: NestJS (TypeScript)
- **Database ORM**: Prisma
- **Backend-as-a-Service / Auth / Storage**: Supabase
- **Package manager / monorepo**: pnpm workspaces
- **Code quality**: ESLint, Prettier, EditorConfig
- **Git hooks**: Husky + lint-staged
- **CI**: GitHub Actions

## Folder Structure

```
.
├── apps/
│   ├── web/              # Next.js frontend (App Router, TypeScript, Tailwind)
│   └── api/              # NestJS backend (bootstrap only, no modules yet)
├── packages/
│   ├── config/           # Shared TypeScript config presets
│   ├── types/            # Shared TypeScript types (@mercury/types)
│   ├── shared/            # Shared framework-agnostic utilities (@mercury/shared)
│   └── ui/               # Shared UI component library (@mercury/ui)
├── docs/
│   ├── blueprints/       # Design/spec documents for planned modules
│   ├── prompts/          # Reusable AI-assisted development prompts
│   └── decisions/        # Architecture Decision Records (ADRs)
├── scripts/              # Operational / developer-experience scripts
├── .github/               # CI workflows, PR and issue templates
├── .husky/                # Git hooks
├── .env.example           # Environment variable template
├── DECISIONS.md           # ADR index
├── CONTRIBUTING.md        # Development workflow
├── CHANGELOG.md           # Release history
└── TODO.md                # Foundation and roadmap tracking
```

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm >= 10 (`corepack enable` recommended)

### Setup

```bash
pnpm install
cp .env.example .env
```

`pnpm install` also runs the `prepare` script, which installs the Husky Git hooks.

### Available Scripts

```bash
pnpm lint           # Run ESLint across the repository
pnpm lint:fix        # Run ESLint and auto-fix issues
pnpm format          # Format the repository with Prettier
pnpm format:check    # Check formatting without writing changes
```

## Development Rules

1. **No business logic yet.** Do not add CRM, Orders, Inventory, Accounting, Reports, or
   any other business module until the foundation stage is explicitly closed out.
2. **No demo code, no placeholder pages.** Every file added should serve the real
   project, not act as a sample.
3. **Record architecture decisions.** Any structural or technology choice goes through an
   ADR in `docs/decisions/` and is indexed in `DECISIONS.md`.
4. **Keep `.env.example` current.** Any new environment variable must be added there with
   a placeholder value — never commit real secrets.
5. **All code passes lint and format checks before commit.** Enforced locally via Husky +
   lint-staged, and in CI via `.github/workflows/lint.yml`.
6. **Conventional Commits.** See `CONTRIBUTING.md` for commit message and branching
   conventions.
7. **Apps vs. packages.** Deployable units go in `/apps`; shared, reusable code goes in
   `/packages`. Nothing business-specific belongs at the repository root.

## License

MIT — see [LICENSE](./LICENSE).
