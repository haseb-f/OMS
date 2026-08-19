import {
  DEFAULT_SHIPPING_STATUS_LABEL,
  SHIPPING_STATUS_CATALOG,
  resolveImportableShippingStatus,
} from './shipping-status.catalog';

describe('resolveImportableShippingStatus', () => {
  it('accepts enum codes and canonical Arabic labels', () => {
    expect(resolveImportableShippingStatus('SHIPPED')).toBe('SHIPPED');
    expect(resolveImportableShippingStatus('shipped')).toBe('SHIPPED');
    expect(resolveImportableShippingStatus('تم الشحن')).toBe('SHIPPED');
    expect(resolveImportableShippingStatus('جاهز للشحن')).toBeNull();
    expect(resolveImportableShippingStatus('UNKNOWN')).toBeNull();
  });

  it('seeds جاهز للشحن as the default system status', () => {
    expect(SHIPPING_STATUS_CATALOG[0]?.isDefault).toBe(true);
    expect(DEFAULT_SHIPPING_STATUS_LABEL).toBe('جاهز للشحن');
  });
});
