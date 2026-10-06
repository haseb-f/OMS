import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma, PurchaseLineTreatment } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import { AccountMappingService } from '../account-mapping/account-mapping.service';
import { ExchangeRatesService } from '../fx/exchange-rates.service';
import { snapshotDocumentExchangeRate } from '../fx/snapshot-document-rate';
import { assertPostedTaxAmountsHaveTax } from '../../taxes/document-tax';
import {
  lineTaxIsCapitalized,
  recognizedLineAmount,
} from '../../purchasing/invoices/purchase-line-treatment';
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
 * Cr Fixed Assets / Prepayments (R13b — a returned capitalized /
 *    deferred line mirrors its invoice line: same account, net + the
 *    non-recoverable tax that was capitalized)                   net amount
 * Cr VAT Input (per resolved account, recoverable tax only)     taxAmount
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
            tax: { select: { id: true, isRecoverable: true } },
            purchaseInvoiceItem: { select: { treatment: true } },
          },
        },
      },
    });
    if (Number(purchaseReturn.grandTotal) === 0) return null;
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

    const lines: PostingLine[] = [];

    const apAccountId = await this.accountMapping.resolvePayableAccount(
      purchaseReturn.partner.id,
      tx,
    );
    lines.push({
      accountId: apAccountId,
      debit: Number(purchaseReturn.grandTotal),
      description: `Purchase Return ${purchaseReturn.returnNumber}`,
      partnerId: purchaseReturn.partner.id,
    });

    const creditByAccount = new Map<string, number>();
    const treatmentOf = (item: (typeof purchaseReturn.items)[number]) =>
      item.purchaseInvoiceItem?.treatment ?? PurchaseLineTreatment.STANDARD;
    for (const item of purchaseReturn.items) {
      const treatment = treatmentOf(item);
      if (treatment !== PurchaseLineTreatment.STANDARD) {
        // One credit line per returned asset / prepayment line (never merged),
        // the exact mirror of the invoice's debit for it.
        const amount = recognizedLineAmount({ ...item, treatment });
        if (amount === 0) continue;
        lines.push({
          accountId:
            treatment === PurchaseLineTreatment.FIXED_ASSET
              ? await this.accountMapping.resolveFixedAssetsAccount(tx)
              : await this.accountMapping.resolvePrepaymentsAccount(tx),
          credit: amount,
          description:
            treatment === PurchaseLineTreatment.FIXED_ASSET
              ? `Fixed asset returned — ${purchaseReturn.returnNumber}`
              : `Prepaid expense returned — ${purchaseReturn.returnNumber}`,
        });
        continue;
      }
      const netAmount = Number(item.lineTotal) - Number(item.taxAmount);
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
      lines.push({
        accountId,
        credit: amount,
        description: `Purchase Return ${purchaseReturn.returnNumber}`,
      });
    }

    const taxAmounts = new Map<string, number>();
    assertPostedTaxAmountsHaveTax(
      purchaseReturn.items,
      `Purchase Return ${purchaseReturn.returnNumber}`,
    );
    for (const item of purchaseReturn.items) {
      if (!item.tax || Number(item.taxAmount) === 0) continue;
      if (lineTaxIsCapitalized({ ...item, treatment: treatmentOf(item) })) {
        continue;
      }
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
      exchangeRate,
      companyId: purchaseReturn.companyId,
      branchId: purchaseReturn.branchId,
      costCenterId: purchaseReturn.costCenterId,
      projectId: purchaseReturn.projectId,
      entryDate: purchaseReturn.confirmedAt ?? purchaseReturn.createdAt,
    };
  }
}
