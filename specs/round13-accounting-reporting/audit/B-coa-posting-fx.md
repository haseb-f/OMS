# Audit B — chart of accounts, posting, expenses/payments, FX (2026-10-06)

## Chart of accounts

- `ChartOfAccount` (schema ~2358): `code @unique` (global, archived included), accountType ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE, `parentAccountId`, `currencyId?`, `allowReconciliation`, `partnerControlType?`, `level` (max 4), **`allowsPosting`** (the group/posting flag), `isSystemAccount`, `deletedAt`. No normalBalance column (derived from type).
- Service `chart-of-accounts.service.ts`: create places root-less accounts under system roots 1–5; child type must equal parent type; parent with journal lines cannot get children; sibling-name unique; code server-proposed; **parent automatically flipped to `allowsPosting=false` on first child** (implicit, no explicit choice). Update: used accounts / roots cannot change code, type, allowsPosting, parent; allowsPosting=true rejected with children; cycle check `assertNoCycle`.
- Archive blocked by ~40 usage relations; restore (base class) does **not** recompute parent posting flag nor check archived parent. **Gap.**
- **Bug**: web edit always sends `parentAccountId`; service treats any defined value as a parent change → editing the name of a used account / root fails. Same on re-import of a used account.
- Posting engine `assertPostableAccounts` rejects archived and `!allowsPosting`. Manual JE `post()` does **not** re-check allowsPosting/archived (drafts created earlier can post to an account that later became a group). **Gap.**
- Web form has no Group/Posting field (badge only). Import uses `accountKind` POSTING/AGGREGATION.

## Posting engine

`posting-engine.service.ts:132`: idempotent on (sourceType, sourceId) POSTED; FX conversion; balance 0.01; postable accounts; partner on AR/AP control; currency policy; `assertPostingWindow` (period not OPEN → blocked; no period defined → allowed).

## Expenses / payments

- `apps/api/src/expenses` (`Expense`) is a legacy plain CRUD with no status/account/posting — **duplicate concept** of `FinancialTransaction` type `EXPENSE_PAYMENT` (user chooses `expenseAccountId`; DRAFT→CONFIRMED posts Dr expense / Cr receiving account). Leaf + not archived checked; **accountType EXPENSE not checked**. **Gap.**
- Supplier payment: Dr AP (partner) at invoice snapshot rates / Cr bank + realized FX; unallocated remainder → AP debit (advance). Payment never hits expense — correct.
- `FinancialTransactionAllocation`: one of salesInvoice / purchaseInvoice / salesReturn; partial allowed; remaining re-checked under row lock at allocate + confirm; status computed.
- Confirm is lock + early-return idempotent; **create has no idempotency key** → double click creates two drafts / two `createConfirmed` documents. **Gap.**

## FX

- `ExchangeRate` unique (from, to, effectiveDate date); `ExchangeRateOverride`; `FxSyncSettings` singleton enabled (default true, no expiry), provider CBE, basis MID, maxStaleDays 10, staleAlertDays 4; `FxSyncRun` RUNNING/SUCCESS/PARTIAL/FAILED/SKIPPED.
- Cron (vercel.json, UTC): `0 14 * * *` and `0 20 * * *` (`slot=late`, skips ALREADY_CURRENT). Disabled → SKIPPED run recorded. Manual `POST /exchange-rates/sync/run` works even when disabled; backfill ≤7 days; 2-min cooldown; advisory lock one run at a time; 50 s deadline.
- Provider scrapes CBE page, 10 s timeout, 1 retry. Existing row for a date never overwritten (manual wins). Weekend: CBE published date; resolution = override → latest row ≤ day → STALE beyond 10 days → MISSING.
- Posted documents freeze rate; corrections explicit reverse + re-post.
- Web `finance/exchange-rates/page.tsx`: `FxAutoImportCard` (toggle, Run now, Backfill, settings, runs), `FxStatusPanel` (on/paused, running/idle, last run, next slot, freshness NONE/FRESH/AGING/STALE).
