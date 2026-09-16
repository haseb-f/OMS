import { OrderEconomicsService } from './order-economics.service';

/**
 * ADR-0018 (Order Economics M2) — deterministic coverage for the canonical
 * Revenue/COGS/Gross Profit/Shipping/Contribution formula. Mocks
 * PrismaService at the same `findFirst`-with-`select` boundary the service
 * itself queries, never a real DB.
 */
describe('OrderEconomicsService.getForStoreOrder', () => {
  function makePrisma(storeOrderRow: unknown) {
    return {
      storeOrder: {
        findFirst: jest.fn().mockResolvedValue(storeOrderRow),
      },
    } as never;
  }

  it('computes Gross Profit and Contribution from known data only — never fabricates Packaging/Payment Fee', async () => {
    // The full scenario as specified (Revenue 900, COGS 400, Shipping 65,
    // Packaging 10, Payment Fee 15) would total 410 — but this schema has
    // no data source for Packaging or Payment Fee anywhere (ADR-0018), so
    // this service correctly excludes them rather than inventing zeros.
    // Contribution Profit here is Gross Profit (500) minus only the KNOWN
    // direct cost (Shipping 65) = 435, with costState PARTIAL flagging
    // that Packaging/Payment Fee are still missing — never presented as a
    // clean, final 410.
    const service = new OrderEconomicsService(
      makePrisma({
        id: 'order-1',
        items: [{ productId: 'product-1', quantity: 1, agreedAmount: 900 }],
        invoices: [
          {
            items: [{ productId: 'product-1', unitCost: 400 }],
          },
        ],
        shipments: [
          {
            id: 'shipment-1',
            attemptNumber: 1,
            status: 'DELIVERY_FAILED',
            baseShippingCost: 30,
            additionalShippingCost: null,
          },
          {
            id: 'shipment-2',
            attemptNumber: 2,
            status: 'DELIVERED',
            baseShippingCost: 35,
            additionalShippingCost: null,
          },
        ],
      }),
    );

    const result = await service.getForStoreOrder('order-1');

    expect(result.netRevenue).toBe(900);
    expect(result.cogs).toBe(400);
    expect(result.cogsState).toBe('COMPLETE');
    expect(result.grossProductProfit).toBe(500);
    expect(result.grossMarginPercent).toBeCloseTo((500 / 900) * 100, 6);

    // Both shipment attempts count — a failed attempt's cost is never dropped.
    expect(result.shippingCost).toBe(65);
    expect(result.shippingState).toBe('COMPLETE');

    expect(result.totalDirectCost).toBe(65);
    expect(result.contributionProfit).toBe(435);
    expect(result.contributionMarginPercent).toBeCloseTo((435 / 900) * 100, 6);

    // Packaging/Payment Fee have no data source yet — overall state can
    // never read COMPLETE, per ADR-0018.
    expect(result.packagingState).toBe('UNKNOWN');
    expect(result.paymentFeeState).toBe('UNKNOWN');
    expect(result.costState).toBe('PARTIAL');
  });

  it('sums every shipment attempt, never latest-only', async () => {
    const service = new OrderEconomicsService(
      makePrisma({
        id: 'order-2',
        items: [{ productId: 'product-1', quantity: 1, agreedAmount: 100 }],
        invoices: [],
        shipments: [
          {
            id: 's1',
            attemptNumber: 1,
            status: 'DELIVERY_FAILED',
            baseShippingCost: 30,
            additionalShippingCost: null,
          },
          {
            id: 's2',
            attemptNumber: 2,
            status: 'DELIVERY_FAILED',
            baseShippingCost: 35,
            additionalShippingCost: null,
          },
          {
            id: 's3',
            attemptNumber: 3,
            status: 'DELIVERED',
            baseShippingCost: 40,
            additionalShippingCost: null,
          },
        ],
      }),
    );

    const result = await service.getForStoreOrder('order-2');

    expect(result.shippingCost).toBe(105);
  });

  it('never treats a legacy (pre-cost-snapshot) invoice line as zero COGS — reports UNKNOWN instead', async () => {
    const service = new OrderEconomicsService(
      makePrisma({
        id: 'order-3',
        items: [{ productId: 'product-1', quantity: 2, agreedAmount: 200 }],
        invoices: [{ items: [{ productId: 'product-1', unitCost: null }] }],
        shipments: [],
      }),
    );

    const result = await service.getForStoreOrder('order-3');

    expect(result.cogs).toBe(0);
    expect(result.cogsState).toBe('UNKNOWN');
    expect(result.items[0].cogs).toBeNull();
    // Gross Profit must not be presented as a clean 200 — the caller must
    // read cogsState, not just the number.
    expect(result.grossProductProfit).toBe(200);
    expect(result.shippingState).toBe('UNKNOWN');
    expect(result.costState).toBe('UNKNOWN');
  });

  it('marks cogsState PARTIAL when only some order lines have a historical cost', async () => {
    const service = new OrderEconomicsService(
      makePrisma({
        id: 'order-4',
        items: [
          { productId: 'product-known', quantity: 1, agreedAmount: 100 },
          { productId: 'product-unknown', quantity: 1, agreedAmount: 50 },
        ],
        invoices: [
          {
            items: [
              { productId: 'product-known', unitCost: 40 },
              { productId: 'product-unknown', unitCost: null },
            ],
          },
        ],
        shipments: [],
      }),
    );

    const result = await service.getForStoreOrder('order-4');

    expect(result.cogsState).toBe('PARTIAL');
    expect(result.cogs).toBe(40); // only the known line counted, never fabricated for the unknown one
  });

  it('never divides by zero Net Revenue — margins come back null, not NaN/Infinity', async () => {
    const service = new OrderEconomicsService(
      makePrisma({
        id: 'order-5',
        items: [{ productId: 'product-1', quantity: 1, agreedAmount: 0 }],
        invoices: [{ items: [{ productId: 'product-1', unitCost: 0 }] }],
        shipments: [],
      }),
    );

    const result = await service.getForStoreOrder('order-5');

    expect(result.grossMarginPercent).toBeNull();
    expect(result.contributionMarginPercent).toBeNull();
  });
});
