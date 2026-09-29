# Owner decisions — round 2 implementation

Date: 2026-09-29 · Local only, not committed. Each stream records its part in its own section.

## R — Financial reports: selling-expense presentation (P2) and Africa/Cairo business day (P9)

Owner decisions, confirmed:

1. **P2.** Carrier shipping costs, payment-gateway commissions and fulfilment expenses are selling / operating
   expenses, not cost of sales. They are shown on their own lines below gross profit. Order-level cost attribution
   stays analytical only. Owner correction (later the same day): agents are **not** charged actual carrier costs —
   the agent shipping charge is a fixed agreement fee, customer shipping collected stays with the company, and a
   carrier invoice never creates an agent deduction. Actual carrier cost is company Shipping Expense only.
2. **P9.** Financial reports use IANA `Africa/Cairo` business days, including DST, on screen, in exports and in
   print. Stored timestamps are not changed.

### R1. Selling and distribution expenses (P2)

**Presentation.** Income Statement → "Selling and distribution expenses" now contains one visible group per line.
Each group shows its accounts gross, a contra row when anything was recovered from agents, and a net subtotal.

| Line                           | Accounts (role, inherited by children) | Row ids                  |
| ------------------------------ | -------------------------------------- | ------------------------ |
| Shipping and delivery          | `SHIPPING_EXPENSE` (521)               | `is-selling-shipping`    |
| Payment gateway commissions    | `GATEWAY_FEES` (522)                   | `is-selling-gateway`     |
| Fulfillment                    | `FULFILLMENT_EXPENSE` (523)            | `is-selling-fulfillment` |
| Other selling and distribution | every other Selling account (534, 52x) | `is-selling-other`       |

- The contra row id is `<group>:recovered`. The subtotal id is `<group>:total`.
- Totals added to the API response: `shippingDelivery`, `paymentGatewayFees`, `fulfillment`, `otherSelling`,
  `recoveredFromAgents`, and `sellingBreakdown{gross, recoveredFromAgents, net}`.
- The four net lines add up to `sellingDistribution`. Gross profit never includes them.
- Code: `statement-classification.ts` (`SellingSubLine`, `SELLING_ROLE_SUB_LINES`, `AGENT_RECOVERY_SOURCE_TYPES`),
  `financial-statements.ts` (`buildIncomeStatement`, `recoverySums`), `report-scope.ts` (`agentRecoveriesOf`),
  `accounting-reports.service.ts` (`incomeStatement`).
- Web: `line-label.ts` ids, i18n `reports.finance.statementLines.selling{Shipping,Gateway,Fulfillment,Other}[Total]`
  and `recoveredFromAgents` (ar / en).

**Agent recoverables — how main posts them today (evidence).**

- Agent ledger posting (`accounting/posting-providers/agent-ledger-posting.provider.ts:106-117, 146-155`):
  - A debit entry posts Dr Agent funds payable (partner = agent) / Cr counter account.
  - `AGENT_CHARGE` credits commission revenue or fulfilment **service revenue**.
  - `AGENT_PROVIDER_FEE` credits **Payment Gateway Fees**. This recovers a fee already expensed at settlement.
  - `AGENT_ADJUSTMENT` credits service revenue or gateway fees.
- Agent shipping on main is a **service charge**, not a cost recovery:
  - `SHIPPING_FEE` per shipment: `agents/finance/agent-fulfillment.service.ts:268-293`.
  - `CUSTOMER_SHIPPING_RETAINED`: `agent-fulfillment.service.ts:414-427`.
  - Both post as `AGENT_CHARGE` → Cr Agent service revenue. That revenue is company revenue (net / agent
    presentation). It never reduces or inflates company expense.
- The agent's balance is netted in **Agent funds payable**: a current liability on the BS (`BS_ROLE_GROUPS`
  `AGENT_FUNDS_PAYABLE` → CURRENT, `statement-classification.ts:222`, role loaded at
  `accounting-reports.service.ts:1014`).
- Carrier shipping cost is company expense: `SHIPMENT_COST` → Dr Shipping Expense / Cr Accrued Shipping
  (`shipment-cost-posting.provider.ts:52-69`). Carrier charges themselves are not posted.

**Which postings count as "recovered from agents".** Only sources that exist on main and credit an expense
account: `AGENT_PROVIDER_FEE` (Cr Payment Gateway Fees, `agent-ledger-posting.provider.ts:150-151`) and
`AGENT_ADJUSTMENT` when `basis.counterAccount = PAYMENT_GATEWAY_FEE` (`:152-155`; otherwise it hits service
revenue, which the contra ignores), plus MANUAL reversals of either (judged by the reversed entry). The contra
applies only to accounts on a selling line, and the row renders only when non-zero — in practice only under
Payment gateway commissions. The `AGENT_SHIPPING_RECOVERY` source planned by the commission stream was dropped
by the owner correction and never reached main; its constant and test were removed. The web label is generic
("Less: recovered from agents", resolved for any `is-selling-*:recovered` row), with no shipping wording.

**Order-level attribution stays analytical (no double posting).**

- `store-orders/order-economics/order-economics.service.ts` has no posting-engine or journal writes. It reads
  `Shipment.baseShippingCost` etc. (line 195), the same source `SHIPMENT_COST` posts from.
- The Income Statement reads journal lines only, so the IS is not double counted.
- Cost Analytics "Management P&L" used to subtract every non-COGS GL expense from order contribution, counting
  shipping, gateway fees and fulfilment twice — fixed in R4.

