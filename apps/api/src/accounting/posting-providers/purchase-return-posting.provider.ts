import { Injectable, OnModuleInit } from '@nestjs/common';
import { InventoryMovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import { AccountMappingService } from '../account-mapping/account-mapping.service';
import { ExchangeRatesService } from '../fx/exchange-rates.service';
import { snapshotDocumentExchangeRate } from '../fx/snapshot-document-rate';
import { assertPostedTaxAmountsHaveTax } from '../../taxes/document-tax';
import { movementIdempotencyKey } from '../../inventory/dto/movement-trace';
import { round2 } from '../inventory-valuation/inventory-valuation.service';
import type {
  PostingLine,
  PostingProvider,
  PostingResult,
} from '../posting-engine/posting-provider.interface';

const REFERENCE_TYPE = 'PURCHASE_RETURN';
const D = (value: Prisma.Decimal | string | number) =>
  new Prisma.Decimal(value);

/**
 * Purchase Return Posting Provider (TASK-046/047; valuation = owner decision
 * O9, 2026-10-06) — reduce the Supplier balance, reverse VAT Input, and
 * relieve Inventory at the MOVING AVERAGE (Odoo-style AVCO). Every account id
 * is resolved through `AccountMappingService`.
 *
 * Dr Accounts Payable                  grandTotal (document currency × rate)
 * Cr Inventory (category account)      relief = round2(qty × average) — functional
 * Cr / Dr COGS (category account)      round2(Σ net × rate) − Σ relief — functional
 *                                      (positive → Cr, negative → Dr; none when 0)
 * Cr Purchase/Expense (non-stock line) net amount (document currency × rate)
 * Cr VAT Input                         taxAmount (document currency × rate)
 *
 * The average is the one the units left at: read under the product lock at
 * confirm and recorded on the PURCHASE_RETURN movement (`unitCost`, 4 dp), so
 * the GL relieves exactly what the stock ledger removed and a re-post (FX
 * correction) replays that recorded cost, never today's average. A return
 * never changes the average. A stocked line whose movement carries no
 * recorded cost was confirmed before O9: it is re-built exactly as it was
 * originally posted (Inventory credited at the net line amount) — history is
 * not revalued.
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
    const purchaseReturn = await tx.purchaseReturn.findUniqueOrThrow({
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
    const reliefCostOf = await this.recordedReliefCosts(tx, purchaseReturn.id);
    const relievesStock = purchaseReturn.items.some(
      (item) =>
        item.product.isInventoryItem &&
        reliefCostOf(item.id)?.isZero() === false,
    );
    if (Number(purchaseReturn.grandTotal) === 0 && !relievesStock) return null;
    const exchangeRate = await snapshotDocumentExchangeRate(
      this.exchangeRates,
      tx,
      (rate) =>
        tx.purchaseReturn.update({
          where: { id: purchaseReturn.id },
          data: { exchangeRate: rate },
        }),
      purchaseReturn.currencyId,
      purchaseReturn.exchangeRate,
      purchaseReturn.confirmedAt ?? purchaseReturn.createdAt,
    );
    const description = `Purchase Return ${purchaseReturn.returnNumber}`;

    const lines: PostingLine[] = [];

    const apAccountId = await this.accountMapping.resolvePayableAccount(
      purchaseReturn.partner.id,
      tx,
    );
    lines.push({
      accountId: apAccountId,
      debit: Number(purchaseReturn.grandTotal),
      description,
      partnerId: purchaseReturn.partner.id,
    });

    // Document-currency credits (non-stock lines, pre-O9 stocked lines) and,
    // for stocked lines, the functional relief per Inventory account plus the
    // net amount (document currency) and relief per COGS account.
    const creditByAccount = new Map<string, number>();
    const reliefByAccount = new Map<string, Prisma.Decimal>();
    const cogsNetByAccount = new Map<string, Prisma.Decimal>();
    const cogsReliefByAccount = new Map<string, Prisma.Decimal>();
    const add = (
      map: Map<string, Prisma.Decimal>,
      accountId: string,
      amount: Prisma.Decimal,
    ) => map.set(accountId, (map.get(accountId) ?? D(0)).add(amount));
    for (const item of purchaseReturn.items) {
      const netAmount = Number(item.lineTotal) - Number(item.taxAmount);
      const unitCost = item.product.isInventoryItem
        ? reliefCostOf(item.id)
        : undefined;
      if (unitCost) {
        const relief = round2(unitCost.mul(item.quantity));
        add(
          reliefByAccount,
          await this.accountMapping.resolveInventoryAccount(
            item.product.categoryId,
            tx,
          ),
          relief,
        );
        const cogsAccountId = await this.accountMapping.resolveCogsAccount(
          item.product.categoryId,
          tx,
        );
        add(
          cogsNetByAccount,
          cogsAccountId,
          D(item.lineTotal).sub(D(item.taxAmount)),
        );
        add(cogsReliefByAccount, cogsAccountId, relief);
        continue;
      }
      const accountId = item.product.isInventoryItem
        ? await this.accountMapping.resolveInventoryAccount(
            item.product.categoryId,
            tx,
          )
        : await this.accountMapping.resolvePurchaseAccount(
            purchaseReturn.partner.id,
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
      lines.push({ accountId, credit: amount, description });
    }
    for (const [accountId, amount] of reliefByAccount) {
      if (amount.isZero()) continue;
      lines.push({
        accountId,
        credit: amount.toNumber(),
        description: `Inventory relieved at average cost — ${purchaseReturn.returnNumber}`,
        functionalAmount: true,
      });
    }
    for (const [accountId, net] of cogsNetByAccount) {
      // What the supplier credits (functional) minus what left inventory.
      const amount = round2(net.mul(exchangeRate)).sub(
        cogsReliefByAccount.get(accountId) ?? D(0),
      );
      if (amount.isZero()) continue;
      lines.push({
        accountId,
        ...(amount.isPositive()
          ? { credit: amount.toNumber() }
          : { debit: amount.neg().toNumber() }),
        description: `Return price vs average cost — ${purchaseReturn.returnNumber}`,
        functionalAmount: true,
      });
    }

    const taxAmounts = new Map<string, number>();
    assertPostedTaxAmountsHaveTax(purchaseReturn.items, description);
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
      description,
      referenceNumber: purchaseReturn.returnNumber,
      currencyId: purchaseReturn.currencyId,
      exchangeRate,
      companyId: purchaseReturn.companyId,
      branchId: purchaseReturn.branchId,
      costCenterId: purchaseReturn.costCenterId,
      projectId: purchaseReturn.projectId,
      entryDate: purchaseReturn.confirmedAt ?? purchaseReturn.createdAt,
    };
  }

  /**
   * The relief unit cost recorded on each return line's PURCHASE_RETURN
   * movement (keyed per line at confirm). `undefined` = no recorded cost
   * (a return confirmed before O9).
   */
  private async recordedReliefCosts(
    tx: Prisma.TransactionClient,
    purchaseReturnId: string,
  ): Promise<(itemId: string) => Prisma.Decimal | undefined> {
    const movements = await tx.inventoryMovement.findMany({
      where: {
        type: InventoryMovementType.PURCHASE_RETURN,
        referenceType: REFERENCE_TYPE,
        referenceId: purchaseReturnId,
        unitCost: { not: null },
      },
      select: { idempotencyKey: true, unitCost: true },
    });
    const byKey = new Map<string, Prisma.Decimal>();
    for (const movement of movements) {
      if (movement.idempotencyKey && movement.unitCost != null) {
        byKey.set(movement.idempotencyKey, D(movement.unitCost));
      }
    }
    return (itemId) =>
      byKey.get(
        movementIdempotencyKey(
          REFERENCE_TYPE,
          purchaseReturnId,
          itemId,
          InventoryMovementType.PURCHASE_RETURN,
        ),
      );
  }
}
