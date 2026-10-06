# Evidence B — chart of accounts, posting, FX (agent B-acct)

All API tests run against the local DB `oms_b` (`DATABASE_URL=postgresql://oms:oms@localhost:5432/oms_b`).

## B1 — Chart of accounts invariants + representative cases

| #   | Invariant                                                                                                                       | Proven by                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Every account is an explicit Group (`allowsPosting=false`) or Posting account; default Posting                                  | `r13-coa-invariants.integration.spec.ts` › inv 1                                                                                                                                                                                             |
| 2   | A Posting account never has children (create / move / import); parent never flipped implicitly                                  | › inv 2 child under Posting rejected (`PARENT_IS_POSTING`, parent unchanged); › inv 2 move rejected; `chart-of-accounts-import.handler.spec.ts` › R13 B1 child under existing POSTING; `coa-graph.spec.ts` › R13 B1 (DB parent, DB children) |
| 2   | Posting → Group only without journal lines; Group → Posting only without sub-accounts; archiving the last child keeps the Group | › inv 2 conversions (`ACCOUNT_KIND_FROZEN`); › inv 2 archive last child; import › converts an unused POSTING parent marked AGGREGATION in the same file                                                                                      |
| 3   | Child type = parent type; no cycles; depth ≤ 4; code unique incl. archived                                                      | › inv 3 type; › inv 3 cycle; › inv 3 duplicate code (active + archived); import › archived code is a clear row error; `coa-graph.spec.ts` › archived code / archived parent                                                                  |
| 4   | Used accounts: code / type / kind / parent / currency frozen; name, description, reconciliation editable                        | › inv 4 rename of used account with unchanged parent/kind/currency re-sent (the web bug); › inv 4 move / type / currency rejected; › inv 4 system root; import › re-import of a used account renames                                         |
| 5   | Archived never deleted; restore requires an active parent                                                                       | › inv 5 restore under archived parent (`PARENT_ARCHIVED`), succeeds after the parent is restored                                                                                                                                             |
| 6   | Posting Engine **and** manual post reject Group / archived accounts, re-checked at post                                         | › inv 6 manual draft against Group rejected; › inv 6 manual post re-check (Group / archived after draft, entry stays DRAFT); `r13-ft-posting.integration.spec.ts` › engine re-check at confirm (account converted to Group after draft)      |
| 6   | A Posting account receives a balanced entry                                                                                     | › inv 6 manual journal posts 25 / 25                                                                                                                                                                                                         |
| 7   | Normal balance derived from type (no stored column)                                                                             | unchanged — no column exists (schema `ChartOfAccount`)                                                                                                                                                                                       |

Shared rule: `apps/api/src/accounting/posting-engine/postable-accounts.ts` (`assertPostableAccounts`) is called by the Posting Engine, manual journal save and manual journal `post()` — one implementation.

Data check (`oms_b` and `oms`): 0 active parents with `allows_posting=true`, 0 journal lines on Group accounts → no data migration needed.

## B2 — Financial operations

`apps/api/src/financial-transactions/r13-ft-posting.integration.spec.ts` (real Posting Engine):

- expense voucher posts Dr chosen EXPENSE account / Cr bank (2 lines, 1 JE);
- non-EXPENSE (ASSET) and Group expense accounts rejected (`EXPENSE_ACCOUNT_INVALID`, `not_expense` / `group_account`);
- supplier payment against a confirmed purchase invoice: Dr AP (partner) / Cr bank, no EXPENSE line; 400 of 1000 → PARTIALLY_PAID remaining 600; +600 → PAID;
- advance: 500 paid, 300 allocated → AP debit 500 on the supplier (remainder stays on the partner AP balance);
- allocating another supplier's invoice rejected;
- idempotency: two concurrent + one sequential `createConfirmed` with the same key → one document, one journal entry; repeated `create` returns the first draft; same key + different amount → 409 `IDEMPOTENCY_KEY_REUSED`.

Migration `20261006100000_r13_ft_idempotency`: nullable unique `financial_transactions.idempotency_key`.

## B3 — FX automation visibility

`apps/web/src/components/finance/fx/fx-sync-state.spec.ts` (vitest) › `deriveFxOverallState`: Enabled, Disabled (paused), Running (beats all), Failed (a later SKIPPED row never hides it — uses the new `lastAttempt` status field), Partial, Not yet updated, Stale (beats Disabled); `runErrorSummary`, `utcTimeLabel`.
