import { BadRequestException, Injectable } from '@nestjs/common';
import { JournalEntryStatus, JournalType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import {
  JournalEntryActivityService,
  JournalEntryActivityType,
} from '../../journal-entries/activities/journal-entry-activity.service';
import { AccountingPeriodsService } from '../fiscal-periods/accounting-periods.service';
import { FiscalYearsService } from '../fiscal-periods/fiscal-years.service';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';

const SOURCE_TYPE = 'OPENING_BALANCE';

/**
 * Opening Balance Wizard (TASK-055 Part 4) — a real, one-time administrative
 * action, not a decorative field: it produces exactly one balanced, POSTED
 * JournalEntry (`sourceType='OPENING_BALANCE'`, `sourceId=fiscalYearId`) via
 * the same JournalEntry/JournalEntryLine tables and NumberingEngine every
 * other entry uses — never a parallel "opening balance" table. Reuses
 * `AccountingPeriodsService`/`FiscalYearsService`'s existing posting guards
 * (period-open, fiscal-year-open) rather than re-implementing them; the one
 * new rule ("prevent duplicate opening balances") lives only here, since no
 * other entry type in this codebase is limited to one-per-source.
 */
@Injectable()
export class OpeningBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly activityService: JournalEntryActivityService,
    private readonly accountingPeriods: AccountingPeriodsService,
    private readonly fiscalYears: FiscalYearsService,
  ) {}

  async create(dto: CreateOpeningBalanceDto, userId?: string) {
    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { id: dto.fiscalYearId, deletedAt: null },
    });
    if (!fiscalYear) {
      throw new BadRequestException(
        `Fiscal Year ${dto.fiscalYearId} not found`,
      );
    }

    const existing = await this.prisma.journalEntry.findFirst({
      where: {
        sourceType: SOURCE_TYPE,
        sourceId: fiscalYear.id,
        deletedAt: null,
      },
    });
    if (existing) {
      throw new BadRequestException(
        `Fiscal Year "${fiscalYear.name}" already has an Opening Balance entry (${existing.entryNumber}) — reverse it first to re-enter.`,
      );
    }

    const openingDate = new Date(dto.openingDate);
    if (
      openingDate < fiscalYear.startDate ||
      openingDate > fiscalYear.endDate
    ) {
      throw new BadRequestException(
        `Opening Date must fall within Fiscal Year "${fiscalYear.name}" (${fiscalYear.startDate.toDateString()} – ${fiscalYear.endDate.toDateString()}).`,
      );
    }

    const resolvedLines = await this.resolveLines(dto.lines);
    const totalDebit = resolvedLines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = resolvedLines.reduce((sum, l) => sum + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new BadRequestException(
        `Opening Balance is not balanced — total debit (${totalDebit}) must equal total credit (${totalCredit}).`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await this.accountingPeriods.assertPeriodOpen(openingDate, tx);
      await this.fiscalYears.assertPostingAllowed(openingDate, SOURCE_TYPE, tx);

      const entryNumber = await this.numberingEngine.generateNumber(
        'JOURNAL_ENTRY',
        undefined,
        tx,
      );
      const generalJournal = await tx.journal.findFirst({
        where: { type: JournalType.GENERAL, isActive: true, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });

      const entry = await tx.journalEntry.create({
        data: {
          entryNumber,
          entryDate: openingDate,
          description: `Opening Balance — ${fiscalYear.name}`,
          status: JournalEntryStatus.POSTED,
          sourceType: SOURCE_TYPE,
          sourceId: fiscalYear.id,
          fiscalYearId: fiscalYear.id,
          journalId: generalJournal?.id,
          totalDebit,
          totalCredit,
          postedAt: new Date(),
          postedBy: userId ?? null,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
          lines: {
            create: resolvedLines.map((line, index) => ({
              accountId: line.accountId,
              description: line.description ?? 'Opening Balance',
              debit: line.debit,
              credit: line.credit,
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
        `Opening Balance ${entry.entryNumber} posted for Fiscal Year "${fiscalYear.name}"`,
        undefined,
        tx,
      );

      return entry;
    });
  }

  private async resolveLines(
    lines: CreateOpeningBalanceDto['lines'],
  ): Promise<
    { accountId: string; description?: string; debit: number; credit: number }[]
  > {
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { id: { in: accountIds }, deletedAt: null },
      select: { id: true },
    });
    const validIds = new Set(accounts.map((a) => a.id));

    return lines.map((line) => {
      if (!validIds.has(line.accountId)) {
        throw new BadRequestException(`Account ${line.accountId} not found.`);
      }
      const debit = line.debit ?? 0;
      const credit = line.credit ?? 0;
      if (debit > 0 && credit > 0) {
        throw new BadRequestException(
          'A line cannot have both a debit and a credit amount.',
        );
      }
      if (debit === 0 && credit === 0) {
        throw new BadRequestException(
          'Every line needs either a debit or a credit amount.',
        );
      }
      return {
        accountId: line.accountId,
        description: line.description,
        debit,
        credit,
      };
    });
  }
}
