import {
  DEFAULT_SHIPPING_STATUS_CODE,
  DEFAULT_SHIPPING_STATUS_LABEL,
  INITIAL_SHIPPING_STATUSES,
  isOperationalShipmentStatus,
  isShippingStatusColor,
  matchShippingStatusRecord,
} from './shipping-status.catalog';

describe('shipping-status catalog helpers', () => {
  it('seeds جاهز للشحن as the protected default system status', () => {
    expect(INITIAL_SHIPPING_STATUSES[0]?.isDefault).toBe(true);
    expect(INITIAL_SHIPPING_STATUSES[0]?.isSystem).toBe(true);
    expect(INITIAL_SHIPPING_STATUSES[0]?.code).toBe(
      DEFAULT_SHIPPING_STATUS_CODE,
    );
    expect(DEFAULT_SHIPPING_STATUS_LABEL).toBe('جاهز للشحن');
  });

  it('matches importable records by code or Arabic label and rejects the default', () => {
    const records = INITIAL_SHIPPING_STATUSES.map((status) => ({
      code: status.code,
      name: status.name,
      isImportable: status.isImportable,
    }));
    expect(matchShippingStatusRecord(records, 'SHIPPED', true)?.code).toBe(
      'SHIPPED',
    );
    expect(matchShippingStatusRecord(records, 'shipped', true)?.code).toBe(
      'SHIPPED',
    );
    expect(matchShippingStatusRecord(records, 'تم الشحن', true)?.code).toBe(
      'SHIPPED',
    );
    expect(matchShippingStatusRecord(records, 'جاهز للشحن', true)).toBeNull();
    expect(matchShippingStatusRecord(records, 'UNKNOWN', true)).toBeNull();
  });

  it('accepts only closed StatusTone color tokens', () => {
    expect(isShippingStatusColor('info')).toBe(true);
    expect(isShippingStatusColor('#ff00aa')).toBe(false);
  });

  it('treats seeded operational codes as shipment state-machine values', () => {
    expect(isOperationalShipmentStatus('SHIPPED')).toBe(true);
    expect(isOperationalShipmentStatus('READY_FOR_SHIPPING')).toBe(false);
  });
});
