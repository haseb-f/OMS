import { BadRequestException } from '@nestjs/common';
import { StoreOrdersService } from './store-orders.service';
import {
  StoreOrderPaymentStatus,
  StoreOrderShippingStage,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * M1 recovery — regression for the confirmed foundation defect:
 * `generateInvoice()` used to post the accounting/valuation side of a Store
 * Order sale (Dr COGS / Cr Inventory via `SalesInvoicePostingProvider`)
 * without ever decrementing physical stock, unlike the symmetric B2B
 * `SalesInvoicesService.confirm()`, which always calls both in the same
 * transaction. Locks in that the fix calls `InventoryService.postSalesDelivery`
 * once per inventory-item line, and never for a non-stocked (service) line.
 */
describe('StoreOrdersService.generateInvoice — physical inventory delivery', () => {
  const orderId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const userId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const warehouseId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  const inventoryItem = {
    id: 'item-1',
    productId: 'product-inventory',
    quantity: 2,
    unitPrice: 100,
    agreedAmount: 200,
    product: {
      id: 'product-inventory',
      sku: 'SKU-INV',
      isInventoryItem: true,
      preferredWarehouseId: warehouseId,
      unitId: 'unit-1',
      categoryId: null,
      currentCost: 40,
      taxId: null,
    },
  };
  const serviceItem = {
    id: 'item-2',
    productId: 'product-service',
    quantity: 1,
    unitPrice: 50,
    agreedAmount: 50,
    product: {
      id: 'product-service',
      sku: 'SKU-SVC',
      isInventoryItem: false,
      preferredWarehouseId: warehouseId,
      unitId: 'unit-1',
      categoryId: null,
      currentCost: null,
      taxId: null,
    },
  };

  const orderRow = {
    id: orderId,
    deletedAt: null,
    internalOrderId: 'SO-0001',
    partnerId: 'partner-1',
    currencyId: 'currency-1',
    paymentStatus: StoreOrderPaymentStatus.FULLY_PAID_RECONCILED,
    shippingStage: StoreOrderShippingStage.READY_FOR_SHIPPING,
    shipments: [],
    items: [inventoryItem, serviceItem],
    receipts: [],
    payments: [],
  };

  const kitItem = {
    id: 'item-3',
    productId: 'product-kit',
    quantity: 2,
    unitPrice: 300,
    agreedAmount: 600,
    product: {
      id: 'product-kit',
      sku: 'SKU-KIT',
      isInventoryItem: false,
      supplyMethod: 'KIT',
      preferredWarehouseId: warehouseId,
      unitId: 'unit-1',
      categoryId: null,
      currentCost: null,
      taxId: null,
    },
  };

  type ResolverLine = {
    productId: string;
    quantity: number;
    warehouseId: string;
    lineKey: string;
  };

  /** Mirrors StockLineResolver: stocked lines pass, the kit explodes (2 × A, 1 × B), services drop. */
  function resolveLines(lines: ResolverLine[]) {
    const byProduct = new Map(
      [inventoryItem, serviceItem, kitItem].map((item) => [
        item.productId,
        item.product,
      ]),
    );
    const stock: Array<Record<string, unknown>> = [];
    const kitSnapshots: Record<string, unknown> = {};
    for (const line of lines) {
      const product = byProduct.get(line.productId)!;
      if (product.isInventoryItem) {
        stock.push({ ...line });
        continue;
      }
      if (line.productId !== 'product-kit') continue;
      const components = [
        { productId: 'component-a', qtyPerKit: 2, unitCost: '10.0000' },
        { productId: 'component-b', qtyPerKit: 1, unitCost: '15.0000' },
      ];
      kitSnapshots[line.lineKey] = {
        recipeId: 'recipe-1',
        version: 3,
        components,
      };
      for (const component of components) {
        stock.push({
          productId: component.productId,
          quantity: component.qtyPerKit * line.quantity,
          warehouseId: line.warehouseId,
          lineKey: line.lineKey,
          parentProductId: 'product-kit',
          recipeId: 'recipe-1',
          recipeVersion: 3,
        });
      }
    }
    return Promise.resolve({ stock, kitSnapshots });
  }

  function makeService() {
    const txClient = {
      salesInvoice: {
        create: jest.fn().mockResolvedValue({
          id: 'invoice-1',
          invoiceNumber: 'SI-0001',
        }),
      },
      salesInvoiceItem: { update: jest.fn().mockResolvedValue(undefined) },
      product: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'component-a', currentCost: '10.0000' },
          { id: 'component-b', currentCost: '15.0000' },
        ]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const prisma = {
      storeOrder: { findFirst: jest.fn().mockResolvedValue(orderRow) },
      salesInvoice: { findFirst: jest.fn().mockResolvedValue(null) },
      shippingStatus: { findFirst: jest.fn().mockResolvedValue(null) },
      warehouse: { findFirst: jest.fn() },
      directFulfillmentCostRule: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(txClient)),
    };
    const numberingEngine = {
      generateNumber: jest.fn().mockResolvedValue('SI-0001'),
    };
    const postingEngine = { post: jest.fn().mockResolvedValue(undefined) };
    const activityService = { log: jest.fn() };
    const salesScope = {
      resolve: jest.fn().mockResolvedValue({ kind: 'ALL' }),
      assertStoreOrderAccessById: jest.fn(),
    };
    const inventoryService = {
      postSalesDelivery: jest.fn().mockResolvedValue(undefined),
    };
    const stockLines = {
      resolve: jest.fn((_tx: unknown, lines: ResolverLine[]) =>
        resolveLines(lines),
      ),
    };
    const fulfillmentCostService = {
      applyStandardCost: jest.fn().mockResolvedValue(undefined),
    };
    const collection = {
      syncVerifiedPayments: jest.fn().mockResolvedValue([]),
    };
    const accountMapping = {
      assertSalesInvoiceMappings: jest.fn().mockResolvedValue(undefined),
    };

    const service = new StoreOrdersService(
      prisma as unknown as PrismaService,
      {} as never,
      numberingEngine as never,
      postingEngine as never,
      activityService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      salesScope as never,
      {} as never,
      inventoryService as never,
      stockLines as never,
      fulfillmentCostService as never,
      collection as never,
      {} as never,
      accountMapping as never,
    );
    return {
      service,
      inventoryService,
      postingEngine,
      prisma,
      accountMapping,
      collection,
      txClient,
    };
  }

  it('delivers physical stock for every inventory-item line, and posts the accounting entry', async () => {
    const { service, inventoryService, postingEngine } = makeService();

    await service.generateInvoice(orderId, userId);

    expect(inventoryService.postSalesDelivery).toHaveBeenCalledTimes(1);
    expect(inventoryService.postSalesDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'product-inventory',
        warehouseId,
        quantity: 2,
        referenceType: 'SALES_INVOICE',
        referenceId: 'invoice-1',
      }),
      userId,
      expect.anything(),
    );
    expect(postingEngine.post).toHaveBeenCalledWith(
      'SALES_INVOICE',
      'invoice-1',
      userId,
      expect.anything(),
    );
  });

  it('never calls postSalesDelivery for a non-inventory (service) line', async () => {
    const { service, inventoryService } = makeService();

    await service.generateInvoice(orderId, userId);

    const calls = inventoryService.postSalesDelivery.mock.calls as Array<
      [{ productId: string }, string, unknown]
    >;
    const calledProductIds = calls.map(([dto]) => dto.productId);
    expect(calledProductIds).not.toContain('product-service');
  });

  it('delivers a kit line as its components, keyed per invoice line + component, and stores the recipe snapshot', async () => {
    const { service, inventoryService, prisma, txClient } = makeService();
    prisma.storeOrder.findFirst.mockResolvedValueOnce({
      ...orderRow,
      items: [kitItem],
    });

    await service.generateInvoice(orderId, userId);

    const [[createArgs]] = txClient.salesInvoice.create.mock.calls as Array<
      [
        {
          data: { items: { create: Array<{ id: string; productId: string }> } };
        },
      ]
    >;
    const kitLineId = createArgs.data.items.create[0].id;
    expect(kitLineId).toEqual(expect.any(String));
    const calls = inventoryService.postSalesDelivery.mock.calls as Array<
      [Record<string, unknown>]
    >;
    expect(calls.map(([dto]) => [dto.productId, dto.quantity])).toEqual([
      ['component-a', 4],
      ['component-b', 2],
    ]);
    expect(calls[0][0]).toMatchObject({
      referenceType: 'SALES_INVOICE',
      referenceId: 'invoice-1',
      parentProductId: 'product-kit',
      recipeId: 'recipe-1',
      idempotencyKey: `SALES_INVOICE:invoice-1:${kitLineId}:component-a:SALES_DELIVERY`,
    });
    expect(calls.some(([dto]) => dto.productId === 'product-kit')).toBe(false);
    expect(txClient.salesInvoiceItem.update).toHaveBeenCalledWith({
      where: { id: kitLineId },
      data: {
        fulfillmentSnapshot: {
          recipeId: 'recipe-1',
          version: 3,
          components: [
            { productId: 'component-a', qtyPerKit: 2, unitCost: '10' },
            { productId: 'component-b', qtyPerKit: 1, unitCost: '15' },
          ],
        },
      },
    });
    // Every product row (kit + components) is locked once, before delivering.
    expect(txClient.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects generating an invoice before the order is fully paid & reconciled', async () => {
    const { service, prisma } = makeService();
    prisma.storeOrder.findFirst.mockResolvedValueOnce({
      ...orderRow,
      paymentStatus: StoreOrderPaymentStatus.PAYMENT_PENDING,
    });

    await expect(service.generateInvoice(orderId, userId)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('preflights account mappings before opening the invoice transaction', async () => {
    const { service, prisma, accountMapping } = makeService();
    accountMapping.assertSalesInvoiceMappings.mockRejectedValue(
      new BadRequestException('No Inventory Asset account configured.'),
    );

    await expect(service.generateInvoice(orderId, userId)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not regenerate the invoice when customer receipt posting fails after commit', async () => {
    const { service, prisma, collection } = makeService();
    collection.syncVerifiedPayments.mockRejectedValue(
      new Error('receipt boom'),
    );

    await expect(service.generateInvoice(orderId, userId)).rejects.toThrow(
      /was created, but customer receipt posting failed/,
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
