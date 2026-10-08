import { BadRequestException, Injectable } from '@nestjs/common';
import { ProductStatus, ProductSupplyMethod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { readStockAvailability } from '../../inventory/stock-lines/stock-availability';
import { ReferenceDataRegistryService } from '../reference-data/reference-data-registry.service';
import { getReferenceCache } from '../reference-data/reference-cache';
import { importScope, type ImportActor } from '../import-type.interface';

export interface CatalogProduct {
  id: string;
  sku: string;
  displayName: string;
  isSellable: boolean;
  isInventoryItem: boolean;
  supplyMethod: ProductSupplyMethod;
}

type CatalogEntry = CatalogProduct & { active: boolean };

/**
 * R15 — the importer's own sellable catalogue: company goods (no owner agent)
 * for a company import, the agent's own goods for an agent import. A sales
 * import resolves its Product column only inside it (SKU first, then display
 * name), so a row can never reach — or reveal — another owner's product.
 */
@Injectable()
export class ImportCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly referenceData: ReferenceDataRegistryService,
  ) {}

  private async catalog(actor: ImportActor): Promise<CatalogEntry[]> {
    const cache = getReferenceCache();
    const cacheKey = `sales-import-catalog:${importScope(actor)}`;
    const cached = cache?.get(cacheKey);
    if (cached) return cached as CatalogEntry[];
    const products = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        ownerAgentId: actor.agent ? actor.agent.agentId : null,
      },
      select: {
        id: true,
        sku: true,
        displayName: true,
        status: true,
        isSellable: true,
        isInventoryItem: true,
        supplyMethod: true,
      },
    });
    const catalog = products.map(({ status, ...product }) => ({
      ...product,
      active: status === ProductStatus.ACTIVE,
    }));
    cache?.set(cacheKey, catalog);
    return catalog;
  }

  /** A real product of the importer's catalogue for the template's sample row. */
  async sampleProductName(actor: ImportActor): Promise<string | undefined> {
    const product = (await this.catalog(actor)).find(
      (candidate) => candidate.active && candidate.isSellable,
    );
    return product?.displayName;
  }

  /** Active + sellable product of the importer's catalogue (bilingual row error otherwise). */
  async resolveProduct(
    actor: ImportActor,
    value: string | undefined,
  ): Promise<CatalogProduct> {
    const trimmed = value?.trim();
    if (!trimmed) {
      throw new BadRequestException('المنتج مطلوب — Product is required.');
    }
    const catalog = await this.catalog(actor);
    const id = this.referenceData.resolveAmong(
      'PRODUCT',
      catalog.map((product) => ({
        id: product.id,
        code: product.sku,
        name: product.displayName,
        active: product.active,
      })),
      ['code', 'name'],
      trimmed,
      'Product',
    );
    const product = catalog.find((candidate) => candidate.id === id)!;
    if (!product.isSellable) {
      throw new BadRequestException({
        code: 'PRODUCT_NOT_SELLABLE',
        message: `المنتج «${product.displayName}» غير متاح للبيع — Product "${product.displayName}" is not sellable.`,
      });
    }
    return product;
  }

  /**
   * Preview only: a bilingual warning per tracked product the sellable
   * warehouses cannot cover now — the order is still created and waits for
   * stock (R15 W5a reservation). Kits are checked by the reservation itself.
   */
  async stockWarnings(
    lines: { product: CatalogProduct; quantity: number }[],
  ): Promise<string[]> {
    const required = new Map<
      string,
      { product: CatalogProduct; qty: number }
    >();
    for (const { product, quantity } of lines) {
      if (!product.isInventoryItem || product.supplyMethod === 'KIT') continue;
      const entry = required.get(product.id) ?? { product, qty: 0 };
      entry.qty += quantity;
      required.set(product.id, entry);
    }
    if (required.size === 0) return [];
    const availability = await readStockAvailability(this.prisma, [
      ...required.keys(),
    ]);
    const warnings: string[] = [];
    for (const [productId, { product, qty }] of required) {
      const available = availability.get(productId)?.available ?? 0;
      if (qty <= available) continue;
      warnings.push(
        `المتاح من «${product.displayName}» ${Math.max(available, 0)} والمطلوب ${qty} — سيُنشأ الطلب بانتظار المخزون — Only ${Math.max(available, 0)} of "${product.displayName}" available for ${qty}; the order will be created awaiting stock.`,
      );
    }
    return warnings;
  }
}
