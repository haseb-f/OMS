import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountType,
  FxRevaluationStatus,
  JournalEntryStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import { ExchangeRatesService } from './exchange-rates.service';
import { RunFxRevaluationDto } from './dto/fx.dto';

const MONETARY_TYPES: AccountType[] = [
  AccountType.ASSET,
  AccountType.LIABILITY,
];

@Injectable()
export class FxRevaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly postingEngine: PostingEngineService,
    private readonly exchangeRates: ExchangeRatesService,
  ) {}

  async findAll() {
    return this.prisma.fxRevaluationRun.findMany({
      orderBy: { rateDate: 'desc' },
      take: 100,
    });
  }

  async findOne(id: string) {
    const run = await this.prisma.fxRevaluationRun.findUnique({
      where: { id },
    });
    if (!run) throw new NotFoundException(`FX revaluation ${id} not found`);
    const journal = await this.prisma.journalEntry.findFirst({
      where: {
        sourceType: 'FX_REVALUATION',
        sourceId: id,
        status: JournalEntryStatus.POSTED,
        reversalOfEntryId: null,
        deletedAt: null,
      },
      include: { lines: { include: { account: true } } },
    });
    return { ...run, journalEntry: journal };
  }

  async run(dto: RunFxRevaluationDto, userId?: string) {
    const rateDate = new Date(dto.rateDate);
    const existing = await this.prisma.fxRevaluationRun.findUnique({
      where: { rateDate },
    });
    if (existing?.status === FxRevaluationStatus.POSTED) {
      return this.findOne(existing.id);
    }

    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.fxRevaluationRun.findFirst({
        where: {
          status: FxRevaluationStatus.POSTED,
          rateDate: { lt: rateDate },
        },
        orderBy: { rateDate: 'desc' },
      });
      if (previous) {
        await this.postingEngine.reverse(
          'FX_REVALUATION',
          previous.id,
          userId,
          tx,
        );
        await tx.fxRevaluationRun.update({
          where: { id: previous.id },
          data: { status: FxRevaluationStatus.REVERSED },
        });
      }

      const run =
        existing ??
        (await tx.fxRevaluationRun.create({
          data: {
            runNumber: await this.numberingEngine.generateNumber(
              'FX_REVALUATION',
              undefined,
              tx,
            ),
            rateDate,
            status: FxRevaluationStatus.POSTED,
            notes: dto.notes,
            createdBy: userId ?? null,
          },
        }));
      if (existing) {
        await tx.fxRevaluationRun.update({
          where: { id: existing.id },
          data: {
            status: FxRevaluationStatus.POSTED,
            notes: dto.notes ?? existing.notes,
          },
        });
      }

      const posted = await this.postingEngine.post(
        'FX_REVALUATION',
        run.id,
        userId,
        tx,
      );
      if (!posted && !previous) {
        await tx.fxRevaluationRun.delete({ where: { id: run.id } });
        throw new BadRequestException(
          'No foreign-currency monetary balances required revaluation on this date.',
        );
      }
      return {
        ...(await tx.fxRevaluationRun.findUniqueOrThrow({
          where: { id: run.id },
        })),
        journalEntry: posted,
      };
    });
  }

  async buildRevaluationLines(
    runId: string,
    tx: Prisma.TransactionClient,
  ): Promise<{
    lines: Array<{
      accountId: string;
      debit?: number;
      credit?: number;
      description?: string;
    }>;
    rateDate: Date;
    runNumber: string;
  } | null> {
    const run = await tx.fxRevaluationRun.findUniqueOrThrow({
      where: { id: runId },
    });
    const functionalId =
      await this.exchangeRates.resolveFunctionalCurrencyId(tx);
    if (!functionalId) return null;

    const entries = await tx.journalEntry.findMany({
      where: {
        status: {
          in: [JournalEntryStatus.POSTED, JournalEntryStatus.REVERSED],
        },
        deletedAt: null,
        entryDate: { lte: run.rateDate },
        currencyId: { not: null },
        exchangeRate: { not: null },
        NOT: { sourceType: 'FX_REVALUATION' },
      },
      include: { lines: true },
    });

    const accounts = await tx.chartOfAccount.findMany({
      where: {
        deletedAt: null,
        accountType: { in: MONETARY_TYPES },
        OR: [{ allowReconciliation: true }, { currencyId: { not: null } }],
      },
      select: { id: true, code: true, name: true, currencyId: true },
    });
    const monetary = new Map(accounts.map((row) => [row.id, row]));

    type Bucket = {
      accountId: string;
      currencyId: string;
      partnerId: string | null;
      foreign: number;
      functional: number;
    };
    const buckets = new Map<string, Bucket>();

    for (const entry of entries) {
      if (!entry.currencyId || entry.currencyId === functionalId) continue;
      const rate = Number(entry.exchangeRate);
      if (!rate || rate === 1) continue;
      const sign = entry.status === JournalEntryStatus.REVERSED ? 0 : 1;
      if (sign === 0) continue;
      for (const line of entry.lines) {
        if (!monetary.has(line.accountId)) continue;
        const partnerId = line.partnerId ?? null;
        const key = `${line.accountId}:${entry.currencyId}:${partnerId ?? '_'}`;
        const bucket = buckets.get(key) ?? {
          accountId: line.accountId,
          currencyId: entry.currencyId,
          partnerId,
          foreign: 0,
          functional: 0,
        };
        const debit = Number(line.debit);
        const credit = Number(line.credit);
        bucket.functional += debit - credit;
        bucket.foreign += (debit - credit) / rate;
        buckets.set(key, bucket);
      }
    }

    const lines: Array<{
      accountId: string;
      debit?: number;
      credit?: number;
      description?: string;
      partnerId?: string;
    }> = [];
    const unrealizedId = await this.requireUnrealizedAccount(tx);

    for (const bucket of buckets.values()) {
      const roundedForeign = Math.round(bucket.foreign * 100) / 100;
      if (Math.abs(roundedForeign) < 0.01) continue;
      const newRate = await this.exchangeRates.resolveRate(
        bucket.currencyId,
        functionalId,
        run.rateDate,
        tx,
      );
      const revalued = Math.round(roundedForeign * newRate * 100) / 100;
      const current = Math.round(bucket.functional * 100) / 100;
      const diff = Math.round((revalued - current) * 100) / 100;
      if (Math.abs(diff) < 0.01) continue;
      const account = monetary.get(bucket.accountId);
      if (diff > 0) {
        lines.push({
          accountId: bucket.accountId,
          debit: diff,
          partnerId: bucket.partnerId ?? undefined,
          description: `FX revaluation ${run.runNumber} — ${account?.code}`,
        });
        lines.push({
          accountId: unrealizedId,
          credit: diff,
          description: `Unrealized FX ${run.runNumber}`,
        });
      } else {
        lines.push({
          accountId: unrealizedId,
          debit: Math.abs(diff),
          description: `Unrealized FX ${run.runNumber}`,
        });
        lines.push({
          accountId: bucket.accountId,
          credit: Math.abs(diff),
          partnerId: bucket.partnerId ?? undefined,
          description: `FX revaluation ${run.runNumber} — ${account?.code}`,
        });
      }
    }

    if (lines.length === 0) return null;
    return { lines, rateDate: run.rateDate, runNumber: run.runNumber };
  }

  private async requireUnrealizedAccount(tx: Prisma.TransactionClient) {
    const settings = await tx.postingSettings.findFirst();
    const accountId =
      settings?.unrealizedFxAccountId ?? settings?.exchangeDifferenceAccountId;
    if (!accountId) {
      throw new BadRequestException(
        'No Unrealized FX account configured. Set PostingSettings.unrealizedFxAccountId.',
      );
    }
    return accountId;
  }
}