**Tests (`financial-statements.spec.ts`).**

- **Fixture:**
  - Lines: shipping 50, gateway 20, fulfilment 0, other 55 (529 = 30, 534 = 25).
  - Selling 125, gross profit 610, operating 315, net 305.
  - Cost of sales = 511 only.
  - Group order: shipping, gateway, other, total.
- **With a gateway-fee recovery** (522 Dr 20 / Cr 8 via AGENT_PROVIDER_FEE, 523 Dr 40; shipping 50 not recovered):
  - Lines: shipping **50** (no contra row), gateway 20 − 8 = **12**, fulfilment **40**, other 55.
  - Selling **157**, recovered 8, operating **283**, net **273**.
  - By account type: 965 − 692 = 273. `partitionDifference` 0. Revenue unchanged at 1,200.
- **Service, in-memory** (SHIPMENT_COST 50 + an unknown source type 4 on 521; gateway fee 20, AGENT_PROVIDER_FEE
  Cr 8, a second recovery of 3 reversed by a MANUAL entry, AGENT_ADJUSTMENT Dr 522 2):
  - Shipping gross 54 / recovered 0 / net 54, no contra row. Gateway 20 / 6 / 14.
  - Selling 68. TB 521 = 54, 522 = 14.
- **Header nesting:** `is-selling-other/534` = 25 at level 2, `is-selling-other/52` = 30, no `/53` inside Selling.

### R2. Business day = Africa/Cairo (P9)

**Rule** (`apps/api/src/common/time/business-date.ts`):

- `start(D)` is the first UTC instant whose Africa/Cairo calendar date is D. That is 00:00 local, or 01:00 on the
  DST spring-forward day, when 00:00 does not exist.
- Period [from, to]: `entryDate ≥ start(from)` and `entryDate < start(to + 1)`.
- Opening: `< start(from)`.
- As-of D: `≤ start(D + 1) − 1 ms`.
- The offset comes from the runtime's ICU tz data (Node 24, tz 2026b) through `Intl.DateTimeFormat`. No `+2` / `+3`
  constant appears anywhere, and no dependency was added.

**Date-only postings.**

- Local DB check: `entry_date` is `timestamp without time zone`, read as UTC.
- Date-only documents are stored at 00:00:00Z. Examples: fiscal years `2026-01-01 00:00` / `2026-12-31 00:00`,
  depreciation, prepaid, opening balance, and 1,217 of 1,661 receipts.
- Postings stamped with `now()` / `confirmedAt` carry a real instant. 231 local entries fall between 21:00Z and
  midnight UTC.
- Cairo is always UTC+2 or UTC+3, ahead of UTC by less than a day. So 00:00Z of D is 02:00 / 03:00 in Cairo on
  **the same date D**.
- One rule — "business date = Cairo date of the stored instant" — therefore places both kinds correctly:
  - A date-only `2026-10-01` → 1 Oct.
  - `2026-09-30T21:30Z` (00:30 Cairo) → 1 Oct.
- `business-date.spec.ts` asserts this invariant for every day from 2020 to 2035.

**Egypt DST 2026, read from tz data (computed, not assumed):**

- Spring forward at `2026-04-23T22:00Z` (00:00 → 01:00 on Friday 24 Apr, the last Friday of April). 24 Apr is
  23 hours long.
- Fall back at `2026-10-29T21:00Z` (24:00 → 23:00 on Thursday 29 Oct, the last Thursday of October). 29 Oct is
  25 hours long.

**Applied to:**

- **API report scope:**
  - `report-scope.ts`: `periodScope`, `openingScope`, `asOfEndOfDay`.
  - `accounting-reports.service.ts`: General Ledger, account / partner statement, Trial Balance, Journal Report,
    Balance Sheet, Income Statement, Cash Flow (activities and movement).
- **Fiscal-year lookup** (`currentFiscalYear`): the year containing the Cairo as-of date. Its start is the start of
  its first Cairo day.
- **Other API endpoints:**
  - AR/AP aging: as-of, plus `daysOutstanding` counted in Cairo calendar days (`aging.util.ts`).
  - Cash availability: a plain `asOf` date now covers the whole Cairo day. Before, it stopped at 00:00Z.
  - Period profit (rate date).
  - Investor statement (`investor-ledger.service.ts`). `dateTo` was exclusive at 00:00Z before. The investor
    portal uses the same method.
- **Response additions:**
  - `period.timeZone` on TB and IS.
  - BS: `asOfBusinessDate`, `fiscalYearStartDate`, `timeZone`.
  - Cash availability: `timeZone`.
- **Web:**
  - The web keeps sending plain `YYYY-MM-DD` (`use-report-query.ts`, unchanged).
  - Print and export headers show the same selected period.
  - GL, account / partner statement and Journal Report rows show the **Cairo** date of the posting
    (`financial-report/business-date.ts` → `formatBusinessDate`, in `ledger-lines.tsx` and
    `journal-report-tab.tsx`). Screen, print and CSV agree whatever the browser zone is.

**Tests:**

- `common/time/business-date.spec.ts` (8 tests): IANA offsets, DST transitions from tz data (last Friday of April /
  last Thursday of October), the 00:00Z invariant for 2020–2035, local midnight, year end, DST day lengths
  (23 h / 25 h), range / opening / as-of bounds, and parsing.
