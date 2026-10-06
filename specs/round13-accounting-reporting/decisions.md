# Round 13 — decisions

## Taken (lead, within existing policy)

- **D-A1** Phone calling code is UI state derived from E.164; no phone-country column (E.164 already carries it).
- **D-A3** Blue sequence is logical: lightest at inline-start → darkest at inline-end (RTL: light right → dark left; LTR: light left → dark right). Supersedes R9/R12 "dark on the right".
- **D-B1** Posting accounts may not have children; Group ↔ Posting conversion only while it changes no history (no lines / no children). Replaces the silent auto-flip.
- **D-B2** Expense account must be EXPENSE type. FT create accepts an idempotency key.
- **D-C** OMS keeps due-date posting of PENDING schedule rows (no draft journal entries for future periods).
- **D-D1** Payment Source becomes the method's _channel_ (internal vocabulary); one Payment Methods area.
- **D-E** Sales = valid orders by `orderDate` (Cairo); amounts per currency only; ranking by count, or amount within one currency.

## Open owner decisions (recommendation first)

- **O-1 Purchase return of a capitalized / deferred line.** Today a return leaves the asset and its schedule intact. Example: laptop 30,000 capitalized, returned in month 2 → asset still depreciates. _Recommend:_ block returning a line whose asset is CAPITALIZED with posted depreciation; require disposal first.
- **O-2 Non-recoverable VAT / freight on asset acquisition.** Example: 10,000 + 1,400 non-recoverable VAT + 500 delivery. _Recommend:_ capitalize non-recoverable tax and directly attributable costs (IAS 16) via the landed-cost path; recoverable VAT stays in VAT input.
- **O-3 Cancelling an ACTIVE prepaid.** _Recommend:_ allow cancel → remaining balance expensed (or credited back with a supplier credit note), rows CANCELLED.
- **O-4 Legacy `Expense` screen** (no posting) duplicates expense vouchers. _Recommend:_ hide from navigation, keep data read-only.
- **O-5 Employee ranking in a reporting currency.** _Recommend:_ keep per-currency ranking (no conversion) until a reporting-currency policy with dated rates is approved.
- **O-6 Production grant of `reports.sales.view`.** Migration grants it to roles already holding `reports.view`; confirm before deploying.
- **O-7 Depreciation for the disposal month.** Catch-up stops at the last full month ending on/before the disposal date. Example: asset disposed 20 March → depreciation through 28/29 Feb only. *Recommend:* keep full-month convention (simple, consistent with the monthly schedule) unless auditors require pro-rata days.
- **O-8 Assets disposed before R13 that still hold PENDING periods.** They are never posted (the run skips disposed assets), but they show as pending. *Recommend:* a separate, reviewable SQL proposal that marks them CANCELLED (status only, no journal impact) — not executed in this round.
