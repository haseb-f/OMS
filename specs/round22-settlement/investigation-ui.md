# R22 I-B — receipts / payments UI, voucher types, invoice presentation, tables (phase 1)

Branch `feat/r22-ib` (base `f77ee307`). Phase 1 only: reproduce, measure, document, failing tests — **no production
code changed**. Local build (API :4915 / web :4911, DB `oms_r22_ui`, admin@oms-demo.local), never Production.
Measurement script `scripts/acceptance/r22/r22-ib-ui-measure.mjs` → `evidence/ib/measure.json` + `measure.log` +
48 screenshots (ar/en, 1440/375). Last run: **198 / 300 checks pass, 102 fail** (each FAIL is a phase-2 item).

## 1. Operation-type matrix (brief §2)

The voucher layer has exactly four types — Prisma enum `FinancialTransactionType` (schema.prisma:7329-7343):
CUSTOMER_RECEIPT, SUPPLIER_PAYMENT, EXPENSE_PAYMENT, CUSTOMER_REFUND. A second, richer registry `TransactionType`
(`transaction_types`, 19 system codes incl. CUSTOMER_ADVANCE, DIRECT_REVENUE, OWNER_CONTRIBUTION, FINANCING_RECEIVED,
VENDOR_ADVANCE, INTERNAL_TRANSFER_IN/OUT …, `defaultAccountId`) is used only by the Import Center dropdowns — nothing
posts from it and `FinancialTransaction` has no FK to it (schema.prisma:7191-7200, 7272-7301).

| Operation                                                                     | Today's screen                                                                                                                                         | Min. clicks                                                                                                      | Fields shown                                                                                                                                                                          | Required wrongly / missing                                                                                                                                             |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer invoice settlement                                                   | `/sales/invoices/:id` «استلام دفعة» → `/sales/payments/new?partnerId&invoiceId`                                                                        | **2** (button, Confirm) from the invoice; ~8 from Finance › المقبوضات › New (picker 3, amount, row «+», Confirm) | type (disabled), customer*, date, amount*, payment source, receiving account, reference, open-invoices table, allocation grid, 2 summaries, notes, «more details»                     | Works. Invoice appears twice (open-invoices table + allocation grid). No review step (§3)                                                                              |
| Customer advance / unapplied                                                  | same receipt editor, no allocation                                                                                                                     | ~7 (+1 warning dialog when invoices are open)                                                                    | same                                                                                                                                                                                  | Works; purpose is implicit (only the R20 «لم تُحدَّد أي فاتورة» dialog says so); open-invoice UI still shown                                                           |
| Other receipt with authorised counterpart (misc. income, owner capital, loan) | **none** — party is mandatory (`financial-transaction-validation.ts:34`, API service :1437-1447), receipt DTO has no counterpart-account field         | —                                                                                                                | —                                                                                                                                                                                     | **Missing.** Only a manual journal entry (`/finance/journal-entries/new`); investor capital via Investors › Opportunity only                                           |
| Internal transfer cash ↔ bank                                                 | `/finance/bank-transactions` › row › Reconcile › «Transfer» › Find › Confirm (`confirmInternalTransfer`, cash-flow-reconciliation.service.ts:989-1030) | 5 — but **only pairs two already-imported bank lines**                                                           | —                                                                                                                                                                                     | **Cannot be started** by a user (no create endpoint; bank rows come from import). Classify offers only EXPENSE / SUPPLIER_PAYMENT (bank-transactions/page.tsx:602-608) |
| Supplier invoice settlement                                                   | `/purchasing/purchase-invoices/:id` «تسجيل دفعة» → payment editor                                                                                      | 2                                                                                                                | as receipt; the paying account is labelled **«حساب الاستلام»** (no `fieldLabels` override in payment-editor-page.tsx)                                                                 | Wrong label for OUT                                                                                                                                                    |
| Supplier advance                                                              | payment editor, no allocation                                                                                                                          | ~7                                                                                                               | same                                                                                                                                                                                  | implicit purpose                                                                                                                                                       |
| Direct expense                                                                | Finance › المصروفات › New (`expense-editor-page.tsx`, shared editor)                                                                                   | ~6                                                                                                               | type (disabled), expense account*, date, amount*, payment method, «مدفوع من», reference, description, **currency (separate field)**, supplier (optional), cost centre, project, notes | Correct model (EXPENSE account only, no allocation); amount + currency split across the form                                                                           |
| Other payment (drawings, loan repayment, bank fees)                           | **none** as a voucher; partner profit payout (company-partners) and investor capital return have their own flows                                       | —                                                                                                                | —                                                                                                                                                                                     | **Missing** (manual JE only)                                                                                                                                           |
| Customer refund                                                               | Sales return › «استرداد» / store-order money panel → `CustomerRefundDialog`; `/sales/payments?view=refunds` has no New                                 | 3–4                                                                                                              | customer, return allocation (must equal amount)                                                                                                                                       | OK as a credit-note cash leg; not reachable from Finance                                                                                                               |
| Supplier refund                                                               | none (registry code VENDOR_REFUND only)                                                                                                                | —                                                                                                                | —                                                                                                                                                                                     | Missing                                                                                                                                                                |

