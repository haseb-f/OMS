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
 * Accrues the immutable fulfillment/packaging snapshot taken at invoice
 * generation: Dr Fulfillment Expense / Cr Accrued Fulfillment.
 * Absence of a snapshot means UNKNOWN cost — nothing is posted as zero.
 */
@Injectable()
export class FulfillmentCostPostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = ['FULFILLMENT_COST'];

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
    const snapshot = await tx.storeOrderFulfillmentCost.findUnique({
      where: { storeOrderId: sourceId },
    });
    if (!snapshot) return null;
    const amount = Number(snapshot.amount);
    if (amount <= 0) return null;

    const order = await tx.storeOrder.findUniqueOrThrow({
      where: { id: sourceId },
      select: { internalOrderId: true },
    });
    const expenseAccountId =
      await this.accountMapping.resolveFulfillmentExpenseAccount(tx);
    const accruedAccountId =
      await this.accountMapping.resolveAccruedFulfillmentAccount(tx);
    return {
      lines: [
        {
          accountId: expenseAccountId,
          debit: amount,
          description: `Fulfillment cost — ${order.internalOrderId}`,
        },
        {
          accountId: accruedAccountId,
          credit: amount,
          description: `Accrued fulfillment — ${order.internalOrderId}`,
        },
      ],
      description: `Fulfillment cost ${order.internalOrderId}`,
      referenceNumber: order.internalOrderId,
    };
  }
}
