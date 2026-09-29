import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountType,
  FiscalYearStatus,
  JournalEntryStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalEntryActivityService } from '../../journal-entries/activities/journal-entry-activity.service';
import { FiscalYearsService } from '../fiscal-periods/fiscal-years.service';
import {
  PostingEngineService,
  YEAR_CLOSING_SOURCE_TYPE,
  lockPostingSource,
} from '../posting-engine/posting-engine.service';
import { exclusiveEnd } from '../fiscal-periods/period-bounds';
import { CloseYearDto, ReverseYearClosingDto } from './dto/close-year.dto';

/**
 * Opening balances are DERIVED, never re-posted: the ledger is continuous
 * (every report accumulates from inception), so the next year's opening
 * balance of an account is simply everything posted before that year
 * starts. After the Closing entry, that is each balance-sheet account's
 * year-end balance exactly once, and zero for every Revenue/Expense
 * account. A next-year Opening entry would count every balance twice, so
 * the old `nextFiscalYearId` option is rejected with this code.
 */
export const OPENING_BALANCES_DERIVED = 'OPENING_BALANCES_ARE_DERIVED';

const TX_OPTIONS = { maxWait: 30_000, timeout: 120_000 };

const ENTRY_SELECT = {
  id: true,
  entryNumber: true,
  entryDate: true,
  status: true,
  description: true,
  totalDebit: true,
  totalCredit: true,
  reversalOfEntryId: true,
  postedAt: true,
} as const;

/**
 * Year Closing (TASK-055 Part 5) — distinct from `FiscalYearsService.close()`
 * (the plain Open -> Closed status transition, which must happen first):
 * this posts the closing entry through the Posting Engine
 * (`YearClosingPostingProvider`), transferring the year's profit or loss to
 * Retained Earnings.
 *
 * Guarantees:
 * - Idempotent and concurrency-safe: the engine posts YEAR_CLOSING under a
 *   transaction-scoped advisory lock on the fiscal year and returns the
 *   existing active entry when there is one; the partial unique index
 *   `journal_entries_active_fiscal_singleton_key` makes a second active
 *   closing impossible at the database level.
 * - Ordered: every earlier fiscal year must be Closed, and no later year
 *   may have an active closing (its closing swept P&L up to its own end).
 * - Reversible only as a whole, through the engine (`reverse`): the
 *   reversal is dated on the closing date inside the still-closed year, is
 *   auditable (reason in the activity log), and the year can then be
 *   reopened, adjusted, closed and closed again — exactly once.
 */