Fields irrelevant to the operation on the receipt/payment card: the disabled «نوع الحركة» select (always one value,
financial-transaction-editor.tsx:299), «مصدر الدفع» beside «حساب الاستلام» (two account-like pickers, the method is
not mapped to the account), «تفاصيل إضافية» holding only the activity log, the open-invoices empty state shown on a
brand-new receipt before any customer is chosen («لا توجد فواتير مفتوحة لهذا الطرف», E-receipt-new-*-375.png).

## 2. Amount field (brief §3) — measured in real Chrome (A-*.png, measure.json `receiptAmountStates`)

| Requirement                               | Today                                                                                                                                                       | Where                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Label «المبلغ المقبوض» / «المبلغ المدفوع» | «المبلغ» on receipt, payment and expense                                                                                                                    | editor.tsx:341-344                                                           |
| Visible currency                          | none at the field; header meta drops the code when no settlement currency (advance)                                                                         | editor.tsx:249, 345                                                          |
| Substantial border, hover/focus           | 1 px `rgb(209,209,209)`, 32 px high, 14 px text; hover → `rgb(168,168,168)` (PASS); focus ring 3 px 18 % (PASS)                                             | `ui/input.tsx:15`, `money-input.tsx:39` (`compact-md`)                       |
| Empty initial value                       | PASS (`value={state.amount \|\| ""}`)                                                                                                                       | editor.tsx:348                                                               |
| Placeholder «أدخل المبلغ»                 | «0.00» (reads like a value)                                                                                                                                 | money-input.tsx:43                                                           |
| Decimals                                  | «100.05» OK; **«0.5» becomes «.5»** (typing «0» → amount 0 → value "" → field cleared)                                                                      | editor.tsx:351 `valueAsNumber \|\| 0` + `type="number"` (money-input.tsx:54) |
| Paste «1,234.50»                          | Chrome strips the comma → 1234.50 (PASS in Chrome; jsdom/other engines drop it → amount unchanged)                                                          | `type="number"`                                                              |
| Arabic-Indic digits «١٢٣٤٫٥»              | **rejected — field stays empty**                                                                                                                            | `type="number"`                                                              |
| Mobile keyboard                           | `inputmode=decimal` PASS; 14 px text at 375 px (< 16 px → iOS zoom), 32 px high                                                                             | money-input.tsx                                                              |
| Preserve values on validation error       | PASS (amount «750» kept, inline «اختر طرفاً قبل الحفظ.»)                                                                                                    | editor.tsx §8                                                                |
| Double submission                         | PASS (double-click Confirm → 1 POST, 1 voucher; `confirmingRef` + idempotency key)                                                                          | receipt-editor-page.tsx:293                                                  |
| Summary before confirm                    | **none** in the normal case — the only dialog is the R18/R20 unapplied warning; nothing says which account receives the money or which invoices are settled | use-voucher-amount.ts:47-91                                                  |
| Feedback                                  | toast «تم التأكيد» PASS                                                                                                                                     | —                                                                            |

Also: editing an allocation amount on a confirmed voucher is two calls (unallocate, then allocate —
receipt-editor-page.tsx:326-331, payment editor same); a failure in between leaves the line removed. The two editor
pages are 650 / 638-line near-duplicates (only party / service / route differ).

## 3. Invoice presentation (brief §4–§5)

- **List defaults (1440 ar/en):** sales/purchase invoices show `# · party · status · payment status · date`;
  receipts / supplier payments show `# · party · status` only. Total, paid and remaining are **hidden by default**
  (`defaultHidden` — sales invoice-columns.tsx:163, invoice-payment-columns.tsx:47,60; receipts page.tsx:335 amount,
  :341 date). The total sits as a second line under the _document_ status badge, start-aligned, without currency
  (invoice-columns.tsx:157; purchasing :165). The remaining amount under the payment badge is **clipped** at 1440:
  «المبلغ المتبقي …» (D-sales-invoices-ar-1440-default.png).
