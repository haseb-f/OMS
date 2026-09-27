# Handoff — payment-declaration-reconciliation

- Branch `main`. HEAD = origin/main = Production = `00109b0` (foundation: schema, migration, permissions,
  i18n modules, contracts). Production migration is applied and the exclusion constraint is live.
- Resumed 2026-09-27 after a laptop shutdown during integration. All four implementers
  (IMPL-DECL, IMPL-REC, IMPL-SET, IMPL-FX) had finished. Their work is intact in the working tree:
  about 63 modified and about 30 untracked paths, nothing committed.
- Integration changes by the Master (uncommitted):
  - Period-boundary fix (`accounting/fiscal-periods/period-bounds.ts` and its spec, used by period,
    fiscal-year, bootstrap and opening-balance checks). Last-day postings now respect closed periods.
  - Settlement JE mapped to the CASH journal.
  - Report FX conversions go through ExchangeRatesService (overrides and staleness).
  - `store-orders.manage` may declare.
  - The payment-method hardening test finds its method by name.
- Running: the full gates (log in `tmp/gates-pdr.log`) and the REV-PDR accounting and security review
  (read-only).
- Next: fix gate and review findings → commit → push → deploy → verify SHA → Production acceptance with
  tagged QA data (criteria 1–8 of the rules message, plus spec items 1–9) → Arabic guide → handoff.
- Known gaps recorded so far:
  - No JE → settlement traceability kind.
  - No `SyncSourceType.PAYMENT_STATEMENT`; the sheet connection is stored as a PaymentStatementImport row.
  - The per-method provider status list is a code constant.
  - Local base currency is SAR, so a CBE import fails closed locally; it imports on Production, where
    the base currency is EGP.
  - The FX rate basis defaults to a derived MID and the owner can change it in settings.
