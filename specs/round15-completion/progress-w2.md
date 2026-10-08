# W2 progress — permission-controlled lead / store-order imports

Recovery point for workstream W2 (spec: `spec-w2-imports.md`). Test DB: `oms_r15_w2`.

## Baseline (before any change)

- `DATABASE_URL=…/oms_r15_w2 pnpm --dir apps/api exec jest --runInBand src/import-center` → 14 suites, 175 tests passed.

## Design (decided)

- **Actor**: one-time imports always carry an `ImportActor` (`{ userId, agent? }`) from the controller (company
  `ImportJobsController`, agent `AgentPortalImportsController`) down to the handler (`ImportRowOptions.actor`). The
  continuous sync (`SyncOrchestratorService`) never passes one — handlers keep the sync behaviour there (blank lead
  owner → auto-distribution, sync phone-match review) but compute and stamp the same row keys.
- **Per-type permission**: `ImportTypeHandler.requiredPermission(audience)`; LEADS → `crm.leads.import` /
  `agent.leads.import`, STORE_ORDERS → `store-orders.import` / `agent.orders.import`; every other type →
  `import-center.manage` (company) / not importable (agent). `import-center.manage` = company catch-all.
- **Ownership**: `ImportAccessService` resolves a job for an actor (404 otherwise): company → `agentId null` and
  (creator or `import-center.manage`) and the type permission; agent → same agent, creator, agent type permission.
  Internal engine methods stay unscoped (the sync uses them).
- **Atomic run**: `updateMany where status = VALIDATING → IMPORTING`; 0 rows → 409.
- **Row outcomes**: created / skipped (already imported, existing external id — named) / needs review / rejected,
  plus row notices (created, awaiting stock) and preview warnings. Skipped + notices persisted as `ImportJobError`
  rows with `SKIPPED: ` / `NOTICE: ` prefixes (no schema change); `job.summary` computed on read.
- **Row keys**: sha256 of the normalised row (scope + E.164 phone + name key + lines + amounts + date + external id).
  Leads → `Lead.importRowKey = lead-import:<scope>:<sha>`; company store orders →
  `creationIdempotencyKey = import:company:<sha>`; agent orders → `createAgentOrder({ idempotencyKey: import:<sha> })`
  (stored by that service as `agent-order:<agentId>:import:<sha>`).
- **Google Sheets**: `ImportSheetConnection` claimed on the actor-scoped Google Sheets upload; refused when owned by
  another user / agent or used by a `SyncSourceConfig`; service-account e-mail endpoint for the connect step.

## Status

- [x] API engine (interface, `ImportAccessService`, `ImportWorkspaceService`, jobs service: atomic run, skipped /
      notice outcomes, warnings, group confirm, summary; controllers actor-checked); tsc: no errors in W2 files
- [x] Leads handler + `LeadsService.create` import path (`checkCreate` split, `importRowKey`)
- [x] Store-orders handler (company `CompanyStoreOrderImportService`, agent `AgentStoreOrderImportService`; sync
      path stamps `import:company:<sha>`)
- [x] Google Sheets connection (`ImportSheetConnectionsService`, service-account e-mail, bilingual 403)
- [x] Agent portal imports controller + module (+ one line in `agents.module.ts`)
- [x] Templates (sales mode: `generateSales`, ar/en headers, sample row, shared dropdowns only)
- [x] API tests — `sales-import.integration.spec.ts` (17), `sales-import.helpers.spec.ts` (11), updated
      `store-orders-import.handler.spec.ts` (37); whole `src/import-center` suite green (16 suites, 202 tests before
      the last additions). Mutation proof: atomic-run claim disabled → double-run test fails; owner scope check
      disabled → owner-column test fails; sync key changed / lead `importRowKey` not stored → both 2.13 tests fail
      (all restored).
