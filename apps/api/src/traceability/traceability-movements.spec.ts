import {
  TRACE_MOVEMENT_LIMIT,
  TraceabilityService,
} from './traceability.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Stock movements in the traceability graph are bounded for the inline
 * panel but never cut silently: past `TRACE_MOVEMENT_LIMIT` the group
 * carries `truncated`, the real `total`, and the source-document ids the
 * full inventory movements list can be filtered by.
 */
describe('TraceabilityService stock movement bounds', () => {
  function rows(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `m-${i}`,
      movementNumber: `MOV-${i}`,
      type: 'SALES_DELIVERY',
    }));
  }

  function makeService(found: number, total: number) {
    const findMany = jest.fn().mockResolvedValue(rows(found));
    const count = jest.fn().mockResolvedValue(total);
    const prisma = { inventoryMovement: { findMany, count } };
    const service = new TraceabilityService(
      prisma as unknown as PrismaService,
      {} as never,
    );
    return { service, findMany, count };
  }

  it('returns every movement with no truncation flag when within the bound', async () => {
    const { service, count } = makeService(3, 3);
    const group = await service['movementsFor'](
      ['SALES_INVOICE'],
      'inv-1',
      'POSTED',
    );
    expect(group.items).toHaveLength(3);
    expect(group.truncated).toBeUndefined();
    expect(group.total).toBeUndefined();
    expect(count).not.toHaveBeenCalled();
  });

  it('flags truncation with the real total and reference ids past the bound', async () => {
    const { service, findMany } = makeService(TRACE_MOVEMENT_LIMIT + 1, 734);
    const result = await service['movementsForReferences']([
      { types: ['SALES_INVOICE'], id: 'inv-1' },
      { types: ['SALES_RETURN'], id: 'ret-1' },
      { types: ['SALES_INVOICE'], id: 'inv-1' },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: TRACE_MOVEMENT_LIMIT + 1 }),
    );
    expect(result.items).toHaveLength(TRACE_MOVEMENT_LIMIT);
    expect(result.truncated).toBe(true);
    expect(result.total).toBe(734);
    expect(result.referenceIds).toEqual(['inv-1', 'ret-1']);
  });

  it('a single-document group carries the bounds through', async () => {
    const { service } = makeService(TRACE_MOVEMENT_LIMIT + 1, 250);
    const group = await service['movementsFor'](
      ['SALES_INVOICE'],
      'inv-9',
      'POSTED',
    );
    expect(group).toMatchObject({
      key: 'STOCK_MOVEMENTS',
      state: 'FOUND',
      truncated: true,
      total: 250,
      referenceIds: ['inv-9'],
    });
  });
});
