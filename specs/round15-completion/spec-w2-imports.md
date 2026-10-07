# W2 — Permission-controlled lead and store-order imports (Excel + Google Sheets)

Requirements: 2.1–2.13 · Decisions D15-16, D15-17. Database for tests: `oms_r15_w2`. Progress log: `progress-w2.md`.

## Current state (survey S2 — read it)

Import Center engine (`apps/api/src/import-center/**`): job → upload (xlsx/csv or Google Sheets URL via the service
account) → mapping → validate (dry run) → run per row; ~30 types all behind `import-center.manage`; jobs not
owner-scoped (any holder reads every job incl. `fileContent`); leads handler (owner column; blank owner →
auto-distribution; existing externalOrderId silently "succeeds"; dry run skips duplicate/owner checks); store-orders
handler (Employee Email required; `unitPrice = paidAmount/qty`; payment → note only; skips the controller's
duplicate enforcement and creation key); "sync" = `SyncSourceConfig` manual preview/commit with `import-center.sync`;
agents have no import path.

## Foundation already in place

Permissions `crm.leads.import`, `store-orders.import`, `agent.leads.import`, `agent.orders.import`,
`agent.records.assign` (catalog + migration; agent ADMIN users granted). `ImportJob.agentId`, indexes on
`createdBy` / `agentId`; `Lead.importRowKey @unique`; `ImportSheetConnection` (spreadsheetId unique, ownerUserId |
agentId, revokedAt). Labels for the new keys exist.

## Required behaviour

1. **Per-type permission** on the handler interface (`requiredPermission(ctx)`): LEADS → `crm.leads.import`,
   STORE_ORDERS → `store-orders.import` (company); every other type → `import-center.manage` (unchanged). The job
   endpoints check the type's permission (or `import-center.manage`, the administrator catch-all). No admin role is
   needed. `import-center.view` is no longer required for the sales import screens (they are reached from Leads /
   Store orders).
2. **Job ownership**: list / get / mapping / validate / run / confirm-row / reject-row / errors export only for the
   job's creator, unless the caller holds `import-center.manage`. Agent jobs (`agentId` set) only for that agent's
   users who hold the agent import key; company users never see agent jobs and vice versa. Atomic run guard
   (`updateMany where status = VALIDATING|MAPPING → RUNNING`) so a double click cannot run twice.
3. **Same business rules as manual entry** — reuse the services, never re-implement:
   - Leads: `LeadsService.create` (phone normalised to E.164 via the country, R11 rules incl. Arabic digits; customer /
     duplicate policy as manual: exact duplicate rejected with the existing lead named, near match flagged; "leads are
     never blocked" stays true for repeated leads per the existing policy). Owner = the importer by default (company:
     the importer, not auto-distribution; agent: the importing agent user); an Owner column is honoured only when the
     importer may assign (company: `crm.leads.manage` scope rules; agent: `agent.records.assign`, same agent only);
     otherwise the row is rejected with "you cannot assign records to others" (never silently reassigned).
   - Store orders (company): `StoreOrdersService.create` with the same duplicate enforcement as the controller
     (`duplicates.enforce` — a phone match to an existing customer needs the explicit "same customer / repeat order"
     acknowledgement: column "Repeat customer" = yes, otherwise the row goes to **needs review** with the matched
     customer shown; several records on one number → needs review, never silently picked), payment declarations as a
     _declaration_ (PENDING claim via the existing declaration core, `declarationKind`, never VERIFIED, never a
     receipt), products must be active + company-owned + sellable, prices from the row (unit price or line amount
     column, explicit), currency must exist, stock follows W5a automatically (order saved SHORT when not available —
     report the row as "created, awaiting stock").
   - Store orders (agent): `AgentOrdersService.createAgentOrder` (agent from the token; agent catalog / ownership /
     agreed pricing / shipping agreement tariff / currency rules all enforced there; quote issues become row errors).
   - Columns that may never be imported (ignored with a warning, or the row rejected when they conflict): agent,
     owner (unless allowed), shipping company / tracking / carrier cost / shipping status, payment status / verified /
     receipt account, commission / cost / margin fields. Agent identity comes only from the token.
4. **Retry safety / duplicates (2.7, 2.9, D15-17)**: every row gets a row key = sha256 of the normalised row
   (scope + phone E.164 + name + products/qty + amounts + order date + external id). Store orders use
   `creationIdempotencyKey = import:<company|agent:<id>>:<key>` (replay → row reported **skipped — already imported**
   with the existing order number); leads use `Lead.importRowKey`. An existing external order id → skipped with the
   existing record named (not "success"). A genuine repeat order for the same customer is a different row (other date
   / products / external id) and is created as a repeat order (customer reused, flagged repeat). Summary counts:
   created, skipped (already imported), needs review, rejected — with the reason per row; error CSV export.
5. **Preview** runs the same checks as the commit (duplicates, owner permission, product / price / currency / stock
   availability warning, phone validity) without writing — row-level actionable messages (Arabic + English).
6. **Google Sheets (2.3, 2.13)**: "Connect a Google Sheet" step: shows the OMS service-account e-mail to share the
   sheet with (Viewer) — never asks to make it public; verifies access (clear 403 message); creates the
   `ImportSheetConnection` owned by the importer (company) or the agent; a spreadsheet already owned by someone else →
   refused ("this sheet is connected by another user"); a spreadsheet used by a `SyncSourceConfig` → refused ("this
   sheet is synchronised continuously by <source>; its rows arrive through the sync"). Refresh re-reads the sheet; the
   same row keys make re-imports idempotent. The continuous sync handlers compute the **same** row keys
   (leads `importRowKey`; store orders already dedupe by externalOrderId — add the row key for rows without one), so
   a row imported one-time is never ingested again by the sync and vice versa.
7. **Agent import API**: `agents/portal/agent-portal-imports.controller.ts` (`@AgentPortal`, `agent.leads.import` /
   `agent.orders.import`) reusing `ImportJobsService` with an agent context; templates downloadable.
8. **Web**: reuse the existing import wizard (upload / Google Sheet → mapping (saved templates) → preview → result
   summary) in a sales-import mode: entry buttons on Leads and Store orders gated by the import keys (not
   `import-center.manage`), "My imports" history (own jobs), agent portal page `/agent/imports` (+ nav item, agent
   audience, gated) with the same wizard. Template download per type with Arabic/English headers and a sample row.
   Summary cards (created / skipped / needs review / rejected) use InsightCard; row errors table; mobile.

## Tests

Permissions: salesperson with `store-orders.import` only (no `import-center.*`) imports; without it → 403; agent
SALES with `agent.orders.import` imports into its agent; agent without → 403; agent cannot see company jobs and vice
versa; user A cannot read / run user B's job. Owner column: OWN user → rejected row; manager → assigned. Agent column
in the file ignored (agent from token). Payment column → PENDING declaration, no receipt / JE. Re-import same file →
all skipped, 0 created; double run → one run. Sync + one-time import of the same rows → one record each. Google
Sheets connection ownership + sync-source refusal (mock the Sheets client). Repeat customer order vs duplicate row.
