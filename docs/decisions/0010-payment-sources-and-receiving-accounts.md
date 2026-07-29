# ADR-0010: Payment Sources & Receiving Accounts

Date: 2026-07-29
Status: Accepted

## Context

This task explicitly reinforced a boundary that had been implicit until now: **OMS is
an ERP, not a payment gateway.** It named 20+ specific things never to build (gateway
SDKs, webhooks, OAuth, API tokens, background sync, provider adapters, ...) and
required extending the existing `PaymentSource` entity (ADR-0009) plus adding a new
`ReceivingAccount` entity, both strictly as internal reference data.

## Decisions

**Gateway/provider brand names (MyFatoorah, Geidea, Visa, Apple Pay, STC Pay, ...) are
valid _PaymentSource label text_, never an integration.** The task's own example list
includes real gateway/card-brand names as examples of what an admin might type into
`PaymentSource.name` — that's recording _how_ a customer paid as a fact, categorically
different from calling those providers' APIs. No SDK, credential field, URL field,
webhook handler, or provider-specific code was added anywhere for any of them.

**`ChartOfAccount` was added as a new, minimal reference-data entity** (`code`, `name`,
`description` only) — not because Accounting was in scope, but because
`ReceivingAccount.chartOfAccountId` is required and `PaymentSource.defaultChartOfAccountId`
needed a real FK target. It is a named list only: no posting, no journal entries, no
balances, no debit/credit logic — those remain entirely unimplemented, per "DO NOT
create: ... Accounting Posting."

**`PaymentSource` gained `code` (nullable), `sortOrder`, `isActive`, and
`defaultChartOfAccountId`, extending the entity from ADR-0009 rather than replacing
it.** `code` is nullable specifically because 6 rows already existed (seeded in
TASK-012) before this field existed — making it `NOT NULL` would have required a
backfill decision for data that predates this requirement. New rows should set it;
existing ones don't need to. `sortOrder`/`isActive` both default safely (`0`/`true`)
for the same reason — the migration only _adds_ columns, it never had to choose values
for existing rows beyond their defaults.

**`isActive` (Deactivate) is a separate lever from `deletedAt` (Archive) — and only
`PaymentSource` gets a dedicated `POST /payment-sources/:id/deactivate` endpoint.**
The task named exactly 4 admin actions for Payment Sources ("Create, Edit, Deactivate,
Archive") but only 3 for Receiving Accounts ("Create, Edit, Archive"). Read literally:
`ReceivingAccount.isActive` still exists as a field and is still toggleable through the
generic `PATCH`, but doesn't get its own dedicated verb/endpoint the way `PaymentSource`
does — matching exactly what was named for each entity, not assumed symmetric.

**`ReceivingAccount.companyId` is a nullable UUID with no foreign key** — the same
placeholder pattern already used three times in this codebase (`Lead.productId`,
`OrderItem.productId`) for a module that doesn't exist yet. Unlike `ChartOfAccount`
(central to this task, referenced by name across three of its six parts),
`CompanyId` appears exactly once, in a field list, with no dedicated section — read as
peripheral, not something this task asked for a real Company/multi-entity module to
support.

**`ReceivingAccount.currencyId` is optional, `chartOfAccountId` is not** — the task
explicitly annotated only `ChartOfAccountId` with "(Required)"; no other field on
either entity got that annotation. Taken literally rather than assumed.

**`Payment` now requires both `paymentSourceId` and `receivingAccountId`** — enforced
at the DTO level (`@IsUUID()`, not optional) and at the DB level (`NOT NULL` FK on
both). `PaymentsService.create()` validates both are not just present but `isActive`
before allowing a new Payment, extending the existing "active reference" pattern
(already used for Users, ShippingCompany) to these two.

**No Payment Sources were seeded.** Unlike TASK-012's `PaymentSource` seed (which had
an explicit "SEEDING... Reference Data only" instruction with a definitive list), this
task's list is introduced with "Examples:" — read as illustrative of the kind of value
an admin would create, not a mandate to pre-populate. The existing 6 rows from
TASK-012 were left as-is (not deleted, not reseeded) since deleting working reference
data wasn't asked for either.

## Consequences

- Every field explicitly banned by the architecture rule (credentials, API keys,
  URLs, webhook fields, provider settings, auth) was checked against the final schema
  before this ADR was written — none exist on `PaymentSource`, `ReceivingAccount`,
  `ChartOfAccount`, or `Payment`.
- Reporting ("Sales by Payment Source," "Balances by Receiving Account") is now
  structurally supported — both are plain FK relations off `Payment` — but no report
  endpoint was built, per "No report UI required."
- A future Accounting module has a real `ChartOfAccount` table to post against, but
  building that posting logic, journal entries, and balance calculation is entirely
  separate, future work.
