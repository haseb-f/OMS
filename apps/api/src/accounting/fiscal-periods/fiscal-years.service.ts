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
import {
  candidateRangeQuery,
  exclusiveEnd,
  pickCovering,
  rangeDateOf,
  rangeStart,
} from './period-bounds';

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

/**
 * A fiscal year's opening is established by its own go-live Opening
 * Balance entry, or — every later year — by posted history before it
 * starts (the ledger is continuous, so that history IS the opening).
 * Shared by the posting gate and the foundation bootstrap.
 */
export async function hasEstablishedOpening(
  fiscalYear: { id: string; startDate: Date },
  client: Pick<Prisma.TransactionClient, 'journalEntry'>,
): Promise<boolean> {
  const openingEntry = await client.journalEntry.findFirst({
    where: {
      sourceType: 'OPENING_BALANCE',
      sourceId: fiscalYear.id,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (openingEntry) return true;
  const priorHistory = await client.journalEntry.findFirst({
    where: {
      entryDate: { lt: rangeStart(fiscalYear) },
      status: { in: [JournalEntryStatus.POSTED, JournalEntryStatus.REVERSED] },
      deletedAt: null,
    },
    select: { id: true },
  });
  return priorHistory != null;
}

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
        entryDate: {
          gte: rangeStart(fiscalYear),
          lt: exclusiveEnd(fiscalYear),
        },
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

  /**
   * Reopening lets documents post into the year again, which would move
   * every figure a Year Closing already transferred to retained earnings —
   * of this year and of every later year (their closings sweep all P&L up
   * to their own end). So the year cannot be reopened while it, or any
   * later year, has an active Year Closing: reverse those first (latest
   * year first, Year Closing > Reverse).
   */
  async reopen(id: string, userId?: string) {
    const fiscalYear = await this.findOne(id);
    const blocking = await this.activeClosingsFrom(fiscalYear.startDate);
    if (blocking.length > 0) {
      throw new BadRequestException({
        code: 'FISCAL_YEAR_HAS_ACTIVE_CLOSING',
        message: `Cannot reopen Fiscal Year "${fiscalYear.name}" — Year Closing ${blocking
          .map((row) => `${row.entryNumber} (${row.fiscalYearName})`)
          .join(
            ', ',
          )} is still active. Reverse it first (Year Closing > Reverse closing), latest year first.`,
      });
    }
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
    const fiscalYear = await this.findCovering(entryDate, client);
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
   * including manual entries (`sourceType` undefined), is checked. A year
   * after the first one needs no Opening entry: its opening is derived from
   * the posted history before it (`hasEstablishedOpening`). Year Closing is
   * the inverse case: it may only be dated inside a CLOSED year.
   */
  async assertPostingAllowed(
    entryDate: Date,
    sourceType: string | undefined,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const fiscalYear = await this.findCovering(entryDate, client);
    if (sourceType === 'YEAR_CLOSING') {
      // The closing ceremony is the one entry that belongs INSIDE a closed
      // year — and only there.
      if (!fiscalYear || fiscalYear.status !== FiscalYearStatus.CLOSED) {
        throw new BadRequestException(
          'Year Closing entries can only be dated inside a closed Fiscal Year.',
        );
      }
      return;
    }
    if (!fiscalYear) return;
    if (fiscalYear.status === FiscalYearStatus.CLOSED) {
      throw new BadRequestException(
        `Cannot post — Fiscal Year "${fiscalYear.name}" is closed.`,
      );
    }
    if (sourceType === 'OPENING_BALANCE') return;
    if (!(await this.hasEstablishedOpening(fiscalYear, client))) {
      throw new BadRequestException(
        `Cannot post — Fiscal Year "${fiscalYear.name}" has no Opening Balance yet.`,
      );
    }
  }

  /**
   * Active (POSTED, not a reversal) Year Closing entries of every fiscal
   * year starting on or after `from`, latest first.
   */
  async activeClosingsFrom(
    from: Date,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const years = await client.fiscalYear.findMany({
      where: { deletedAt: null, startDate: { gte: from } },
      select: { id: true, name: true, startDate: true },
    });
    if (years.length === 0) return [];
    const entries = await client.journalEntry.findMany({
      where: {
        sourceType: 'YEAR_CLOSING',
        sourceId: { in: years.map((year) => year.id) },
        status: JournalEntryStatus.POSTED,
        reversalOfEntryId: null,
        deletedAt: null,
      },
      select: { id: true, entryNumber: true, sourceId: true, entryDate: true },
      orderBy: { entryDate: 'desc' },
    });
    const byId = new Map(years.map((year) => [year.id, year]));
    return entries.map((entry) => ({
      ...entry,
      fiscalYearId: entry.sourceId!,
      fiscalYearName: byId.get(entry.sourceId!)?.name ?? '',
    }));
  }

  /**
   * The year's opening is established when it has its own go-live Opening
   * Balance entry, or — every later year — when posted history exists
   * before it starts: the ledger is continuous, so that history IS the
   * opening (derived, never re-posted; see YearClosingService).
   */
  hasEstablishedOpening(
    fiscalYear: { id: string; startDate: Date },
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return hasEstablishedOpening(fiscalYear, client);
  }

  /**
   * The fiscal year whose calendar dates contain the instant's business
   * (Africa/Cairo) date — see period-bounds.ts.
   */
  async findCovering(
    instant: Date,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const { where, orderBy, take } = candidateRangeQuery(instant);
    return pickCovering(
      await client.fiscalYear.findMany({
        where: { ...where, deletedAt: null },
        orderBy,
        take,
      }),
      instant,
    );
  }

  /** Splits [start, end] into one period per calendar month it touches — the last period is clipped to `end` if the range doesn't land on a month boundary. */
  private buildMonthlyPeriods(start: Date, end: Date) {
    // Date-only bounds (00:00Z of each calendar date) — the storage rule for
    // date-only values; membership is by business date (period-bounds.ts).
    const periods: { name: string; startDate: Date; endDate: Date }[] = [];
    const first = rangeDateOf(start);
    const last = rangeDateOf(end);
    const dateOnly = (y: number, m: number, d: number) =>
      new Date(Date.UTC(y, m, d));
    const [startY, startM] = first.split('-').map(Number);
    let year = startY;
    let month = startM - 1;
    while (dateOnly(year, month, 1).toISOString().slice(0, 10) <= last) {
      const monthStart = dateOnly(year, month, 1).toISOString().slice(0, 10);
      const monthEnd = dateOnly(year, month + 1, 0)
        .toISOString()
        .slice(0, 10);
      const periodStart = monthStart < first ? first : monthStart;
      const periodEnd = monthEnd > last ? last : monthEnd;
      periods.push({
        name: `${MONTH_ABBR[month]} ${year}`,
        startDate: new Date(`${periodStart}T00:00:00.000Z`),
        endDate: new Date(`${periodEnd}T00:00:00.000Z`),
      });
      month += 1;
      if (month === 12) {
        month = 0;
        year += 1;
      }
    }
    return periods;
  }
}
