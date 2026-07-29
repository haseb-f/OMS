# ADR-0006: CRM Phase 2 — Business Rules

Date: 2026-07-28
Status: Accepted

## Context

Phase 2 turned the Phase 1 CRUD foundation into an operational workflow: real
duplicate detection, manual assignment with an "active sales employee" constraint,
named business-operation endpoints, and a schema refactor (`productName` → `productId`).
Several implementation choices weren't fully specified by the task and needed a
decision, documented here rather than invented silently.

## Decisions

**`productName` → `productId` is a drop + add, not a rename.** The column type changes
(required `TEXT` → nullable `UUID`, no FK — the Product module doesn't exist).
Migration `20260728190331_crm_phase2_business_rules` drops `product_name` and adds
`product_id` (nullable) and `possible_duplicate` (boolean, default `false`).

**Duplicate detection** (`LeadDuplicateDetectionService.check`) queries all
non-deleted leads sharing `mobileNumber` + `customerName`, then classifies in
application code: if any match shares the same `productId` (including both-null) →
exact duplicate → `LeadsService.create()` throws `ConflictException('Duplicate Lead')`
(409). Otherwise, if any match exists at all → `possibleDuplicate: true` on the new
lead. This is an application-level check inside the create transaction, not a DB
unique constraint — a constraint would need a partial index excluding soft-deleted
rows and wasn't asked for; the small race window this leaves (two simultaneous
identical submissions) was accepted rather than adding that complexity unprompted.

**"Active sales employee"** = a `User` row that exists and is not soft-deleted
(`deletedAt IS NULL`). The workspace has no employee-type or "Sales Employee" role
convention (Identity's Role/Permission tables are generic, nothing seeded is
canonically named that), so requiring a specific role would be inventing a naming
convention. `LeadAssignmentsService.assign()` now checks this and rejects (400) if the
target user doesn't exist or is inactive. "Manager can assign" describes the intended
actor, not an enforced check — there's still no authentication, so nothing restricts
_who_ calls the endpoint, same as every other endpoint in the system.

**Automatic distribution stays architecture-only.** `LeadAutoDistributionService.distribute()`
is a registered-but-unused no-op — explicitly required by the task ("Architecture
only... Do NOT implement scheduling"). No scheduler package was installed.

**New endpoints reuse existing service logic, not duplicate it.**
`POST /leads/:id/assign` delegates to the same `LeadAssignmentsService.assign()` used
by the Phase 1 `POST /leads/:leadId/assignments` — both endpoints now coexist (nothing
removed, per the task's explicit instruction), sharing one implementation.
`startFollowUp`/`markPaid`/`archive` share a new private `LeadsService.transitionStatus()`
helper so every named business operation logs its activity in the same transaction as
the status change, consistently.

**Named business operations always log their activity**, regardless of the lead's
current status — no transition validation (e.g. "can't mark-paid a NEW lead") was
added, since the task specified the operations and the timeline requirement, not a
state machine. The pre-existing generic `PATCH /leads/:id` (Phase 1) is unchanged and
still logs a generic `LEAD_STATUS_CHANGED` activity when it changes status directly.

**Mobile format validation** uses `class-validator`'s `@IsPhoneNumber()` with no fixed
region — it requires E.164 international format (a leading `+` and country code)
rather than a specific country's local format, since Leads can come from any country
and no single format was specified. `libphonenumber-js` was added as a direct
dependency of `apps/api` (the runtime library `class-validator` needs for this
decorator).

## Consequences

- `LeadActivityType` now has 7 known values (`LEAD_CREATED`, `LEAD_ASSIGNED`,
  `LEAD_STATUS_CHANGED`, `FOLLOW_UP_STARTED`, `MARKED_PAID`, `ARCHIVED`, `NOTE_ADDED`);
  still a plain string column, not an enum, so Phase 3+ can add more without a migration.
- `possibleDuplicate` is set once at creation and never re-evaluated or clearable by
  this phase — a future task decides if/how it gets resolved in the UI.
- Real duplicate detection and active-employee checks are the first actual business
  logic in CRM; Phase 1's "no business logic" placeholders (duplicate detection,
  import) are now partially graduated — import remains untouched/unimplemented.