- **Currency labels:** paid / remaining money columns carry the code; total (column + status line) never does.
- **Detail:** `InvoicePaymentSummary` (components/business/invoice-payment-summary.tsx) shows paid (green) / remaining
  (red) / progress — no credit-note / adjustment line; the API figure is cash allocations only
  (`computeInvoicePaymentSummary`, invoice-payment.util.ts) — whether a sales return reduces «remaining» is an I-A /
  owner point (OQ-3). Settlement history = «السجلات المرتبطة» chips (voucher number + status only, **no date, no
  allocated amount, no reversal/unallocate action** — traceability.service.ts:329-361, C-invoice-detail-after-ar-1440.png).
- **Confirmed voucher's open-invoices row:** header «المتبقي» shows the balance _before_ this voucher
  (`describeOpenInvoice` openBefore, open-invoices-table.tsx:31-42; allocation grid capacity allocation-capacity.ts) —
  measured **160,000 under «المتبقي» while the invoice has 60,000 open**.
- Print / CSV carry paid / remaining / status (invoice-print.ts:32-34; export R20).

## 4. Tables — alignment, numeric edge, clipping, sort (measure.json `table:*`, `editorTable:*`)

Method: per column, the physical side of the visible _text_ (text-node rects, icons ignored) in `th` vs the first 12
`td`s, both directions; clipping = element with `scrollWidth > clientWidth`.

| Table                                            | Mismatch (ar = RTL, en = LTR)                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EnterpriseDataTable — sales / purchase invoices  | money columns (total, paid, remaining) correctly on the end edge in both directions; **status column** carries the total on the start edge; **payment-status column** mixes badge (start) + remaining (start, clipped: «المبلغ المتبقي 60,000.00» → «…»); with all columns shown at 1440 the date column collapses to «26» and «التا» (D-sales-invoices-ar-1440-all-columns.png); party names truncate («…YAHQ عميل») |
| receipts / supplier payments                     | amount only as a status sub-line (start edge) by default; amount column correct when shown                                                                                                                                                                                                                                                                                                                            |
| expenses                                         | amount correct; description, «مدفوع من», JE number clipped when all columns shown                                                                                                                                                                                                                                                                                                                                     |
| **Receipt / payment editor open-invoices table** | **ar: every money column mirrored** — headers on the left (end), figures on the right (start), offsets 88-145 px (e.g. «المتبقي» header gap L12/R145 vs body L110/R12). Cause: cells `num text-end` (open-invoices-table.tsx:299-316) and `.num` = `direction: ltr` (theme/tokens.css:77-81) → `text-end` resolves right in RTL. en: correct                                                                          |
| Invoice lines (detail)                           | warehouse clipped; «الخصم %» header/body off by 27 px                                                                                                                                                                                                                                                                                                                                                                 |

Sort (server mode, `manualSorting`, enterprise-data-table.tsx:936 — client `accessorFn`/formatted strings are not used
for sorting): the API passes `sortBy` straight into Prisma `orderBy` (sales-invoices.service.ts:223,
purchase-invoices.service.ts:240, financial-transactions.service.ts:538, no whitelist). Measured: `grandTotal` /
`amount` sort numerically (PASS); **`customer` / `supplier` → HTTP 500** («Unknown argument `customer`») although the
headers are sortable (invoice-columns.tsx:130, receipts page.tsx:290, payments page.tsx:223); paid / remaining are
not sortable (`enableSorting: false`, invoice-payment-columns.tsx:40,50,63) and would 500 if sent. Column metadata:
purchasing `grandTotal` (invoice-columns.tsx:170), payments `amount` / `createdAt` (payments page.tsx:261,267) rely on
id inference instead of declared `type`. 375 px: no horizontal scroll on any measured page (PASS).

## 5. Stale data after operations (brief §5)

No query cache exists (no TanStack Query / SWR / `router.refresh`; `services/api-client.ts:249` bare fetch; API sends
no Cache-Control). Every page refetches on mount, so in-tab navigation and Back are fresh. Stale cases measured / found:

1. **Another tab:** invoice detail open while a receipt is confirmed elsewhere keeps «المتبقي 100,000.00» after focus;
   60,000.00 only after reload (measure.json `staleTab`). No focus/visibility refetch (`lib/session-sync.ts:139-140`
   checks identity only) and no cross-tab event.
2. **Related records on the voucher** do not reload after allocate / unallocate on a confirmed voucher —
   `refreshKey={receipt?.status}` (receipt-editor-page.tsx:578, payment-editor-page.tsx:566).
