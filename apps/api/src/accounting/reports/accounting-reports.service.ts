import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
  AccountType,
  ChartOfAccount,
  FinancialTransactionStatus,
  JournalEntryStatus,
  Prisma,
  PurchaseDocumentStatus,
  SalesDocumentStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { buildDateRangeFilter } from '../../sales/shared/sales-list-query.util';
import { POSTING_ROLE_SETTINGS } from '../foundation/standard-chart-of-accounts';
import { ReportQueryBaseDto } from './dto/report-query-base.dto';
import { GeneralLedgerQueryDto } from './dto/general-ledger-query.dto';
import { TrialBalanceQueryDto } from './dto/trial-balance-query.dto';
import { JournalReportQueryDto } from './dto/journal-report-query.dto';
import { AccountStatementQueryDto } from './dto/account-statement-query.dto';
import { BalanceSheetQueryDto } from './dto/balance-sheet-query.dto';
import { IncomeStatementQueryDto } from './dto/income-statement-query.dto';
import { CashFlowQueryDto } from './dto/cash-flow-query.dto';
import { AgingQueryDto } from './dto/aging-query.dto';
import { PartnerStatementQueryDto } from './dto/partner-statement-query.dto';
import { ExchangeRatesService } from '../fx/exchange-rates.service';
import {
  agingBucket,
  daysOutstanding,
  emptyAgingBuckets,
  type AgingBucket,
} from './aging.util';
import {
  buildAccountForest,
  buildCashMovementReport,
  roundReportMoney,
  type AccountAmounts,
  type CoaNode,
  type HierarchicalReportLine,
} from './financial-report-tree';
import {
  buildBalanceSheet,
  buildCashFlowActivities,
  buildIncomeStatement,
  effectiveSourceType,
  type ReportWarning,
} from './financial-statements';
import {
  buildClassificationContext,
  type ReportRole,
  type RoleAssignment,
} from './statement-classification';
import {
  asOfEndOfDay,
  ENTRY_LINE_ORDER,
  journalReportOrder,
  OPENING_BALANCE_SOURCE_TYPE,
  openingScope,
  periodScope,
  reportEntryScope,
  reportStatusFilter,
  withoutYearClosing,
  YEAR_CLOSING_SOURCE_TYPE,
  yearClosingOf,
} from './report-scope';
import {
  buildLedgerMovements,
  LEDGER_LINE_INCLUDE,
  LEDGER_LINE_ORDER,
  type LedgerLine,
} from './ledger-movements';

export interface StatementRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  balance: number;
}

const DEBIT_NORMAL_TYPES: AccountType[] = [
  AccountType.ASSET,
  AccountType.EXPENSE,
];

/**
 * TASK-047 Financial Reports — read-only reporting layer over the Journal
 * Entries the Posting Engine (TASK-046) already produces. Never writes
 * anything; every balance here is derived from `JournalEntryLine` rows at
 * request time, the same "movement-based, nothing stored directly" pattern
 * the Inventory Engine uses for on-hand quantity.
 *
 * REVERSED entries are always included in balance math even when
 * `postedOnly` is true — only DRAFT is ever excluded, since excluding a
 * REVERSED entry while keeping its separate POSTED reversing entry would
 * asymmetrically corrupt every computed balance.
 */
