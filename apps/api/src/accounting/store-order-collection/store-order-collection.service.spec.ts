import { SalesDocumentStatus } from '@prisma/client';
import { StoreOrderCollectionService } from './store-order-collection.service';

function buildTx(overrides: Record<string, unknown> = {}) {
  return {
    financialTransaction: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn(),
    },
    journalEntry: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'je-1', entryNumber: 'JV-1' }),
    },
    payment: {
      findFirstOrThrow: jest.fn().mockResolvedValue({
        id: 'pay-1',
        paymentNumber: 'PAY-1',
        amount: 100,
        actualFeeAmount: 0,
        currencyId: 'c-1',
        paymentSourceId: 'src-1',
        receivingAccountId: 'ra-1',
        receivedDate: new Date('2026-01-01'),
        verifiedAt: new Date('2026-01-01'),
        paymentDate: new Date('2026-01-01'),
        storeOrder: { id: 'so-1', partnerId: 'p-1', currencyId: 'c-1' },
      }),
    },
    salesInvoice: { findFirst: jest.fn().mockResolvedValue(null) },
    financialTransactionAllocation: {
      groupBy: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

function buildService() {
  const financialTransactions = {
    create: jest.fn().mockResolvedValue({ id: 'ft-new' }),
    confirm: jest.fn().mockResolvedValue({
      id: 'ft-new',
      transactionNumber: 'CR-NEW',
      status: 'CONFIRMED',
    }),
    allocate: jest.fn(),
  };
  const accountMapping = { resolvePaymentGatewayFeeAccount: jest.fn() };
  const service = new StoreOrderCollectionService(
    {} as never,
    financialTransactions as never,
    accountMapping as never,
  );
  return { service, financialTransactions };
}

describe('StoreOrderCollectionService.postPaymentReceipt', () => {
  it('returns the existing receipt instead of posting a second one', async () => {
    const tx = buildTx();
    tx.financialTransaction.findFirst.mockResolvedValue({
      id: 'ft-1',
      transactionNumber: 'CR-1',
      status: 'CONFIRMED',
    });
    const { service, financialTransactions } = buildService();

    const receipt = await service.postPaymentReceipt(tx as never, 'pay-1');

    expect(receipt).toEqual({
      id: 'ft-1',
      transactionNumber: 'CR-1',
      status: 'CONFIRMED',
      journalEntry: { id: 'je-1', entryNumber: 'JV-1' },
    });
    expect(financialTransactions.create).not.toHaveBeenCalled();
    expect(financialTransactions.confirm).not.toHaveBeenCalled();
  });

  it('posts an unallocated advance when the order has no confirmed invoice yet', async () => {
    const tx = buildTx();
    const { service, financialTransactions } = buildService();

    const receipt = await service.postPaymentReceipt(
      tx as never,
      'pay-1',
      'u-1',
    );

    expect(financialTransactions.create).toHaveBeenCalledWith(
      'CUSTOMER_RECEIPT',
      expect.objectContaining({
        partnerId: 'p-1',
        amount: 100,
        allocations: [],
        notes: 'STORE_ORDER_PAYMENT:pay-1',
      }),
      'u-1',
      undefined,
      tx,
    );
    expect(financialTransactions.confirm).toHaveBeenCalledWith(
      'ft-new',
      'u-1',
      tx,
    );
    expect(receipt.transactionNumber).toBe('CR-NEW');
    expect(receipt.journalEntry).toEqual({ id: 'je-1', entryNumber: 'JV-1' });
  });

  it('allocates to the confirmed invoice, capped at its remaining balance, and keeps the full cash amount', async () => {
    const tx = buildTx({
      salesInvoice: {
        findFirst: jest.fn().mockResolvedValue({ id: 'inv-1', grandTotal: 80 }),
      },
    });
    const { service, financialTransactions } = buildService();

    await service.postPaymentReceipt(tx as never, 'pay-1', 'u-1');

    expect(tx.salesInvoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest asymmetric matcher
        where: expect.objectContaining({
          storeOrderId: 'so-1',
          status: {
            in: [SalesDocumentStatus.CONFIRMED, SalesDocumentStatus.CLOSED],
          },
        }),
      }),
    );
    expect(financialTransactions.create).toHaveBeenCalledWith(
      'CUSTOMER_RECEIPT',
      expect.objectContaining({
        amount: 100,
        allocations: [{ invoiceId: 'inv-1', allocatedAmount: 80 }],
      }),
      'u-1',
      undefined,
      tx,
    );
  });
});
