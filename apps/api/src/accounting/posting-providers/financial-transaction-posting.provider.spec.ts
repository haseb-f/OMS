import { BadRequestException } from '@nestjs/common';
import { FinancialTransactionPostingProvider } from './financial-transaction-posting.provider';
import { ExchangeRatesService } from '../fx/exchange-rates.service';
import type { PostingLine } from '../posting-engine/posting-provider.interface';

/**
 * Customer Refund posting — Dr Accounts Receivable (partner-tagged, at the
 * refunded return's own rate) / Cr Cash-Bank (at the refund's rate), with
 * the same explicit currency treatment as a Customer Receipt: a
 * same-currency (or currency-less) refund is never FX-multiplied, and a
 * foreign refund with no configured functional currency fails closed.
 */
describe('FinancialTransactionPostingProvider — CUSTOMER_REFUND', () => {
  const EGP = 'currency-egp';
  const USD = 'currency-usd';

  function makeProvider(options: {
    currencyId: string | null;
    returnRate: number | null;
    functionalCurrencyId?: string | null;
    usdRate?: number;
    receivingAccount?: { chartOfAccountId: string } | null;
    allocations?: number[];
    amount?: number;
  }) {
    const allocations = (options.allocations ?? [450]).map((amount, i) => ({
      allocatedAmount: amount,
      salesInvoice: null,
      purchaseInvoice: null,
      salesReturn: {
        id: `return-${i}`,
        exchangeRate: options.returnRate,
        currencyId: options.currencyId,
      },
    }));
    const refund = {
      id: 'refund-1',
      transactionNumber: 'CRF-2026-000001',
      type: 'CUSTOMER_REFUND',
      amount: options.amount ?? 450,
      feeAmount: 0,
      currencyId: options.currencyId,
      exchangeRate: null,
      confirmedAt: new Date('2026-09-22'),
      transactionDate: new Date('2026-09-22'),
      companyId: null,
      branchId: null,
      costCenterId: null,
      projectId: null,
      partner: { id: 'partner-1' },
      receivingAccount:
        options.receivingAccount === undefined
          ? { chartOfAccountId: 'account-bank' }
          : options.receivingAccount,
      allocations,
    };
    const tx = {
      financialTransaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(refund),
        update: jest.fn().mockResolvedValue(refund),
      },
      postingSettings: {
        findFirst: jest.fn().mockResolvedValue({
          functionalCurrencyId:
            options.functionalCurrencyId === undefined
              ? EGP
              : options.functionalCurrencyId,
        }),
      },
      exchangeRate: {
        findFirst: jest
          .fn()
          .mockImplementation(
            ({
              where,
            }: {
              where: { fromCurrencyId: string; effectiveDate: { lte: Date } };
            }) =>
              where.fromCurrencyId === USD && options.usdRate
                ? {
                    rate: options.usdRate,
                    effectiveDate: where.effectiveDate.lte,
                    source: 'MANUAL',
                  }
                : null,
          ),
      },
      // Resolution precedence (IMPL-FX): no dated override, default settings.
      exchangeRateOverride: { findFirst: jest.fn().mockResolvedValue(null) },
      fxSyncSettings: { findFirst: jest.fn().mockResolvedValue(null) },
      currency: { findUnique: jest.fn().mockResolvedValue({ code: 'X' }) },
    };
    const accountMapping = {
      resolveReceivableAccount: jest.fn().mockResolvedValue('account-ar'),
      resolvePayableAccount: jest.fn(),
      resolveExchangeDifferenceAccount: jest
        .fn()
        .mockResolvedValue('account-fx'),
    };
    const provider = new FinancialTransactionPostingProvider(
      {} as never,
      { registerProvider: jest.fn() } as never,
      accountMapping as never,
      new ExchangeRatesService({} as never),
    );
    return { provider, tx, accountMapping };
  }

  const sum = (lines: PostingLine[], side: 'debit' | 'credit') =>
    Math.round(lines.reduce((s, l) => s + (l[side] ?? 0), 0) * 100) / 100;

  it('is registered for CUSTOMER_REFUND', () => {
    expect(
      makeProvider({ currencyId: EGP, returnRate: 1 }).provider.sourceTypes,
    ).toContain('CUSTOMER_REFUND');
  });

  it('same (functional) currency: Dr AR / Cr Bank at face value, never multiplied', async () => {
    const { provider, tx } = makeProvider({ currencyId: EGP, returnRate: 1 });
    const result = await provider.buildEntries(
      'CUSTOMER_REFUND',
      'refund-1',
      tx as never,
    );

    expect(result!.linesInFunctionalCurrency).toBe(true);
    expect(result!.exchangeRate).toBe(1);
    expect(result!.lines).toEqual([
      expect.objectContaining({
        accountId: 'account-ar',
        debit: 450,
        partnerId: 'partner-1',
      }),
      expect.objectContaining({ accountId: 'account-bank', credit: 450 }),
    ]);
    expect(result!.lines.some((l) => l.accountId === 'account-fx')).toBe(false);
    // Snapshot records rate 1 for a same-currency refund.
    expect(tx.financialTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { exchangeRate: 1 } }),
    );
    expect(tx.exchangeRate.findFirst).not.toHaveBeenCalled();
  });

  it('no currency on the refund posts at face value without requiring a functional currency', async () => {
    const { provider, tx } = makeProvider({
      currencyId: null,
      returnRate: null,
      functionalCurrencyId: null,
    });
    const result = await provider.buildEntries(
      'CUSTOMER_REFUND',
      'refund-1',
      tx as never,
    );
    expect(sum(result!.lines, 'debit')).toBe(450);
    expect(sum(result!.lines, 'credit')).toBe(450);
    expect(result!.exchangeRate).toBe(1);
  });

  it('foreign currency: AR at the return rate, cash at the refund rate, difference is realized FX', async () => {
    // Return credited AR at 50; the refund is paid out at 48 → 200 FX gain.
    const { provider, tx } = makeProvider({
      currencyId: USD,
      returnRate: 50,
      usdRate: 48,
      allocations: [100],
      amount: 100,
    });
    const result = await provider.buildEntries(
      'CUSTOMER_REFUND',
      'refund-1',
      tx as never,
    );

    expect(result!.exchangeRate).toBe(48);
    expect(result!.linesInFunctionalCurrency).toBe(true);
    expect(result!.lines).toEqual([
      expect.objectContaining({
        accountId: 'account-ar',
        debit: 5000,
        partnerId: 'partner-1',
      }),
      expect.objectContaining({ accountId: 'account-bank', credit: 4800 }),
      expect.objectContaining({ accountId: 'account-fx', credit: 200 }),
    ]);
    expect(sum(result!.lines, 'debit')).toBe(sum(result!.lines, 'credit'));
  });

  it('foreign currency paid out at a higher rate books an FX loss (debit)', async () => {
    const { provider, tx } = makeProvider({
      currencyId: USD,
      returnRate: 48,
      usdRate: 50,
      allocations: [100],
      amount: 100,
    });
    const result = await provider.buildEntries(
      'CUSTOMER_REFUND',
      'refund-1',
      tx as never,
    );
    expect(result!.lines).toEqual([
      expect.objectContaining({ accountId: 'account-ar', debit: 4800 }),
      expect.objectContaining({ accountId: 'account-bank', credit: 5000 }),
      expect.objectContaining({ accountId: 'account-fx', debit: 200 }),
    ]);
  });

  it('fails closed when a currency is set but no functional currency is configured', async () => {
    const { provider, tx } = makeProvider({
      currencyId: USD,
      returnRate: 50,
      functionalCurrencyId: null,
    });
    await expect(
      provider.buildEntries('CUSTOMER_REFUND', 'refund-1', tx as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a Cash/Bank account to credit', async () => {
    const { provider, tx } = makeProvider({
      currencyId: EGP,
      returnRate: 1,
      receivingAccount: null,
    });
    await expect(
      provider.buildEntries('CUSTOMER_REFUND', 'refund-1', tx as never),
    ).rejects.toThrow(/Receiving Account/);
  });
});

