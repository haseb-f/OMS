import { FulfillmentCostService } from './fulfillment-cost.service';

/**
 * ADR-0018 (Order Economics M2.2) — the automatic-application path called
 * from `StoreOrdersService.generateInvoice()`. Mocks the transaction client
 * at the same `storeOrderFulfillmentCost`/`directFulfillmentCostRule`
 * boundary the service itself queries, never a real DB.
 */
describe('FulfillmentCostService.applyStandardCost', () => {
  function makeTx(overrides: { existing?: unknown; rule?: unknown }) {
    return {
      storeOrderFulfillmentCost: {
        findUnique: jest.fn().mockResolvedValue(overrides.existing ?? null),
        create: jest.fn().mockResolvedValue({}),
      },
      directFulfillmentCostRule: {
        findFirst: jest.fn().mockResolvedValue(overrides.rule ?? null),
      },
    } as never;
  }

  it('creates an immutable snapshot copying the active rule amount/name at application time', async () => {
    const tx = makeTx({
      rule: { id: 'rule-1', name: 'Standard Fulfillment', costAmount: 10 },
    });
    const service = new FulfillmentCostService({} as never);

    await service.applyStandardCost('order-1', tx, 'user-1');

    expect(
      (tx as unknown as { storeOrderFulfillmentCost: { create: jest.Mock } })
        .storeOrderFulfillmentCost.create,
    ).toHaveBeenCalledWith({
      data: {
        storeOrderId: 'order-1',
        ruleId: 'rule-1',
        ruleName: 'Standard Fulfillment',
        amount: 10,
        source: 'STANDARD',
        createdBy: 'user-1',
      },
    });
  });

  it('is idempotent — skips silently when a snapshot already exists for the Order', async () => {
    const tx = makeTx({
      existing: { id: 'snapshot-1' },
      rule: { id: 'rule-1', name: 'Standard Fulfillment', costAmount: 10 },
    });
    const service = new FulfillmentCostService({} as never);

    await service.applyStandardCost('order-1', tx, 'user-1');

    expect(
      (tx as unknown as { directFulfillmentCostRule: { findFirst: jest.Mock } })
        .directFulfillmentCostRule.findFirst,
    ).not.toHaveBeenCalled();
    expect(
      (tx as unknown as { storeOrderFulfillmentCost: { create: jest.Mock } })
        .storeOrderFulfillmentCost.create,
    ).not.toHaveBeenCalled();
  });

  it('writes nothing when no active rule exists — never fabricates a zero-cost snapshot', async () => {
    const tx = makeTx({ rule: null });
    const service = new FulfillmentCostService({} as never);

    await service.applyStandardCost('order-1', tx, 'user-1');

    expect(
      (tx as unknown as { storeOrderFulfillmentCost: { create: jest.Mock } })
        .storeOrderFulfillmentCost.create,
    ).not.toHaveBeenCalled();
  });
});
