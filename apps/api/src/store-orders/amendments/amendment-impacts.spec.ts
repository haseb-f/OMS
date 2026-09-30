import {
  amendmentImpact,
  lineAllocationBlocked,
  amendmentWindow,
  missingAcknowledgements,
  touchesInvoice,
  touchesShippedContents,
  type AmendmentChangeKinds,
} from './amendment-impacts';

const noChange: AmendmentChangeKinds = {
  items: false,
  amounts: false,
  currency: false,
  paymentType: false,
  fulfillmentMethod: false,
  destination: false,
  customerSwitch: false,
  customerCorrection: false,
  pricing: false,
};

describe('amendment window (spec-1-orders.md 1A)', () => {
  const window = (
    latestShipmentStatus: Parameters<
      typeof amendmentWindow
    >[0]['latestShipmentStatus'],
    fulfillmentCode: string | null = 'READY',
    archived = false,
  ) => amendmentWindow({ archived, fulfillmentCode, latestShipmentStatus });

  it('is open before hand-over', () => {
    expect(window(null)).toBe('OPEN');
    expect(window('LABEL_CREATED')).toBe('OPEN');
    expect(window('NEEDS_RESHIPMENT')).toBe('OPEN');
    expect(window('DELIVERY_FAILED')).toBe('OPEN');
  });

  it('is in transit while shipped / out for delivery', () => {
    expect(window('SHIPPED')).toBe('IN_TRANSIT');
    expect(window('OUT_FOR_DELIVERY')).toBe('IN_TRANSIT');
  });

  it('locks delivered, returned, collected, cancelled and archived orders', () => {
    expect(window('DELIVERED')).toBe('LOCKED');
    expect(window('RETURN_AFTER_DELIVERY')).toBe('LOCKED');
    expect(window(null, 'COLLECTED')).toBe('LOCKED');
    expect(window(null, 'RETURNED')).toBe('LOCKED');
    expect(window(null, 'CANCELLED')).toBe('LOCKED');
    expect(window(null, 'READY', true)).toBe('LOCKED');
  });
});

describe('amendment impacts', () => {
  it('shipped contents are items, address and fulfillment method only', () => {
    expect(touchesShippedContents({ ...noChange, amounts: true })).toBe(false);
    expect(touchesShippedContents({ ...noChange, items: true })).toBe(true);
    expect(touchesShippedContents({ ...noChange, destination: true })).toBe(
      true,
    );
    expect(
      touchesShippedContents({ ...noChange, fulfillmentMethod: true }),
    ).toBe(true);
  });

  it('invoice-relevant changes exclude payment arrangement and destination', () => {
    expect(touchesInvoice({ ...noChange, paymentType: true })).toBe(false);
    expect(touchesInvoice({ ...noChange, destination: true })).toBe(false);
    expect(touchesInvoice({ ...noChange, amounts: true })).toBe(true);
    expect(touchesInvoice({ ...noChange, customerSwitch: true })).toBe(true);
  });

  it('severity comes from the code table; only ACKNOWLEDGE codes need echoing', () => {
    const impacts = [
      amendmentImpact('TOTALS_CHANGED', 'x'),
      amendmentImpact('LABEL_REISSUE_REQUIRED', 'x'),
      amendmentImpact('DECLARATION_REEVALUATED', 'x'),
      amendmentImpact('ORDER_IN_TRANSIT', 'x'),
    ];
    expect(impacts.map((i) => i.severity)).toEqual([
      'INFO',
      'ACKNOWLEDGE',
      'ACKNOWLEDGE',
      'BLOCKING',
    ]);
    expect(
      missingAcknowledgements(impacts, ['LABEL_REISSUE_REQUIRED']),
    ).toEqual(['DECLARATION_REEVALUATED']);
    expect(
      missingAcknowledgements(impacts, [
        'LABEL_REISSUE_REQUIRED',
        'DECLARATION_REEVALUATED',
      ]),
    ).toEqual([]);
  });
});

describe('investment allocation guard (review MEDIUM 7)', () => {
  const guard = (over: Partial<Parameters<typeof lineAllocationBlocked>[0]>) =>
    lineAllocationBlocked({
      removed: false,
      changed: false,
      allocationStatuses: [],
      reallocationStatuses: [],
      ...over,
    });

  it('an ACTIVE allocation blocks any change, including the agreed amount', () => {
    expect(guard({ changed: true, allocationStatuses: ['ACTIVE'] })).toBe(true);
    expect(guard({ changed: false, allocationStatuses: ['ACTIVE'] })).toBe(
      false,
    );
  });

  it('reversed allocations and closed reallocations do not block a change', () => {
    expect(
      guard({
        changed: true,
        allocationStatuses: ['REVERSED'],
        reallocationStatuses: ['COMPLETED', 'REJECTED'],
      }),
    ).toBe(false);
    expect(guard({ changed: true, reallocationStatuses: ['PENDING'] })).toBe(
      true,
    );
  });

  it('removing a line is blocked while any allocation row references it', () => {
    expect(guard({ removed: true, allocationStatuses: ['REVERSED'] })).toBe(
      true,
    );
    expect(guard({ removed: true })).toBe(false);
  });
});
