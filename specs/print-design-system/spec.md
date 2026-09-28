# Print Design System — spec and plan

Status: **implemented, pending print review** (started 2026-09-28; plan steps 1–5 done and
local gates green on 2026-09-28 — steps 6–7 (rendered-PDF review, release) outstanding; see
`verification.md`). Prior baseline: approved UI rollout released and verified at Production `93fc9ee`.

## 1. Current state (inventory)

| Area                                                                    | Today                                                                                                                                                                                                                                                                               | Gap                                                                                                                                                                   |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine                                                                  | `usePrintEngine()` → `lib/print-bridge.ts` (localStorage job) → isolated `/print/document` and `/print/list` routes (no app shell). `PrintPage` sets `@page` A4 + margins, page numbers in `@page` margin boxes, repeats `<thead>`, avoids row splits. Auto-opens the print dialog. | No A5; no preview toolbar or printer guidance; no shared print tokens; app pages printed with Ctrl+P show the whole shell.                                            |
| Commercial documents (sales/purchase invoice, quotation, order, return) | One generic layout via 10 builders in `config/{sales,purchasing}/*-print.ts`                                                                                                                                                                                                        | Currency empty; no discount / tax columns; no payment status on invoices; the "bill to" label is the picker placeholder («اختر عميلاً»); no document-specific titles. |
| Quotation                                                               | Same generic layout                                                                                                                                                                                                                                                                 | No validity field exists in the data model (not invented); customer notes are the only commercial terms.                                                              |
| Statements (customer / supplier detail "Print statement")               | Balance only, no transactions                                                                                                                                                                                                                                                       | Partner statement data exists (`GET /accounting/reports/partner-statement`, full, unpaged) but is not used.                                                           |
| Financial reports                                                       | Report builder → `toReportPrintPayload` → list template; filters/period flattened into one subtitle line                                                                                                                                                                            | Paged reports (General Ledger, Journal report, investor ledgers) print only the current page.                                                                         |
| Lists (`EnterpriseDataTable`)                                           | Client mode prints every filtered row                                                                                                                                                                                                                                               | Server mode (29 list pages) prints only the loaded page.                                                                                                              |
| Receipts / payment / journal vouchers                                   | Generic layout (+ ledger table for JV)                                                                                                                                                                                                                                              | Adopt the shared foundation.                                                                                                                                          |
| Store orders                                                            | List print only                                                                                                                                                                                                                                                                     | No document print; no package slip.                                                                                                                                   |

## 2. Foundation

- **Print tokens** (`theme/print.css`, scoped to `[data-print-sheet]`): ink `#111`, muted `#555`,
  rule `#cfcfcf`, strong rule `#8a8a8a`, a single accent = company brand color (falls back to
  the primary navy); type in pt (title 15, section 10.5, body 9.5, table 9 / compact 8.5, micro
  7.5); spacing on a 2 mm rhythm. White background; everything must read in monochrome (accents
  are never the only carrier of meaning).
- **Paper**: `PrintPage` takes `paper: "A4" | "A5"` + orientation. A4 margins 12 / 12 / 16 mm,
  A5 8 / 8 / 10 mm. Page X of Y and the generated-by line stay in `@page` margin boxes.
- **Blocks** (`components/print/blocks.tsx`): `PrintDocumentHeader` (logo, company, title,
  number, date), `PrintInfoGrid` (label / value pairs), `PrintPartyBlock`, `PrintTable`
  (repeating header, rows never split, long text wraps, numeric cells LTR tabular),
  `PrintTotals`, `PrintNotes`, `PrintInstruction` (high-contrast boxed instruction for slips).
- **Preview-first**: `/print/*` opens as a preview with a screen-only toolbar — «طباعة / حفظ PDF»
  (same rendering for paper and Save as PDF), the paper size, and printer guidance the browser
  cannot enforce (scale 100% / Actual size, headers & footers off, A5 paper for slips).
- **Safety net**: an `@media print` rule hides the app shell (sidebar, top bar, buttons) if an app
  page is printed with Ctrl+P.
