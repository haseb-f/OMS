# OMS — session handoff (2026-10-14)

Read this first, then `CLAUDE.md`, `.claude/OMS.md`, `.claude/guardians/{project-rules,chief-accountant}.md`.
Memory index: `C:\Users\kamel\.claude\projects\D--Systems-OMS\memory\MEMORY.md` (rounds R5–R20 + gotchas).

## 1. State at handoff

|                          |                                                                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Branch                   | `main` in `D:\Systems\OMS` — HEAD `d648c798` = `origin/main` = Production (deployment 7055981575, success)                                                                                                                                                         |
| Uncommitted tracked work | none. Untracked folders are long-standing owner material (outputs/, reports/, research*/, specs/oms-v2/, store-catalog-2026-10-10/, .claude/launch.json) — leave them                                                                                              |
| Unmerged branches        | only old `integration/r13-combined`, `integration/r15`, `preview/r7-toolbar-dashboards` (historical, ignore)                                                                                                                                                       |
| Worktrees                | `.claude/worktrees/agent-*` (r18/r19/r20 streams) — all their branches are merged into main; safe to remove later with `git worktree remove` (they are locked by the harness). `D:\Systems\OMS-r8-blue`, `D:\Systems\OMS-r9-brand-grid` = old pending cleanup      |
| Agents                   | all of this session's subagents finished (no outstanding tasks). Other live Claude Desktop sessions at handoff: "Sales and order management implementation plan" and "OMS rebuild on Lurk foundation analysis" — check `ListAgents` and `git fetch` before pushing |
| Local servers            | preview API :3005 / web :3001 on DB `oms_r20_final` (stop when this session ends). Docker Postgres `oms-postgres` :5434                                                                                                                                            |

## 2. Completed work (each: committed ✓ pushed ✓ deployed ✓ verified live ✓ unless noted)

| Round          | What                                                                                                                                                                                                                                                                  | Prod SHA           | Record                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------- |
| R18            | partial-payment entry fix (amount follows prefilled allocation, unapplied warning), Σ allocations ≤ amount + fee guards, voucher-integrity endpoint, aging unapplied / net, CR-095 repair → CR-097; agent consignment stock receipts; login 44 px; glass report cards | 5c17aabb           | `specs/round18-corrections/`                             |
| R19            | agent recipes + non-valued stocked assembly; contrasting sidebar; report-size sales cards; C2 colour identities                                                                                                                                                       | 2d276254, cda38886 | `specs/round19-improvements/`                            |
| R20            | «لم يُفتح» follows the assignee (migration `20261013100000_r20_lead_assignee_opens`, open never changes status); employee 5-period cards; invoice payment status from confirmed allocations on every surface; B2 side-by-side employee cards + currency colours       | c83ea82d, 98f07802 | `specs/round20-corrections/` (progress.md = checkpoints) |
| R20 data       | owner-approved allocations CR-2026-000096 → INV-2026-000091 (now PAID), CR-2026-000099 → INV-2026-000093 (PARTIALLY_PAID, 60,000 open); no new cash entry; integrity 0 / 0                                                                                            | live data          | `specs/round20-corrections/release.md`                   |
| Movement signs | receipts green +, issues red −, transfers per warehouse, reservations blue «المتاح −q» / release «المتاح +q»                                                                                                                                                          | 5d9167a7           | `specs/round21-movement-signs/`                          |

Verified locally only (not live): the assigned employee's own lead open (no QA persona owns a Production lead);
agent assembly posting; transactional payment journeys (proven by integration specs + local Playwright journeys).

## 3. Known open items / decisions

- Payments / settlement (relevant to the next round):
  - Aging totals still ADD currencies together (per-invoice rows are correct) — `accounting/reports/accounting-reports.service.ts` `invoiceAging`.
  - A confirmed invoice with an open balance can be archived and then drops out of aging and open invoices.
  - Unallocating on a confirmed foreign-currency receipt does not re-post the FX difference booked at confirm.
  - Provider / carrier settlement fee = gross − received has no cap (OD-A2): a partial remittance settled in full books the shortfall as fee — `payment-settlements/settlement-calculator.ts`.
  - Receipt `feeAmount` and payment `actualFeeAmount` are unbounded (`financial-transactions.service.ts`, `payments.service.ts setActualFee`).
  - Invoice CSV export payment columns are unit-tested only.
  - Invoice grid cards now take their colour from payment status — `specs/round9-brand-grid/card-palettes.md` not yet updated.
