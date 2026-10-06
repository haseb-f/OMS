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
      {} as never,
      orderEconomicsService as never,
      {} as never,
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

/**
 * Bulk selection review (HIGH) — "select all matching" must select exactly
 * the set the list shows. Under a Cost State / Loss-Making filter the ids
 * come from the same bounded profitability filter as `findAll`, never the
 * unfiltered scoped set.
 */
describe('StoreOrdersService.findAllIds — profitability filters', () => {
  const economics = new Map([
    ['loss-1', { contributionProfit: -10, costState: 'COMPLETE' }],
    ['profit-1', { contributionProfit: 25, costState: 'COMPLETE' }],
    ['loss-2', { contributionProfit: -1, costState: 'PARTIAL' }],
  ]);

  function makeService(candidateIds: string[]) {
    const prisma = {
      storeOrder: {
        findMany: jest.fn().mockResolvedValue(
          candidateIds.map((id) => ({
            id,
            shippingStage: 'NOT_READY',
            items: [],
            shipments: [],
            payments: [],
          })),
        ),
        count: jest.fn().mockResolvedValue(candidateIds.length),
      },
    };
    const orderEconomicsService = {
      getSummaryForOrders: jest.fn().mockResolvedValue(economics),
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
      {} as never,
      orderEconomicsService as never,
      {} as never,
    );
    return { service, prisma, orderEconomicsService };
  }

  const candidates = ['loss-1', 'profit-1', 'loss-2'];

  it('applies lossMaking exactly like findAll: only loss-making ids, total = filtered count', async () => {
    const { service } = makeService(candidates);

    const ids = await service.findAllIds({ lossMaking: true }, undefined, true);
    const list = await service.findAll(
      { lossMaking: true, page: 1, pageSize: 20 },
      undefined,
      true,
    );

    expect(ids).toEqual({
      ids: ['loss-1', 'loss-2'],
      total: 2,
      profitabilityFilterCapped: false,
    });
    expect(list.total).toBe(ids.total);
  });

  it('applies costState and honours limit (first N of the filtered set)', async () => {
    const { service } = makeService(candidates);

    const result = await service.findAllIds(
      { costState: ['COMPLETE'], limit: 1 },
      undefined,
      true,
    );

    expect(result.ids).toEqual(['loss-1']);
    expect(result.total).toBe(2);
  });

  it('ignores profitability params for a caller without the permission (same as findAll)', async () => {
    const { service, orderEconomicsService } = makeService(candidates);

    const result = await service.findAllIds(
      { lossMaking: true },
      undefined,
      false,
    );

    expect(orderEconomicsService.getSummaryForOrders).not.toHaveBeenCalled();
    expect(result).toEqual({ ids: candidates, total: 3 });
  });
});