- Printing never calls a mutating API; it only reads data the user can already see (same
  permissions). Internal notes are never printed on customer-facing documents.

## 3. Templates

- **Commercial document** (invoice, quotation, sales order, returns, purchase documents): party
  block with the right role label (Customer / Supplier), document meta (number, date, reference,
  payment term), item table `# · item (+ SKU) · qty + unit · unit price · discount · tax · total`,
  totals with currency (subtotal, discount, tax, grand total), invoice payment status
  (server-computed status, paid, remaining), customer notes as terms, QR to the record.
  Portrait A4; landscape only if a table needs it.
- **Account statement** (customer / supplier): partner identity, period, opening balance, dated
  movements (date · reference · description · debit · credit · running balance), period totals,
  closing balance. A4 portrait (6 columns fit). Data: the partner statement API, full dataset.
- **Financial reports**: header meta block (period, currency, basis, every active filter),
  hierarchy styles (existing row kinds), subtotals and final totals; A4 landscape. Paged reports
  fetch every page before printing.
- **Lists**: complete dataset — server-mode tables fetch all matching rows (bounded, with the row
  count stated on the sheet).
- **Vouchers** (receipt, payment, journal): same header/party/totals blocks.

## 4. Store-order package slip (A5 portrait)

Opened from a «طباعة / Print» menu on the store-order detail page. One A5 page at actual size;
long orders continue on a second sheet with a «continued» header (items never clipped, text never
shrunk below 8 pt).

Content: company identity; order number (large) and date; customer name and phone; for SHIPPING
the address and delivery notes; for PICKUP a full-width «استلام من المقر — لا يُشحن / PICKUP — DO
NOT SHIP» band and no shipping fields; compact item list (product, SKU, qty); payment type
(PREPAID / CASH ON DELIVERY); the collection instruction; a QR that opens the order in OMS (a real
identifier with a working use: staff scan to open the order). No tracking number is printed unless
the order's shipment already has one from the carrier (the carrier label workflow is unchanged).

**Collection instruction** — derived only from existing rules (fulfillment gate
`store-order-fulfillment-gate.ts`, declared amount from standing claims):

| Case                                                               | Instruction                                                                                                                                                      |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CASH_ON_DELIVERY                                                   | «يُحصّل مبلغ X CUR / Collect X CUR», X = order total − declared amount (standing PENDING/MATCHED/VERIFIED claims), floored at 0; «لا يُحصّل مبلغ» when X = 0.    |
| PREPAID, gate allowed (declared PAID in full, or Finance-verified) | «لا يُحصّل مبلغ / No collection required». Basis shown: «مُبلَّغ بالدفع (بانتظار تحقق المالية)» vs «تحققت المالية» — a declaration is never labelled reconciled. |
| PREPAID, gate not allowed (unpaid / partial declaration)           | «الدفع غير مكتمل — لا يُسلَّم قبل تأكيد الدفع / Payment not confirmed — do not hand over». No collect amount is invented.                                        |

The outstanding accounting balance (invoices, Finance verification) is never used as the courier
amount.

## 5. Validation

Rendered PDF output (Playwright `page.pdf` with the CSS page size, inspected through the Edge PDF
viewer) for: Arabic and English; short and multi-page reports; long names; invoice and quotation
totals; prepaid-paid / prepaid-unpaid / partial / COD / COD-with-deposit / pickup slips; A4
portrait, A4 landscape, A5 actual size; monochrome (grayscale render); no clipping, blank
overflow pages or hidden rows. Local or tagged demo records only. Evidence: `tmp/print/` +
checklist in `verification.md`.

## 6. Plan

1. Foundation: tokens, `PrintPage` paper sizes, blocks, preview toolbar, shell safety net.
2. Commercial template + types; update the 10 builders.
3. Statement template; customer/supplier detail pages fetch the partner statement.
4. Report template meta block; paged reports and server-mode lists print the full dataset.
5. Package slip (payload, template, `/print/slip`, store-order Print menu, instruction rule +
   unit tests).
6. Print review (rendered PDFs), independent code review, fixes.
7. Gates (tsc, lint, tests, both builds), release, Production print verification, user guide.
