import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import { AccountMappingService } from '../account-mapping/account-mapping.service';
import type {
  PostingLine,
  PostingProvider,
  PostingResult,
} from '../posting-engine/posting-provider.interface';

/**
 * Assembly Order Posting Provider (R13 spec §4) — an assembly turns component
 * stock into finished stock at cost; nothing leaves or enters the company:
 *
 *   Dr Inventory (finished item's category account)       totalCost
 *   Cr Inventory (each component's category account)      line value (one credit per component)
 *   Cr Assembly Cost account                              direct cost (only when > 0)
 *
 * `totalCost = Σ line values + directCost` by construction (the order stores
 * both), so the entry balances exactly. Accounts resolve through
 * `AccountMappingService` (category → Posting Settings); the assembly cost
 * account is required whenever a direct cost exists (fail closed — a named
 * configuration error, never a guessed account).
 *
 * Agent-owned assemblies never reach the company GL (agent goods are not a
 * company asset). `sourceId` is the `AssemblyOrder.id`; the engine's own
 * idempotency still guards against a second journal.
 */
@Injectable()
export class AssemblyOrderPostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = ['ASSEMBLY_ORDER'];
  private readonly logger = new Logger(AssemblyOrderPostingProvider.name);

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
      include: {
        product: { select: { categoryId: true, name: true } },
        lines: {
          orderBy: { componentProduct: { sku: 'asc' } },
          include: {
            componentProduct: {
              select: { categoryId: true, sku: true, name: true },
            },
          },
        },
      },
    });
    if (order.ownerAgentId) {
      this.logger.debug(
        `Assembly ${order.assemblyNumber} is agent-owned stock — not posted to the company GL.`,
      );
      return null;
    }
    if (order.totalCost.isZero()) {
      this.logger.warn(
        `Assembly ${order.assemblyNumber} has no cost to post — no journal entry was created.`,
      );
      return null;
    }

    const description = `Assembly ${order.assemblyNumber}`;
    const lines: PostingLine[] = [
      {
        accountId: await this.accountMapping.resolveInventoryAccount(
          order.product.categoryId,
          tx,
        ),
        debit: order.totalCost.toNumber(),
        description: `${description} — ${order.product.name} × ${order.quantity}`,
        functionalAmount: true,
      },
    ];
    for (const line of order.lines) {
      if (line.value.isZero()) continue;
      lines.push({
        accountId: await this.accountMapping.resolveInventoryAccount(
          line.componentProduct.categoryId,
          tx,
        ),
        credit: line.value.toNumber(),
        description: `${description} — consumed ${line.quantity} × ${line.componentProduct.sku}`,
        functionalAmount: true,
      });
    }
    if (order.directCost.gt(0)) {
      lines.push({
        accountId: await this.accountMapping.resolveAssemblyCostAccount(tx),
        credit: order.directCost.toNumber(),
        description: `${description} — direct cost`,
        functionalAmount: true,
      });
    }
    return {
      lines,
      description,
      referenceNumber: order.assemblyNumber,
      entryDate: order.createdAt,
    };
  }
}
