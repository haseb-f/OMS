# Inventory — Financial & Operational Reports (INV-REPORTS)

Scope: every report route, the shared financial-report system, print/export, money formatting.
All paths relative to `apps/web/src/` unless noted. Read-only survey; line numbers as of 2026-09-27.

---

## 1. Report routes

### 1.1 Finance reports — `/reports/finance?report=<key>` (one page, 12 reports)

Page: `app/(shell)/reports/finance/page.tsx` (report picker = `SearchableSelect`, `?report=` in URL via `useReportUrlParam`, gate `reports.financial.view`). Filters via `use-report-query.ts` (local state, **not** in URL — only `report`/`view`/`partner` are).

| Report (`?report=`)                     | Tab file                                         | Shared system?                                                               | Notes                                             |
| --------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------- |
| trialBalance (default)                  | `trial-balance-tab.tsx`                          | `FinancialReport` + summary + check + footer                                 | opening toggle                                    |
| generalLedger                           | `general-ledger-tab.tsx` + `ledger-lines.tsx`    | `FinancialReport` + textColumns + summary + check + footer + pagination      | also a nav entry (`navigation.config.ts:590-599`) |
| journalReport                           | `journal-report-tab.tsx`                         | `FinancialReport` (flat postings) + **bespoke `<table>` in modal** (116-147) | no footer/check                                   |
| accountStatement                        | `account-statement-tab.tsx` + `ledger-lines.tsx` | `FinancialReport` + textColumns                                              | **no summary, no footer**                         |
| balanceSheet                            | `balance-sheet-tab.tsx`                          | `FinancialReport` + summary + check                                          |                                                   |
| incomeStatement                         | `income-statement-tab.tsx`                       | `FinancialReport` + toned summary                                            |                                                   |
| cashFlow (`?view=activities\|movement`) | `cash-flow-tab.tsx`                              | `FinancialReport` + summary (+ footer in movement view)                      | ToggleGroup in toolbar                            |
| cashAvailability                        | `cash-availability-tab.tsx`                      | **Bespoke** raw `<table>`; only reuses `AccountingReportFilterBar`           | no export/print                                   |
| arAging / apAging                       | `aging-tab.tsx`                                  | `FinancialReport` (synthetic section + grand_total)                          | no summary, no drill                              |
| customerStatement / supplierStatement   | `partner-statement-tab.tsx` + `ledger-lines.tsx` | `FinancialReport` + textColumns + summary                                    | `?partner=` in URL                                |

`shared.tsx` = `MoneyCell` (thin `ReportMoney` wrapper, used only by journal modal) + `toExportRows` (**unused** — duplicate of the one in `reports/inventory/page.tsx:38-45`).

### 1.2 Other `/reports/*` routes

