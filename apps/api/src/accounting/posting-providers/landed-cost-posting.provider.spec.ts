import { Prisma } from '@prisma/client';
import { LandedCostPostingProvider } from './landed-cost-posting.provider';
import { splitLandedCost } from '../inventory-valuation/inventory-valuation.service';

/**
 * R13 (spec §4) — landed cost after receipt: only the units still in stock are
 * capitalized (Dr Inventory), the share of units already sold is a COGS
 * variance; amounts are booked in the functional currency at the document's
 * frozen rate, on the document date, and the entry balances exactly.
 */
describe('LandedCostPostingProvider.buildEntries — capitalized / variance split', () => {
  const D = (value: number | string) => new Prisma.Decimal(value);

  function makeProvider(input: {
    lines: Array<{ net: number; tax?: number; taxId?: string }>;
    allocations: Array<{
      id: string;
      productId: string;
      quantity: number;
      amount: number;
    }>;
    onHand: Record<string, number>;
    currencyId?: string;
    exchangeRate?: number | null;
    rate?: number;
    providerId?: string | null;
  }) {
    const documentRow = {
      id: 'lc-1',
      documentNumber: 'LC-0001',
      currencyId: input.currencyId ?? 'functional',
      exchangeRate: input.exchangeRate ?? null,
      documentDate: new Date('2026-10-03T00:00:00.000Z'),
      providerId: input.providerId ?? null,
      purchaseInvoice: { invoiceNumber: 'PI-0001' },
      lines: input.lines.map((line, index) => ({
        id: `line-${index}`,
        costComponentId: 'component-freight',
        netAmount: D(line.net),
        taxAmount: D(line.tax ?? 0),
        taxId: line.taxId ?? null,
      })),
      allocations: input.allocations.map((allocation) => ({
        id: allocation.id,
        allocatedQuantity: allocation.quantity,
        allocatedAmount: D(allocation.amount),
        purchaseInvoiceItem: {
          productId: allocation.productId,
          product: {
            id: allocation.productId,
            categoryId: `cat-${allocation.productId}`,
          },
        },
      })),
    };
    const tx = {
      landedCostDocument: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(documentRow),
        update: jest.fn(),
      },
      landedCostAllocation: { update: jest.fn() },
    };
    // The real split rule, against the on-hand given per product.
    const inventoryValuation = {
      applyLandedCost: jest.fn(
        (
          productId: string,
          amount: Prisma.Decimal,
          _tx: unknown,
          _user: unknown,
          options: { allocatedQuantity: number },
        ) => {
          const split = splitLandedCost({
            allocatedAmount: amount,
            allocatedQuantity: options.allocatedQuantity,
            onHand: input.onHand[productId] ?? 0,
          });
          return Promise.resolve({
            previousCost: 0,
            newCost: 0,
            onHandQuantity: input.onHand[productId] ?? 0,
            capitalized: split.capitalized.toNumber(),
            variance: split.variance.toNumber(),
          });
        },
      ),
    };
    const accountMapping = {
      resolvePayableAccount: jest.fn().mockResolvedValue('payable'),
      resolveLandedCostClearingAccount: jest.fn().mockResolvedValue('clearing'),
      resolveVatInputAccount: jest.fn().mockResolvedValue('vat-input'),
      resolveInventoryAccount: jest.fn((categoryId: string) =>
        Promise.resolve(`inventory-${categoryId}`),
      ),
      resolveCogsAccount: jest.fn((categoryId: string) =>
        Promise.resolve(`cogs-${categoryId}`),
      ),
    };
    const exchangeRates = {
      snapshotRate: jest.fn().mockResolvedValue(input.rate ?? 1),
    };
    const provider = new LandedCostPostingProvider(
      {} as never,
      { registerProvider: jest.fn() } as never,
      inventoryValuation as never,
      accountMapping as never,
      exchangeRates as never,
    );
    return { provider, tx, inventoryValuation, exchangeRates };
  }

  const on = (
    lines: Array<{ accountId: string; debit?: number; credit?: number }>,
    accountId: string,
  ) => lines.find((line) => line.accountId === accountId);
  const balanced = (lines: Array<{ debit?: number; credit?: number }>) => {
    const debit = lines.reduce(
      (s, l) => s + Math.round((l.debit ?? 0) * 100),
      0,
    );
    const credit = lines.reduce(
      (s, l) => s + Math.round((l.credit ?? 0) * 100),
      0,
    );
    return debit === credit;
  };

  it('Q=10 received, 6 sold (O=4), A=100 → 40 capitalized, 60 COGS variance, balanced', async () => {
    const { provider, tx } = makeProvider({
      lines: [{ net: 100 }],
      allocations: [{ id: 'a1', productId: 'p', quantity: 10, amount: 100 }],
      onHand: { p: 4 },
    });

    const result = await provider.buildEntries(
      'LANDED_COST',
      'lc-1',
      tx as never,
    );

    expect(on(result!.lines, 'inventory-cat-p')?.debit).toBe(40);
    expect(on(result!.lines, 'cogs-cat-p')?.debit).toBe(60);
    expect(on(result!.lines, 'clearing')?.credit).toBe(100);
    expect(balanced(result!.lines)).toBe(true);
    expect(result!.linesInFunctionalCurrency).toBe(true);
    expect(result!.entryDate).toEqual(new Date('2026-10-03T00:00:00.000Z'));
    expect(tx.landedCostAllocation.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { capitalizedAmount: D(40), cogsVarianceAmount: D(60) },
    });
  });

  it('nothing on hand (O=0) → the whole amount is COGS variance, never an error', async () => {
    const { provider, tx } = makeProvider({
      lines: [{ net: 75.5 }],
      allocations: [{ id: 'a1', productId: 'p', quantity: 5, amount: 75.5 }],
      onHand: { p: 0 },
    });

    const result = await provider.buildEntries(
      'LANDED_COST',
      'lc-1',
      tx as never,
    );

    expect(on(result!.lines, 'inventory-cat-p')).toBeUndefined();
    expect(on(result!.lines, 'cogs-cat-p')?.debit).toBe(75.5);
    expect(balanced(result!.lines)).toBe(true);
  });

  it('one product on two invoice lines is split ONCE over the summed received quantity', async () => {
    const { provider, tx, inventoryValuation } = makeProvider({
      lines: [{ net: 200 }],
      allocations: [
        { id: 'a1', productId: 'p', quantity: 10, amount: 100 },
        { id: 'a2', productId: 'p', quantity: 10, amount: 100 },
      ],
      onHand: { p: 10 },
    });

    const result = await provider.buildEntries(
      'LANDED_COST',
      'lc-1',
      tx as never,
    );

    expect(inventoryValuation.applyLandedCost).toHaveBeenCalledTimes(1);
    expect(inventoryValuation.applyLandedCost).toHaveBeenCalledWith(
      'p',
      D(200),
      tx,
      undefined,
      { allocatedQuantity: 20, referenceId: 'lc-1' },
    );
    // 10 of 20 received units remain → half capitalized.
    expect(on(result!.lines, 'inventory-cat-p')?.debit).toBe(100);
    expect(on(result!.lines, 'cogs-cat-p')?.debit).toBe(100);
  });

  it('foreign currency: freezes the rate on the document and books functional amounts (never at rate 1)', async () => {
    const { provider, tx, exchangeRates } = makeProvider({
      currencyId: 'usd',
      rate: 48.3333,
      lines: [{ net: 100, tax: 15, taxId: 'vat' }],
      allocations: [
        { id: 'a1', productId: 'p', quantity: 3, amount: 33.33 },
        { id: 'a2', productId: 'q', quantity: 3, amount: 66.67 },
      ],
      onHand: { p: 3, q: 3 },
    });

    const result = await provider.buildEntries(
      'LANDED_COST',
      'lc-1',
      tx as never,
    );

    expect(exchangeRates.snapshotRate).toHaveBeenCalledWith(
      'usd',
      new Date('2026-10-03T00:00:00.000Z'),
      tx,
    );
    expect(tx.landedCostDocument.update).toHaveBeenCalledWith({
      where: { id: 'lc-1' },
      data: { exchangeRate: 48.3333 },
    });
    expect(result!.exchangeRate).toBe(48.3333);
    // gross 115 × 48.3333 = 5558.33; VAT 15 × 48.3333 = 725.00 → net 4833.33
    expect(on(result!.lines, 'clearing')?.credit).toBe(5558.33);
    expect(on(result!.lines, 'vat-input')?.debit).toBe(725);
    const inventory =
      (on(result!.lines, 'inventory-cat-p')?.debit ?? 0) +
      (on(result!.lines, 'inventory-cat-q')?.debit ?? 0);
    expect(Math.round(inventory * 100)).toBe(483333);
    expect(balanced(result!.lines)).toBe(true);
  });

  it('credits the provider payable (with partner) when a provider is set', async () => {
    const { provider, tx } = makeProvider({
      providerId: 'partner-freight',
      lines: [{ net: 50 }],
      allocations: [{ id: 'a1', productId: 'p', quantity: 1, amount: 50 }],
      onHand: { p: 1 },
    });

    const result = await provider.buildEntries(
      'LANDED_COST',
      'lc-1',
      tx as never,
    );

    expect(on(result!.lines, 'payable')).toEqual(
      expect.objectContaining({ credit: 50, partnerId: 'partner-freight' }),
    );
  });
});
