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
      isInventoryItem: true,
      preferredWarehouseId: warehouseId,
      unitId: 'unit-1',
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
      isInventoryItem: false,
      preferredWarehouseId: warehouseId,
      unitId: 'unit-1',
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

  function makeService() {
    const txClient = {
      salesInvoice: {
        create: jest.fn().mockResolvedValue({
          id: 'invoice-1',
          invoiceNumber: 'SI-0001',
        }),
      },
    };
    const prisma = {
      storeOrder: { findFirst: jest.fn().mockResolvedValue(orderRow) },
      salesInvoice: { findFirst: jest.fn().mockResolvedValue(null) },
      shippingStatus: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(txClient)),
    };
    const numberingEngine = {
      generateNumber: jest.fn().mockResolvedValue('SI-0001'),
    };
    const postingEngine = { post: jest.fn().mockResolvedValue(undefined) };
    const activityService = { log: jest.fn() };
    const salesScope = {
      resolve: jest.fn().mockResolvedValue({ kind: 'ALL' }),
      assertStoreOrderAccess: jest.fn(),
    };
    const inventoryService = {
      postSalesDelivery: jest.fn().mockResolvedValue(undefined),
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
    );
    return { service, inventoryService, postingEngine, prisma };
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
});
