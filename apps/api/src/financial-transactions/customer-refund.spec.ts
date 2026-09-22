import { BadRequestException } from '@nestjs/common';
import { FinancialTransactionsService } from './financial-transactions.service';

/**
 * Customer Refund rules on the shared FinancialTransactionsService:
 * allocation-only against posted Sales Returns of the same customer, capped
 * at each return's unrefunded credit and at the customer's ledger credit,
 * never unallocated, idempotent Confirm (a retry never posts a second JE),
 * and a fixed allocation once confirmed.
 */
describe('FinancialTransactionsService — CUSTOMER_REFUND', () => {
  const PARTNER = '11111111-1111-4111-8111-111111111111';
  const RETURN = '22222222-2222-4222-8222-222222222222';
  const REFUND = '33333333-3333-4333-8333-333333333333';

  function setup(options: {
    returnStatus?: string;
    returnPartner?: string;
    returnTotal?: number;
    alreadyRefunded?: number;
    refundStatus?: string;
    refundAmount?: number;
    refundAllocations?: number[];
    /** RECEIVABLE ledger balance (debit − credit); negative = customer credit. */
    ledgerReceivable?: number;
  }) {
    const salesReturn = {
      id: RETURN,
      returnNumber: 'SR-2026-000009',
      partnerId: options.returnPartner ?? PARTNER,
      status: options.returnStatus ?? 'CONFIRMED',
      grandTotal: options.returnTotal ?? 450,
      currencyId: null,
      exchangeRate: 1,
      deletedAt: null,
    };
    const refundRow = {
      id: REFUND,
      transactionNumber: 'CRF-2026-000001',
      type: 'CUSTOMER_REFUND',
      status: options.refundStatus ?? 'DRAFT',
      partnerId: PARTNER,
      currencyId: null,
      amount: options.refundAmount ?? 450,
      feeAmount: 0,
      deletedAt: null,
      allocations: (options.refundAllocations ?? [450]).map((amount) => ({
        salesInvoiceId: null,
        purchaseInvoiceId: null,
        salesReturnId: RETURN,
        allocatedAmount: amount,
      })),
    };
    const prisma: Record<string, unknown> = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      salesReturn: {
        findFirst: jest.fn().mockResolvedValue(salesReturn),
        findUniqueOrThrow: jest.fn().mockResolvedValue(salesReturn),
        findMany: jest.fn().mockResolvedValue([salesReturn]),
      },
      financialTransaction: {
        findFirst: jest.fn().mockResolvedValue(refundRow),
        findUniqueOrThrow: jest.fn().mockResolvedValue(refundRow),
        create: jest
          .fn()
          .mockImplementation(
            ({ data }: { data: Record<string, unknown> }) => ({
              ...refundRow,
              ...data,
              id: REFUND,
            }),
          ),
        update: jest
          .fn()
          .mockImplementation(
            ({ data }: { data: Record<string, unknown> }) => ({
              ...refundRow,
              ...data,
            }),
          ),
      },
      financialTransactionAllocation: {
        groupBy: jest.fn().mockResolvedValue(
          options.alreadyRefunded
            ? [
                {
                  salesReturnId: RETURN,
                  _sum: { allocatedAmount: options.alreadyRefunded },
                },
              ]
            : [],
        ),
        findMany: jest.fn().mockResolvedValue([]),
      },
      journalEntryLine: {
        groupBy: jest
          .fn()
          .mockImplementation(
            ({
              where,
            }: {
              where: { account: { partnerControlType: string } };
            }) => {
              if (where.account.partnerControlType !== 'RECEIVABLE') return [];
              const balance = options.ledgerReceivable ?? -450;
              return [
                {
                  partnerId: PARTNER,
                  _sum: {
                    debit: balance > 0 ? balance : 0,
                    credit: balance < 0 ? -balance : 0,
                  },
                },
              ];
            },
          ),
      },
    };
    prisma.$transaction = jest
      .fn()
      .mockImplementation((work: (tx: unknown) => unknown) => work(prisma));
    const postingEngine = {
      post: jest.fn().mockResolvedValue({ id: 'je-1' }),
      reverse: jest.fn(),
    };
    const service = new FinancialTransactionsService(
      prisma as never,
      { assertActiveForRole: jest.fn().mockResolvedValue(undefined) } as never,
      { log: jest.fn() } as never,
      {
        generateNumber: jest.fn().mockResolvedValue('CRF-2026-000001'),
      } as never,
      postingEngine as never,
    );
    return { service, prisma, postingEngine, refundRow };
  }

  const baseDto = (amount: number, allocated = amount) => ({
    partnerId: PARTNER,
    amount,
    receivingAccountId: '44444444-4444-4444-8444-444444444444',
    allocations: [{ invoiceId: RETURN, allocatedAmount: allocated }],
  });

  describe('create — allocation limits', () => {
    it('creates a refund fully allocated to a posted return of the same customer', async () => {
      const { service, prisma } = setup({});
      await service.create('CUSTOMER_REFUND', baseDto(450));
      const createMock = (prisma.financialTransaction as { create: jest.Mock })
        .create;
      const [[create]] = createMock.mock.calls as [
        [
          {
            data: {
              type: string;
              allocations: { create: unknown[] };
            };
          },
        ],
      ];
      expect(create.data.type).toBe('CUSTOMER_REFUND');
      expect(create.data.allocations.create).toEqual([
        { salesReturnId: RETURN, allocatedAmount: 450 },
      ]);
    });

    it('rejects a refund with no allocation (unallocated refund)', async () => {
      const { service } = setup({});
      await expect(
        service.create('CUSTOMER_REFUND', { ...baseDto(450), allocations: [] }),
      ).rejects.toThrow(/must be allocated/);
    });

    it('rejects a refund whose amount differs from its allocations (overpayment)', async () => {
      const { service } = setup({});
      await expect(
        service.create('CUSTOMER_REFUND', baseDto(500, 450)),
      ).rejects.toThrow(/must equal the total allocated/);
    });

    it('rejects refunding more than the return’s unrefunded credit', async () => {
      const { service } = setup({ alreadyRefunded: 300 });
      await expect(
        service.create('CUSTOMER_REFUND', baseDto(200)),
      ).rejects.toThrow(/only 150 of its credit remains unrefunded/);
    });

    it('rejects a return that is not posted', async () => {
      const { service } = setup({ returnStatus: 'APPROVED' });
      await expect(
        service.create('CUSTOMER_REFUND', baseDto(100)),
      ).rejects.toThrow(/Only a posted/);
    });

    it('rejects a return of another customer', async () => {
      const { service } = setup({
        returnPartner: '55555555-5555-4555-8555-555555555555',
      });
      await expect(
        service.create('CUSTOMER_REFUND', baseDto(100)),
      ).rejects.toThrow(/does not belong to this customer/);
    });
  });

  describe('confirm', () => {
    it('confirms and posts exactly once', async () => {
      const { service, postingEngine } = setup({});
      await service.confirm(REFUND, 'user-1');
      expect(postingEngine.post).toHaveBeenCalledTimes(1);
      expect(postingEngine.post).toHaveBeenCalledWith(
        'CUSTOMER_REFUND',
        REFUND,
        'user-1',
        expect.anything(),
      );
    });

    it('is idempotent: a retry on a confirmed refund never posts a second JE', async () => {
      const { service, postingEngine, prisma } = setup({
        refundStatus: 'CONFIRMED',
      });
      const result = await service.confirm(REFUND, 'user-1');
      expect(result.status).toBe('CONFIRMED');
      expect(postingEngine.post).not.toHaveBeenCalled();
      expect(
        (prisma.financialTransaction as { update: jest.Mock }).update,
      ).not.toHaveBeenCalled();
      // The row lock is what serializes a concurrent double-click.
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it('refuses to confirm a cancelled refund', async () => {
      const { service } = setup({ refundStatus: 'CANCELLED' });
      await expect(service.confirm(REFUND)).rejects.toThrow(/from CANCELLED/);
    });

    it('rejects when the customer holds no credit on the ledger (return only offset an unpaid invoice)', async () => {
      const { service, postingEngine } = setup({ ledgerReceivable: 0 });
      await expect(service.confirm(REFUND)).rejects.toThrow(
        /does not cover refund/,
      );
      expect(postingEngine.post).not.toHaveBeenCalled();
    });

    it('rejects when another confirmed refund already consumed the return credit', async () => {
      const { service, postingEngine } = setup({ alreadyRefunded: 450 });
      await expect(service.confirm(REFUND)).rejects.toThrow(
        /only 0 of its credit remains unrefunded/,
      );
      expect(postingEngine.post).not.toHaveBeenCalled();
    });
  });

  it('never allows re-allocating a confirmed refund', async () => {
    const { service } = setup({ refundStatus: 'CONFIRMED' });
    await expect(
      service.allocate(REFUND, { invoiceId: RETURN, allocatedAmount: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.unallocate(REFUND, 'alloc-1')).rejects.toThrow(
      /is fixed/,
    );
  });

  it('refundable amount = unrefunded credit capped by the ledger credit', async () => {
    const { service } = setup({ alreadyRefunded: 100, ledgerReceivable: -200 });
    const summary = await service.getRefundableReturn(RETURN);
    expect(summary).toEqual(
      expect.objectContaining({
        grandTotal: 450,
        refundedTotal: 100,
        unrefundedCredit: 350,
        customerCreditBalance: 200,
        refundableAmount: 200,
      }),
    );
  });
});
