import { SalesDocumentStatus } from '@prisma/client';
import {
  StoreOrderCollectionService,
  planAllocations,
} from './store-order-collection.service';

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
    salesInvoice: { findMany: jest.fn().mockResolvedValue([]) },
    paymentReceiptLink: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'link-1' }),
    },
    // No advance refunds on the order: nothing to carry on its receipts.
    financialTransactionAllocation: {
      groupBy: jest.fn().mockResolvedValue([]),
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { allocatedAmount: null } }),
      findMany: jest.fn().mockResolvedValue([]),
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
    { onCodShipmentDelivered: jest.fn() } as never,
  );
  return { service, financialTransactions };
}

describe('planAllocations (R15 — one invoice per delivered shipment)', () => {
  it('fills the oldest invoice first, each up to its remaining balance', () => {
    expect(
      planAllocations(100, [
        { id: 'inv-1', remaining: 80 },
        { id: 'inv-2', remaining: 50 },
      ]),
    ).toEqual([
      { invoiceId: 'inv-1', amount: 80 },
      { invoiceId: 'inv-2', amount: 20 },
    ]);
  });

  it('never over-allocates: what exceeds the invoices stays an advance', () => {
    expect(
      planAllocations(200, [
        { id: 'inv-1', remaining: 30.5 },
        { id: 'inv-2', remaining: 19.5 },
      ]),
    ).toEqual([
      { invoiceId: 'inv-1', amount: 30.5 },
      { invoiceId: 'inv-2', amount: 19.5 },
    ]);
    expect(planAllocations(0, [{ id: 'inv-1', remaining: 10 }])).toEqual([]);
  });
});

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

  it('allocates across the posted invoices oldest-first and keeps the full cash amount', async () => {
    const tx = buildTx({
      salesInvoice: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'inv-1', grandTotal: 80 },
          { id: 'inv-2', grandTotal: 50 },
        ]),
      },
    });
    const { service, financialTransactions } = buildService();

    await service.postPaymentReceipt(tx as never, 'pay-1', 'u-1');

    expect(tx.salesInvoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest asymmetric matcher
        where: expect.objectContaining({
          storeOrderId: 'so-1',
          status: {
            in: [SalesDocumentStatus.CONFIRMED, SalesDocumentStatus.CLOSED],
          },
        }),
        orderBy: [{ createdAt: 'asc' }, { invoiceNumber: 'asc' }],
      }),
    );
    expect(financialTransactions.create).toHaveBeenCalledWith(
      'CUSTOMER_RECEIPT',
      expect.objectContaining({
        amount: 100,
        allocations: [
          { invoiceId: 'inv-1', allocatedAmount: 80 },
          { invoiceId: 'inv-2', allocatedAmount: 20 },
        ],
      }),
      'u-1',
      undefined,
      tx,
    );
  });
});