- [x] Web — services as endpoint families (`services/import-api.ts`: company `/import-center`, agent
      `/agent-portal/imports`); wizard sales mode (sales template ar/en, sales columns only, auto-mapping, Google
      Sheet share step with the service-account e-mail, preview InsightCards + warnings / skipped / review notes,
      result InsightCards, row outcomes, needs-review confirm / reject); `ModuleImportButtons` gated by the
      server's per-type `canImport` + "My imports"; Store Orders import page on `store-orders.import`; agent page
      `/agent/imports` + nav item (agent audience, either agent import key); shared `components/import-center/*`
- [x] Web tests — `config/import-center/sales-import.spec.ts` (5), `components/shared/module-import-buttons.spec.tsx`
      (2; mutation: `canImport` filter disabled → the hide test fails, restored); `src/navigation` + `src/i18n`
      suites green (89). tsc: no errors in W2 files (17 elsewhere); eslint clean on W2 files.
- [x] Controller authorization safety net: `import-center/import-jobs.controller.ts` and
      `agents/portal/agent-portal-imports.controller.ts` documented in `INTENTIONALLY_UNGATED` (per-type checks in
      `ImportWorkspaceService`) — `controller-authorization.spec.ts` 349/349.
- [x] Final verification (2026-10-08): `jest --runInBand src/import-center src/leads
    src/permissions/controller-authorization.spec.ts` → 26 suites, 669 tests passed; API `tsc --noEmit` 0 errors;
      web vitest (W2 specs + navigation + i18n) 9 files / 96 tests passed; eslint clean on W2 files.
- [ ] Browser pass — not run.
- Fixture hygiene: the integration spec deactivates its users and removes their permissions in `afterAll` (left-over
  lead recipients had pushed `lead-eligibility.integration.spec.ts` past its 200-row excluded list on this DB;
  earlier leftovers cleaned on `oms_r15_w2`).

## Integration requests for the lead

1. `apps/api/src/leads/duplicate-detection/lead-duplicate-detection.service.ts` — return the exact match's
   `leadNumber` so an exact-duplicate import row (and manual create) can name the existing lead (spec §3 "exact
   duplicate rejected with the existing lead named"). Today the row says "Duplicate lead: a lead with the same name,
   phone and product already exists" without the number. A re-import of the same row is already named
   ("Already imported as lead L-…") through `Lead.importRowKey`.
2. `AgentOrdersService.createAgentOrder` (W3) — honour `ownerUserId` for agent users holding `agent.records.assign`
   (same agent). Until then an agent order row naming a colleague is rejected ("Imported agent orders belong to the
   importer") — never silently reassigned. Agent leads already honour the Owner column with `agent.records.assign`.
3. `apps/web/src/app/(shell)/store-orders/needs-review/page.tsx` — replace its local `RejectReasonPicker` with the
   shared `components/import-center/reject-reason-picker.tsx` and open its confirm / reject actions to
   `store-orders.import` holders (the API now scopes rows to the job's owner). The import wizard already offers
   confirm / reject on its result step for company and agent users.
4. `apps/web/src/app/(shell)/store-orders/page.tsx` — add `<ModuleImportButtons importType="STORE_ORDERS" />` to the
   list toolbar (entry button next to Leads'); the `/store-orders/import` page already works for
   `store-orders.import`.
5. Optional: `home.destinations.agent-portal-imports` lines (en/ar) if agent tiles ever show descriptions.

## Notes

- The continuous sync keeps its rules (blank lead owner → distribution; Paid Amount = line price; External Order ID,
  Payment Method, Employee Email required per row); only the static `required` flags of those columns were relaxed
  so a one-time import can omit them. The sync template layout (A:P) is unchanged (new columns `omitFromTemplate`).
- Agent order row key is stored by `AgentOrdersService` as `agent-order:<agentId>:import:<sha>` (its Spec 1B
  namespace) rather than `import:agent:<id>:<sha>` — same scoping, no change to W3's file.
- Google Sheets uploads now tag the job `rowDefaults.source = GOOGLE_SHEETS` (lead source label); the sync
  overwrites `rowDefaults` with its own run defaults as before.
