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
