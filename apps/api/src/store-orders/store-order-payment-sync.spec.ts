import { StoreOrderPaymentStatus } from '@prisma/client';
import { StoreOrderPaymentSyncService } from './store-order-payment-sync.service';

describe('StoreOrderPaymentSyncService — payment/fulfillment separation', () => {
  it('updates payment status only — never touches shippingStage or fulfillment', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      storeOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1',
          shippingStage: 'NOT_READY',
          paymentStatusDef: { code: 'UNPAID' },
          items: [{ quantity: 1, unitPrice: 100, agreedAmount: 100 }],
        }),
        update,
      },
      payment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 100 } }),
      },
    };
    const statusResolver = {
      paymentStatusId: jest.fn().mockReturnValue('pay-status-id'),
      fulfillmentStatusId: jest.fn(),
    };
    const service = new StoreOrderPaymentSyncService(
      prisma as never,
      statusResolver as never,
    );

    await service.recompute('order-1');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: {
        paymentStatus: StoreOrderPaymentStatus.FULLY_PAID_RECONCILED,
        paymentStatusDef: { connect: { id: 'pay-status-id' } },
      },
    });
    const data = update.mock.calls[0][0].data;
    expect(data.shippingStage).toBeUndefined();
    expect(data.fulfillmentStatus).toBeUndefined();
    expect(statusResolver.fulfillmentStatusId).not.toHaveBeenCalled();
  });
});
