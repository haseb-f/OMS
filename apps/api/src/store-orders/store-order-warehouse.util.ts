import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Default warehouse resolution for issuing Store Order lines (rule 7):
 * `Product.preferredWarehouseId` when set, else the active Warehouse marked
 * default, else the first active Warehouse by name. Shared by every path that
 * issues order stock (agent dispatch; the same order as generate-invoice).
 */
export async function resolveStoreOrderLineWarehouses(
  client: Prisma.TransactionClient,
  items: Array<{ product: { preferredWarehouseId: string | null } }>,
): Promise<string[]> {
  const needsDefault = items.some((item) => !item.product.preferredWarehouseId);
  const fallback = needsDefault
    ? await client.warehouse.findFirst({
        where: { isActive: true, deletedAt: null },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      })
    : null;
  if (needsDefault && !fallback) {
    throw new BadRequestException(
      'No active Warehouse is configured to default Store Order lines to.',
    );
  }
  return items.map((item) => item.product.preferredWarehouseId ?? fallback!.id);
}
