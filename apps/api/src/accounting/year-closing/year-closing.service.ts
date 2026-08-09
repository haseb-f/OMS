import { BadRequestException, Injectable } from '@nestjs/common';
import { FiscalYearStatus, JournalEntryStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import {
  JournalEntryActivityService,
  JournalEntryActivityType,
} from '../../journal-entries/activities/journal-entry-activity.service';
import { FiscalYearsService } from '../fiscal-periods/fiscal-years.service';
import { AccountingReportsService } from '../reports/accounting-reports.service';
import { OpeningBalancesService } from '../opening-balances/opening-balances.service';
import { CloseYearDto } from './dto/close-year.dto';

const CLOSING_SOURCE_TYPE = 'YEAR_CLOSING';

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Year Closing (TASK-055 Part 5) — distinct from `FiscalYearsService.close()`
 * (Part 2's plain Open->Closed status transition, which this calls and
 * requires to have already happened): this generates the actual accounting
 * ceremony —
 *   1. One Closing/P&L-transfer entry zeroing every Revenue/Expense account
 *      active during the year, with the net difference posted to the
 *      configured Retained Earnings account.
 *   2. Optionally, one Opening entry for the next Fiscal Year carrying
 *      forward the just-closed year's ending Balance Sheet (Assets/
 *      Liabilities/Equity, including the Retained Earnings transfer above).
 * Reuses `AccountingReportsService.incomeStatement/balanceSheet` for every
 * balance computed here (never a second balance query) and
 * `OpeningBalancesService.create` for the next-year entry (never a second
 * "build a balanced entry" implementation).
 */
