import { Prisma } from '@prisma/client';
import { SalesReturnPostingProvider } from './sales-return-posting.provider';

/**
 * M1 recovery — regression for the confirmed foundation defect: a Sales
 * Return's `postSalesReturn` restored physical on-hand quantity, and its
 * posting provider already reversed COGS/Inventory in the Journal Entry at
 * the original sale's historical unit cost, but neither ever re-blended
 * that quantity into the moving-average valuation pool — silently
 * diverging `Product.currentCost` from the GL Inventory balance this
 * reversal just restored. Locks in that `buildEntries` restores the pool
 * once per product (R13: all lines of one product together, so two lines
 * never distort the blend), at the exact same historical unit cost the
 * journal reversal uses, never for a non-inventory line, and that a kit line
 * returns its components at the invoice line's snapshot cost.
 */
describe('SalesReturnPostingProvider.buildEntries — valuation pool restoration', () => {
  const D = (value: number | string) => new Prisma.Decimal(value);
  const inventoryLine = {
    id: 'line-1',
    productId: 'product-inventory',
    quantity: 5,
    lineTotal: 550,
    taxAmount: 0,
    taxId: null,
    tax: null,
    product: {
      isInventoryItem: true,
      supplyMethod: 'PURCHASED',
      categoryId: 'category-1',
      sku: 'INV',
    },
    salesInvoiceItem: { unitCost: 110, fulfillmentSnapshot: null },
  };
  const serviceLine = {
    id: 'line-2',
    productId: 'product-service',
    quantity: 1,
    lineTotal: 50,
    taxAmount: 0,
    taxId: null,
    tax: null,
    product: {
      isInventoryItem: false,
      supplyMethod: 'PURCHASED',
      categoryId: 'category-1',
      sku: 'SVC',
    },
    salesInvoiceItem: null,
  };
  const kitLine = {
    id: 'line-3',
    productId: 'product-kit',
    quantity: 2,
    lineTotal: 600,
    taxAmount: 0,
    taxId: null,
    tax: null,
    product: {
      isInventoryItem: false,
      supplyMethod: 'KIT',
      categoryId: 'category-kit',
      sku: 'KIT',
    },
    salesInvoiceItem: {
      unitCost: 35,
      fulfillmentSnapshot: {
        recipeId: 'recipe-1',
        version: 1,
        components: [
          { productId: 'component-a', qtyPerKit: 2, unitCost: '10.1234' },
          { productId: 'component-b', qtyPerKit: 1, unitCost: '15' },
        ],
      },
    },
  };

  function makeProvider(
    items: unknown[] = [inventoryLine, serviceLine],
    existingEntries = 0,
  ) {
    const salesReturnRow = {
      id: 'return-1',
      returnNumber: 'SR-0001',
      grandTotal: 600,
      currencyId: 'currency-1',
      exchangeRate: 1,
      confirmedAt: new Date('2026-09-01'),
      createdAt: new Date('2026-09-01'),
      companyId: null,
      branchId: null,
      costCenterId: null,
      projectId: null,
      partner: { id: 'partner-1', customerProfile: null },
      items,
    };
    const tx = {
      salesReturn: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(salesReturnRow),
        update: jest.fn(),
      },
      journalEntry: { count: jest.fn().mockResolvedValue(existingEntries) },
      product: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'component-a', categoryId: 'category-a' },
          { id: 'component-b', categoryId: 'category-b' },
        ]),
      },
    };
    const postingEngine = { registerProvider: jest.fn() };
    const inventoryValuation = {
      applyReturnToStockLines: jest
        .fn()
        .mockResolvedValue({ previousCost: 0, newCost: 0 }),
    };
    const accountMapping = {
      resolveReceivableAccount: jest.fn().mockResolvedValue('account-ar'),
      resolveSalesRevenueAccount: jest
        .fn()
        .mockResolvedValue('account-revenue'),
      resolveSalesReturnAccount: jest.fn().mockResolvedValue('account-return'),
      resolveVatOutputAccount: jest.fn().mockResolvedValue('account-vat'),
      resolveCogsAccount: jest.fn((categoryId: string) =>
        Promise.resolve(`cogs-${categoryId}`),
      ),
      resolveInventoryAccount: jest.fn((categoryId: string) =>
        Promise.resolve(`inventory-${categoryId}`),
      ),
    };
    const exchangeRates = {
      snapshotRate: jest.fn().mockResolvedValue(1),
    };

    const provider = new SalesReturnPostingProvider(
      {} as never,
      postingEngine as never,
      inventoryValuation as never,
      accountMapping as never,
      exchangeRates as never,
    );

    return { provider, tx, inventoryValuation };
  }

  it('restores the valuation pool at the historical unit cost, once per inventory product', async () => {
    const { provider, tx, inventoryValuation } = makeProvider();

    await provider.buildEntries('SALES_RETURN', 'return-1', tx as never);

    expect(inventoryValuation.applyReturnToStockLines).toHaveBeenCalledTimes(1);
    expect(inventoryValuation.applyReturnToStockLines).toHaveBeenCalledWith(
      'product-inventory',
      [{ quantity: 5, unitCost: D(110) }],
      tx,
      undefined,
    );
  });

  it('never restores valuation for a non-inventory line', async () => {
    const { provider, tx, inventoryValuation } = makeProvider();

    await provider.buildEntries('SALES_RETURN', 'return-1', tx as never);

    const products = (
      inventoryValuation.applyReturnToStockLines.mock.calls as unknown[][]
    ).map(([productId]) => productId);
    expect(products).not.toContain('product-service');
  });

  it('blends two lines of the same product in ONE valuation call', async () => {
    const { provider, tx, inventoryValuation } = makeProvider([
      inventoryLine,
      {
        ...inventoryLine,
        id: 'line-1b',
        quantity: 3,
        salesInvoiceItem: { unitCost: 90, fulfillmentSnapshot: null },
      },
    ]);

    await provider.buildEntries('SALES_RETURN', 'return-1', tx as never);

    expect(inventoryValuation.applyReturnToStockLines).toHaveBeenCalledTimes(1);
    expect(inventoryValuation.applyReturnToStockLines).toHaveBeenCalledWith(
      'product-inventory',
      [
        { quantity: 5, unitCost: D(110) },
        { quantity: 3, unitCost: D(90) },
      ],
      tx,
      undefined,
    );
  });

  it('returns a kit line as its components at the snapshot cost: Dr component inventory / Cr kit COGS', async () => {
    const { provider, tx, inventoryValuation } = makeProvider([kitLine]);

    const result = await provider.buildEntries(
      'SALES_RETURN',
      'return-1',
      tx as never,
    );

    // A: 2 × 2 × 10.1234 = 40.4936 → 40.49 · B: 1 × 2 × 15 = 30
    const line = (accountId: string) =>
      result!.lines.find((l) => l.accountId === accountId);
    expect(line('inventory-category-a')?.debit).toBe(40.49);
    expect(line('inventory-category-b')?.debit).toBe(30);
    expect(line('cogs-category-kit')?.credit).toBe(70.49);
    expect(line('inventory-category-kit')).toBeUndefined();
    expect(inventoryValuation.applyReturnToStockLines).toHaveBeenCalledWith(
      'component-a',
      [{ quantity: 4, unitCost: D('10.1234') }],
      tx,
      undefined,
    );
    expect(inventoryValuation.applyReturnToStockLines).toHaveBeenCalledWith(
      'component-b',
      [{ quantity: 2, unitCost: D(15) }],
      tx,
      undefined,
    );
    expect(inventoryValuation.applyReturnToStockLines).not.toHaveBeenCalledWith(
      'product-kit',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('never restores the pool twice when the return is re-posted (FX correction)', async () => {
    const { provider, tx, inventoryValuation } = makeProvider(undefined, 1);

    await provider.buildEntries('SALES_RETURN', 'return-1', tx as never);

    expect(inventoryValuation.applyReturnToStockLines).not.toHaveBeenCalled();
  });

  it('marks COGS / inventory reversal lines as functional so FX never multiplies cost', async () => {
    const { provider, tx } = makeProvider();

    const result = await provider.buildEntries(
      'SALES_RETURN',
      'return-1',
      tx as never,
    );

    const costLines = result!.lines.filter((line) =>
      ['cogs-category-1', 'inventory-category-1'].includes(line.accountId),
    );
    expect(costLines).toHaveLength(2);
    expect(costLines.every((line) => line.functionalAmount === true)).toBe(
      true,
    );
    const arLine = result!.lines.find((l) => l.accountId === 'account-ar');
    expect(arLine?.functionalAmount).toBeUndefined();
  });
});
