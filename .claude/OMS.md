# OMS Project

## Vision

## Architecture

## Technology Stack

## Coding Standards

## UI Standards

## Business Rules

## Accounting Rules

## Development Workflow

### Environment Policy — Local-First

This project follows a Local-First development workflow:

```
Local Development
      ↓
    GitHub
      ↓
Vercel Preview
      ↓
  Production
```

- Local development is the primary environment. Every task must be developed, run,
  tested, and fixed locally before being pushed.
- The project uses a **local PostgreSQL** database during development. Supabase is
  **not** the primary development database.
- Supabase is used only for cloud environments, after successful local testing.
- Never develop directly against Supabase.
- Never use production data during development.

### Deployment Policy

**GitHub**

- Commit only after successful local verification.
- Keep commits clean and meaningful.

**Vercel**

- Use Preview Deployments during development.
- Never deploy to Production automatically.

**Supabase**

- Use for cloud database and storage only.
- Never execute destructive migrations without explicit approval.

### Quality Gates

Every task must finish with:

- ✓ Build Success
- ✓ Lint Success
- ✓ Type Check Success
- ✓ Tests Passed

Only then: commit changes.

- Never commit broken code.
- Never push failing code.
- Never deploy unverified code.

## Decisions

## Pending Tasks
