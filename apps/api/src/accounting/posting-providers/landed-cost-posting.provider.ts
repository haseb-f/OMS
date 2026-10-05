import { Injectable, OnModuleInit } from '@nestjs/common';
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
import { allocateProportionally } from '../../landed-cost/landed-cost-allocation.util';
import type {
  PostingLine,
  PostingProvider,
  PostingResult,
} from '../posting-engine/posting-provider.interface';

type DecimalInput = Prisma.Decimal | number | string;
const D = (value: DecimalInput) => new Prisma.Decimal(value);
const ZERO = D(0);

/** Adds `value` under `key` (Decimal accumulation, no float drift). */
function accumulate<K>(
  map: Map<K, Prisma.Decimal>,
  key: K,
  value: DecimalInput,
) {
  map.set(key, (map.get(key) ?? ZERO).add(value));
}

/**
 * Converts each amount to the functional currency (`round2(amount × rate)`)
 * and moves the rounding residual onto the largest amount so the converted
 * amounts add up to exactly `functionalTotal`.
 */
function toFunctionalExact<K>(
  amounts: Map<K, Prisma.Decimal>,
  rate: number,
  functionalTotal: Prisma.Decimal,
): Map<K, Prisma.Decimal> {
  const converted = new Map<K, Prisma.Decimal>();
  let largest: K | undefined;
  for (const [key, amount] of amounts) {
    converted.set(key, round2(amount.mul(rate)));
    if (largest === undefined || amount.abs().gt(amounts.get(largest)!.abs())) {
      largest = key;
    }
  }
  const residual = functionalTotal.sub(
    [...converted.values()].reduce((sum, value) => sum.add(value), ZERO),
  );
  if (largest !== undefined && !residual.isZero()) {
    converted.set(largest, converted.get(largest)!.add(residual));
  }
  return converted;
}

