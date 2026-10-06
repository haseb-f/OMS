# R13b — browser acceptance (`scripts/acceptance/r13/r13b-browser.mjs`)

Run 2026-10-06T13:36:58.502Z against http://localhost:3001 (API http://localhost:3005, local DB `oms`), tag `R13B689668`. Result: **44/44 PASS**, 0 FAIL.

Regression: `browser-acceptance.mjs` (R13) re-run on the same build — **74/74 PASS**, no script change needed.

Demo data (via API, tagged): EXPENSE posting account, receiving account "<tag> Bank", cost centre, supplier, non-stock product, confirmed purchase invoice with one FIXED_ASSET line (schedule from the 1st of last month; the global depreciation run up to the end of last month posted its first period), ACTIVE prepaid expense (1,200 / 12 months).

| Result | Check                                                                                                    | Detail                                                                                                                                       |
| ------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| PASS   | setup: confirmed purchase invoice with a FIXED_ASSET line → capitalized asset with posted depreciation   | PI-2026-000036 FA-2026-000055 CAPITALIZED run posted=1 failed=0 postedPeriods=1                                                              |
| PASS   | setup: tagged ACTIVE prepaid expense                                                                     | PE-2026-000021 ACTIVE                                                                                                                        |
| PASS   | setup: tagged expense account, bank, cost centre, supplier                                               | R13B689668                                                                                                                                   |
| PASS   | E1. /finance/expenses list loads                                                                         | Home Finance Expenses Search… ⌘K Command Palette Search modules and pages SA Expenses Record what the company spent. Sav                     |
| PASS   | E1. form: expense account, paid from and cost centre chosen on the form                                  | Home Finance Expenses New expense Search… ⌘K Command Palette Search modules and pages SA ExpenseEP-… 03 Oct 2026 · 123.45 Draft Save Confirm |
| PASS   | E1. Save draft → editor of the saved voucher                                                             | http://localhost:3001/finance/expenses/ba97b2e1-4532-4254-b8a2-c9a770091023                                                                  |
| PASS   | E1. API: draft saved with the chosen account / bank / cost centre / date and NO journal entry            | EP-2026-000082 DRAFT date=2026-10-03 amount=123.45 JEs=0                                                                                     |
| PASS   | E1. UI: posting state 'Not posted (draft)'                                                               | Posting Not posted (draft) Notes More Details                                                                                                |
| PASS   | E1. Confirm & post asks for confirmation (Dr expense / Cr paid-from explained)                           | Confirm & post this expense? A journal entry is posted now (Dr the expense account, Cr the paid-from account) and the expense can no longer  |
| PASS   | E1. API: status posted (CONFIRMED)                                                                       | CONFIRMED                                                                                                                                    |
| PASS   | E1. double-click Confirm → exactly one journal entry                                                     | JV-2026-001316                                                                                                                               |
| PASS   | E1. API: entry balanced Dr expense account / Cr bank's ledger account, 123.45                            | JV-2026-001316 Dr 518 123.45 / Cr AGT-BANK-64AE67 123.45                                                                                     |
| PASS   | E1. API: entry dated on the expense date (back-dated, not the confirm date)                              | entry 2026-10-03 expense 2026-10-03 confirmed 2026-10-06                                                                                     |
| PASS   | E1. API: cost centre carried to the journal entry (header; reports filter by it)                         | line=null header=28d44def-bcd1-4aba-8773-2b1e4516860b                                                                                        |
| PASS   | E1. UI: success toast + 'Posted' + journal entry number linked                                           | {"toast":true,"badge":true,"number":true,"link":true} toast="Expense EP-2026-000082 posted — journal entry created." JE=JV-2026-001316 Posti |
| PASS   | E1. journal entry link opens the entry preview                                                           | Journal entry JV-2026-001316 Status Posted Date 03 Oct 2026 Reference EP-2026-000082 Description Expense Payment Voucher EP-2026-000082 Acco |
| PASS   | E1. Reverse asks for confirmation (reversal entry explained)                                             | menu: Reverse this expense? A reversal journal entry is posted with today's date and the expense becomes Cancelled. Refused while today's ac |
| PASS   | E1. API: Reverse → CANCELLED + balanced reversal entry mirroring the original                            | CANCELLED original=JV-2026-001316(REVERSED) reversal=JV-2026-001317 reversalOf=true                                                          |
| PASS   | E1. UI: 'Reversed' + reversal entry linked on the voucher                                                | reversal=JV-2026-001317 shownOriginal=true                                                                                                   |
| PASS   | E1b. new form, Confirm & post double-clicked → one voucher, posted once                                  | EP-2026-000083:CONFIRMED JEs=1 url=/finance/expenses/979338a0-c2c8-4cd8-b2e1-b016cb99bd56                                                    |
| PASS   | E2. open purchase invoice warning shown for the supplier                                                 | R13B689668 Supplier has 1 open purchase invoice(s) — 2,400.00 unpaid                                                                         |
| PASS   | E2. 'Pay invoice instead' links to the supplier payment editor for that invoice                          | /purchasing/payments/new?partnerId=db521df2-58e6-43be-8ed5-7826394bd9e8&invoiceId=e237526f-d117-4a54-b374-3f5269d3de99                       |
| PASS   | E2. clicking it opens the supplier payment editor                                                        | /purchasing/payments/new Home Finance Supplier Payments New Payment Voucher Search… ⌘K Command Palette Search modules and pag                |
| PASS   | E3. [ar] /finance/expenses renders RTL with Arabic labels                                                | rtl الرئيسية المالية المصروفات بحث… ⌘K لوحة الأوامر البحث في الوحدات والصفحات SA المصروفات سجّل ما أنفقت                                     |
| PASS   | E3. [ar] /finance/expenses/new renders RTL with Arabic labels                                            | rtl الرئيسية المالية المصروفات مصروف جديد بحث… ⌘K لوحة الأوامر البحث في الوحدات والصفحات SA مصروفEP-… 06                                     |
| PASS   | E3. [ar] reversed voucher shows 'معكوس' and the action bar in Arabic                                     | الرئيسية المالية المصروفات EP-2026-000082 بحث… ⌘K لوحة الأوامر البحث في الوحدات والصفحات SA السجلات المرتبطة القيود قيد يومية JV-2026-001316 |
| PASS   | E3. [en] /finance/expenses renders LTR                                                                   | ltr                                                                                                                                          |
| PASS   | E4. 390 px: /finance/expenses — no horizontal scroll                                                     | {"scrollW":390,"vw":390,"ok":true}                                                                                                           |
| PASS   | E4. 390 px: /finance/expenses/new — no horizontal scroll                                                 | {"scrollW":390,"vw":390,"ok":true}                                                                                                           |
| PASS   | E4. 390 px: /finance/expenses/:id — no horizontal scroll                                                 | {"scrollW":390,"vw":390,"ok":true}                                                                                                           |
| PASS   | F. dispose dialog offers 'Supplier credit' once proceeds > 0                                             | menu: Dispose / Write-off Depreciation through the disposal date is posted first; the remaining periods are cancelled, then the asset is der |
| PASS   | F. supplier credit shows 'Supplier to credit' + the Accounts Payable hint                                | Dispose / Write-off Depreciation through the disposal date is posted first; the remaining periods are cancelled, then the asset is derecogni |
| PASS   | P. 'Cancel with refund' dialog: balance reclaimed from the supplier + Refund to (supplier credit / cash) | menu: Cancel with refund Recognitions due by the date are posted first. The unrecognized balance (1,200.00) is reclaimed from the supplier a |
| PASS   | P. 'Recognize remaining now' dialog: balance expensed on the date (not reclaimed)                        | inline: Recognize remaining now Recognitions due by the date are posted first. The unrecognized balance (1,200.00) is expensed on that date  |
| PASS   | P. API: recognize remaining → COMPLETED (closure RECOGNIZED)                                             | COMPLETED closure=RECOGNIZED toast="Remaining balance recognized."                                                                           |
| PASS   | P. API: one balanced PREPAID_ACCELERATION entry Dr expense for the unrecognized balance                  | JV-2026-001319 total=1200 remaining=1200                                                                                                     |
| PASS   | P. UI: closed notice shown, early-closing actions gone                                                   | Home Finance Prepaid Expenses PE-2026-000021 Search… ⌘K Command Palette Search modules and pages SA R13B689668 Annual licence PE-2026-000021 |
| PASS   | R. API: returnable summary refuses the asset line (posted depreciation)                                  | Fixed asset FA-2026-000055 already has 1 posted depreciation period(s), so its invoice line cannot be returned. Dispose the asset to the sup |
| PASS   | R. return dialog shows 'Cannot be returned' with the reason (dispose to supplier instead)                | menu: Create Purchase Return Select which received lines are going back to the supplier. Product Quantity R13B689668 Office printer Cannot b |
| PASS   | R. the blocked line cannot be selected                                                                   | checkboxes=1                                                                                                                                 |
| PASS   | T. tax form shows 'Recoverable input tax' (default on)                                                   | control=1 checked=true                                                                                                                       |
| PASS   | S. payment methods: tabs Methods / Channels / Receiving accounts                                         | Methods \| Channels \| Receiving accounts                                                                                                    |
| PASS   | S. payment methods: Channels tab renders                                                                 | Payment channels The internal channel list (card, wallet, transfer…) with an optional fee estimate.                                          |
| PASS   | S. sales reports Live loads (5 period cards, no error)                                                   | 5 cards                                                                                                                                      |

