import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma, ProductSupplyMethod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import {
  InventoryValuationService,
  round2,
} from '../inventory-valuation/inventory-valuation.service';
import { AccountMappingService } from '../account-mapping/account-mapping.service';
import { ExchangeRatesService } from '../fx/exchange-rates.service';
import { snapshotDocumentExchangeRate } from '../fx/snapshot-document-rate';
import { assertPostedTaxAmountsHaveTax } from '../../taxes/document-tax';
import {
  deliveredKey,
  kitComponentValue,
  kitUnitCost,
  productsDeliveredThemselves,
  readKitSnapshot,
} from '../../sales/shared/kit-snapshot';
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
 * Dr Cost Of Goods Sold (per resolved account)   sum(round2(quantity * unit cost))
 * Cr Inventory (per resolved account)            sum(round2(quantity * unit cost))
 *
 * R13 kit lines (spec §3B/§4): the kit itself moves no stock, its line carries
 * `fulfillmentSnapshot` (written when its components were delivered). COGS is
 * recognised ONCE for the line = Σ round2(qtyPerKit × quantity × component
 * cost), debited to the KIT's COGS account and credited to EACH component's
 * inventory account; the line's `unitCost` = Σ qtyPerKit × component cost.
 * Service / non-stock lines post no COGS.
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
const ZERO = new Prisma.Decimal(0);

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
    private readonly exchangeRates: ExchangeRatesService,
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
        partner: {
          select: {
            id: true,
            customerProfile: { select: { customerGroupId: true } },
          },
        },
        items: {
          include: {
            product: {
              select: {
                isInventoryItem: true,
                supplyMethod: true,
                categoryId: true,
                currentCost: true,
                sku: true,
              },
            },
            tax: { select: { id: true } },
          },
        },
      },
    });
    if (Number(invoice.grandTotal) === 0) return null;
    const exchangeRate = await snapshotDocumentExchangeRate(
      this.exchangeRates,
      tx,
      (rate) =>
        tx.salesInvoice.update({
          where: { id: invoice.id },
          data: { exchangeRate: rate },
        }),
      invoice.currencyId,
      invoice.exchangeRate,
      invoice.confirmedAt ?? invoice.createdAt,
    );

    const lines: PostingLine[] = [];

    const arAccountId = await this.accountMapping.resolveReceivableAccount(
      invoice.partner.id,
      tx,
    );
    lines.push({
      accountId: arAccountId,
      debit: Number(invoice.grandTotal),
      description: `Sales Invoice ${invoice.invoiceNumber}`,
      partnerId: invoice.partner.id,
    });

    const discountTotal = Number(invoice.discountTotal ?? 0);
    const discountAccountId =
      discountTotal > 0
        ? await this.accountMapping.resolveSalesDiscountAccount(tx)
        : null;
    if (discountTotal > 0 && !discountAccountId) {
      throw new BadRequestException(
        `Sales Invoice ${invoice.invoiceNumber} has a discount of ${discountTotal} but no Sales Discount account is configured.`,
      );
    }

    const revenueByLine = new Map<string, number>();
    for (const item of invoice.items) {
      const netAmount = Number(item.lineTotal) - Number(item.taxAmount);
      const accountId = await this.accountMapping.resolveSalesRevenueAccount(
        item.product.categoryId,
        invoice.partner.customerProfile?.customerGroupId ?? null,
        tx,
      );
      revenueByLine.set(
        accountId,
        (revenueByLine.get(accountId) ?? 0) + netAmount,
      );
    }
    if (discountAccountId && discountTotal > 0 && revenueByLine.size > 0) {
      const [firstAccount] = revenueByLine.keys();
      revenueByLine.set(
        firstAccount,
        (revenueByLine.get(firstAccount) ?? 0) + discountTotal,
      );
    }
    for (const [accountId, amount] of revenueByLine) {
      lines.push({
        accountId,
        credit: amount,
        description: `Revenue — ${invoice.invoiceNumber}`,
      });
    }
    if (discountAccountId && discountTotal > 0) {
      lines.push({
        accountId: discountAccountId,
        debit: discountTotal,
        description: `Sales discount — ${invoice.invoiceNumber}`,
      });
    }

    const taxAmounts = new Map<string, number>();
    assertPostedTaxAmountsHaveTax(
      invoice.items,
      `Sales Invoice ${invoice.invoiceNumber}`,
    );
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

    const costByLine = new Map<string, Prisma.Decimal>();
    const inventoryByLine = new Map<string, Prisma.Decimal>();
    const addCost = (
      cogsAccountId: string,
      inventoryAccountId: string,
      value: Prisma.Decimal,
    ) => {
      costByLine.set(
        cogsAccountId,
        (costByLine.get(cogsAccountId) ?? ZERO).add(value),
      );
      inventoryByLine.set(
        inventoryAccountId,
        (inventoryByLine.get(inventoryAccountId) ?? ZERO).add(value),
      );
    };
    const kitComponents = await this.loadKitComponents(invoice.items, tx);
    // A line of a product that is a KIT today but carries no kit snapshot was
    // sold before the switch: it is a plain stocked line when the product
    // itself was delivered under this invoice (R13 L7 — decided by history,
    // never by the current supply method).
    const deliveredItself = await productsDeliveredThemselves(
      tx,
      invoice.items
        .filter(
          (item) =>
            item.product.supplyMethod === ProductSupplyMethod.KIT &&
            !item.fulfillmentSnapshot,
        )
        .map((item) => ({
          salesInvoiceId: invoice.id,
          productId: item.productId,
        })),
    );
    for (const item of invoice.items) {
      const kit = readKitSnapshot(item.fulfillmentSnapshot);
      if (kit) {
        // Kit: COGS once, from the components' snapshot costs.
        await tx.salesInvoiceItem.update({
          where: { id: item.id },
          data: { unitCost: kitUnitCost(kit) },
        });
        const cogsAccountId = await this.accountMapping.resolveCogsAccount(
          item.product.categoryId,
          tx,
        );
        for (const component of kit.components) {
          const product = kitComponents.get(component.productId);
          if (!product || product.currentCost == null) {
            throw new BadRequestException(
              `Product ${product?.sku ?? component.productId} (component of kit ${item.product.sku}) has no recorded cost. Record a product cost or opening balance before invoicing — COGS cannot silently post as zero.`,
            );
          }
          const value = kitComponentValue(component, item.quantity);
          if (value.isZero()) continue;
          addCost(
            cogsAccountId,
            await this.accountMapping.resolveInventoryAccount(
              product.categoryId,
              tx,
            ),
            value,
          );
        }
        continue;
      }
      if (item.product.supplyMethod === ProductSupplyMethod.KIT) {
        if (!deliveredItself.has(deliveredKey(invoice.id, item.productId))) {
          throw new BadRequestException(
            `Kit ${item.product.sku} on Sales Invoice ${invoice.invoiceNumber} has no fulfillment snapshot — its components were not delivered, so COGS cannot be posted.`,
          );
        }
      } else if (!item.product.isInventoryItem) {
        continue;
      }
      if (item.unitCost == null && item.product.currentCost == null) {
        throw new BadRequestException(
          `Product ${item.product.sku} has no recorded cost. Record a product cost or opening balance before invoicing — COGS cannot silently post as zero.`,
        );
      }
      // TASK-057 — snapshot the cost actually charged so a later Sales
      // Return reverses this exact amount instead of re-reading the
      // product's (possibly since-changed) current cost. Set once: a
      // re-post (FX correction) replays the snapshot, never today's cost.
      const unitCost =
        item.unitCost != null
          ? new Prisma.Decimal(item.unitCost)
          : await this.inventoryValuation.getUnitCostDecimal(
              item.productId,
              tx,
            );
      if (item.unitCost == null) {
        await tx.salesInvoiceItem.update({
          where: { id: item.id },
          data: { unitCost },
        });
      }
      const cost = round2(unitCost.mul(item.quantity));
      if (cost.isZero()) continue;
      addCost(
        await this.accountMapping.resolveCogsAccount(
          item.product.categoryId,
          tx,
        ),
        await this.accountMapping.resolveInventoryAccount(
          item.product.categoryId,
          tx,
        ),
        cost,
      );
    }
    for (const [accountId, amount] of costByLine) {
      lines.push({
        accountId,
        debit: amount.toNumber(),
        description: `COGS — ${invoice.invoiceNumber}`,
        functionalAmount: true,
      });
    }
    for (const [accountId, amount] of inventoryByLine) {
      lines.push({
        accountId,
        credit: amount.toNumber(),
        description: `Inventory relieved — ${invoice.invoiceNumber}`,
        functionalAmount: true,
      });
    }

    return {
      lines,
      description: `Sales Invoice ${invoice.invoiceNumber}`,
      referenceNumber: invoice.invoiceNumber,
      currencyId: invoice.currencyId,
      exchangeRate,
      companyId: invoice.companyId,
      branchId: invoice.branchId,
      costCenterId: invoice.costCenterId,
      projectId: invoice.projectId,
      entryDate: invoice.confirmedAt ?? invoice.createdAt,
    };
  }

  /** Category + cost of every component named by the invoice's kit snapshots (one query). */
  private async loadKitComponents(
    items: Array<{ fulfillmentSnapshot: Prisma.JsonValue | null }>,
    tx: Prisma.TransactionClient,
  ): Promise<Map<string, KitComponentProduct>> {
    const ids = [
      ...new Set(
        items.flatMap(
          (item) =>
            readKitSnapshot(item.fulfillmentSnapshot)?.components.map(
              (component) => component.productId,
            ) ?? [],
        ),
      ),
    ];
    if (ids.length === 0) return new Map();
    const products = await tx.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, sku: true, categoryId: true, currentCost: true },
    });
    return new Map(products.map((product) => [product.id, product]));
  }
}

type KitComponentProduct = {
  id: string;
  sku: string;
  categoryId: string;
  currentCost: Prisma.Decimal | null;
};
