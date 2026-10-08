import { HttpException } from '@nestjs/common';
import { WarehouseRole } from '@prisma/client';
import {
  assertWarehouseUse,
  systemWarehouseAllows,
  type WarehouseUse,
} from './system-warehouse-policy';

const USES: WarehouseUse[] = [
  'RECEIVE',
  'WRITE_OFF',
  'ISSUE',
  'INSPECTED_RETURN',
];

describe('system warehouse policy (R15 review M3)', () => {
  it('stock warehouses accept every document', () => {
    for (const use of USES) {
      expect(systemWarehouseAllows(WarehouseRole.STOCK, use)).toBe(true);
    }
  });

  it('goods in transit: every manual document refused; only the lifecycle delivers out of it', () => {
    for (const use of USES) {
      expect(systemWarehouseAllows(WarehouseRole.TRANSIT, use)).toBe(false);
    }
    expect(systemWarehouseAllows(WarehouseRole.TRANSIT, 'ISSUE', true)).toBe(
      true,
    );
    expect(systemWarehouseAllows(WarehouseRole.TRANSIT, 'RECEIVE', true)).toBe(
      false,
    );
  });

  it('damaged goods: out (write-off, transfer out, purchase return) and inspected returns only', () => {
    expect(systemWarehouseAllows(WarehouseRole.DAMAGED, 'WRITE_OFF')).toBe(
      true,
    );
    expect(
      systemWarehouseAllows(WarehouseRole.DAMAGED, 'INSPECTED_RETURN'),
    ).toBe(true);
    expect(systemWarehouseAllows(WarehouseRole.DAMAGED, 'RECEIVE')).toBe(false);
    expect(systemWarehouseAllows(WarehouseRole.DAMAGED, 'ISSUE', true)).toBe(
      false,
    );
  });

  it('refuses with a bilingual SYSTEM_WAREHOUSE_REFUSED naming the warehouse', () => {
    let caught: unknown;
    try {
      assertWarehouseUse(
        { code: 'WH-TRANSIT', role: WarehouseRole.TRANSIT },
        'WRITE_OFF',
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpException);
    const body = (caught as HttpException).getResponse() as Record<
      string,
      string
    >;
    expect(body.code).toBe('SYSTEM_WAREHOUSE_REFUSED');
    expect(body.warehouseCode).toBe('WH-TRANSIT');
    expect(body.messageAr).toContain('WH-TRANSIT');
    expect(body.messageEn).toContain('goods-in-transit');
  });
});