3. Customer / supplier profile payments panel loads once per id (sales/customers/[id]/page.tsx:94-113,
   purchasing/suppliers/[id]/page.tsx:60-81); dashboard loads once (dashboard-data.ts:19-34).
4. Refund dialog notifies only its caller (customer-refund-dialog.tsx:166-215).

## 6. UI repair plan (shared components only, no competing workflow)

1. **One voucher card** (`FinancialTransactionEditor` stays the single shell; merge the two editor pages into one
   config-driven page): step 1 _purpose_ — an enabled segmented/select choice driven by the existing `TransactionType`
   registry mapped onto the four voucher types + the transfer workflow (settle invoices · advance / unapplied · other
   receipt/payment with an authorised account · internal transfer · expense); purpose decides which of party,
   counterpart account (AccountPicker, authorised list), allocation are shown/required. Step 2 amount / currency /
   method / date. Step 3 allocation (only for settlement: one table — open invoices with an inline «this voucher»
   input — replacing table + grid + two summaries) → review panel (money → account, invoices settled, unapplied rest)
   → Confirm. Internal transfer opens the existing transfer posting (`InternalTransferPostingProvider`) — needs an API
   entry point (I-A / owner).
2. **Amount input:** extend the shared `MoneyInput` (not a page style): `type="text"` + `inputMode="decimal"` with a
   parser for grouping commas, Arabic-Indic digits and «٫», keeps the typed string while editing (no «0.5» → «.5»),
   formats on blur; a `prominent` size (≥ 40 px, 16 px text on touch, 1.5 px border) and an inline currency adornment;
   placeholder «أدخل المبلغ»; direction-specific label keys.
3. **Invoice lists:** default-visible money columns `total · paid · remaining` (declared `type: "money"`, currency
   code on each), payment-status column = badge only, document-status column without the amount; drop the date's
   compression by giving status columns compact widths; API sort whitelist (+ party name relation sort) and a
   computed sort for paid / remaining, or disable sorting where the API cannot sort.
4. **Numeric cells in RTL:** fix the shared pattern — `num` must not be combined with `text-end`; use
   `numericEndAlignClass(direction)` / a shared `NumericCell` (open-invoices table, invoice lines, any `num text-end`).
   Add a shared-table spec guarding it.
5. **Settlement history** on both invoice details: a compact table (voucher, date, status, allocated, method) from
   the allocations, plus credit notes as a separate «تسويات / إشعارات دائنة» line, with permitted unallocate /
   cancel actions; label the voucher row «المتبقي قبل هذا السند» / «بعده».
6. **Freshness:** a tiny shared `useDataChanged(topic)` (BroadcastChannel + window focus) fired after confirm /
   allocate / cancel / refund and consumed by invoice detail, lists, statement, profile panel, dashboard;
   `RelatedRecordsPanel refreshKey` = voucher `updatedAt`. Atomic allocation-amount change (one API call).

## 7. Failing tests (phase 1)

| File                                                                                     | Fails / total | Guards                                                                                                                          |
| ---------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/financial-transactions/r22-amount-entry.spec.tsx`               | 7 / 9         | label ×2, placeholder, currency, paste «1,234.50», Arabic digits, «0» kept mid-typing (2 guards pass: empty start, saved value) |
| `apps/web/src/config/financial-transactions/r22-invoice-columns.spec.tsx`                | 17 / 28       | total/paid/remaining default-visible, declared money type, sortable, currency, no money in status columns (sales + purchase)    |
| `apps/web/src/components/financial-transactions/r22-voucher-purpose-and-tables.spec.tsx` | 4 / 4         | purpose selectable, payment account label, open-invoices RTL alignment, confirmed row remaining                                 |
| `scripts/acceptance/r22/r22-ib-ui-measure.mjs` (Playwright, local only)                  | 102 / 300     | all of §2–§5 incl. sort 500s, stale tab, settlement history                                                                     |

## 8. Open owner questions

- OQ-1 Which «other receipt / payment» purposes and which counterpart accounts are authorised (owner capital, loan,
  misc. income, drawings, bank fees …) and who may use them (permission)?
- OQ-2 Internal transfer: may a user start a cash ↔ bank transfer manually (new API entry on the existing transfer
  posting), or only by pairing imported bank lines?
- OQ-3 Does a credit note (sales/purchase return) reduce the invoice's remaining balance and status, and should the
  status then read «مسددة بإشعار دائن» rather than «مدفوعة بالكامل»?
- OQ-4 Default money account on a new voucher: keep the silent default (currently «الصندوق الرئيسي») or force a choice
  for bank methods?
