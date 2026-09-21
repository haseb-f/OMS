import { Injectable, NotFoundException } from '@nestjs/common';
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
import {
  agingBucket,
  daysOutstanding,
  emptyAgingBuckets,
  type AgingBucket,
} from './aging.util';
import {
  buildAccountForest,
  buildCashMovementReport,
  classifyCashFlowSource,
  leafLine,
  roundReportMoney,
  wrapSection,
  type AccountAmounts,
  type CoaNode,
  type HierarchicalReportLine,
} from './financial-report-tree';

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
  constructor(private readonly prisma: PrismaService) {}

  private buildStatusFilter(
    postedOnly?: boolean,
  ): Prisma.EnumJournalEntryStatusFilter {
    if (postedOnly === false) {
      return {
        in: [
          JournalEntryStatus.DRAFT,
          JournalEntryStatus.POSTED,
          JournalEntryStatus.REVERSED,
        ],
      };
    }
    return { in: [JournalEntryStatus.POSTED, JournalEntryStatus.REVERSED] };
  }

  private buildEntryScopeWhere(
    filters: ReportQueryBaseDto,
  ): Prisma.JournalEntryWhereInput {
    return {
      deletedAt: null,
      status: this.buildStatusFilter(filters.postedOnly),
      ...(filters.companyId && { companyId: filters.companyId }),
      ...(filters.branchId && { branchId: filters.branchId }),
      ...(filters.costCenterId && { costCenterId: filters.costCenterId }),
      ...(filters.projectId && { projectId: filters.projectId }),
      ...(filters.currencyId && { currencyId: filters.currencyId }),
    };
  }

  private async computeAccountLedger(
    accountId: string,
    filters: ReportQueryBaseDto,
    preloadedAccount?: ChartOfAccount,
  ) {
    const account =
      preloadedAccount ??
      (await this.prisma.chartOfAccount.findUnique({
        where: { id: accountId },
      }));
    if (!account) {
      throw new NotFoundException(`Account ${accountId} not found`);
    }

    const scopeWhere = this.buildEntryScopeWhere(filters);

    const openingBalance = filters.dateFrom
      ? await this.prisma.journalEntryLine
          .aggregate({
            where: {
              accountId,
              journalEntry: {
                ...scopeWhere,
                entryDate: { lt: new Date(filters.dateFrom) },
              },
            },
            _sum: { debit: true, credit: true },
          })
          .then(
            (agg) => Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0),
          )
      : 0;

    const lines = await this.prisma.journalEntryLine.findMany({
      where: {
        accountId,
        journalEntry: {
          ...scopeWhere,
          entryDate: buildDateRangeFilter(filters.dateFrom, filters.dateTo),
        },
      },
      include: {
        journalEntry: {
          select: {
            id: true,
            entryNumber: true,
            entryDate: true,
            description: true,
            sourceType: true,
            sourceId: true,
            referenceNumber: true,
            status: true,
          },
        },
      },
      orderBy: [
        { journalEntry: { entryDate: 'asc' } },
        { journalEntry: { entryNumber: 'asc' } },
        { lineOrder: 'asc' },
      ],
    });

    let runningBalance = openingBalance;
    const movements = lines.map((line) => {
      const debit = Number(line.debit);
      const credit = Number(line.credit);
      runningBalance += debit - credit;
      return {
        journalEntryId: line.journalEntry.id,
        entryNumber: line.journalEntry.entryNumber,
        entryDate: line.journalEntry.entryDate,
        description: line.description ?? line.journalEntry.description,
        sourceType: line.journalEntry.sourceType,
        sourceId: line.journalEntry.sourceId,
        referenceNumber: line.journalEntry.referenceNumber,
        status: line.journalEntry.status,
        debit,
        credit,
        runningBalance,
      };
    });

    const periodDebit = movements.reduce((sum, m) => sum + m.debit, 0);
    const periodCredit = movements.reduce((sum, m) => sum + m.credit, 0);
    const closingBalance = openingBalance + periodDebit - periodCredit;

    return {
      account: {
        id: account.id,
        code: account.code,
        name: account.name,
        accountType: account.accountType,
      },
      openingBalance,
      periodDebit,
      periodCredit,
      closingBalance,
      movements,
    };
  }

  async generalLedger(query: GeneralLedgerQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const accountWhere: Prisma.ChartOfAccountWhereInput = {
      deletedAt: null,
      ...(query.accountId && { id: query.accountId }),
      ...(query.search && {
        OR: [
          { code: { contains: query.search, mode: 'insensitive' } },
          { name: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [accounts, total] = await Promise.all([
      this.prisma.chartOfAccount.findMany({
        where: accountWhere,
        orderBy: { code: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.chartOfAccount.count({ where: accountWhere }),
    ]);

    const items = await this.computeAccountLedgers(accounts, query);

    return { items, total, page, pageSize };
  }

  /**
   * Batched variant of `computeAccountLedger` for `generalLedger`'s
   * per-page account list — the single-account version (still used
   * unchanged by `accountStatement`, which only ever has one account) did
   * 2 queries per account, so a page of `pageSize` accounts ran
   * `1 + 2*pageSize` queries. Same math per account (opening balance +
   * running balance over the same date-sorted lines), just computed from
   * one batched opening-balance groupBy and one batched lines findMany
   * instead of one pair of queries per account.
   *
   * Splitting a single entryDate/entryNumber/lineOrder-sorted result set by
   * accountId preserves each account's relative order — a subsequence of a
   * sorted sequence is itself sorted — so the per-account movement order
   * (and therefore every running balance) is identical to running the
   * single-account query per account.
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
        include: {
          journalEntry: {
            select: {
              id: true,
              entryNumber: true,
              entryDate: true,
              description: true,
              sourceType: true,
              sourceId: true,
              referenceNumber: true,
              status: true,
            },
          },
        },
        orderBy: [
          { journalEntry: { entryDate: 'asc' } },
          { journalEntry: { entryNumber: 'asc' } },
          { lineOrder: 'asc' },
        ],
      }),
    ]);

    const openingByAccount = new Map(
      openingGroups.map((g) => [
        g.accountId,
        Number(g._sum.debit ?? 0) - Number(g._sum.credit ?? 0),
      ]),
    );
    const linesByAccount = new Map<string, typeof lines>();
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
      const accountLines = linesByAccount.get(account.id) ?? [];

      let runningBalance = openingBalance;
      const movements = accountLines.map((line) => {
        const debit = Number(line.debit);
        const credit = Number(line.credit);
        runningBalance += debit - credit;
        return {
          journalEntryId: line.journalEntry.id,
          entryNumber: line.journalEntry.entryNumber,
          entryDate: line.journalEntry.entryDate,
          description: line.description ?? line.journalEntry.description,
          sourceType: line.journalEntry.sourceType,
          sourceId: line.journalEntry.sourceId,
          referenceNumber: line.journalEntry.referenceNumber,
          status: line.journalEntry.status,
          debit,
          credit,
          runningBalance,
        };
      });

      const periodDebit = movements.reduce((sum, m) => sum + m.debit, 0);
      const periodCredit = movements.reduce((sum, m) => sum + m.credit, 0);
      const closingBalance = openingBalance + periodDebit - periodCredit;

      return {
        account: {
          id: account.id,
          code: account.code,
          name: account.name,
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
      }),
      { openingBalance: 0, debitTotal: 0, creditTotal: 0, closingBalance: 0 },
    );

    return {
      items: filteredRows,
      total: filteredRows.length,
      page: 1,
      pageSize: filteredRows.length,
      totals: {
        debitTotal: totals.debitTotal,
        creditTotal: totals.creditTotal,
        openingBalance: totals.openingBalance,
        closingBalance: totals.closingBalance,
      },
      includeOpeningBalance: includeOpening,
      balanced: Math.abs(totals.debitTotal - totals.creditTotal) < 0.01,
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
          lines: { include: { account: true }, orderBy: { lineOrder: 'asc' } },
        },
        orderBy: { entryDate: sortOrder },
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
   * TASK-051 Phase 3 — a point-in-time report: every account's balance as
   * of `dateTo` (read as "as of"; `dateFrom` is ignored — a Balance Sheet
   * has no start date). Since this system never posts period-close
   * ("zero out Revenue/Expense into Retained Earnings") entries, current
   * Revenue/Expense activity is rolled into `currentEarnings` and added to
   * Equity so the statement balances — the same "current year earnings"
   * line every real Balance Sheet shows before formal year-end closing.
   */
  async balanceSheet(query: BalanceSheetQueryDto) {
    const asOfDate = query.dateTo
      ? new Date(new Date(query.dateTo).getTime() + (24 * 60 * 60 * 1000 - 1))
      : new Date();
    const scopeWhere = this.buildEntryScopeWhere(query);

    const [rowsByType, accounts] = await Promise.all([
      this.groupBalancesByAccountType({
        ...scopeWhere,
        entryDate: { lte: asOfDate },
      }),
      this.loadCoaNodes(),
    ]);

    const totalAssets = this.sumRows(rowsByType.ASSET);
    const totalLiabilities = this.sumRows(rowsByType.LIABILITY);
    const totalEquityAccounts = this.sumRows(rowsByType.EQUITY);
    const currentEarnings =
      this.sumRows(rowsByType.REVENUE) - this.sumRows(rowsByType.EXPENSE);
    const totalEquity = totalEquityAccounts + currentEarnings;
    const valueKeys = ['balance'];

    const assetsForest = buildAccountForest(
      accounts,
      this.statementRowsToAmounts(rowsByType.ASSET),
      valueKeys,
      { accountType: AccountType.ASSET },
    );
    const liabilitiesForest = buildAccountForest(
      accounts,
      this.statementRowsToAmounts(rowsByType.LIABILITY),
      valueKeys,
      { accountType: AccountType.LIABILITY },
    );
    const equityForest = buildAccountForest(
      accounts,
      this.statementRowsToAmounts(rowsByType.EQUITY),
      valueKeys,
      { accountType: AccountType.EQUITY },
    );
    if (Math.abs(currentEarnings) >= 0.005) {
      equityForest.push(
        leafLine({
          id: 'current-earnings',
          kind: 'result',
          label: 'Current Earnings (unclosed)',
          labelEn: 'Current Earnings (unclosed)',
          values: { balance: roundReportMoney(currentEarnings) },
          level: 1,
        }),
      );
    }

    const lines = [
      wrapSection({
        id: 'assets',
        label: 'Assets',
        labelEn: 'Assets',
        children: assetsForest,
        valueKeys,
        totalLabel: 'Total Assets',
        totalLabelEn: 'Total Assets',
      }),
      wrapSection({
        id: 'liabilities',
        label: 'Liabilities',
        labelEn: 'Liabilities',
        children: liabilitiesForest,
        valueKeys,
        totalLabel: 'Total Liabilities',
        totalLabelEn: 'Total Liabilities',
      }),
      wrapSection({
        id: 'equity',
        label: 'Equity',
        labelEn: 'Equity',
        children: equityForest,
        valueKeys,
        totalLabel: 'Total Equity',
        totalLabelEn: 'Total Equity',
      }),
      leafLine({
        id: 'liabilities-equity',
        kind: 'grand_total',
        label: 'Total Liabilities and Equity',
        labelEn: 'Total Liabilities and Equity',
        values: { balance: roundReportMoney(totalLiabilities + totalEquity) },
      }),
    ];

    return {
      asOfDate,
      assets: rowsByType.ASSET,
      liabilities: rowsByType.LIABILITY,
      equity: rowsByType.EQUITY,
      currentEarnings,
      totals: {
        totalAssets,
        totalLiabilities,
        totalEquity,
        balanced:
          Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
      },
      lines,
    };
  }

  /** TASK-051 Phase 3 — Revenue and Expense activity over [dateFrom, dateTo]. */
  async incomeStatement(query: IncomeStatementQueryDto) {
    const scopeWhere = this.buildEntryScopeWhere(query);
    const [rowsByType, accounts] = await Promise.all([
      this.groupBalancesByAccountType({
        ...scopeWhere,
        entryDate: buildDateRangeFilter(query.dateFrom, query.dateTo),
      }),
      this.loadCoaNodes(),
    ]);

    const totalRevenue = this.sumRows(rowsByType.REVENUE);
    const totalExpense = this.sumRows(rowsByType.EXPENSE);
    const netIncome = totalRevenue - totalExpense;
    const valueKeys = ['balance'];

    const lines = [
      wrapSection({
        id: 'revenue',
        label: 'Revenue',
        labelEn: 'Revenue',
        children: buildAccountForest(
          accounts,
          this.statementRowsToAmounts(rowsByType.REVENUE),
          valueKeys,
          { accountType: AccountType.REVENUE },
        ),
        valueKeys,
        totalLabel: 'Total Revenue',
        totalLabelEn: 'Total Revenue',
      }),
      wrapSection({
        id: 'expense',
        label: 'Expenses',
        labelEn: 'Expenses',
        children: buildAccountForest(
          accounts,
          this.statementRowsToAmounts(rowsByType.EXPENSE),
          valueKeys,
          { accountType: AccountType.EXPENSE },
        ),
        valueKeys,
        totalLabel: 'Total Expenses',
        totalLabelEn: 'Total Expenses',
      }),
      leafLine({
        id: 'net-income',
        kind: 'result',
        label: netIncome >= 0 ? 'Net Profit' : 'Net Loss',
        labelEn: netIncome >= 0 ? 'Net Profit' : 'Net Loss',
        values: { balance: roundReportMoney(netIncome) },
      }),
    ];

    return {
      revenue: rowsByType.REVENUE,
      expense: rowsByType.EXPENSE,
      totals: {
        totalRevenue,
        totalExpense,
        netIncome,
      },
      lines,
    };
  }

  /**
   * TASK-051 Phase 3 — a direct-method Cash Flow Statement over
   * [dateFrom, dateTo]. "Cash" accounts are exactly the Chart of Accounts
   * rows already designated as a `ReceivingAccount.chartOfAccountId` — the
   * one existing "this account is real cash/bank" signal in the schema
   * (the same account the Financial Transaction Posting Provider debits/
   * credits for every Receipt/Payment) — no new account-classification
   * field was added for this. Movements are grouped by the source
   * document's `sourceType` rather than split into Operating/Investing/
   * Financing sections: every source type this ERP currently posts
   * (Sales/Purchase Invoices and Returns, Customer Receipts, Supplier
   * Payments, Inventory Adjustments) is genuinely an operating activity —
   * there is no fixed-asset purchase, loan, or equity-financing posting
   * path yet, so inventing those section headers would misrepresent data
   * that doesn't exist rather than reflect it.
   */
  async cashFlowStatement(query: CashFlowQueryDto) {
    const cashAccounts = await this.prisma.receivingAccount.findMany({
      select: { chartOfAccountId: true },
    });
    const cashAccountIds = [
      ...new Set(cashAccounts.map((a) => a.chartOfAccountId)),
    ];
    if (query.view === 'movement') {
      return this.cashMovement(query, cashAccountIds);
    }
    if (cashAccountIds.length === 0) {
      return {
        view: 'activities' as const,
        openingBalance: 0,
        movements: [],
        totals: { netCashChange: 0, closingBalance: 0 },
        lines: [
          leafLine({
            id: 'cf-opening',
            kind: 'opening',
            label: 'Opening cash',
            values: { balance: 0 },
          }),
          wrapSection({
            id: 'cf-operating',
            label: 'Operating Activities',
            children: [],
            valueKeys: ['balance'],
            totalLabel: 'Net cash from operating activities',
          }),
          wrapSection({
            id: 'cf-investing',
            label: 'Investing Activities',
            children: [],
            valueKeys: ['balance'],
            totalLabel: 'Net cash from investing activities',
          }),
          wrapSection({
            id: 'cf-financing',
            label: 'Financing Activities',
            children: [],
            valueKeys: ['balance'],
            totalLabel: 'Net cash from financing activities',
          }),
          leafLine({
            id: 'cf-closing',
            kind: 'closing',
            label: 'Closing cash',
            values: { balance: 0 },
          }),
        ],
        sections: [
          { section: 'OPERATING', netChange: 0 },
          { section: 'INVESTING', netChange: 0 },
          { section: 'FINANCING', netChange: 0 },
        ],
      };
    }

    const scopeWhere = this.buildEntryScopeWhere(query);

    const openingBalance = query.dateFrom
      ? await this.prisma.journalEntryLine
          .aggregate({
            where: {
              accountId: { in: cashAccountIds },
              journalEntry: {
                ...scopeWhere,
                entryDate: { lt: new Date(query.dateFrom) },
              },
            },
            _sum: { debit: true, credit: true },
          })
          .then(
            (agg) => Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0),
          )
      : 0;

    const lines = await this.prisma.journalEntryLine.findMany({
      where: {
        accountId: { in: cashAccountIds },
        journalEntry: {
          ...scopeWhere,
          entryDate: buildDateRangeFilter(query.dateFrom, query.dateTo),
        },
      },
      include: { journalEntry: { select: { sourceType: true } } },
    });

    const bySource = new Map<string, number>();
    for (const line of lines) {
      const key = line.journalEntry.sourceType ?? 'OTHER';
      const net = Number(line.debit) - Number(line.credit);
      bySource.set(key, (bySource.get(key) ?? 0) + net);
    }
    const movements = [...bySource.entries()]
      .map(([sourceType, netChange]) => ({ sourceType, netChange }))
      .sort((a, b) => a.sourceType.localeCompare(b.sourceType));

    const netCashChange = movements.reduce((sum, m) => sum + m.netChange, 0);
    const valueKeys = ['balance'];
    const sectionOrder = [
      'OPERATING',
      'INVESTING',
      'FINANCING',
      'OTHER',
    ] as const;
    const sectionLabels: Record<
      (typeof sectionOrder)[number],
      { ar: string; en: string }
    > = {
      OPERATING: { ar: 'Operating Activities', en: 'Operating Activities' },
      INVESTING: { ar: 'Investing Activities', en: 'Investing Activities' },
      FINANCING: { ar: 'Financing Activities', en: 'Financing Activities' },
      OTHER: { ar: 'Other', en: 'Other' },
    };

    const grouped = new Map<(typeof sectionOrder)[number], typeof movements>();
    for (const movement of movements) {
      const section = classifyCashFlowSource(movement.sourceType);
      const list = grouped.get(section) ?? [];
      list.push(movement);
      grouped.set(section, list);
    }

    const sectionLines: HierarchicalReportLine[] = sectionOrder
      .filter(
        (section) =>
          section !== 'OTHER' || (grouped.get(section)?.length ?? 0) > 0,
      )
      .map((section) => {
        const children = (grouped.get(section) ?? []).map((movement) =>
          leafLine({
            id: `cf:${section}:${movement.sourceType}`,
            kind: 'posting',
            label: movement.sourceType,
            values: { balance: roundReportMoney(movement.netChange) },
            level: 1,
          }),
        );
        return wrapSection({
          id: `cf-${section.toLowerCase()}`,
          label: sectionLabels[section].en,
          labelEn: sectionLabels[section].en,
          children,
          valueKeys,
          totalLabel: `Net cash from ${sectionLabels[section].en.toLowerCase()}`,
          totalLabelEn: `Net cash from ${sectionLabels[section].en.toLowerCase()}`,
        });
      });

    const reportLines: HierarchicalReportLine[] = [
      leafLine({
        id: 'cf-opening',
        kind: 'opening',
        label: 'Opening cash',
        labelEn: 'Opening cash',
        values: { balance: roundReportMoney(openingBalance) },
      }),
      ...sectionLines,
      leafLine({
        id: 'cf-net',
        kind: 'result',
        label: 'Net increase (decrease) in cash',
        labelEn: 'Net increase (decrease) in cash',
        values: { balance: roundReportMoney(netCashChange) },
      }),
      leafLine({
        id: 'cf-closing',
        kind: 'closing',
        label: 'Closing cash',
        labelEn: 'Closing cash',
        values: { balance: roundReportMoney(openingBalance + netCashChange) },
      }),
    ];

    return {
      view: 'activities' as const,
      openingBalance,
      movements,
      totals: {
        netCashChange,
        closingBalance: openingBalance + netCashChange,
      },
      lines: reportLines,
      sections: sectionOrder.map((section) => ({
        section,
        netChange: roundReportMoney(
          (grouped.get(section) ?? []).reduce(
            (sum, row) => sum + row.netChange,
            0,
          ),
        ),
      })),
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
    const scopeWhere = this.buildEntryScopeWhere(query);
    const [accounts, opening, period] = await Promise.all([
      this.prisma.chartOfAccount.findMany({
        where: { id: { in: cashAccountIds } },
        select: { id: true, code: true, name: true, nameEn: true },
      }),
      query.dateFrom
        ? this.prisma.journalEntryLine.groupBy({
            by: ['accountId'],
            where: {
              accountId: { in: cashAccountIds },
              journalEntry: {
                ...scopeWhere,
                entryDate: { lt: new Date(query.dateFrom) },
              },
            },
            _sum: { debit: true, credit: true },
          })
        : Promise.resolve([]),
      this.prisma.journalEntryLine.groupBy({
        by: ['accountId'],
        where: {
          accountId: { in: cashAccountIds },
          journalEntry: {
            ...scopeWhere,
            entryDate: buildDateRangeFilter(query.dateFrom, query.dateTo),
          },
        },
        _sum: { debit: true, credit: true },
      }),
    ]);
    const { lines, totals } = buildCashMovementReport(
      accounts,
      new Map(
        opening.map((row) => [
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

  /** Shared by Balance Sheet and Income Statement: every account's signed balance, grouped by AccountType. */
  private async groupBalancesByAccountType(
    entryWhere: Prisma.JournalEntryWhereInput,
  ): Promise<Record<AccountType, StatementRow[]>> {
    const grouped = await this.prisma.journalEntryLine.groupBy({
      by: ['accountId'],
      where: { journalEntry: entryWhere },
      _sum: { debit: true, credit: true },
    });

    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { id: { in: grouped.map((g) => g.accountId) } },
    });
    const accountMap = new Map(accounts.map((a) => [a.id, a]));

    const rowsByType: Record<AccountType, StatementRow[]> = {
      ASSET: [],
      LIABILITY: [],
      EQUITY: [],
      REVENUE: [],
      EXPENSE: [],
    };

    for (const g of grouped) {
      const account = accountMap.get(g.accountId);
      if (!account) continue;
      const debit = Number(g._sum.debit ?? 0);
      const credit = Number(g._sum.credit ?? 0);
      const balance = DEBIT_NORMAL_TYPES.includes(account.accountType)
        ? debit - credit
        : credit - debit;
      rowsByType[account.accountType].push({
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        balance,
      });
    }

    for (const type of Object.keys(rowsByType) as AccountType[]) {
      rowsByType[type].sort((a, b) =>
        a.accountCode.localeCompare(b.accountCode),
      );
    }

    return rowsByType;
  }

  private sumRows(rows: StatementRow[]): number {
    return rows.reduce((sum, row) => sum + row.balance, 0);
  }

  private async loadCoaNodes(): Promise<CoaNode[]> {
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { deletedAt: null },
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
    return accounts;
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

  private statementRowsToAmounts(rows: StatementRow[]): AccountAmounts {
    return Object.fromEntries(
      rows.map((row) => [row.accountId, { balance: row.balance }]),
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

  async partnerStatement(query: PartnerStatementQueryDto) {
    const partner = await this.prisma.partner.findFirst({
      where: { id: query.partnerId, deletedAt: null },
      select: { id: true, partnerNumber: true, name: true },
    });
    if (!partner) {
      throw new NotFoundException(`Partner ${query.partnerId} not found`);
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const asOf = query.dateTo
      ? new Date(new Date(query.dateTo).getTime() + (24 * 60 * 60 * 1000 - 1))
      : undefined;
    const dateFrom = query.dateFrom ? new Date(query.dateFrom) : undefined;

    const lineWhere: Prisma.JournalEntryLineWhereInput = {
      partnerId: partner.id,
      journalEntry: {
        ...this.buildEntryScopeWhere(query),
        ...(dateFrom || asOf
          ? {
              entryDate: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(asOf ? { lte: asOf } : {}),
              },
            }
          : {}),
      },
    };

    const openingWhere: Prisma.JournalEntryLineWhereInput | null = dateFrom
      ? {
          partnerId: partner.id,
          journalEntry: {
            ...this.buildEntryScopeWhere(query),
            entryDate: { lt: dateFrom },
          },
        }
      : null;

    const [openingAgg, lines, total] = await Promise.all([
      openingWhere
        ? this.prisma.journalEntryLine.aggregate({
            where: openingWhere,
            _sum: { debit: true, credit: true },
          })
        : Promise.resolve({ _sum: { debit: 0, credit: 0 } }),
      this.prisma.journalEntryLine.findMany({
        where: lineWhere,
        include: {
          account: {
            select: {
              id: true,
              code: true,
              name: true,
              nameEn: true,
              partnerControlType: true,
            },
          },
          journalEntry: {
            select: {
              id: true,
              entryNumber: true,
              entryDate: true,
              description: true,
              sourceType: true,
              sourceId: true,
              referenceNumber: true,
              status: true,
            },
          },
        },
        orderBy: [{ journalEntry: { entryDate: 'asc' } }, { lineOrder: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.journalEntryLine.count({ where: lineWhere }),
    ]);

    let running =
      Number(openingAgg._sum.debit ?? 0) - Number(openingAgg._sum.credit ?? 0);
    const openingBalance = running;
    const movements = lines.map((line) => {
      const debit = Number(line.debit);
      const credit = Number(line.credit);
      running += debit - credit;
      return {
        journalEntryId: line.journalEntry.id,
        entryNumber: line.journalEntry.entryNumber,
        entryDate: line.journalEntry.entryDate,
        description: line.description ?? line.journalEntry.description,
        sourceType: line.journalEntry.sourceType,
        sourceId: line.journalEntry.sourceId,
        referenceNumber: line.journalEntry.referenceNumber,
        status: line.journalEntry.status,
        accountCode: line.account.code,
        accountName: line.account.name,
        partnerControlType: line.account.partnerControlType,
        debit,
        credit,
        runningBalance: running,
      };
    });

    return {
      partner,
      openingBalance,
      closingBalance: running,
      movements,
      total,
      page,
      pageSize,
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
}
