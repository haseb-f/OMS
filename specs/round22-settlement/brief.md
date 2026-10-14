# Owner brief — R22 (2026-10-14, verbatim)

Run a focused OMS correction round for receipts, payments, invoice settlement, and their UI. This workflow is still unreliable.
Work in D:\Systems\OMS. First reproduce and diagnose the defects, then write the repair plan, implement it, and verify the complete accounting and browser journeys. Do not start with cosmetic changes or assume earlier fixes resolved the problem.
Coordinate active agents, preserve unrelated work, and maintain durable checkpoints.

## 1. Investigate before implementation

Trace both directions:

- Customer invoice → receipt → allocation → journal → bank/cash → customer statement.
- Supplier invoice → payment → allocation → journal → bank/cash → supplier statement.

Inspect actual records and existing tests. Identify whether discrepancies originate in posting, allocation, aggregation, stale caches, status calculation, or presentation.
Create failing regression cases before fixing confirmed defects.
Required baseline example, in both directions:

- Invoice total: 200,000.
- Confirmed allocated payment: 100,000.
- Remaining payable/receivable: 100,000.
- Invoice status: partially paid.
- Actual bank/cash movement: 100,000, not 200,000.

Document the root causes and a concise repair plan.

## 2. Receipts and payments are broader than invoice settlement

A receipt voucher is not necessarily a customer-invoice collection. Support the appropriate existing operation types, including:

- Customer invoice settlement.
- Customer advance or unapplied receipt.
- Other receipts with an authorized accounting counterpart.
- Internal transfers through the existing transfer workflow.

Likewise, distinguish supplier-invoice settlement, supplier advances, direct expenses, and other authorized payments.
Reuse existing accounting modules and mappings. Do not create competing workflows or treat every incoming amount as revenue and every outgoing amount as expense.
For each operation type:

- Show only the relevant fields.
- Require a customer/supplier only when relevant.
- Require invoice allocation only for invoice settlement.
- Allow the appropriate authorized account selection for other operations.
- Map the bank/cash/payment method correctly.
- Generate balanced entries at the defined confirmation/approval event.
- Keep drafts unposted.
- Link the resulting journal entry to the originating voucher.

Allocating an already posted receipt/payment must not create a second bank/cash movement. Internal transfers must not duplicate income or expenses.

## 3. Simple receipt/payment card

Redesign receipt and payment entry as a compact, clear card or dialog with a short progressive flow:

1. Operation purpose and counterparty/account where applicable.
2. Amount, currency, payment method, and date.
3. Invoice allocation when relevant, then review and confirm.

Avoid unnecessary steps for simple operations.
Make the amount field unmistakable:

- Prominent editable input with a clear label: "المبلغ المقبوض" or "المبلغ المدفوع".
- Visible currency.
- Substantial border and clear hover/focus treatment.
- Empty initial value rather than an actual prefilled zero.
- A subtle placeholder such as "أدخل المبلغ", with a persistent accessible label.
- Comfortable numeric entry, decimals, paste, and mobile keyboard behavior.
- Preserve existing values when editing.

Show a concise summary before confirmation explaining where the money goes and which invoices will be settled.
Prevent double submission, preserve entered values on validation errors, and provide actionable feedback.

## 4. Authoritative invoice settlement amounts

Use a consistent settlement calculation across customer and supplier invoices.
Clearly distinguish: invoice total; confirmed payments allocated to this invoice; credit notes or other settlement adjustments; remaining balance; payment status.
Do not label credit-note settlement as cash paid. Do not count draft, failed, cancelled, reversed, or unallocated payments as invoice payments.
Support: multiple partial payments; one receipt/payment allocated across multiple invoices; advances subsequently allocated; excess amounts retained as explicit unapplied credit; reallocation, reversals, refunds, and credit notes; multi-currency settlement using the approved rate and rounding policy; concurrent submissions and safe retries.
Prevent allocation beyond the available payment or invoice balance. Enforce company, counterparty, currency, and permission boundaries.
Derive unpaid/partially paid/settled states consistently. Distinguish a fully paid invoice from one settled through credit notes or adjustments where necessary.

## 5. Invoice presentation and table alignment

Improve both sales and purchase invoice lists and details. Make these figures immediately visible: total, paid, remaining, payment status. Use readable amounts, explicit currency labels, and consistent semantic colors. Keep adjustments available in the settlement breakdown.
For tables: align every column header with its corresponding cell content; consistent logical alignment in RTL and LTR; align numeric values for easy comparison; keep amount and currency presentation consistent; avoid clipped amounts and misleading truncated labels; preserve column resizing, sorting, filtering, and mobile usability; ensure sorting uses numeric values rather than formatted strings.
From each invoice, provide a clear settlement history showing linked vouchers, allocations, dates, statuses, and permitted reversal/adjustment actions.
After a successful operation, refresh the invoice, statement, and affected summaries so users do not see stale paid/outstanding values.

## 6. Existing-data correction

Identify affected records and separate: incorrect display or derived status; incorrect allocations; incorrect posted accounting entries. Repair each at the correct layer. Do not change valid journal entries merely to fix a display issue, invent payments, or delete financial history to make totals match. Any repair must be traceable, idempotent, and supported by before/after reconciliation.

## 7. Verification and release

Use independent accounting review and test the integrated result, including: the 200,000 / 100,000 partial-settlement example for customers and suppliers; full payment, no payment, multiple installments, and overpayment; unapplied receipt and subsequent allocation; other receipt types and direct expense payments; one payment across several invoices; reversal, credit note, refund, and retry/concurrency cases; correct bank/cash entries without duplication; agreement between invoices, statements, ledger, reconciliation, reports, and exports; authorized versus unauthorized users; Arabic/English and desktop/mobile; column-header alignment and amount-entry usability.
Run required tests and production builds after the final fix. Do not claim "no errors" from build success alone.
Once the complete round passes, coordinate the release, commit, push, and deploy. Verify the actual deployed workflows.
Provide a concise Arabic handoff with root causes, fixes, repaired records, test evidence, deployment status, and any remaining limitation.
