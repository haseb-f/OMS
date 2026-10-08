import { InventoryMovementType, Prisma, WarehouseRole } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

const RESERVATION_TYPES: InventoryMovementType[] = [
  InventoryMovementType.RESERVATION,
  InventoryMovementType.RESERVATION_RELEASE,
];

export interface StockAvailability {
  onHand: number;
  reserved: number;
  /** `onHand − reserved` — what a new consumer may still take. */
  available: number;
}

/**
 * On-hand / reserved / available of several products in one warehouse (or across
 * every sellable — STOCK-role — warehouse when none is given; R15: goods in
 * transit and damaged goods are never available to sell) — two grouped reads,
 * never a query per product. Read-only: the locked stock writers remain the
 * real guard; this only lets the assembly / kit / order-entry logic explain a
 * shortage before moving anything.
 */
export async function readStockAvailability(
  client: Client,
  productIds: string[],
  warehouseId?: string,
): Promise<Map<string, StockAvailability>> {
  const ids = [...new Set(productIds)];
  const result = new Map<string, StockAvailability>(
    ids.map((id) => [id, { onHand: 0, reserved: 0, available: 0 }]),
  );
  if (ids.length === 0) return result;

  const place: Prisma.InventoryMovementWhereInput = warehouseId
    ? { warehouseId }
    : { warehouse: { role: WarehouseRole.STOCK } };
  const [onHandRows, reservedRows] = await Promise.all([
    client.inventoryMovement.groupBy({
      by: ['productId'],
      where: {
        productId: { in: ids },
        ...place,
        type: { notIn: RESERVATION_TYPES },
      },
      _sum: { quantity: true },
    }),
    client.inventoryMovement.groupBy({
      by: ['productId'],
      where: {
        productId: { in: ids },
        ...place,
        type: { in: RESERVATION_TYPES },
      },
      _sum: { quantity: true },
    }),
  ]);
  for (const row of onHandRows) {
    const entry = result.get(row.productId);
    if (entry) entry.onHand = row._sum.quantity ?? 0;
  }
  for (const row of reservedRows) {
    const entry = result.get(row.productId);
    if (entry) entry.reserved = row._sum.quantity ?? 0;
  }
  for (const entry of result.values()) {
    entry.available = entry.onHand - entry.reserved;
  }
  return result;
}
