import { Prisma, ProductSupplyMethod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { unprocessable } from '../../common/errors/business-errors';

/**
 * R13 (spec §2D/§3B) — a KIT owns no stock: it is sold from its components and
 * can never be received or returned to a supplier. Purchase documents reject it
 * (422 `PURCHASE_KIT_NOT_RECEIVABLE`) — buy the components instead.
 */
export function assertNotKit(product: {
  id: string;
  sku: string;
  name: string;
  supplyMethod: ProductSupplyMethod;
}): void {
  if (product.supplyMethod !== ProductSupplyMethod.KIT) return;
  throw unprocessable(
    'PURCHASE_KIT_NOT_RECEIVABLE',
    `${product.sku} ${product.name} is a kit — a kit owns no stock and cannot be purchased or received. Purchase its components instead.`,
    { productId: product.id },
  );
}

/** Same rule for document lines given by product id (create / update). */
export async function assertNoKitProducts(
  client: Prisma.TransactionClient | PrismaService,
  productIds: string[],
): Promise<void> {
  if (productIds.length === 0) return;
  const kit = await client.product.findFirst({
    where: {
      id: { in: [...new Set(productIds)] },
      supplyMethod: ProductSupplyMethod.KIT,
    },
    select: { id: true, sku: true, name: true, supplyMethod: true },
  });
  if (kit) assertNotKit(kit);
}
