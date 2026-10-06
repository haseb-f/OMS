import {
  agentFulfillmentFacts,
  aggregateAgentFulfillment,
  isAgentOrderDigitalOnly,
} from './agent-terms';

const at = new Date('2026-09-20T00:00:00.000Z');
const tracked = { isInventoryItem: true, supplyMethod: 'PURCHASED' as const };
const untracked = {
  isInventoryItem: false,
  supplyMethod: 'PURCHASED' as const,
};
const kit = { isInventoryItem: false, supplyMethod: 'KIT' as const };

const order = (
  over: Partial<Parameters<typeof agentFulfillmentFacts>[0]> = {},
): Parameters<typeof agentFulfillmentFacts>[0] => ({
  agentDispatchedAt: null,
  agentEarnedAt: null,
  agentTermsSnapshot: {
    agreementId: 'a',
    lines: [{ productId: 'phys', inventoryLine: true }],
  },
  fulfillmentStatus: { code: 'NEW' },
  items: [{ productId: 'phys', product: tracked }],
  _count: { agentReturns: 0 },
  ...over,
});

const digital = (
  over: Partial<Parameters<typeof agentFulfillmentFacts>[0]> = {},
) =>
  order({
    agentTermsSnapshot: {
      agreementId: 'a',
      lines: [{ productId: 'course', inventoryLine: false }],
    },
    items: [{ productId: 'course', product: untracked }],
    ...over,
  });

describe('isAgentOrderDigitalOnly', () => {
  it('reads the frozen per-line stock flag first', () => {
    // Product became an inventory item after the order: the snapshot wins.
    expect(
      isAgentOrderDigitalOnly({
        agentTermsSnapshot: {
          lines: [{ productId: 'p', inventoryLine: false }],
        },
        items: [{ productId: 'p', product: tracked }],
      }),
    ).toBe(true);
  });

  it('falls back to the live product flag without a line snapshot', () => {
    expect(
      isAgentOrderDigitalOnly({
        agentTermsSnapshot: { agreementId: 'a' },
        items: [{ productId: 'p', product: untracked }],
      }),
    ).toBe(true);
    expect(
      isAgentOrderDigitalOnly({
        agentTermsSnapshot: null,
        items: [
          { productId: 'p', product: untracked },
          { productId: 'q', product: tracked },
        ],
      }),
    ).toBe(false);
  });
});

describe('isAgentOrderDigitalOnly — kits (R13)', () => {
  it('a kit-only order frozen as stock-moving is not digital-only', () => {
    expect(
      isAgentOrderDigitalOnly({
        agentTermsSnapshot: {
          lines: [{ productId: 'k', inventoryLine: true }],
        },
        items: [{ productId: 'k', product: kit }],
      }),
    ).toBe(false);
  });

  it('without a line snapshot a live kit counts as stock-moving', () => {
    expect(
      isAgentOrderDigitalOnly({
        agentTermsSnapshot: { agreementId: 'a' },
        items: [{ productId: 'k', product: kit }],
      }),
    ).toBe(false);
  });

  it('a historical frozen flag is never re-read from the live product', () => {
    expect(
      isAgentOrderDigitalOnly({
        agentTermsSnapshot: {
          lines: [{ productId: 'k', inventoryLine: false }],
        },
        items: [{ productId: 'k', product: kit }],
      }),
    ).toBe(true);
  });
});

describe('aggregateAgentFulfillment', () => {
  it('digital orders are completed once earned and never awaiting shipment', () => {
    const counts = aggregateAgentFulfillment(
      [
        digital(), // not yet verified/earned
        digital({ agentEarnedAt: at }), // verified → earned
        order(), // physical, waiting
        order({ agentDispatchedAt: at }), // physical, shipped
        order({ agentDispatchedAt: at, agentEarnedAt: at }), // delivered
        order({ fulfillmentStatus: { code: 'CANCELLED' } }),
        digital({ fulfillmentStatus: { code: 'CANCELLED' } }),
      ].map(agentFulfillmentFacts),
    );
    expect(counts).toEqual({
      total: 7,
      awaitingDispatch: 1,
      dispatched: 1,
      completed: 2,
      withReturns: 0,
      cancelled: 2,
    });
  });

  it('counts orders with returns among active orders only', () => {
    const counts = aggregateAgentFulfillment(
      [
        order({
          agentDispatchedAt: at,
          agentEarnedAt: at,
          _count: { agentReturns: 1 },
        }),
        order({
          fulfillmentStatus: { code: 'CANCELLED' },
          _count: { agentReturns: 2 },
        }),
      ].map(agentFulfillmentFacts),
    );
    expect(counts.withReturns).toBe(1);
    expect(counts.completed).toBe(1);
  });
});
