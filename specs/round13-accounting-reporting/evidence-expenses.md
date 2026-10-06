# Evidence — Expenses = expense vouchers (owner decision 2, agent Y)

DB: local `oms_y` (`DATABASE_URL=postgresql://oms:oms@localhost:5432/oms_y`, `npx prisma migrate deploy` applied `20261007110000_r13b_expenses_consolidation`).

## Migration counts

| Database                                    | legacy `expenses` rows | converted to EXPENSE_PAYMENT drafts | dropped |
| ------------------------------------------- | ---------------------- | ----------------------------------- | ------- |
| `oms_y`                                     | 0                      | 0                                   | 0       |
| `oms` (checked, not migrated by this agent) | 0                      | 0                                   | 0       |

Dry run on `oms_y` (BEGIN … ROLLBACK, 3 fixture rows: 1 active 120, 1 zero amount, 1 archived) → 1 converted `EP-LEGACY-000001` DRAFT, 2 dropped; `masterdata.expenses.*` removed; holders mapped to `accounting.expense-payments.{view,create,edit,archive}`.

Schema drift check (`prisma migrate diff` DB → schema) shows no difference for `financial_transactions`, `opportunity_expenses` or `expenses`.

## API (Jest, real Posting Engine) — `apps/api/src/financial-transactions/r13b-expenses.integration.spec.ts` (8 tests, pass)

| Requirement                                                                                                                                                 | Test                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Draft does not post                                                                                                                                         | › a draft never posts                                           |
| Confirm posts balanced Dr expense / Cr bank with cost center + project; supplier counterparty stored, no AP / partner line; description on the expense line | › Confirm & post …                                              |
| Double confirm / replayed create / replayed Confirm & post → one document, one JE                                                                           | › double confirm, replayed create and replayed Confirm & post … |
| Non-EXPENSE account refused (create + edit); non-supplier counterparty refused                                                                              | › refuses a non-EXPENSE account …                               |
| Allocation refused (create, update, allocate, request DTO); open invoice offered                                                                            | › an expense never settles an invoice …                         |
| Reversal entry mirrors the original; locked period refuses the reversal (rolled-back tx)                                                                    | › Cancel posts the reversal entry; a locked period refuses it   |
| Filters (account, paid from) and per-currency totals excluding reversed                                                                                     | › list filters … totals …                                       |
| Migration converts / drops legacy rows and maps permissions (fixture table, rolled back)                                                                    | › migration: converts usable legacy rows …                      |

Regression on `oms_y`: `financial-transactions`, `bank-transactions`, `import-center`, `investment-expenses`, `permissions`, `traceability`, `accounting/posting-providers` → 31 suites / 657 tests pass; `import-template.service.serial.spec.ts` 12 pass.

## Web (Vitest)

- `apps/web/src/config/finance/expense-voucher.spec.ts` (7): required expense account / amount under their fields; draft may omit paid-from, posting may not; create payload omits empty links and never carries allocations; edit sends `null` to clear; posting state; open-invoice summary; "Pay invoice instead" link.
- Full web suite: 141 files / 1006 tests pass (after registering `/finance/expenses/new` in `route-access.ts`).

## Gates

`tsc --noEmit` api (only pre-existing errors in `purchasing/returns`, owned by agent X) and web clean; eslint + prettier clean on every changed file.
