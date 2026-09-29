import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AccountType,
  AccountingPeriodStatus,
  FiscalYearStatus,
  JournalEntryStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PostingEngineService } from '../accounting/posting-engine/posting-engine.service';
import {
  candidateRangeQuery,
  coversInstant,
  pickCovering,
  rangeDateOf,
} from '../accounting/fiscal-periods/period-bounds';
import { businessDateOf } from '../common/time/business-date';

const SOURCE_TYPE = 'CAPITAL_RETURN';
const PROFIT_AND_LOSS: AccountType[] = [
  AccountType.EXPENSE,
  AccountType.REVENUE,
];

interface LineView {
  account: string;
  accountType: AccountType;
  debit: number;
  credit: number;
  partnerId: string | null;
}

export interface CapitalReturnCorrectionResult {
  dryRun: boolean;
  reason: string;
  capitalReturn: { id: string; code: string };
  /** `ORIGINAL_PERIOD` when the original period and year are still open (the correction restates that period); `OPEN_PERIOD_SAME_YEAR` when that period is closed — dated in the original fiscal year's latest open period. */
  dating: CorrectionDating;
  correctionDate: Date;
  profitEffect: number;
  original: { id: string; entryNumber: string; lines: LineView[] };
  reversal: { id: string; entryNumber: string } | null;
  corrected: { id: string; entryNumber: string; lines: LineView[] } | null;
}

type CorrectionDating =
  | 'ORIGINAL_PERIOD'
  | 'OPEN_PERIOD_SAME_YEAR'
  /** The original year has no open period on or after the original date (or the year is Closed) — refused. */
  | 'BLOCKED_NO_OPEN_PERIOD'
  /** The original year already has an active Year Closing — refused (owner decision, see decisions-round2.md). */
  | 'BLOCKED_YEAR_CLOSED';

class DryRunRollback extends Error {
  constructor(readonly result: CapitalReturnCorrectionResult) {
    super('dry-run');
  }
}

const ENTRY_INCLUDE = {
  lines: {
    include: {
      account: { select: { code: true, name: true, accountType: true } },
    },
    orderBy: { lineOrder: 'asc' as const },
  },
} satisfies Prisma.JournalEntryInclude;

type EntryWithLines = Prisma.JournalEntryGetPayload<{
  include: typeof ENTRY_INCLUDE;
}>;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Amount a Capital Return entry charged to profit or loss (debit − credit on Revenue/Expense accounts). */
function profitAndLossCharge(entry: EntryWithLines): number {
  return round2(
    entry.lines
      .filter((line) => PROFIT_AND_LOSS.includes(line.account.accountType))
      .reduce((sum, line) => sum + Number(line.debit) - Number(line.credit), 0),
  );
}

function toView(line: EntryWithLines['lines'][number]): LineView {
  return {
    account: `${line.account.code} ${line.account.name}`,
    accountType: line.account.accountType,
    debit: Number(line.debit),
    credit: Number(line.credit),
    partnerId: line.partnerId,
  };
}

/**
 * Audited correction of Capital Return postings that charged the principal
 * repayment to profit or loss (the standard COA mapped
 * `capitalReturnAccountId` to 551, an EXPENSE account). Same method as the
 * FX correction precedent (`FxCorrectionService`): never edits a posted
 * row — the Posting Engine reverses the original entry and posts the
 * document again, now Dr Investor Funding / Cr Bank, in one transaction,
 * with the reason and before/after ids in the Journal Entry activity log.
 * `dryRun` performs the same work and rolls it back.
 *
 * Dating: when the original entry's accounting period and fiscal year are
 * still open, both correcting entries are dated on the original date, so
 * that period's profit is restated exactly. When that period or year is
 * closed/locked, they are dated now (the current open period) — the
 * closed period is never touched, and the correction shows as a credit to
 * 551 in the current period of the same fiscal year. When the original
 * year already has an active Year Closing, the expense is inside Retained
 * Earnings and a current-period credit to 551 would inflate the current
 * year's profit — refused until the owner decides the treatment (IAS 8:
 * Dr Investor Funding / Cr Retained Earnings; see decisions-round2.md).
 */