@Injectable()
export class YearClosingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly activityService: JournalEntryActivityService,
    private readonly fiscalYears: FiscalYearsService,
    private readonly accountingReports: AccountingReportsService,
    private readonly openingBalances: OpeningBalancesService,
  ) {}

  async execute(dto: CloseYearDto, userId?: string) {
    const fiscalYear = await this.fiscalYears.findOne(dto.fiscalYearId);
    if (fiscalYear.status !== FiscalYearStatus.CLOSED) {
      throw new BadRequestException(
        `Close Fiscal Year "${fiscalYear.name}" first (Fiscal Years > Close) before running Year Closing.`,
      );
    }

    const existingClosing = await this.prisma.journalEntry.findFirst({
      where: {
        sourceType: CLOSING_SOURCE_TYPE,
        sourceId: fiscalYear.id,
        deletedAt: null,
      },
    });
    if (existingClosing) {
      throw new BadRequestException(
        `Fiscal Year "${fiscalYear.name}" already has a Closing entry (${existingClosing.entryNumber}).`,
      );
    }

    const settings = await this.prisma.postingSettings.findFirst();
    if (!settings?.retainedEarningsAccountId) {
      throw new BadRequestException(
        'Configure a Retained Earnings account in Accounting Settings before running Year Closing.',
      );
    }

    const closingEntry = await this.generateClosingEntry(
      fiscalYear,
      settings.retainedEarningsAccountId,
      userId,
    );

    let openingEntry = null;
    if (dto.nextFiscalYearId) {
      openingEntry = await this.generateNextYearOpeningEntry(
        fiscalYear,
        dto.nextFiscalYearId,
        userId,
      );
    }

    return { closingEntry, openingEntry };
  }

  private async generateClosingEntry(
    fiscalYear: { id: string; name: string; startDate: Date; endDate: Date },
    retainedEarningsAccountId: string,
    userId?: string,
  ) {
    const incomeStatement = await this.accountingReports.incomeStatement({
      dateFrom: toISODate(fiscalYear.startDate),
      dateTo: toISODate(fiscalYear.endDate),
    });

    const lines: {
      accountId: string;
      debit?: number;
      credit?: number;
      description: string;
    }[] = [];
    for (const row of incomeStatement.revenue) {
      if (Math.abs(row.balance) < 0.01) continue;
      lines.push({
        accountId: row.accountId,
        debit: row.balance > 0 ? row.balance : undefined,
        credit: row.balance < 0 ? -row.balance : undefined,
        description: `Close ${row.accountName} — ${fiscalYear.name}`,
      });
    }
    for (const row of incomeStatement.expense) {
      if (Math.abs(row.balance) < 0.01) continue;
      lines.push({
        accountId: row.accountId,
        credit: row.balance > 0 ? row.balance : undefined,
        debit: row.balance < 0 ? -row.balance : undefined,
        description: `Close ${row.accountName} — ${fiscalYear.name}`,
      });
    }

    const netIncome = incomeStatement.totals.netIncome;
    if (Math.abs(netIncome) >= 0.01) {
      lines.push({
        accountId: retainedEarningsAccountId,
        credit: netIncome > 0 ? netIncome : undefined,
        debit: netIncome < 0 ? -netIncome : undefined,
        description: `Net ${netIncome > 0 ? 'income' : 'loss'} transferred to Retained Earnings — ${fiscalYear.name}`,
      });
    }

    if (lines.length === 0) {
      throw new BadRequestException(
        `Fiscal Year "${fiscalYear.name}" has no Revenue or Expense activity to close.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const entryNumber = await this.numberingEngine.generateNumber(
        'JOURNAL_ENTRY',
        undefined,
        tx,
      );
      const totalDebit = lines.reduce((sum, l) => sum + (l.debit ?? 0), 0);
      const totalCredit = lines.reduce((sum, l) => sum + (l.credit ?? 0), 0);

      const entry = await tx.journalEntry.create({
        data: {
          entryNumber,
          entryDate: fiscalYear.endDate,
          fiscalYearId: fiscalYear.id,
          description: `Year Closing — ${fiscalYear.name}`,
          status: JournalEntryStatus.POSTED,
          sourceType: CLOSING_SOURCE_TYPE,
          sourceId: fiscalYear.id,
          totalDebit,
          totalCredit,
          postedAt: new Date(),
          postedBy: userId ?? null,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
          lines: {
            create: lines.map((line, index) => ({
              accountId: line.accountId,
              description: line.description,
              debit: line.debit ?? 0,
              credit: line.credit ?? 0,
              lineOrder: index,
            })),
          },
        },
        include: {
          lines: { include: { account: true }, orderBy: { lineOrder: 'asc' } },
        },
      });

      await this.activityService.log(
        entry.id,
        JournalEntryActivityType.ENTRY_POSTED,
        `Year Closing ${entry.entryNumber} posted for Fiscal Year "${fiscalYear.name}"`,
        undefined,
        tx,
      );

      return entry;
    });
  }

  private async generateNextYearOpeningEntry(
    closedFiscalYear: { id: string; name: string; endDate: Date },
    nextFiscalYearId: string,
    userId?: string,
  ) {
    const nextFiscalYear = await this.fiscalYears.findOne(nextFiscalYearId);

    const balanceSheet = await this.accountingReports.balanceSheet({
      dateTo: toISODate(closedFiscalYear.endDate),
    });

    const lines: { accountId: string; debit?: number; credit?: number }[] = [];
    for (const row of [
      ...balanceSheet.assets,
      ...balanceSheet.liabilities,
      ...balanceSheet.equity,
    ]) {
      if (Math.abs(row.balance) < 0.01) continue;
      lines.push({
        accountId: row.accountId,
        debit: row.balance > 0 ? row.balance : undefined,
        credit: row.balance < 0 ? -row.balance : undefined,
      });
    }
    if (lines.length === 0) {
      throw new BadRequestException(
        `Fiscal Year "${closedFiscalYear.name}" has no ending Balance Sheet activity to carry forward.`,
      );
    }

    return this.openingBalances.create(
      {
        fiscalYearId: nextFiscalYear.id,
        openingDate: toISODate(nextFiscalYear.startDate),
        lines,
      },
      userId,
    );
  }
}
