import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import { AccountMappingService } from '../account-mapping/account-mapping.service';
import { round2 } from '../inventory-valuation/inventory-valuation.service';
import {
  ASSEMBLY_REVERSAL_VARIANCE_TYPE,
  assemblyReversalOutputKey,
} from '../../assembly/assembly-keys';
import type {
  PostingLine,
  PostingProvider,
  PostingResult,
} from '../posting-engine/posting-provider.interface';

/**
 * Assembly reversal variance (R13 M3). A reversal posts the exact mirror of
 * the assembly journal (engine reversal: components back at their recorded
 * values, the finished item credited at the recorded total `R`), while the
 * finished units leave the sub-ledger at the CURRENT average (the average of
 * what remains never moves). When that average moved since the assembly, the
 * two differ by `D = R − round2(quantity × average)`; this entry closes the
 * gap so the GL relieves exactly what the sub-ledger relieved:
 *
 *   D > 0   Dr Inventory (finished category)   D   ·  Cr COGS (finished category)   D
 *   D < 0   Dr COGS (finished category)       |D|  ·  Cr Inventory (finished category) |D|
 *
 * Deterministic from stored data: `R` is the order's `totalCost`, the
 * average is the `unitCost` of the reversal's finished-item movement. Nothing
 * to post when `D = 0`, for an order that was never reversed, or for
 * agent-owned stock (never in the company GL). `sourceId` = the order id.
 */
@Injectable()
export class AssemblyReversalVariancePostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = [ASSEMBLY_REVERSAL_VARIANCE_TYPE];

  constructor(
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
    const order = await tx.assemblyOrder.findUniqueOrThrow({
      where: { id: sourceId },
      include: { product: { select: { categoryId: true, name: true } } },
    });
    if (order.ownerAgentId) return null;
    const removal = await tx.inventoryMovement.findUnique({
      where: {
        idempotencyKey: assemblyReversalOutputKey(order.id, order.productId),
      },
      select: { unitCost: true, createdAt: true },
    });
    if (!removal?.unitCost) return null;

    const relieved = round2(removal.unitCost.mul(order.quantity));
    const variance = order.totalCost.sub(relieved);
    if (variance.isZero()) return null;

    const inventoryAccountId =
      await this.accountMapping.resolveInventoryAccount(
        order.product.categoryId,
        tx,
      );
    const cogsAccountId = await this.accountMapping.resolveCogsAccount(
      order.product.categoryId,
      tx,
    );
    const amount = variance.abs().toNumber();
    const description = `Assembly ${order.assemblyNumber} reversal — finished item relieved at the current average (${order.product.name} × ${order.quantity})`;
    const lines: PostingLine[] = variance.gt(0)
      ? [
          {
            accountId: inventoryAccountId,
            debit: amount,
            description,
            functionalAmount: true,
          },
          {
            accountId: cogsAccountId,
            credit: amount,
            description,
            functionalAmount: true,
          },
        ]
      : [
          {
            accountId: cogsAccountId,
            debit: amount,
            description,
            functionalAmount: true,
          },
          {
            accountId: inventoryAccountId,
            credit: amount,
            description,
            functionalAmount: true,
          },
        ];
    return {
      lines,
      description: `Assembly ${order.assemblyNumber} — reversal variance`,
      referenceNumber: order.assemblyNumber,
      entryDate: removal.createdAt,
    };
  }
}
