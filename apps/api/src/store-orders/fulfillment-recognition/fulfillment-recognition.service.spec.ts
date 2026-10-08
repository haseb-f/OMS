import { BadRequestException } from '@nestjs/common';
import { FulfillmentRecognitionService } from './fulfillment-recognition.service';
import {
  pickupRecognitionAction,
  recognitionTargets,
  shipmentRecognitionAction,
  isRecognitionDue,
} from './recognition-routing';
import { classifyRecognitionError } from './recognition-errors';

/**
 * R14 W3 / R15 W5a — unit coverage of the delivery-time recognition: one
 * invoice per delivered shipment (accepted quantities, prorated amounts,
 * issued out of the goods-in-transit warehouse) or the whole order issued
 * from its warehouse (pickup, pre-R15 delivery). Stock is delivered per
 * inventory line, never for a service line, kits deliver their components;
 * recognition is refused before delivery (never gated on payment) and
 * failures are recorded on the order. The real-DB flows are in
 * `fulfillment-recognition.integration.serial.spec.ts` and
 * `stock-lifecycle.integration.serial.spec.ts`.
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
  storeOrder: { update: jest.Mock };
}): Record<string, unknown>[] {
  type Call = [{ data: Record<string, unknown> }];
  return (db.storeOrder.update.mock.calls as Call[]).map(([arg]) => arg.data);
}

describe('FulfillmentRecognitionService (unit)', () => {
  const orderId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const userId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const warehouseId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const transitId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

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
  /** Delivered before R15: the shipment has no lines → one whole-order invoice from the warehouse. */
  const delivered = {
    id: orderId,
    internalOrderId: 'SO-0001',
    agentId: null,
    partnerId: 'partner-1',
    currencyId: 'currency-1',
    fulfillmentMethod: 'SHIPPING',
    recognitionStatus: 'NOT_DUE',
    deletedAt: null,
    fulfillmentStatus: { code: 'DELIVERED' },
    shipments: [
      { id: 'shipment-1', attemptNumber: 1, status: 'DELIVERED', lines: [] },
    ],
    invoices: [] as Array<Record<string, unknown>>,
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
    // Once an invoice is created, re-reads of the order see it.
    const issued: Array<Record<string, unknown>> = [];
    const current = () => ({
      ...order,
      invoices: [...(order.invoices as unknown[]), ...issued],
    });
    const db = {
      storeOrder: {
        findFirst: jest.fn(() => Promise.resolve(current())),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(current())),
        // The return-status recompute (L3) reads the order's recognition state.
        findUnique: jest.fn(() => Promise.resolve(current())),
        update: jest.fn().mockResolvedValue(undefined),
      },
      salesInvoice: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }: { data: { shipmentId: string | null } }) => {
          const invoice = {
            id: 'invoice-1',
            invoiceNumber: 'SI-0001',
            shipmentId: data.shipmentId,
          };
          issued.push(invoice);
          return Promise.resolve(invoice);
        }),
      },
      salesInvoiceItem: { update: jest.fn().mockResolvedValue(undefined) },
      warehouse: {
        findFirst: jest.fn(),
        // The preferred warehouse is a STOCK one (no row for the role filter).
        findMany: jest.fn(({ where }: { where: { role?: unknown } }) =>
          Promise.resolve(
            where.role
              ? []
              : [
                  {
                    id: warehouseId,
                    code: 'WH',
                    isActive: true,
                    deletedAt: null,
                  },
                  {
                    id: transitId,
                    code: 'WH-TRANSIT',
                    isActive: true,
                    deletedAt: null,
                  },
                ],
          ),
        ),
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
        findUnique: jest.fn().mockResolvedValue({ sku: 'SKU' }),
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
    const carrierCod = {
      onCodShipmentDelivered: jest
        .fn()
        .mockResolvedValue({ status: 'NOT_APPLICABLE' }),
    };
    const accountMapping = {
      assertSalesInvoiceMappings: jest.fn().mockResolvedValue(undefined),
      resolveCogsAccount: jest.fn().mockResolvedValue('cogs'),
      resolveInventoryAccount: jest.fn().mockResolvedValue('inventory'),
    };
    const stock = {
      transitWarehouseId: jest.fn().mockResolvedValue(transitId),
      orderTransitBalance: jest
        .fn()
        .mockResolvedValue(new Map([['product-inventory', 2]])),
      releaseAllForIssueInTx: jest.fn().mockResolvedValue(undefined),
      refreshInTx: jest.fn().mockResolvedValue(null),
      afterOrderCancelled: jest.fn().mockResolvedValue(undefined),
      afterPickupReady: jest.fn().mockResolvedValue(undefined),
      goodsInTransit: jest.fn().mockResolvedValue(0),
      // The components each shipment line carried into transit (here: the same explosion).
      shipmentStockLines: jest.fn(
        (
          _client: unknown,
          _orderId: string,
          _shipmentId: string,
          lines: Array<{
            storeOrderItemId: string;
            quantity: number;
            lineKey: string;
          }>,
        ) =>
          resolveLines(
            lines.map((line) => ({
              productId: (
                order.items as Array<{ id: string; productId: string }>
              ).find((item) => item.id === line.storeOrderItemId)!.productId,
              quantity: line.quantity,
              warehouseId: transitId,
              lineKey: line.lineKey,
            })),
          ),
      ),
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
      carrierCod as never,
      accountMapping as never,
      stock as never,
    );
    return {
      service,
      db,
      inventoryService,
      postingEngine,
      accountMapping,
      collection,
      carrierCod,
      activityService,
      stock,
    };
  }

  it('whole order (pre-R15 delivery): releases the reservation, issues every inventory line from its warehouse and posts invoice, fulfillment and shipment cost', async () => {
    const { service, inventoryService, postingEngine, db, stock } =
      makeService();

    await service.recognize(orderId, userId, 'MANUAL');

    expect(stock.releaseAllForIssueInTx).toHaveBeenCalledTimes(1);
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
    const [[createArgs]] = db.salesInvoice.create.mock
      .calls as unknown as Array<[{ data: { shipmentId: string | null } }]>;
    expect(createArgs.data.shipmentId).toBe('shipment-1');
    expect(
      updates(db).some((data) => data.recognitionStatus === 'RECOGNIZED'),
    ).toBe(true);
  });

  it('per shipment: invoices the accepted quantity at its prorated amount, out of transit, after checking the order holds it there', async () => {
    const { service, inventoryService, db, stock } = makeService({
      ...delivered,
      items: [{ ...inventoryItem, quantity: 3, agreedAmount: 100 }],
      shipments: [
        {
          id: 'shipment-1',
          attemptNumber: 1,
          status: 'DELIVERED',
          lines: [
            { storeOrderItemId: 'item-1', quantity: 3, deliveredQuantity: 1 },
          ],
        },
      ],
    });

    await service.recognize(orderId, userId, 'HOOK');

    const [[created]] = db.salesInvoice.create.mock.calls as unknown as Array<
      [
        {
          data: {
            shipmentId: string;
            grandTotal: number;
            items: { create: Array<{ quantity: number; warehouseId: string }> };
          };
        },
      ]
    >;
    expect(created.data.shipmentId).toBe('shipment-1');
    expect(created.data.grandTotal).toBe(33.33);
    expect(created.data.items.create).toEqual([
      expect.objectContaining({ quantity: 1, warehouseId }),
    ]);
    expect(stock.releaseAllForIssueInTx).not.toHaveBeenCalled();
    expect(stock.orderTransitBalance).toHaveBeenCalled();
    expect(inventoryService.postSalesDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'product-inventory',
        warehouseId: transitId,
        quantity: 1,
      }),
      userId,
      expect.anything(),
    );
  });

  it('per shipment: refuses to issue more than the order holds in transit (never another order’s goods)', async () => {
    const { service, inventoryService, stock, db } = makeService({
      ...delivered,
      items: [inventoryItem],
      shipments: [
        {
          id: 'shipment-1',
          attemptNumber: 1,
          status: 'DELIVERED',
          lines: [
            { storeOrderItemId: 'item-1', quantity: 2, deliveredQuantity: 2 },
          ],
        },
      ],
    });
    stock.orderTransitBalance.mockResolvedValue(
      new Map([['product-inventory', 1]]),
    );

    await expect(service.recognize(orderId, userId, 'HOOK')).resolves.toBe(
      null,
    );
    expect(inventoryService.postSalesDelivery).not.toHaveBeenCalled();
    expect(
      updates(db).some((data) => data.recognitionStatus === 'FAILED'),
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

    const [[createArgs]] = db.salesInvoice.create.mock
      .calls as unknown as Array<
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
      shipments: [
        { id: 'shipment-1', attemptNumber: 1, status: 'SHIPPED', lines: [] },
      ],
    });

    expect(await codeOf(service.recognize(orderId, userId, 'MANUAL'))).toBe(
      'RECOGNITION_NOT_DUE',
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('a delivery hook before delivery is a silent no-op', async () => {
    const { service, db } = makeService({
      ...delivered,
      shipments: [
        {
          id: 'shipment-1',
          attemptNumber: 1,
          status: 'OUT_FOR_DELIVERY',
          lines: [],
        },
      ],
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
    expect(db.salesInvoice.create).not.toHaveBeenCalled();
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

  it('missing account mapping fails the preflight before the invoice and is thrown on a manual retry', async () => {
    const { service, db, accountMapping } = makeService();
    accountMapping.assertSalesInvoiceMappings.mockRejectedValue(
      new BadRequestException('No Inventory Asset account configured.'),
    );

    expect(await codeOf(service.recognize(orderId, userId, 'MANUAL'))).toBe(
      'MISSING_ACCOUNT_MAPPING',
    );
    expect(db.salesInvoice.create).not.toHaveBeenCalled();
  });

  it('nothing left to invoice is DUPLICATE for a manual retry and returned as-is for a hook', async () => {
    const { service, db } = makeService({
      ...delivered,
      invoices: [
        { id: 'invoice-0', invoiceNumber: 'SI-0000', shipmentId: 'shipment-1' },
      ],
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
    expect(db.salesInvoice.create).toHaveBeenCalledTimes(1);
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

  it('a delivered shipment also records the carrier COD expectation (W5b hook)', async () => {
    const { service, carrierCod } = makeService();
    await service.afterShipmentStatus(
      orderId,
      { id: 'shipment-1', status: 'DELIVERED' },
      userId,
    );
    expect(carrierCod.onCodShipmentDelivered).toHaveBeenCalledWith(
      'shipment-1',
      userId,
    );
    await service.afterShipmentStatus(
      orderId,
      { id: 'shipment-1', status: 'SHIPPED' },
      userId,
    );
    expect(carrierCod.onCodShipmentDelivered).toHaveBeenCalledTimes(1);
  });
});

describe('recognition routing', () => {
  it('maps shipment transitions — the physical steps are no longer recognition actions', () => {
    expect(shipmentRecognitionAction('SHIPPED')).toBe('NONE');
    expect(shipmentRecognitionAction('OUT_FOR_DELIVERY')).toBe('NONE');
    expect(shipmentRecognitionAction('DELIVERED')).toBe('RECOGNIZE');
    expect(shipmentRecognitionAction('DELIVERY_FAILED')).toBe('NONE');
    expect(shipmentRecognitionAction('NEEDS_RESHIPMENT')).toBe('NONE');
    expect(shipmentRecognitionAction('LABEL_CREATED')).toBe('NONE');
    expect(shipmentRecognitionAction(null, 'CUSTOM_CALLED')).toBe('NONE');
    // An administrator "returned" status keeps the previous enum status.
    expect(shipmentRecognitionAction('DELIVERED', 'RETURNED')).toBe(
      'RETURN_PENDING',
    );
  });

  it('maps pickup transitions', () => {
    expect(pickupRecognitionAction('READY_FOR_PICKUP')).toBe('RESERVE');
    expect(pickupRecognitionAction('COLLECTED')).toBe('RECOGNIZE');
    expect(pickupRecognitionAction('CANCELLED')).toBe('RELEASE');
    expect(pickupRecognitionAction('RETURNED')).toBe('RETURN_PENDING');
  });

  it('one invoice per delivered shipment; whole order for a pickup / pre-R15 delivery', () => {
    const shipment = (
      id: string,
      attemptNumber: number,
      status: string,
      delivered: number[] | null,
    ) => ({
      id,
      attemptNumber,
      status,
      lines: (delivered ?? []).map((deliveredQuantity) => ({
        deliveredQuantity,
      })),
    });
    const shipping = (
      shipments: ReturnType<typeof shipment>[],
      invoices: { shipmentId: string | null }[] = [],
      code = 'DELIVERED',
    ) => ({
      fulfillmentMethod: 'SHIPPING',
      fulfillmentStatus: { code },
      shipments,
      invoices,
    });

    expect(
      recognitionTargets(
        shipping([
          shipment('s1', 1, 'DELIVERED', [1]),
          shipment('s2', 2, 'DELIVERED', [2]),
        ]),
      ),
    ).toEqual([
      { kind: 'SHIPMENT', shipmentId: 's1' },
      { kind: 'SHIPMENT', shipmentId: 's2' },
    ]);
    // An invoiced shipment is done; a failed one is not due.
    expect(
      recognitionTargets(
        shipping(
          [
            shipment('s1', 1, 'DELIVERED', [1]),
            shipment('s2', 2, 'DELIVERY_FAILED', [2]),
          ],
          [{ shipmentId: 's1' }],
        ),
      ),
    ).toEqual([]);
    // Delivered before R15 (no lines) → the whole order.
    expect(
      recognitionTargets(shipping([shipment('s1', 1, 'DELIVERED', null)])),
    ).toEqual([{ kind: 'WHOLE_ORDER', shipmentId: 's1' }]);
    // An R14 whole-order invoice: nothing more.
    expect(
      recognitionTargets(
        shipping([shipment('s1', 1, 'DELIVERED', [1])], [{ shipmentId: null }]),
      ),
    ).toEqual([]);
    // Delivered without any shipment row.
    expect(isRecognitionDue(shipping([]))).toBe(true);
    expect(isRecognitionDue(shipping([], [], 'SHIPPED'))).toBe(false);
    expect(
      isRecognitionDue({
        fulfillmentMethod: 'PICKUP',
        fulfillmentStatus: { code: 'COLLECTED' },
        shipments: [],
        invoices: [],
      }),
    ).toBe(true);
    expect(
      isRecognitionDue({
        fulfillmentMethod: 'PICKUP',
        fulfillmentStatus: { code: 'READY_FOR_PICKUP' },
        shipments: [],
        invoices: [],
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
