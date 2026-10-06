# SPEC D — Unified payment methods and statement reconciliation

Audit: `audit/D-payments-reconciliation.md`.

## D1. One Payment Methods area

**Current.** `PaymentMethod` (clearing account, reconciliation flag) and `PaymentSource` (channel vocabulary + fee estimate) both mean "how the customer paid"; `Payment.paymentSourceId` is required and is derived from the method by _name match_ (usually falls to the default). Two settings screens. Receiving accounts (bank/cash destinations) have an API but no screen.

**Target.**

- Keep the tables (history, required FKs) but make **Payment Method the only user-facing concept**: `PaymentMethod.paymentSourceId` (nullable FK, "channel") + fee estimate fields move into the Payment Methods form. Declarations derive the source from the method's channel, then the default — no name matching.
- Migration backfills `payment_methods.payment_source_id` by case-insensitive name match else the default source; no existing transaction is touched.
- The Payment Sources screen is removed from navigation (route redirects to Payment Methods); channel list editing becomes a section of the Payment Methods area.
- Receiving accounts (bank / cash) get a tab inside the same area (they are destinations, not methods — not merged).
- Each method shows: clearing account (required, ASSET posting), reconciliation flag, channel, fee estimate; settlement fee account remains the global `paymentGatewayFeeAccountId`. Payment terms (prepaid/COD/credit) stay separate.

## D2. Statement import and matching

**Current.** Per-method workspace with import (file / sheet / manual), dedupe key, planner, suggestions, row locks, settlement (grouped payouts). Gaps: file mapping not reusable; negative/refund rows rejected; `PaymentMatch` lacks a uniqueness guard; bank engine can adopt a claim already matched on a provider statement.

**Target.**

- Saved mapping per method (`ImportMappingTemplate` importType `payment-statement:<methodId>`), applied automatically on the next import, editable in preview.
- Refund / chargeback rows are imported (not rejected) as a distinct line kind and shown as "Refund / chargeback — review", excluded from claim matching, counted in net-settlement totals.
- Partial unique index on `payment_matches(statement_line_id, payment_id) WHERE status='ACTIVE'`.
- Cross-engine guard: bank reconciliation refuses a `Payment` with an ACTIVE `PaymentMatch` (and vice versa) — one claim, one engine.
- Matching posts nothing new; customer receipt only on full allocation (existing); settlement remains the only clearing → bank entry.

## Migration

`payment_methods.payment_source_id` + backfill; `payment_statement_lines.kind` (PAYMENT default | REFUND | CHARGEBACK) with amount CHECK relaxed only for non-PAYMENT kinds; partial unique index. Non-destructive.
