# Audit C — fixed assets, prepaid, purchase-invoice links (2026-10-06)

Backend largely exists; web is list-only.

- `FixedAsset` (schema ~770): code (numbering `FIXED_ASSET`), cost, salvageValue, usefulLifeMonths, method STRAIGHT_LINE / DECLINING_BALANCE, depreciationStartDate, accumulatedDepreciation, status DRAFT / CAPITALIZED / DISPOSED, `purchaseInvoiceId?`, `purchaseInvoiceItemId?` @unique. No category, no per-asset accounts (global mapping). Stale doc comment ("no depreciation…").
- `FixedAssetDepreciationPeriod`: PENDING / POSTED, lastError, lastAttemptAt, `@@unique([fixedAssetId, periodStart])`.
- Schedule math `fixed-assets/depreciation-schedule.ts`: SL monthly, last month absorbs rounding; DDB switching to SL.
- Capitalize (`fixed-assets.service.ts:105`) rebuilds periods + posts `FIXED_ASSET_CAPITALIZATION` (skipped when invoice-linked → no double capitalization, provider:60). Depreciation run per period in own tx; failures recorded in `lastError`.
- Dispose posts derecognition but leaves remaining PENDING periods forever and does not catch up depreciation to disposal date. **Gap.**
- No schedule-preview endpoint. **Gap.**
- `PrepaidExpense` + `PrepaidRecognition` mirror the shape; status CANCELLED unused; `endDate` not tied to `totalPeriods`; activity endpoint stub returns `[]`.
- `PurchaseInvoiceItem.treatment` STANDARD / FIXED_ASSET / PREPAID_EXPENSE; confirm posts invoice JE (asset / prepayments debit per line) then `PurchaseLineRecognitionService` creates CAPITALIZED asset / ACTIVE prepaid idempotently (unique item id). Salvage always 0.
- Purchase return does not touch linked assets/prepaids. **Gap (documented, policy).**
- Cron: `vercel.json` `/api/cron/accounting-schedules` `0 1 * * *` UTC → `AccountingSchedulesService.runDue()` (depreciation then prepaid). Manual `POST /accounting-schedules/run` exists; web does not call it.
- Idempotency: posting engine returns existing POSTED JE for same sourceType+sourceId; row flips POSTED in same tx. Closed/locked period → row stays PENDING with lastError, retried nightly.
- Web: `finance/fixed-assets/page.tsx`, `finance/prepaid-expenses/page.tsx` (MasterDataPage). No `[id]` detail pages, no schedule table, invoice pages do not show linked asset/prepaid. "View journal entry" fails for invoice-capitalized assets.
