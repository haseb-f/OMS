# SPEC B — Chart of accounts, transaction posting, exchange-rate controls

Audit: `audit/B-coa-posting-fx.md`.

## B1. Chart of accounts

**Current.** Hierarchy = `parentAccountId`; posting behaviour = `allowsPosting`. A parent silently becomes non-posting when it receives its first child; the create form has no Group/Posting choice. Edit always sends `parentAccountId`, so renaming a used account fails. Restore does not re-check the parent. Manual journal `post()` does not re-check postable accounts.

**Rules (invariants).**

1. Every account is either **Group** (`allowsPosting=false`, aggregates children, never receives a journal line) or **Posting** (`allowsPosting=true`, leaf).
2. **A posting account may not have children.** A child can only be created/moved/imported under a Group account. Converting Posting → Group is allowed only while the account has no journal lines; Group → Posting only while it has no children. (Replaces the implicit auto-flip.)
3. Child type = parent type; no cycles; depth ≤ 4; code unique (global, archived included); sibling names unique.
4. Accounts with journal lines: code, type, kind and parent are frozen; name / description / reconciliation flag remain editable; currency binding may change only if no lines exist (prevents relabelling history).
5. Accounts with any usage are archived, never deleted; restore requires an active parent.
6. Posting engine **and** manual journal post reject Group or archived accounts (re-checked at post, not only at draft save).
7. Normal balance is derived from type (ASSET/EXPENSE debit; LIABILITY/EQUITY/REVENUE credit) — no stored column.

**Changes.** API create DTO `accountKind: GROUP | POSTING` (default POSTING); service enforces rule 2; update compares `parentAccountId` with the current parent before treating it as a move; restore checks parent; journal post re-validates; import graph rejects a child under a POSTING row. Web form: Group / Posting segmented control, parent picker lists Group accounts only.

**Acceptance.** Group rejects postings (engine + manual); posting account receives a balanced entry; rename of a used account works; cycle / duplicate code rejected.

## B2. Automatic entries from financial operations

**Current.** Ordinary expense = `FinancialTransaction` EXPENSE_PAYMENT (user picks `expenseAccountId`; DRAFT → CONFIRMED posts Dr expense / Cr bank). Supplier payment posts Dr AP / Cr bank (never expense); allocations partial/multi with row locks. Legacy `Expense` model is a postless CRUD. Create has no idempotency key; expense account type not checked.

**Target.**

- Expense account must be an EXPENSE-type posting account (cleaning supplies → `Cleaning supplies expense`).
- `idempotencyKey` (optional, unique) on `FinancialTransaction` create / createConfirmed; web sends one per open form → double click returns the first document.
- Originating document shows posting status + journal link (reuse `JournalTraceCell`).
- Prove with tests: expense routes to the chosen account; paying a posted purchase invoice debits AP only; partial allocation leaves the remainder; advance (unallocated) stays on AP partner balance; wrong-partner invoice rejected.
- Legacy `Expense` screen: not touched this round (documented as duplicate; removal is an owner decision because records exist).

## B3. Exchange-rate automation

Behaviour is already implemented (see audit) — this spec makes it **visible and honest**:

- Distinct states with icon + text: Enabled, Disabled (paused), Running, Failed (last run FAILED/PARTIAL), Stale (latest rate older than `staleAlertDays`), Not yet updated.
- "Enable automatic updates" switch is separate from "Refresh now"; show last successful update, effective rate date, next scheduled run (14:00 / 20:00 UTC with Cairo local time).
- No change to historical rates or posted documents; no automatic revaluation.

## Permissions / migration

Migration: `financial_transactions.idempotency_key` (nullable unique). No permission changes.

## Expenses (owner decision 2)

**Decision.** "The old Expenses screen must remain and become fully functional. Do not hide it." Supersedes O-4 and the B2 note above. Reference: Odoo 18 Expenses (draft → submitted → approved → post → paid), adapted to OMS.

**One expense concept.** The Expenses screen (`/finance/expenses`, nav `finance-expenses`) is the UI of the posting expense voucher — `FinancialTransaction` type `EXPENSE_PAYMENT` (`/financial-transactions/expense-payments`). The legacy postless `Expense` model, module (`apps/api/src/expenses`) and table are removed by migration `20261007110000_r13b_expenses_consolidation`:

- legacy rows → `EXPENSE_PAYMENT` **DRAFT** vouchers (same id, number `EP-LEGACY-nnnnnn`), expense account = Settings → Accounting default expense account when it is an active EXPENSE posting account; payment method → its channel (payment source) and the receiving account on its ledger account. Archived / zero-amount rows, or no resolvable account → dropped (test data). Never posted by the migration.
- `opportunity_expenses.source_expense_id` now references the voucher (ON DELETE SET NULL); the Investor service accepts only an `EXPENSE_PAYMENT` id.
- Permissions: `masterdata.expenses.{view,create,edit,archive}` → `accounting.expense-payments.{view,create,edit,archive}` for every holder; posting rights (`confirm`, `cancel`) are **not** granted by the mapping; the legacy names are deleted.

**Form** (shared `FinancialTransactionEditor`, no allocation section): expense date · expense account (`AccountPicker`, EXPENSE posting accounts only; server `EXPENSE_ACCOUNT_INVALID`) · amount · payment method (payment source) · paid from (receiving account: cash / bank) · reference · description (new column `financial_transactions.description`, carried onto the journal line) · currency (empty = base; the rate on the expense date is shown, a missing rate is warned) · supplier counterparty (optional, metadata only — never AP, never a partner line) · cost center · project · notes.

**Workflow.**

| Step           | Who                                            | Effect                                                                                                                                                                                                                                      |
| -------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draft (Save)   | `accounting.expense-payments.create` / `.edit` | nothing posted                                                                                                                                                                                                                              |
| Confirm & post | `accounting.expense-payments.confirm`          | Posting Engine: Dr expense account / Cr paid-from account (balanced; cost center + project on the entry); idempotent — repeated confirm returns the same entry; a new form uses `Create + Confirm` with one idempotency key per opened form |
| Reverse        | `accounting.expense-payments.cancel`           | existing cancel path: reversal entry dated today; refused when that period is closed / locked                                                                                                                                               |

One confirm step instead of Odoo's submit / approve: confirm is already a distinct permission from create / edit, so a preparer cannot post — the approve/post segregation Odoo models with two states is a permission boundary here. Expenses are paid by the company (paid-from account at posting); employee-paid reimbursements (an employee payable + later payment) are not part of this round.

**Direct expense vs supplier invoice.** When the chosen supplier has open confirmed purchase invoices, the form lists them with **Pay invoice instead** → `/purchasing/payments/new?partnerId=…&invoiceId=…` (supplier payment, Dr AP). The expense voucher itself never allocates: create / update / allocate refuse with `EXPENSE_ALLOCATION_REFUSED`, and the request DTO rejects an `allocations` field — an invoiced cost is never recognized twice.

**List.** Status badges; filters status / expense-date range / expense account / paid from; search number, reference, description; totals per currency in the table footer (reversed vouchers excluded, never a mixed-currency sum); Table / Grid (`ExpenseVoucherGridCard`); journal-entry column; print (portrait voucher layout).

**Not supported by the voucher model (documented, not built):** per-line analytic distribution (the generic `AnalyticDistributionLine` is not carried by the Posting Engine) and attachments (no FinancialTransaction attachment table).
