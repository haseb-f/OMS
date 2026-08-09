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
 * Sales Invoice Posting Provider (TASK-046/047) — turns a confirmed Sales
 * Invoice into one balanced Journal Entry covering both halves of the
 * perpetual-inventory event: revenue recognition AND the cost of goods
 * sold. Real ERPs post both in the same entry for the same document
 * confirmation, so this provider does too, rather than splitting into two
 * entries for one business event.
 *
 * Dr Accounts Receivable          grandTotal
 * Cr Sales Revenue (per resolved account)   grandTotal - taxTotal
 * Cr VAT Output (per resolved account)      taxAmount
 * ----------------------------------------------------------------
 * Dr Cost Of Goods Sold (per resolved account)   sum(quantity * unit cost)
 * Cr Inventory (per resolved account)            sum(quantity * unit cost)
 *
 * Every account id is resolved through `AccountMappingService` (Product
 * Category / Customer Group / Tax overrides, falling back to Accounting
 * Settings) — TASK-047 completed this; the Dr/Cr structure and amounts
 * are unchanged from TASK-046. Revenue/COGS/Inventory lines are grouped by
 * resolved account (not always one line) so a Product Category override
 * on some lines but not others still nets to one balanced entry.
 *
 * Reads SalesInvoice/SalesInvoiceItem via raw Prisma only (never imports
 * SalesInvoicesService) — same cross-module-avoidance pattern
 * FinancialTransactionsService already uses for the same tables.
 */
@Injectable()
export class SalesInvoicePostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = ['SALES_INVOICE'];

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
    const invoice = await tx.salesInvoice.findUniqueOrThrow({
      where: { id: sourceId },
      include: {
        customer: { select: { id: true, customerGroupId: true } },
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

    const arAccountId = await this.accountMapping.resolveReceivableAccount(
      invoice.customer.id,
      tx,
    );
    lines.push({
      accountId: arAccountId,
      debit: Number(invoice.grandTotal),
      description: `Sales Invoice ${invoice.invoiceNumber}`,
    });

    const revenueByLine = new Map<string, number>();
    for (const item of invoice.items) {
      const netAmount = Number(item.lineTotal) - Number(item.taxAmount);
      const accountId = await this.accountMapping.resolveSalesRevenueAccount(
        item.product.categoryId,
        invoice.customer.customerGroupId,
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
        credit: amount,
        description: `Revenue — ${invoice.invoiceNumber}`,
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
      const accountId = await this.accountMapping.resolveVatOutputAccount(
        taxId,
        tx,
      );
      vatByAccount.set(accountId, (vatByAccount.get(accountId) ?? 0) + amount);
    }
    for (const [accountId, amount] of vatByAccount) {
      lines.push({
        accountId,
        credit: amount,
        description: `VAT Output — ${invoice.invoiceNumber}`,
      });
    }

    const costByLine = new Map<string, number>();
    const inventoryByLine = new Map<string, number>();
    for (const item of invoice.items) {
      if (!item.product.isInventoryItem) continue;
      const unitCost = await this.inventoryValuation.getUnitCost(
        item.productId,
        tx,
      );
      // TASK-057 — snapshot the cost actually charged so a later Sales
      // Return reverses this exact amount instead of re-reading the
      // product's (possibly since-changed) current cost.
      await tx.salesInvoiceItem.update({
        where: { id: item.id },
        data: { unitCost },
      });
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
    for (const [accountId, amount] of costByLine) {
      lines.push({
        accountId,
        debit: amount,
        description: `COGS — ${invoice.invoiceNumber}`,
      });
    }
    for (const [accountId, amount] of inventoryByLine) {
      lines.push({
        accountId,
        credit: amount,
        description: `Inventory relieved — ${invoice.invoiceNumber}`,
      });
    }

    return {
      lines,
      description: `Sales Invoice ${invoice.invoiceNumber}`,
      referenceNumber: invoice.invoiceNumber,
      currencyId: invoice.currencyId,
      companyId: invoice.companyId,
      branchId: invoice.branchId,
      costCenterId: invoice.costCenterId,
      projectId: invoice.projectId,
    };
  }
}
