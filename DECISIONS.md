# Architecture Decisions

This file is an index of Architecture Decision Records (ADRs) for OMS.
Each decision is recorded as an individual, numbered file under `docs/decisions/`.

## Format

Each ADR follows this structure:

```
# ADR-<number>: <title>

Date: YYYY-MM-DD
Status: Proposed | Accepted | Superseded | Deprecated

## Context
What is the issue that we're seeing that motivates this decision?

## Decision
What is the change that we're proposing/have agreed to?

## Consequences
What becomes easier or harder as a result of this change?
```

## Index

| ID                                                                      | Title                                                                       | Status   |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------- |
| [0001](./docs/decisions/0001-local-postgresql-via-docker-compose.md)    | Local PostgreSQL via Docker Compose, Prisma schema in apps/api              | Accepted |
| [0002](./docs/decisions/0002-identity-module-structure.md)              | Identity Module — schema conventions, Prisma driver adapters, module layout | Accepted |
| [0003](./docs/decisions/0003-reference-data-engine.md)                  | Reference Data Engine — master data modules, seeding                        | Accepted |
| [0004](./docs/decisions/0004-workspace-finalization.md)                 | Workspace finalization — shared packages and infra scaffolding              | Accepted |
| [0005](./docs/decisions/0005-crm-lead-management-foundation.md)         | CRM Phase 1 — Lead Management Foundation                                    | Accepted |
| [0006](./docs/decisions/0006-crm-phase2-business-rules.md)              | CRM Phase 2 — Business Rules                                                | Accepted |
| [0007](./docs/decisions/0007-sales-orders-phase2-core.md)               | Sales Orders Phase 2 — Core Implementation                                  | Accepted |
| [0008](./docs/decisions/0008-sales-orders-refactor-task012.md)          | Sales Orders Refactor (pre-Payment Verification)                            | Accepted |
| [0009](./docs/decisions/0009-payment-verification-phase1.md)            | Payment Verification Module — Phase 1                                       | Accepted |
| [0010](./docs/decisions/0010-payment-sources-and-receiving-accounts.md) | Payment Sources & Receiving Accounts                                        | Accepted |

> Add new rows here as ADRs are created in `docs/decisions/`.
