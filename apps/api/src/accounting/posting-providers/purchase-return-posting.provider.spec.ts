import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PurchaseReturnPostingProvider } from './purchase-return-posting.provider';
import { InventoryValuationService } from '../inventory-valuation/inventory-valuation.service';
import type { PostingLine } from '../posting-engine/posting-provider.interface';

/**
 * Owner decision O9 (2026-10-06) — a purchase return relieves Inventory at the
 * moving average recorded on its PURCHASE_RETURN movement; the difference to
 * the supplier's net credit (functional) goes to the category COGS account.
 */
describe('PurchaseReturnPostingProvider.buildEntries — O9 relief at moving average', () => {
  const RETURN_ID = 'return-1';
  const stockedLine = (overrides: Record<string, unknown> = {}) => ({
    id: 'line-1',
    productId: 'product-1',
    quantity: 5,
    lineTotal: 100,
    taxAmount: 0,
    taxId: null,
    tax: null,
    product: { isInventoryItem: true, categoryId: 'category-1' },
    ...overrides,
  });
  const movementFor = (lineId: string, unitCost: string | null) => ({
    idempotencyKey: `PURCHASE_RETURN:${RETURN_ID}:${lineId}:PURCHASE_RETURN`,
    unitCost: unitCost == null ? null : new Prisma.Decimal(unitCost),
  });

  function makeProvider(input: {
    items: unknown[];
    grandTotal: number;
    exchangeRate?: number;
    movements?: unknown[];
  }) {
    const tx = {
      purchaseReturn: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: RETURN_ID,
          returnNumber: 'PR-0001',
          grandTotal: input.grandTotal,
          currencyId: 'currency-1',
          exchangeRate: input.exchangeRate ?? 1,
          confirmedAt: new Date('2026-10-06'),
          createdAt: new Date('2026-10-06'),
          companyId: null,
          branchId: null,
          costCenterId: null,
          projectId: null,
          partner: { id: 'supplier-1' },
          items: input.items,
        }),
        update: jest.fn(),
      },
      inventoryMovement: {
        findMany: jest.fn().mockResolvedValue(input.movements ?? []),
      },
    };
    const accountMapping = {
      resolvePayableAccount: jest.fn().mockResolvedValue('account-ap'),
      resolveInventoryAccount: jest.fn().mockResolvedValue('account-inventory'),
      resolveCogsAccount: jest.fn().mockResolvedValue('account-cogs'),
      resolvePurchaseAccount: jest.fn().mockResolvedValue('account-purchase'),
      resolveVatInputAccount: jest.fn().mockResolvedValue('account-vat'),
    };
    const provider = new PurchaseReturnPostingProvider(
      {} as never,
      { registerProvider: jest.fn() } as never,
      accountMapping as never,
      { snapshotRate: jest.fn() } as never,
    );
    return { provider, tx };
  }

  const build = async (input: Parameters<typeof makeProvider>[0]) => {
    const { provider, tx } = makeProvider(input);
    const result = await provider.buildEntries(
      'PURCHASE_RETURN',
      RETURN_ID,
      tx as unknown as Prisma.TransactionClient,
    );
    return { result: result!, tx };
  };
  const line = (lines: PostingLine[], accountId: string) =>
    lines.find((l) => l.accountId === accountId);
  /** Same conversion the Posting Engine applies: non-functional lines × rate. */
  const functionalTotals = (lines: PostingLine[], rate: number) => {
    const conv = (amount = 0, functional?: boolean) =>
      functional ? amount : Math.round(amount * rate * 100) / 100;
    return {
      debit: lines.reduce((s, l) => s + conv(l.debit, l.functionalAmount), 0),
      credit: lines.reduce((s, l) => s + conv(l.credit, l.functionalAmount), 0),
    };
  };

  it('return price above average → Cr Inventory at average, Cr COGS for the difference', async () => {
    const { result } = await build({
      items: [stockedLine()],
      grandTotal: 100,
      movements: [movementFor('line-1', '15.0000')],
    });
    expect(line(result.lines, 'account-ap')).toMatchObject({ debit: 100 });
    expect(line(result.lines, 'account-inventory')).toMatchObject({
      credit: 75,
      functionalAmount: true,
    });
    expect(line(result.lines, 'account-cogs')).toMatchObject({
      credit: 25,
      functionalAmount: true,
    });
    expect(line(result.lines, 'account-cogs')?.debit).toBeUndefined();
    expect(functionalTotals(result.lines, 1)).toEqual({
      debit: 100,
      credit: 100,
    });
  });

  it('return price below average → Dr COGS for the difference', async () => {
    const { result } = await build({
      items: [stockedLine({ lineTotal: 50 })],
      grandTotal: 50,
      movements: [movementFor('line-1', '15.0000')],
    });
    expect(line(result.lines, 'account-inventory')).toMatchObject({
      credit: 75,
    });
    expect(line(result.lines, 'account-cogs')).toMatchObject({
      debit: 25,
      functionalAmount: true,
    });
    expect(functionalTotals(result.lines, 1)).toEqual({
      debit: 75,
      credit: 75,
    });
  });

  it('return price equal to average → no COGS line', async () => {
    const { result } = await build({
      items: [stockedLine({ lineTotal: 75 })],
      grandTotal: 75,
      movements: [movementFor('line-1', '15.0000')],
    });
    expect(line(result.lines, 'account-cogs')).toBeUndefined();
    expect(line(result.lines, 'account-inventory')).toMatchObject({
      credit: 75,
    });
  });

  it('foreign-currency document: AP/VAT at the frozen rate, relief functional, difference in functional', async () => {
    // 5 units returned for 50 USD + 5 USD VAT at rate 2 → supplier credits 100 net functional.
    const { result } = await build({
      items: [
        stockedLine({
          lineTotal: 55,
          taxAmount: 5,
          taxId: 'tax-1',
          tax: { id: 'tax-1' },
        }),
      ],
      grandTotal: 55,
      exchangeRate: 2,
      movements: [movementFor('line-1', '15.0000')],
    });
    expect(result.exchangeRate).toBe(2);
    expect(line(result.lines, 'account-ap')).toMatchObject({ debit: 55 });
    expect(line(result.lines, 'account-ap')?.functionalAmount).toBeFalsy();
    expect(line(result.lines, 'account-vat')).toMatchObject({ credit: 5 });
    expect(line(result.lines, 'account-inventory')).toMatchObject({
      credit: 75,
      functionalAmount: true,
    });
    expect(line(result.lines, 'account-cogs')).toMatchObject({
      credit: 25,
      functionalAmount: true,
    });
    expect(functionalTotals(result.lines, 2)).toEqual({
      debit: 110,
      credit: 110,
    });
  });

  it('replays the cost recorded on the movement (re-post never reads the current average)', async () => {
    const { result, tx } = await build({
      items: [stockedLine()],
      grandTotal: 100,
      movements: [movementFor('line-1', '12.3456')],
    });
    // 5 × 12.3456 = 61.728 → 61.73; difference 100 − 61.73 = 38.27.
    expect(line(result.lines, 'account-inventory')).toMatchObject({
      credit: 61.73,
    });
    expect(line(result.lines, 'account-cogs')).toMatchObject({
      credit: 38.27,
    });
    const [query] = tx.inventoryMovement.findMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(query.where).toMatchObject({
      type: 'PURCHASE_RETURN',
      referenceType: 'PURCHASE_RETURN',
      referenceId: RETURN_ID,
    });
    expect((tx as Record<string, unknown>).product).toBeUndefined();
  });

  it('non-stock line keeps the purchase/expense account; a pre-O9 stocked line (no recorded cost) is re-built as originally posted', async () => {
    const { result } = await build({
      items: [
        stockedLine({ id: 'line-legacy', lineTotal: 80 }),
        stockedLine({
          id: 'line-service',
          productId: 'service-1',
          lineTotal: 20,
          product: { isInventoryItem: false, categoryId: 'category-1' },
        }),
      ],
      grandTotal: 100,
      movements: [movementFor('line-legacy', null)],
    });
    expect(line(result.lines, 'account-inventory')).toMatchObject({
      credit: 80,
    });
    expect(
      line(result.lines, 'account-inventory')?.functionalAmount,
    ).toBeFalsy();
    expect(line(result.lines, 'account-purchase')).toMatchObject({
      credit: 20,
    });
    expect(line(result.lines, 'account-cogs')).toBeUndefined();
  });
});

