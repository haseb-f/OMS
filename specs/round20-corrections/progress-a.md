# R20 — Stream A progress: lead «لم يُفتح» follows the assigned employee

Branch `feat/r20-lead-opened` (worktree `.claude/worktrees/agent-a86f19c6a94d6e9f9`). Local only — no push / merge.

## Root cause

Two mechanisms were mixed up:

1. The badge (R7 / R17) was **per viewer**: `GET /leads` returned `viewedByMe` from `lead_views` for the
   CALLER, so a manager or admin kept seeing «لم يُفتح» until they opened the lead themselves, and the
   employee's open never cleared it for anyone else.
2. `LeadsService.firstOpen` set `Lead.firstOpenedAt` only for the owner AND a NEW lead AND a successful
   NEW → IN_PROGRESS transition — so the open changed the business status (now forbidden) and a non-NEW,
   refused or reassigned lead never recorded the open. The web also fired `/viewed` on mount, before the
   detail load succeeded.

## Design

- `Lead.openedByAssigneeAt` — the CURRENT assignee's first detail open in the current assignment; null
  = «لم يُفتح» for every viewer (employee, manager, admin; table + grid; agent portal). Plain column on
  the row, so every list already carries it (no per-row query).
- `lead_assignee_opens` (`LeadAssigneeOpen`) — audit history per (lead, user): first / last open +
  count. Reassignment keeps it.
