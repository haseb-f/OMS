import { Prisma } from '@prisma/client';

type Decimalish = Prisma.Decimal | number | string | null | undefined;

function toNumber(value: Decimalish): number {
  if (value == null || value === '') return 0;
  return Number(value);
}

/**
 * Canonical Store Order line amount. `agreedAmount` is the commercial
 * line total and is independent of quantity. Fall back to qty × unitPrice
 * only for rows that predate the agreed-amount column.
 */
export function storeOrderLineAmount(item: {
  quantity: number;
  unitPrice: Decimalish;
  agreedAmount?: Decimalish;
}): number {
  if (item.agreedAmount != null && item.agreedAmount !== '') {
    return toNumber(item.agreedAmount);
  }
  return Number(item.quantity) * toNumber(item.unitPrice);
}

export function storeOrderItemsTotal(
  items: Array<{
    quantity: number;
    unitPrice: Decimalish;
    agreedAmount?: Decimalish;
  }>,
): number {
  return items.reduce((sum, item) => sum + storeOrderLineAmount(item), 0);
}

export function derivedUnitPrice(
  quantity: number,
  agreedAmount: number,
): number {
  if (quantity <= 0) return agreedAmount;
  return Math.round((agreedAmount / quantity) * 100) / 100;
}