describe('InventoryValuationService.getPurchaseReturnReliefCosts', () => {
  const service = new InventoryValuationService({} as never);
  const tx = (costs: Record<string, string | null>) =>
    ({
      product: {
        findMany: jest.fn().mockResolvedValue(
          Object.entries(costs).map(([id, cost]) => ({
            id,
            currentCost: cost == null ? null : new Prisma.Decimal(cost),
          })),
        ),
      },
    }) as unknown as Prisma.TransactionClient;

  it('returns the current moving average at 4 dp (a recorded 0 is allowed)', async () => {
    const costs = await service.getPurchaseReturnReliefCosts(
      tx({ a: '15.12345', b: '0' }),
      [
        { id: 'a', sku: 'A' },
        { id: 'b', sku: 'B' },
      ],
    );
    expect(costs.get('a')?.toString()).toBe('15.1235');
    expect(costs.get('b')?.toString()).toBe('0');
  });

  it('fails closed with a 422 for a product with no recorded cost', async () => {
    const run = service.getPurchaseReturnReliefCosts(tx({ a: null }), [
      { id: 'a', sku: 'SKU-A' },
    ]);
    await expect(run).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(run).rejects.toMatchObject({
      response: { code: 'PURCHASE_RETURN_COST_MISSING' },
    });
  });
});
