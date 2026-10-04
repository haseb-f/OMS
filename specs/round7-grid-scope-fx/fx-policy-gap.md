# FX policy gap — account currency, native balances, revaluation (Round 7 / D)

Status: findings + owner-decision list. No revaluation policy is invented here; nothing in this round posts or rewrites history.

## 1. What the ledger actually does (proven locally, read-only on Production)

- `ChartOfAccount.currencyId` ("locked to SAR") is **descriptive**: before Round 7 nothing compared it with the currency of a posting.
- Every journal line is stored in the **functional (base) currency (EGP)**. The entry header holds the document currency and the frozen rate (functional per 1 unit; source/as-of date in the rate snapshot). Manual entries carry a currency label but no rate.
- A SAR account therefore has no stored native balance. Native amounts are **derived** as (debit − credit) ÷ header rate, and only claimed when the entry is in the account's currency and records a rate (`account-currency.ts` -> `PROVEN`); otherwise the statement says `ENTRY_CURRENCY_DIFFERS` / `NO_RATE_RECORDED`. SAR is never relabelled as EGP and a historical balance is never converted at today's rate.
- Round 7 change: posting compares account currency vs entry currency (`ACCOUNT_CURRENCY_POLICY`: default WARN = post + activity-log warning; BLOCK opt-in; OFF). Existing postings are unaffected; FX_REVALUATION and year closing are exempt.
- Production audit (read-only): 390 entries scanned, 4 currency-bound accounts in the COA (SAR x3, USD x1), 0 movements, 0 mismatching lines -> no correction needed today.

## 2. Standards reference (cite carefully; the owner's accountant must confirm applicability)

- IAS 21 (and the Egyptian equivalent EAS 13, "Effects of Changes in Foreign Exchange Rates"): foreign-currency transactions are initially recorded at the spot rate at the transaction date; at each reporting date monetary items are retranslated at the **closing rate**; non-monetary items carried at historical cost stay at the historical rate; exchange differences on monetary items go to profit or loss in the period they arise (IAS 21.23, 21.28). Presentation-currency translation is a separate matter (IAS 21.39).
- These paragraph references are from general knowledge of the standards and were not re-verified against the current EAS 13 text in this session. EAS 13 specifics (e.g. rate-source requirements under Egyptian regulation) must be confirmed by the chief accountant.

## 3. Missing policy items — owner decisions required before any revaluation posting

1. **Closing-rate source and basis** for revaluation: CBE MID vs buy/sell; which day when the period end is a holiday (last available vs next)?
2. **Cadence**: month-end only, or every reporting date incl. quarter/year; today's engine is a manual single rolling run (`FXR-2026-000001`, 2026-09-19).
3. **Auto-reversal**: reverse on day 1 of the next period (common practice) vs cumulative; today none.
4. **Closed-period check**: may a revaluation target a closed/locked period? Today no check against the period lock.
5. **Account mapping**: unrealized FX gain/loss account and realized FX gain/loss account (today `unrealizedFxAccountId` and `exchangeDifferenceAccountId` are set; realized-vs-unrealized split on settlement is not enforced by a policy).
6. **Which accounts are monetary** (cash, bank, AR/AP, loans) and therefore revalued; non-monetary (inventory, fixed assets) excluded - needs an explicit flag, not inference from `currencyId`.
7. **Per-line original amounts**: lines hold EGP only; a true multi-currency ledger would need a native amount per line (schema change) - decide whether derived-from-header is acceptable long-term.
8. **Management presentation equivalents** (e.g. SAR/USD views of EGP reports) are kept distinct from accounting values: decide the rate used (period-average / closing) and label; never mixed into postings.
9. **Enforcement level** for `ACCOUNT_CURRENCY_POLICY`: stay WARN, or move to BLOCK after Finance reviews warnings.
10. **Rate staleness limit** for posting (currently alert at 4 days, hard stop at 10 days).

## 4. Scoped dry-run-first correction plan (only if mismatches appear)

Production shows none, so this is a contingency, not an action:

1. Report: `scripts/acceptance/fx-account-currency-audit.mjs` (read-only) lists lines on currency-bound accounts whose entry currency differs.
2. Per mismatch, Finance chooses: (a) re-point the account's currency (master-data change, no posting), or (b) reclass via the existing audited endpoint `POST /fx-revaluations/corrections/:journalEntryId` with `dryRun: true` first.
3. Review the dry-run diff with the chief accountant; only then run non-dry-run, one entry at a time, reversal + re-post (the JV-178/189 precedent), never editing posted lines.
4. Re-run the audit; expect zero.
