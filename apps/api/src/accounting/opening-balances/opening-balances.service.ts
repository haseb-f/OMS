import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AccountType,
  JournalEntryStatus,
  JournalType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import {
  JournalEntryActivityService,
  JournalEntryActivityType,
} from '../../journal-entries/activities/journal-entry-activity.service';
import { AccountingPeriodsService } from '../fiscal-periods/accounting-periods.service';
import { FiscalYearsService } from '../fiscal-periods/fiscal-years.service';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';
import { rangeDateOf } from '../fiscal-periods/period-bounds';
import { businessDayStart } from '../../common/time/business-date';
import { lockPostingSource } from '../posting-engine/posting-engine.service';
import { AccountingReportsService } from '../reports/accounting-reports.service';

const SOURCE_TYPE = 'OPENING_BALANCE';

/** Refusal code: the year's opening is derived from posted history, so a manual Opening entry would count it twice. */
export const OPENING_HISTORY_EXISTS = 'OPENING_BALANCE_HISTORY_EXISTS';

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

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
 *
 * The wizard is for GO-LIVE only — the first-ever opening of a company
 * with no earlier posted history. Every later year's opening is derived
 * from the ledger (`derived()`; see YearClosingService), so an Opening
 * entry is refused whenever posted history exists before its date
 * (OPENING_BALANCE_HISTORY_EXISTS). At most one active Opening entry per
 * fiscal year: checked under a transaction-scoped advisory lock and backed
 * by the partial unique index `journal_entries_active_fiscal_singleton_key`.
 */