| Route                                                                                                    | File                                     | State                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/reports/customers`                                                                                     | `app/(shell)/reports/customers/page.tsx` | Tabs: `AgingTab side=AR` + `PartnerStatementTab CUSTOMER`                                                                                          |
| `/reports/suppliers`                                                                                     | `app/(shell)/reports/suppliers/page.tsx` | **Byte-for-byte clone** of customers page (only AR→AP/labels differ)                                                                               |
| `/reports/inventory`                                                                                     | `app/(shell)/reports/inventory/page.tsx` | 5 tabs on `EnterpriseDataTable` (movements, valuation, current stock, negative stock, warehouse balance); CSV via `exportRowsToCsv`, print via EDT |
| `/reports/sales`, `/crm`, `/purchasing`, `/expenses`, `/shipping`, `/executive`, `/analytics`, `/custom` | each `page.tsx` (14 lines)               | `ComingSoonPage` stubs                                                                                                                             |

### 1.3 Report-like screens outside `/reports`

| Screen                                      | File                                                                                                 | Rendering                                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Management P&L                              | `app/(shell)/expenses/cost-explorer/page.tsx:350-525` (`ManagementPnlTab`)                           | **Bespoke** shadcn `Table`, parentheses negatives, CSV via `exportRowsToCsv`, no print                       |
| Profitability analytics                     | same file `:540-700`                                                                                 | bespoke `Table`, `formatMoneyShared`                                                                         |
| Order cost trace                            | same file `:96-330`                                                                                  | bespoke `Table`, local browser-locale `formatMoney` (58-64)                                                  |
| Stock (operational)                         | `app/(shell)/inventory/stock/page.tsx`                                                               | `EnterpriseDataTable`, local `formatMoney` (47-51)                                                           |
| Bank transactions / cash flow workspace     | `app/(shell)/finance/bank-transactions/page.tsx`                                                     | EDT-based; local `formatMoney` (105-108)                                                                     |
| Payment reconciliation                      | `components/payments/reconciliation/*` (`currency-totals.tsx`, `statement-lines-table.tsx`)          | workspace, not a report                                                                                      |
| Carrier reconciliation                      | `app/(shell)/finance/carrier-reconciliation/page.tsx`                                                | `EnterpriseDataTable`                                                                                        |
| Investor ledger (internal)                  | `app/(shell)/investors/list/[id]/investor-ledger-tabs.tsx` (ProfitsTab 33-100, StatementTab 103-190) | **bespoke raw `<table>`**                                                                                    |
| Investor portal statement                   | `app/investor/(app)/statement/page.tsx`                                                              | shadcn `Table` + `PortalStatCard` summary                                                                    |
| Investor portal profits                     | `app/investor/(app)/profits/page.tsx`                                                                | shadcn `Table`                                                                                               |
| Customer/Supplier profile "statement" print | `app/(shell)/sales/customers/[id]/page.tsx:150-205`, `purchasing/suppliers/[id]/page.tsx:~170-195`   | `printDocument({variant:"statement"})` — balance-only, **no lines**; a second, divergent "statement" concept |

---

## 2. The shared financial-report system (`components/accounting/financial-report/*`)

Files: `types.ts`, `financial-report.tsx` (shell), `financial-report-table.tsx` (grid), `financial-report-summary.tsx` (strip), `report-money.tsx` (cell), `line-label.ts` (label resolution), `financial-report-export.ts` (export/print doc), plus `components/accounting/report-filter-bar.tsx` and `lib/report-export.ts`.

### 2.1 Data model (`types.ts`)

- `FinancialReportLine { id, parentId, kind, level, code?, label, labelEn?, values: Record<string,number>, text?: Record<string,string>, children[] }` — a tree.
- `kind` ∈ `section | group | posting | subtotal | section_total | opening | closing | grand_total | result | spacer` (3-13).
- `FinancialReportColumn { key, labelKey, emphasize?, signed? }` (49-55) — `signed` defaults to false only for keys literally `debit`/`credit` (`financial-report-table.tsx:66-69`).
- `FinancialReportTextColumn { key, labelKey, width?, hideBelow?: "md"|"lg", render? }` (39-47).
- `FinancialReportSummary { items: {label,value,emphasize?,tone?: revenue|expense|result}[], check?: {balanced,difference,label} }` (66-80).
- Tree built by API (`apps/api/src/accounting/reports/accounting-reports.service.ts`, `buildAccountForest`) for TB/BS/IS/CF; client-built for GL/statements (`ledger-lines.tsx:48-117`), aging (`aging-tab.tsx:52-104`), journal (`journal-report-tab.tsx:51-68`).

### 2.2 Rendering

- **Row hierarchy** — `rowClass(kind)` `financial-report-table.tsx:39-58`:
  - section: `bg-muted/40 font-semibold border-t`
  - group (COA parent): `font-medium`
  - posting (detail): plain
  - subtotal: `font-medium border-t`; section_total: `font-semibold border-t`
  - grand_total / result: `bg-muted/40 font-semibold border-t-2 border-double border-foreground/50`
  - opening / closing: `font-medium text-muted-foreground`
- Indent: `paddingInlineStart: level * 1.1rem` (165) — logical, RTL-safe.
- **Expand/collapse**: chevron button per node with children (167-185), `ChevronRight rtl:rotate-180`, `aria-expanded`. Initial state `defaultExpanded`: `auto` = sections + groups level ≤ 2 (`types.ts:123-135`), `none`, `all`. Toolbar Expand all / Collapse all (`financial-report.tsx:183-204`). State resets whenever `lines` identity changes (102-111).
- **Parent value while expanded** rendered `quiet` (muted) to avoid double reading (`financial-report-table.tsx:217-221`).
- **Totals emphasis**: `TOTAL_KINDS = section_total, grand_total, result` → `font-semibold` money (60, 213). `subtotal`, `closing`, `opening` are NOT in it.
- **Footer**: optional `<TableFooter>` “Totals” row with double top border (231-254). Used by TB, GL, CF-movement only.
- **Drill-down**: only `kind === "posting"` rows, only if `onPostingClick` (153-160) → `tr onClick` + `cursor-pointer`. GL/Account/Partner statements open the Journal Entry (`useOpenFullRecord`); ledger text columns carry `RelatedRecordLink` for JE and source doc (`ledger-lines.tsx:136-212`). Journal report opens a modal. TB/BS/IS/CF/Aging have **no** drill-down.
- **Columns / layout**: `table-fixed`, name col auto, text cols `width` rem, amount cols fixed `w-[8.5rem]` (107-119); `minWidth: calc(16rem + text + n*8.5rem)` (105). Single `CELL_X = "px-3"` for header/body/footer (64). Amount headers `text-end` (136).
- **Sticky header**: `TableHeader sticky top-0 z-10 bg-card` (120) — see defect D3.
- **Horizontal scroll**: wrapper `div.financial-report-print.overflow-x-auto` (102) **plus** `ui/table.tsx:9` container `overflow-x-auto` (double container); outer `ListSurface` is `overflow-hidden` (`list-surface.tsx:22`). `financial-report-print` class is defined nowhere in CSS.
- **Label resolution**: `resolveFinancialLineLabel` (`line-label.ts:40-61`) — structural ids translated from dictionary, `net-income` flips Net Profit/Net Loss by sign, `cf:` rows use journal source-type names, else `label`/`labelEn` by locale. Used by screen, export and print.

### 2.3 Money cell (`report-money.tsx:12-50`)

- `block w-full text-end tabular-nums whitespace-nowrap`; digits in `<span dir="ltr" unicode-bidi:isolate>` so the block keeps page-direction alignment → header/body/footer share the same end edge in RTL and LTR. Good.
- Format: `value.toLocaleString(undefined, {min/max 2 decimals})` (46) — **browser/OS locale**, not app locale.
- Zero (|v| < 0.005) → “—” muted, normal weight (26, 40, 44-45).
- Negative (signed columns) → leading minus **and** `text-destructive` (27-28, 38). No parentheses, no Dr/Cr.
- `emphasize` → semibold; `quiet` → muted unless negative.
- No currency code/symbol anywhere in the report grid.

### 2.4 Summary strip (`financial-report-summary.tsx`)

- Grid `grid-cols-2 sm:auto-fit minmax(11rem,1fr)` under the toolbar, `bg-muted/20` (79).
- Tile: `border-s-[3px]` accent + soft bg by tone (27-33): revenue = `report-revenue` (blue, `globals.css:150`), expense = `report-expense` (orange, :152), result → profit green (:154) / loss red (:156) / neutral by sign. Values `tabular-nums`, LTR-isolated; zero shows `"0.00"` (62). `emphasize` adds `ring-1`.
- Balance check = last tile, `role="status"`, CheckCircle/TriangleAlert, “Balanced” or “Unbalanced by X” with `Math.abs(difference)` (83-121). Used by TB (debits=credits), BS (assets=L+E), GL (only when no account filter, `general-ledger-tab.tsx:160-167`).
- Hidden while loading (`financial-report.tsx:227`).
- Which reports use it: TB, GL, BS, IS (toned), CF (result tone on net change), Partner statement. **Not**: Account statement, Journal, Aging, Cash availability (bespoke).

### 2.5 Toolbar & filters

- `AccountingReportFilterBar` (`report-filter-bar.tsx:45-164`): optional AccountPicker, Company, Branch, Cost Center, Project, Currency (`SelectFilter`s), `EnterpriseDateRangePicker`, Posted-only checkbox. One bar for all finance tabs.
- `FinancialReport` toolbar: `toolbarExtra` (cash-flow view toggle, GL account multi-filter, partner picker), include-opening checkbox, Expand/Collapse, Export ▾ (Excel, CSV), Print (`financial-report.tsx:164-226`).

### 2.6 Export (`financial-report-export.ts` → `lib/report-export.ts`)

- One `ReportExportDocument` built from the (visible, or all if `exportAllLines`) lines (`financial-report.tsx:130-144`): title, direction, meta (company, period, printed at/by), columns `code`, `account`, text cols, numeric cols; rows carry `level` + `emphasize`; footer → `totals`.
- XLSX (`report-export.ts:105-182`): exceljs lazy-loaded, RTL sheet view for Arabic, frozen header, `#,##0.00;-#,##0.00` number format, raw numbers, level → Excel indent, emphasized rows bold, totals row double top border. Landscape fit-to-width page setup.
- CSV (80-97): BOM, `toFixed(2)` ungrouped numbers, **no hierarchy indent**, no emphasis.
- Locale: labels translated in the active language; numbers raw. **Filters other than period are not written** (no branch, cost center, project, currency, posted-only). Summary tiles and the balance check are **not exported**.
- Formats: XLSX + CSV only; PDF = browser print of the print route.

### 2.7 Print (`toReportPrintPayload` → `usePrintEngine().printList` → `components/print/templates/generic-list-print-template.tsx`)

- `ReportPrintTemplate` = `ListPrintTemplate` (140-173): `PrintPage` A4 landscape (`print-page.tsx:108-111`), `PrintCompanyHeader` (logo, company, title, printed at/by), subtitle = period only (`financial-report-export.ts:150-153`), `PrintTable`, `PrintFooter` with page X of Y (`print-footer.tsx`, `print-page.tsx:116-120`).
- `PrintTable` (`print-table.tsx:19-73`): dark slate header, **zebra striping**, full borders, `text-end tabular-nums` for numeric columns, compact density when > 7 columns. Rows are `Record<string,string>` — **no level, no emphasis, no tfoot**.
- Amounts formatted `en-US` (`financial-report-export.ts:113-118`), zeros print as `0.00`, negatives `-1,234.00`.
- Totals row is pushed as a normal body row with the label in the first column (`code`, 137-145).

---

## 3. Defects vs target (cite file:line)

### Alignment (RTL + LTR)

- **D1** Cash availability: `dir="ltr"` placed on the `<td>` itself (`cash-availability-tab.tsx:108, 111, 114, 117, 120, 123`) — flips `text-end` to the physical right in RTL while the header `th.text-end` (69-83) sits left → header/value misalignment in Arabic. The shared `TableCell` explicitly warns against this (`components/ui/table.tsx:68-73`).
- **D2** Money columns start-aligned (no `text-end`/`tabular-nums`): Management P&L (`cost-explorer/page.tsx:426-470`, 486-500), order trace tables (207-296), profitability (665-671); investor portal statement (`app/investor/(app)/statement/page.tsx:125-141`), portal profits (`profits/page.tsx:51-67`); internal investor ledger (`investor-ledger-tabs.tsx:58-62, 81-83, 139-140, 155-158`); journal modal code cell not LTR-isolated (`journal-report-tab.tsx:135`).
- **D3** Sticky header ineffective: `sticky top-0` (`financial-report-table.tsx:120`) sits inside two nested `overflow-x-auto` boxes (`financial-report-table.tsx:102` and `ui/table.tsx:9`) inside `overflow-hidden` `ListSurface` (`list-surface.tsx:22`) — the sticky context is the inner non-vertically-scrolling box, so the header scrolls away on long GL/TB pages. Redundant double scroll container.
- **D4** Fixed 8.5rem amount columns + `whitespace-nowrap` under `table-fixed` (`financial-report-table.tsx:105, 117`; `report-money.tsx:34`): ≥ 1,000,000,000.00-scale values and 5-column CF-movement/aging can overflow into the neighbour cell; no measured width.
- **D5** Management P&L puts `flex` on a `<td>` (`cost-explorer/page.tsx:437` `TableCell className="flex items-center gap-2"`) → breaks table-cell layout for that row; badge mixed into the amount cell.

### Hierarchy (section / parent / detail / subtotal / grand total)

- **D6** `section` and `grand_total/result` share the same `bg-muted/40 font-semibold` (`financial-report-table.tsx:42, 50-51`) — a section heading and the final total differ only by the double border; headings carry amounts too.
- **D7** `result` kind is reused for an in-section line: Balance Sheet “Current Earnings (unclosed)” (`apps/api/.../accounting-reports.service.ts:537-545`, kind `result`, level 1) renders with grand-total styling (double border + bg) in the middle of Equity.
- **D8** Ledger `closing` row — the key final figure of each GL/statement block — is styled muted (`financial-report-table.tsx:52-54`) and not in `TOTAL_KINDS` (60), while the money inside is forced `text-foreground` (`report-money.tsx:34`) → label muted, value not bold; inverted emphasis.
- **D9** `subtotal` not emphasized in money (`TOTAL_KINDS` excludes it, 60) while its row is `font-medium`; weight on label ≠ weight on value.
- **D10** Aging builds a `section` whose values equal the `grand_total` directly below (`aging-tab.tsx:70-103`) → the same totals appear twice (quiet when expanded, loud when collapsed). Totals built via a fake `AgingPartnerRow` (30-39).
- **D11** Journal report rows: flat `posting` list, label is a concatenated string with **raw untranslated `sourceType` enum** (`journal-report-tab.tsx:59`); no totals footer and no debits=credits check although it is the natural control; silently truncates at `pageSize: 200` (35) with no notice.
- **D12** Print loses all hierarchy: `toReportPrintPayload` drops `row.level`/`row.emphasize` (`financial-report-export.ts:126-136`); `PrintTable` has only zebra stripes (`print-table.tsx:55`) — no indent, no bold subtotals, no double-ruled grand total, totals row printed as ordinary body row with label in the narrow `code` column (137-145). CSV also loses indent (`report-export.ts:87-93`).

### Numbers: digits, zeros, negatives, currency

- **D13** `ReportMoney` and the summary format with the **browser locale** (`report-money.tsx:46`, `financial-report-summary.tsx:35-37`) whereas export/print use `en-US` (`financial-report-export.ts:117`) and `lib/money.ts:9` uses `en-US`. On an `ar-EG`/`de-DE` browser the screen shows Arabic-Indic or `1.234,50` digits while print shows `1,234.50`. The project’s own comments flag this pattern as wrong (`components/accounting/journal-entry-lines-grid.tsx:5`, `components/sales/document-totals-footer.tsx:4`). Also a hydration-mismatch risk.
- **D14** Zero handling inconsistent: grid “—” (`report-money.tsx:45`), summary “0.00” (`financial-report-summary.tsx:62`), print “0.00” (`financial-report-export.ts:132`), XLSX `0.00`, investor portal statement empty string (`statement/page.tsx:138-141`) vs internal investor ledger “—” (`investor-ledger-tabs.tsx:155-158`).
- **D15** Negative semantics = minus + red on every signed cell (`report-money.tsx:27-38`). Because TB/GL/statements are debit-positive (`accounting-reports.service.ts:375-379`), **every credit-normal account (liabilities, equity, revenue) and every supplier balance renders red** in TB closing, GL running balance and supplier statement — red communicates “credit balance”, not “problem”, and colors many body cells. No Dr/Cr or parentheses option; `signed` inferred only from key names `debit`/`credit` (`financial-report-table.tsx:66-69`).
- **D16** Negative convention differs by screen: minus+red (financial reports), parentheses without sign (Management P&L `cost-explorer/page.tsx:430-458`) while its CSV exports negative numbers (381-400), `-#,##0.00` in XLSX (`report-export.ts:45`).
- **D17** Net loss double-signals: label switches to “Net Loss” (`line-label.ts:47-50`) **and** the value keeps its minus + red.
- **D18** No currency indication in any financial report grid, summary, export meta or print subtitle, although a Currency filter exists (`report-filter-bar.tsx:135-145`) and the functional currency is EGP. Cash availability, by contrast, suffixes every cell with the code (`cash-availability-tab.tsx:112-126`).

### Summary strip / balance check

- **D19** Meaningless emphasized summary figures: TB “Closing balance” total (`trial-balance-tab.tsx:85-89`) and GL “Opening/Closing” totals (`general-ledger-tab.tsx:151-157`) are the net of all accounts (≈ 0 when balanced) — the emphasized tile is the least informative number.
- **D20** Summary coverage inconsistent: Account statement has no summary and no footer (`account-statement-tab.tsx:73-104`) while Partner statement has a summary (143-161) and GL has summary+footer; Aging has neither summary nor bucket totals strip; Journal has no check.
- **D21** Cash availability: warning `EnterpriseBadge` floating above the table (`cash-availability-tab.tsx:48-57`) with `result.limitations[1]` hard-indexed (54); totals rendered as a loose caption strip outside the table (135-154) instead of a footer/summary.
- **D22** Balance check hidden in GL whenever any account is filtered (`general-ledger-tab.tsx:161`) — correct logically, but the tile silently disappears rather than stating “not applicable”.
- **D23** Summary uses `key={item.label}` (`financial-report-summary.tsx:81`) — collides if two tiles share a label.

### Drill-down & interaction

- **D24** No drill from TB / BS / IS / CF account rows to the account statement or GL; Aging partner rows do not open the partner statement (`aging-tab.tsx:106-122`, no `onPostingClick`).
- **D25** Drillable rows are `tr onClick` only (`financial-report-table.tsx:155-161`) — not focusable, no role/keyboard activation.
- **D26** Expansion state resets on every `lines` change (`financial-report.tsx:102-111`), e.g. any filter change collapses what the user opened.

### Filters / export / print fidelity

- **D27** Cash availability shows the full filter bar but only uses `dateTo` + `currencyId` (`cash-availability-tab.tsx:26-29, 46`): Company/Branch/Cost-center/Project/Posted-only are displayed and ignored.
- **D28** Export meta and print subtitle omit every filter except period (`financial-report-export.ts:58-73, 150-153`); summary tiles and the balance check are not exported/printed.
- **D29** Print prints only currently expanded lines for statements (TB/BS/IS/CF) (`financial-report.tsx:133`) — output depends on UI expansion state, with no indication.
- **D30** Bespoke reports lack the shared toolbar: Cash availability (no export/print), Management P&L (CSV only via `exportRowsToCsv`, no print), investor statements (no export/print, no opening/closing/running balance), inventory reports (CSV of **pre-formatted strings** via `exportRowsToCsv`, not the report-export engine: `reports/inventory/page.tsx:179-185, 320-331`).
- **D31** Inventory valuation has no total stock value; negative stock is red+bold only (`reports/inventory/page.tsx:218, 274`); quantities unformatted.
- **D32** Two “customer statement” concepts: the profile print (`sales/customers/[id]/page.tsx:150-205`, balance only, `lineItems: []`) vs the JE-based Partner Statement report.

### Code-quality / duplication

- **D33** `/reports/customers` and `/reports/suppliers` pages are clones (43 lines each) — should be one component parameterized by role.
- **D34** `toExportRows` duplicated (`reports/finance/shared.tsx:12-19`, unused; `reports/inventory/page.tsx:38-45`); `MoneyCell` wrapper exists only for the journal modal.
- **D35** Class-name inconsistency in the toolbar: Posted-only uses `text-sm` (`report-filter-bar.tsx:153`) vs include-opening `text-caption` (`financial-report.tsx:174`); dead class `financial-report-print` (`financial-report-table.tsx:102`).

---

## 4. Number / money formatting utilities

| Utility                                                | Location                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Locale                                              | Used by                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `formatMoney(value, currencyCode?)`                    | `lib/money.ts:6-13`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | fixed `en-US`, 2 dp, optional ` CODE` suffix        | ~59 files (investor portal, cash availability, cost explorer P&L via `formatMoneyShared`, sales/doc editors) |
| `ReportMoney`                                          | `components/accounting/financial-report/report-money.tsx:46`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **browser default**                                 | all `FinancialReport` grids                                                                                  |
| summary `formatAmount`                                 | `financial-report-summary.tsx:35-37`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **browser default**                                 | summary strip                                                                                                |
| print `formatAmount`                                   | `financial-report-export.ts:113-118`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `en-US`                                             | report print                                                                                                 |
| `MONEY_FORMAT` / `toFixed(2)`                          | `lib/report-export.ts:45, 70`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | n/a (raw)                                           | XLSX / CSV                                                                                                   |
| `CurrencyDisplay`                                      | `components/business/currency-display.tsx:8-26`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `Intl.NumberFormat` currency style, default `en-US` | 3 files                                                                                                      |
| Local shadow `formatMoney`/`toLocaleString(undefined)` | `reports/inventory/page.tsx:31`, `inventory/stock/page.tsx:47`, `expenses/cost-explorer/page.tsx:58`, `expenses/product-cost/page.tsx:24`, `finance/bank-transactions/page.tsx:105`, `sales/customers/[id]/page.tsx:42`, `purchasing/suppliers/[id]/page.tsx:38`, `components/financial-transactions/{allocation-grid,open-invoices-table,party-payments-panel,payment-summary,allocation-summary}.tsx`, `components/business/invoice-payment-summary.tsx:12`, `components/store-orders/order-profitability-panel.tsx:26`, `config/hr/{payroll,kpi-evaluations,sales-targets}.tsx`, … | **browser default**                                 | ~17 definitions                                                                                              |
| Bare `toLocaleString()` (0 dp, browser locale)         | `finance/accrued-expenses/page.tsx:66`, `finance/prepaid-expenses/page.tsx:71,79`, `config/master-data/entities.tsx:418,480,487`, `inventory/movements/page.tsx:275,289`                                                                                                                                                                                                                                                                                                                                                                                                              | browser                                             |                                                                                                              |

**Verdict:** reports do **not** share one formatter. The financial-report grid itself disagrees with its own print output (D13). Target: one `formatAmount(value, {currency?, zero?, negative?})` in `lib/money.ts` with a fixed Latin-digit locale, consumed by `ReportMoney`, the summary, print and every bespoke table.

---

## 5. Recommended shared API — one `FinancialReport` presentation system

Keep the current architecture (it is the right one) and harden it; everything below is additive to `components/accounting/financial-report/`.

### 5.1 Formatting core (`lib/money.ts`)

```ts
type NegativeStyle = "minus" | "parens" | "drcr";      // drcr = abs value + " Dr"/" Cr" (localized)
formatAmount(value: number, opts?: {
  decimals?: 2; currency?: string | null; negative?: NegativeStyle; zero?: "dash" | "zero" | "blank";
}): string                                              // always en-US digits
```

`ReportMoney`, summary, print payload and bespoke tables call only this.

### 5.2 Row kinds (closed set, each with one style token)

`section` (heading row: label only by default, `showValues?: false`) · `group` (COA parent, collapsible) · `posting` (detail) · `subtotal` · `section_total` · `opening` · `closing` (treated as a total, semibold) · `grand_total` (double rule + restrained bg) · `result` (final result only; add **`inline_result`** for in-section figures like Current Earnings) · `spacer`.
Styles live in one `ROW_STYLE: Record<kind, {row, label, money: "normal"|"quiet"|"strong"}>` so label weight and value weight never diverge (fixes D6-D9).

### 5.3 Column spec

```ts
interface FinancialReportColumn {
  key: string;
  labelKey: MessageKey;
  kind: "amount" | "balance" | "quantity" | "percent"; // drives format + width
  negative?: NegativeStyle; // default: amount→"minus", balance→"drcr" for TB/GL/statements
  emphasize?: boolean;
  minWidthCh?: number; // measured, replaces fixed 8.5rem
}
```

No more inferring `signed` from key names. Negatives: muted-destructive only for true exceptions (`tone: "exception"` opt-in), never for normal credit balances (D15).

### 5.4 Summary strip

```ts
interface FinancialReportSummary {
  items: {
    id: string;
    label: string;
    value: number;
    tone?: "revenue" | "expense" | "result" | "neutral";
    role?: "primary" | "secondary";
    hint?: string;
  }[];
  check?: {
    kind: "debits=credits" | "assets=L+E" | "custom";
    balanced: boolean;
    difference: number;
    label: string;
    notApplicableReason?: string;
  };
  currency?: string; // shown once in the strip header
}
```

Rendered as a fixed strip (primary figure(s) first, check as a dedicated segment with the exact discrepancy); `id` as key (D23). The same object is written to export meta and printed above the table (D28).

### 5.5 Shell props (additions)

`drill?: { posting?: (line)=>void; account?: (line)=>void }` (enables TB/BS/IS → account statement, aging → partner statement; rows rendered focusable with Enter/Space) · `preserveExpansion?: boolean` (keep expanded ids across refetch when ids persist) · `printScope: "visible"|"all"` (default "all" for statements, stated on print) · `notice?: ReactNode` (limitations/estimate banner slot inside the surface, replaces floating badges) · `filtersMeta` (resolved filter labels for export/print).

### 5.6 Print / export

- Extend `ReportExportRow` → print rows keep `level`, `kind`; `PrintTable` gets a `report` variant: indent on the name column, no zebra, bold subtotals, double-ruled grand total in `<tfoot>`, zero as “—”, same `formatAmount`.
- CSV: prefix indentation on the label column (e.g. two spaces per level) or a `level` column.
- Export meta: company, period, currency, branch, cost center, project, posted-only, summary figures, balance check.

### 5.7 Layout

Single scroll container (drop the wrapper div, pass `containerClassName` to `ui/table`), header sticky against the page scroll (`ListSurface` without `overflow-hidden`, or a `max-h` scroll region), measured amount widths.

### 5.8 Per-report migration notes

| Report                                                                                 | Migration                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trial Balance                                                                          | `closing` column `kind:"balance", negative:"drcr"`; replace “Closing balance” summary with Debit / Credit totals (+ opening check); add `drill.account` → account statement.                                                                            |
| General Ledger                                                                         | running balance `drcr`; closing rows strong; summary: period debit/credit primary, net opening/closing secondary or removed; check shows “n/a (filtered)” instead of disappearing.                                                                      |
| Account Statement                                                                      | add summary (opening/debit/credit/closing) + footer, same as Partner statement; share one `LedgerStatement` wrapper with GL/Partner.                                                                                                                    |
| Customer/Supplier Statement                                                            | supplier balance `drcr` (no red); unify with profile-page statement print (retire balance-only `printDocument` or make it call this report).                                                                                                            |
| Balance Sheet                                                                          | Current Earnings → `inline_result`; section rows label-only; add `drill.account`; currency in strip.                                                                                                                                                    |
| Income Statement                                                                       | keep tones; Net Loss shows absolute value (label carries the sign) or parentheses; `drill.account`.                                                                                                                                                     |
| Cash Flow                                                                              | ok; movement view inflow/outflow already unsigned — move to `kind:"amount"`; section rows label-only.                                                                                                                                                   |
| AR/AP Aging                                                                            | drop duplicate section; partner rows `drill` → partner statement; summary strip with bucket totals and over-90 share; aging buckets as `amount` columns.                                                                                                |
| Journal Report                                                                         | translate source type via `journalSourceLabelKey`; text columns (date, source, description) instead of concatenated label; footer + debits=credits check; truncation notice/pagination; modal lines via `FinancialReportTable` or `CompactDetailTable`. |
| Cash Availability                                                                      | port to `FinancialReport` (group per currency → accounts, section_total per currency, grand total EGP); `notice` slot for the estimate/limitations; restrict filter bar to supported filters (as-of date, currency) via a `filters` capability prop.    |
| Management P&L (cost explorer)                                                         | port to `FinancialReport` lines (revenue → COGS → gross profit subtotal → direct costs → contribution → opex → operating profit result); summary tones; GL reconciliation as a `check`; export/print via shared engine; delete local `formatMoney`.     |
| Inventory reports                                                                      | stay on `EnterpriseDataTable` (operational lists) but: use `lib/money.formatAmount`, valuation footer total, export numbers (not strings) through `lib/report-export`, `quantity` column kind.                                                          |
| Investor ledger (internal + portal)                                                    | adopt `ReportMoney`/`formatAmount` + end-aligned money columns at minimum; statement → ledger block (opening, running balance, closing) via `buildLedgerBlock` equivalent, with print/export.                                                           |
| `/reports/customers` + `/reports/suppliers`                                            | one `PartnerReportsPage({role})`.                                                                                                                                                                                                                       |
| Stub routes (sales, crm, purchasing, expenses, shipping, executive, analytics, custom) | when built, must start from `FinancialReport` (money reports) or `EnterpriseDataTable` + shared export (operational lists).                                                                                                                             |