@Injectable()
export class YearClosingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: JournalEntryActivityService,
    private readonly fiscalYears: FiscalYearsService,
    private readonly postingEngine: PostingEngineService,
  ) {}

  /** Closing state of one fiscal year, for the Year Closing page. */
  async status(fiscalYearId: string) {
    const fiscalYear = await this.fiscalYears.findOne(fiscalYearId);
    const [entries, blockers, nextFiscalYear] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where: {
          sourceType: YEAR_CLOSING_SOURCE_TYPE,
          sourceId: fiscalYear.id,
          deletedAt: null,
        },
        select: ENTRY_SELECT,
        orderBy: [{ postedAt: 'asc' }, { entryNumber: 'asc' }],
      }),
      this.closeBlockers(fiscalYear),
      this.prisma.fiscalYear.findFirst({
        where: { deletedAt: null, startDate: { gt: fiscalYear.startDate } },
        orderBy: { startDate: 'asc' },
        select: { id: true, name: true, startDate: true, endDate: true },
      }),
    ]);
    const activeClosing =
      entries.find(
        (entry) =>
          entry.status === JournalEntryStatus.POSTED &&
          !entry.reversalOfEntryId,
      ) ?? null;
    return {
      fiscalYear: {
        id: fiscalYear.id,
        name: fiscalYear.name,
        startDate: fiscalYear.startDate,
        endDate: fiscalYear.endDate,
        status: fiscalYear.status,
      },
      activeClosing,
      history: entries,
      blockers: activeClosing ? [] : blockers,
      canClose: !activeClosing && blockers.length === 0,
      canReverse:
        activeClosing != null &&
        (await this.laterActiveClosings(fiscalYear)).length === 0,
      nextFiscalYear,
    };
  }

  async execute(dto: CloseYearDto, userId?: string) {
    if (dto.nextFiscalYearId) {
      throw new BadRequestException({
        code: OPENING_BALANCES_DERIVED,
        message:
          'لا يُنشأ قيد افتتاحي للسنة التالية: الأرصدة الافتتاحية مشتقة من الدفتر (كل ما رُحّل قبل بداية السنة)، وبعد قيد الإقفال تبدأ الإيرادات والمصروفات من صفر. أرسل الطلب دون السنة التالية. — Year Closing never posts a next-year opening entry: opening balances are derived from the ledger (everything posted before the year starts), and after the closing entry every revenue and expense account opens at zero. Send the request without nextFiscalYearId.',
      });
    }
    const fiscalYear = await this.fiscalYears.findOne(dto.fiscalYearId);
    const existing = await this.activeClosing(fiscalYear.id);
    if (existing) return { closingEntry: existing, alreadyClosed: true };

    const blockers = await this.closeBlockers(fiscalYear);
    if (blockers.length > 0) {
      throw new BadRequestException({
        code: blockers[0].code,
        message: blockers.map((blocker) => blocker.message).join(' '),
      });
    }

    // Take the same advisory lock the engine uses (re-entrant within this
    // transaction) BEFORE re-checking, so a request that lost the race sees
    // the winner's entry and reports `alreadyClosed: true`. Concurrent
    // requests wait on the lock, hence the generous timeout.
    const outcome = await this.prisma.$transaction(async (tx) => {
      await lockPostingSource(tx, YEAR_CLOSING_SOURCE_TYPE, fiscalYear.id);
      const winner = await tx.journalEntry.findFirst({
        where: {
          sourceType: YEAR_CLOSING_SOURCE_TYPE,
          sourceId: fiscalYear.id,
          status: JournalEntryStatus.POSTED,
          reversalOfEntryId: null,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (winner) return { id: winner.id, alreadyClosed: true };
      const posted = await this.postingEngine.post(
        YEAR_CLOSING_SOURCE_TYPE,
        fiscalYear.id,
        userId,
        tx,
      );
      return posted ? { id: posted.id, alreadyClosed: false } : null;
    }, TX_OPTIONS);
    if (!outcome) {
      throw new BadRequestException(
        `Fiscal Year "${fiscalYear.name}" has no Revenue or Expense balance to close.`,
      );
    }
    const closingEntry = await this.findEntry(outcome.id);
    return { closingEntry, alreadyClosed: outcome.alreadyClosed };
  }

  /**
   * Controlled reopening: reverses the active closing through the Posting
   * Engine. The reversal is dated on the closing date (inside the closed
   * year), so no other year's figures move. Afterwards the fiscal year can
   * be reopened (Fiscal Years > Reopen), adjusted, closed and closed again.
   */
  async reverse(
    fiscalYearId: string,
    dto: ReverseYearClosingDto,
    userId?: string,
  ) {
    const fiscalYear = await this.fiscalYears.findOne(fiscalYearId);
    const reason = dto.reason.trim();
    const later = await this.laterActiveClosings(fiscalYear);
    if (later.length > 0) {
      throw new BadRequestException({
        code: 'LATER_YEAR_CLOSING_ACTIVE',
        message: `Reverse the later Year Closing first: ${later
          .map((row) => `${row.entryNumber} (${row.fiscalYearName})`)
          .join(', ')}.`,
      });
    }
    if (fiscalYear.status !== FiscalYearStatus.CLOSED) {
      throw new BadRequestException(
        `Fiscal Year "${fiscalYear.name}" is not closed, so it has no closing to reverse.`,
      );
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      const reversal = await this.postingEngine.reverse(
        YEAR_CLOSING_SOURCE_TYPE,
        fiscalYear.id,
        userId,
        tx,
      );
      if (!reversal?.reversalOfEntryId) return null;
      const metadata = {
        reason,
        userId: userId ?? null,
        fiscalYearId: fiscalYear.id,
        originalEntryId: reversal.reversalOfEntryId,
        reversalEntryId: reversal.id,
      };
      const summary = `Year Closing of "${fiscalYear.name}" reversed by ${reversal.entryNumber}. Reason: ${reason}`;
      for (const id of [reversal.reversalOfEntryId, reversal.id]) {
        await this.activityService.log(
          id,
          'YEAR_CLOSING_REVERSED',
          summary,
          metadata,
          tx,
        );
      }
      return reversal;
    }, TX_OPTIONS);
    if (!outcome) {
      throw new BadRequestException(
        `Fiscal Year "${fiscalYear.name}" has no active Year Closing to reverse.`,
      );
    }
    return {
      reversal: await this.findEntry(outcome.id),
      original: await this.findEntry(outcome.reversalOfEntryId!),
    };
  }

  private activeClosing(fiscalYearId: string) {
    return this.prisma.journalEntry.findFirst({
      where: {
        sourceType: YEAR_CLOSING_SOURCE_TYPE,
        sourceId: fiscalYearId,
        status: JournalEntryStatus.POSTED,
        reversalOfEntryId: null,
        deletedAt: null,
      },
      include: {
        lines: { include: { account: true }, orderBy: { lineOrder: 'asc' } },
      },
    });
  }

  private async findEntry(id: string) {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: {
        lines: { include: { account: true }, orderBy: { lineOrder: 'asc' } },
      },
    });
    if (!entry) throw new NotFoundException(`Journal entry ${id} not found`);
    return entry;
  }

  private laterActiveClosings(fiscalYear: { startDate: Date }) {
    return this.fiscalYears.activeClosingsFrom(
      new Date(fiscalYear.startDate.getTime() + 1),
    );
  }

  /**
   * Exact rule: every earlier fiscal year must end with ALL revenue and
   * expense balances at zero — i.e. it was closed by an active Year Closing
   * entry, or it had no profit or loss to close. Checking the immediately
   * preceding year is enough, because its cumulative P&L at its own end
   * (Cairo business day, same cutoff as the closing itself) includes every
   * earlier year. Returns that year's name when it still carries P&L.
   */
  private async previousYearWithUnclosedProfit(fiscalYear: {
    startDate: Date;
  }): Promise<string | null> {
    const previous = await this.prisma.fiscalYear.findFirst({
      where: { deletedAt: null, startDate: { lt: fiscalYear.startDate } },
      orderBy: { startDate: 'desc' },
      select: { name: true, endDate: true },
    });
    if (!previous) return null;
    const sums = await this.prisma.journalEntryLine.groupBy({
      by: ['accountId'],
      where: {
        account: {
          accountType: { in: [AccountType.REVENUE, AccountType.EXPENSE] },
        },
        journalEntry: {
          status: {
            in: [JournalEntryStatus.POSTED, JournalEntryStatus.REVERSED],
          },
          deletedAt: null,
          entryDate: { lt: exclusiveEnd(previous) },
        },
      },
      _sum: { debit: true, credit: true },
    });
    const carriesBalance = sums.some(
      (row) =>
        Math.abs(Number(row._sum.debit ?? 0) - Number(row._sum.credit ?? 0)) >=
        0.005,
    );
    return carriesBalance ? previous.name : null;
  }

  /** Every reason this year cannot be closed right now (empty = it can). */
  private async closeBlockers(fiscalYear: {
    id: string;
    name: string;
    status: FiscalYearStatus;
    startDate: Date;
  }) {
    const blockers: { code: string; message: string }[] = [];
    if (fiscalYear.status !== FiscalYearStatus.CLOSED) {
      blockers.push({
        code: 'FISCAL_YEAR_NOT_CLOSED',
        message: `Close Fiscal Year "${fiscalYear.name}" first (Fiscal Years > Close) before running Year Closing.`,
      });
    }
    const [openEarlier, later, settings] = await Promise.all([
      this.prisma.fiscalYear.findMany({
        where: {
          deletedAt: null,
          startDate: { lt: fiscalYear.startDate },
          status: { not: FiscalYearStatus.CLOSED },
        },
        select: { name: true },
        orderBy: { startDate: 'asc' },
      }),
      this.laterActiveClosings(fiscalYear),
      this.prisma.postingSettings.findFirst({
        select: {
          retainedEarningsAccount: {
            select: {
              code: true,
              name: true,
              accountType: true,
              allowsPosting: true,
              deletedAt: true,
            },
          },
        },
      }),
    ]);
    if (openEarlier.length > 0) {
      blockers.push({
        code: 'EARLIER_FISCAL_YEAR_OPEN',
        message: `Close the earlier fiscal year(s) first: ${openEarlier.map((row) => row.name).join(', ')}.`,
      });
    } else {
      const unclosed = await this.previousYearWithUnclosedProfit(fiscalYear);
      if (unclosed) {
        blockers.push({
          code: 'EARLIER_YEAR_NOT_CLOSED_BY_ENTRY',
          message: `Run Year Closing for "${unclosed}" first: its revenue and expense balances have not been transferred to Retained Earnings, and closing a later year would sweep them in and leave "${unclosed}" impossible to close.`,
        });
      }
    }
    if (later.length > 0) {
      blockers.push({
        code: 'LATER_YEAR_CLOSING_ACTIVE',
        message: `A later fiscal year is already closed (${later
          .map((row) => `${row.entryNumber} ${row.fiscalYearName}`)
          .join(', ')}); reverse that closing first.`,
      });
    }
    const retained = settings?.retainedEarningsAccount;
    if (
      !retained ||
      retained.deletedAt ||
      !retained.allowsPosting ||
      retained.accountType !== AccountType.EQUITY
    ) {
      blockers.push({
        code: 'RETAINED_EARNINGS_NOT_CONFIGURED',
        message: retained
          ? `Retained Earnings must be an active postable Equity account — ${retained.code} ${retained.name} is not. Fix it in Accounting Settings.`
          : 'Configure a Retained Earnings account in Accounting Settings before running Year Closing.',
      });
    }
    return blockers;
  }
}
