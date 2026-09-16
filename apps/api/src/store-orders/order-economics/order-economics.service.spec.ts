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

  it('computes Gross Profit and Contribution from every known direct-cost source (M2.2 full acceptance scenario)', async () => {
    // Revenue 900, COGS 400, Shipping 65, Fulfillment (Packaging) 10,
    // Payment Fee 15 -> Contribution Profit 410, with every component now a
    // real data source (ADR-0018 M2.2) so costState reads COMPLETE, not the
    // permanently-PARTIAL result M2 alone could produce.
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
            carrierCharges: [],
          },
          {
            id: 'shipment-2',
            attemptNumber: 2,
            status: 'DELIVERED',
            baseShippingCost: 35,
            additionalShippingCost: null,
            carrierCharges: [],
          },
        ],
        payments: [
          {
            id: 'payment-1',
            amount: 900,
            actualFeeAmount: 15,
            paymentSource: { feePercentage: null, feeFixedAmount: null },
          },
        ],
        fulfillmentCost: {
          amount: 10,
          source: 'STANDARD',
          ruleName: 'Standard Fulfillment',
        },
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
    expect(result.shippingAttempts[0].costSource).toBe('ACTUAL');
    expect(result.shippingAttempts[0].confirmedCarrierCost).toBeNull();

    // ACTUAL fee always wins over an ESTIMATED one, even when both exist.
    expect(result.paymentFeeCost).toBe(15);
    expect(result.paymentFeeState).toBe('COMPLETE');
    expect(result.payments[0].feeSource).toBe('ACTUAL');

    // The immutable snapshot amount, never re-derived from the live rule.
    expect(result.fulfillmentCost).toBe(10);
    expect(result.fulfillmentCostState).toBe('COMPLETE');
    expect(result.fulfillmentCostSource).toBe('STANDARD');

    expect(result.totalDirectCost).toBe(90);
    expect(result.contributionProfit).toBe(410);
    expect(result.contributionMarginPercent).toBeCloseTo((410 / 900) * 100, 6);
    expect(result.costState).toBe('COMPLETE');
  });

  it('falls back to the ESTIMATED fee (PaymentSource percentage + fixed) when no ACTUAL fee is recorded', async () => {
    const service = new OrderEconomicsService(
      makePrisma({
        id: 'order-fee-estimate',
        items: [{ productId: 'product-1', quantity: 1, agreedAmount: 1000 }],
        invoices: [],
        shipments: [],
        payments: [
          {
            id: 'payment-1',
            amount: 1000,
            actualFeeAmount: null,
            paymentSource: { feePercentage: 2, feeFixedAmount: 1 },
          },
        ],
        fulfillmentCost: null,
      }),
    );

    const result = await service.getForStoreOrder('order-fee-estimate');

    // 1000 * 2% + 1 = 21
    expect(result.paymentFeeCost).toBe(21);
    expect(result.paymentFeeState).toBe('COMPLETE');
    expect(result.payments[0].feeSource).toBe('ESTIMATED');
  });

  it('reports paymentFeeState UNKNOWN when a payment has neither an actual fee nor a PaymentSource estimate', async () => {
    const service = new OrderEconomicsService(
      makePrisma({
        id: 'order-fee-unknown',
        items: [{ productId: 'product-1', quantity: 1, agreedAmount: 500 }],
        invoices: [],
        shipments: [],
        payments: [
          {
            id: 'payment-1',
            amount: 500,
            actualFeeAmount: null,
            paymentSource: { feePercentage: null, feeFixedAmount: null },
          },
        ],
        fulfillmentCost: null,
      }),
    );

    const result = await service.getForStoreOrder('order-fee-unknown');

    expect(result.paymentFeeCost).toBe(0);
    expect(result.paymentFeeState).toBe('UNKNOWN');
    expect(result.payments[0].feeAmount).toBeNull();
    // An UNKNOWN component is never added as 0 into the direct-cost total.
    expect(result.totalDirectCost).toBe(0);
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
            carrierCharges: [],
          },
          {
            id: 's2',
            attemptNumber: 2,
            status: 'DELIVERY_FAILED',
            baseShippingCost: 35,
            additionalShippingCost: null,
            carrierCharges: [],
          },
          {
            id: 's3',
            attemptNumber: 3,
            status: 'DELIVERED',
            baseShippingCost: 40,
            additionalShippingCost: null,
            carrierCharges: [],
          },
        ],
        payments: [],
        fulfillmentCost: null,
      }),
    );

    const result = await service.getForStoreOrder('order-2');

    expect(result.shippingCost).toBe(105);
  });

  it('CONFIRMED carrier charge replaces the operational shipping cost, never sums with it (ADR-0018 M2 gap closure)', async () => {
    // Attempt 1: operational estimate 28, CONFIRMED carrier actual 30 ->
    // must use 30, never 58. Attempt 2: no carrier charge yet -> operational
    // 35 stands. Total shipping = 30 + 35 = 65.
    const service = new OrderEconomicsService(
      makePrisma({
        id: 'order-carrier',
        items: [{ productId: 'product-1', quantity: 1, agreedAmount: 500 }],
        invoices: [],
        shipments: [
          {
            id: 'shipment-1',
            attemptNumber: 1,
            status: 'DELIVERED',
            baseShippingCost: 28,
            additionalShippingCost: null,
            carrierCharges: [{ chargeAmount: 30 }],
          },
          {
            id: 'shipment-2',
            attemptNumber: 2,
            status: 'DELIVERED',
            baseShippingCost: 35,
            additionalShippingCost: null,
            carrierCharges: [],
          },
        ],
        payments: [],
        fulfillmentCost: null,
      }),
    );

    const result = await service.getForStoreOrder('order-carrier');

    expect(result.shippingCost).toBe(65);
    expect(result.shippingAttempts[0].operationalCost).toBe(28);
    expect(result.shippingAttempts[0].confirmedCarrierCost).toBe(30);
    expect(result.shippingAttempts[0].totalCost).toBe(30);
    expect(result.shippingAttempts[0].costVariance).toBe(2);
    expect(result.shippingAttempts[0].costSource).toBe('CONFIRMED_ACTUAL');
    expect(result.shippingAttempts[1].costSource).toBe('ACTUAL');
    expect(result.shippingAttempts[1].totalCost).toBe(35);
  });

  it('never treats a legacy (pre-cost-snapshot) invoice line as zero COGS — reports UNKNOWN instead', async () => {
    const service = new OrderEconomicsService(
      makePrisma({
        id: 'order-3',
        items: [{ productId: 'product-1', quantity: 2, agreedAmount: 200 }],
        invoices: [{ items: [{ productId: 'product-1', unitCost: null }] }],
        shipments: [],
        payments: [],
        fulfillmentCost: null,
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
        payments: [],
        fulfillmentCost: null,
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
        payments: [],
        fulfillmentCost: null,
      }),
    );

    const result = await service.getForStoreOrder('order-5');

    expect(result.grossMarginPercent).toBeNull();
    expect(result.contributionMarginPercent).toBeNull();
  });
});
