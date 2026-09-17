import { PaymentStatus, SalesDocumentStatus } from '@prisma/client';
import { StoreOrderCollectionService } from './store-order-collection.service';

describe('StoreOrderCollectionService', () => {
  it('skips creating a second receipt when STORE_ORDER_PAYMENT notes already exist', async () => {
    const prisma = {
      salesInvoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'inv-1',
          partnerId: 'p-1',
          currencyId: 'c-1',
          grandTotal: 100,
        }),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'pay-1',
            amount: 100,
            actualFeeAmount: 0,
            paymentSourceId: 'src-1',
            receivingAccountId: 'ra-1',
            currencyId: 'c-1',
            paymentNumber: 'PAY-1',
            receivedDate: new Date('2026-01-01'),
            verifiedAt: new Date('2026-01-01'),
            paymentDate: new Date('2026-01-01'),
            status: PaymentStatus.VERIFIED,
          },
        ]),
      },
      financialTransaction: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'ft-1',
          status: 'CONFIRMED',
          transactionNumber: 'CR-1',
        }),
      },
      financialTransactionAllocation: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };
    const financialTransactions = {
      create: jest.fn(),
      confirm: jest.fn(),
    };
    const accountMapping = {
      resolvePaymentGatewayFeeAccount: jest.fn(),
    };
    const service = new StoreOrderCollectionService(
      prisma as never,
      financialTransactions as never,
      accountMapping as never,
    );

    const posted = await service.syncVerifiedPayments('so-1', 'user-1');

    expect(posted).toEqual([
      { id: 'ft-1', status: 'CONFIRMED', transactionNumber: 'CR-1' },
    ]);
    expect(financialTransactions.create).not.toHaveBeenCalled();
    expect(prisma.salesInvoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storeOrderId: 'so-1',
          status: {
            in: [SalesDocumentStatus.CONFIRMED, SalesDocumentStatus.CLOSED],
          },
        }),
      }),
    );
  });
});
