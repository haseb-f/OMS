# Round 13 — decisions

## Taken (lead, within existing policy)

- **D-A1** Phone calling code is UI state derived from E.164; no phone-country column (E.164 already carries it).
- **D-A3** Blue sequence is logical: lightest at inline-start → darkest at inline-end (RTL: light right → dark left; LTR: light left → dark right). Supersedes R9/R12 "dark on the right".
- **D-B1** Posting accounts may not have children; Group ↔ Posting conversion only while it changes no history (no lines / no children). Replaces the silent auto-flip.
- **D-B2** Expense account must be EXPENSE type. FT create accepts an idempotency key.
- **D-C** OMS keeps due-date posting of PENDING schedule rows (no draft journal entries for future periods).
- **D-D1** Payment Source becomes the method's _channel_ (internal vocabulary); one Payment Methods area.
- **D-E** Sales = valid orders by `orderDate` (Cairo); amounts per currency only; ranking by count, or amount within one currency.

## Adopted by the owner (2026-10-06) — binding rules

All existing data is test data; affected test records were corrected by migration (scoped to these workflows).

- **O-1 Purchase return of an asset line.** Returns credit the account the invoice debited (Fixed Assets / Prepayments / capitalised non-recoverable tax) at the invoice rate. An asset with no posted depreciation can be returned (whole line) → asset DISPOSED, linked to the return, pending periods CANCELLED, no second derecognition entry. An asset with posted depreciation cannot be returned — dispose it to the supplier (disposal proceeds as supplier credit: Dr supplier AP).
- **O-2 Acquisition cost (IAS 16).** Non-recoverable tax (`Tax.isRecoverable = false`) on an asset line is capitalised; recoverable tax stays VAT input. Directly attributable later costs (delivery, installation) are invoice lines linked to the existing asset: cost increases, remaining depreciation re-spread prospectively; posted periods unchanged; never a second asset.
- **O-3 Prepaid expenses.** Two distinct actions: **Cancel with refund** (unrecognised balance reclaimed: Dr supplier AP or cash / Cr Prepayments, status CANCELLED) and **Recognise remaining now** (Dr expense / Cr Prepayments, status COMPLETED). A purchase return of a prepaid line reclaims at most the unrecognised balance.
- **O-4 Expenses screen** stays and is the expense-voucher UI (FinancialTransaction EXPENSE_PAYMENT): account chosen on the form (EXPENSE posting accounts only), paid-from bank/cash + payment method, optional supplier counterparty (never posted to AP), cost centre / project. Draft never posts; Confirm & post (separate permission) posts Dr expense / Cr bank **dated on the expense date**; idempotent create/confirm; corrections by reversal (cancel), locked periods refused. An expense never settles an invoice — open supplier invoices are offered as "Pay invoice instead" (supplier payment, Dr AP). Legacy `Expense` table migrated and removed (one concept).
- **O-5** Employee ranking per currency (no conversion).
- **O-6** `reports.sales.view` granted to users who already hold `reports.view`; data scope unchanged.
- **O-7** Disposal month: full-month convention (depreciation through the last full month ending on/before the disposal date).
- **O-8** Schedule test data corrected by migration `20261007100000` (pending rows of disposed/archived assets and finished prepaids CANCELLED, derived totals = Σ posted rows); no journal entry changed.
- **O-9** A phone without calling code valid in several markets is refused ("choose the calling code").
- **O-10** Accounts referenced by settings / mappings cannot become Group or be archived.
- **Payment matches**: duplicate ACTIVE (line, claim) test rows consolidated into the oldest row (others REVERSED with reason, totals unchanged), unique index always enforced (migration `20261006120000`).
- **Documented, not changed:** lock races (Posting → Group conversion vs a simultaneous posting; bank-side engine guard without row lock) — low probability, propose for a performance-reviewed round.
