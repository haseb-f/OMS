import { BadRequestException } from '@nestjs/common';
import { FulfillmentRecognitionService } from './fulfillment-recognition.service';
import {
  pickupRecognitionAction,
  shipmentRecognitionAction,
  isRecognitionDue,
} from './recognition-routing';
import { classifyRecognitionError } from './recognition-errors';

/**
 * R14 W3 — unit coverage of the delivery-time recognition (moved here from the
 * former `store-order-generate-invoice.spec.ts`: the manual "Generate invoice"
 * is now the retry of this service). Stock is delivered per inventory line,
 * never for a service line, kits deliver their components; recognition is
 * refused before delivery (never gated on payment) and failures are recorded
 * on the order. The real-DB flows are in
 * `fulfillment-recognition.integration.serial.spec.ts`.
 */
/** The `code` of the business error a promise rejects with. */
async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { response?: { code?: string } }).response?.code;
  }
  return undefined;
}

/** The `data` of every `storeOrder.update` call. */
function updates(db: {
  storeOrder: { update: jest.Mock; updateMany: jest.Mock };
}): Record<string, unknown>[] {
  type Call = [{ data: Record<string, unknown> }];
  const direct = db.storeOrder.update.mock.calls as Call[];
  const many = db.storeOrder.updateMany.mock.calls as Call[];
  return [...direct, ...many].map(([arg]) => arg.data);
}