- `financial-statements.spec.ts` "Africa/Cairo business-day boundaries", on one in-memory ledger:
  - **IS:** September 20, 1 Oct 50 (00:30 plus date-only), October 62, 23 Apr 1, 24 Apr 2, 29 Oct 4, 30 Oct 8,
    FY2026 185, 31 Dec 100, January 2027 600.
  - **TB:** October AR opening 16, Dr 62, Cr 5, closing 73.
  - **BS:** 30 Sep current-year profit 23 and cash 10,007. 31 Dec 185, FY start `2025-12-31T22:00Z`.
    1 Jan 2027: current 600, prior 185.
  - **CF:** September 10,000 → +7 → 10,007. October → +5 → 10,012, equal to the ledger.
  - **GL:** account statement for 1 Oct: m1, c1, m3, closing 61.
  - **Journal Report:** 31 Dec = [y1], 1 Jan = [y2, y3].
- `aging.util.spec.ts`: an invoice confirmed at 00:30 Cairo on 1 Oct is 30 days old at the end of 31 Oct and
  0 days old on 1 Oct.
- Web `business-date.spec.ts`: row date formatting.

**Live** (`tmp/acc/reconcile.mjs`, extended): new checks for the Cairo day filter and the TB day = journal lines.
14/14 pass for three ranges. See `accounting-review.md` §12.

### R3. Open points / hand-offs

- **Fiscal periods / Year Closing (stream Y).** Posting-period locks (`fiscal-years.service.ts` `exclusiveEnd`,
  `accounting-periods.service.ts`) still assign an entry to a period by UTC day.
  - An entry stamped 00:00–02:59 Cairo on the first day of a month or year is locked with the _previous_ period,
    but reported in the new one.
  - Year Closing calls `incomeStatement(FY start..end)`, which now uses Cairo days. An entry at 00:30 Cairo on 1 Jan
    is closed with the new year.
  - Recommendation: stream Y adopts `businessDateOf` / `businessDayStart` for period assignment.
- **Agent statement** (`agents/finance/agent-statement.service.ts:57`, `T23:59:59.999Z`) is still on UTC days.
  Agents code is outside this stream; it should call `businessDateRangeFilter`.
- **Cost analytics** filters orders by UTC `orderDate` days (`buildDateRangeFilter`) and double counts selling
  costs in the Management P&L (R1).
- The shared **date-range picker presets** ("Today", "This month") use the browser clock. They are correct for
  Cairo users, and off by one around midnight for users elsewhere (`components/shared/date-range-picker.tsx`,
  not in this stream).
- The Journal Entries list screen filters by `createdAt` UTC days. It is not a report and was left unchanged.

## Y — Year-end closing, opening balances (decision 3) and investor capital repayments (decision 4)

Local only, not committed. One additive migration, applied to the local DB only.

### Y1. Opening balances — the design in plain language

The ledger is one continuous book. Every report adds up everything posted before a date. So the opening balance
of a year is **everything posted before that year starts**. Nothing needs to be posted to "open" a year.

- The **closing entry** (end of year N) moves every revenue and expense balance to Retained Earnings.
- After that, the opening of year N+1 is automatic. Each asset, liability and equity account opens with its
  year-end balance, counted **once**. Every revenue and expense account opens at **zero**. Retained Earnings
  = its earlier balance + year N's profit.
- The old "next-year opening entry" posted those same balances a second time. That was the double count
  (P1 / R8). It is **removed**. `nextFiscalYearId` stays on the DTO only so an old client gets a clear refusal
  (400 `OPENING_BALANCES_ARE_DERIVED`, Arabic + English). If the field were removed, the validation pipe
  (`whitelist`) would strip it silently.
- **View:** `GET /accounting/opening-balances/fiscal-years/:id` returns the derived opening per account. It
  reads the Trial Balance read-only (opening column at the year start) and adds the year's own go-live Opening
  entry when there is one. It also returns `profitAndLossOpening` (sum of the absolute revenue and expense
  openings, 0 once the previous year is closed) and `totals` (debit = credit). The Year Closing page shows it
  and links to the Trial Balance of the next year, where the Opening column is the same figure.
- **Opening Balance wizard = go-live only.** It is refused (`OPENING_BALANCE_HISTORY_EXISTS`) whenever any
  posted history exists before the opening date. At most **one active** Opening entry per fiscal year. A
  REVERSED one no longer blocks re-entry, as the old message promised. Both checks run under an advisory lock,
  and the database index below backs them up (`opening-balances.service.ts:239,299`).
- **Posting gate** (`fiscal-years.service.ts:316` `hasEstablishedOpening`): a year needs its go-live Opening
  entry **or** posted history before it starts. Before this change, every later year was blocked by "no
  Opening Balance yet" as soon as carry-forward was disabled.

### Y2. Closing method

- Year Closing now posts **through the Posting Engine** (`year-closing-posting.provider.ts:61`). Before, it
  wrote `journalEntry.create` directly, which the guardian forbids. The entry is dated the year's last day
  (UTC midnight, so it lands on that business day in UTC and in Cairo). `sourceType YEAR_CLOSING`,
  `sourceId` = the fiscal year.
- **Amounts:** every Revenue/Expense account's Trial Balance `closingBalance` at year end (`:79`), reversed,
  with the net to Posting Settings → Retained Earnings. The RE account must be an active, postable **EQUITY**
  account (local and Production: 321). This is the cumulative balance, not only the year's movement, so any
  P&L left unclosed from before the first fiscal year is swept too. The next year's P&L always opens at zero.
