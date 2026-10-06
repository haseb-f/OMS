# Round 13 — independent review (fresh context, `f3e1c52..5a2b911`)

No code blockers. Findings and disposition:

| # | Severity | Finding | Disposition |
| - | -------- | ------- | ----------- |
| 1 | should-fix (deploy risk) | Unique index on ACTIVE `payment_matches(line, payment)` aborts `migrate deploy` if pre-R13 duplicates exist | Fix agent: guarded `DO` block + pre-flight / merge proposal in `proposals/` (no history rewrite) |
| 2 | should-fix | Concurrent disposals overwrite disposal fields | Fix agent: conditional update in tx → 409 |
| 3 | should-fix | `createConfirmed` replay could return a DRAFT as if confirmed; comparison missed date / fee / allocations | Fix agent |
| 4 | should-fix | Refund lines counted in Payment review "unmatched" totals | Fix agent |
| 5 | should-fix | Posting → Group allowed while account is referenced by mappings | Fix agent: refuse with references |
| m | minor | Receiving-account restore permission; adopted asset ignores line method; non-deterministic backfill; ambiguous phone guess | Fix agent |
| m | minor | Group conversion vs concurrent posting race; bank-side engine guard without row lock | Documented — needs row locks in the posting hot path; low probability (admin action vs posting at the same instant), fails safe for the bank guard on next action |
| m | minor | R13 integration specs need the FY opening fixture | Same convention as 14 pre-existing suites; documented in `checkpoint.md` |

Checked and sound: shared postable-account rule (engine + manual save + post), COA freeze rules, expense EXPENSE-type, idempotency P2002 replay, schedule claim/post same tx, disposal catch-up order, asset ↔ invoice line guards, refund lines CHECK, sales-report SQL parameterisation + scope, permission migration, reset authorization, en/ar parity, no physical left/right, migrations clean on a fresh DB, no new schema drift.
