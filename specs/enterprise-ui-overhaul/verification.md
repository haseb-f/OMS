# Verification — enterprise-ui-overhaul

Evidence folders:

- `tmp/ui-baseline/{before,after,after-nav}`: Production before and after.
- `tmp/ui-baseline/rev-sweep*`: local review.
- `tmp/acceptance/DEMO-UI-20260927{,-R3}`: Production journeys.
- `docs/user-guide/screenshots/`: refreshed guide screenshots.

Recaptures use `scripts/acceptance/ui-baseline.mjs`: `PHASE=before|after`, or `PAGES=nav` for every
sidebar route.

## Gates (final tree)

| Gate                                     | Result                                  |
| ---------------------------------------- | --------------------------------------- |
| `tsc --noEmit` (apps/web)                | clean                                   |
| ESLint (apps/web/src)                    | 0 errors; 11 warnings, all pre-existing |
| Vitest (apps/web)                        | 27 files, 207 tests pass                |
| `next build`                             | success                                 |
| `node scripts/design/contrast-check.mjs` | all token pairs pass AA, light and dark |
| API                                      | untouched (no `apps/api` changes)       |

## Density: before vs after (Production, same pages, same data)

Rows fully visible at 1440×900 (desktop, Arabic, light).

| Page                        | Before: rows (row height) | After: rows (row height)  |
| --------------------------- | ------------------------- | ------------------------- |
| Leads                       | 10 (63px)                 | 13 (51px)                 |
| Store orders                | 7 (80px)                  | 12 (54px)                 |
| Sales invoices              | 8 (78px)                  | 13 (54px)                 |
| Journal entries             | 10 (63px)                 | 13 (51px)                 |
| Inventory movements         | 11 (57px)                 | 13 (51px)                 |
| Trial balance / IS / BS     | 19                        | 20                        |
| Payment review              | 5 (121px)                 | one-line rows (`3490007`) |
| Trial balance, phone 390    | 11                        | 16                        |
| Income statement, phone 390 | 12                        | 17                        |

**Why rows are denser:**

- Rows are 36px for a single line and 51–54px for two lines (name plus phone, badge plus caption).
- Headers are more compact: breadcrumbs moved into the 48px top bar, and the list page header
  starts at y=198–232.
- Type sizes did not shrink: body text stays at 13–14px.

**Screenshots:**

- Before: `tmp/ui-baseline/before/shots/`.
- After: `tmp/ui-baseline/after/shots/`.

The file names are identical in both folders.

## Route coverage

| Pass                                                 | Captures | Page overflow | Error text | Load errors |
| ---------------------------------------------------- | -------- | ------------- | ---------- | ----------- |
| Production, all 114 sidebar routes × desktop + phone | 228      | 0             | 0          | 0           |
| Production before/after, 12 pages × 5 variants       | 60       | 0             | 0          | 0           |
| Local independent review, 114 routes × 3 variants    | 342      | 0             | 0          | 0           |
| Local review, dark English, representative routes    | 22       | 0             | 0          | 0           |

- The 5 variants are desktop ar light, laptop ar light, desktop en dark, tablet ar light and phone ar
  light.
- The review (`review.md`, 19 findings plus 4 from re-verification) was fixed and re-verified. That
  covers keyboard focus, general-ledger labels, the journal editor, Arabic bidi, tablet navigation,
  table widths and header minimums.

## Production workflows (real UI, QA personas, tagged data)

- `DEMO-UI-20260927`: 129 PASS, 4 FAIL, 3 NOT TESTED, 1 BLOCKED.
  - One failure was a real UI bug: a dropdown menu stole focus from the dialog it had opened. It was
    fixed in `f28d692`.
  - The payment → invoice → shipping failures came from a stale script step. The pre-milestone "إضافة
    دفعة" button had been replaced by «إبلاغ دفع العميل». The script was updated.
- `DEMO-UI-20260927-R3` (master, inventory, crm, store-orders and shipping journeys, after
  `a81c898`): 30 PASS, 1 BLOCKED.
  - The blocked step is a transfer. It needs a second warehouse, which the audit deliberately does
    not create.
  - This run covers opening stock, adjustment, physical count, lead → store order, payment
    declaration → Finance confirm and post → invoice, and shipping prepare → ship → deliver.
- The `R2` run was interrupted by a local network outage and is not evidence.
- Financial accuracy:
  - The independent review compared `formatAmount`/`formatMoney`, the report row mapping and
    `document-totals-math.ts` against HEAD `0426316`. Output is unchanged, apart from Latin digits
    and no longer printing `-0.00`.
  - Trial-balance closing Dr/Cr matches balance-sheet signs.

## Final Production pass fixes

- `fcd9938`: alert tones use the AA soft-surface text colors. The exchange-rates info banner was
  nearly unreadable.
- `601c964`:
  - Payment review actions now fit their column; they had overflowed into the date.
  - FX day labels isolate the Latin date in Arabic.
- `7bede83`: payment review keeps the payment and order references visible. At 1280 the grid
  scrolls inside its own container with the actions pinned.
- The final Production captures are in `tmp/ui-baseline/final*`.

## Remaining gaps and exceptions (documented)

1. **Horizontal scroll inside tables.** Some grids still scroll sideways inside their own container,
   never the page:
   - bank transactions in English at 1280: 19px, with the actions column pinned
   - the trial balance on tablets, for its last amount column