@Injectable()
export class AccountingReportsService {
  /** Presentation conversions resolve rates through the shared FX service so
   *  dated overrides and the staleness window apply exactly as in posting. */
  private readonly fx: ExchangeRatesService;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() fx?: ExchangeRatesService,
  ) {
    this.fx = fx ?? new ExchangeRatesService(prisma);
  }

  /** Rate FOREIGN → functional for display; never assumed — errors surface as a code. */
  private async presentationRate(
    fromCurrencyId: string,
    toCurrencyId: string,
    asOf: Date,
  ): Promise<
    | { ok: true; rate: number; effectiveDate: Date; source: string }
    | { ok: false; error: string }
  > {
    try {
      const r = await this.fx.resolveRateDetailed(
        fromCurrencyId,
        toCurrencyId,
        asOf,
      );
      return {
        ok: true,
        rate: r.rate,
        effectiveDate: r.effectiveDate,
        source: r.source,
      };
    } catch (error) {
      const code = (
        error as { getResponse?: () => unknown }
      ).getResponse?.() as { code?: string } | undefined;
      return { ok: false, error: code?.code ?? 'MISSING_EXCHANGE_RATE' };
    }
  }

  private buildStatusFilter(
    postedOnly?: boolean,
  ): Prisma.EnumJournalEntryStatusFilter {
    return reportStatusFilter(postedOnly);
  }

  private buildEntryScopeWhere(
    filters: ReportQueryBaseDto,
  ): Prisma.JournalEntryWhereInput {
    return reportEntryScope(filters);
  }

  /**
   * One account's ledger (Account Statement) — the same math as the
   * General Ledger, so a single-account statement always equals that
   * account's General Ledger block.
   */
  private async computeAccountLedger(
    accountId: string,
    filters: ReportQueryBaseDto,
  ) {
    const account = await this.prisma.chartOfAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) {
      throw new NotFoundException(`Account ${accountId} not found`);
    }
    const [ledger] = await this.computeAccountLedgers([account], filters);
    return ledger;
  }

  /**
   * General Ledger — per account: opening balance (everything before
   * `dateFrom`), every dated movement in the period with its running
   * balance, and the closing balance. Debit-positive throughout (the same
   * sign convention as the Trial Balance) and amounts are the functional
   * currency figures stored on the Journal Entry lines.
   *
   * By default only accounts that carry an opening balance or a movement are
   * listed — exactly the Trial Balance's account set — and `totals` covers
   * every matched account (not only the current page), computed through the
   * same aggregation the Trial Balance uses, so GL totals = TB totals.
   */
  async generalLedger(query: GeneralLedgerQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const selectedIds = [
      ...new Set([
        ...(query.accountIds ?? []),
        ...(query.accountId ? [query.accountId] : []),
      ]),
    ];
    const scopeWhere = this.buildEntryScopeWhere(query);

    const [periodAgg, openingAgg] = await Promise.all([
      this.aggregateAccountDebitCredit({
        ...scopeWhere,
        entryDate: buildDateRangeFilter(query.dateFrom, query.dateTo),
      }),
      query.dateFrom
        ? this.aggregateAccountDebitCredit({
            ...scopeWhere,
            entryDate: { lt: new Date(query.dateFrom) },
          })
        : Promise.resolve(new Map<string, { debit: number; credit: number }>()),
    ]);

    const conditions: Prisma.ChartOfAccountWhereInput[] = [];
    if (selectedIds.length > 0) conditions.push({ id: { in: selectedIds } });
    if (!query.includeEmpty) {
      conditions.push({
        id: { in: [...new Set([...periodAgg.keys(), ...openingAgg.keys()])] },
      });
    }
    if (query.search) {
      conditions.push({
        OR: [
          { code: { contains: query.search, mode: 'insensitive' } },
          { name: { contains: query.search, mode: 'insensitive' } },
          { nameEn: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }
    const accountWhere: Prisma.ChartOfAccountWhereInput = {
      deletedAt: null,
      ...(conditions.length > 0 && { AND: conditions }),
    };

    const [matched, accounts] = await Promise.all([
      this.prisma.chartOfAccount.findMany({
        where: accountWhere,
        select: { id: true },
      }),
      this.prisma.chartOfAccount.findMany({
        where: accountWhere,
        orderBy: { code: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const totals = matched.reduce(
      (acc, { id }) => {
        const period = periodAgg.get(id) ?? { debit: 0, credit: 0 };
        const openingRaw = openingAgg.get(id) ?? { debit: 0, credit: 0 };
        const opening = roundReportMoney(openingRaw.debit - openingRaw.credit);
        const debit = roundReportMoney(period.debit);
        const credit = roundReportMoney(period.credit);
        acc.openingBalance += opening;
        acc.periodDebit += debit;
        acc.periodCredit += credit;
        acc.closingBalance += roundReportMoney(opening + debit - credit);
        return acc;
      },
      { openingBalance: 0, periodDebit: 0, periodCredit: 0, closingBalance: 0 },
    );

    const items = await this.computeAccountLedgers(accounts, query);

    return {
      items,
      total: matched.length,
      page,
      pageSize,
      totals: {
        openingBalance: roundReportMoney(totals.openingBalance),
        periodDebit: roundReportMoney(totals.periodDebit),
        periodCredit: roundReportMoney(totals.periodCredit),
        closingBalance: roundReportMoney(totals.closingBalance),
      },
      balanced: Math.abs(totals.periodDebit - totals.periodCredit) < 0.01,
    };
  }

  /**
   * Batched ledger for a list of accounts: one opening-balance groupBy and
   * one date-sorted lines findMany for all of them (never 2 queries per
   * account). Splitting a single entryDate/entryNumber/lineOrder-sorted
   * result set by accountId preserves each account's relative order, so
   * every running balance equals the single-account computation.
   */
  private async computeAccountLedgers(
    accounts: ChartOfAccount[],
    filters: ReportQueryBaseDto,
  ) {
    if (accounts.length === 0) return [];
    const accountIds = accounts.map((a) => a.id);
    const scopeWhere = this.buildEntryScopeWhere(filters);

    const [openingGroups, lines] = await Promise.all([
      filters.dateFrom
        ? this.prisma.journalEntryLine.groupBy({
            by: ['accountId'],
            where: {
              accountId: { in: accountIds },
              journalEntry: {
                ...scopeWhere,
                entryDate: { lt: new Date(filters.dateFrom) },
              },
            },
            _sum: { debit: true, credit: true },
          })
        : Promise.resolve([]),
      this.prisma.journalEntryLine.findMany({
        where: {
          accountId: { in: accountIds },
          journalEntry: {
            ...scopeWhere,
            entryDate: buildDateRangeFilter(filters.dateFrom, filters.dateTo),
          },
        },
        include: LEDGER_LINE_INCLUDE,
        orderBy: LEDGER_LINE_ORDER,
      }),
    ]);

    const openingByAccount = new Map(
      openingGroups.map((g) => [
        g.accountId,
        roundReportMoney(
          Number(g._sum.debit ?? 0) - Number(g._sum.credit ?? 0),
        ),
      ]),
    );
    const linesByAccount = new Map<string, LedgerLine[]>();
    for (const line of lines) {
      const existing = linesByAccount.get(line.accountId);
      if (existing) {
        existing.push(line);
      } else {
        linesByAccount.set(line.accountId, [line]);
      }
    }

    return accounts.map((account) => {
      const openingBalance = openingByAccount.get(account.id) ?? 0;
      const { movements, periodDebit, periodCredit, closingBalance } =
        buildLedgerMovements(
          linesByAccount.get(account.id) ?? [],
          openingBalance,
        );
      return {
        account: {
          id: account.id,
          code: account.code,
          name: account.name,
          nameEn: account.nameEn,
          accountType: account.accountType,
        },
        openingBalance,
        periodDebit,
        periodCredit,
        closingBalance,
        movements,
      };
    });
  }

  async trialBalance(query: TrialBalanceQueryDto) {
    const includeOpening = query.includeOpeningBalance !== false;
    const scopeWhere = this.buildEntryScopeWhere(query);
    const periodWhere: Prisma.JournalEntryWhereInput = {
      ...scopeWhere,
      entryDate: buildDateRangeFilter(query.dateFrom, query.dateTo),
    };
    const openingWhere: Prisma.JournalEntryWhereInput | null =
      includeOpening && query.dateFrom
        ? { ...scopeWhere, entryDate: { lt: new Date(query.dateFrom) } }
        : null;

    const [periodAgg, openingAgg, accounts] = await Promise.all([
      this.aggregateAccountDebitCredit(periodWhere),
      openingWhere
        ? this.aggregateAccountDebitCredit(openingWhere)
        : Promise.resolve(new Map<string, { debit: number; credit: number }>()),
      this.loadCoaNodes(),
    ]);

    const leafAmounts: AccountAmounts = {};
    const accountIds = new Set([...periodAgg.keys(), ...openingAgg.keys()]);
    const postingRows = [];

    for (const accountId of accountIds) {
      const period = periodAgg.get(accountId) ?? { debit: 0, credit: 0 };
      const openingRaw = openingAgg.get(accountId) ?? { debit: 0, credit: 0 };
      const opening = roundReportMoney(openingRaw.debit - openingRaw.credit);
      const debit = roundReportMoney(period.debit);
      const credit = roundReportMoney(period.credit);
      const closing = roundReportMoney(opening + debit - credit);
      leafAmounts[accountId] = { opening, debit, credit, closing };
    }

    const valueKeys = ['opening', 'debit', 'credit', 'closing'];
    const forest = buildAccountForest(accounts, leafAmounts, valueKeys, {
      hideZero: true,
    });
    const lines = this.filterReportForest(forest, query.search);

    // Every account that actually carries postings is a TB row — including a
    // group account that (legacy data, or a mapping later changed to a
    // header) received postings directly. Leaving those out made debit and
    // credit totals disagree even though the ledger itself balances.
    for (const account of accounts) {
      const amounts = leafAmounts[account.id];
      if (!amounts) continue;
      postingRows.push({
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        accountType: account.accountType,
        openingBalance: amounts.opening,
        debitTotal: amounts.debit,
        creditTotal: amounts.credit,
        closingBalance: amounts.closing,
        balance: amounts.closing,
      });
    }
    postingRows.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

    const search = query.search?.toLowerCase();
    const filteredRows = search
      ? postingRows.filter(
          (r) =>
            r.accountCode.toLowerCase().includes(search) ||
            r.accountName.toLowerCase().includes(search),
        )
      : postingRows;

    const totals = filteredRows.reduce(
      (acc, r) => ({
        openingBalance: acc.openingBalance + r.openingBalance,
        debitTotal: acc.debitTotal + r.debitTotal,
        creditTotal: acc.creditTotal + r.creditTotal,
        closingBalance: acc.closingBalance + r.closingBalance,
        closingDebit: acc.closingDebit + Math.max(r.closingBalance, 0),
        closingCredit: acc.closingCredit + Math.max(-r.closingBalance, 0),
      }),
      {
        openingBalance: 0,
        debitTotal: 0,
        creditTotal: 0,
        closingBalance: 0,
        closingDebit: 0,
        closingCredit: 0,
      },
    );
    const rounded = {
      debitTotal: roundReportMoney(totals.debitTotal),
      creditTotal: roundReportMoney(totals.creditTotal),
      openingBalance: roundReportMoney(totals.openingBalance),
      closingBalance: roundReportMoney(totals.closingBalance),
      closingDebit: roundReportMoney(totals.closingDebit),
      closingCredit: roundReportMoney(totals.closingCredit),
    };
    const periodDifference = roundReportMoney(
      rounded.debitTotal - rounded.creditTotal,
    );
    const warnings = await this.integrityWarnings(query);

    return {
      items: filteredRows,
      total: filteredRows.length,
      page: 1,
      pageSize: filteredRows.length,
      totals: rounded,
      includeOpeningBalance: includeOpening,
      balanced: Math.abs(periodDifference) < 0.01,
      /**
       * Opening, period and closing must each net to zero over the whole
       * ledger (debit-positive). Not meaningful while `search` narrows the
       * accounts — `filtered` says so.
       */
      checks: {
        filtered: Boolean(search),
        periodDifference,
        openingDifference: rounded.openingBalance,
        closingDifference: rounded.closingBalance,
        balanced:
          Math.abs(periodDifference) < 0.01 &&
          Math.abs(rounded.openingBalance) < 0.01 &&
          Math.abs(rounded.closingBalance) < 0.01,
      },
      period: {
        dateFrom: query.dateFrom ?? null,
        dateTo: query.dateTo ?? null,
      },
      warnings,
      lines,
    };
  }

  async journalReport(query: JournalReportQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const sortOrder = query.sortOrder ?? 'desc';

    const where: Prisma.JournalEntryWhereInput = {
      ...this.buildEntryScopeWhere(query),
      entryDate: buildDateRangeFilter(query.dateFrom, query.dateTo),
      ...(query.search && {
        OR: [
          { entryNumber: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
          { sourceType: { contains: query.search, mode: 'insensitive' } },
          {
            referenceNumber: { contains: query.search, mode: 'insensitive' },
          },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        include: {
          lines: { include: { account: true }, orderBy: ENTRY_LINE_ORDER },
        },
        orderBy: journalReportOrder(sortOrder),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async accountStatement(query: AccountStatementQueryDto) {
    return this.computeAccountLedger(query.accountId, query);
  }

  /**
   * Statement of Financial Position as of `dateTo` (`dateFrom` ignored).
   * Assets / liabilities are split current / non-current by the report-layer
   * classification (statement-classification.ts); anything unresolved is
   * shown as its own group with a warning. Unclosed profit is split into
   * prior periods (before the fiscal year containing the as-of date) and the
   * current fiscal year: current-year profit equals the Income Statement for
   * [fiscal-year start, as-of] while that year is not closed. Year Closing
   * entries are included here — they move profit into Retained Earnings and
   * keep the equation intact.
   *
   * `assets` / `liabilities` / `equity` rows and `currentEarnings` keep
   * their original meaning (by account type; cumulative unclosed P&L) for
   * Year Closing's next-year opening entry.
   */
  async balanceSheet(query: BalanceSheetQueryDto) {
    const asOfDate = asOfEndOfDay(query.dateTo);
    const scopeWhere = this.buildEntryScopeWhere(query);
    const fiscalYear = await this.currentFiscalYear(asOfDate);
    const fiscalYearStart = fiscalYear.startDate;

    const [
      sums,
      currentYearSums,
      currentYearClosingSums,
      rowsByType,
      accounts,
      ctx,
      cashIds,
    ] = await Promise.all([
      this.aggregateAccountDebitCredit({
        ...scopeWhere,
        entryDate: { lte: asOfDate },
      }),
      // Exactly the Income Statement's scope for [FY start, as-of].
      this.aggregateAccountDebitCredit(
        withoutYearClosing({
          ...scopeWhere,
          entryDate: { gte: fiscalYearStart, lte: asOfDate },
        }),
      ),
      // This fiscal year's own Year Closing and its reversals, whenever
      // dated (without a FiscalYear row: closings inside the year).
      this.aggregateAccountDebitCredit(
        fiscalYear.id
          ? {
              ...scopeWhere,
              entryDate: { lte: asOfDate },
              AND: [yearClosingOf(fiscalYear.id)],
            }
          : {
              ...scopeWhere,
              sourceType: YEAR_CLOSING_SOURCE_TYPE,
              entryDate: { gte: fiscalYearStart, lte: asOfDate },
            },
      ),
      this.groupBalancesByAccountType({
        ...scopeWhere,
        entryDate: { lte: asOfDate },
      }),
      this.loadCoaNodes(),
      this.loadClassificationContext(),
      this.resolveCashAccountIds(),
    ]);

    const statement = buildBalanceSheet({
      accounts,
      sums,
      currentYearSums,
      currentYearClosingSums,
      ctx,
      cashAccountIds: new Set(cashIds),
    });
    const warnings = [
      ...statement.warnings,
      ...(await this.integrityWarnings(query)),
    ];
    const discrepancy = statement.totals.balanced
      ? null
      : {
          difference: statement.totals.difference,
          unbalancedEntries: await this.unbalancedEntries(asOfDate),
        };

    return {
      asOfDate,
      fiscalYearStart,
      assets: rowsByType.ASSET,
      liabilities: rowsByType.LIABILITY,
      equity: rowsByType.EQUITY,
      currentEarnings: statement.currentEarnings,
      totals: statement.totals,
      discrepancy,
      warnings,
      lines: statement.lines,
    };
  }

  /**
   * Income Statement over [dateFrom, dateTo] — function-of-expense analysis
   * (IAS 1.99/103): revenue less returns/discounts, cost of sales, gross
   * profit, selling & distribution, general & administrative, operating
   * profit, then other income/expenses, finance costs, FX differences and
   * any unclassified accounts to net profit. Year Closing entries are
   * excluded (transfers to Retained Earnings, not income or expense).
   * `revenue` / `expense` rows and `totals.totalRevenue/totalExpense/
   * netIncome` keep their by-account-type meaning for Year Closing and
   * period-profit.
   */
  async incomeStatement(query: IncomeStatementQueryDto) {
    const where = withoutYearClosing(periodScope(query));
    const [sums, rowsByType, accounts, ctx] = await Promise.all([
      this.aggregateAccountDebitCredit(where),
      this.groupBalancesByAccountType(where),
      this.loadCoaNodes(),
      this.loadClassificationContext(),
    ]);
    const statement = buildIncomeStatement({ accounts, sums, ctx });
    const warnings = [
      ...statement.warnings,
      ...(await this.integrityWarnings(query)),
    ];

    return {
      revenue: rowsByType.REVENUE,
      expense: rowsByType.EXPENSE,
      totals: statement.totals,
      partitionDifference: statement.partitionDifference,
      period: {
        dateFrom: query.dateFrom ?? null,
        dateTo: query.dateTo ?? null,
      },
      warnings,
      lines: statement.lines,
    };
  }

  /**
   * Cash Flow Statement over [dateFrom, dateTo], direct method (IAS 7.18(a)).
   * Cash and cash equivalents = the ledger accounts behind Receiving
   * Accounts plus the configured Cash / Bank accounts
   * (`resolveCashAccountIds` — the same set the Balance Sheet's
   * `cashAndCashEquivalents` sums). Each entry's net cash movement is
   * attributed to its counterpart accounts and classified by them
   * (buildCashFlowActivities): operating / investing / financing, the
   * IAS 7.28 FX effect on cash, and transfers between cash accounts
   * excluded (IAS 7.9). `reconciliation` proves opening + activities + FX
   * effect = closing = opening + every cash-account line in the ledger.
   */
  async cashFlowStatement(query: CashFlowQueryDto) {
    const cashAccountIds = await this.resolveCashAccountIds();
    if (query.view === 'movement') {
      return this.cashMovement(query, cashAccountIds);
    }

    const opening = openingScope(query);
    const [openingBalance, closingCashBalance, entries, accounts, ctx] =
      await Promise.all([
        opening && cashAccountIds.length > 0
          ? this.prisma.journalEntryLine
              .aggregate({
                where: {
                  accountId: { in: cashAccountIds },
                  journalEntry: opening,
                },
                _sum: { debit: true, credit: true },
              })
              .then(
                (agg) =>
                  Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0),
              )
          : Promise.resolve(0),
        // Independent check figure: the cash accounts' balance as of the
        // period end, aggregated the way the Balance Sheet reads it.
        cashAccountIds.length > 0
          ? this.prisma.journalEntryLine
              .aggregate({
                where: {
                  accountId: { in: cashAccountIds },
                  journalEntry: {
                    ...this.buildEntryScopeWhere(query),
                    ...(query.dateTo && {
                      entryDate: { lte: asOfEndOfDay(query.dateTo) },
                    }),
                  },
                },
                _sum: { debit: true, credit: true },
              })
              .then(
                (agg) =>
                  Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0),
              )
          : Promise.resolve(0),
        cashAccountIds.length > 0
          ? this.prisma.journalEntry.findMany({
              where: {
                ...periodScope(query),
                lines: { some: { accountId: { in: cashAccountIds } } },
              },
              select: {
                id: true,
                sourceType: true,
                reversalOfEntry: { select: { sourceType: true } },
                lines: {
                  select: { accountId: true, debit: true, credit: true },
                },
              },
            })
          : Promise.resolve([]),
        this.loadCoaNodes(),
        this.loadClassificationContext(),
      ]);

    const statement = buildCashFlowActivities({
      entries: entries.map((entry) => ({
        entryId: entry.id,
        sourceType: effectiveSourceType(entry),
        lines: entry.lines.map((line) => ({
          accountId: line.accountId,
          debit: Number(line.debit),
          credit: Number(line.credit),
        })),
      })),
      accounts,
      ctx,
      cashAccountIds: new Set(cashAccountIds),
      openingCash: openingBalance,
      closingCashBalance,
    });
    const { reconciliation } = statement;

    return {
      view: 'activities' as const,
      method: 'direct' as const,
      openingBalance: reconciliation.openingCash,
      movements: statement.movements,
      totals: {
        netCashChange: reconciliation.netChange,
        closingBalance: reconciliation.closingCash,
      },
      reconciliation,
      cashAccountIds,
      warnings: [
        ...statement.warnings,
        ...(await this.integrityWarnings(query)),
      ],
      lines: statement.lines,
      sections: statement.sections,
    };
  }

  /**
   * Cash Flow — "movement" view: per cash/bank account opening balance,
   * period inflows (debits), outflows (credits), net change and closing
   * balance, all from journal lines with the same scope as the activities
   * view, so both views agree on opening, net change and closing cash.
   */
  private async cashMovement(
    query: CashFlowQueryDto,
    cashAccountIds: string[],
  ) {
    const opening = openingScope(query);
    const [accounts, openingRows, period] = await Promise.all([
      this.prisma.chartOfAccount.findMany({
        where: { id: { in: cashAccountIds } },
        select: { id: true, code: true, name: true, nameEn: true },
      }),
      opening
        ? this.prisma.journalEntryLine.groupBy({
            by: ['accountId'],
            where: {
              accountId: { in: cashAccountIds },
              journalEntry: opening,
            },
            _sum: { debit: true, credit: true },
          })
        : Promise.resolve([]),
      this.prisma.journalEntryLine.groupBy({
        by: ['accountId'],
        where: {
          accountId: { in: cashAccountIds },
          journalEntry: periodScope(query),
        },
        _sum: { debit: true, credit: true },
      }),
    ]);
    const { lines, totals } = buildCashMovementReport(
      accounts,
      new Map(
        openingRows.map((row) => [
          row.accountId,
          Number(row._sum.debit ?? 0) - Number(row._sum.credit ?? 0),
        ]),
      ),
      new Map(
        period.map((row) => [
          row.accountId,
          {
            debit: Number(row._sum.debit ?? 0),
            credit: Number(row._sum.credit ?? 0),
          },
        ]),
      ),
    );
    return {
      view: 'movement' as const,
      openingBalance: totals.openingBalance,
      totals,
      lines,
    };
  }

  /** Every account's signed balance (normal side positive), grouped by AccountType. */
  private async groupBalancesByAccountType(
    entryWhere: Prisma.JournalEntryWhereInput,
  ): Promise<Record<AccountType, StatementRow[]>> {
    const sums = await this.aggregateAccountDebitCredit(entryWhere);
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { id: { in: [...sums.keys()] } },
    });
    const accountMap = new Map(accounts.map((a) => [a.id, a]));

    const rowsByType: Record<AccountType, StatementRow[]> = {
      ASSET: [],
      LIABILITY: [],
      EQUITY: [],
      REVENUE: [],
      EXPENSE: [],
    };

    for (const [accountId, { debit, credit }] of sums) {
      const account = accountMap.get(accountId);
      if (!account) continue;
      const balance = DEBIT_NORMAL_TYPES.includes(account.accountType)
        ? debit - credit
        : credit - debit;
      rowsByType[account.accountType].push({
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        balance: roundReportMoney(balance),
      });
    }

    for (const type of Object.keys(rowsByType) as AccountType[]) {
      rowsByType[type].sort((a, b) =>
        a.accountCode.localeCompare(b.accountCode),
      );
    }

    return rowsByType;
  }

  /**
   * Every Chart of Accounts row, including archived (soft-deleted) ones:
   * an archived account that still carries postings must stay in the
   * statement trees, or a tree would no longer add up to its totals. Rows
   * with no amounts are hidden by the tree builder anyway.
   */
  private async loadCoaNodes(): Promise<CoaNode[]> {
    return this.prisma.chartOfAccount.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        nameEn: true,
        accountType: true,
        parentAccountId: true,
        level: true,
        allowsPosting: true,
      },
      orderBy: { code: 'asc' },
    });
  }

  /**
   * Cash and cash equivalents (IAS 7.6-7.8) — the ledger accounts behind
   * every Receiving Account (the cash/bank accounts payments are received
   * into and paid from) plus the configured default Cash / Bank accounts.
   * One set for the Cash Flow and the Balance Sheet cash figure.
   */
  private async resolveCashAccountIds(): Promise<string[]> {
    const [receiving, settings] = await Promise.all([
      this.prisma.receivingAccount.findMany({
        select: { chartOfAccountId: true },
      }),
      this.prisma.postingSettings.findFirst({
        select: { cashAccountId: true, bankAccountId: true },
      }),
    ]);
    return [
      ...new Set(
        [
          ...receiving.map((row) => row.chartOfAccountId),
          settings?.cashAccountId,
          settings?.bankAccountId,
        ].filter((id): id is string => Boolean(id)),
      ),
    ];
  }

  /**
   * The account roles the statements are classified by — read from the
   * existing account mappings (Posting Settings, agent accounts, product
   * categories, customer / supplier groups and profiles, payment-method
   * clearing accounts, receiving accounts, partner control accounts).
   * Nothing is inferred from names.
   */
  private async loadClassificationContext() {
    const [
      accounts,
      settings,
      categories,
      customerGroups,
      supplierGroups,
      supplierProfiles,
      paymentMethods,
      cashIds,
      controls,
    ] = await Promise.all([
      this.loadCoaNodes(),
      this.prisma.postingSettings.findFirst(),
      this.prisma.productCategory.findMany({
        select: {
          revenueAccountId: true,
          cogsAccountId: true,
          inventoryAccountId: true,
          purchaseAccountId: true,
        },
      }),
      this.prisma.customerGroup.findMany({
        select: { defaultRevenueAccountId: true },
      }),
      this.prisma.supplierGroup.findMany({
        select: { defaultPurchaseAccountId: true },
      }),
      this.prisma.supplierProfile.findMany({
        select: { defaultExpenseAccountId: true },
      }),
      this.prisma.paymentMethod.findMany({ select: { accountId: true } }),
      this.resolveCashAccountIds(),
      this.prisma.chartOfAccount.findMany({
        where: { partnerControlType: { not: null } },
        select: { id: true, partnerControlType: true },
      }),
    ]);

    const roles: RoleAssignment[] = [];
    const push = (accountId: string | null | undefined, role: ReportRole) => {
      if (accountId) roles.push({ accountId, role });
    };
    if (settings) {
      const record = settings as unknown as Record<string, string | null>;
      for (const [role, field] of Object.entries(POSTING_ROLE_SETTINGS)) {
        if (field) push(record[field], role as ReportRole);
      }
      push(
        settings.agentCommissionRevenueAccountId,
        'AGENT_COMMISSION_REVENUE',
      );
      push(settings.agentServiceRevenueAccountId, 'AGENT_SERVICE_REVENUE');
      push(settings.agentFundsPayableAccountId, 'AGENT_FUNDS_PAYABLE');
    }
    for (const row of categories) {
      push(row.revenueAccountId, 'SALES_REVENUE');
      push(row.cogsAccountId, 'COGS');
      push(row.inventoryAccountId, 'INVENTORY');
      push(row.purchaseAccountId, 'PURCHASE');
    }
    for (const row of customerGroups)
      push(row.defaultRevenueAccountId, 'SALES_REVENUE');
    for (const row of supplierGroups)
      push(row.defaultPurchaseAccountId, 'PURCHASE');
    for (const row of supplierProfiles)
      push(row.defaultExpenseAccountId, 'OPERATING_EXPENSE');
    for (const row of paymentMethods) push(row.accountId, 'PAYMENT_CLEARING');
    for (const id of cashIds) push(id, 'CASH_ACCOUNT');
    for (const row of controls) {
      push(
        row.id,
        row.partnerControlType === 'RECEIVABLE'
          ? 'PARTNER_RECEIVABLE'
          : 'PARTNER_PAYABLE',
      );
    }
    return buildClassificationContext(accounts, roles);
  }

  /**
   * The fiscal year containing `asOf` (FiscalYear table); without one,
   * 1 January (UTC) of the as-of year and no id.
   */
  private async currentFiscalYear(
    asOf: Date,
  ): Promise<{ id: string | null; startDate: Date }> {
    const dayStart = new Date(
      Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
    );
    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { startDate: { lte: asOf }, endDate: { gte: dayStart } },
      orderBy: { startDate: 'desc' },
      select: { id: true, startDate: true },
    });
    return (
      fiscalYear ?? {
        id: null,
        startDate: new Date(Date.UTC(asOf.getUTCFullYear(), 0, 1)),
      }
    );
  }

  /**
   * Scope-level warnings shared by every statement: drafts included, and a
   * Year Closing carry-forward Opening entry (posted after a Year Closing)
   * which, in this cumulative ledger, repeats balances already carried by
   * the prior-year entries.
   */
  private async integrityWarnings(
    query: ReportQueryBaseDto,
  ): Promise<ReportWarning[]> {
    const warnings: ReportWarning[] = [];
    if (query.postedOnly === false) warnings.push({ code: 'DRAFTS_INCLUDED' });
    const firstClosing = await this.prisma.journalEntry.findFirst({
      where: {
        deletedAt: null,
        sourceType: YEAR_CLOSING_SOURCE_TYPE,
        status: JournalEntryStatus.POSTED,
      },
      orderBy: { entryDate: 'asc' },
      select: { entryDate: true },
    });
    if (firstClosing) {
      const openings = await this.prisma.journalEntry.findMany({
        where: {
          deletedAt: null,
          sourceType: OPENING_BALANCE_SOURCE_TYPE,
          status: JournalEntryStatus.POSTED,
          entryDate: { gt: firstClosing.entryDate },
        },
        select: { id: true, entryNumber: true },
        take: 20,
      });
      if (openings.length > 0) {
        warnings.push({
          code: 'CARRY_FORWARD_OPENING_ENTRY',
          entries: openings.map((row) => ({
            id: row.id,
            entryNumber: row.entryNumber,
            difference: 0,
          })),
        });
      }
    }
    return warnings;
  }

  /** Drill-down for an unbalanced statement: entries whose lines do not net to zero. */
  private async unbalancedEntries(asOf: Date) {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; entry_number: string; difference: unknown }>
    >(Prisma.sql`
      SELECT e.id, e.entry_number, SUM(l.debit) - SUM(l.credit) AS difference
      FROM journal_entry_lines l
      JOIN journal_entries e ON e.id = l.journal_entry_id
      WHERE e.deleted_at IS NULL
        AND e.status::text IN ('POSTED', 'REVERSED')
        AND e.entry_date <= ${asOf}
      GROUP BY e.id, e.entry_number
      HAVING ABS(SUM(l.debit) - SUM(l.credit)) >= 0.005
      ORDER BY e.entry_number
      LIMIT 50`);
    return rows.map((row) => ({
      id: row.id,
      entryNumber: row.entry_number,
      difference: roundReportMoney(Number(row.difference)),
    }));
  }

  private async aggregateAccountDebitCredit(
    entryWhere: Prisma.JournalEntryWhereInput,
  ) {
    const grouped = await this.prisma.journalEntryLine.groupBy({
      by: ['accountId'],
      where: { journalEntry: entryWhere },
      _sum: { debit: true, credit: true },
    });
    return new Map(
      grouped.map((row) => [
        row.accountId,
        {
          debit: Number(row._sum.debit ?? 0),
          credit: Number(row._sum.credit ?? 0),
        },
      ]),
    );
  }

  private filterReportForest(
    lines: HierarchicalReportLine[],
    search?: string,
  ): HierarchicalReportLine[] {
    const term = search?.trim().toLowerCase();
    if (!term) return lines;
    const match = (
      line: HierarchicalReportLine,
    ): HierarchicalReportLine | null => {
      const children = line.children
        .map((child) => match(child))
        .filter((child): child is HierarchicalReportLine => child !== null);
      const self =
        (line.code ?? '').toLowerCase().includes(term) ||
        line.label.toLowerCase().includes(term) ||
        (line.labelEn ?? '').toLowerCase().includes(term);
      if (!self && children.length === 0) return null;
      return { ...line, children, expandable: children.length > 0 };
    };
    return lines
      .map((line) => match(line))
      .filter((line): line is HierarchicalReportLine => line !== null);
  }

  async arAging(query: AgingQueryDto) {
    return this.invoiceAging('AR', query);
  }

  async apAging(query: AgingQueryDto) {
    return this.invoiceAging('AP', query);
  }

  /**
   * Customer / Supplier Statement — the partner's control-account lines
   * (Receivable for a customer, Payable for a supplier, via `controlType`)
   * read straight from Journal Entries: opening balance before `dateFrom`,
   * every invoice / receipt / payment / return / credit in the period with a
   * running balance, and the closing balance. Debit-positive, like the
   * General Ledger, so a supplier's payable shows as a negative (credit)
   * balance. Always returned in full: a paged slice would restart the
   * running balance and report a wrong closing balance.
   */
  async partnerStatement(query: PartnerStatementQueryDto) {
    const partner = await this.prisma.partner.findFirst({
      where: { id: query.partnerId, deletedAt: null },
      select: { id: true, partnerNumber: true, name: true },
    });
    if (!partner) {
      throw new NotFoundException(`Partner ${query.partnerId} not found`);
    }

    const scopeWhere = this.buildEntryScopeWhere(query);
    const accountFilter: Prisma.JournalEntryLineWhereInput = query.controlType
      ? { account: { partnerControlType: query.controlType } }
      : {};

    const [openingAgg, lines] = await Promise.all([
      query.dateFrom
        ? this.prisma.journalEntryLine.aggregate({
            where: {
              partnerId: partner.id,
              ...accountFilter,
              journalEntry: {
                ...scopeWhere,
                entryDate: { lt: new Date(query.dateFrom) },
              },
            },
            _sum: { debit: true, credit: true },
          })
        : Promise.resolve({ _sum: { debit: 0, credit: 0 } }),
      this.prisma.journalEntryLine.findMany({
        where: {
          partnerId: partner.id,
          ...accountFilter,
          journalEntry: {
            ...scopeWhere,
            entryDate: buildDateRangeFilter(query.dateFrom, query.dateTo),
          },
        },
        include: LEDGER_LINE_INCLUDE,
        orderBy: LEDGER_LINE_ORDER,
      }),
    ]);

    const openingBalance = roundReportMoney(
      Number(openingAgg._sum.debit ?? 0) - Number(openingAgg._sum.credit ?? 0),
    );
    const { movements, periodDebit, periodCredit, closingBalance } =
      buildLedgerMovements(lines, openingBalance);

    return {
      partner,
      controlType: query.controlType ?? null,
      openingBalance,
      periodDebit,
      periodCredit,
      closingBalance,
      movements,
      total: movements.length,
      page: 1,
      pageSize: movements.length,
    };
  }

  private async invoiceAging(side: 'AR' | 'AP', query: AgingQueryDto) {
    const asOf = query.dateTo
      ? new Date(new Date(query.dateTo).getTime() + (24 * 60 * 60 * 1000 - 1))
      : new Date();
    const invoiceKey = side === 'AR' ? 'salesInvoiceId' : 'purchaseInvoiceId';
    const openStatuses =
      side === 'AR'
        ? [SalesDocumentStatus.CONFIRMED, SalesDocumentStatus.CLOSED]
        : [PurchaseDocumentStatus.CONFIRMED, PurchaseDocumentStatus.CLOSED];

    const invoices =
      side === 'AR'
        ? await this.prisma.salesInvoice.findMany({
            where: {
              deletedAt: null,
              status: { in: openStatuses },
              ...(query.partnerId ? { partnerId: query.partnerId } : {}),
              ...(query.companyId ? { companyId: query.companyId } : {}),
              ...(query.branchId ? { branchId: query.branchId } : {}),
              ...(query.currencyId ? { currencyId: query.currencyId } : {}),
              OR: [
                { confirmedAt: { lte: asOf } },
                { confirmedAt: null, createdAt: { lte: asOf } },
              ],
            },
            select: {
              id: true,
              invoiceNumber: true,
              partnerId: true,
              grandTotal: true,
              confirmedAt: true,
              createdAt: true,
              partner: {
                select: { id: true, partnerNumber: true, name: true },
              },
            },
          })
        : await this.prisma.purchaseInvoice.findMany({
            where: {
              deletedAt: null,
              status: { in: openStatuses },
              ...(query.partnerId ? { partnerId: query.partnerId } : {}),
              ...(query.companyId ? { companyId: query.companyId } : {}),
              ...(query.branchId ? { branchId: query.branchId } : {}),
              ...(query.currencyId ? { currencyId: query.currencyId } : {}),
              OR: [
                { confirmedAt: { lte: asOf } },
                { confirmedAt: null, createdAt: { lte: asOf } },
              ],
            },
            select: {
              id: true,
              invoiceNumber: true,
              partnerId: true,
              grandTotal: true,
              confirmedAt: true,
              createdAt: true,
              partner: {
                select: { id: true, partnerNumber: true, name: true },
              },
            },
          });

    const invoiceIds = invoices.map((row) => row.id);
    const allocatedByInvoice = new Map<string, number>();
    if (invoiceIds.length > 0) {
      const grouped = await this.prisma.financialTransactionAllocation.groupBy({
        by: [invoiceKey],
        where: {
          [invoiceKey]: { in: invoiceIds },
          transaction: {
            status: FinancialTransactionStatus.CONFIRMED,
            deletedAt: null,
            transactionDate: { lte: asOf },
          },
        },
        _sum: { allocatedAmount: true },
      });
      for (const row of grouped) {
        const id = row[invoiceKey];
        if (id)
          allocatedByInvoice.set(id, Number(row._sum.allocatedAmount ?? 0));
      }
    }

    const byPartner = new Map<
      string,
      {
        partnerId: string;
        partnerNumber: string;
        partnerName: string;
        current: number;
        days31to60: number;
        days61to90: number;
        over90: number;
        total: number;
      }
    >();

    const invoicesOut: Array<{
      invoiceId: string;
      invoiceNumber: string;
      partnerId: string;
      partnerName: string;
      invoiceDate: Date;
      daysOutstanding: number;
      bucket: AgingBucket;
      grandTotal: number;
      allocated: number;
      remaining: number;
    }> = [];

    for (const invoice of invoices) {
      const grandTotal = Number(invoice.grandTotal);
      const allocated = allocatedByInvoice.get(invoice.id) ?? 0;
      const remaining = Math.max(
        Math.round((grandTotal - allocated) * 100) / 100,
        0,
      );
      if (remaining <= 0) continue;
      const invoiceDate = invoice.confirmedAt ?? invoice.createdAt;
      const days = daysOutstanding(asOf, invoiceDate);
      const bucket = agingBucket(days);
      invoicesOut.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        partnerId: invoice.partnerId,
        partnerName: invoice.partner.name,
        invoiceDate,
        daysOutstanding: days,
        bucket,
        grandTotal,
        allocated,
        remaining,
      });
      const existing = byPartner.get(invoice.partnerId) ?? {
        partnerId: invoice.partner.id,
        partnerNumber: invoice.partner.partnerNumber,
        partnerName: invoice.partner.name,
        ...emptyAgingBuckets(),
        total: 0,
      };
      existing[bucket] += remaining;
      existing.total += remaining;
      byPartner.set(invoice.partnerId, existing);
    }

    const partners = [...byPartner.values()].sort((a, b) =>
      a.partnerName.localeCompare(b.partnerName),
    );
    const totals = partners.reduce(
      (acc, row) => {
        acc.current += row.current;
        acc.days31to60 += row.days31to60;
        acc.days61to90 += row.days61to90;
        acc.over90 += row.over90;
        acc.total += row.total;
        return acc;
      },
      { ...emptyAgingBuckets(), total: 0 },
    );

    return {
      side,
      asOfDate: asOf,
      partners,
      invoices: invoicesOut.sort(
        (a, b) => b.daysOutstanding - a.daysOutstanding,
      ),
      totals,
    };
  }

  /**
   * Available Cash & Bank Balances — treasury view answering
   * "How much can we currently spend from each cash/bank account?"
   *
   * Formula (documented estimate):
   *   availableToSpend = bookBalance − recordedHolds − committedOutgoing
   * where:
   *   bookBalance = posted GL debit−credit as of date (ReceivingAccount CoA)
   *   recordedHolds = 0 (holds/restrictions are not tracked in OMS yet)
   *   committedOutgoing = DRAFT FinancialTransactions that credit this cash CoA
   *
   * bankConfirmedAvailable is not tracked — availability is an ESTIMATE only.
   */
  async cashAvailability(query: {
    asOf?: string;
    currencyId?: string;
    accountId?: string;
  }) {
    const asOf = query.asOf ? new Date(query.asOf) : new Date();
    const receiving = await this.prisma.receivingAccount.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(query.accountId ? { id: query.accountId } : {}),
        ...(query.currencyId ? { currencyId: query.currencyId } : {}),
      },
      include: {
        currency: { select: { id: true, code: true, name: true } },
        chartOfAccount: {
          select: { id: true, code: true, name: true, nameEn: true },
        },
      },
      orderBy: { code: 'asc' },
    });

    const coaIds = [...new Set(receiving.map((r) => r.chartOfAccountId))];
    const balances = new Map<string, { debit: number; credit: number }>();
    if (coaIds.length > 0) {
      const grouped = await this.prisma.journalEntryLine.groupBy({
        by: ['accountId'],
        where: {
          accountId: { in: coaIds },
          journalEntry: {
            deletedAt: null,
            status: this.buildStatusFilter(true),
            entryDate: { lte: asOf },
          },
        },
        _sum: { debit: true, credit: true },
      });
      for (const row of grouped) {
        balances.set(row.accountId, {
          debit: Number(row._sum.debit ?? 0),
          credit: Number(row._sum.credit ?? 0),
        });
      }
    }

    // DRAFT supplier payments / cash outs against these receiving accounts.
    const draftOutgoing = await this.prisma.financialTransaction.findMany({
      where: {
        deletedAt: null,
        status: FinancialTransactionStatus.DRAFT,
        receivingAccountId: { in: receiving.map((r) => r.id) },
        type: {
          in: ['SUPPLIER_PAYMENT', 'CUSTOMER_REFUND', 'EXPENSE_PAYMENT'],
        },
      },
      select: {
        id: true,
        amount: true,
        receivingAccountId: true,
        currencyId: true,
      },
    });
    const committedByAccount = new Map<string, number>();
    for (const row of draftOutgoing) {
      if (!row.receivingAccountId) continue;
      committedByAccount.set(
        row.receivingAccountId,
        roundReportMoney(
          (committedByAccount.get(row.receivingAccountId) ?? 0) +
            Number(row.amount),
        ),
      );
    }

    const functionalId = (
      await this.prisma.postingSettings.findFirst({
        select: { functionalCurrencyId: true },
      })
    )?.functionalCurrencyId;

    const accounts = [];
    const totalsByCurrency = new Map<
      string,
      { currencyCode: string; book: number; available: number }
    >();
    let egpBook = 0;
    let egpAvailable = 0;

    for (const ra of receiving) {
      const agg = balances.get(ra.chartOfAccountId) ?? { debit: 0, credit: 0 };
      const bookBalance = roundReportMoney(agg.debit - agg.credit);
      const recordedHolds = 0;
      const committedOutgoing = committedByAccount.get(ra.id) ?? 0;
      const availableToSpend = roundReportMoney(
        bookBalance - recordedHolds - committedOutgoing,
      );
      const currencyCode = ra.currency?.code ?? 'EGP';
      const currencyId = ra.currencyId ?? functionalId ?? null;

      let rateToEgp = 1;
      let rateEffectiveDate: string | null = null;
      let rateSource: string | null = 'IDENTITY';
      if (functionalId && currencyId && currencyId !== functionalId) {
        const resolved = await this.presentationRate(
          currencyId,
          functionalId,
          asOf,
        );
        if (resolved.ok) {
          rateToEgp = resolved.rate;
          rateEffectiveDate = resolved.effectiveDate.toISOString().slice(0, 10);
          rateSource = resolved.source;
        } else {
          rateToEgp = NaN;
          rateSource = null;
        }
      }

      const egpBookEq = Number.isFinite(rateToEgp)
        ? roundReportMoney(bookBalance * rateToEgp)
        : null;
      const egpAvailEq = Number.isFinite(rateToEgp)
        ? roundReportMoney(availableToSpend * rateToEgp)
        : null;
      if (egpBookEq != null) egpBook += egpBookEq;
      if (egpAvailEq != null) egpAvailable += egpAvailEq;

      const bucket = totalsByCurrency.get(currencyCode) ?? {
        currencyCode,
        book: 0,
        available: 0,
      };
      bucket.book = roundReportMoney(bucket.book + bookBalance);
      bucket.available = roundReportMoney(bucket.available + availableToSpend);
      totalsByCurrency.set(currencyCode, bucket);

      accounts.push({
        receivingAccountId: ra.id,
        accountCode: ra.code,
        accountName: ra.name,
        chartOfAccountId: ra.chartOfAccountId,
        chartOfAccountCode: ra.chartOfAccount.code,
        chartOfAccountName: ra.chartOfAccount.name,
        currencyId,
        currencyCode,
        asOfDate: asOf.toISOString().slice(0, 10),
        bookBalance,
        recordedHolds,
        committedOutgoing,
        availableToSpend,
        availabilityKind: 'ESTIMATE' as const,
        bankConfirmedAvailable: null as number | null,
        egpEquivalent: {
          bookBalance: egpBookEq,
          availableToSpend: egpAvailEq,
          rate: Number.isFinite(rateToEgp) ? rateToEgp : null,
          rateEffectiveDate,
          rateSource,
          convention: Number.isFinite(rateToEgp)
            ? `1 ${currencyCode} = ${rateToEgp} EGP`
            : null,
        },
      });
    }

    return {
      asOfDate: asOf.toISOString().slice(0, 10),
      formula:
        'availableToSpend = bookBalance − recordedHolds − committedOutgoing (DRAFT cash-out FTs)',
      limitations: [
        'recordedHolds are not tracked in OMS — always 0.',
        'bankConfirmedAvailable is not tracked — do not treat availableToSpend as guaranteed spendable cash.',
        'EGP equivalents use the latest directed rate on or before as-of; missing rates omit that account from the EGP total.',
      ],
      accounts,
      totalsByCurrency: [...totalsByCurrency.values()],
      egpConsolidated: {
        bookBalance: roundReportMoney(egpBook),
        availableToSpend: roundReportMoney(egpAvailable),
        note: 'Presentation total only — never sum unlike currencies into an unlabeled total.',
      },
    };
  }

  /**
   * Period net profit with optional presentation equivalents in other
   * currencies at the period-end rate. Equivalents are NOT additional profit
   * and are never posted.
   */
  async periodProfitEquivalents(query: {
    dateFrom?: string;
    dateTo?: string;
    targetCurrencyIds?: string[];
  }) {
    const income = await this.incomeStatement({
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    });
    const netProfitEgp = income.totals.netIncome;
    const asOf = query.dateTo ? new Date(query.dateTo) : new Date();
    const functionalId = (
      await this.prisma.postingSettings.findFirst({
        select: { functionalCurrencyId: true },
      })
    )?.functionalCurrencyId;
    const functional = functionalId
      ? await this.prisma.currency.findUnique({
          where: { id: functionalId },
          select: { id: true, code: true },
        })
      : null;

    const targets =
      query.targetCurrencyIds?.length && functionalId
        ? await this.prisma.currency.findMany({
            where: {
              id: { in: query.targetCurrencyIds },
              deletedAt: null,
            },
            select: { id: true, code: true },
          })
        : [];

    const equivalents = [];
    for (const currency of targets) {
      if (functionalId && currency.id === functionalId) {
        equivalents.push({
          currencyId: currency.id,
          currencyCode: currency.code,
          amount: netProfitEgp,
          rate: 1,
          rateEffectiveDate: asOf.toISOString().slice(0, 10),
          source: 'IDENTITY',
          convention: '1 EGP = 1 EGP',
          presentationOnly: true,
        });
        continue;
      }
      if (!functionalId) continue;
      // Profit is in functional (EGP). Equivalent in target = EGP / (1 target = X EGP)
      // i.e. need rate from target→EGP: amount_target = egp / rate.
      const resolvedRate = await this.presentationRate(
        currency.id,
        functionalId,
        asOf,
      );
      if (!resolvedRate.ok || resolvedRate.rate === 0) {
        equivalents.push({
          currencyId: currency.id,
          currencyCode: currency.code,
          amount: null,
          rate: null,
          rateEffectiveDate: null,
          source: null,
          convention: null,
          presentationOnly: true,
          error: resolvedRate.ok ? 'MISSING_EXCHANGE_RATE' : resolvedRate.error,
        });
        continue;
      }
      const rate = resolvedRate.rate;
      equivalents.push({
        currencyId: currency.id,
        currencyCode: currency.code,
        amount: roundReportMoney(netProfitEgp / rate),
        rate,
        rateEffectiveDate: resolvedRate.effectiveDate
          .toISOString()
          .slice(0, 10),
        source: resolvedRate.source,
        convention: `1 ${currency.code} = ${rate} ${functional?.code ?? 'EGP'}`,
        presentationOnly: true,
      });
    }

    return {
      netProfitEgp,
      functionalCurrencyCode: functional?.code ?? 'EGP',
      asOfDate: asOf.toISOString().slice(0, 10),
      income,
      equivalents,
      note: 'Equivalents are presentation values using the period-end directed rate. They are not additional profit or accounting postings, and are not available cash.',
    };
  }
}
