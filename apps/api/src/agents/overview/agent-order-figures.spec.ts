import {
  agentOrderFigures,
  emptyLeadCounts,
  sumLeadCounts,
  teamBreakdown,
  type AgentOrderFiguresRow,
  type LeadCounts,
} from './agent-order-figures';

const SAR = 'cur-sar';

let seq = 0;
function order(
  patch: Partial<{
    employeeId: string | null;
    code: string | null;
    currencyId: string;
    payableTotal: number | null;
    merchandiseAmount: number | null;
    shippingCharge: number | null;
    dispatched: boolean;
    earned: boolean;
    returns: number;
    lines: Array<{ quantity: number; unitPrice: number }>;
  }> = {},
): AgentOrderFiguresRow {
  seq += 1;
  return {
    agentId: 'agent-1',
    employeeId: patch.employeeId === undefined ? 'u1' : patch.employeeId,
    agentDispatchedAt: patch.dispatched ? new Date() : null,
    agentEarnedAt: patch.earned ? new Date() : null,
    currencyId: patch.currencyId ?? SAR,
    merchandiseAmount: (patch.merchandiseAmount ?? null) as never,
    payableTotal: (patch.payableTotal ?? null) as never,
    shippingCharge: (patch.shippingCharge ?? null) as never,
    agentTermsSnapshot: null,
    fulfillmentStatus:
      patch.code === null ? null : { code: patch.code ?? 'NEW' },
    items: (patch.lines ?? [{ quantity: 1, unitPrice: 100 }]).map((line) => ({
      quantity: line.quantity,
      unitPrice: line.unitPrice as never,
      agreedAmount: null as never,
      productId: `p-${seq}`,
      product: { isInventoryItem: true, supplyMethod: 'PURCHASED' as never },
    })),
    _count: { agentReturns: patch.returns ?? 0 },
  };
}

describe('agent order figures (R15 W1)', () => {
  it('sums money in the agent currency only, never across currencies, and skips cancelled orders', () => {
    const figures = agentOrderFigures(
      [
        order({
          payableTotal: 1100,
          merchandiseAmount: 1000,
          shippingCharge: 100,
        }),
        order({ payableTotal: 0.1, merchandiseAmount: 0.1 }),
        order({ payableTotal: 0.2, merchandiseAmount: 0.2 }),
        order({ payableTotal: 999, currencyId: 'cur-usd' }),
        order({ payableTotal: 500, code: 'CANCELLED' }),
      ],
      SAR,
    );
    expect(figures.sales).toEqual({
      merchandiseSalesExShipping: 1000.3,
      customerShippingCharges: 100,
      totalOrderValue: 1100.3,
    });
    expect(figures.fulfillment.total).toBe(5);
    expect(figures.fulfillment.cancelled).toBe(1);
  });

  it('falls back to Σ lines for orders without a stored breakdown', () => {
    const figures = agentOrderFigures(
      [
        order({
          lines: [
            { quantity: 2, unitPrice: 50 },
            { quantity: 1, unitPrice: 25 },
          ],
        }),
      ],
      SAR,
    );
    expect(figures.sales.merchandiseSalesExShipping).toBe(125);
    expect(figures.sales.totalOrderValue).toBe(125);
  });

  it('counts delivered (DELIVERED / COLLECTED) value and the returns of live orders', () => {
    const figures = agentOrderFigures(
      [
        order({
          payableTotal: 300,
          code: 'DELIVERED',
          dispatched: true,
          earned: true,
        }),
        order({
          payableTotal: 200,
          code: 'COLLECTED',
          dispatched: true,
          earned: true,
          returns: 2,
        }),
        order({ payableTotal: 100, code: 'SHIPPED', dispatched: true }),
        order({ payableTotal: 50, code: 'CANCELLED', returns: 5 }),
      ],
      SAR,
    );
    expect(figures.delivered).toEqual({ count: 2, value: 500 });
    expect(figures.returnCount).toBe(2);
    expect(figures.fulfillment).toMatchObject({
      awaitingDispatch: 0,
      dispatched: 1,
      completed: 2,
      withReturns: 1,
      cancelled: 1,
    });
  });

  it('sums lead counts', () => {
    expect(
      sumLeadCounts([
        { total: 3, fresh: 1, converted: 1 },
        { total: 2, fresh: 2, converted: 0 },
      ]),
    ).toEqual({ total: 5, fresh: 3, converted: 1 });
    expect(sumLeadCounts([])).toEqual(emptyLeadCounts());
  });

  describe('team breakdown', () => {
    const members = [
      { id: 'u1', fullName: 'Amal', isActive: true },
      { id: 'u2', fullName: 'Badr', isActive: false },
    ];
    const orders = [
      order({
        employeeId: 'u1',
        payableTotal: 400,
        code: 'DELIVERED',
        earned: true,
      }),
      order({ employeeId: 'u1', payableTotal: 100 }),
      order({ employeeId: 'u2', payableTotal: 250, returns: 1 }),
    ];
    const leads = new Map<string | null, LeadCounts>([
      ['u1', { total: 4, fresh: 1, converted: 2 }],
      [null, { total: 1, fresh: 1, converted: 0 }],
    ]);

    it('gives every member their own orders, leads and money', () => {
      const rows = teamBreakdown(members, orders, leads, SAR, { money: true });
      expect(rows.map((row) => row.user?.id ?? null)).toEqual([
        'u1',
        'u2',
        null,
      ]);
      expect(rows[0]).toMatchObject({
        fulfillment: { total: 2 },
        leads: { total: 4, fresh: 1, converted: 2 },
        sales: { orderValue: 500, deliveredValue: 400, deliveredCount: 1 },
      });
      expect(rows[1]).toMatchObject({
        fulfillment: { total: 1 },
        returnCount: 1,
        leads: emptyLeadCounts(),
        sales: { orderValue: 250, deliveredValue: 0 },
      });
      // Unassigned leads are listed, never silently dropped.
      expect(rows[2]).toMatchObject({
        fulfillment: { total: 0 },
        leads: { total: 1 },
      });
    });

    it('leaves the money out without the money right (absent, not zero)', () => {
      const rows = teamBreakdown(members, orders, new Map(), SAR, {
        money: false,
      });
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row).not.toHaveProperty('sales');
    });

    it('leaves the lead counts out for a viewer without lead visibility (R15 review L4)', () => {
      const rows = teamBreakdown(members, orders, leads, SAR, {
        money: true,
        leads: false,
      });
      for (const row of rows) expect(row).not.toHaveProperty('leads');
    });
  });
});
