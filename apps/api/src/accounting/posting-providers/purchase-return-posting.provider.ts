import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import { AccountMappingService } from '../account-mapping/account-mapping.service';
import type {
  PostingLine,
  PostingProvider,
  PostingResult,
} from '../posting-engine/posting-provider.interface';

/**
 * Purchase Return Posting Provider (TASK-046/047) — decrease Inventory,
 * reverse VAT Input, reduce the Supplier balance. Every account id
 * resolved through `AccountMappingService`; Dr/Cr structure and amounts
 * unchanged from TASK-046.
 *
 * Dr Accounts Payable                                          grandTotal
 * Cr Inventory (inventory-tracked, per resolved account) /
 * Cr Purchase/Expense (non-inventory, per resolved account)     net amount
 * Cr VAT Input (per resolved account)                           taxAmount
 *
 * Does not touch the moving-average cost (returning goods to a supplier
 * doesn't change what remaining stock cost to acquire) — only the
 * inventory-received side (`PurchaseInvoicePostingProvider`) updates it.
 */
@Injectable()
export class PurchaseReturnPostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = ['PURCHASE_RETURN'];

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
    const purchaseReturn = await tx.purchaseReturn.findUniqueOrThrow({
      where: { id: sourceId },
      include: {
        supplier: { select: { id: true } },
        items: {
          include: {
            product: { select: { isInventoryItem: true, categoryId: true } },
            tax: { select: { id: true } },
          },
        },
      },
    });
    if (Number(purchaseReturn.grandTotal) === 0) return null;

    const lines: PostingLine[] = [];

    const apAccountId = await this.accountMapping.resolvePayableAccount(
      purchaseReturn.supplier.id,
      tx,
    );
    lines.push({
      accountId: apAccountId,
      debit: Number(purchaseReturn.grandTotal),
      description: `Purchase Return ${purchaseReturn.returnNumber}`,
    });

    const creditByAccount = new Map<string, number>();
    for (const item of purchaseReturn.items) {
      const netAmount = Number(item.lineTotal) - Number(item.taxAmount);
      const accountId = item.product.isInventoryItem
        ? await this.accountMapping.resolveInventoryAccount(
            item.product.categoryId,
            tx,
          )
        : await this.accountMapping.resolvePurchaseAccount(
            purchaseReturn.supplier.id,
            item.product.categoryId,
            tx,
          );
      creditByAccount.set(
        accountId,
        (creditByAccount.get(accountId) ?? 0) + netAmount,
      );
    }
    for (const [accountId, amount] of creditByAccount) {
      if (amount === 0) continue;
      lines.push({
        accountId,
        credit: amount,
        description: `Purchase Return ${purchaseReturn.returnNumber}`,
      });
    }

    const taxAmounts = new Map<string, number>();
    for (const item of purchaseReturn.items) {
      if (!item.tax || Number(item.taxAmount) === 0) continue;
      taxAmounts.set(
        item.tax.id,
        (taxAmounts.get(item.tax.id) ?? 0) + Number(item.taxAmount),
      );
    }
    const vatByAccount = new Map<string, number>();
    for (const [taxId, amount] of taxAmounts) {
      const accountId = await this.accountMapping.resolveVatInputAccount(
        taxId,
        tx,
      );
      vatByAccount.set(accountId, (vatByAccount.get(accountId) ?? 0) + amount);
    }
    for (const [accountId, amount] of vatByAccount) {
      lines.push({
        accountId,
        credit: amount,
        description: `VAT Input reversal — ${purchaseReturn.returnNumber}`,
      });
    }

    return {
      lines,
      description: `Purchase Return ${purchaseReturn.returnNumber}`,
      referenceNumber: purchaseReturn.returnNumber,
      currencyId: purchaseReturn.currencyId,
      companyId: purchaseReturn.companyId,
      branchId: purchaseReturn.branchId,
      costCenterId: purchaseReturn.costCenterId,
      projectId: purchaseReturn.projectId,
    };
  }
}