- Other: OD-B1 agent ownership conversion; OD-B2 "returned" wording for transit returns; R19 agent assembly fee / mixed-owner boxes / partial reversal; NEW leads stay NEW after opening; unassigned leads show no badge; 45/47 Production leads read «لم يُفتح» after the R20 backfill (no opens invented).

## 4. Next round — receipts, payments and invoice settlement (not started)

1. Get the owner's brief; write `specs/round22-.../README.md` (spec + checklist) and keep `progress.md` checkpoints (commit WIP early — the laptop has shut down mid-round).
2. Baseline, read-only, before changing code:
   `node scripts/acceptance/r20/r20-payment-status-audit.mjs --out <file>` · `node scripts/acceptance/r20/r20-repair-payment-status.mjs` (dry run) ·
   `GET /api/accounting/reports/voucher-integrity` (all default to Production as the QA admin).
3. Code map: `apps/api/src/financial-transactions/` (service: create / update / confirm / allocate / cancel;
   `shared/invoice-payment.util.ts` = the ONE status derivation; `shared/store-order-money.ts`, `store-order-receipts.ts`);
   `accounting/posting-providers/financial-transaction-posting.provider.ts`; `payments/`, `payment-settlements/`,
   `payment-reconciliation/`, `bank-transactions/`; web `app/(shell)/sales/payments/receipt-editor-page.tsx`,
   `purchasing/payments/payment-editor-page.tsx`, `components/financial-transactions/*` (`use-voucher-amount.ts`,
   `allocation-capacity.ts`, `open-invoices-table.tsx`, `settlement-currency.ts`).
4. Tests to extend: `financial-transactions/r18-partial-payments.integration.spec.ts`, `r20-payment-status.integration.spec.ts`,
   `accounting/reports/voucher-integrity.spec.ts`; browser journeys `scripts/acceptance/r18/r18-payments-browser.mjs`,
   `scripts/acceptance/r20/r20-payment-status-browser.mjs`.
5. Gates on the merged tree, release, live checks (`r20-prod-live.mjs`, `r14-prod-smoke.mjs`), repair only verified records through business operations with an idempotent dry-run-first script.

## 5. Authorizations and constraints (already agreed — do not re-ask)

- Push to `main` = Production deploy (Vercel). Correction rounds the owner sends are authorised to deploy after the
  gates pass ("integrate into the current release" / "deploy as authorized"); a pure visual redesign goes through the
  local preview + screenshots first unless the owner says otherwise. Coordinate with other live sessions before pushing.
- Production data changes only through business operations (cancel = audited reversal, allocate, replacement voucher),
  only for verified records, with a dry-run first and an idempotent re-run; never SQL, never delete, never invent
  payments. Owner-specific decisions (e.g. which receipt pays which invoice) need the owner's explicit approval.
- Production verification as `qa-admin@oms.haseb.org` (password `tmp/.qa.env` QA_PASSWORD, never printed); direct
  Production DB reads are blocked — use API / UI. Demo personas `*@oms-demo.local` (password `tmp/r15-manual/.env`
  MANUAL_PW) on local clones; `manager@oms-demo.local` exists on R20 demo clones.
- Local: Docker `oms-postgres` :5434 (user / pass oms); clone DBs per stream (`createdb -T <template>`, then
  `prisma migrate deploy`); `oms_r17_int` = clean integration template (lead-eligibility fails there — fixture data;
  passes on `oms_r18_final`-based clones), `oms_r19_c` / `oms_r20_*` = populated demo. Never touch DB `oms`.
- Docker stale sockets after a crash / shutdown: rename `%LOCALAPPDATA%\Docker\run` AND
  `%LOCALAPPDATA%\docker-secrets-engine` while Docker is stopped, then start Docker Desktop; never "Reset to factory defaults".
- Git: never `git stash`; commit with explicit paths (never `git add -A`); Git Bash `MSYS_NO_PATHCONV=1` for `/` args;
  eslint may OOM → `NODE_OPTIONS=--max-old-space-size=8192`; don't push feature branches before main (Vercel dedupe).
- Subagents die when the turn ends — keep the turn alive while they run, have them WIP-commit early, resume with SendMessage.
- Reports: concise; Arabic handoff when the owner asks; run typecheck, lint, tests and builds on the final integrated tree.