- `LeadAssigneeOpensService.record(leadId, userId, agentId)` — the one write path. Locks the lead row
  (`FOR UPDATE`, serializes with assignment), counts only when `sales_employee_id = caller` AND
  `agent_id = boundary` (null from company screens, the caller's agent from the portal). First open of an
  assignment sets the flag (+ `firstOpenedAt` if empty) via raw SQL so `updatedAt` does not move, and logs
  one `OPENED_BY_ASSIGNEE` timeline entry; repeats only move `lastOpenedAt` / `openCount`.
  Never touches the status.
- Endpoints: `POST /leads/:id/open` (`crm.leads` view; `findOne` scope first → hidden lead = 404) and
  `POST /agent-portal/leads/:id/open` (`agent.leads.view`; agent visibility first). Removed:
  `POST /leads/:id/first-open` (status side effect) and `POST /leads/:id/viewed` (per-viewer). The
  convert path no longer writes `firstOpenedAt` (a conversion is not an open).
- Reassignment: `LeadAssignmentsService.assign` is the single assignment write path (manual, bulk,
  auto-distribution, held release, import, agent admin). It now sets `openedByAssigneeAt = null` in the
  same `lead.update` (same transaction) when the owner changes; same-owner re-assign keeps it. A grep of
  every `lead.update*` confirmed no other path writes `salesEmployeeId`.
- `lead_views` is retired (no reads / writes), kept as data — dropping it would be destructive.
- Web: `isUnopenedByAssignee` (assigned + `openedByAssigneeAt === null` + open lead) replaces
  `isNewToViewer`; `LeadUnopenedMarker` (same shared badge). The company and agent-portal detail
  screens call `recordOpen` once per visit, only after `get` succeeded (a reload after an action is not a
  new open; a failed call retries on the next load). Lists, hover and route prefetch never call it.
  Hint copy now names the assignee ("لم يفتح الموظف المسؤول هذا العميل المحتمل بعد").
- Refresh: the app has no list cache — `MasterDataPage` / the portal list re-fetch on every mount
  (`usePathRestorableState` keeps only filters / page). So Back to the list, the manager's next load or
  the toolbar refresh show the server state; the detail screen patches its own copy from the response.
  There is no live-push mechanism in the app to hook into (see limitations).

## Migration `20261013100000_r20_lead_assignee_opens`

Hand-written, additive, idempotent (`IF NOT EXISTS`, guarded FKs, `ON CONFLICT DO NOTHING`, updates only
null flags) — re-run verified on `oms_r20_a` (INSERT 0 / UPDATE 0). `prisma migrate diff` vs schema:
only the pre-existing `prepaid_expenses` FK drift.

Backfill — no invented opens. Evidence of an open at T: a `lead_views` row (user, first view) or
`leads.first_opened_at` (pre-R20 owner open). An event is an ASSIGNEE open only when that user was the
assignee at T (latest `lead_assignments` row at/before T; for a lead without one, the current owner when
`assigned_at` ≤ T). History rows: first = min, last = max, `open_count` 1 (legacy data proves at least one
open, not how many). `opened_by_assignee_at` = earliest proven open by the current owner at/after the
current `assigned_at` (an earlier A → B → A period does not count). Manager / admin views stay ignored.
Note: pre-R20 conversions also stamped `first_opened_at`; those leads are converted, so no badge either way.
`oms_r20_a`: 12 leads flagged (1 open IN_PROGRESS + 11 converted), 12 history rows; every NEW lead stays unread.

## Tests

- New `apps/api/src/leads/lead-assignee-open.integration.spec.ts` (real HTTP pipeline, `oms_r20_int`):
  5 tests — lists / detail GET / manager / Super Admin opens never mark; assignee open clears it for
  employee, manager, admin with status NEW, `updatedAt` and status history unchanged; repeat opens keep
  the first timestamp, move last + count (3), one timeline entry; reassignment (same owner keeps, new owner
  resets, previous owner 404 + service `recorded:false`, history kept, new owner's open recorded); agent
  lead (company admin and company boundary record nothing, another agent 404, agent admin nothing, the
  assigned agent user records). Replaces the retired `lead-viewed.integration.spec.ts`.
- Mutation check: removing the `agent_id` boundary guard fails the agent test (1 failed / 4 passed);
  restored. (A second mutation on the assignment reset was blocked by the session's permission policy.)
- Updated `sales-funnel.flow.spec.ts` (open never moves status) and `sales-flow.hardening.spec.ts`
  (explicit NEW → IN_PROGRESS where they relied on first-open).
- API: typecheck clean; eslint clean on touched dirs; `jest src/leads src/sales-scope src/workflow
src/agents/orders src/agents/portal --runInBand` → 15 suites, 224 tests passed.
- Web: typecheck clean; eslint clean (one pre-existing TanStack warning); vitest `src/components/crm
src/config/crm` 10 files / 69 tests; wider related run (agent-portal, dashboard, order-entry/agent,
  shared, config, navigation, i18n) 87 files / 685 tests (one earlier run had 5 timeouts under load,
  re-run all green). New portal grid test.
- Builds: `nest build` and `next build` (NEXT_PUBLIC_API_URL=http://localhost:4805) succeed.

## Preview + evidence

API :4805 (`oms_r20_a`, WEB_APP_URL :4801), web :4801 (`next start`). Demo manager persona
`manager@oms-demo.local` (team R20-DEMO-TEAM = sales + sales2) from
`scripts/acceptance/r20/r20-a-seed-demo-manager.sql`.
`scripts/acceptance/r20/r20-a-lead-opened-journey.mjs` → **38/38 checks**
(`specs/round20-corrections/evidence/a/journey.json`), screenshots in `evidence/a/before` (unread for
admin / manager / sales, table + grid; admin + manager open the detail → still unread) and
`evidence/a/after` (sales opens → gone for sales / manager / admin, table + grid, status unchanged;
reassignment to sales2 → unread again, sales2 opens → gone; agent portal lead). The journey consumes
LD-2026-000003 / 000004 / 000005 on the demo clone (re-run needs other unread leads via env).

## Limitations / owner decisions

- No live push: a manager's list that is already open updates on its next load / refresh (no app-wide
  live-refresh mechanism exists; adding one is a separate decision).
- Unassigned leads show no «لم يُفتح» (nobody is assigned to open them) — owner may prefer otherwise.
- A NEW lead now stays NEW after opening; it moves to IN_PROGRESS by the existing «بدء المتابعة» step
  folded into Add follow-up (or an explicit transition) — reports counting IN_PROGRESS from opens will
  see fewer automatic transitions.
- Legacy backfill counts are 1 per proven open; true counts start with R20.
