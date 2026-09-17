import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import { AccountMappingService } from '../account-mapping/account-mapping.service';
import type {
  PostingProvider,
  PostingResult,
} from '../posting-engine/posting-provider.interface';

/**
 * Accrues shipping/carrier cost when a shipment has a known operational
 * cost: Dr Shipping Expense / Cr Accrued Shipping. Cash settlement later
 * (Expense Payment against the accrued account) clears the liability.
 */
@Injectable()
export class ShipmentCostPostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = ['SHIPMENT_COST'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly postingEngine: PostingEngineService,
    private readonly accountMapping: AccountMappingService,
  ) {}

  onModuleInit() {
    this.postingEngine.registerProvider(this);
  }

  async buildEntries(
    _sourceType: string,
    sourceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const shipment = await tx.shipment.findUniqueOrThrow({
      where: { id: sourceId },
      select: {
        id: true,
        attemptNumber: true,
        baseShippingCost: true,
        additionalShippingCost: true,
        storeOrder: { select: { internalOrderId: true } },
      },
    });
    const amount =
      Number(shipment.baseShippingCost ?? 0) +
      Number(shipment.additionalShippingCost ?? 0);
    if (amount <= 0) return null;

    const expenseAccountId =
      await this.accountMapping.resolveShippingExpenseAccount(tx);
    const accruedAccountId =
      await this.accountMapping.resolveAccruedShippingAccount(tx);
    const reference = `${shipment.storeOrder?.internalOrderId ?? shipment.id} #${shipment.attemptNumber}`;
    return {
      lines: [
        {
          accountId: expenseAccountId,
          debit: amount,
          description: `Shipping cost — ${reference}`,
        },
        {
          accountId: accruedAccountId,
          credit: amount,
          description: `Accrued shipping — ${reference}`,
        },
      ],
      description: `Shipping cost ${reference}`,
      referenceNumber: reference,
    };
  }
}
