# W5 — Company partners and profit sharing ("الشركاء")

## 1. Reuse and distinction

- Identity reuses the party master: a company partner is a `Partner` with role `OWNER` (exists, unused).
  Investors (`InvestorProfile`, per-opportunity profit) stay separate; customers/suppliers/agents are
  other roles. A partner may hold several roles; the partner screens list only `OWNER` profiles.
- Accounting reuses `PostingEngineService` with a new provider and two posting settings; payments reuse
  the financial-account selection used by investor distribution payments. No ordinary expense posting.
- No external login is created. Partner screens are internal (`company-partners.*` permissions).

## 2. Model

- `CompanyPartnerProfile (partnerId unique, ownershipPercent?, notes, status ACTIVE|INACTIVE)` — legal
  ownership, informational only, labelled separately.
- `PartnerAgreement (partnerId, profitSharePercent, basis GROSS_PROFIT|NET_PROFIT, effectiveFrom,
effectiveTo?, frequency MONTHLY|QUARTERLY|ANNUAL, scope ALL (activity scope reserved: ALL only in R14),
status DRAFT|ACTIVE|ENDED, supersedesId?)` — history kept; changing a percentage = end the agreement
  and start a new one (no in-place edit once active).
- `PartnerProfitPeriod (periodFrom, periodTo, status PREVIEW|CLOSED, closedAt/By, snapshot Json,
journalEntryId)` unique on (periodFrom, periodTo).
- `PartnerEntitlement (periodId, partnerId, agreementId, basis, baseAmount, percent, days, amount,
kind ORIGINAL|ADJUSTMENT, journalEntryId)`.
- `PartnerPayment (partnerId, amount, date, financialAccountId, reference, journalEntryId, reversedAt)`.

## 3. Profit definitions (journal-based, `accounting-reports.service.ts incomeStatement`)

- **Gross profit** = net revenue (gross revenue − returns − discounts/deductions) − cost of sales
  (`buildIncomeStatement.grossProfit`). Taxes are never revenue (VAT is a liability).
- **Net profit** = `netIncome` of the same statement: gross profit − selling (shipping, payment-provider
  fees, fulfillment) − administrative − other ± FX − finance costs (+ other income).
- B2B and online sales both post `SALES_INVOICE` journals → each sale counted once.
- Partner distributions post to equity/liability accounts, never to P&L → no circularity. Investor
  profit distributions (if their account is an expense) reduce the company profit before partners.
- Period profit uses the functional currency (Settings base currency).

## 4. Calculation rules

- Period = closing window (month/quarter/year per the agreement frequency; all active agreements must
  share one frequency per pool in R14 — validated).
- Mid-period agreement change: the period is split into segments by agreement dates; each segment's
  base = income-statement profit for that date range; entitlement = Σ segment base × percent.
- Loss: a segment/period with base ≤ 0 yields 0 entitlement. **Loss is not carried forward** (default —
  open decision D5-1).
- Rounding: per partner, 2 decimals half-up; no residual reallocation.
- Validation: Σ profitSharePercent of ACTIVE agreements overlapping any date ≤ 100 % (one company pool).

Numeric example (net basis): partners A 30 %, B 20 %; March revenue 100 000, COGS 55 000, expenses
25 000 → net 20 000 → A 6 000, B 4 000, company retains 10 000. If A changes to 40 % on 16 March, March
1–15 net 8 000, 16–31 net 12 000 → A = 8 000×30 % + 12 000×40 % = 7 200.

## 5. Workflow

Preview (live estimate, any date range, nothing stored) → Review (period preview saved with snapshot) →
Close/approve (one posting: Dr Partner profit distribution [equity] / Cr Partner profit payable, one
credit line per partner with Partner dimension; period status CLOSED; duplicate close refused by unique
period + posting-engine idempotency) → Record payment (Dr payable / Cr financial account). A payment
above the payable leaves a debit balance shown as "advance". Corrections to a closed period: recompute →
post an ADJUSTMENT entitlement (delta) linked to the period; the original snapshot is never changed.
Payment reversal posts a reversing entry.

Accounts: `PostingSettings.partnerProfitDistributionAccountId` (equity) and
`partnerProfitPayableAccountId` (liability), configured in Settings → Accounting; closing refuses with
an actionable message when missing.

## 6. Statement screen (per partner, selected period)

Percentage and basis, revenue, cost of sales, expenses, gross / net profit used, estimated live
entitlement (clearly labelled "تقديري") vs approved closed amounts, paid/withdrawn, remaining payable or
advance; drill-down to the income statement for the period and to journal entries. Summary cards use
`InsightCard`/`SummaryCard` on `InsightSurface`, RTL, mobile.

## 7. Permissions

`company-partners.view`, `.manage` (profiles, agreements), `.close` (close/adjust periods),
`.pay` (payments). Granted to nobody by migration except super admin.

## 8. Tests

Gross/net from a seeded ledger; segment split; loss → 0; Σ% > 100 rejected; close twice → 409; payment →
payable reduces; overpayment → advance; adjustment delta; JE balanced, equity/liability accounts only;
B2B + online sale counted once.
