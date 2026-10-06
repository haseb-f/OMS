# SPEC C — Fixed assets and prepaid expenses

Audit: `audit/C-assets-prepaid.md`.

## References (official Odoo documentation)

- Odoo 18 — Non-current assets and fixed assets: https://www.odoo.com/documentation/18.0/applications/finance/accounting/vendor_bills/assets.html — assets are created from vendor bill lines (asset account / asset model); the depreciation board generates **all entries in draft**, and a daily server action posts each entry when its date arrives; methods Straight line / Declining / Declining then straight line; modify / pause / dispose / sell.
- Odoo 18 — Deferred expenses and revenues: https://www.odoo.com/documentation/18.0/applications/finance/accounting/customer_invoices/deferred_revenues.html (expense counterpart under vendor bills) — start/end dates on the bill line generate deferral entries on validation; computation by months / days / full months.
  (Direct fetch of odoo.com is blocked by this environment's egress policy; facts above are from the official pages' search abstracts.)

**Adaptation to OMS.** OMS keeps PENDING period rows (≙ Odoo draft entries) and creates the journal entry only when the period is due (Odoo creates draft moves up front). This keeps the journal free of unposted future moves; the schedule screen shows the same information. Monthly periods, last period absorbs rounding (existing math).

## C1. Invoice ↔ asset links

**Current.** Purchase invoice line `treatment = FIXED_ASSET | PREPAID_EXPENSE` → on confirm the invoice JE debits Fixed Assets / Prepayments and `PurchaseLineRecognitionService` creates the asset / prepaid once (unique `purchaseInvoiceItemId`); the asset's own capitalization entry is skipped → no double capitalization. Manual assets capitalize against a receiving account or partner AP (opening / manual path). Invoice pages do not show links.

**Target.**

- Invoice editor / detail shows per line the linked asset / prepaid with a link.
- Asset / prepaid detail shows source invoice + line.
- From a DRAFT asset: **Link to purchase invoice line** — only lines with treatment FIXED_ASSET not yet linked (DRAFT invoice → adopted at confirm instead of creating a second asset; CONFIRMED invoice lines are always already linked). Guard: one line ↔ one asset (DB unique already).
- Acquisition value = line net amount × rate (recoverable tax excluded — VAT input is posted separately by the invoice); non-recoverable tax/other costs: open decision (D-C1).

## C2. Schedules

- `GET /fixed-assets/:id/schedule-preview` and `GET /prepaid-expenses/:id` include full schedule; preview available before capitalization/activation (dates, method, life, residual).
- Detail screens `/finance/fixed-assets/[id]`, `/finance/prepaid-expenses/[id]`: parameters, source documents, schedule table (period, date, amount, status, journal link, last error), accumulated / remaining amounts, actions (Capitalize/Activate, Process due now, Dispose).
- Lifecycle: future rows PENDING; daily cron `0 1 * * *` UTC posts rows with `periodEnd ≤ today (Cairo)`; manual **Process due entries** (`POST /accounting-schedules/run`, permission fixed-assets edit) runs the same code; posting engine idempotent per period id + row flips in same tx → retries never duplicate; missed runs catch up (all due rows); locked period → row stays PENDING with visible `lastError`.
- Disposal: posts catch-up depreciation for periods ending on/before the disposal date, then marks remaining rows **CANCELLED** (new enum value) — history preserved.
- Prepaid: `endDate` derived from start + periods (consistency); cancel of an ACTIVE prepaid is out of scope (open decision D-C2).

## Migration

`AccountingScheduleStatus` += `CANCELLED`. No data rewrite.

## Adopted rules (R13b — owner decisions O-1, O-2, O-3, O-7, O-8)

All existing asset / prepaid rows are test data (owner): migration `20261007100000_r13b_asset_prepaid_corrections` corrects them (status / derived columns only, never a journal entry). Evidence: `evidence-C.md` § R13b.

**O-1 Purchase return of a FIXED_ASSET line.**

- Allowed only while the asset is CAPITALIZED with **no posted depreciation** and no added costs, and only for the **whole** invoice line at its invoiced price / discount / tax (an asset is one unit of account). The return JE credits **Fixed Assets** for the line amount (net + capitalized non-recoverable tax) — the mirror of the invoice debit — and is the derecognition: the asset becomes DISPOSED, linked to the return (`purchaseReturnId`, notes "Returned to supplier — Purchase Return …"), every PENDING period is CANCELLED, no disposal entry is posted. A return of a capitalized / deferred line is booked at the invoice's exchange rate.
- Asset with posted depreciation → the return is refused (400: dispose the asset to the supplier instead). **Dispose → supplier credit** (`counterpartyPartnerId`): the disposal entry debits the supplier's payable (partner-tagged) instead of a receiving account; gain / loss is computed as for cash proceeds.
- Re-checked under the asset row lock when the return is confirmed; the returnable summary tells the UI why a line cannot be returned.

**O-2 Non-recoverable tax and directly attributable costs (IAS 16).**

- `Tax.isRecoverable` (default true, tax master form). On a FIXED_ASSET line, non-recoverable tax is part of the asset cost (Dr Fixed Assets, never VAT Input); recoverable tax stays VAT Input. Other line treatments are unchanged.
- **Cost addition**: a later FIXED_ASSET invoice line may reference an existing Draft / Capitalized asset (`linkedFixedAssetId`, line options → "Add to existing asset"). At confirm the invoice JE debits Fixed Assets (as for any asset line) and the asset cost grows (`fixed_asset_cost_additions`, one row per invoice line — never twice, never a second asset). For a capitalized asset the remaining PENDING periods are re-spread prospectively: (new cost − accumulated depreciation − salvage) over the same remaining periods with the asset's method, last period absorbs rounding; posted periods are never touched. A capitalized asset with no PENDING period cannot take an addition. A Draft asset's own capitalization entry excludes its added costs.

**O-3 Early closing of an ACTIVE prepayment** (detail page actions, permission `prepaid-expenses.edit`). Both first post every recognition due by the action date (a locked month refuses the whole action), then remaining = amount − recognized, PENDING rows → CANCELLED (history kept); the action date may not precede the last posted period; a repeated identical action changes nothing.

- **Cancel with refund** → CANCELLED: Dr supplier payable (partner) or Dr the receiving account (cash refund received) / Cr Prepayments (`PREPAID_REFUND`, sourceId = prepaid id).
- **Recognize remaining now** → COMPLETED: Dr the prepayment's expense account / Cr Prepayments, dated the action date (`PREPAID_ACCELERATION`).
- **Purchase return** of the deferring invoice line: the returned amount (≤ unrecognized balance, else refused) is reclaimed by the return JE (Cr Prepayments); any unrecognized excess is expensed (`PREPAID_ACCELERATION`); status CANCELLED, linked to the return.

**O-7 Disposal month — full-month convention (adopted).** Catch-up depreciation stops at the last period whose end date is on or before the disposal date; no pro-rata days (disposed 20 March → depreciated through February; March CANCELLED).

**O-8 Schedule rows that can never post** (PENDING periods of DISPOSED / archived assets, PENDING recognitions of CANCELLED / COMPLETED prepayments) are CANCELLED by the R13b migration; it also removes unposted rows left on Draft assets, derives prepaid end dates, completes ACTIVE prepayments whose rows are all posted and realigns accumulated / recognized totals with the POSTED rows. Read-only check: `proposals/asset-prepaid-corrections-check.sql`.
