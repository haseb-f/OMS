# Round 13 — plan, ownership, checklist

## Dependencies

- A (UI controls, order flow) is independent of B–E.
- B1 (Group/Posting) underpins C (asset/prepaid accounts) and D (clearing accounts must be posting ASSET) — B1 changes only _validation_, so C/D can run in parallel and re-verify after integration.
- D2 reconciliation depends on posting links (existing, unchanged).
- E depends only on agreed metric definitions (spec E) — independent.

## Agents and file ownership (one working tree, no worktrees)

| Agent     | Scope                          | Owns (exclusive)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Migration folder                              |
| --------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| A-ui      | A1–A3                          | `components/shared/{phone-input,calling-code-picker,password-input,entity-combobox,searchable-select}.tsx`, `components/ui/{popover,command,select,dialog,sheet}.tsx`, `components/shared/form-fields/phone-field.tsx`, `master-data-form.tsx` phone part, `globals.css` tone tokens, `data-table/toolbar-tones*`, `selector-triggers.spec.tsx`, user/employee/agent/partner-quick-create forms, API `users`, `partners` phone normalization, `auth` password DTOs, `packages/shared` password policy | none                                          |
| A-order   | A4                             | `components/shared/step-flow.tsx` (new), `components/store-orders/store-order-create-dialog.tsx` + its config                                                                                                                                                                                                                                                                                                                                                                                         | none                                          |
| B-acct    | B1–B3                          | API `chart-of-accounts`, `journal-entries`, `financial-transactions`, `import-center/handlers/chart-of-accounts*`, `coa-graph`; web `finance/chart-of-accounts`, financial-transaction editors, `components/finance/fx/*`                                                                                                                                                                                                                                                                             | `20261006100000_r13_ft_idempotency`           |
| C-assets  | C1–C2                          | API `fixed-assets`, `prepaid-expenses`, `accounting/schedules`, `purchasing/invoices/purchase-line-recognition*`; web `finance/fixed-assets/**`, `finance/prepaid-expenses/**`, purchase invoice line link display                                                                                                                                                                                                                                                                                    | `20261006110000_r13_schedule_cancelled`       |
| D-pay     | D1–D2                          | API `payment-methods`, `payment-sources`, `receiving-accounts`, `payment-reconciliation`, `bank-transactions` adopt guard, `payment-declaration.core.ts` source derivation; web `master-data/payment-methods`, `finance/payment-sources`, `finance/payment-reconciliation/**`                                                                                                                                                                                                                         | `20261006120000_r13_payment_method_channel`   |
| E-reports | E1–E5                          | API `sales-reports` (new), permission catalog entry; web `reports/sales/**`, `components/reports/**` (new), agent-portal report route                                                                                                                                                                                                                                                                                                                                                                 | `20261006130000_r13_sales_reports_permission` |
| Lead (me) | integration, shared registries | `schema.prisma` review, `navigation.config.ts`, root i18n index, `app.module.ts` registration review, commits, evidence                                                                                                                                                                                                                                                                                                                                                                               | —                                             |

Shared files touched by several agents (`schema.prisma`, `app.module.ts`, `navigation.config.ts`, i18n index files): edit only your own block with Edit (never rewrite the file); lead reviews the merged result.

Databases: each agent tests against its own clone (`oms_a`, `oms_b`, …) via `DATABASE_URL`; integration DB `oms`.

## Checklist

- [x] Audit A–E (`audit/`)
- [x] Specs A–E
- [x] A-ui implemented + verified (agent: web 125 files/887 tests, API 21 suites; risk: `@oms/shared` in next build)
- [x] A-order implemented + verified (66 tests; enterprise-modal `subheader` additive)
- [ ] B implemented + verified
- [ ] C implemented + verified
- [ ] D implemented + verified
- [x] E implemented + verified (API metrics 10 + integration 8; web 87)
- [ ] Integration: migrate, typecheck, lint, build, vitest, jest
- [ ] Independent review (accounting, permissions, integration) + fixes
- [ ] Browser journeys (one pass) + evidence
- [ ] Arabic handoff
