import { BadRequestException } from '@nestjs/common';
import { WarehouseRole, type Prisma } from '@prisma/client';

/**
 * Default warehouse resolution for issuing Store Order lines (rule 7):
 * `Product.preferredWarehouseId` when set, else the active Warehouse marked
 * default, else the first active Warehouse by name. Shared by every path that
 * reserves, dispatches or issues order stock.
 *
 * R15 (D15-4) — only STOCK-role warehouses are candidates: the goods-in-transit
 * and damaged-goods system warehouses never are, not even as a product's
 * preferred warehouse (such a product falls back to the default).
 */
export async function resolveStoreOrderLineWarehouses(
  client: Prisma.TransactionClient,
  items: Array<{ product: { preferredWarehouseId: string | null } }>,
): Promise<string[]> {
  const preferredIds = [
    ...new Set(
      items
        .map((item) => item.product.preferredWarehouseId)
        .filter((id): id is string => !!id),
    ),
  ];
  const nonStock = new Set(
    preferredIds.length
      ? (
          await client.warehouse.findMany({
            where: {
              id: { in: preferredIds },
              role: { not: WarehouseRole.STOCK },
            },
            select: { id: true },
          })
        ).map((warehouse) => warehouse.id)
      : [],
  );
  const preferred = (item: (typeof items)[number]) => {
    const id = item.product.preferredWarehouseId;
    return id && !nonStock.has(id) ? id : null;
  };
  const needsDefault = items.some((item) => !preferred(item));
  const fallback = needsDefault
    ? await client.warehouse.findFirst({
        where: { isActive: true, deletedAt: null, role: WarehouseRole.STOCK },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      })
    : null;
  if (needsDefault && !fallback) {
    throw new BadRequestException(
      'No active Warehouse is configured to default Store Order lines to.',
    );
  }
  return items.map((item) => preferred(item) ?? fallback!.id);
}
