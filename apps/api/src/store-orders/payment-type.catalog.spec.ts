import { StoreOrderPaymentType } from '@prisma/client';
import {
  PAYMENT_TYPE_CATALOG,
  resolvePaymentType,
} from './payment-type.catalog';

describe('resolvePaymentType', () => {
  it('accepts the two fixed codes and Arabic List Sheet labels', () => {
    expect(resolvePaymentType('PREPAID')).toBe(StoreOrderPaymentType.PREPAID);
    expect(resolvePaymentType('دفع مسبق')).toBe(StoreOrderPaymentType.PREPAID);
    expect(resolvePaymentType('CASH_ON_DELIVERY')).toBe(
      StoreOrderPaymentType.CASH_ON_DELIVERY,
    );
    expect(resolvePaymentType('الدفع عند الاستلام')).toBe(
      StoreOrderPaymentType.CASH_ON_DELIVERY,
    );
  });

  it('rejects arbitrary values — Payment Type is a closed catalog', () => {
    expect(resolvePaymentType('CARD')).toBeNull();
    expect(resolvePaymentType('INSTALMENT')).toBeNull();
    expect(resolvePaymentType('')).toBeNull();
  });

  it('is not financial confirmation — only two expected-collection modes exist', () => {
    expect(PAYMENT_TYPE_CATALOG).toHaveLength(2);
    expect(PAYMENT_TYPE_CATALOG.map((type) => type.code)).toEqual([
      StoreOrderPaymentType.PREPAID,
      StoreOrderPaymentType.CASH_ON_DELIVERY,
    ]);
  });
});