@Injectable()
export class OpeningBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly activityService: JournalEntryActivityService,
    private readonly accountingPeriods: AccountingPeriodsService,
    private readonly fiscalYears: FiscalYearsService,
    private readonly accountingReports: AccountingReportsService,
  ) {}

  /**
   * The fiscal year's opening position, derived from the ledger: each
   * account's balance from everything posted before the year starts, plus
   * the year's own go-live Opening entry when it has one. After the
   * previous year's Closing entry, balance-sheet accounts carry forward
   * exactly once and every Revenue/Expense account opens at zero
   * (`profitAndLossOpening` = 0).
   */
  async derived(fiscalYearId: string) {
    const fiscalYear = await this.fiscalYears.findOne(fiscalYearId);
    const [trialBalance, openingEntry, previousFiscalYear] = await Promise.all([
      this.accountingReports.trialBalance({
        dateFrom: rangeDateOf(fiscalYear.startDate),
        dateTo: rangeDateOf(fiscalYear.startDate),
        includeOpeningBalance: true,
      }),
      this.prisma.journalEntry.findFirst({
        where: {
          sourceType: SOURCE_TYPE,
          sourceId: fiscalYear.id,
          status: JournalEntryStatus.POSTED,
          reversalOfEntryId: null,
          deletedAt: null,
        },
        include: {
          lines: {
            include: {
              account: {
                select: { code: true, name: true, accountType: true },
              },
            },
          },
        },
      }),
      this.prisma.fiscalYear.findFirst({
        where: { deletedAt: null, startDate: { lt: fiscalYear.startDate } },
        orderBy: { startDate: 'desc' },
        select: { id: true, name: true, status: true },
      }),
    ]);

    const rows = new Map<
      string,
      {
        accountId: string;
        accountCode: string;
        accountName: string;
        accountType: AccountType;
        fromLedger: number;
        fromOpeningEntry: number;
      }
    >();
    for (const item of trialBalance.items) {
      if (Math.abs(item.openingBalance) < 0.005) continue;
      rows.set(item.accountId, {
        accountId: item.accountId,
        accountCode: item.accountCode,
        accountName: item.accountName,
        accountType: item.accountType as AccountType,
        fromLedger: item.openingBalance,
        fromOpeningEntry: 0,
      });
    }
    const ledgerAccounts = rows.size;
    for (const line of openingEntry?.lines ?? []) {
      const row = rows.get(line.accountId) ?? {
        accountId: line.accountId,
        accountCode: line.account.code,
        accountName: line.account.name,
        accountType: line.account.accountType,
        fromLedger: 0,
        fromOpeningEntry: 0,
      };
      row.fromOpeningEntry = round2(
        row.fromOpeningEntry + Number(line.debit) - Number(line.credit),
      );
      rows.set(line.accountId, row);
    }

    const accounts = [...rows.values()]
      .map((row) => ({
        ...row,
        openingBalance: round2(row.fromLedger + row.fromOpeningEntry),
      }))
      .filter((row) => Math.abs(row.openingBalance) >= 0.005)
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    const totals = accounts.reduce(
      (acc, row) => ({
        debit: round2(acc.debit + Math.max(row.openingBalance, 0)),
        credit: round2(acc.credit + Math.max(-row.openingBalance, 0)),
      }),
      { debit: 0, credit: 0 },
    );
    const profitAndLossOpening = round2(
      accounts
        .filter(
          (row) =>
            row.accountType === AccountType.REVENUE ||
            row.accountType === AccountType.EXPENSE,
        )
        .reduce((sum, row) => sum + Math.abs(row.openingBalance), 0),
    );
    const previousClosing = previousFiscalYear
      ? await this.prisma.journalEntry.findFirst({
          where: {
            sourceType: 'YEAR_CLOSING',
            sourceId: previousFiscalYear.id,
            status: JournalEntryStatus.POSTED,
            reversalOfEntryId: null,
            deletedAt: null,
          },
          select: { id: true, entryNumber: true },
        })
      : null;

    let basis: 'LEDGER' | 'OPENING_ENTRY' | 'LEDGER_AND_OPENING_ENTRY' | 'NONE';
    if (openingEntry) {
      basis = ledgerAccounts > 0 ? 'LEDGER_AND_OPENING_ENTRY' : 'OPENING_ENTRY';
    } else {
      basis = ledgerAccounts > 0 ? 'LEDGER' : 'NONE';
    }

    return {
      fiscalYear: {
        id: fiscalYear.id,
        name: fiscalYear.name,
        startDate: fiscalYear.startDate,
        status: fiscalYear.status,
      },
      basis,
      openingEntry: openingEntry
        ? { id: openingEntry.id, entryNumber: openingEntry.entryNumber }
        : null,
      previousFiscalYear: previousFiscalYear
        ? {
            ...previousFiscalYear,
            closingEntry: previousClosing,
          }
        : null,
      accounts,
      totals: { ...totals, difference: round2(totals.debit - totals.credit) },
      profitAndLossOpening,
    };
  }

  async create(dto: CreateOpeningBalanceDto, userId?: string) {
    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { id: dto.fiscalYearId, deletedAt: null },
    });
    if (!fiscalYear) {
      throw new BadRequestException(
        `Fiscal Year ${dto.fiscalYearId} not found`,
      );
    }

    // A calendar date, stored date-only (00:00Z) — period-bounds.ts.
    const openingDay = rangeDateOf(new Date(dto.openingDate));
    const openingDate = new Date(`${openingDay}T00:00:00.000Z`);
    const [firstDay, lastDay] = [
      rangeDateOf(fiscalYear.startDate),
      rangeDateOf(fiscalYear.endDate),
    ];
    if (openingDay < firstDay || openingDay > lastDay) {
      throw new BadRequestException(
        `Opening Date must fall within Fiscal Year "${fiscalYear.name}" (${firstDay} – ${lastDay}).`,
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
      await lockPostingSource(tx, SOURCE_TYPE, fiscalYear.id);
      await this.assertFirstOpening(fiscalYear, openingDate, tx);
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

  /** One active Opening entry per fiscal year, and only for a company with no earlier posted history. */
  private async assertFirstOpening(
    fiscalYear: { id: string; name: string },
    openingDate: Date,
    tx: Prisma.TransactionClient,
  ) {
    const existing = await tx.journalEntry.findFirst({
      where: {
        sourceType: SOURCE_TYPE,
        sourceId: fiscalYear.id,
        status: JournalEntryStatus.POSTED,
        reversalOfEntryId: null,
        deletedAt: null,
      },
      select: { entryNumber: true },
    });
    if (existing) {
      throw new BadRequestException(
        `Fiscal Year "${fiscalYear.name}" already has an Opening Balance entry (${existing.entryNumber}) — reverse it first to re-enter.`,
      );
    }
    const earlier = await tx.journalEntry.findFirst({
      where: {
        entryDate: { lt: businessDayStart(toISODate(openingDate)) },
        status: {
          in: [JournalEntryStatus.POSTED, JournalEntryStatus.REVERSED],
        },
        deletedAt: null,
      },
      orderBy: { entryDate: 'asc' },
      select: { entryNumber: true, entryDate: true },
    });
    if (earlier) {
      throw new BadRequestException({
        code: OPENING_HISTORY_EXISTS,
        message: `Opening balances for "${fiscalYear.name}" are derived from the ledger: posted history already exists before ${toISODate(openingDate)} (first: ${earlier.entryNumber}, ${toISODate(earlier.entryDate)}), so an Opening entry would count it twice. The Opening Balance wizard is only for the first go-live opening — review the derived opening balances instead.`,
      });
    }
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
