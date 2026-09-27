import { Injectable, OnModuleInit } from '@nestjs/common';
import { PaymentSettlementDocStatus, Prisma } from '@prisma/client';
import { PostingEngineService } from '../accounting/posting-engine/posting-engine.service';
import type {
  PostingProvider,
  PostingResult,
} from '../accounting/posting-engine/posting-provider.interface';
import type { ConversionBasis } from './payment-settlements.service';

/**
 * PAYMENT_SETTLEMENT posting provider (payment-declaration-reconciliation).
 * Replays the journal lines frozen on the settlement's conversionBasis — the
 * exact lines the preview showed and the confirm recomputed server-side — so
 * later rate imports/overrides can never change a posted settlement:
 *
 *   Dr Bank (received × rate) · Dr Commission (fee × rate)
 *   ± Exchange difference (balancing) · Cr Method clearing (carrying value)
 *
 * Lines are already functional; the entry records the claim-currency rate for audit.
 */
@Injectable()
export class PaymentSettlementPostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = ['PAYMENT_SETTLEMENT'];

  constructor(private readonly postingEngine: PostingEngineService) {}

  onModuleInit() {
    this.postingEngine.registerProvider(this);
  }

  async buildEntries(
    _sourceType: string,
    sourceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const settlement = await tx.paymentSettlement.findUnique({
      where: { id: sourceId },
      include: { paymentMethod: { select: { name: true } } },
    });
    if (
      !settlement ||
      settlement.status !== PaymentSettlementDocStatus.POSTED
    ) {
      return null;
    }
    const basis =
      settlement.conversionBasis as unknown as ConversionBasis | null;
    if (!basis?.jeLines?.length) return null;

    return {
      lines: basis.jeLines.map((line) => ({
        accountId: line.accountId,
        debit: line.debit || undefined,
        credit: line.credit || undefined,
        description: line.description,
      })),
      description: `Payment settlement ${settlement.settlementNumber} — ${settlement.paymentMethod.name}${settlement.providerReference ? ` (${settlement.providerReference})` : ''}`,
      referenceNumber: settlement.settlementNumber,
      currencyId: settlement.currencyId,
      exchangeRate: Number(basis.claimRate.rate),
      linesInFunctionalCurrency: true,
      entryDate: settlement.settlementDate,
    };
  }
}
