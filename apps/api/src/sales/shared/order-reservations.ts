import { InventoryMovementType, Prisma } from '@prisma/client';
import {
  InventoryService,
  lockProductsForUpdate,
} from '../../inventory/inventory.service';

/** Reference of the reservations a B2B Sales Order holds. */
export const SALES_ORDER_RESERVATION_REFERENCE = 'SALES_ORDER_DOC';

export interface ReservedBalance {
  productId: string;
  warehouseId: string;
  quantity: number;
}

const reservationKey = (productId: string, warehouseId: string) =>
  `${productId}:${warehouseId}`;

/**
 * What a document still holds reserved, per product + warehouse, read from the
 * reserved ledger (RESERVATION − RESERVATION_RELEASE under its reference).
 * Releasing from this — never from the current recipe or the order lines —
 * releases exactly what was reserved, even when a kit's recipe has changed
 * since the order was confirmed.
 */
export async function reservedUnderReference(
  tx: Prisma.TransactionClient,
  referenceType: string,
  referenceId: string,
): Promise<Map<string, ReservedBalance>> {
  const groups = await tx.inventoryMovement.groupBy({
    by: ['productId', 'warehouseId'],
    where: {
      referenceType,
      referenceId,
      type: {
        in: [
          InventoryMovementType.RESERVATION,
          InventoryMovementType.RESERVATION_RELEASE,
        ],
      },
    },
    _sum: { quantity: true },
  });
  const balances = new Map<string, ReservedBalance>();
  for (const group of groups) {
    const quantity = group._sum.quantity ?? 0;
    if (quantity <= 0) continue;
    balances.set(reservationKey(group.productId, group.warehouseId), {
      productId: group.productId,
      warehouseId: group.warehouseId,
      quantity,
    });
  }
  return balances;
}

/**
 * Releases up to `quantity` of a product's reservation under the reference,
 * consuming the in-memory `balances` (so several lines of one document never
 * release the same reservation twice). Returns what was released.
 */
export async function releaseReserved(
  tx: Prisma.TransactionClient,
  inventory: InventoryService,
  balances: Map<string, ReservedBalance>,
  reference: { referenceType: string; referenceId: string },
  line: { productId: string; warehouseId: string; quantity: number },
  userId?: string,
): Promise<number> {
  const key = reservationKey(line.productId, line.warehouseId);
  const balance = balances.get(key);
  const quantity = Math.min(balance?.quantity ?? 0, line.quantity);
  if (!balance || quantity <= 0) return 0;
  await inventory.release(
    {
      productId: line.productId,
      warehouseId: line.warehouseId,
      quantity,
      ...reference,
    },
    userId,
    tx,
  );
  balance.quantity -= quantity;
  if (balance.quantity <= 0) balances.delete(key);
  return quantity;
}

/** Releases everything still reserved under the reference (cancel / back to draft / fully delivered). */
export async function releaseAllReserved(
  tx: Prisma.TransactionClient,
  inventory: InventoryService,
  reference: { referenceType: string; referenceId: string },
  userId?: string,
): Promise<void> {
  const read = () =>
    reservedUnderReference(tx, reference.referenceType, reference.referenceId);
  const unlocked = await read();
  if (unlocked.size === 0) return;
  await lockProductsForUpdate(
    tx,
    [...unlocked.values()].map((row) => row.productId),
  );
  // Re-read under the lock: a concurrent writer may have released meanwhile.
  const balances = await read();
  for (const row of [...balances.values()]) {
    await releaseReserved(tx, inventory, balances, reference, row, userId);
  }
}
