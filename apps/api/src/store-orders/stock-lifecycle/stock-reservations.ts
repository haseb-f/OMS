import { InventoryMovementType } from '@prisma/client';
import { parseStoreOrderKey, STORE_ORDER_REFERENCE } from './stock-ledger';

/** The movement columns the per-line reading needs. */
export interface LedgerMovement {
  type: InventoryMovementType;
  referenceType: string | null;
  productId: string;
  warehouseId: string;
  quantity: number;
  idempotencyKey: string | null;
}

/** What one order line (or an unattributed remainder) holds reserved at one warehouse. */
export interface ReservedSlot {
  /** Order line id; another key segment for lines removed since; `ORDER` for an unattributed remainder. */
  lineKey: string;
  productId: string;
  warehouseId: string;
  quantity: number;
}

/** Line key of a reservation balance no keyed movement explains (R14 releases were unkeyed). */
export const UNATTRIBUTED_LINE = 'ORDER';

const RESERVED_LEDGER = new Set<InventoryMovementType>([
  InventoryMovementType.RESERVATION,
  InventoryMovementType.RESERVATION_RELEASE,
]);

/**
 * R15 W5a — the order's real reserved balance (RESERVATION − RELEASE under
 * `STORE_ORDER:<order>`, per product + warehouse) attributed to its lines.
 * Each line's keyed balance is taken in line order, capped by what is really
 * still reserved — R14 released without keys, so a keyed sum alone could
 * overstate a line. Lines no longer on the order keep their own key; any
 * remainder no key explains is `ORDER`. Pure.
 */
export function allocateReserved(
  movements: LedgerMovement[],
  lineOrder: string[],
): ReservedSlot[] {
  const slot = (productId: string, warehouseId: string) =>
    `${productId}|${warehouseId}`;
  const real = new Map<string, number>();
  const keyed = new Map<string, Map<string, number>>();
  for (const movement of movements) {
    if (
      movement.referenceType !== STORE_ORDER_REFERENCE ||
      !RESERVED_LEDGER.has(movement.type)
    ) {
      continue;
    }
    const at = slot(movement.productId, movement.warehouseId);
    real.set(at, (real.get(at) ?? 0) + movement.quantity);
    const parsed = parseStoreOrderKey(movement.idempotencyKey);
    if (!parsed) continue;
    const line = keyed.get(parsed.lineKey) ?? new Map<string, number>();
    line.set(at, (line.get(at) ?? 0) + movement.quantity);
    keyed.set(parsed.lineKey, line);
  }

  const order = [
    ...lineOrder,
    ...[...keyed.keys()].filter((key) => !lineOrder.includes(key)),
  ];
  const slots: ReservedSlot[] = [];
  const take = (lineKey: string, at: string, wanted: number) => {
    const left = real.get(at) ?? 0;
    const quantity = Math.min(wanted, left);
    if (quantity <= 0) return;
    real.set(at, left - quantity);
    const [productId, warehouseId] = at.split('|');
    slots.push({ lineKey, productId, warehouseId, quantity });
  };
  for (const lineKey of order) {
    for (const [at, quantity] of keyed.get(lineKey) ?? []) {
      take(lineKey, at, quantity);
    }
  }
  for (const [at, quantity] of [...real]) {
    take(UNATTRIBUTED_LINE, at, quantity);
  }
  return slots;
}
