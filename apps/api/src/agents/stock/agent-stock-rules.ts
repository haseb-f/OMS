import { InventoryMovementType, WarehouseRole } from '@prisma/client';
import { agentUnprocessable } from '../common/agent-errors';
import { STORE_ORDER_TRANSIT_REFERENCE } from '../../store-orders/stock-lifecycle/stock-ledger';
import { toBusinessDateString } from '../../common/time/business-date';

/**
 * R18 B — what a movement of an agent's goods means in the agent's stock
 * history (one word per row, translated by the web). Derived from the
 * append-only ledger only; never stored.
 */
export type AgentStockEvent =
  | 'OPENING'
  | 'RECEIPT'
  | 'RESERVED'
  | 'RELEASED'
  | 'DISPATCHED'
  | 'BACK_FROM_TRANSIT'
  | 'DELIVERED'
  | 'RETURNED'
  | 'ADJUSTED'
  | 'WRITTEN_OFF'
  | 'TRANSFERRED';

export function agentStockEvent(movement: {
  type: InventoryMovementType;
  quantity: number;
  referenceType: string | null;
  warehouseRole: WarehouseRole | null;
}): AgentStockEvent {
  switch (movement.type) {
    case InventoryMovementType.OPENING_BALANCE:
      return 'OPENING';
    case InventoryMovementType.CONSIGNMENT_RECEIPT:
      return 'RECEIPT';
    case InventoryMovementType.RESERVATION:
      return 'RESERVED';
    case InventoryMovementType.RESERVATION_RELEASE:
      return 'RELEASED';
    case InventoryMovementType.SALES_DELIVERY:
      return 'DELIVERED';
    case InventoryMovementType.SALES_RETURN:
      return 'RETURNED';
    case InventoryMovementType.DAMAGE:
    case InventoryMovementType.EXPIRED:
      return 'WRITTEN_OFF';
    case InventoryMovementType.TRANSFER: {
      if (movement.referenceType !== STORE_ORDER_TRANSIT_REFERENCE) {
        return 'TRANSFERRED';
      }
      // Both legs of a dispatch move goods INTO transit: + on the transit
      // warehouse, − on the stock warehouse. The receive-back is the mirror.
      const intoTransit =
        (movement.warehouseRole === WarehouseRole.TRANSIT) ===
        movement.quantity > 0;
      return intoTransit ? 'DISPATCHED' : 'BACK_FROM_TRANSIT';
    }
    default:
      return 'ADJUSTED';
  }
}

/** The receipt's business day: YYYY-MM-DD, default today, never after today (Cairo). */
export function receiptBusinessDate(
  value: string | undefined,
  today: string,
): string {
  if (!value) return today;
  let day: string;
  try {
    day = toBusinessDateString(value);
  } catch {
    throw agentUnprocessable(
      'AGENT_STOCK_DATE_INVALID',
      'تاريخ الاستلام غير صالح',
      'The receipt date is not a valid date.',
    );
  }
  if (day > today) {
    throw agentUnprocessable(
      'AGENT_STOCK_DATE_IN_FUTURE',
      'لا يمكن أن يكون تاريخ الاستلام في المستقبل',
      'The receipt date cannot be in the future.',
    );
  }
  return day;
}

/** One line per product: the same product twice is a typing mistake, never two receipts. */
export function assertDistinctProducts(lines: { productId: string }[]): void {
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.productId)) {
      throw agentUnprocessable(
        'AGENT_STOCK_LINE_REPEATED',
        'المنتج مكرر في الاستلام — اجمع الكمية في سطر واحد',
        'A product is repeated on the receipt — put its quantity on one line.',
        { productId: line.productId },
      );
    }
    seen.add(line.productId);
  }
}
