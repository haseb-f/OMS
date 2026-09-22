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
            ({ where }: { where: { fromCurrencyId: string } }) =>
              where.fromCurrencyId === USD && options.usdRate
                ? { rate: options.usdRate }
                : null,
          ),
      },
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
