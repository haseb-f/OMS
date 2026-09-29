import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { AccountType, Prisma } from '@prisma/client';
import {
  PostingEngineService,
  YEAR_CLOSING_SOURCE_TYPE,
} from '../posting-engine/posting-engine.service';
import type {
  PostingLine,
  PostingProvider,
  PostingResult,
} from '../posting-engine/posting-provider.interface';
import { AccountingReportsService } from '../reports/accounting-reports.service';
import { rangeDateOf } from '../fiscal-periods/period-bounds';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The closing entry's date: the fiscal year's last calendar day, stored
 * date-only (00:00Z = 02:00/03:00 Cairo the same day), so its business
 * date is that day and the Trial Balance cutoff (Cairo end of that day)
 * matches the period-lock membership (period-bounds.ts).
 */
export function closingDateOf(fiscalYear: { endDate: Date }): Date {
  return new Date(`${rangeDateOf(fiscalYear.endDate)}T00:00:00.000Z`);
}

const PROFIT_AND_LOSS: ReadonlySet<AccountType> = new Set([
  AccountType.REVENUE,
  AccountType.EXPENSE,
]);

/**
 * Year Closing posting provider (sourceType YEAR_CLOSING, sourceId = the
 * fiscal year). Builds ONE entry, dated the year's last day, that brings
 * every Revenue/Expense account's balance at year end to exactly zero and
 * transfers the net to Retained Earnings (Posting Settings).
 *
 * Balances come from the Trial Balance (`closingBalance` as of year end:
 * everything posted up to that day, drafts excluded) — the same source the
 * reports use, never a second balance query. Using the cumulative balance
 * rather than only this year's movement means any P&L left unclosed from
 * before the first fiscal year is swept too, so the next year's P&L
 * accounts always open at zero. YearClosingService enforces the order that
 * keeps this exact (earlier years closed, no later closing active).
 */
@Injectable()
export class YearClosingPostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = [YEAR_CLOSING_SOURCE_TYPE];

  constructor(
    private readonly postingEngine: PostingEngineService,
    private readonly accountingReports: AccountingReportsService,
  ) {}

  onModuleInit() {
    this.postingEngine.registerProvider(this);
  }

  async buildEntries(
    _sourceType: string,
    fiscalYearId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const fiscalYear = await tx.fiscalYear.findFirstOrThrow({
      where: { id: fiscalYearId, deletedAt: null },
    });
    const settings = await tx.postingSettings.findFirst({
      select: { retainedEarningsAccountId: true },
    });
    const retainedEarningsAccountId = settings?.retainedEarningsAccountId;
    if (!retainedEarningsAccountId) {
      throw new BadRequestException(
        'Configure a Retained Earnings account in Accounting Settings before running Year Closing.',
      );
    }

    const trialBalance = await this.accountingReports.trialBalance({
      dateFrom: rangeDateOf(fiscalYear.startDate),
      dateTo: rangeDateOf(fiscalYear.endDate),
      includeOpeningBalance: true,
    });

    const lines: PostingLine[] = [];
    let profit = 0;
    for (const row of trialBalance.items) {
      if (!PROFIT_AND_LOSS.has(row.accountType as AccountType)) continue;
      const balance = round2(row.closingBalance);
      if (Math.abs(balance) < 0.01) continue;
      profit = round2(profit - balance);
      lines.push({
        accountId: row.accountId,
        debit: balance < 0 ? -balance : undefined,
        credit: balance > 0 ? balance : undefined,
        description: `Close ${row.accountCode} ${row.accountName} — ${fiscalYear.name}`,
      });
    }
    if (lines.length === 0) return null;

    if (Math.abs(profit) >= 0.01) {
      lines.push({
        accountId: retainedEarningsAccountId,
        credit: profit > 0 ? profit : undefined,
        debit: profit < 0 ? -profit : undefined,
        description: `Net ${profit > 0 ? 'profit' : 'loss'} transferred to Retained Earnings — ${fiscalYear.name}`,
      });
    }

    return {
      lines,
      description: `Year Closing — ${fiscalYear.name}`,
      referenceNumber: fiscalYear.name,
      entryDate: closingDateOf(fiscalYear),
      linesInFunctionalCurrency: true,
    };
  }
}