- **Order** (`year-closing.service.ts`, `closeBlockers`): the year must be CLOSED. Every earlier year must be
  CLOSED, and must end with all revenue and expense balances at zero, i.e. closed by an active Year Closing or
  with nothing to close (Y10 #3). No later year may have an active closing. This order keeps the cumulative
  amount exact.
- **Closed periods:** the closing is the one posting allowed inside a closed year, and only there
  (`fiscal-years.service.ts:254`). Its period check is skipped because the period is closed by definition
  (`posting-engine.service.ts:376`). Every other posting into a closed or locked period or year is still
  blocked (tested).
- **Idempotent + concurrency-safe:**
  1. The engine takes `pg_advisory_xact_lock(hashtext('YEAR_CLOSING'), hashtext(fyId))` before its "already
     posted" check (`posting-engine.service.ts:87,95`).
  2. A repeated request returns the existing entry with `alreadyClosed: true`.
  3. **DB guarantee:** the partial unique index `journal_entries_active_fiscal_singleton_key` on
     `(source_type, source_id)` WHERE `status = 'POSTED' AND reversal_of_entry_id IS NULL AND deleted_at IS NULL
AND source_type IN ('YEAR_CLOSING','OPENING_BALANCE')`. Migration `20260929140000_fiscal_singleton_entries`.
     It is additive and applied locally. Production has 1 active OPENING_BALANCE and 0 YEAR_CLOSING, so the
     index builds cleanly.
- **Reopen = reverse** (`POST /accounting/year-closing/:fyId/reverse {reason}`, `year-closing.service.ts:166`):
  - The engine reverses the active closing. The reversal is dated on the **closing date** inside the
    still-closed year, so no other year's figures move.
  - The reason and entry ids are written to the activity log of both entries (`YEAR_CLOSING_REVERSED`).
  - A later active closing blocks it (`LATER_YEAR_CLOSING_ACTIVE`).
  - `FiscalYears.reopen` is refused while the year, or any later year, has an active closing
    (`FISCAL_YEAR_HAS_ACTIVE_CLOSING`, `fiscal-years.service.ts:154`).
  - Then: reopen → adjust → close → Year Closing again → exactly one active closing. The history shows closing,
    reversal and re-closing, all in the GL and journal. The IS already excludes `sourceType YEAR_CLOSING`,
    which includes these reversals.
- **Engine fix:** `reverse()` now picks the source's **current** posting (`reversalOfEntryId: null`,
  `posting-engine.service.ts:281`). Before, once a document had been reversed and re-posted, it could pick the
  earlier reversal entry. This affected the FX correction path too.
- `GET /accounting/year-closing/:fyId` returns the status, blockers, history and next year for the page.
- **Web** (`finance/year-closing/page.tsx`):
  - Status from the API. Confirm before posting.
  - "Reverse closing" with a required reason (shared `ConfirmationDialog`).
  - Closing history.
  - A next-year opening card (accounts, Dr / Cr, P&L opening = 0) with a link to the Trial Balance.
  - Toasts for completed, already closed and reversed.
  - i18n `accounting.yearClosing.*` (ar / en). `carryForwardDisabled` is replaced by `derivedOpeningExplained`.

### Y3. Full-cycle test (real local DB, years 1991/1992, cleaned up) — `year-closing-cycle.serial.spec.ts`

**FY1991 activity:**

| Date    | Entry                                      |
| ------- | ------------------------------------------ |
| go-live | Opening Dr Cash 10,000 / Cr Capital 10,000 |
| Mar     | Sale 5,000                                 |
| Jun     | Expense 2,000                              |
| Sep     | Inventory 1,000 bought for cash            |

**Close FY1991:**

- Closing before the year is closed → `FISCAL_YEAR_NOT_CLOSED`.
- Three concurrent requests (`Promise.all`) → one entry: Dr Revenue 5,000 / Cr Expense 2,000 / Cr RE 3,000,
  dated 1991-12-31.
- A 4th request → `alreadyClosed`, and the Trial Balance totals are unchanged.
- A raw insert of a second active closing → P2002 (the index holds).
- Posting into 1991 is blocked.

**FY1992 (no Opening entry):**

- Sale 700, expense 200.
- The wizard for FY1992 → `OPENING_BALANCE_HISTORY_EXISTS`.
- Derived opening: Cash 12,000, Inventory 1,000, Capital −10,000, RE −3,000, Revenue/Expense absent,
  `profitAndLossOpening` 0, Dr 13,000 = Cr 13,000.
- Trial Balance 1992: Cash 12,000 → 12,500; Revenue 0 → −700; Expense 0 → 200.
- Income Statement 1992 = **500** (only 1992). Income Statement 1991 = **3,000** (closing excluded).

**Reopen cycle:**

1. Reopen → refused.
2. Reverse (dated 1991-12-31): 1992 Revenue opening −5,000 and FY1992 movement unchanged.
3. Reopen year + December, post an expense of 500, close, re-close → 1 active closing, 3 in history.
4. Derived FY1992: Cash 11,500, RE −2,500, P&L 0.

**Order:** close FY1992 → Dr Rev 700 / Cr Exp 200 / Cr RE 500. Reversing FY1991 is then refused.

Result: 1 test, pass, twice (cleanup verified: nothing before 2026 is left in the local DB).

### Y4. Investor capital repayments (decision 4)

**Findings:**

