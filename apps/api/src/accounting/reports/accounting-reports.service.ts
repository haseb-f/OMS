import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AccountType,
  ChartOfAccount,
  JournalEntryStatus,
  Prisma,
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

    const items = await Promise.all(
      accounts.map((account) =>
        this.computeAccountLedger(account.id, query, account),
      ),
    );

    return { items, total, page, pageSize };
  }

  async trialBalance(query: TrialBalanceQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    const lineWhere: Prisma.JournalEntryLineWhereInput = {
      journalEntry: {
        ...this.buildEntryScopeWhere(query),
        entryDate: buildDateRangeFilter(query.dateFrom, query.dateTo),
      },
    };

    const grouped = await this.prisma.journalEntryLine.groupBy({
      by: ['accountId'],
      where: lineWhere,
      _sum: { debit: true, credit: true },
    });

    const accountIds = grouped.map((g) => g.accountId);
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { id: { in: accountIds } },
    });
    const accountMap = new Map(accounts.map((a) => [a.id, a]));

    const allRows = grouped
      .filter((g) => accountMap.has(g.accountId))
      .map((g) => {
        const account = accountMap.get(g.accountId)!;
        const debitTotal = Number(g._sum.debit ?? 0);
        const creditTotal = Number(g._sum.credit ?? 0);
        return {
          accountId: account.id,
          accountCode: account.code,
          accountName: account.name,
          accountType: account.accountType,
          debitTotal,
          creditTotal,
          balance: debitTotal - creditTotal,
        };
      })
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));

    const totals = allRows.reduce(
      (acc, r) => ({
        debitTotal: acc.debitTotal + r.debitTotal,
        creditTotal: acc.creditTotal + r.creditTotal,
      }),
      { debitTotal: 0, creditTotal: 0 },
    );

    const search = query.search?.toLowerCase();
    const filteredRows = search
      ? allRows.filter(
          (r) =>
            r.accountCode.toLowerCase().includes(search) ||
            r.accountName.toLowerCase().includes(search),
        )
      : allRows;

    const total = filteredRows.length;
    const items = filteredRows.slice(
      (page - 1) * pageSize,
      (page - 1) * pageSize + pageSize,
    );

    return { items, total, page, pageSize, totals };
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

    const rowsByType = await this.groupBalancesByAccountType({
      ...scopeWhere,
      entryDate: { lte: asOfDate },
    });

    const totalAssets = this.sumRows(rowsByType.ASSET);
    const totalLiabilities = this.sumRows(rowsByType.LIABILITY);
    const totalEquityAccounts = this.sumRows(rowsByType.EQUITY);
    const currentEarnings =
      this.sumRows(rowsByType.REVENUE) - this.sumRows(rowsByType.EXPENSE);
    const totalEquity = totalEquityAccounts + currentEarnings;

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
    };
  }

  /** TASK-051 Phase 3 — Revenue and Expense activity over [dateFrom, dateTo]. */
  async incomeStatement(query: IncomeStatementQueryDto) {
    const scopeWhere = this.buildEntryScopeWhere(query);
    const rowsByType = await this.groupBalancesByAccountType({
      ...scopeWhere,
      entryDate: buildDateRangeFilter(query.dateFrom, query.dateTo),
    });

    const totalRevenue = this.sumRows(rowsByType.REVENUE);
    const totalExpense = this.sumRows(rowsByType.EXPENSE);

    return {
      revenue: rowsByType.REVENUE,
      expense: rowsByType.EXPENSE,
      totals: {
        totalRevenue,
        totalExpense,
        netIncome: totalRevenue - totalExpense,
      },
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
    if (cashAccountIds.length === 0) {
      return {
        openingBalance: 0,
        movements: [],
        totals: { netCashChange: 0, closingBalance: 0 },
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

    return {
      openingBalance,
      movements,
      totals: {
        netCashChange,
        closingBalance: openingBalance + netCashChange,
      },
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
}