2. **Long Latin names truncate from the wrong end.** In Arabic views, Latin-only account labels and
   product names truncate at the start. Arabic data is unaffected.
3. **Print page numbers** need Chrome or Edge 131+ (`@page` margin boxes).
4. **Company print header** shows logo and name only. The Company model has no tax number, address
   or phone.
5. **Investors overview totals** are computed client-side from the list endpoint, in parallel pages.
   A server aggregate would be better.
6. **Pinned table columns** use estimated offsets. There is no keyboard column resize.
7. **Legacy detail headers.** `DetailWorkspace` has no highlights variant; `/products/[id]` uses
   `EditorWorkspace`.
8. **Investor portal layout** duplicates the auth layout. This is a brand exception.
9. **Historical guide screenshots.** 65 payment-milestone shots and a few one-time dialog shots stay
   in the previous design, labelled «لقطة تاريخية».
10. **Observation for the owner, not a design change.** After Finance disputes a claim, the sales agent
    again sees «إبلاغ دفع العميل», because remaining-to-claim becomes > 0. The same logic was in
    `0426316`, so this is a payment-rule question.

## Round 2: compact controls, headers, feedback, report UI, sidebar (2026-09-28)

Evidence comes from Production:

- Before: `tmp/ui-controls/r2-before/shots/`, captured on Production before the Round 2 deploy.
- After: `tmp/ui-controls/r2-after/shots/`, captured on Production after the deploy.
- Both sets use the same viewports (1440×900, 1280×720, 390×844 and 820×1180), Arabic light and
  English dark. They were captured with `scripts/acceptance/ui-controls.mjs`.

**Records used:**

- The Lead → Order dialog is shown on demo lead LD-2026-000081.
- The declaration dialog is shown on demo order STO-2026-000102.
- Both are opened read-only and closed with Escape.

### Gates

| Gate           | Result                                             |
| -------------- | -------------------------------------------------- |
| tsc, apps/web  | clean                                              |
| ESLint         | 0 errors                                           |
| Vitest         | 33 files, 250 tests                                |
| next build     | success                                            |
| contrast-check | all pairs pass, including selector and rail tokens |

### Headers and first content (px from viewport top, Production, desktop 1440 Arabic light)

| Screen                                    | Before                                     | After                                                       |
| ----------------------------------------- | ------------------------------------------ | ----------------------------------------------------------- |
| Leads list (title → list surface)         | 175 band / 198                             | 161 band / 184                                              |
| Lead → Store Order dialog (content start) | 349 (10 fields, half-width product column) | 281 (9 fields in view, full-width lines, whole dialog fits) |
| Payment review                            | 164                                        | 144                                                         |
| Payment reconciliation workspace          | 122                                        | 102                                                         |

### Financial report table top (px)

| Report            | Before, 1440 / 1280 / 390 | After, 1440 / 1280 / 390 |
| ----------------- | ------------------------- | ------------------------ |
| Trial balance     | 261 / 287 / 327           | 192 / 192 / 281          |
| General ledger    | 261 / 323 / 331           | 192 / 192 / 262          |
| P&L               | 261 / 286 / 293           | 193 / 193 / 292          |
| Balance sheet     | 261 / 361 / 391           | 217 / 217 / 364          |
| Cash flow         | 293 / 318 / 327           | 193 / 193 / 292          |
| Aging             | 229 / 360 / 391           | 215 / 215 / 342          |
| Cash availability | 313 / 313 / 425           | 221 / 221 / 269          |

### Controls

- **Selector triggers:**
  - Before, they were white bordered boxes: computed `lab(100 0 0)`, identical to text inputs.
  - After, they are tonal buttons: `lab(≈94)`, with an inset hairline and a chevron.
  - Hover, pressed and expanded are distinct and verified with computed styles in light and dark.
  - Examples: `state-trigger-{rest,hover,focus,expanded}--*.png`.
- **Text inputs:** still white with a 3:1 border, 32px on desktop and 40px on touch.
- **Report reconciliation:**
  - On Production books the trial balance shows the balanced strip (`tb--*.png`).
  - The balanced, unbalanced and not-applicable states are shown with labeled sample data on
    `/design-system` (`reconciliation-states--desktop-{ar-light,en-dark}.png`).

### Coverage and workflows

- **Production sweep:** all 114 sidebar routes on desktop and phone (228 captures). No horizontal
  overflow, no error text and no load errors.
- **Production journeys:**
  - `DEMO-UI-20260928`: 123 PASS, 1 BLOCKED (transfer needs a second warehouse, by design) and 13
    NOT TESTED. The HR and investor create actions are now links, and the old script looked for
    buttons.
  - The script was fixed. `-R2` (hr) and `-R3` (master and investors) then gave 17 PASS each, with 0
    FAIL.
- **Independent review:** `review-r2.md` found 12 issues (1 high, 5 medium, 6 low). All are fixed
  and verified, and the status is in its appendix.

### Remaining gaps (Round 2)

- Phone financial tables still open with the amount columns off-screen at the logical end, and you
  scroll inside the table. This predates Round 2.
- The report header on desktop is 12px above the ~180px target, because the 8px rhythm was kept.
- On phones, Sync and Import on leads stay inline as icon-only buttons (they own their own dialogs).
- The disabled trigger state was verified in code only. Import progress while an import is running
  and a live toast were not exercised on Production, because they would create data.
