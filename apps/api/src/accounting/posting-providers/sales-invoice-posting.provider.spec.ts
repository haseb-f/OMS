import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SalesInvoicePostingProvider } from './sales-invoice-posting.provider';

/**
 * R13 (spec §3B / §4 "Kit COGS") — COGS of a kit line is recognised ONCE, as
 * the sum of its components' snapshot costs (Dr the kit's COGS account / Cr
 * each component's inventory account); the kit itself never carries a stock
 * cost. Plain lines post round2(qty × 4-dp unit cost); services post none.
 */
describe('SalesInvoicePostingProvider.buildEntries — COGS', () => {
  const D = (value: number | string) => new Prisma.Decimal(value);

  const plainLine = {
    id: 'line-plain',
    productId: 'product-plain',
    quantity: 3,
    lineTotal: 300,
    taxAmount: 0,
    taxId: null,
    tax: null,
    unitCost: null,
    fulfillmentSnapshot: null,
    product: {
      isInventoryItem: true,
      supplyMethod: 'PURCHASED',
      categoryId: 'cat-plain',
      currentCost: D('12.3456'),
      sku: 'PLAIN',
    },
  };
  const serviceLine = {
    id: 'line-service',
    productId: 'product-service',
    quantity: 1,
    lineTotal: 50,
    taxAmount: 0,
    taxId: null,
    tax: null,
    unitCost: null,
    fulfillmentSnapshot: null,
    product: {
      isInventoryItem: false,
      supplyMethod: 'PURCHASED',
      categoryId: 'cat-service',
      currentCost: null,
      sku: 'SERVICE',
    },
  };
  const kitLine = {
    id: 'line-kit',
    productId: 'product-kit',
    quantity: 2,
    lineTotal: 600,
    taxAmount: 0,
    taxId: null,
    tax: null,
    unitCost: null,
    fulfillmentSnapshot: {
      recipeId: 'recipe-1',
      version: 2,
      components: [
        { productId: 'component-a', qtyPerKit: 2, unitCost: '10.1234' },
        { productId: 'component-b', qtyPerKit: 1, unitCost: '15' },
      ],
    },
    product: {
      isInventoryItem: false,
      supplyMethod: 'KIT',
      categoryId: 'cat-kit',
      currentCost: null,
      sku: 'KIT',
    },
  };

  function makeProvider(items: unknown[]) {
    const grandTotal = (items as Array<{ lineTotal: number }>).reduce(
      (sum, item) => sum + item.lineTotal,
      0,
    );
    const invoiceRow = {
      id: 'invoice-1',
      invoiceNumber: 'SI-0001',
      grandTotal,
      discountTotal: 0,
      currencyId: null,
      exchangeRate: 1,
      confirmedAt: new Date('2026-10-01'),
      createdAt: new Date('2026-10-01'),
      companyId: null,
      branchId: null,
      costCenterId: null,
      projectId: null,
      partner: { id: 'partner-1', customerProfile: null },
      items,
    };
    const tx = {
      salesInvoice: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(invoiceRow),
        update: jest.fn(),
      },
      salesInvoiceItem: { update: jest.fn() },
      product: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'component-a',
            sku: 'A',
            categoryId: 'cat-a',
            currentCost: D('10.1234'),
          },
          {
            id: 'component-b',
            sku: 'B',
            categoryId: 'cat-b',
            currentCost: D(15),
          },
        ]),
      },
    };
    const inventoryValuation = {
      getUnitCostDecimal: jest.fn().mockResolvedValue(D('12.3456')),
    };
    const accountMapping = {
      resolveReceivableAccount: jest.fn().mockResolvedValue('ar'),
      resolveSalesDiscountAccount: jest.fn().mockResolvedValue(null),
      resolveSalesRevenueAccount: jest.fn().mockResolvedValue('revenue'),
      resolveVatOutputAccount: jest.fn().mockResolvedValue('vat'),
      resolveCogsAccount: jest.fn((categoryId: string) =>
        Promise.resolve(`cogs-${categoryId}`),
      ),
      resolveInventoryAccount: jest.fn((categoryId: string) =>
        Promise.resolve(`inventory-${categoryId}`),
      ),
    };
    const provider = new SalesInvoicePostingProvider(
      {} as never,
      { registerProvider: jest.fn() } as never,
      inventoryValuation as never,
      accountMapping as never,
      { snapshotRate: jest.fn().mockResolvedValue(1) } as never,
    );
    return { provider, tx, inventoryValuation };
  }

  const amountOn = (
    lines: Array<{ accountId: string; debit?: number; credit?: number }>,
    accountId: string,
  ) => lines.filter((line) => line.accountId === accountId);

  it('books a kit line COGS once = Σ round2(qtyPerKit × qty × component cost), credited per component inventory account', async () => {
    const { provider, tx } = makeProvider([kitLine]);

    const result = await provider.buildEntries(
      'SALES_INVOICE',
      'invoice-1',
      tx as never,
    );

    // A: 2 × 2 × 10.1234 = 40.4936 → 40.49 · B: 1 × 2 × 15 = 30.00
    expect(amountOn(result!.lines, 'cogs-cat-kit')).toEqual([
      expect.objectContaining({ debit: 70.49, functionalAmount: true }),
    ]);
    expect(amountOn(result!.lines, 'inventory-cat-a')).toEqual([
      expect.objectContaining({ credit: 40.49, functionalAmount: true }),
    ]);
    expect(amountOn(result!.lines, 'inventory-cat-b')).toEqual([
      expect.objectContaining({ credit: 30, functionalAmount: true }),
    ]);
    // The kit itself carries no stock cost.
    expect(amountOn(result!.lines, 'inventory-cat-kit')).toHaveLength(0);
    // unitCost = Σ qtyPerKit × component cost = 2 × 10.1234 + 15 = 35.2468
    expect(tx.salesInvoiceItem.update).toHaveBeenCalledWith({
      where: { id: 'line-kit' },
      data: { unitCost: D('35.2468') },
    });
  });

  it('posts plain lines at round2(qty × 4-dp cost), snapshots the cost once, and nothing for a service', async () => {
    const { provider, tx } = makeProvider([plainLine, serviceLine]);

    const result = await provider.buildEntries(
      'SALES_INVOICE',
      'invoice-1',
      tx as never,
    );

    // 3 × 12.3456 = 37.0368 → 37.04
    expect(amountOn(result!.lines, 'cogs-cat-plain')).toEqual([
      expect.objectContaining({ debit: 37.04 }),
    ]);
    expect(amountOn(result!.lines, 'inventory-cat-plain')).toEqual([
      expect.objectContaining({ credit: 37.04 }),
    ]);
    expect(amountOn(result!.lines, 'cogs-cat-service')).toHaveLength(0);
    expect(tx.salesInvoiceItem.update).toHaveBeenCalledTimes(1);
    expect(tx.salesInvoiceItem.update).toHaveBeenCalledWith({
      where: { id: 'line-plain' },
      data: { unitCost: D('12.3456') },
    });
  });

  it('replays an already-recorded unit cost on a re-post (never re-reads the live average)', async () => {
    const { provider, tx, inventoryValuation } = makeProvider([
      { ...plainLine, unitCost: D(11) },
    ]);

    const result = await provider.buildEntries(
      'SALES_INVOICE',
      'invoice-1',
      tx as never,
    );

    expect(inventoryValuation.getUnitCostDecimal).not.toHaveBeenCalled();
    expect(tx.salesInvoiceItem.update).not.toHaveBeenCalled();
    expect(amountOn(result!.lines, 'cogs-cat-plain')).toEqual([
      expect.objectContaining({ debit: 33 }),
    ]);
  });

  it('keeps the entry balanced with a kit, a plain and a service line together', async () => {
    const { provider, tx } = makeProvider([kitLine, plainLine, serviceLine]);

    const result = await provider.buildEntries(
      'SALES_INVOICE',
      'invoice-1',
      tx as never,
    );

    const debit = result!.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const credit = result!.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    expect(Math.round(debit * 100)).toBe(Math.round(credit * 100));
  });

  it('refuses a kit line without its fulfillment snapshot (COGS can never silently be zero)', async () => {
    const { provider, tx } = makeProvider([
      { ...kitLine, fulfillmentSnapshot: null },
    ]);

    await expect(
      provider.buildEntries('SALES_INVOICE', 'invoice-1', tx as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a kit whose component has no recorded cost', async () => {
    const { provider, tx } = makeProvider([kitLine]);
    tx.product.findMany.mockResolvedValue([
      { id: 'component-a', sku: 'A', categoryId: 'cat-a', currentCost: null },
      { id: 'component-b', sku: 'B', categoryId: 'cat-b', currentCost: D(15) },
    ]);

    await expect(
      provider.buildEntries('SALES_INVOICE', 'invoice-1', tx as never),
    ).rejects.toThrow(/no recorded cost/);
  });
});