/**
 * R18 — a Customer Receipt's money and its allocations stay distinct: a
 * partial receipt clears only what it allocates (plus an explicit advance at
 * the receipt rate), and allocations above the money moved are refused
 * rather than absorbed as realized FX.
 */
describe('FinancialTransactionPostingProvider — CUSTOMER_RECEIPT (R18)', () => {
  const EGP = 'currency-egp';
  const USD = 'currency-usd';

  function makeReceiptProvider(options: {
    currencyId: string;
    invoiceRate: number;
    receiptRate?: number;
    amount: number;
    allocations: number[];
  }) {
    const receipt = {
      id: 'receipt-1',
      transactionNumber: 'CR-2026-000001',
      type: 'CUSTOMER_RECEIPT',
      amount: options.amount,
      feeAmount: 0,
      feeAccountId: null,
      debitAccountId: null,
      currencyId: options.currencyId,
      exchangeRate: null,
      confirmedAt: new Date('2026-10-11'),
      transactionDate: new Date('2026-10-11'),
      companyId: null,
      branchId: null,
      costCenterId: null,
      projectId: null,
      partner: { id: 'partner-1' },
      receivingAccount: { chartOfAccountId: 'account-bank' },
      allocations: options.allocations.map((allocatedAmount, i) => ({
        allocatedAmount,
        salesInvoice: {
          id: `invoice-${i}`,
          exchangeRate: options.invoiceRate,
          currencyId: options.currencyId,
        },
        purchaseInvoice: null,
        salesReturn: null,
      })),
    };
    const tx = {
      financialTransaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(receipt),
        update: jest.fn().mockResolvedValue(receipt),
      },
      paymentReceiptLink: { findUnique: jest.fn().mockResolvedValue(null) },
      postingSettings: {
        findFirst: jest.fn().mockResolvedValue({ functionalCurrencyId: EGP }),
      },
      exchangeRate: {
        findFirst: jest.fn().mockResolvedValue(
          options.receiptRate
            ? {
                rate: options.receiptRate,
                effectiveDate: new Date('2026-10-11'),
                source: 'MANUAL',
              }
            : null,
        ),
      },
      exchangeRateOverride: { findFirst: jest.fn().mockResolvedValue(null) },
      fxSyncSettings: { findFirst: jest.fn().mockResolvedValue(null) },
      currency: { findUnique: jest.fn().mockResolvedValue({ code: 'X' }) },
    };
    const accountMapping = {
      resolveReceivableAccount: jest.fn().mockResolvedValue('account-ar'),
      resolvePayableAccount: jest.fn(),
      resolveExchangeDifferenceAccount: jest
        .fn()
        .mockResolvedValue('account-fx'),
    };
    const provider = new FinancialTransactionPostingProvider(
      {} as never,
      { registerProvider: jest.fn() } as never,
      accountMapping as never,
      new ExchangeRatesService({} as never),
    );
    return { provider, tx };
  }

  it("the owner's case: 100,000 received against a 200,000 invoice debits the bank 100,000 only", async () => {
    const { provider, tx } = makeReceiptProvider({
      currencyId: EGP,
      invoiceRate: 1,
      amount: 100_000,
      allocations: [100_000],
    });
    const result = await provider.buildEntries(
      'CUSTOMER_RECEIPT',
      'receipt-1',
      tx as never,
    );
    expect(result!.lines).toEqual([
      expect.objectContaining({ accountId: 'account-bank', debit: 100_000 }),
      expect.objectContaining({ accountId: 'account-ar', credit: 100_000 }),
    ]);
  });

  it('foreign partial receipt: allocated part at the invoice rate, advance at the receipt rate, FX on the allocated part only', async () => {
    // USD 100 received at 52; 60 applied to an invoice booked at 50.
    const { provider, tx } = makeReceiptProvider({
      currencyId: USD,
      invoiceRate: 50,
      receiptRate: 52,
      amount: 100,
      allocations: [60],
    });
    const result = await provider.buildEntries(
      'CUSTOMER_RECEIPT',
      'receipt-1',
      tx as never,
    );
    expect(result!.lines).toEqual([
      expect.objectContaining({ accountId: 'account-bank', debit: 5200 }),
      expect.objectContaining({ accountId: 'account-ar', credit: 5080 }),
      expect.objectContaining({ accountId: 'account-fx', credit: 120 }),
    ]);
  });

  it('allocations above the voucher amount are refused, never booked as FX', async () => {
    const { provider, tx } = makeReceiptProvider({
      currencyId: EGP,
      invoiceRate: 1,
      amount: 100_000,
      allocations: [200_000],
    });
    await expect(
      provider.buildEntries('CUSTOMER_RECEIPT', 'receipt-1', tx as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
