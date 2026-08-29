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
 * Purchase Invoice Posting Provider (TASK-046/047).
 *
 * Dr Inventory (inventory-tracked lines, per resolved account)   net amount
 * Dr Purchase/Expense (non-inventory lines, per resolved account) net amount
 * Dr VAT Input (per resolved account)                             taxAmount
 * Cr Accounts Payable                                            grandTotal
 *
 * Every account id resolved through `AccountMappingService` (TASK-047);
 * Dr/Cr structure and amounts unchanged from TASK-046. Also updates the
 * moving-average cost of every inventory-tracked line via
 * `InventoryValuationService.applyPurchaseReceipt` — the "Inventory
 * Valuation Service" step in the required architecture — so the cost used
 * by a later Sales Invoice's COGS posting reflects this receipt.
 */
@Injectable()
export class PurchaseInvoicePostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = ['PURCHASE_INVOICE'];

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
    const invoice = await tx.purchaseInvoice.findUniqueOrThrow({
      where: { id: sourceId },
      include: {
        partner: { select: { id: true } },
        items: {
          include: {
            product: { select: { isInventoryItem: true, categoryId: true } },
            tax: { select: { id: true } },
          },
        },
      },
    });
    if (Number(invoice.grandTotal) === 0) return null;

    const lines: PostingLine[] = [];
    const debitByAccount = new Map<string, number>();

    for (const item of invoice.items) {
      const netAmount = Number(item.lineTotal) - Number(item.taxAmount);
      if (item.product.isInventoryItem) {
        const accountId = await this.accountMapping.resolveInventoryAccount(
          item.product.categoryId,
          tx,
        );
        debitByAccount.set(
          accountId,
          (debitByAccount.get(accountId) ?? 0) + netAmount,
        );
        await this.inventoryValuation.applyPurchaseReceipt(
          item.productId,
          item.quantity,
          Number(item.unitPrice),
          tx,
          userId,
        );
      } else {
        const accountId = await this.accountMapping.resolvePurchaseAccount(
          invoice.partner.id,
          item.product.categoryId,
          tx,
        );
        debitByAccount.set(
          accountId,
          (debitByAccount.get(accountId) ?? 0) + netAmount,
        );
      }
    }
    for (const [accountId, amount] of debitByAccount) {
      if (amount === 0) continue;
      lines.push({
        accountId,
        debit: amount,
        description: `Purchase Invoice ${invoice.invoiceNumber}`,
      });
    }

    const taxAmounts = new Map<string, number>();
    for (const item of invoice.items) {
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
        debit: amount,
        description: `VAT Input — ${invoice.invoiceNumber}`,
      });
    }

    const apAccountId = await this.accountMapping.resolvePayableAccount(
      invoice.partner.id,
      tx,
    );
    lines.push({
      accountId: apAccountId,
      credit: Number(invoice.grandTotal),
      description: `Purchase Invoice ${invoice.invoiceNumber}`,
      partnerId: invoice.partner.id,
    });

    return {
      lines,
      description: `Purchase Invoice ${invoice.invoiceNumber}`,
      referenceNumber: invoice.invoiceNumber,
      currencyId: invoice.currencyId,
      companyId: invoice.companyId,
      branchId: invoice.branchId,
      costCenterId: invoice.costCenterId,
      projectId: invoice.projectId,
    };
  }
}
