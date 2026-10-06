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
