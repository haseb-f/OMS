import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma, PurchaseLineTreatment } from '@prisma/client';
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
  lineTaxIsCapitalized,
  recognizedLineAmount,
} from '../../purchasing/invoices/purchase-line-treatment';
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
 * Dr Fixed Assets / Prepayments (capitalized / deferred lines)   net amount
 *    (+ non-recoverable tax of a FIXED_ASSET line — IAS 16, R13b O-2)
 * Dr VAT Input (per resolved account, recoverable tax only)       taxAmount
 * Cr Accounts Payable                                            grandTotal
 *
 * Every account id resolved through `AccountMappingService` (TASK-047);
 * Dr/Cr structure and amounts unchanged from TASK-046. Also updates the
 * moving-average cost of every inventory-tracked line via
 * `InventoryValuationService.applyPurchaseReceiptLines` (once per product,
 * all of the document's lines of that product together) — the "Inventory
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
    private readonly exchangeRates: ExchangeRatesService,
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
    const exchangeRate = await snapshotDocumentExchangeRate(
      this.exchangeRates,
      tx,
      (rate) =>
        tx.purchaseInvoice.update({
          where: { id: invoice.id },
          data: { exchangeRate: rate },
        }),
      invoice.currencyId,
      invoice.exchangeRate,
      invoice.confirmedAt ?? invoice.createdAt,
    );

    const lines: PostingLine[] = [];
    const debitByAccount = new Map<string, number>();

    // Capitalized / deferred lines post one debit line each (never merged),
    // so each linked Fixed Asset / Prepaid Expense carries exactly the base
    // amount this entry recorded for it.
    const recognitionLines: PostingLine[] = [];
    // R13 (F8) — receipt lines grouped per product: the moving average is
    // blended ONCE per product against the on-hand before the whole
    // document, so the same product on two lines never distorts it.
    const receivedByProduct = new Map<
      string,
      { quantity: number; value: Prisma.Decimal }[]
    >();
    for (const item of invoice.items) {
      const netAmount = Number(item.lineTotal) - Number(item.taxAmount);
      const roundedNet = Math.round(netAmount * 100) / 100;
      if (item.treatment === PurchaseLineTreatment.FIXED_ASSET) {
        // Net + non-recoverable tax (cost addition lines included) — the
        // amount PurchaseLineRecognitionService puts on the asset.
        recognitionLines.push({
          accountId: await this.accountMapping.resolveFixedAssetsAccount(tx),
          debit: recognizedLineAmount(item),
          description: `Fixed asset — ${invoice.invoiceNumber}`,
        });
        continue;
      }
      if (item.treatment === PurchaseLineTreatment.PREPAID_EXPENSE) {
        recognitionLines.push({
          accountId: await this.accountMapping.resolvePrepaymentsAccount(tx),
          debit: roundedNet,
          description: `Prepaid expense — ${invoice.invoiceNumber}`,
        });
        continue;
      }
      if (item.product.isInventoryItem) {
        const accountId = await this.accountMapping.resolveInventoryAccount(
          item.product.categoryId,
          tx,
        );
        debitByAccount.set(
          accountId,
          (debitByAccount.get(accountId) ?? 0) + netAmount,
        );
        // Moving-average cost lives in functional currency and must equal
        // what this entry debits to Inventory (net of discount, converted at
        // the frozen rate, 2 dp): the blend takes that exact line VALUE —
        // never a rounded unit cost × quantity, which drifts from the GL.
        receivedByProduct.set(item.productId, [
          ...(receivedByProduct.get(item.productId) ?? []),
          {
            quantity: item.quantity,
            value: round2(
              new Prisma.Decimal(item.lineTotal)
                .sub(item.taxAmount)
                .mul(exchangeRate),
            ),
          },
        ]);
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
    for (const [productId, received] of receivedByProduct) {
      await this.inventoryValuation.applyPurchaseReceiptLines(
        productId,
        received,
        tx,
        userId,
      );
    }
    for (const [accountId, amount] of debitByAccount) {
      if (amount === 0) continue;
      lines.push({
        accountId,
        debit: amount,
        description: `Purchase Invoice ${invoice.invoiceNumber}`,
      });
    }
    lines.push(...recognitionLines.filter((line) => line.debit !== 0));

    const taxAmounts = new Map<string, number>();
    assertPostedTaxAmountsHaveTax(
      invoice.items,
      `Purchase Invoice ${invoice.invoiceNumber}`,
    );
    for (const item of invoice.items) {
      if (!item.tax || Number(item.taxAmount) === 0) continue;
      // Capitalized into the asset above — never VAT Input as well.
      if (lineTaxIsCapitalized(item)) continue;
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
      exchangeRate,
      companyId: invoice.companyId,
      branchId: invoice.branchId,
      costCenterId: invoice.costCenterId,
      projectId: invoice.projectId,
      entryDate: invoice.confirmedAt ?? invoice.createdAt,
    };
  }
}
