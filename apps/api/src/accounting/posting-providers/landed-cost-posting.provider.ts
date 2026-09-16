import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import { InventoryValuationService } from '../inventory-valuation/inventory-valuation.service';
import { AccountMappingService } from '../account-mapping/account-mapping.service';
import type {
  PostingLine,
  PostingProvider,
  PostingResult,
} from '../posting-engine/posting-provider.interface';

/**
 * Landed Cost Posting Provider (ADR-0017 / Cost Engine M1).
 *
 * Dr Inventory (per resolved Product Category account, from the allocation) netTotal
 * Dr VAT Input (per resolved Tax account, grouped)                          taxTotal
 * Cr Payable (provider's Partner, when set) / Landed Cost Clearing         netTotal + taxTotal (gross, per line)
 *
 * Mirrors `PurchaseInvoicePostingProvider` exactly: capitalization
 * (`InventoryValuationService.applyLandedCost`) happens here, inside
 * `buildEntries`, so it commits atomically with the same Journal Entry —
 * never as a separate step the caller could retry independently and
 * duplicate.
 */
@Injectable()
export class LandedCostPostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = ['LANDED_COST'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly postingEngine: PostingEngineService,
    private readonly inventoryValuation: InventoryValuationService,
    private readonly accountMapping: AccountMappingService,
  ) {}

  onModuleInit() {
    this.postingEngine.registerProvider(this);
  }

  async buildEntries(
    _sourceType: string,
    sourceId: string,
    tx: Prisma.TransactionClient,
    userId?: string,
  ): Promise<PostingResult | null> {
    const document = await tx.landedCostDocument.findUniqueOrThrow({
      where: { id: sourceId },
      include: {
        lines: { include: { costComponent: true, tax: true } },
        allocations: {
          include: {
            purchaseInvoiceItem: {
              include: { product: { select: { id: true, categoryId: true } } },
            },
          },
        },
        purchaseInvoice: { select: { invoiceNumber: true } },
      },
    });
    if (document.allocations.length === 0) return null;

    // Capitalize once per unique product (a Purchase Invoice can carry the
    // same product on more than one line) — recomputes the moving average
    // over *current* on-hand quantity, never the original receipt quantity.
    const amountByProduct = new Map<string, number>();
    for (const allocation of document.allocations) {
      const productId = allocation.purchaseInvoiceItem.productId;
      amountByProduct.set(
        productId,
        (amountByProduct.get(productId) ?? 0) +
          Number(allocation.allocatedAmount),
      );
    }

    const debitByAccount = new Map<string, number>();
    for (const allocation of document.allocations) {
      const accountId = await this.accountMapping.resolveInventoryAccount(
        allocation.purchaseInvoiceItem.product.categoryId,
        tx,
      );
      debitByAccount.set(
        accountId,
        (debitByAccount.get(accountId) ?? 0) +
          Number(allocation.allocatedAmount),
      );
    }
    for (const [productId, amount] of amountByProduct) {
      await this.inventoryValuation.applyLandedCost(
        productId,
        amount,
        tx,
        userId,
      );
    }

    const lines: PostingLine[] = [];
    for (const [accountId, amount] of debitByAccount) {
      if (amount === 0) continue;
      lines.push({
        accountId,
        debit: amount,
        description: `Landed Cost ${document.documentNumber} — capitalized into Inventory`,
      });
    }

    const vatByAccount = new Map<string, number>();
    for (const line of document.lines) {
      if (!line.taxId || Number(line.taxAmount) === 0) continue;
      const accountId = await this.accountMapping.resolveVatInputAccount(
        line.taxId,
        tx,
      );
      vatByAccount.set(
        accountId,
        (vatByAccount.get(accountId) ?? 0) + Number(line.taxAmount),
      );
    }
    for (const [accountId, amount] of vatByAccount) {
      lines.push({
        accountId,
        debit: amount,
        description: `VAT Input — Landed Cost ${document.documentNumber}`,
      });
    }

    // Credit side — gross (net + its own tax) per line, grouped by resolved
    // account, so the entry balances against Dr Inventory + Dr VAT Input above.
    const creditByAccount = new Map<
      string,
      { amount: number; partnerId?: string }
    >();
    for (const line of document.lines) {
      const gross = Number(line.netAmount) + Number(line.taxAmount);
      if (gross === 0) continue;
      const accountId = document.providerId
        ? await this.accountMapping.resolvePayableAccount(
            document.providerId,
            tx,
          )
        : await this.accountMapping.resolveLandedCostClearingAccount(
            line.costComponentId,
            tx,
          );
      const existing = creditByAccount.get(accountId);
      creditByAccount.set(accountId, {
        amount: (existing?.amount ?? 0) + gross,
        partnerId: document.providerId ?? undefined,
      });
    }
    for (const [accountId, { amount, partnerId }] of creditByAccount) {
      lines.push({
        accountId,
        credit: amount,
        description: `Landed Cost ${document.documentNumber}`,
        partnerId,
      });
    }

    return {
      lines,
      description: `Landed Cost ${document.documentNumber} (Purchase Invoice ${document.purchaseInvoice.invoiceNumber})`,
      referenceNumber: document.documentNumber,
      currencyId: document.currencyId,
    };
  }
}
