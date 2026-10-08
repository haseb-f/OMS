import { planStoreOrderRefund } from './store-order-refunds.service';

/**
 * R15 (D15-11) — "Record refund" splits the amount over the order's credit
 * notes first (oldest first, each refunded against itself), then its
 * advance; an amount that does not fit is refused (null).
 */
describe('planStoreOrderRefund', () => {
  const credit = (id: string, unrefunded: number) => ({
    salesReturnId: id,
    returnNumber: `SR-${id}`,
    createdAt: new Date('2026-10-01'),
    grandTotal: unrefunded,
    refunded: 0,
    unrefunded,
  });

  it('refunds credit notes oldest first, then the advance', () => {
    expect(
      planStoreOrderRefund(
        {
          storeOrderId: 'so-1',
          returnCredits: [credit('a', 30), credit('b', 20)],
          advanceRefundable: 50,
        },
        70,
      ),
    ).toEqual([
      {
        salesReturnId: 'a',
        returnNumber: 'SR-a',
        storeOrderId: null,
        amount: 30,
      },
      {
        salesReturnId: 'b',
        returnNumber: 'SR-b',
        storeOrderId: null,
        amount: 20,
      },
      {
        salesReturnId: null,
        returnNumber: null,
        storeOrderId: 'so-1',
        amount: 20,
      },
    ]);
  });

  it('refuses more than the credit notes and the advance hold', () => {
    expect(
      planStoreOrderRefund(
        {
          storeOrderId: 'so-1',
          returnCredits: [credit('a', 30)],
          advanceRefundable: 0,
        },
        30.01,
      ),
    ).toBeNull();
  });
});