describe('FulfillmentRecognitionService (unit)', () => {
  const orderId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const userId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const warehouseId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  const product = (overrides: Record<string, unknown>) => ({
    status: 'ACTIVE',
    deletedAt: null,
    supplyMethod: 'PURCHASED',
    preferredWarehouseId: warehouseId,
    unitId: 'unit-1',
    categoryId: null,
    taxId: null,
    ownerAgentId: null,
    name: 'x',
    ...overrides,
  });
  const inventoryItem = {
    id: 'item-1',
    productId: 'product-inventory',
    quantity: 2,
    unitPrice: 100,
    agreedAmount: 200,
    product: product({
      id: 'product-inventory',
      sku: 'SKU-INV',
      isInventoryItem: true,
      currentCost: 40,
    }),
  };
  const serviceItem = {
    id: 'item-2',
    productId: 'product-service',
    quantity: 1,
    unitPrice: 50,
    agreedAmount: 50,
    product: product({
      id: 'product-service',
      sku: 'SKU-SVC',
      isInventoryItem: false,
      currentCost: null,
    }),
  };
  const kitItem = {
    id: 'item-3',
    productId: 'product-kit',
    quantity: 2,
    unitPrice: 300,
    agreedAmount: 600,
    product: product({
      id: 'product-kit',
      sku: 'SKU-KIT',
      isInventoryItem: false,
      supplyMethod: 'KIT',
      currentCost: null,
    }),
  };
  const delivered = {
    id: orderId,
    internalOrderId: 'SO-0001',
    agentId: null,
    partnerId: 'partner-1',
    currencyId: 'currency-1',
    fulfillmentMethod: 'SHIPPING',
    recognitionStatus: 'RESERVED',
    deletedAt: null,
    fulfillmentStatus: { code: 'DELIVERED' },
    shipments: [{ id: 'shipment-1', status: 'DELIVERED' }],
    items: [inventoryItem, serviceItem],
  };

  type ResolverLine = {
    productId: string;
    quantity: number;
    warehouseId: string;
    lineKey: string;
  };

  /** Mirrors StockLineResolver: stocked lines pass, the kit explodes (2 × A, 1 × B), services drop. */
  function resolveLines(lines: ResolverLine[]) {
    const stock: Array<Record<string, unknown>> = [];
    const kitSnapshots: Record<string, unknown> = {};
    for (const line of lines) {
      if (line.productId === 'product-inventory') {
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

  const costs: Record<string, number | null> = {
    'product-inventory': 40,
    'component-a': 10,
    'component-b': 15,
  };

  function makeService(order: Record<string, unknown> = delivered) {
    const db = {
      storeOrder: {
        findFirst: jest.fn().mockResolvedValue(order),
        findUnique: jest.fn().mockResolvedValue(order),
        update: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      salesInvoice: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockResolvedValue({ id: 'invoice-1', invoiceNumber: 'SI-0001' }),
      },
      salesInvoiceItem: { update: jest.fn().mockResolvedValue(undefined) },
      warehouse: {
        findFirst: jest.fn(),
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: warehouseId, code: 'WH', isActive: true, deletedAt: null },
          ]),
      },
      product: {
        findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            where.id.in.map((id) => ({
              id,
              sku: id.toUpperCase(),
              status: 'ACTIVE',
              deletedAt: null,
              categoryId: null,
              currentCost: costs[id] ?? null,
            })),
          ),
        ),
      },
      inventoryMovement: {
        groupBy: jest.fn(
          ({
            where,
          }: {
            where: { productId?: { in: string[] }; type?: { notIn?: unknown } };
          }) =>
            Promise.resolve(
              where.type?.notIn && where.productId
                ? where.productId.in.map((productId) => ({
                    productId,
                    warehouseId,
                    _sum: { quantity: 100 },
                  }))
                : [],
            ),
        ),
      },
      directFulfillmentCostRule: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(),
    };
    db.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(db),
    );
    const numberingEngine = {
      generateNumber: jest.fn().mockResolvedValue('SI-0001'),
    };
    const postingEngine = { post: jest.fn().mockResolvedValue(undefined) };
    const activityService = { log: jest.fn().mockResolvedValue(undefined) };
    const inventoryService = {
      postSalesDelivery: jest.fn().mockResolvedValue(undefined),
      reserve: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
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
      resolveCogsAccount: jest.fn().mockResolvedValue('cogs'),
      resolveInventoryAccount: jest.fn().mockResolvedValue('inventory'),
    };
    const service = new FulfillmentRecognitionService(
      db as never,
      numberingEngine as never,
      postingEngine as never,
      activityService as never,
      inventoryService as never,
      stockLines as never,
      fulfillmentCostService as never,
      collection as never,
      accountMapping as never,
    );
    return {
      service,
      db,
      inventoryService,
      postingEngine,
      accountMapping,
      collection,
      activityService,
    };
  }

  it('delivers physical stock for every inventory-item line and posts invoice, fulfillment and shipment cost', async () => {
    const { service, inventoryService, postingEngine, db } = makeService();

    await service.recognize(orderId, userId, 'MANUAL');

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
    expect(
      (postingEngine.post.mock.calls as unknown[][]).map((call) => call[0]),
    ).toEqual(['SALES_INVOICE', 'FULFILLMENT_COST', 'SHIPMENT_COST']);
    expect(
      updates(db).some((data) => data.recognitionStatus === 'RECOGNIZED'),
    ).toBe(true);
  });

  it('never calls postSalesDelivery for a non-inventory (service) line', async () => {
    const { service, inventoryService } = makeService();

    await service.recognize(orderId, userId, 'MANUAL');

    const calls = inventoryService.postSalesDelivery.mock.calls as Array<
      [{ productId: string }, string, unknown]
    >;
    expect(calls.map(([dto]) => dto.productId)).not.toContain(
      'product-service',
    );
  });

  it('delivers a kit line as its components, keyed per invoice line + component, and stores the recipe snapshot', async () => {
    const { service, inventoryService, db } = makeService({
      ...delivered,
      items: [kitItem],
    });

    await service.recognize(orderId, userId, 'MANUAL');

    const [[createArgs]] = db.salesInvoice.create.mock.calls as Array<
      [
        {
          data: { items: { create: Array<{ id: string; productId: string }> } };
        },
      ]
    >;
    const kitLineId = createArgs.data.items.create[0].id;
    const calls = inventoryService.postSalesDelivery.mock.calls as Array<
      [Record<string, unknown>]
    >;
    expect(calls.map(([dto]) => [dto.productId, dto.quantity])).toEqual([
      ['component-a', 4],
      ['component-b', 2],
    ]);
    expect(calls[0][0]).toMatchObject({
      parentProductId: 'product-kit',
      recipeId: 'recipe-1',
      idempotencyKey: `SALES_INVOICE:invoice-1:${kitLineId}:component-a:SALES_DELIVERY`,
    });
    expect(db.salesInvoiceItem.update).toHaveBeenCalledWith({
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
  });

  it('refuses a manual retry before delivery, whatever the payment status', async () => {
    const { service, db } = makeService({
      ...delivered,
      fulfillmentStatus: { code: 'SHIPPED' },
      shipments: [{ id: 'shipment-1', status: 'SHIPPED' }],
    });

    expect(await codeOf(service.recognize(orderId, userId, 'MANUAL'))).toBe(
      'RECOGNITION_NOT_DUE',
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('a delivery hook before delivery is a silent no-op', async () => {
    const { service, db } = makeService({
      ...delivered,
      shipments: [{ id: 'shipment-1', status: 'OUT_FOR_DELIVERY' }],
    });

    await expect(service.recognize(orderId, userId, 'HOOK')).resolves.toBe(
      null,
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('missing cost → FAILED with code MISSING_COST, never a zero-cost success', async () => {
    const { service, db, inventoryService } = makeService({
      ...delivered,
      items: [
        {
          ...inventoryItem,
          productId: 'product-nocost',
          product: { ...inventoryItem.product, id: 'product-nocost' },
        },
      ],
    });
    db.product.findMany.mockImplementation(
      ({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          where.id.in.map((id) => ({
            id,
            sku: 'SKU-NOCOST',
            status: 'ACTIVE',
            deletedAt: null,
            categoryId: null,
            currentCost: null,
          })),
        ),
    );
    const resolve = jest.fn((_tx: unknown, lines: ResolverLine[]) =>
      Promise.resolve({ stock: lines, kitSnapshots: {} }),
    );
    (service as unknown as { stockLines: { resolve: unknown } }).stockLines = {
      resolve,
    };

    await expect(service.recognize(orderId, userId, 'HOOK')).resolves.toBe(
      null,
    );
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(inventoryService.postSalesDelivery).not.toHaveBeenCalled();
    const failure = updates(db).find(
      (data) => data.recognitionStatus === 'FAILED',
    );
    expect(failure?.recognitionError).toMatchObject({
      code: 'MISSING_COST',
      productSku: 'SKU-NOCOST',
      stage: 'RECOGNITION',
    });
  });

  it('missing account mapping fails the preflight before any transaction and is thrown on a manual retry', async () => {
    const { service, db, accountMapping } = makeService();
    accountMapping.assertSalesInvoiceMappings.mockRejectedValue(
      new BadRequestException('No Inventory Asset account configured.'),
    );

    expect(await codeOf(service.recognize(orderId, userId, 'MANUAL'))).toBe(
      'MISSING_ACCOUNT_MAPPING',
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('an existing invoice is DUPLICATE for a manual retry and returned as-is for a hook', async () => {
    const { service, db } = makeService();
    db.salesInvoice.findFirst.mockResolvedValue({
      id: 'invoice-0',
      invoiceNumber: 'SI-0000',
    });

    expect(await codeOf(service.recognize(orderId, userId, 'MANUAL'))).toBe(
      'DUPLICATE',
    );
    await expect(service.recognize(orderId, userId, 'HOOK')).resolves.toEqual({
      id: 'invoice-0',
      invoiceNumber: 'SI-0000',
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('does not regenerate the invoice when customer receipt posting fails after commit', async () => {
    const { service, db, collection } = makeService();
    collection.syncVerifiedPayments.mockRejectedValue(
      new Error('receipt boom'),
    );

    await expect(service.recognize(orderId, userId, 'MANUAL')).rejects.toThrow(
      /was created, but customer receipt posting failed/,
    );
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('refuses an agent order on a manual retry and ignores it on a hook', async () => {
    const { service } = makeService({ ...delivered, agentId: 'agent-1' });
    expect(await codeOf(service.recognize(orderId, userId, 'MANUAL'))).toBe(
      'AGENT_ORDER_NO_COMPANY_INVOICE',
    );
    await expect(service.recognize(orderId, userId, 'HOOK')).resolves.toBe(
      null,
    );
  });
});

describe('recognition routing', () => {
  it('maps shipment transitions', () => {
    expect(shipmentRecognitionAction('SHIPPED')).toBe('RESERVE');
    expect(shipmentRecognitionAction('OUT_FOR_DELIVERY')).toBe('RESERVE');
    expect(shipmentRecognitionAction('DELIVERED')).toBe('RECOGNIZE');
    expect(shipmentRecognitionAction('DELIVERY_FAILED')).toBe('UNWIND');
    expect(shipmentRecognitionAction('NEEDS_RESHIPMENT')).toBe('UNWIND');
    expect(shipmentRecognitionAction('LABEL_CREATED')).toBe('NONE');
    expect(shipmentRecognitionAction(null, 'CUSTOM_CALLED')).toBe('NONE');
    // An administrator "returned" status keeps the previous enum status.
    expect(shipmentRecognitionAction('DELIVERED', 'RETURNED')).toBe('UNWIND');
  });

  it('maps pickup transitions', () => {
    expect(pickupRecognitionAction('READY_FOR_PICKUP')).toBe('RESERVE');
    expect(pickupRecognitionAction('COLLECTED')).toBe('RECOGNIZE');
    expect(pickupRecognitionAction('CANCELLED')).toBe('UNWIND');
    expect(pickupRecognitionAction('RETURNED')).toBe('UNWIND');
  });

  it('judges a shipped order by its latest attempt and a pickup by COLLECTED', () => {
    const shipped = (status: string, code = 'DELIVERED') => ({
      fulfillmentMethod: 'SHIPPING',
      fulfillmentStatus: { code },
      shipments: [{ status }],
    });
    expect(isRecognitionDue(shipped('DELIVERED', 'SHIPPED'))).toBe(true);
    expect(isRecognitionDue(shipped('DELIVERY_FAILED'))).toBe(false);
    expect(
      isRecognitionDue({
        fulfillmentMethod: 'SHIPPING',
        fulfillmentStatus: { code: 'DELIVERED' },
        shipments: [],
      }),
    ).toBe(true);
    expect(
      isRecognitionDue({
        fulfillmentMethod: 'PICKUP',
        fulfillmentStatus: { code: 'COLLECTED' },
      }),
    ).toBe(true);
    expect(
      isRecognitionDue({
        fulfillmentMethod: 'PICKUP',
        fulfillmentStatus: { code: 'READY_FOR_PICKUP' },
      }),
    ).toBe(false);
  });

  it('classifies write-time errors into actionable codes', () => {
    expect(
      classifyRecognitionError(
        new BadRequestException({
          code: 'INVENTORY_AVAILABLE_INSUFFICIENT',
          message: 'x',
        }),
      ).code,
    ).toBe('INSUFFICIENT_STOCK');
    expect(
      classifyRecognitionError(
        new BadRequestException('Product X has no recorded cost.'),
      ).code,
    ).toBe('MISSING_COST');
    expect(classifyRecognitionError(new Error('something else')).code).toBe(
      'RECOGNITION_ERROR',
    );
  });
});
