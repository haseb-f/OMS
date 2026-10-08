import { evaluateShippingReadiness } from './shipping-handoff';
import { statusQueueFilter } from './store-order-shipments.service';

const base = {
  deletedAt: null,
  fulfillmentMethod: 'SHIPPING' as const,
  shippingStage: 'READY_FOR_SHIPPING' as const,
  fulfillmentStatus: { code: 'READY', isFinal: false },
};

describe('evaluateShippingReadiness (R6 SHIP)', () => {
  it('COD shipping order is eligible', () => {
    expect(evaluateShippingReadiness(base)).toEqual({
      eligible: true,
      blocker: null,
      reason: null,
    });
  });

  it('R15 (D15-3): payment never gates the queue — an unpaid / partially declared prepaid order is eligible', () => {
    const unpaidPrepaid = {
      ...base,
      paymentType: 'PREPAID' as const,
      paymentStatus: 'PAYMENT_PENDING' as const,
      declaredPaymentStatus: 'PARTIALLY_PAID' as const,
    };
    expect(evaluateShippingReadiness(unpaidPrepaid)).toEqual({
      eligible: true,
      blocker: null,
      reason: null,
    });
  });

  it('archived, cancelled, pickup and digital-only orders are never queued', () => {
    expect(
      evaluateShippingReadiness({ ...base, deletedAt: new Date() }).blocker,
    ).toBe('ORDER_ARCHIVED');
    expect(
      evaluateShippingReadiness({
        ...base,
        fulfillmentStatus: { code: 'CANCELLED' },
      }).blocker,
    ).toBe('ORDER_CANCELLED');
    expect(
      evaluateShippingReadiness({
        ...base,
        fulfillmentStatus: { code: 'DELIVERED', isFinal: true },
      }).blocker,
    ).toBe('ORDER_CLOSED');
    expect(
      evaluateShippingReadiness({ ...base, fulfillmentMethod: 'PICKUP' })
        .blocker,
    ).toBe('PICKUP');
    expect(
      evaluateShippingReadiness({ ...base, shippingStage: 'NOT_READY' })
        .blocker,
    ).toBe('NOT_SHIPPABLE');
  });
});

describe('statusQueueFilter (R6 SHIP)', () => {
  it('no filter → no condition', () => {
    expect(statusQueueFilter(undefined)).toEqual({});
    expect(statusQueueFilter([])).toEqual({});
  });

  it('READY_FOR_SHIPPING maps to "no carrier status" (default catalog status only)', () => {
    expect(statusQueueFilter(['READY_FOR_SHIPPING'])).toEqual({
      status: null,
      OR: [
        { shippingStatusId: null },
        { shippingStatus: { code: 'READY_FOR_SHIPPING' } },
      ],
    });
  });

  it('mixes READY with enum statuses as an OR', () => {
    expect(statusQueueFilter(['READY_FOR_SHIPPING', 'SHIPPED'])).toEqual({
      OR: [
        { status: { in: ['SHIPPED'] } },
        {
          status: null,
          OR: [
            { shippingStatusId: null },
            { shippingStatus: { code: 'READY_FOR_SHIPPING' } },
          ],
        },
      ],
    });
    expect(statusQueueFilter('DELIVERED')).toEqual({
      status: { in: ['DELIVERED'] },
    });
  });
});