| Item                                            | Where                                                              | Finding                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How principal comes in                          | `investor-posting.provider.ts:62-101`                              | Capital Contribution: Dr Bank / **Cr Investor Funding** (`resolveInvestorFundingAccount`, Partner = investor). Local account `INVFUND` (alias of 241), Production **241 LIABILITY**.                                                                       |
| How principal went out (before)                 | same file, old `:197` `resolveCapitalReturnAccount`                | `capitalReturnAccountId ?? investorFundingAccountId`. The standard COA gave role `CAPITAL_RETURN` to **551 "Capital Return", EXPENSE**, and foundation activation filled the setting. Result: Dr 551 expense / Cr Bank, so every repayment reduced profit. |
| Profit distributions, profit payments, fees     | `:103-179`                                                         | Separate and unchanged: distribution Dr 549 / Cr 242 payable; payment Dr 242 / Cr bank.                                                                                                                                                                    |
| Investor ledger and the Capital Return document | `capital-returns.service.ts:239-290`, `investor-ledger.service.ts` | Already correct: a CAPITAL_RETURN ledger debit, never profit. Only the GL account was wrong.                                                                                                                                                               |

**Fixes:**

- **Posting** (`investor-posting.provider.ts:207`): a Capital Return debits `resolveInvestorFundingAccount`.
  That is the same liability the contribution credited, carrying the investor's Partner. `capitalReturnAccountId`
  is no longer read. Per the coordinator, `account-mapping.service.ts` is untouched.
- **COA** (`standard-chart-of-accounts.ts:701`): 551 loses the `CAPITAL_RETURN` role, so a new install never maps
  it again. 551 **keeps type EXPENSE** because activation re-applies `accountType` to existing rows. Re-typing
  would silently restate every period it was posted in, which the "never mutate history" rule forbids.
  `POSTING_ROLE_SETTINGS.CAPITAL_RETURN` is kept, so reports still flag legacy 551 postings.
