import { StoreOrderPaymentStatus } from '@prisma/client';
import { StoreOrderPaymentSyncService } from './store-order-payment-sync.service';

/** A prisma double whose `$transaction` runs the callback on a tx double. */
function setup(order: { shippingStage: string; paymentType: string }) {
  const update = jest.fn().mockResolvedValue({});
  const handoffOrder = {
    id: 'order-1',
    internalOrderId: 'STO-1',
    deletedAt: null,
    fulfillmentMethod: 'SHIPPING',
    shippingStage: order.shippingStage,
    paymentType: order.paymentType,
    // What the update above just wrote (verified in full).
    paymentStatus: StoreOrderPaymentStatus.FULLY_PAID_RECONCILED,
    declaredPaymentStatus: 'UNPAID',
    paymentStatusDef: { code: 'PAID' },
    fulfillmentStatus: { code: 'READY', isFinal: false },
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    storeOrder: { findUnique: jest.fn().mockResolvedValue(handoffOrder) },
    shipment: {
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation(({ data }: { data: object }) => ({
        id: 'shipment-1',
        ...data,
      })),
      updateMany: jest.fn(),
    },
    storeOrderActivity: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    storeOrder: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'order-1',
        shippingStage: order.shippingStage,
        paymentStatusDef: { code: 'UNPAID' },
        items: [{ quantity: 1, unitPrice: 100, agreedAmount: 100 }],
      }),
      update,
    },
    payment: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 100 } }),
    },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const statusResolver = {
    paymentStatusId: jest.fn().mockReturnValue('pay-status-id'),
    fulfillmentStatusId: jest.fn(),
  };
  const service = new StoreOrderPaymentSyncService(
    prisma as never,
    statusResolver as never,
  );
  return { service, update, tx, statusResolver };
}

describe('StoreOrderPaymentSyncService — payment/fulfillment separation', () => {
  it('updates payment status only — never touches shippingStage or fulfillment', async () => {
    const { service, update, tx, statusResolver } = setup({
      shippingStage: 'NOT_READY',
      paymentType: 'PREPAID',
    });

    await service.recompute('order-1');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: {
        paymentStatus: StoreOrderPaymentStatus.FULLY_PAID_RECONCILED,
        paymentStatusDef: { connect: { id: 'pay-status-id' } },
      },
    });
    const [[{ data }]] = update.mock.calls as unknown as [
      [{ data: Record<string, unknown> }],
    ];
    expect(data.shippingStage).toBeUndefined();
    expect(data.fulfillmentStatus).toBeUndefined();
    expect(statusResolver.fulfillmentStatusId).not.toHaveBeenCalled();
    // Not Ready for Shipping (digital-only / pickup): never queued.
    expect(tx.shipment.create).not.toHaveBeenCalled();
  });

  it('R6 SHIP — verified PAID puts a Ready prepaid order in the Shipping queue (attempt #1, no carrier status)', async () => {
    const { service, tx } = setup({
      shippingStage: 'READY_FOR_SHIPPING',
      paymentType: 'PREPAID',
    });

    await service.recompute('order-1');

    expect(tx.$queryRaw).toHaveBeenCalled(); // order row lock
    expect(tx.shipment.create).toHaveBeenCalledWith({
      data: { storeOrderId: 'order-1', isReship: false, attemptNumber: 1 },
    });
    const [[activity]] = tx.storeOrderActivity.create.mock.calls as unknown as [
      [{ data: { action: string } }],
    ];
    expect(activity.data.action).toBe('SHIPMENT_CREATED');
  });
});