## Coverage notes

- The expense date is back-dated 3 days on the form; the entry date equals the expense date, not the confirm date.
- Double-click is exercised twice: the dialog's Confirm & post on a saved draft (one entry), and on a new form (one voucher, one entry — idempotency key).
- The cost centre is carried on the journal entry header (`JournalEntry.costCenterId`), which is what report scoping filters on; expense lines carry `costCenterId = null`.
- Fixed-asset disposal and prepaid "Cancel with refund" are checked up to their dialogs (not executed); "Recognize remaining now" is executed and verified via the API.
- Not covered: none.

## Bugs / observations

1. **Low (a11y)** — `apps/web/src/components/financial-transactions/financial-transaction-editor.tsx` (~l.318 party label, ~l.323 date label): `<label>` without `htmlFor`, so "Expense account" / "Expense date" are not associated with their controls (screen readers, `getByLabel`). The other fields use `htmlFor`.
2. **Observation** — the account picker shows the Arabic `name` in the English UI even when `nameEn` is set (`r13b-expense-posted.png`).
3. **Observation** — `FinancialTransaction.postedToAccounting` stays `false` on a posted expense voucher (the schema marks it a prep-only placeholder); API consumers must rely on the journal entry, not this flag.

## Screenshots

- `r13b-expense-draft.png`
- `r13b-expense-posted.png`
- `r13b-expense-reversed.png`
- `r13b-expense-pay-invoice.png`
- `r13b-expense-ar-rtl.png`
- `r13b-expense-mobile-390.png`
- `r13b-fixed-asset-dispose-supplier-credit.png`
- `r13b-prepaid-recognize-remaining.png`
- `r13b-purchase-return-blocked.png`
- `r13b-tax-recoverable.png`
