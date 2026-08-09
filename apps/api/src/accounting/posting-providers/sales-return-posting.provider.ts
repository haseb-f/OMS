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
 * Sales Return Posting Provider (TASK-046/047) — the mirror image of
 * `SalesInvoicePostingProvider`: reverse revenue, reverse VAT Output,
 * increase Inventory, reverse COGS. Every account id resolved through
 * `AccountMappingService` (TASK-047) instead of a flat settings read;
 * Dr/Cr structure and amounts unchanged from TASK-046.
 *
 * Cr Accounts Receivable          grandTotal
 * Dr Sales Revenue (per resolved account)   grandTotal - taxTotal
 * Dr VAT Output (per resolved account)      taxAmount
 * ----------------------------------------------------------------
 * Cr Cost Of Goods Sold (per resolved account)   sum(quantity * unit cost)
 * Dr Inventory (per resolved account)            sum(quantity * unit cost)
 */
@Injectable()
export class SalesReturnPostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = ['SALES_RETURN'];

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
  ): Promise<PostingResult | null> {
    const salesReturn = await tx.salesReturn.findUniqueOrThrow({
      where: { id: sourceId },
      include: {
        customer: { select: { id: true, customerGroupId: true } },
        items: {
          include: {
            product: { select: { isInventoryItem: true, categoryId: true } },
            tax: { select: { id: true } },
            salesInvoiceItem: { select: { unitCost: true } },
          },
        },
      },
    });
    if (Number(salesReturn.grandTotal) === 0) return null;

    const lines: PostingLine[] = [];

    const arAccountId = await this.accountMapping.resolveReceivableAccount(
      salesReturn.customer.id,
      tx,
    );
    lines.push({
      accountId: arAccountId,
      credit: Number(salesReturn.grandTotal),
      description: `Sales Return ${salesReturn.returnNumber}`,
    });

    const revenueByLine = new Map<string, number>();
    for (const item of salesReturn.items) {
      const netAmount = Number(item.lineTotal) - Number(item.taxAmount);
      const accountId = await this.accountMapping.resolveSalesRevenueAccount(
        item.product.categoryId,
        salesReturn.customer.customerGroupId,
        tx,
      );
      revenueByLine.set(
        accountId,
        (revenueByLine.get(accountId) ?? 0) + netAmount,
      );
    }
    for (const [accountId, amount] of revenueByLine) {
      lines.push({
        accountId,
        debit: amount,
        description: `Revenue reversal — ${salesReturn.returnNumber}`,
      });
    }

    const taxAmounts = new Map<string, number>();
    for (const item of salesReturn.items) {
      if (!item.tax || Number(item.taxAmount) === 0) continue;
      taxAmounts.set(
        item.tax.id,
        (taxAmounts.get(item.tax.id) ?? 0) + Number(item.taxAmount),
      );
    }
    const vatByAccount = new Map<string, number>();
    for (const [taxId, amount] of taxAmounts) {
      const accountId = await this.accountMapping.resolveVatOutputAccount(
        taxId,
        tx,
      );
      vatByAccount.set(accountId, (vatByAccount.get(accountId) ?? 0) + amount);
    }
    for (const [accountId, amount] of vatByAccount) {
      lines.push({
        accountId,
        debit: amount,
        description: `VAT Output reversal — ${salesReturn.returnNumber}`,
      });
    }

    const costByLine = new Map<string, number>();
    const inventoryByLine = new Map<string, number>();
    for (const item of salesReturn.items) {
      if (!item.product.isInventoryItem) continue;
      // TASK-057 — replay the ORIGINAL invoice line's cost (snapshotted at
      // sale-posting time) so this reversal exactly matches the COGS
      // amount the invoice actually booked, even if the product's moving-
      // average cost has since changed. Falls back to the live cost only
      // for a return not linked to a specific invoice line, or one linked
      // to a pre-TASK-057 invoice line with no recorded cost.
      const unitCost =
        item.salesInvoiceItem?.unitCost != null
          ? Number(item.salesInvoiceItem.unitCost)
          : await this.inventoryValuation.getUnitCost(item.productId, tx);
      const cost = unitCost * item.quantity;
      if (cost === 0) continue;
      const cogsAccountId = await this.accountMapping.resolveCogsAccount(
        item.product.categoryId,
        tx,
      );
      const inventoryAccountId =
        await this.accountMapping.resolveInventoryAccount(
          item.product.categoryId,
          tx,
        );
      costByLine.set(
        cogsAccountId,
        (costByLine.get(cogsAccountId) ?? 0) + cost,
      );
      inventoryByLine.set(
        inventoryAccountId,
        (inventoryByLine.get(inventoryAccountId) ?? 0) + cost,
      );
    }
    for (const [accountId, amount] of inventoryByLine) {
      lines.push({
        accountId,
        debit: amount,
        description: `Inventory increased — ${salesReturn.returnNumber}`,
      });
    }
    for (const [accountId, amount] of costByLine) {
      lines.push({
        accountId,
        credit: amount,
        description: `COGS reversal — ${salesReturn.returnNumber}`,
      });
    }

    return {
      lines,
      description: `Sales Return ${salesReturn.returnNumber}`,
      referenceNumber: salesReturn.returnNumber,
      currencyId: salesReturn.currencyId,
      companyId: salesReturn.companyId,
      branchId: salesReturn.branchId,
      costCenterId: salesReturn.costCenterId,
      projectId: salesReturn.projectId,
    };
  }
}