@Injectable()
export class CapitalReturnCorrectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly postingEngine: PostingEngineService,
  ) {}

  /** Every active Capital Return posting that still charges profit or loss, with its planned correction date and profit effect. */
  async listAffected() {
    const entries = await this.affectedEntries(this.prisma);
    const codes = await this.returnCodes(entries.map((e) => e.sourceId!));
    const rows = [];
    for (const entry of entries) {
      const plan = await this.planDate(entry.entryDate, this.prisma);
      const fiscalYear = entry.fiscalYearId
        ? await this.prisma.fiscalYear.findUnique({
            where: { id: entry.fiscalYearId },
            select: { name: true },
          })
        : null;
      rows.push({
        journalEntryId: entry.id,
        entryNumber: entry.entryNumber,
        entryDate: entry.entryDate,
        fiscalYear: fiscalYear?.name ?? null,
        period: businessDateOf(entry.entryDate).slice(0, 7),
        capitalReturnId: entry.sourceId,
        capitalReturnCode: codes.get(entry.sourceId!) ?? null,
        profitEffect: profitAndLossCharge(entry),
        chargedAccounts: entry.lines
          .filter((line) => PROFIT_AND_LOSS.includes(line.account.accountType))
          .map((line) => `${line.account.code} ${line.account.name}`),
        dating: plan.dating,
        plannedCorrectionDate: plan.dating.startsWith('BLOCKED')
          ? null
          : plan.date,
        yearClosingEntry: plan.yearClosingEntry,
      });
    }
    const byPeriod = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.fiscalYear ?? '—'} ${row.period}`;
      byPeriod.set(key, round2((byPeriod.get(key) ?? 0) + row.profitEffect));
    }
    return {
      entries: rows,
      totalProfitUnderstated: round2(
        rows.reduce((sum, row) => sum + row.profitEffect, 0),
      ),
      byPeriod: [...byPeriod.entries()].map(([period, amount]) => ({
        period,
        profitUnderstated: amount,
      })),
    };
  }

  async correct(
    journalEntryId: string,
    input: { reason: string; dryRun?: boolean },
    userId?: string,
  ): Promise<CapitalReturnCorrectionResult> {
    const reason = input.reason?.trim();
    if (!reason) {
      throw new BadRequestException(
        'A reason is required for a Capital Return correction.',
      );
    }
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const result = await this.run(tx, journalEntryId, reason, userId);
          if (input.dryRun) {
            throw new DryRunRollback({ ...result, dryRun: true });
          }
          return result;
        },
        { maxWait: 10_000, timeout: 60_000 },
      );
    } catch (error) {
      if (error instanceof DryRunRollback) return error.result;
      throw error;
    }
  }

  private async run(
    tx: Prisma.TransactionClient,
    journalEntryId: string,
    reason: string,
    userId?: string,
  ): Promise<CapitalReturnCorrectionResult> {
    await tx.$queryRaw`SELECT id FROM journal_entries WHERE id = ${journalEntryId}::uuid FOR UPDATE`;
    const entry = await tx.journalEntry.findFirst({
      where: { id: journalEntryId, deletedAt: null },
      include: ENTRY_INCLUDE,
    });
    if (!entry) throw new BadRequestException('Journal Entry not found.');
    if (entry.sourceType !== SOURCE_TYPE || !entry.sourceId) {
      throw new BadRequestException(
        `${entry.entryNumber} is not a Capital Return posting.`,
      );
    }
    if (entry.status !== JournalEntryStatus.POSTED || entry.reversalOfEntryId) {
      throw new BadRequestException(
        `${entry.entryNumber} is not an active posted entry — only the current posting of a Capital Return can be corrected.`,
      );
    }
    const profitEffect = profitAndLossCharge(entry);
    if (profitEffect === 0) {
      throw new BadRequestException(
        `${entry.entryNumber} does not charge profit or loss — nothing to correct.`,
      );
    }
    const capitalReturn = await tx.capitalReturn.findUniqueOrThrow({
      where: { id: entry.sourceId },
      select: { id: true, code: true },
    });

    const plan = await this.planDate(entry.entryDate, tx);
    if (plan.dating === 'BLOCKED_NO_OPEN_PERIOD') {
      throw new BadRequestException({
        code: 'CAPITAL_RETURN_NO_OPEN_PERIOD_IN_YEAR',
        message: `${entry.entryNumber}'s accounting period is closed and its fiscal year has no open period on or after ${businessDateOf(entry.entryDate)} to date the correction in. Open one (or decide the treatment with the owner) — a correction is never posted into another fiscal year.`,
      });
    }
    if (plan.dating === 'BLOCKED_YEAR_CLOSED') {
      throw new BadRequestException({
        code: 'CAPITAL_RETURN_YEAR_ALREADY_CLOSED',
        message: `${entry.entryNumber} belongs to a fiscal year already closed by ${plan.yearClosingEntry}: its expense is inside Retained Earnings, so a reversal in the current period would overstate this year's profit. This needs an owner decision (prior-period correction to Retained Earnings) — not corrected.`,
      });
    }
    const reversal = await this.postingEngine.reverse(
      SOURCE_TYPE,
      entry.sourceId,
      userId,
      tx,
      { entryDate: plan.date },
    );
    const posted = await this.postingEngine.post(
      SOURCE_TYPE,
      entry.sourceId,
      userId,
      tx,
      { entryDate: plan.date },
    );
    const corrected = posted
      ? await tx.journalEntry.findUniqueOrThrow({
          where: { id: posted.id },
          include: ENTRY_INCLUDE,
        })
      : null;
    if (!corrected || profitAndLossCharge(corrected) !== 0) {
      throw new BadRequestException(
        'The re-posted Capital Return still charges profit or loss — check that Investor Funding in Accounting Settings is the liability the contributions were credited to.',
      );
    }

    const metadata = {
      reason,
      userId: userId ?? null,
      capitalReturnId: capitalReturn.id,
      profitEffect,
      dating: plan.dating,
      correctionDate: plan.date.toISOString(),
      originalEntryId: entry.id,
      reversalEntryId: reversal?.id ?? null,
      correctedEntryId: corrected.id,
    };
    const summary = `Capital Return correction (${capitalReturn.code}): ${entry.entryNumber} charged ${profitEffect} to profit or loss; reversed by ${reversal?.entryNumber ?? '—'} and re-posted as ${corrected.entryNumber} against Investor Funding. Reason: ${reason}`;
    for (const id of [entry.id, reversal?.id, corrected.id].filter(
      Boolean,
    ) as string[]) {
      await tx.journalEntryActivity.create({
        data: {
          journalEntryId: id,
          type: 'CAPITAL_RETURN_CORRECTION',
          description: summary,
          metadata,
        },
      });
    }

    return {
      dryRun: false,
      reason,
      capitalReturn,
      dating: plan.dating,
      correctionDate: plan.date,
      profitEffect,
      original: {
        id: entry.id,
        entryNumber: entry.entryNumber,
        lines: entry.lines.map(toView),
      },
      reversal: reversal
        ? { id: reversal.id, entryNumber: reversal.entryNumber }
        : null,
      corrected: {
        id: corrected.id,
        entryNumber: corrected.entryNumber,
        lines: corrected.lines.map(toView),
      },
    };
  }

  private affectedEntries(client: Prisma.TransactionClient | PrismaService) {
    return client.journalEntry.findMany({
      where: {
        sourceType: SOURCE_TYPE,
        status: JournalEntryStatus.POSTED,
        reversalOfEntryId: null,
        deletedAt: null,
        lines: {
          some: { account: { accountType: { in: PROFIT_AND_LOSS } } },
        },
      },
      include: ENTRY_INCLUDE,
      orderBy: [{ entryDate: 'asc' }, { entryNumber: 'asc' }],
    });
  }

  private async returnCodes(ids: string[]) {
    const rows = await this.prisma.capitalReturn.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true },
    });
    return new Map(rows.map((row) => [row.id, row.code]));
  }

  /** Original date while its period and fiscal year are open; otherwise now (the current open period). */
  private async planDate(
    original: Date,
    client: Prisma.TransactionClient | PrismaService,
  ): Promise<{
    dating: CorrectionDating;
    date: Date;
    yearClosingEntry: string | null;
  }> {
    const query = candidateRangeQuery(original);
    const [periods, years] = await Promise.all([
      client.accountingPeriod.findMany(query),
      client.fiscalYear.findMany({
        where: { ...query.where, deletedAt: null },
        orderBy: query.orderBy,
        take: query.take,
      }),
    ]);
    const period = pickCovering(periods, original);
    const year = pickCovering(years, original);
    const closing = year
      ? await client.journalEntry.findFirst({
          where: {
            sourceType: 'YEAR_CLOSING',
            sourceId: year.id,
            status: JournalEntryStatus.POSTED,
            reversalOfEntryId: null,
            deletedAt: null,
          },
          select: { entryNumber: true },
        })
      : null;
    if (closing) {
      return {
        dating: 'BLOCKED_YEAR_CLOSED',
        date: original,
        yearClosingEntry: closing.entryNumber,
      };
    }
    const open =
      (!period || period.status === AccountingPeriodStatus.OPEN) &&
      (!year || year.status !== FiscalYearStatus.CLOSED);
    if (open) {
      return {
        dating: 'ORIGINAL_PERIOD',
        date: original,
        yearClosingEntry: null,
      };
    }
    const now = new Date();
    if (!year) {
      // No fiscal years configured: there is no year boundary to respect.
      return {
        dating: 'OPEN_PERIOD_SAME_YEAR',
        date: now,
        yearClosingEntry: null,
      };
    }
    // Stay inside the ORIGINAL fiscal year: its latest open period that
    // has started and does not end before the original entry — today when
    // that period is the current one, otherwise its last day.
    const today = businessDateOf(now);
    const originalDay = businessDateOf(original);
    const openPeriods =
      year.status === FiscalYearStatus.CLOSED
        ? []
        : (
            await client.accountingPeriod.findMany({
              where: {
                fiscalYearId: year.id,
                status: AccountingPeriodStatus.OPEN,
              },
              orderBy: { startDate: 'desc' },
            })
          ).filter(
            (candidate) =>
              rangeDateOf(candidate.startDate) <= today &&
              rangeDateOf(candidate.endDate) >= originalDay,
          );
    const target = openPeriods[0];
    if (!target) {
      return {
        dating: 'BLOCKED_NO_OPEN_PERIOD',
        date: original,
        yearClosingEntry: null,
      };
    }
    const date = coversInstant(target, now)
      ? now
      : new Date(`${rangeDateOf(target.endDate)}T00:00:00.000Z`);
    return { dating: 'OPEN_PERIOD_SAME_YEAR', date, yearClosingEntry: null };
  }
}