- **Correction** (FX precedent), `capital-return-correction.service.ts` plus `capital-return-corrections.controller.ts`:
  - `GET /capital-returns/corrections/affected` (`:120`) lists active CAPITAL_RETURN entries with a
    Revenue/Expense line: profit effect, period, planned date, and totals per period.
  - `POST /capital-returns/corrections/:journalEntryId {reason, dryRun}` (`:167`): in one transaction, the engine
    reverses the original entry and re-posts the document (now Dr Investor Funding / Cr Bank). The transaction
    fails closed if the re-post still touches P&L. It writes `CAPITAL_RETURN_CORRECTION` activity (reason,
    before/after ids) on the original, reversal and corrected entries. `dryRun` rolls everything back. Posted rows
    are never edited.
  - Permission: `investment-accounting.view` / `.configure` (`manage`).
  - **Dating** (see Y10 #2 for the final rule): when the original period and year are open, both entries are dated
    on the original date, so that period is restated exactly. When the original period is closed, both entries are
    dated in the **original fiscal year's** latest open period (`OPEN_PERIOD_SAME_YEAR`); if that year has none, the
    correction is refused (`CAPITAL_RETURN_NO_OPEN_PERIOD_IN_YEAR`). When the year already has an active Year
    Closing, the correction is **refused** (`CAPITAL_RETURN_YEAR_ALREADY_CLOSED`, listed as `BLOCKED_YEAR_CLOSED`).
    The expense is already inside Retained Earnings, so a current-period credit to 551 would overstate the current
    year's profit. That case needs an owner decision (see Y6).
- **Tests** (`capital-return-correction.serial.spec.ts`, real DB, cleaned up):
  - Dry-run changes nothing.
  - Real run: reversal on the original date; re-post Dr Investor Funding 1,500 / Cr Bank; 551 net 0; 3 audit rows.
  - A second attempt is rejected.
  - A closed-period original is corrected in its own year's latest open period.
  - A Year-Closed original is refused.

### Y5. Historical impact

**Local:**

- Before this work, 0 affected entries. The 3 earlier Capital Returns (JV-2026-001726/1940/1942, 22,000) debited
  INVFUND because `capitalReturnAccountId` was still empty when they were posted.
- To exercise the real path, one genuine legacy posting was made through the running API **before** the fix:
  CRET-2026-000149, JV-2026-006677, **Dr 551 1,500 / Cr CASH, Sep 2026, FY2026-Import-Test**.
- Correction: dry-run, then real → reversal **JV-2026-006727** and re-post **JV-2026-006728** (Dr INVFUND 1,500),
  both dated on the original date (period open).
- FY2026 Income Statement net: −4,046,059.64 → **−4,044,559.64 (+1,500)**. 551: 1,500 → 0. INVFUND: −166,000 →
  −164,500. A repeat request → 400. `affected` is now empty.
- A new Capital Return after the fix (CRET-2026-000150, 100) posts Dr INVFUND / Cr CASH.

**Production** (read-only GETs as qa-admin, 2026-09-29): 0 Capital Returns, 0 `CAPITAL_RETURN` journal entries,
and account 551 has **0 movements all-time** (account statement).

- `capitalReturnAccountId` **is mapped to 551** (EXPENSE). The first Production repayment would have been
  expensed; the fix prevents it on deploy.
- Fiscal years: FY 2026 (open, go-live Opening JV-2026-000003 Dr 111 1 / Cr 321 1) and QA-E2E-LOCK-FY-2099.
  No YEAR_CLOSING entries.
- **Production dry-run plan: no entries to reverse or re-post. Profit impact 0 in every period.** Nothing is
  applied to Production.

### Y6. Needs owner approval

1. Deploy the additive migration `20260929140000_fiscal_singleton_entries` (index only).
2. Closing method: a **cumulative** sweep (it also closes P&L from before the first fiscal year) and the
   year-order rules in Y2.
3. Correction dating policy (Y4). Treatment of a capital return in an already Year-Closed year: the recommended
   IAS 8 prior-period correction is **Dr Investor Funding / Cr Retained Earnings** in the current period, not
   through 551. Today it is refused. It does not occur in Production.
4. Optional, cosmetic: clear Production Posting Settings → Capital Return (551). It is no longer read. The Accounting
   Settings page no longer shows the field (Y9). Saving that page leaves the stored value untouched.

### Y7. Report-layer changes for stream R (not made here)

- **Classification:** new Capital Returns hit 241 (`INVESTOR_FUNDING`: non-current liability, financing). No change
  is needed for them. Keep role `CAPITAL_RETURN` → Finance costs and the warning `CAPITAL_RETURN_IN_PROFIT_OR_LOSS`
  for legacy uncorrected 551 postings. Suggest the warning text point to "Capital Returns → corrections"
  (`GET /capital-returns/corrections/affected`). Test: a 551 debit of 100 raises the warning; a 241 debit of 100
  raises none and nets investor funding.
- **Cash flow:** a correction produces original (cash −X vs 551), reversal (+X vs 551) and re-post (−X vs 241).
  All classify as financing, net −X. No change needed.
- **BS R5 ("closed to retained earnings"):** Year Closing reversals are now always engine-dated on the closing date
  with sourceType YEAR_CLOSING. The MANUAL-reversal branch is legacy only (the Journal Entries screen refuses to
  reverse system entries). Presentation note: if a closing swept P&L from before the first fiscal year, the BS at
  that year end shows the swept amount on "prior periods" and nets it in "closed to retained earnings". Totals are
  correct. It is cosmetic, and only possible when history predates the first fiscal year.
- **Contract used read-only by Y:** `AccountingReportsService.trialBalance({dateFrom, dateTo, includeOpeningBalance})`
  → `items[].{accountId, accountCode, accountName, accountType, openingBalance, closingBalance}`. Please keep it
  stable. Year Closing amounts and derived openings depend on it.

### Y8. Verification

- API jest (`--maxWorkers=4`) on year-closing, opening-balances, fiscal-periods, posting-engine, posting-providers,
  capital-returns, capital-contributions, investor*, investment*: **14 suites / 79 tests pass**. With `src/accounting/fx`:
  18 / 124 pass.
- Serial: `year-closing-cycle` + `capital-return-correction`: **2 / 2 pass**.
- API `tsc --noEmit` clean, and ESLint on the changed API files is clean.
- Web `tsc` clean. ESLint on the page, service and i18n is clean. Vitest 447/448 on the first run: one failure in
  `enterprise-data-table` layout-spec-sort (not this stream), which passed on the rerun.
- `src/import-center` sync / store-orders specs time out under a parallel run and pass in isolation. They are not
  touched here.

### Y9. Follow-up — period locks use the Cairo business day; capital-return field removed

**Problem.** Period and fiscal-year locks used UTC days. Reports use Africa/Cairo days (§R2). So an entry at
00:00–02:59 Cairo on the 1st was locked with the previous period but reported in the new one.

**Rule now.** An instant belongs to a period or fiscal year by its **business date**, the Africa/Cairo calendar
date from `common/time/business-date.ts` (`businessDateOf`), which is reused here, not duplicated. Locks, Year
Closing and reports therefore agree.

- **Stored bounds name calendar dates.** `rangeDateOf` (`fiscal-periods/period-bounds.ts`) recovers the date
  from each of the three shapes found in the data:
  - date-only `00:00Z` (DTO dates, and the date-only rule of §R2);
  - server-local midnight of legacy generated periods (e.g. `2026-09-30T21:00Z` = 1 Oct on a UTC+3 host);
  - end-of-day markers `…:59:59.999` (the foundation's `FY yyyy` rows, Production FY 2026).

  Membership: `rangeDateOf(start) ≤ businessDateOf(instant) ≤ rangeDateOf(end)`. The candidate query has a 2-day
  start slack, and `pickCovering` chooses the latest-starting candidate that covers the date.

- **Query bounds** `rangeStart` / `exclusiveEnd` are `businessDayStart` / `businessDayEndExclusive` of those dates.
  They are the same instants as `businessDateRangeFilter`.
- **Updated users of these bounds:**
  - `AccountingPeriodsService.assertPeriodOpen`, which the Posting Engine and manual journals use.
  - `FiscalYearsService`: `findCovering`, `resolveFiscalYearId`, `assertPostingAllowed`, the draft count in
    `close`, and the prior-history check in `hasEstablishedOpening`.
  - The Opening Balance wizard: its date is stored date-only, the range is validated on calendar dates, and the
    earlier-history cutoff is the start of the Cairo day.
  - Year Closing: `closingDateOf` = `00:00Z` of the last calendar day. Its TB cutoff is `rangeDateOf(endDate)`, so
    it ends at the Cairo end of 31 Dec, the same instant the lock uses.
  - The Capital Return correction dating.
- **New monthly periods** are generated as date-only `00:00Z` values, independent of the server time zone.
  Existing rows are not rewritten; `rangeDateOf` reads them correctly.
- **Tests** (`period-bounds.spec.ts`, 13 tests, explicit UTC instants):
  - `2026-09-30T21:30Z` is October for locking (allowed while September is CLOSED), and October for the report
    range, with both date-only and legacy bounds. `20:59Z` is September and is blocked.
  - DST: 23 → 24 Apr 2026 (`21:59Z` / `22:00Z`) and 29 → 30 Oct 2026 (`21:30Z` / `22:00Z`).
  - 31 Dec → 1 Jan: `2025-12-31T22:30Z` resolves to FY 2026 and may post. `21:30Z` is in the closed FY 2025 and is
    blocked. The closing date `2025-12-31T00:00Z` is inside FY 2025. The closing cutoff = `exclusiveEnd(FY2025)` =
    `2025-12-31T22:00Z`.
  - The serial full cycle (Y3) now also posts at `1991-12-31T21:30Z` (blocked: closed 1991) and at `22:30Z`
    (allowed, `fiscalYearId` = 1992, 50 of revenue). It is excluded from the 1991 closing and included in 1992:
    IS 1992 = 550, Cash 12,000 → 12,550, FY1992 closing Cr RE 550. The derived opening is unchanged.
- **Capital-return field.** `finance/accounting-settings/page.tsx` no longer lists "Capital Return Account". A short
  note under the Investor accounts says repayments go against Investor Funding and never reduce profit
  (`accounting.settings.fields.capitalReturnNote`, ar/en; the unused `capitalReturn` label was removed). The save
  payload omits the field, so the stored value is left as it is.
- **Verification:**
  - API jest (`--maxWorkers=4`) on `src/accounting`, journal-entries, capital-returns, capital-contributions,
    investor*, investment* and `common/time`: **27 suites / 199 tests pass**.
  - Serial (cycle + correction): 2/2 pass.
  - API `tsc` clean. It showed a transient syntax error in `reports/financial-statements.spec.ts` while another
    session was editing it; clean on the re-run.
  - ESLint on the changed API folders is clean. Web `tsc` and ESLint on the changed files are clean.

### R4. Follow-ups (same day)

**Cost Analytics Management P&L — each cost counted once** (`cost-analytics.service.ts` `getManagementPnl`).

- Contribution Profit keeps the order-level attribution: revenue, COGS, shipping, payment fees and fulfilment.
- "Operating Expenses" are now only the GL accounts on the Income Statement's **Other selling** and **General &
  administrative** lines. The Income Statement returns `accountLines` (account → line and selling line) for this.
  A revenue-type account on an admin line counts as a negative expense.
- The GL side of the attributed costs is reported as `attributedCostsInGl` and is not subtracted.
- Other income / expenses, finance costs and FX stay below operating profit, as in the IS.
- `incomeStatementReconciliation` bridges management OP to IS OP for the same Cairo period. It has one item per
  attributed line (order-level vs GL) plus `CONTRIBUTION_NOT_COMPUTED` (orders with unknown cost). The items always
  add up to the difference (`balanced`).
- The web cost-explorer page shows the rows "Difference to Income Statement" (with bridge rows) and "Operating
  Profit per Income Statement".
- Test with one order (revenue 100, COGS 40, shipping 10, fees 5, fulfilment 5 → contribution 40). The GL has COGS
  40, shipping 12, gateway 5, fulfilment 5, marketing 15, rent 30, a purchase discount of 3 on admin, and finance 7:
  - Operating expenses: **42** (before: 74, of which 22 double counted and 7 finance). Management OP **−2**.
  - IS OP **−4**. Difference **2** = shipping 10 vs 12. Balanced.
- The order filter uses Cairo business days: 1–31 Oct → `gte 2026-09-30T21:00Z`, `lt 2026-10-31T22:00Z` (tested).
- PERIOD buckets (day / week / month) now use the Cairo date instead of server-local / UTC time.
- The web page sent `toISOString().slice(0, 10)` of a local-midnight date, which is the previous day east of UTC.
  It now sends the picked calendar date (`toISODate`).

**Date-range picker presets.** `components/shared/date-range-picker.tsx` anchors Today / Yesterday / Last N days
/ This / Last month / This year on the Cairo business day (`lib/business-date.ts` `businessPresetRange` /
`businessToday`). The report row-date helper re-exports from the same file.

- vitest `lib/business-date.spec.ts` uses a mocked clock:
  - At 2026-09-30T22:30Z: Today = 2026-10-01, Last month = Sep 1–30.
  - At 2026-12-31T22:30Z: Today = 2027-01-01.
- The tests also pass with `TZ=America/New_York`.

**Capital return.**

- `CAPITAL_RETURN` stays under finance costs, below operating profit.
- The `CAPITAL_RETURN_IN_PROFIT_OR_LOSS` warning now carries `correctionsEndpoint:
/capital-returns/corrections/affected`. Its ar / en text points users to the capital-return corrections list.
- No web page exists for that list yet: nothing in apps/web calls `capital-returns/corrections`.
- Tested: legacy 551 debit 100 → finance costs 112, operating profit unchanged at 315, warning includes the
  endpoint.
- `trialBalance().items[]` fields are unchanged.

**Current fiscal year = the lock's fiscal year.**

- The Balance Sheet picks its fiscal year with stream Y's `candidateRangeQuery` / `pickCovering` / `rangeStart`
  (`fiscal-periods/period-bounds.ts`, imported, not edited). Stored bounds in any shape (00:00Z, server-local
  midnight, `…T23:59:59.999`) resolve by business date.
- Tested as of 1 Jan 2026 with FY2026 stored both as 00:00Z and as `2025-12-31T21:00Z` / `2026-12-31T23:59:59.999Z`:
  - `fiscalYearStartDate` is 2026-01-01.
  - The sale at 00:30 Cairo on 1 Jan (7) is current-year. The sale at 23:30 on 31 Dec (5) is prior.
- The old raw comparison gave a start of 31 Dec for the server-local shape.

### Y10. Independent review — defects fixed

1. **MEDIUM — foundation bootstrap auto-posted a phantom opening** (`accounting-foundation.bootstrap.ts`, runs on
   every Vercel build via `provision-permissions.ts`).
   - **Before:** whenever the current business year had no Opening entry, it wrote `OB-<year>` Dr Cash 1 / Cr
     Retained Earnings 1 with a raw insert. That bypassed the engine, the period locks and the go-live rule, and
     would have posted OB-2027 on the first deploy of 2027.
   - **Now:** it never posts anything. The result reports `openingBalanceRequired`, which is true only when the
     year has neither a go-live Opening nor posted history before it (the shared `hasEstablishedOpening`, now
     exported from `fiscal-years.service.ts`).
   - A fresh install enters its go-live opening through the wizard before posting. This is TASK-055's rule, now
     enforced honestly. Later years need nothing, because their opening is derived.
   - Test: `accounting-foundation.bootstrap.serial.spec.ts` — activation creates no journal entry and no opening,
     and `openingBalanceRequired` is false on the local ledger.
   - **Production finding (read-only GETs as qa-admin):** the only Opening entry is **JV-2026-000003**, dated
     2026-01-01, POSTED. Lines: **Dr 111 الصندوق (Cash) 1** "QA go-live opening cash" / **Cr 321 أرباح مبقاة
     (Retained Earnings) 1** "QA go-live opening equity".
     - It was created on 2026-09-17 12:49 by **QA Admin** (`qa-admin@oms.haseb.org`) through the Opening Balance
       wizard API. Its activity log reads "Opening Balance JV-2026-000003 posted…".
     - The descriptions match `scripts/production-accounting-e2e.mjs`.
     - So it is **not a bootstrap OB-2026**. It is also **not a real go-live**: it is a 1 EGP QA test opening, and
       it is what currently satisfies FY 2026's posting gate. Effect: Cash +1, Retained Earnings +1.
     - **Not corrected. Owner decision:** leave it, or replace it with the real go-live opening. Replacing it needs
       a controlled reversal, because the Journal Entries screen refuses to reverse system entries.
2. **MEDIUM — correction dated in the wrong fiscal year** (`capital-return-correction.service.ts`, `planDate`).
   - Before: when the original period was closed, the correction was dated `new Date()` in any fiscal year.
   - Now: it is dated in the **original fiscal year's** latest open period that has started and does not end
     before the original entry: today if that period is the current one, otherwise its last day
     (`OPEN_PERIOD_SAME_YEAR`). If the year is Closed or has no such period →
     `CAPITAL_RETURN_NO_OPEN_PERIOD_IN_YEAR` (`BLOCKED_NO_OPEN_PERIOD`).
   - The affected list now groups by business (Cairo) month.
   - Test: original June 1990 with June closed → dated `1990-12-31T00:00Z` with fiscal year 1990. After the year is
     closed → refused with that code. After Year Closing → `CAPITAL_RETURN_YEAR_ALREADY_CLOSED`.
3. **LOW — later year could sweep an earlier year's P&L.** New blocker `EARLIER_YEAR_NOT_CLOSED_BY_ENTRY`.
   - Exact rule: the immediately preceding fiscal year's cumulative revenue/expense balance per account at its end
     (Cairo cutoff `exclusiveEnd`, posted + reversed entries) must be zero. That means it was closed by an active
     Year Closing, or had nothing to close. Checking the predecessor covers every earlier year, because the balance
     is cumulative.
   - Test (cycle): after FY1991's closing is reversed, FY1992's status lists `EARLIER_YEAR_NOT_CLOSED_BY_ENTRY`.
4. **LOW — `alreadyClosed` was wrong for requests that lost the race.** `execute` now takes the same advisory lock
   (re-entrant in the transaction) and re-checks under it. A loser returns the winner's entry with
   `alreadyClosed: true`. Test: 3 concurrent requests → exactly one `alreadyClosed: false`.
5. **LOW — reason of spaces.** `ReverseYearClosingDto.reason` is trimmed by `@Transform` before
   `MinLength(5)`/`MaxLength(500)`. Unit tests: 5 spaces → rejected, `"   abc   "` → rejected,
   `"  Late supplier invoice  "` → accepted and stored trimmed.
6. **LOW — reports `currentFiscalYear`** (`accounting-reports.service.ts`) now filters `deletedAt: null`.

- **Also:** `cost-allocation-runs.service.ts` passes `rangeDateOf(periodStart/End)` (the calendar dates the stored
  bounds name) to cost analytics, instead of `toISOString().slice(0, 10)`.
- **Verification:**
  - API jest (`--maxWorkers=4`) on `src/accounting`, journal-entries, capital-returns, capital-contributions,
    investor*, investment*, `common/time` and cost-allocation: **29 suites / 219 tests pass**.
  - Serial (`--testPathIgnorePatterns /node_modules/`): the bootstrap, year-closing cycle and capital-return
    correction specs pass 3/3; the reports serial specs pass 12/12. The local DB was verified clean afterwards.
  - API `tsc` clean. ESLint on the changed files is clean.
