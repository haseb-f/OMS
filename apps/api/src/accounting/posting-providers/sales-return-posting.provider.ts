import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
  kitComponentValue,
  readKitSnapshot,
} from '../../sales/shared/kit-snapshot';
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
 * Cr Cost Of Goods Sold (per resolved account)   sum(round2(quantity * unit cost))
 * Dr Inventory (per resolved account)            sum(round2(quantity * unit cost))
 *
 * R13: a kit line returns its components at the ORIGINAL snapshot cost of the
 * invoice line (`fulfillmentSnapshot`) — Dr each component's inventory account
 * / Cr the kit's COGS account, the exact mirror of the sale. Service lines
 * post no cost. The moving average is restored once per product for the whole
 * document (`applyReturnToStockLines`), so two lines of one product never
 * distort the blend.
 */
const ZERO = new Prisma.Decimal(0);

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
    const salesReturn = await tx.salesReturn.findUniqueOrThrow({
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
                sku: true,
              },
            },
            tax: { select: { id: true } },
            salesInvoiceItem: {
              select: { unitCost: true, fulfillmentSnapshot: true },
            },
          },
        },
      },
    });
    if (Number(salesReturn.grandTotal) === 0) return null;
    const exchangeRate = await snapshotDocumentExchangeRate(
      this.exchangeRates,
      tx,
      (rate) =>
        tx.salesReturn.update({
          where: { id: salesReturn.id },
          data: { exchangeRate: rate },
        }),
      salesReturn.currencyId,
      salesReturn.exchangeRate,
      salesReturn.confirmedAt ?? salesReturn.createdAt,
    );

    const lines: PostingLine[] = [];

    const arAccountId = await this.accountMapping.resolveReceivableAccount(
      salesReturn.partner.id,
      tx,
    );
    lines.push({
      accountId: arAccountId,
      credit: Number(salesReturn.grandTotal),
      description: `Sales Return ${salesReturn.returnNumber}`,
      partnerId: salesReturn.partner.id,
    });

    const returnAccountId =
      await this.accountMapping.resolveSalesReturnAccount(tx);
    const revenueByLine = new Map<string, number>();
    for (const item of salesReturn.items) {
      const netAmount = Number(item.lineTotal) - Number(item.taxAmount);
      const accountId =
        returnAccountId ??
        (await this.accountMapping.resolveSalesRevenueAccount(
          item.product.categoryId,
          salesReturn.partner.customerProfile?.customerGroupId ?? null,
          tx,
        ));
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
    assertPostedTaxAmountsHaveTax(
      salesReturn.items,
      `Sales Return ${salesReturn.returnNumber}`,
    );
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
    // Units back into the valuation pool at their historical cost, per product.
    // A zero-cost line is blended too (at 0): its units are already in the
    // on-hand the blend derives `onHandBefore` from, so leaving them out would
    // count them as stock held at the old average (value out of thin air).
    const restored = new Map<
      string,
      { quantity: number; unitCost: Prisma.Decimal }[]
    >();
    const restore = (
      productId: string,
      quantity: number,
      unitCost: Prisma.Decimal,
    ) => {
      restored.set(productId, [
        ...(restored.get(productId) ?? []),
        { quantity, unitCost },
      ]);
    };
    const componentCategories = await this.loadComponentCategories(
      salesReturn.items,
      tx,
    );

    for (const item of salesReturn.items) {
      const kit = readKitSnapshot(item.salesInvoiceItem?.fulfillmentSnapshot);
      if (kit) {
        const cogsAccountId = await this.accountMapping.resolveCogsAccount(
          item.product.categoryId,
          tx,
        );
        for (const component of kit.components) {
          const categoryId = componentCategories.get(component.productId);
          if (!categoryId) {
            throw new BadRequestException(
              `Component ${component.productId} of kit ${item.product.sku} no longer exists — the return cannot be valued.`,
            );
          }
          restore(
            component.productId,
            component.qtyPerKit * item.quantity,
            new Prisma.Decimal(component.unitCost),
          );
          const value = kitComponentValue(component, item.quantity);
          if (value.isZero()) continue;
          addCost(
            cogsAccountId,
            await this.accountMapping.resolveInventoryAccount(categoryId, tx),
            value,
          );
        }
        continue;
      }
      if (!item.product.isInventoryItem) continue;
      // TASK-057 — replay the ORIGINAL invoice line's cost (snapshotted at
      // sale-posting time) so this reversal exactly matches the COGS
      // amount the invoice actually booked, even if the product's moving-
      // average cost has since changed. Falls back to the live cost only
      // for a return not linked to a specific invoice line, or one linked
      // to a pre-TASK-057 invoice line with no recorded cost.
      const unitCost =
        item.salesInvoiceItem?.unitCost != null
          ? new Prisma.Decimal(item.salesInvoiceItem.unitCost)
          : await this.inventoryValuation.getUnitCostDecimal(
              item.productId,
              tx,
            );
      restore(item.productId, item.quantity, unitCost);
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

    // M1 recovery — the physical InventoryMovements (created earlier in
    // `SalesReturnsService.confirm()`) restored on-hand quantity; the units
    // are re-blended into the moving-average pool here, at the same
    // historical cost the journal reverses, atomically with the entry.
    // Skipped when the return already has a journal entry (an FX-correction
    // re-post): the pool was restored by the first posting and must never be
    // restored twice.
    const alreadyPosted = await tx.journalEntry.count({
      where: { sourceType: 'SALES_RETURN', sourceId: salesReturn.id },
    });
    if (alreadyPosted === 0) {
      for (const [productId, returned] of restored) {
        await this.inventoryValuation.applyReturnToStockLines(
          productId,
          returned,
          tx,
          undefined,
        );
      }
    }
    for (const [accountId, amount] of inventoryByLine) {
      lines.push({
        accountId,
        debit: amount.toNumber(),
        description: `Inventory increased — ${salesReturn.returnNumber}`,
        functionalAmount: true,
      });
    }
    for (const [accountId, amount] of costByLine) {
      lines.push({
        accountId,
        credit: amount.toNumber(),
        description: `COGS reversal — ${salesReturn.returnNumber}`,
        functionalAmount: true,
      });
    }

    return {
      lines,
      description: `Sales Return ${salesReturn.returnNumber}`,
      referenceNumber: salesReturn.returnNumber,
      currencyId: salesReturn.currencyId,
      exchangeRate,
      companyId: salesReturn.companyId,
      branchId: salesReturn.branchId,
      costCenterId: salesReturn.costCenterId,
      projectId: salesReturn.projectId,
      entryDate: salesReturn.confirmedAt ?? salesReturn.createdAt,
    };
  }

  /** Category of every component named by the returned kit lines' snapshots (one query). */
  private async loadComponentCategories(
    items: Array<{
      salesInvoiceItem: { fulfillmentSnapshot: Prisma.JsonValue } | null;
    }>,
    tx: Prisma.TransactionClient,
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        items.flatMap(
          (item) =>
            readKitSnapshot(
              item.salesInvoiceItem?.fulfillmentSnapshot,
            )?.components.map((component) => component.productId) ?? [],
        ),
      ),
    ];
    if (ids.length === 0) return new Map();
    const products = await tx.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, categoryId: true },
    });
    return new Map(products.map((product) => [product.id, product.categoryId]));
  }
}