/**
 * Landed Cost Posting Provider (ADR-0017 / Cost Engine M1, R13 spec §4).
 *
 * All amounts are booked in the functional currency at the document's FROZEN
 * exchange rate (`exchangeRate`, existing snapshot rule — a foreign-currency
 * document never posts at an implicit rate of 1):
 *
 * Dr Inventory (per product category account)      capitalized
 * Dr COGS (per product category account)           variance (units already sold)
 * Dr VAT Input (per resolved Tax account)          taxTotal
 * Cr Payable (provider) / Landed Cost Clearing     net + tax (per line's account)
 *
 * Per product (all allocations of that product together — a Purchase Invoice
 * may carry it on several lines): with allocated amount `A` for `Q` received
 * units and current on-hand `O`, `capitalized = A × min(Q, O) / Q` raises the
 * moving average and `variance = A − capitalized` is expensed to COGS
 * (`InventoryValuationService.applyLandedCost`; never throws on `O ≤ 0`).
 * Each allocation stores its share of the split (`capitalizedAmount`,
 * `cogsVarianceAmount`, functional currency). Debits equal credits exactly:
 * the provider does the conversion and rounding itself
 * (`linesInFunctionalCurrency`). The entry is dated on the document date —
 * the Posting Engine's period / fiscal-year checks apply to that date.
 * Capitalization happens here, inside `buildEntries`, so it commits
 * atomically with the Journal Entry.
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

    const rate = await snapshotDocumentExchangeRate(
      this.exchangeRates,
      tx,
      (snapshot) =>
        tx.landedCostDocument.update({
          where: { id: document.id },
          data: { exchangeRate: snapshot },
        }),
      document.currencyId,
      document.exchangeRate,
      document.documentDate,
    );

    // Credit side (document currency) — gross per line, by resolved account.
    const creditByAccount = new Map<string, Prisma.Decimal>();
    for (const line of document.lines) {
      const gross = D(line.netAmount).add(line.taxAmount);
      if (gross.isZero()) continue;
      const accountId = document.providerId
        ? await this.accountMapping.resolvePayableAccount(
            document.providerId,
            tx,
          )
        : await this.accountMapping.resolveLandedCostClearingAccount(
            line.costComponentId,
            tx,
          );
      accumulate(creditByAccount, accountId, gross);
    }
    const vatByAccount = new Map<string, Prisma.Decimal>();
    for (const line of document.lines) {
      if (!line.taxId || D(line.taxAmount).isZero()) continue;
      accumulate(
        vatByAccount,
        await this.accountMapping.resolveVatInputAccount(line.taxId, tx),
        line.taxAmount,
      );
    }

    // Functional amounts: credits and VAT converted line by line; the net
    // (what the allocations carry) is what remains, so the entry balances
    // to the cent by construction.
    const creditFunctional = new Map(
      [...creditByAccount].map(([accountId, amount]) => [
        accountId,
        round2(amount.mul(rate)),
      ]),
    );
    const vatFunctional = new Map(
      [...vatByAccount].map(([accountId, amount]) => [
        accountId,
        round2(amount.mul(rate)),
      ]),
    );
    const total = (map: Map<string, Prisma.Decimal>) =>
      [...map.values()].reduce((sum, value) => sum.add(value), ZERO);
    const netFunctional = total(creditFunctional).sub(total(vatFunctional));
    const allocationFunctional = toFunctionalExact(
      new Map(
        document.allocations.map((allocation) => [
          allocation.id,
          D(allocation.allocatedAmount),
        ]),
      ),
      rate,
      netFunctional,
    );

    // Capitalized vs variance, once per product (all its allocations).
    const byProduct = new Map<
      string,
      {
        categoryId: string;
        quantity: number;
        allocations: { id: string; amount: Prisma.Decimal }[];
      }
    >();
    for (const allocation of document.allocations) {
      const product = allocation.purchaseInvoiceItem.product;
      const entry = byProduct.get(product.id) ?? {
        categoryId: product.categoryId,
        quantity: 0,
        allocations: [],
      };
      entry.quantity += allocation.allocatedQuantity;
      entry.allocations.push({
        id: allocation.id,
        amount: allocationFunctional.get(allocation.id) ?? ZERO,
      });
      byProduct.set(product.id, entry);
    }

    const inventoryDebit = new Map<string, Prisma.Decimal>();
    const varianceDebit = new Map<string, Prisma.Decimal>();
    for (const [productId, entry] of byProduct) {
      const amount = entry.allocations.reduce(
        (sum, allocation) => sum.add(allocation.amount),
        ZERO,
      );
      const split = await this.inventoryValuation.applyLandedCost(
        productId,
        amount,
        tx,
        userId,
        { allocatedQuantity: entry.quantity, referenceId: document.id },
      );
      const capitalized = D(split.capitalized);
      const variance = amount.sub(capitalized);
      // The product's split shared back over its allocations (exact sums).
      const shares = allocateProportionally(
        capitalized.toNumber(),
        entry.allocations.map((allocation) => ({
          key: allocation.id,
          weight: allocation.amount.toNumber(),
        })),
      );
      for (const allocation of entry.allocations) {
        const share = D(
          shares.find((s) => s.key === allocation.id)?.amount ?? 0,
        );
        await tx.landedCostAllocation.update({
          where: { id: allocation.id },
          data: {
            capitalizedAmount: share,
            cogsVarianceAmount: allocation.amount.sub(share),
          },
        });
      }
      if (!capitalized.isZero()) {
        accumulate(
          inventoryDebit,
          await this.accountMapping.resolveInventoryAccount(
            entry.categoryId,
            tx,
          ),
          capitalized,
        );
      }
      if (!variance.isZero()) {
        accumulate(
          varianceDebit,
          await this.accountMapping.resolveCogsAccount(entry.categoryId, tx),
          variance,
        );
      }
    }

    const lines: PostingLine[] = [];
    for (const [accountId, amount] of inventoryDebit) {
      lines.push({
        accountId,
        debit: amount.toNumber(),
        description: `Landed Cost ${document.documentNumber} — capitalized into Inventory`,
      });
    }
    for (const [accountId, amount] of varianceDebit) {
      lines.push({
        accountId,
        debit: amount.toNumber(),
        description: `Landed Cost ${document.documentNumber} — variance on units already sold`,
      });
    }
    for (const [accountId, amount] of vatFunctional) {
      if (amount.isZero()) continue;
      lines.push({
        accountId,
        debit: amount.toNumber(),
        description: `VAT Input — Landed Cost ${document.documentNumber}`,
      });
    }
    for (const [accountId, amount] of creditFunctional) {
      if (amount.isZero()) continue;
      lines.push({
        accountId,
        credit: amount.toNumber(),
        description: `Landed Cost ${document.documentNumber}`,
        partnerId: document.providerId ?? undefined,
      });
    }

    return {
      lines,
      description: `Landed Cost ${document.documentNumber} (Purchase Invoice ${document.purchaseInvoice.invoiceNumber})`,
      referenceNumber: document.documentNumber,
      currencyId: document.currencyId,
      exchangeRate: rate,
      linesInFunctionalCurrency: true,
      entryDate: document.documentDate,
    };
  }
}
