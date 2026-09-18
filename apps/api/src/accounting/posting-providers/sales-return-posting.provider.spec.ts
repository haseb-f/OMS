import { SalesReturnPostingProvider } from './sales-return-posting.provider';

/**
 * M1 recovery — regression for the confirmed foundation defect: a Sales
 * Return's `postSalesReturn` restored physical on-hand quantity, and its
 * posting provider already reversed COGS/Inventory in the Journal Entry at
 * the original sale's historical unit cost, but neither ever re-blended
 * that quantity into the moving-average valuation pool — silently
 * diverging `Product.currentCost` from the GL Inventory balance this
 * reversal just restored. Locks in that `buildEntries` now calls
 * `InventoryValuationService.applyReturnToStock` once per inventory-item
 * line, at the exact same historical unit cost the journal reversal uses,
 * and never for a non-inventory line.
 */
describe('SalesReturnPostingProvider.buildEntries — valuation pool restoration', () => {
  const inventoryLine = {
    id: 'line-1',
    productId: 'product-inventory',
    quantity: 5,
    lineTotal: 550,
    taxAmount: 0,
    taxId: null,
    tax: null,
    product: { isInventoryItem: true, categoryId: 'category-1' },
    salesInvoiceItem: { unitCost: 110 },
  };
  const serviceLine = {
    id: 'line-2',
    productId: 'product-service',
    quantity: 1,
    lineTotal: 50,
    taxAmount: 0,
    taxId: null,
    tax: null,
    product: { isInventoryItem: false, categoryId: 'category-1' },
    salesInvoiceItem: null,
  };

  function makeProvider() {
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
      items: [inventoryLine, serviceLine],
    };
    const tx = {
      salesReturn: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(salesReturnRow),
        update: jest.fn(),
      },
    };
    const postingEngine = { registerProvider: jest.fn() };
    const inventoryValuation = {
      applyReturnToStock: jest
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
      resolveCogsAccount: jest.fn().mockResolvedValue('account-cogs'),
      resolveInventoryAccount: jest.fn().mockResolvedValue('account-inventory'),
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

  it('restores the valuation pool at the historical unit cost, once per inventory line', async () => {
    const { provider, tx, inventoryValuation } = makeProvider();

    await provider.buildEntries('SALES_RETURN', 'return-1', tx as never);

    expect(inventoryValuation.applyReturnToStock).toHaveBeenCalledTimes(1);
    expect(inventoryValuation.applyReturnToStock).toHaveBeenCalledWith(
      'product-inventory',
      5,
      110,
      tx,
      undefined,
    );
  });

  it('never restores valuation for a non-inventory line', async () => {
    const { provider, tx, inventoryValuation } = makeProvider();

    await provider.buildEntries('SALES_RETURN', 'return-1', tx as never);

    expect(inventoryValuation.applyReturnToStock).not.toHaveBeenCalledWith(
      'product-service',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
});
