import { HttpException } from '@nestjs/common';
import { InventoryMovementType as T, WarehouseRole } from '@prisma/client';
import {
  agentStockEvent,
  assertDistinctProducts,
  receiptBusinessDate,
} from './agent-stock-rules';

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    if (error instanceof HttpException) {
      return (error.getResponse() as { code?: string }).code;
    }
    throw error;
  }
  return undefined;
};

describe('agentStockEvent (R18 B)', () => {
  const event = (
    type: T,
    quantity: number,
    referenceType: string | null = null,
    warehouseRole: WarehouseRole | null = WarehouseRole.STOCK,
  ) => agentStockEvent({ type, quantity, referenceType, warehouseRole });

  it('names receipts, reservations, delivery and returns', () => {
    expect(event(T.OPENING_BALANCE, 10)).toBe('OPENING');
    expect(event(T.CONSIGNMENT_RECEIPT, 5)).toBe('RECEIPT');
    expect(event(T.RESERVATION, 3, 'STORE_ORDER')).toBe('RESERVED');
    expect(event(T.RESERVATION_RELEASE, -3, 'STORE_ORDER')).toBe('RELEASED');
    expect(
      event(T.SALES_DELIVERY, -3, 'STORE_ORDER', WarehouseRole.TRANSIT),
    ).toBe('DELIVERED');
    expect(event(T.SALES_RETURN, 1, 'AGENT_ORDER_RETURN')).toBe('RETURNED');
    expect(event(T.ADJUSTMENT, -1)).toBe('ADJUSTED');
    expect(event(T.DAMAGE, -1)).toBe('WRITTEN_OFF');
  });

  it('names both sides of a stocked assembly and of its reversal (R19 A)', () => {
    const ref = 'ASSEMBLY_ORDER';
    expect(event(T.PRODUCTION_CONSUMPTION, -200, ref)).toBe(
      'ASSEMBLY_CONSUMED',
    );
    expect(event(T.PRODUCTION_OUTPUT, 100, ref)).toBe('ASSEMBLED');
    expect(event(T.PRODUCTION_OUTPUT, -10, ref)).toBe('DISASSEMBLED');
    expect(event(T.PRODUCTION_CONSUMPTION, 20, ref)).toBe('ASSEMBLY_RESTORED');
  });

  it('reads both legs of a dispatch as DISPATCHED and the mirror as BACK_FROM_TRANSIT', () => {
    const transit = 'STORE_ORDER_TRANSIT';
    expect(event(T.TRANSFER, -3, transit, WarehouseRole.STOCK)).toBe(
      'DISPATCHED',
    );
    expect(event(T.TRANSFER, 3, transit, WarehouseRole.TRANSIT)).toBe(
      'DISPATCHED',
    );
    expect(event(T.TRANSFER, -1, transit, WarehouseRole.TRANSIT)).toBe(
      'BACK_FROM_TRANSIT',
    );
    expect(event(T.TRANSFER, 1, transit, WarehouseRole.STOCK)).toBe(
      'BACK_FROM_TRANSIT',
    );
    expect(event(T.TRANSFER, 2, 'TRANSFER')).toBe('TRANSFERRED');
  });
});

describe('receiptBusinessDate (R18 B)', () => {
  it('defaults to today and accepts a past day', () => {
    expect(receiptBusinessDate(undefined, '2026-10-12')).toBe('2026-10-12');
    expect(receiptBusinessDate('2026-09-30', '2026-10-12')).toBe('2026-09-30');
  });

  it('refuses a future or impossible day', () => {
    expect(codeOf(() => receiptBusinessDate('2026-10-13', '2026-10-12'))).toBe(
      'AGENT_STOCK_DATE_IN_FUTURE',
    );
    expect(codeOf(() => receiptBusinessDate('2026-02-30', '2026-10-12'))).toBe(
      'AGENT_STOCK_DATE_INVALID',
    );
  });
});

describe('assertDistinctProducts (R18 B)', () => {
  it('refuses the same product twice on one receipt', () => {
    expect(
      codeOf(() =>
        assertDistinctProducts([{ productId: 'a' }, { productId: 'b' }]),
      ),
    ).toBeUndefined();
    expect(
      codeOf(() =>
        assertDistinctProducts([{ productId: 'a' }, { productId: 'a' }]),
      ),
    ).toBe('AGENT_STOCK_LINE_REPEATED');
  });
});
