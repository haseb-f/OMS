# ADR-0005: CRM Phase 1 — Lead Management Foundation

Date: 2026-07-28
Status: Accepted

## Context

CRM Phase 1 is the first business-workflow module in OMS (Users/Roles/Permissions and
Reference Data were infrastructure, not workflow). It needed to reference existing
Reference Data (`Country`, `Currency`) and Identity (`User`) entities — exactly the
cross-module referencing ADR-0003 anticipated — while strictly avoiding two things:
inventing business rules beyond what TASK-008 described, and implementing the Excel
import, Google Sheets import, and duplicate-detection features it explicitly deferred
to later phases.

## Decisions

**Relations to existing modules**: `Lead.countryId → Country`, `Lead.currencyId →
Currency` (both required), `Lead.salesEmployeeId → User` (nullable — unassigned until
an assignment happens), `LeadAssignment.assignedToId → User`, `LeadNote.userId →
User`. `productName` stays plain text per the task's explicit "temporary text only" —
no Product entity exists yet.

**Lead number generation**: a Postgres sequence (`lead_number_seq`, added via a
follow-up migration since Prisma's schema DSL doesn't declare custom sequences) backs
`LeadsService`'s `LD-000001`-style numbers, generated with `nextval()` inside the same
transaction as the insert. This avoids race conditions under concurrent creates
without needing application-level locking. The exact prefix/padding is an
implementation detail, not a business rule — easy to change later.

**`LeadActivity.type` is a plain string, not an enum.** `LeadStatus` and `LeadSource`
got Prisma enums because the task said "Create ONLY the following… do NOT add any
others." For activities it said "Examples:" — not a closed list — so a string leaves
room for new timeline entry types (e.g. a Phase 2 "Lead Imported") without a schema
migration. A `LeadActivityType` TS const (not a DB enum) keeps the four known values
type-safe in application code.

**Every mutating operation logs an activity in the same transaction**: create →
`LEAD_CREATED`, assign → `LEAD_ASSIGNED`, status change → `LEAD_STATUS_CHANGED`, note
added → `NOTE_ADDED`. This is what the task explicitly required ("every operation must
generate a timeline entry"), not invented behavior — no validation of _which_ status
transitions are allowed was added, since that would be the business logic this phase
defers.

**CRUD scope differs per entity, matching what each one actually is:**

- `Lead`: full CRUD (create/list/get/update/soft-delete), same pattern as every
  other module in the workspace.
- `LeadNote`: full CRUD — notes are user-authored content, editable and removable.
- `LeadAssignment`: create + read only. Reassigning a lead creates a _new_
  assignment row (history), it doesn't edit or delete an old one — update/delete
  don't make sense for an append-only log.
- `LeadActivity`: read only. It's a system-generated timeline; exposing a create
  endpoint would let a client fabricate fake history entries.

**Routing is nested under `/leads/:leadId/...`** (`activities`, `assignments`,
`notes`) rather than flat top-level resources — a deliberate difference from the
Identity/Reference-Data modules, where every entity was independent. Here, an
activity/assignment/note only exists in relation to one specific lead, so nested REST
routes are the correct shape.

**Import (`leads/import/`) and duplicate detection (`leads/duplicate-detection/`) are
architecture only, not wired into the create flow.** `ExcelImportService` and
`GoogleSheetsImportService` implement a shared `LeadImportService` interface but
throw `NotImplementedException`; `LeadDuplicateDetectionService.findPotentialDuplicates`
always resolves to `[]` and is registered as a provider but not called by
`LeadsService.create()`. Wiring it in — even as a no-op — was avoided so this phase
makes no behavioral claim about duplicate detection at all; Phase 2 does that work.

## Consequences

- Future CRM phases (order conversion, automatic assignment distribution, real
  duplicate detection, real Excel/Google Sheets import) build on this schema and these
  interfaces without re-deriving the audit/soft-delete/nesting conventions.
- `created_by`/`updated_by` on all four new tables remain unpopulated, same as every
  other module — still blocked on the deferred authentication task.
- `Lead.status`/`Lead.source` cannot gain new values without a migration (by design,
  per the task's "ONLY" instruction); `LeadActivity.type` can, without one.
- The pre-existing `apps/api` `start:prod` script (`node dist/main`, but the actual
  build output is `dist/src/main.js`) was noticed but not fixed — unrelated to CRM,
  out of scope for this task.
