import { StoreOrdersService } from './store-orders.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * ADR-0018 (Order Economics M2 gap closure, Part 15-18) — the Orders list's
 * profitability columns must cost exactly one extra query per page, never
 * one per row (N+1), and must never appear at all unless the caller
 * explicitly opts in (`StoreOrdersController` already gates that opt-in by
 * `orders.profitability.view` before it ever reaches this service).
 */
describe('StoreOrdersService.findAll — profitability summary', () => {
  const orderRow = {
    id: 'order-1',
    shippingStage: 'NOT_READY',
    items: [{ quantity: 1, unitPrice: 100, agreedAmount: 100 }],
    shipments: [],
    payments: [],
  };

  function makeService() {
    const prisma = {
      storeOrder: {
        findMany: jest.fn().mockResolvedValue([orderRow]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const orderEconomicsService = {
      getSummaryForOrders: jest.fn().mockResolvedValue(
        new Map([
          [
            'order-1',
            {
              storeOrderId: 'order-1',
              contributionProfit: 42,
              costState: 'COMPLETE',
            },
          ],
        ]),
      ),
    };
    const service = new StoreOrdersService(
      prisma as unknown as PrismaService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      orderEconomicsService as never,
    );
    return { service, prisma, orderEconomicsService };
  }

  it('never calls getSummaryForOrders when includeProfitability is false', async () => {
    const { service, orderEconomicsService } = makeService();

    const result = await service.findAll({}, undefined, false);

    expect(orderEconomicsService.getSummaryForOrders).not.toHaveBeenCalled();
    expect(result.items[0]).not.toHaveProperty('profitability');
  });

  it('calls getSummaryForOrders exactly once per page when includeProfitability is true — never per row', async () => {
    const { service, orderEconomicsService } = makeService();

    const result = await service.findAll({}, undefined, true);

    expect(orderEconomicsService.getSummaryForOrders).toHaveBeenCalledTimes(1);
    expect(orderEconomicsService.getSummaryForOrders).toHaveBeenCalledWith([
      'order-1',
    ]);
    expect(result.items[0]).toMatchObject({
      profitability: { contributionProfit: 42, costState: 'COMPLETE' },
    });
  });
});
