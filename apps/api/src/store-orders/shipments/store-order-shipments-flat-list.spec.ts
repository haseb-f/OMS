import { StoreOrderShipmentsService } from './store-order-shipments.service';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Shipping Quick Edit (Part 11 — Order/Shipment Consistency): every per-order
 * shipment mutation (shipping-company, tracking-number, shipping-status,
 * attachments) resolves "the CURRENT shipment attempt" for the Store Order,
 * never a specific shipment id. On the flat, cross-order Shipping list, an
 * order with a reship history shows BOTH the current and historical attempt
 * as separate rows — quick-editing a historical row would otherwise silently
 * write to the current attempt instead. `isCurrentAttempt` is how the
 * frontend knows which row may be quick-edited.
 */
describe('StoreOrderShipmentsService.findAllFlat — isCurrentAttempt', () => {
  const prisma = {
    shipment: {
      findMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
  };

  const service = new StoreOrderShipmentsService(
    prisma as unknown as PrismaService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.shipment.count.mockResolvedValue(3);
  });

  it('flags only the highest attemptNumber per Store Order as current', async () => {
    prisma.shipment.findMany.mockResolvedValue([
      { id: 's1', storeOrderId: 'order-a', attemptNumber: 2 },
      { id: 's2', storeOrderId: 'order-a', attemptNumber: 1 },
      { id: 's3', storeOrderId: 'order-b', attemptNumber: 1 },
    ]);
    prisma.shipment.groupBy.mockResolvedValue([
      { storeOrderId: 'order-a', _max: { attemptNumber: 2 } },
      { storeOrderId: 'order-b', _max: { attemptNumber: 1 } },
    ]);

    const result = await service.findAllFlat({});

    const groupByCall = prisma.shipment.groupBy.mock.calls.at(0) as
      [{ by: string[]; where: { storeOrderId: { in: string[] } } }] | undefined;
    expect(groupByCall?.[0].by).toEqual(['storeOrderId']);
    expect(groupByCall?.[0].where.storeOrderId).toEqual({
      in: ['order-a', 'order-b'],
    });
    const byId = Object.fromEntries(
      result.items.map((item) => [item.id, item]),
    );
    expect(byId.s1.isCurrentAttempt).toBe(true);
    expect(byId.s2.isCurrentAttempt).toBe(false);
    expect(byId.s3.isCurrentAttempt).toBe(true);
  });

  it('skips the groupBy query entirely when the page is empty', async () => {
    prisma.shipment.findMany.mockResolvedValue([]);
    prisma.shipment.count.mockResolvedValue(0);

    const result = await service.findAllFlat({});

    expect(prisma.shipment.groupBy).not.toHaveBeenCalled();
    expect(result.items).toEqual([]);
  });
});
