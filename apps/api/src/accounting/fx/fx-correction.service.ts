import { BadRequestException, Injectable } from '@nestjs/common';
import { JournalEntryStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import { ExchangeRatesService } from './exchange-rates.service';

/** Documents whose posting has no side effect beyond its Journal Entry, so
 *  reverse + re-post is exact. Purchase Invoices are excluded: posting one
 *  also re-blends moving-average cost, which a re-post would apply twice. */
const CORRECTABLE = {
  SALES_INVOICE: 'salesInvoice',
  SALES_RETURN: 'salesReturn',
  PURCHASE_RETURN: 'purchaseReturn',
  CUSTOMER_RECEIPT: 'financialTransaction',
  SUPPLIER_PAYMENT: 'financialTransaction',
  EXPENSE_PAYMENT: 'financialTransaction',
} as const;
type CorrectableSource = keyof typeof CORRECTABLE;

interface LineView {
  account: string;
  debit: number;
  credit: number;
  partnerId: string | null;
}

export interface FxCorrectionResult {
  dryRun: boolean;
  sourceType: string;
  sourceId: string;
  reason: string;
  previousRate: number | null;
  correctedRate: number | null;
  original: { id: string; entryNumber: string; lines: LineView[] };
  reversal: { id: string; entryNumber: string } | null;
  corrected: { id: string; entryNumber: string; lines: LineView[] } | null;
}

class DryRunRollback extends Error {
  constructor(readonly result: FxCorrectionResult) {
    super('dry-run');
  }
}

/**
 * Audited correction for a document posted at a wrong exchange rate (or
 * with FX applied to amounts already in base currency). Never edits a
 * posted entry: the Posting Engine reverses it with a dated reversal, the
 * document's rate snapshot is re-resolved against the configured base
 * currency, and the Posting Engine posts it again — all in one
 * transaction, with before/after recorded in the Journal Entry activity
 * log. `dryRun` performs the same work and rolls it back, returning the
 * preview used to request approval.
 */
@Injectable()
export class FxCorrectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly postingEngine: PostingEngineService,
    private readonly exchangeRates: ExchangeRatesService,
  ) {}

  async repost(
    journalEntryId: string,
    input: { reason: string; dryRun?: boolean },
    userId?: string,
  ): Promise<FxCorrectionResult> {
    const reason = input.reason?.trim();
    if (!reason) {
      throw new BadRequestException(
        'A reason is required for an FX correction.',
      );
    }
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const result = await this.run(tx, journalEntryId, reason, userId);
          if (input.dryRun)
            throw new DryRunRollback({ ...result, dryRun: true });
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
  ): Promise<FxCorrectionResult> {
    const entry = await tx.journalEntry.findFirst({
      where: { id: journalEntryId, deletedAt: null },
      include: { lines: { include: { account: true } } },
    });
    if (!entry) throw new BadRequestException('Journal Entry not found.');
    if (entry.status !== JournalEntryStatus.POSTED || entry.reversalOfEntryId) {
      throw new BadRequestException(
        `${entry.entryNumber} is not an active posted entry — only the current posting of a document can be corrected.`,
      );
    }
    const sourceType = entry.sourceType as CorrectableSource | null;
    if (!sourceType || !(sourceType in CORRECTABLE) || !entry.sourceId) {
      throw new BadRequestException(
        `${entry.entryNumber} (${entry.sourceType ?? 'manual'}) cannot be FX-corrected here. Supported: ${Object.keys(CORRECTABLE).join(', ')}.`,
      );
    }
    if (!entry.currencyId) {
      throw new BadRequestException(
        `${entry.entryNumber} carries no currency, so no exchange rate was applied.`,
      );
    }
    await this.exchangeRates.requireFunctionalCurrencyId(tx);

    const sourceId = entry.sourceId;
    const delegate = this.documentDelegate(tx, sourceType);
    const document = await delegate.findUniqueOrThrow({
      where: { id: sourceId },
      select: { exchangeRate: true },
    });
    const previousRate =
      document.exchangeRate != null ? Number(document.exchangeRate) : null;

    const reversal = await this.postingEngine.reverse(
      sourceType,
      sourceId,
      userId,
      tx,
    );
    await delegate.update({
      where: { id: sourceId },
      data: { exchangeRate: null },
    });
    const corrected = await this.postingEngine.post(
      sourceType,
      sourceId,
      userId,
      tx,
    );
    const after = await delegate.findUniqueOrThrow({
      where: { id: sourceId },
      select: { exchangeRate: true },
    });
    const correctedRate =
      after.exchangeRate != null ? Number(after.exchangeRate) : null;

    const correctedLines = corrected
      ? await tx.journalEntryLine.findMany({
          where: { journalEntryId: corrected.id },
          include: { account: true },
          orderBy: { lineOrder: 'asc' },
        })
      : [];
    const result: FxCorrectionResult = {
      dryRun: false,
      sourceType,
      sourceId,
      reason,
      previousRate,
      correctedRate,
      original: {
        id: entry.id,
        entryNumber: entry.entryNumber,
        lines: entry.lines.map(toView),
      },
      reversal: reversal
        ? { id: reversal.id, entryNumber: reversal.entryNumber }
        : null,
      corrected: corrected
        ? {
            id: corrected.id,
            entryNumber: corrected.entryNumber,
            lines: correctedLines.map(toView),
          }
        : null,
    };

    const metadata = {
      reason,
      userId: userId ?? null,
      previousRate,
      correctedRate,
      originalEntryId: entry.id,
      reversalEntryId: reversal?.id ?? null,
      correctedEntryId: corrected?.id ?? null,
    };
    const summary = `FX correction: ${entry.entryNumber} reversed by ${reversal?.entryNumber ?? '—'} and re-posted as ${corrected?.entryNumber ?? '—'} (rate ${previousRate ?? '—'} → ${correctedRate ?? '—'}). Reason: ${reason}`;
    for (const id of [entry.id, corrected?.id].filter(Boolean) as string[]) {
      await tx.journalEntryActivity.create({
        data: {
          journalEntryId: id,
          type: 'FX_CORRECTION',
          description: summary,
          metadata: metadata,
        },
      });
    }
    return result;
  }

  private documentDelegate(
    tx: Prisma.TransactionClient,
    sourceType: CorrectableSource,
  ) {
    // All correctable documents share the `exchangeRate` snapshot column.
    return tx[CORRECTABLE[sourceType]] as unknown as {
      findUniqueOrThrow(args: {
        where: { id: string };
        select: { exchangeRate: true };
      }): Promise<{ exchangeRate: Prisma.Decimal | null }>;
      update(args: {
        where: { id: string };
        data: { exchangeRate: null };
      }): Promise<unknown>;
    };
  }
}

function toView(line: {
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  partnerId: string | null;
  account: { code: string; name: string };
}): LineView {
  return {
    account: `${line.account.code} ${line.account.name}`,
    debit: Number(line.debit),
    credit: Number(line.credit),
    partnerId: line.partnerId,
  };
}
