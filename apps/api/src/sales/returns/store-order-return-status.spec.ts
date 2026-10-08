import { StoreOrderRecognitionStatus } from '@prisma/client';
import { returnStatusFor } from './store-order-return-status';

/** R15 (D15-10) — RETURN_PENDING resolves to RETURNED / PARTIALLY_RETURNED from posted returns. */
describe('returnStatusFor', () => {
  const invoiced = [
    { id: 'l1', quantity: 2 },
    { id: 'l2', quantity: 1 },
  ];

  it('nothing returned → no change', () => {
    expect(returnStatusFor(invoiced, new Map())).toBeNull();
  });

  it('part of the delivered quantity → PARTIALLY_RETURNED', () => {
    expect(returnStatusFor(invoiced, new Map([['l1', 1]]))).toBe(
      StoreOrderRecognitionStatus.PARTIALLY_RETURNED,
    );
  });

  it('every delivered quantity, across several invoices / lines → RETURNED', () => {
    expect(
      returnStatusFor(
        invoiced,
        new Map([
          ['l1', 2],
          ['l2', 1],
        ]),
      ),
    ).toBe(StoreOrderRecognitionStatus.RETURNED);
  });
});
