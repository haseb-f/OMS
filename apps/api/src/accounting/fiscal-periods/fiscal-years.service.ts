import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountingPeriodStatus,
  FiscalYearStatus,
  JournalEntryStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const INCLUDE = { periods: { orderBy: { startDate: 'asc' as const } } };

/**
 * TASK-051 Phase 2 — Fiscal Years & Accounting Periods. Creating a Fiscal
 * Year auto-generates one monthly Accounting Period per calendar month it
 * spans (UX Policy — never require the user to create periods one at a
 * time). Nothing here touches the Posting Engine; the period-lock guard
 * lives in `PostingEngineService.assertPeriodOpen`, not here.
 */
@Injectable()
export class FiscalYearsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: {
      name: string;
      startDate: string;
      endDate: string;
      companyId?: string;
    },
    userId?: string,
  ) {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end <= start) {
      throw new BadRequestException(
        'Fiscal Year end date must be after the start date.',
      );
    }

    const periods = this.buildMonthlyPeriods(start, end);

    return this.prisma.fiscalYear.create({
      data: {
        name: dto.name,
        startDate: start,
        endDate: end,
        companyId: dto.companyId,
        createdBy: userId ?? null,
        updatedBy: userId ?? null,
        periods: {
          create: periods.map((period) => ({
            name: period.name,
            startDate: period.startDate,
            endDate: period.endDate,
            createdBy: userId ?? null,
            updatedBy: userId ?? null,
          })),
        },
      },
      include: INCLUDE,
    });
  }

  findAll() {
    return this.prisma.fiscalYear.findMany({
      where: { deletedAt: null },
      include: INCLUDE,
      orderBy: { startDate: 'desc' },
    });
  }

  async findOne(id: string) {
    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE,
    });
    if (!fiscalYear) {
      throw new NotFoundException(`Fiscal Year ${id} not found`);
    }
    return fiscalYear;
  }

  async close(id: string, userId?: string) {
    const fiscalYear = await this.findOne(id);
    if (fiscalYear.status !== FiscalYearStatus.OPEN) {
      throw new BadRequestException(
        `Fiscal Year "${fiscalYear.name}" is already ${fiscalYear.status}.`,
      );
    }
    // TASK-055 Part 6 — "cannot close year with Draft journal entries."
    const draftCount = await this.prisma.journalEntry.count({
      where: {
        status: JournalEntryStatus.DRAFT,
        entryDate: { gte: fiscalYear.startDate, lte: fiscalYear.endDate },
        deletedAt: null,
      },
    });
    if (draftCount > 0) {
      throw new BadRequestException(
        `Cannot close Fiscal Year "${fiscalYear.name}" — ${draftCount} Draft journal entry(ies) dated within it must be posted or archived first.`,
      );
    }
    // TASK-057 — "cannot close a year while one of its months is still
    // open." Without this, new documents could still post into an
    // already-closed year via an OPEN period, corrupting the retained
    // earnings Year Closing later computes from it.
    const openPeriodCount = await this.prisma.accountingPeriod.count({
      where: { fiscalYearId: id, status: AccountingPeriodStatus.OPEN },
    });
    if (openPeriodCount > 0) {
      throw new BadRequestException(
        `Cannot close Fiscal Year "${fiscalYear.name}" — ${openPeriodCount} of its Accounting Period(s) are still Open. Close or lock every period first.`,
      );
    }
    return this.prisma.fiscalYear.update({
      where: { id },
      data: { status: FiscalYearStatus.CLOSED, updatedBy: userId ?? null },
      include: INCLUDE,
    });
  }

  async reopen(id: string, userId?: string) {
    await this.findOne(id);
    return this.prisma.fiscalYear.update({
      where: { id },
      data: { status: FiscalYearStatus.OPEN, updatedBy: userId ?? null },
      include: INCLUDE,
    });
  }

  /** Soft-delete — same convention as every other reference entity in this codebase. */
  async archive(id: string, userId?: string) {
    await this.findOne(id);
    return this.prisma.fiscalYear.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userId ?? null },
      include: INCLUDE,
    });
  }

  /**
   * Marks this the one Fiscal Year new documents' auto-resolved
   * `fiscalYearId` displays as "current" — clears the flag off every other
   * year first (at most one default at a time), same pattern as a
   * single-row "default" toggle elsewhere in this codebase.
   */
  async setDefault(id: string, userId?: string) {
    await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      await tx.fiscalYear.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
      return tx.fiscalYear.update({
        where: { id },
        data: { isDefault: true, updatedBy: userId ?? null },
        include: INCLUDE,
      });
    });
  }

  /**
   * TASK-055 — "every accounting document must belong to a Fiscal Year."
   * Looks up the Fiscal Year whose date range contains `entryDate`; returns
   * `null` when none is configured yet (permissive, same "absent is fine,
   * only an explicit blocking state blocks" philosophy as
   * `AccountingPeriodsService.assertPeriodOpen`). Never throws — the
   * Posting Engine/JournalEntriesService's own opening-balance/closed-year
   * guards (also in this service) are what actually block posting.
   */
  async resolveFiscalYearId(
    entryDate: Date,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string | null> {
    const fiscalYear = await client.fiscalYear.findFirst({
      where: {
        startDate: { lte: entryDate },
        endDate: { gte: entryDate },
        deletedAt: null,
      },
      select: { id: true },
    });
    return fiscalYear?.id ?? null;
  }

  /**
   * TASK-055 Part 6 ERP Validation — "cannot post into a Closed Fiscal Year"
   * and "cannot post before Opening Balance." Permissive when no Fiscal Year
   * is configured for `entryDate` at all (same philosophy as
   * `AccountingPeriodsService.assertPeriodOpen`) — creating a Fiscal Year is
   * what opts an admin into this discipline. The Opening Balance entry and
   * the Year Closing entry are themselves exempt from the "needs an Opening
   * Balance first" check (they ARE that setup step); every other sourceType,
   * including manual entries (`sourceType` undefined), is checked.
   */
  async assertPostingAllowed(
    entryDate: Date,
    sourceType: string | undefined,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const fiscalYear = await client.fiscalYear.findFirst({
      where: {
        startDate: { lte: entryDate },
        endDate: { gte: entryDate },
        deletedAt: null,
      },
    });
    if (!fiscalYear) return;
    if (fiscalYear.status === FiscalYearStatus.CLOSED) {
      throw new BadRequestException(
        `Cannot post — Fiscal Year "${fiscalYear.name}" is closed.`,
      );
    }
    if (sourceType === 'OPENING_BALANCE' || sourceType === 'YEAR_CLOSING') {
      return;
    }
    const openingEntry = await client.journalEntry.findFirst({
      where: {
        sourceType: 'OPENING_BALANCE',
        sourceId: fiscalYear.id,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!openingEntry) {
      throw new BadRequestException(
        `Cannot post — Fiscal Year "${fiscalYear.name}" has no Opening Balance yet.`,
      );
    }
  }

  /** Splits [start, end] into one period per calendar month it touches — the last period is clipped to `end` if the range doesn't land on a month boundary. */
  private buildMonthlyPeriods(start: Date, end: Date) {
    const periods: { name: string; startDate: Date; endDate: Date }[] = [];
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
      const periodStart = cursor < start ? start : cursor;
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      const periodEnd = monthEnd > end ? end : monthEnd;
      periods.push({
        name: `${MONTH_ABBR[cursor.getMonth()]} ${cursor.getFullYear()}`,
        startDate: periodStart,
        endDate: periodEnd,
      });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    return periods;
  }
}
