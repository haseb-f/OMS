# Evidence D — payment methods area + statement matching (R13, agent D-pay)

## Migration `20261006120000_r13_payment_method_channel` (non-destructive)

- `payment_methods.payment_source_id` UUID NULL, FK → `payment_sources` (ON DELETE SET NULL), indexed.
  Backfill 1: active source whose `lower(btrim(name))` equals the method's; backfill 2: the active `is_default` source; otherwise NULL.
  On `oms_d`: the two seeded Arabic methods matched by name; no default source exists, so the rest stay NULL (declarations fall back at runtime).
- `PaymentStatementLineKind` enum (PAYMENT | REFUND | CHARGEBACK) + `payment_statement_lines.kind` default PAYMENT.
  Amounts stay positive: the existing `amount > 0` CHECK is **kept** (no relaxation needed); new CHECK
  `payment_statement_lines_kind_unmatched` = `kind = 'PAYMENT' OR matched_amount = 0`.
- Partial unique index `payment_matches_active_line_payment_key (statement_line_id, payment_id) WHERE status = 'ACTIVE'`.
- No payment, statement line, match or journal row is rewritten.

## D1 — one Payment Methods area

- Declarations: `resolvePaymentSourceId` = explicit source → method channel (active) → default/first active source. Name matching removed.
- API: `PaymentMethod` DTO accepts `paymentSourceId` (exists + active; `null`/`""` clears); list/get include the channel and its fee estimate.
  Clearing account still required + posting leaf. Payment Sources accept `isDefault` (one default at a time).
  Receiving accounts moved onto `MasterDataCrudService` (paginated list, archive/restore, activity, posting-account check, code `RA-0001…` generated when blank; legacy `DELETE` kept).
- Web: `/master-data/payment-methods` = tabs **Methods / Channels / Receiving accounts** (`?tab=`), each tab gated by its own view permission, route open with any (`permissionMatch: "any"`).
  `/finance/payment-sources` → `?tab=channels`, `/finance/receiving-accounts` → `?tab=receiving-accounts` (redirects). Both nav entries and their dead i18n lines removed.
  `MasterDataPage` list state is now keyed by `tableId` (sibling tables on one route never share search/sort) and the "open record" toast keeps other query params.

## D2 — statements

- Saved file mapping: a committed FILE import upserts `ImportMappingTemplate` (`payment-statement:<methodId>` / `default`, options under `$…` keys) via `ImportMappingTemplatesService`; the next preview without a mapping pre-applies it when every column exists (`mappingSource: SAVED`), otherwise guesses (`SUGGESTED`). The dialog shows which.
- Refund / chargeback: negative amount or REFUNDED / CHARGEBACK / DISPUTED status → `kind` REFUND / CHARGEBACK, magnitudes stored; dedupe key namespaced (`refund:ref:<ref>`) so it never overwrites the payment with the same reference; content hash unchanged for PAYMENT rows (pre-R13 re-imports stay duplicates).
  Excluded from suggestions (`NOT_A_PAYMENT`), confirm, the Matching tab list and "unmatched" totals; shown as "Refund / chargeback — review"; summary adds statement payments / refunds / net per currency.
- Confirm tops up an existing ACTIVE (line, claim) allocation instead of inserting a second row (the index is the backstop).
- Cross-engine guard (`engine-guard.util.ts`): bank adoption (`findAdoptableClaim`) and bank `confirmMatch` refuse a claim with an ACTIVE `PaymentMatch` (409, no new Payment created); provider suggestions/search exclude and confirm refuses a claim with a live `BankTransaction.matchedPaymentId`.
- No new journal entries: matching/settlement paths unchanged.

## Tests (DB `oms_d`)

- New `payment-reconciliation/r13-payment-methods-statements.integration.spec.ts` — 8/8: backfill SQL (in a rolled-back tx), derivation, receiving accounts, saved mapping + idempotent re-import + refund lines + net totals, refund refused by matching + DB CHECK, ACTIVE-match index + top-up, cross-engine both directions.
- `statement-row.util.spec.ts` (refund kind, keys, hashes), `payment-methods.service.spec.ts` (channel) updated.
- Payment suites (reconciliation, declaration, settlements incl. grouped payout, bank-transactions, payments, payment-methods): 14 suites / 169 tests pass.
- Web: `vitest run` 127 files / 894 tests pass (nav spec updated). `tsc` api + web clean; eslint clean on changed files.
