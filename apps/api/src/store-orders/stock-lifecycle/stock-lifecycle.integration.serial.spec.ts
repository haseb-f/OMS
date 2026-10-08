import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { HttpException } from '@nestjs/common';
import {
  AccountType,
  InventoryMovementType,
  JournalEntryStatus,
  PartnerRoleType,
  Prisma,
  StoreOrderFulfillmentMethod,
  StoreOrderPaymentType,
  WarehouseRole,
  type ProductSupplyMethod,
} from '@prisma/client';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsCoreModule } from '../../permissions/permissions-core.module';
import { PhoneModule } from '../../common/phone/phone.module';
import { AuthModule } from '../../auth/auth.module';
import { FxModule } from '../../accounting/fx/fx.module';
import { PostingProvidersModule } from '../../accounting/posting-providers/posting-providers.module';
import { InventoryModule } from '../../inventory/inventory.module';
import { InventoryService } from '../../inventory/inventory.service';
import { RecipesModule } from '../../recipes/recipes.module';
import { RecipeManagementService } from '../../recipes/recipe-management.service';
import { AgentLedgerModule } from '../../agents/finance/agent-ledger.module';
import { TraceabilityModule } from '../../traceability/traceability.module';
import { TraceabilityService } from '../../traceability/traceability.service';
import { WorkflowEngineService } from '../../workflow/workflow-engine.service';
import { WorkflowStatusResolverService } from '../../workflow/workflow-status-resolver.service';
import { StoreOrdersModule } from '../store-orders.module';
import { StoreOrdersService } from '../store-orders.service';
import { StoreOrderShipmentOperationsService } from '../shipments/store-order-shipment-operations.service';
import { FulfillmentRecognitionService } from '../fulfillment-recognition/fulfillment-recognition.service';
import { StoreOrderAmendmentsModule } from '../amendments/store-order-amendments.module';
import { StoreOrderAmendmentsService } from '../amendments/store-order-amendments.service';
import type { AmendChangesDto } from '../amendments/dto/amend-store-order.dto';
import { StoreOrderStockService } from './store-order-stock.service';
import { StockBackfillService } from './stock-backfill.service';
import { STORE_ORDER_TRANSIT_REFERENCE } from './stock-ledger';

const D = (value: string | number | Prisma.Decimal) =>
  new Prisma.Decimal(value);

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error: unknown) {
    if (!(error instanceof HttpException)) throw error;
    const body = error.getResponse();
    return typeof body === 'string' ? body : (body as { code?: string }).code;
  }
  throw new Error('expected the operation to be rejected');
}

/**
 * R15 W5a (spec-w5a §Tests, decisions D15-1 … D15-8, D15-20) — the store-order
 * stock lifecycle against the real local Postgres (run with DATABASE_URL on a
 * local test DB such as oms_r15_w5a, never `oms`): reservation at creation,
 * SHORT and "Reserve now", dispatch to goods in transit (no journal, no
 * payment), delivery out of transit (one invoice per shipment, COGS at the
 * moving average, stock reduced exactly once), partial dispatch / acceptance,
 * failed delivery and cancellation in transit, goods received back (saleable
 * / damaged), pickup, kits, services, agent-owned goods, lead conversion,
 * idempotency under repeated / concurrent callbacks, and the backfill.
 * Every scenario drives the real services (creation, shipment operations,
 * pickup workflow, hooks). Tagged fixtures (W5A-<tag>) are kept.
 */
describe('Store order stock lifecycle (integration)', () => {
  jest.setTimeout(900_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let inventory: InventoryService;
  let recipes: RecipeManagementService;
  let storeOrders: StoreOrdersService;
  let shipping: StoreOrderShipmentOperationsService;
  let stock: StoreOrderStockService;
  let backfill: StockBackfillService;
  let workflow: WorkflowEngineService;
  let traceability: TraceabilityService;
  let statusResolver: WorkflowStatusResolverService;
  let recognition: FulfillmentRecognitionService;
  let amendments: StoreOrderAmendmentsService;

  const tag = randomUUID().slice(0, 8).toUpperCase();
  let actorId: string;
  let unitId: string;
  let warehouseId: string;
  let transitId: string;
  let damagedId: string;
  let currencyId: string;
  let shippedStatusId: string;
  let deliveredStatusId: string;
  let deliveryFailedStatusId: string;
  let agentId: string;
  let saCountryId: string;
  let qualifiedStatusId: string;
  let seq = 0;
  const phone = `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

  const makeCategory = async () => {
    const suffix = `${++seq}`;
    const account = async (kind: string, accountType: AccountType) =>
      (
        await prisma.chartOfAccount.create({
          data: {
            code: `W5A-${tag}-${suffix}-${kind}`,
            name: `W5A ${suffix} ${kind} ${tag}`,
            accountType,
          },
        })
      ).id;
    const inventoryAccountId = await account('INV', AccountType.ASSET);
    const cogsAccountId = await account('COGS', AccountType.EXPENSE);
    const category = await prisma.productCategory.create({
      data: { name: `w5a-${tag}-${suffix}`, inventoryAccountId, cogsAccountId },
    });
    return { id: category.id, inventoryAccountId, cogsAccountId };
  };

  const makeProduct = async (opts: {
    categoryId: string;
    supply?: ProductSupplyMethod;
    cost?: number;
    service?: boolean;
    owner?: string;
  }) => {
    const suffix = `${++seq}`;
    const kit = opts.supply === 'KIT';
    return (
      await prisma.product.create({
        data: {
          sku: `W5A-${tag}-${suffix}`,
          name: `W5A ${tag} ${suffix}`,
          internalName: `W5A ${suffix}`,
          displayName: `W5A ${suffix}`,
          categoryId: opts.categoryId,
          unitId,
          preferredWarehouseId: warehouseId,
          type: opts.service ? 'SERVICE' : 'PURCHASE_AND_SALE',
          itemType: opts.service ? 'SERVICE' : 'PRODUCT',
          supplyMethod: opts.supply ?? 'PURCHASED',
          isPurchasable: !kit && !opts.service,
          isSellable: true,
          isInventoryItem: !kit && !opts.service,
          ownerAgentId: opts.owner ?? null,
          currentCost: opts.cost,
        },
      })
    ).id;
  };

  const open = (productId: string, quantity: number) =>
    inventory.openingBalance({ productId, warehouseId, quantity });

  const sumAt = async (productId: string, at: string) =>
    (
      await prisma.inventoryMovement.aggregate({
        where: {
          productId,
          warehouseId: at,
          type: {
            notIn: [
              InventoryMovementType.RESERVATION,
              InventoryMovementType.RESERVATION_RELEASE,
            ],
          },
        },
        _sum: { quantity: true },
      })
    )._sum.quantity ?? 0;
  const whOnHand = (productId: string) => sumAt(productId, warehouseId);
  const inTransit = (productId: string) => sumAt(productId, transitId);
  const owned = async (productId: string) =>
    (await inventory.getStock(productId)).onHand;
  const available = async (productId: string) =>
    (await inventory.getStock(productId)).available;

  /** Through the real creation path (manual / import / agent portal all call it). */
  const createOrder = async (
    lines: { productId: string; quantity: number; unitPrice: number }[],
    opts: { pickup?: boolean; cod?: boolean } = {},
  ) =>
    storeOrders.create({
      partner: { name: `W5A customer ${tag}`, phone },
      currencyId,
      paymentType: opts.cod
        ? StoreOrderPaymentType.CASH_ON_DELIVERY
        : StoreOrderPaymentType.PREPAID,
      fulfillmentMethod: opts.pickup
        ? StoreOrderFulfillmentMethod.PICKUP
        : StoreOrderFulfillmentMethod.SHIPPING,
      items: lines,
    });

  const itemOf = async (orderId: string, productId?: string) =>
    prisma.storeOrderItem.findFirstOrThrow({
      where: { storeOrderId: orderId, ...(productId ? { productId } : {}) },
    });

  const view = (orderId: string) => stock.view(orderId);
  const ship = (
    orderId: string,
    lines?: { storeOrderItemId: string; quantity: number }[],
  ) => shipping.markShipped(orderId, actorId, undefined, { lines });
  const deliver = (
    orderId: string,
    deliveredLines?: { storeOrderItemId: string; quantity: number }[],
  ) => shipping.markDelivered(orderId, actorId, undefined, { deliveredLines });

  const invoicesOf = (storeOrderId: string) =>
    prisma.salesInvoice.findMany({
      where: { storeOrderId, deletedAt: null, status: { not: 'CANCELLED' } },
      include: { items: true },
      orderBy: { createdAt: 'asc' },
    });

  const transitMovements = (orderId: string) =>
    prisma.inventoryMovement.count({
      where: {
        referenceType: STORE_ORDER_TRANSIT_REFERENCE,
        referenceId: orderId,
      },
    });

  const journalOf = async (sourceType: string, sourceId: string) => {
    const entries = await prisma.journalEntry.findMany({
      where: {
        sourceType,
        sourceId,
        status: JournalEntryStatus.POSTED,
        reversalOfEntryId: null,
      },
      include: { lines: true },
    });
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    const sum = (accountId: string, side: 'debit' | 'credit') =>
      entry.lines
        .filter((line) => line.accountId === accountId)
        .reduce((total, line) => total.add(line[side]), D(0));
    const totals = entry.lines.reduce(
      (acc, line) => ({
        debit: acc.debit.add(line.debit),
        credit: acc.credit.add(line.credit),
      }),
      { debit: D(0), credit: D(0) },
    );
    return {
      debit: (id: string) => sum(id, 'debit'),
      credit: (id: string) => sum(id, 'credit'),
      totals,
    };
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        FxModule,
        PostingProvidersModule,
        InventoryModule,
        RecipesModule,
        StoreOrdersModule,
        StoreOrderAmendmentsModule,
        AgentLedgerModule,
        TraceabilityModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    const get = <T>(type: new (...args: never[]) => T) =>
      moduleRef.get(type, { strict: false });
    inventory = get(InventoryService);
    recipes = get(RecipeManagementService);
    storeOrders = get(StoreOrdersService);
    shipping = get(StoreOrderShipmentOperationsService);
    stock = get(StoreOrderStockService);
    backfill = get(StockBackfillService);
    workflow = get(WorkflowEngineService);
    traceability = get(TraceabilityService);
    statusResolver = get(WorkflowStatusResolverService);
    recognition = get(FulfillmentRecognitionService);
    amendments = get(StoreOrderAmendmentsService);

    const lower = tag.toLowerCase();
    actorId = (
      await prisma.user.create({
        data: {
          email: `w5a-${lower}@test.local`,
          username: `w5a-${lower}`,
          fullName: `W5A ${tag}`,
          passwordHash: 'x',
          isSuperAdmin: true,
        },
      })
    ).id;
    unitId = (await prisma.unit.create({ data: { name: `w5a-${tag}-pc` } })).id;
    warehouseId = (
      await prisma.warehouse.create({
        data: { code: `W5A-${tag}`, name: `W5A WH ${tag}` },
      })
    ).id;
    const system = (role: WarehouseRole) =>
      prisma.warehouse.findFirstOrThrow({
        where: { role, isActive: true, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
    transitId = (await system(WarehouseRole.TRANSIT)).id;
    damagedId = (await system(WarehouseRole.DAMAGED)).id;
    currencyId = (await prisma.postingSettings.findFirstOrThrow())
      .functionalCurrencyId!;
    const statusId = async (code: string) =>
      (
        await prisma.shippingStatus.findFirstOrThrow({
          where: { code, deletedAt: null },
          select: { id: true },
        })
      ).id;
    shippedStatusId = await statusId('SHIPPED');
    deliveredStatusId = await statusId('DELIVERED');
    deliveryFailedStatusId = await statusId('DELIVERY_FAILED');
    saCountryId = (
      await prisma.country.findFirstOrThrow({ where: { code: 'SA' } })
    ).id;
    qualifiedStatusId = (
      await prisma.statusDefinition.findFirstOrThrow({
        where: { workflowType: 'LEAD', code: 'QUALIFIED' },
      })
    ).id;
    const agentPartner = await prisma.partner.create({
      data: {
        partnerNumber: `PT-W5A-${tag}-AGT`,
        name: `W5A agent ${tag}`,
        roles: { create: { role: PartnerRoleType.AGENT } },
      },
    });
    agentId = (
      await prisma.agent.create({
        data: {
          agentNumber: `AG-W5A-${tag}`,
          partnerId: agentPartner.id,
          name: `W5A Agent ${tag}`,
          currencyId,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('reserves at creation (prepaid, unpaid), never oversells: SHORT order refused at dispatch, "Reserve now" after a receipt; dispatch → transit with no journal / payment; delivery → one invoice, COGS at the moving average, stock out exactly once', async () => {
    const cat = await makeCategory();
    const product = await makeProduct({ categoryId: cat.id, cost: 25 });
    await open(product, 10);

    const a = await createOrder([
      { productId: product, quantity: 3, unitPrice: 100 },
    ]);
    let va = await view(a.id);
    expect(va.stockStatus).toBe('RESERVED');
    expect(va.lines[0]).toMatchObject({ ordered: 3, reserved: 3, short: 0 });
    expect(va.lines[0].reservations[0]).toMatchObject({
      quantity: 3,
      warehouse: { id: warehouseId },
    });
    expect(await available(product)).toBe(7);
    expect(await owned(product)).toBe(10); // a reservation is not a sale

    const b = await createOrder([
      { productId: product, quantity: 8, unitPrice: 10 },
    ]);
    let vb = await view(b.id);
    expect(vb.stockStatus).toBe('SHORT');
    expect(vb.stockIssue).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      lines: [expect.objectContaining({ required: 8, available: 7 })],
    });
    expect(vb.stockIssue!.messageAr).toContain('احجز الآن');
    expect(await available(product)).toBe(7);
    expect(await codeOf(ship(b.id))).toBe('STOCK_NOT_RESERVED');
    const bShipment = await prisma.shipment.findFirstOrThrow({
      where: { storeOrderId: b.id, deletedAt: null },
    });
    expect(bShipment.status).toBeNull(); // the impossible status was not recorded

    await open(product, 5);
    vb = await stock.reserveNow(b.id, actorId);
    expect(vb.stockStatus).toBe('RESERVED');
    expect(vb.stockIssue).toBeNull();
    expect(await available(product)).toBe(4);

    const journalsBefore = await prisma.journalEntry.count();
    const transactionsBefore = await prisma.financialTransaction.count();
    await ship(a.id);
    expect(await whOnHand(product)).toBe(12);
    expect(await inTransit(product)).toBeGreaterThanOrEqual(3);
    expect(await owned(product)).toBe(15); // still company inventory
    expect(await available(product)).toBe(4); // unchanged by dispatch
    // The order forms read the same figure (STOCK warehouses only).
    expect(
      (await stock.availabilityFor([{ productId: product, quantity: 5 }]))
        .lines[0],
    ).toMatchObject({ available: 4, sufficient: false, warehouseId });
    va = await view(a.id);
    expect(va.stockStatus).toBe('IN_TRANSIT');
    expect(va.lines[0]).toMatchObject({ reserved: 0, inTransit: 3 });
    expect(await prisma.journalEntry.count()).toBe(journalsBefore);
    expect(await prisma.financialTransaction.count()).toBe(transactionsBefore);
    expect(await prisma.payment.count({ where: { storeOrderId: a.id } })).toBe(
      0,
    );

    await deliver(a.id);
    const [invoice, ...more] = await invoicesOf(a.id);
    expect(more).toHaveLength(0);
    const aShipment = await prisma.shipment.findFirstOrThrow({
      where: { storeOrderId: a.id, deletedAt: null },
    });
    expect(invoice.shipmentId).toBe(aShipment.id);
    expect(Number(invoice.grandTotal)).toBe(300);
    expect(await owned(product)).toBe(12); // reduced exactly once
    expect(await whOnHand(product)).toBe(12);
    const issued = await prisma.inventoryMovement.findMany({
      where: { referenceId: invoice.id, type: 'SALES_DELIVERY' },
    });
    expect(issued).toHaveLength(1);
    expect(issued[0].warehouseId).toBe(transitId);
    const sale = await journalOf('SALES_INVOICE', invoice.id);
    expect(sale.totals.debit.equals(sale.totals.credit)).toBe(true);
    expect(sale.debit(cat.cogsAccountId).toString()).toBe('75'); // 3 × 25
    expect(sale.credit(cat.inventoryAccountId).toString()).toBe('75');
    va = await view(a.id);
    expect(va.stockStatus).toBe('DELIVERED');
    expect(va.postedCogs).toBe(75); // read from the journal
    expect(
      (await prisma.storeOrder.findUniqueOrThrow({ where: { id: a.id } }))
        .recognitionStatus,
    ).toBe('RECOGNIZED');

    // Traceability: the transit transfers and the invoice delivery are linked.
    const trace = await traceability.trace('STORE_ORDER', a.id, actorId);
    const movements = trace.groups.find((g) => g.key === 'STOCK_MOVEMENTS')!;
    expect(movements.state).toBe('FOUND');
    expect(movements.items.map((m) => m.status)).toEqual(
      expect.arrayContaining([
        'RESERVATION',
        'RESERVATION_RELEASE',
        'TRANSFER',
        'SALES_DELIVERY',
      ]),
    );
  });

  it('COD: partial dispatch, partial acceptance (one invoice per delivered shipment, prorated), the refused unit received back saleable and re-reserved, the rest on a next shipment — invoices add up to the order', async () => {
    const cat = await makeCategory();
    const product = await makeProduct({ categoryId: cat.id, cost: 10 });
    await open(product, 10);
    const order = await createOrder(
      [{ productId: product, quantity: 3, unitPrice: 100 }],
      { cod: true },
    );
    const item = await itemOf(order.id);

    await ship(order.id, [{ storeOrderItemId: item.id, quantity: 2 }]);
    let v = await view(order.id);
    expect(v.lines[0]).toMatchObject({ reserved: 1, inTransit: 2 });
    expect(await whOnHand(product)).toBe(8);

    await deliver(order.id, [{ storeOrderItemId: item.id, quantity: 1 }]);
    let invoices = await invoicesOf(order.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].items[0].quantity).toBe(1);
    expect(Number(invoices[0].grandTotal)).toBe(100);
    v = await view(order.id);
    expect(v.stockStatus).toBe('PARTIALLY_DELIVERED');
    expect(v.lines[0]).toMatchObject({
      delivered: 1,
      inTransit: 1,
      reserved: 1,
    });
    expect(v.canReceiveBack).toBe(true);

    // The refused unit comes back saleable → its warehouse, re-reserved.
    const key = randomUUID();
    await stock.receiveBack(
      order.id,
      {
        idempotencyKey: key,
        lines: [
          { storeOrderItemId: item.id, quantity: 1, condition: 'SALEABLE' },
        ],
      },
      actorId,
    );
    const movementsAfterReceipt = await prisma.inventoryMovement.count({
      where: { referenceId: order.id },
    });
    await stock.receiveBack(
      order.id,
      {
        idempotencyKey: key,
        lines: [
          { storeOrderItemId: item.id, quantity: 1, condition: 'SALEABLE' },
        ],
      },
      actorId,
    );
    expect(
      await prisma.inventoryMovement.count({
        where: { referenceId: order.id },
      }),
    ).toBe(movementsAfterReceipt); // same receipt → nothing new
    v = await view(order.id);
    expect(v.lines[0]).toMatchObject({
      inTransit: 0,
      reserved: 2,
      returnedSaleable: 1,
    });
    expect(await whOnHand(product)).toBe(9);

    // A next shipment carries what is still to go.
    await shipping.createNextShipment(order.id, actorId);
    await ship(order.id);
    await deliver(order.id);
    invoices = await invoicesOf(order.id);
    expect(invoices).toHaveLength(2);
    expect(invoices[1].items[0].quantity).toBe(2);
    expect(Number(invoices[1].grandTotal)).toBe(200);
    expect(invoices.reduce((s, i) => s + Number(i.grandTotal), 0)).toBe(300);
    expect(new Set(invoices.map((i) => i.shipmentId)).size).toBe(2);
    v = await view(order.id);
    expect(v.stockStatus).toBe('DELIVERED');
    expect(v.postedCogs).toBe(30);
    expect(await owned(product)).toBe(7);
    expect(await whOnHand(product)).toBe(7);
    // COGS booked once per delivered unit: 1 × 10 + 2 × 10.
    expect(
      (await journalOf('SALES_INVOICE', invoices[0].id))
        .debit(cat.cogsAccountId)
        .toString(),
    ).toBe('10');
    expect(
      (await journalOf('SALES_INVOICE', invoices[1].id))
        .debit(cat.cogsAccountId)
        .toString(),
    ).toBe('20');
  });

  it('failed delivery keeps the goods in transit (RETURNING); a reshipment carries them without a second transfer; goods received back damaged go to the damaged-goods warehouse and are never available', async () => {
    const cat = await makeCategory();
    const product = await makeProduct({ categoryId: cat.id, cost: 4 });
    await open(product, 5);
    const order = await createOrder([
      { productId: product, quantity: 2, unitPrice: 10 },
    ]);
    const item = await itemOf(order.id);

    await ship(order.id);
    await shipping.markDeliveryFailed(order.id, actorId);
    let v = await view(order.id);
    expect(v.stockStatus).toBe('RETURNING');
    expect(v.lines[0]).toMatchObject({ inTransit: 2, reserved: 0, short: 0 });
    expect(await whOnHand(product)).toBe(3); // nothing released or returned automatically

    await shipping.markNeedsReshipment(order.id, actorId);
    await shipping.createReshipment(order.id, actorId);
    const transfers = await transitMovements(order.id);
    await ship(order.id);
    expect(await transitMovements(order.id)).toBe(transfers);
    v = await view(order.id);
    expect(v.stockStatus).toBe('IN_TRANSIT');
    expect(v.shipments.at(-1)!.lines[0]).toMatchObject({
      quantity: 2,
      carried: 2,
    });

    await shipping.markDeliveryFailed(order.id, actorId);
    await stock.receiveBack(
      order.id,
      {
        idempotencyKey: randomUUID(),
        lines: [
          { storeOrderItemId: item.id, quantity: 1, condition: 'SALEABLE' },
          { storeOrderItemId: item.id, quantity: 1, condition: 'DAMAGED' },
        ],
      },
      actorId,
    );
    expect(await sumAt(product, damagedId)).toBe(1);
    expect(await whOnHand(product)).toBe(4);
    const stockRow = await inventory.getStock(product);
    expect(stockRow).toMatchObject({ onHand: 5, damaged: 1, inTransit: 0 });
    // 4 at the warehouse, 1 re-reserved for the order → 3 available; the damaged unit never.
    expect(stockRow.available).toBe(3);
    v = await view(order.id);
    expect(v.lines[0]).toMatchObject({
      returnedSaleable: 1,
      returnedDamaged: 1,
      reserved: 1,
      inTransit: 0,
    });
    expect(
      await codeOf(
        stock.receiveBack(
          order.id,
          {
            idempotencyKey: randomUUID(),
            lines: [
              { storeOrderItemId: item.id, quantity: 1, condition: 'SALEABLE' },
            ],
          },
          actorId,
        ),
      ),
    ).toBe('RECEIVE_EXCEEDS_IN_TRANSIT');
  });

  it('cancelled in transit → RETURNING, nothing released until the goods are received; a cancelled order is not re-reserved (RETURNED); cancelled before dispatch → RELEASED', async () => {
    const cat = await makeCategory();
    const product = await makeProduct({ categoryId: cat.id, cost: 3 });
    await open(product, 6);
    const out = await createOrder([
      { productId: product, quantity: 2, unitPrice: 10 },
    ]);
    const item = await itemOf(out.id);
    await ship(out.id);
    await storeOrders.archive(out.id, actorId);
    let v = await view(out.id);
    expect(v.stockStatus).toBe('RETURNING');
    expect(v.lines[0]).toMatchObject({ inTransit: 2, reserved: 0 });
    expect(await whOnHand(product)).toBe(4);
    await stock.receiveBack(
      out.id,
      {
        idempotencyKey: randomUUID(),
        lines: [
          { storeOrderItemId: item.id, quantity: 2, condition: 'SALEABLE' },
        ],
      },
      actorId,
    );
    v = await view(out.id);
    expect(v.stockStatus).toBe('RETURNED');
    expect(v.lines[0].reserved).toBe(0);
    expect(await available(product)).toBe(6);

    const early = await createOrder([
      { productId: product, quantity: 2, unitPrice: 10 },
    ]);
    expect(await available(product)).toBe(4);
    await storeOrders.archive(early.id, actorId);
    expect((await view(early.id)).stockStatus).toBe('RELEASED');
    expect(await available(product)).toBe(6);

    // An archived order stays traceable, with the refund of its advance
    // (allocated to the order itself, D15-11) among its returns / refunds.
    const refund = await prisma.financialTransaction.create({
      data: {
        transactionNumber: `RF-W5A-${tag}-${++seq}`,
        type: 'CUSTOMER_REFUND',
        amount: 20,
        allocations: {
          create: { storeOrderId: early.id, allocatedAmount: 20 },
        },
      },
    });
    const trace = await traceability.trace('STORE_ORDER', early.id, actorId);
    expect(trace.record?.id).toBe(early.id);
    expect(
      trace.groups
        .find((g) => g.key === 'RETURNS')!
        .items.some(
          (item) => item.kind === 'CUSTOMER_REFUND' && item.id === refund.id,
        ),
    ).toBe(true);
  });

  it('pickup: reserved at creation, collected → issued straight from the warehouse (no transit), one invoice', async () => {
    const cat = await makeCategory();
    const product = await makeProduct({ categoryId: cat.id, cost: 3 });
    await open(product, 5);
    const order = await createOrder(
      [{ productId: product, quantity: 2, unitPrice: 15 }],
      { pickup: true },
    );
    expect((await view(order.id)).stockStatus).toBe('RESERVED');
    await storeOrders.transitionPickup(order.id, 'READY_FOR_PICKUP', actorId);
    await storeOrders.transitionPickup(order.id, 'COLLECTED', actorId);
    const invoices = await invoicesOf(order.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].shipmentId).toBeNull();
    expect(await whOnHand(product)).toBe(3);
    expect(await transitMovements(order.id)).toBe(0);
    expect((await view(order.id)).stockStatus).toBe('DELIVERED');
    expect(await available(product)).toBe(3);
  });

  it('kit: components reserved, transferred and issued out of transit; COGS once from the components', async () => {
    const catA = await makeCategory();
    const catB = await makeCategory();
    const catKit = await makeCategory();
    const a = await makeProduct({ categoryId: catA.id, cost: 10 });
    const b = await makeProduct({ categoryId: catB.id, cost: 15 });
    const kit = await makeProduct({ categoryId: catKit.id, supply: 'KIT' });
    await open(a, 6);
    await open(b, 3);
    const draft = await recipes.create(
      kit,
      {
        lines: [
          { componentProductId: a, quantity: '2', unitId },
          { componentProductId: b, quantity: '1', unitId },
        ],
      },
      actorId,
    );
    await recipes.activate(draft.id, actorId);
    const order = await createOrder([
      { productId: kit, quantity: 2, unitPrice: 300 },
    ]);
    let v = await view(order.id);
    expect(v.stockStatus).toBe('RESERVED');
    expect(v.lines[0].reserved).toBe(2);
    expect(await available(a)).toBe(2);
    expect(await available(b)).toBe(1);

    await ship(order.id);
    expect(await whOnHand(a)).toBe(2);
    expect(await whOnHand(b)).toBe(1);
    await deliver(order.id);
    const [invoice] = await invoicesOf(order.id);
    const deliveries = await prisma.inventoryMovement.findMany({
      where: { referenceId: invoice.id, type: 'SALES_DELIVERY' },
    });
    expect(deliveries).toHaveLength(2);
    expect(
      deliveries.every(
        (m) => m.parentProductId === kit && m.warehouseId === transitId,
      ),
    ).toBe(true);
    expect(await owned(a)).toBe(2);
    expect(await owned(b)).toBe(1);
    const sale = await journalOf('SALES_INVOICE', invoice.id);
    expect(sale.debit(catKit.cogsAccountId).toString()).toBe('70');
    v = await view(order.id);
    expect(v.stockStatus).toBe('DELIVERED');
  });

  it('service-only order: NOT_REQUIRED, delivered → revenue invoice, no movement', async () => {
    const cat = await makeCategory();
    const service = await makeProduct({ categoryId: cat.id, service: true });
    const order = await createOrder([
      { productId: service, quantity: 1, unitPrice: 80 },
    ]);
    expect((await view(order.id)).stockStatus).toBe('NOT_REQUIRED');
    await ship(order.id);
    await deliver(order.id);
    const [invoice] = await invoicesOf(order.id);
    expect(Number(invoice.grandTotal)).toBe(80);
    expect(
      await prisma.inventoryMovement.count({
        where: { referenceId: { in: [invoice.id, order.id] } },
      }),
    ).toBe(0);
  });

  it('agent order: agent-owned goods reserved → transit → delivered with ownerAgentId on every movement, no company invoice / COGS; ships whole', async () => {
    const cat = await makeCategory();
    const product = await makeProduct({
      categoryId: cat.id,
      owner: agentId,
      cost: 7,
    });
    await open(product, 4);
    const order = await prisma.storeOrder.create({
      data: {
        internalOrderId: `W5A-${tag}-${++seq}`,
        partnerId: (await prisma.partner.findFirstOrThrow({ where: { phone } }))
          .id,
        currencyId,
        paymentType: 'CASH_ON_DELIVERY',
        fulfillmentMethod: 'SHIPPING',
        agentId,
        agentTermsSnapshot: {
          agreementId: randomUUID(),
          agreementNumber: `AGR-W5A-${tag}`,
          currencyId,
          productCommissionRatePercent: 10,
          serviceCommissionRatePercent: 10,
          shippingPolicy: 'FLAT_FEE_PER_SHIPMENT',
          commissionEarningEvent: 'PAYMENT_VERIFIED',
          returnCommissionTreatment: 'REVERSE',
          customerShippingChargeOwner: 'COMPANY',
          providerFeesBorneBy: 'AGENT',
          shippingFeePerShipment: 0,
          returnFeePerShipment: 0,
          serviceFeePerOrder: 0,
          allowAgentDestinations: true,
          payoutHoldDays: 0,
        },
        items: {
          create: [
            {
              productId: product,
              quantity: 2,
              unitPrice: 50,
              agreedAmount: 100,
            },
          ],
        },
      },
      include: { items: true },
    });
    await stock.afterOrderCreated(order.id, actorId); // the hook every creation path runs
    expect((await view(order.id)).stockStatus).toBe('RESERVED');
    expect(
      await codeOf(
        ship(order.id, [{ storeOrderItemId: order.items[0].id, quantity: 1 }]),
      ),
    ).toBe('AGENT_ORDER_SHIPS_WHOLE');
    await ship(order.id);
    expect(await inTransit(product)).toBeGreaterThanOrEqual(2);
    expect(await whOnHand(product)).toBe(2);
    // The agent catalog's availability never counts goods in transit.
    const agentStock = await inventory.getAgentStock(agentId, {
      productId: product,
    });
    expect(agentStock.totals).toMatchObject({ onHand: 4, available: 2 });
    expect(
      await codeOf(
        deliver(order.id, [
          { storeOrderItemId: order.items[0].id, quantity: 1 },
        ]),
      ),
    ).toBe('AGENT_ORDER_SHIPS_WHOLE');
    await deliver(order.id);
    expect(await owned(product)).toBe(2);
    expect(await invoicesOf(order.id)).toHaveLength(0);
    const movements = await prisma.inventoryMovement.findMany({
      where: { referenceId: order.id },
    });
    expect(movements.length).toBeGreaterThan(0);
    expect(movements.every((m) => m.ownerAgentId === agentId)).toBe(true);
    expect(
      movements.some(
        (m) => m.type === 'SALES_DELIVERY' && m.warehouseId === transitId,
      ),
    ).toBe(true);
    expect((await view(order.id)).stockStatus).toBe('DELIVERED');
    expect(
      (await prisma.storeOrder.findUniqueOrThrow({ where: { id: order.id } }))
        .agentDispatchedAt,
    ).not.toBeNull();
  });

  it('lead conversion reserves like every other creation path; an amendment of the lines re-reserves', async () => {
    const cat = await makeCategory();
    const product = await makeProduct({ categoryId: cat.id, cost: 2 });
    await open(product, 10);
    const lead = await prisma.lead.create({
      data: {
        leadNumber: `LD-W5A-${tag}-${++seq}`,
        customerName: `W5A lead ${tag}`,
        mobileNumber: phone,
        countryId: saCountryId,
        quantity: 1,
        currencyId,
        statusId: qualifiedStatusId,
        source: 'MANUAL',
      },
    });
    await workflow.convertLead(lead.id, actorId, {
      items: [{ productId: product, quantity: 3, agreedAmount: 30 }],
      paymentType: 'CASH_ON_DELIVERY',
    });
    const order = await prisma.storeOrder.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    let v = await view(order.id);
    expect(v.stockStatus).toBe('RESERVED');
    expect(v.lines[0].reserved).toBe(3);
    expect(await available(product)).toBe(7);

    await prisma.storeOrderItem.update({
      where: { id: v.lines[0].storeOrderItemId },
      data: { quantity: 5 },
    });
    await stock.onOrderLinesChanged(order.id, actorId);
    v = await view(order.id);
    expect(v.lines[0].reserved).toBe(5);
    expect(await available(product)).toBe(5);
  });

  it('repeated and concurrent callbacks: one dispatch transfer, one invoice, one delivery movement', async () => {
    const cat = await makeCategory();
    const product = await makeProduct({ categoryId: cat.id, cost: 5 });
    await open(product, 4);
    const order = await createOrder([
      { productId: product, quantity: 2, unitPrice: 25 },
    ]);

    await Promise.allSettled([
      ship(order.id),
      ship(order.id),
      shipping.setShippingStatus(order.id, shippedStatusId, actorId),
    ]);
    expect(
      await prisma.inventoryMovement.count({
        where: {
          referenceType: STORE_ORDER_TRANSIT_REFERENCE,
          referenceId: order.id,
        },
      }),
    ).toBe(2); // one OUT + one IN
    expect(
      await prisma.shipmentLine.count({
        where: { shipment: { storeOrderId: order.id } },
      }),
    ).toBe(1);

    await Promise.allSettled([
      deliver(order.id),
      deliver(order.id),
      shipping.setShippingStatus(order.id, deliveredStatusId, actorId),
    ]);
    await deliver(order.id);
    const invoices = await invoicesOf(order.id);
    expect(invoices).toHaveLength(1);
    expect(
      await prisma.inventoryMovement.count({
        where: { referenceId: invoices[0].id, type: 'SALES_DELIVERY' },
      }),
    ).toBe(1);
    expect(await owned(product)).toBe(2);
    expect(await codeOf(storeOrders.generateInvoice(order.id, actorId))).toBe(
      'DUPLICATE',
    );
  });

  it('backfill: dry run reports, apply moves an R14-shipped order to transit, reserves an open one, marks a pre-R15 agent dispatch; a second apply is a no-op', async () => {
    const cat = await makeCategory();
    const product = await makeProduct({ categoryId: cat.id, cost: 6 });
    const agentProduct = await makeProduct({
      categoryId: cat.id,
      owner: agentId,
      cost: 6,
    });
    await open(product, 10);
    await open(agentProduct, 5);
    const partnerId = (
      await prisma.partner.findFirstOrThrow({ where: { phone } })
    ).id;
    const legacy = (
      extra: Prisma.StoreOrderUncheckedCreateInput['agentId'] = null,
      productId = product,
    ) =>
      prisma.storeOrder.create({
        data: {
          internalOrderId: `W5A-${tag}-${++seq}`,
          partnerId,
          currencyId,
          paymentType: 'CASH_ON_DELIVERY',
          fulfillmentMethod: 'SHIPPING',
          agentId: extra,
          fulfillmentStatusId:
            statusResolver.fulfillmentStatusIdByCode('READY'),
          items: {
            create: [
              { productId, quantity: 2, unitPrice: 10, agreedAmount: 20 },
            ],
          },
        },
        include: { items: true },
      });
    // R14 state: shipped → reserved under a keyed R14 reservation, no lines.
    const shipped = await legacy();
    await prisma.shipment.create({
      data: { storeOrderId: shipped.id, attemptNumber: 1, status: 'SHIPPED' },
    });
    await inventory.reserve({
      productId: product,
      warehouseId,
      quantity: 2,
      referenceType: 'STORE_ORDER',
      referenceId: shipped.id,
      idempotencyKey: `STORE_ORDER:${shipped.id}:${shipped.items[0].id}:RESERVATION`,
    });
    const openOrder = await legacy();
    // Pre-R15 agent dispatch: issued straight from the warehouse.
    const agentOrder = await legacy(agentId, agentProduct);
    await prisma.shipment.create({
      data: {
        storeOrderId: agentOrder.id,
        attemptNumber: 1,
        status: 'SHIPPED',
      },
    });
    await inventory.postSalesDelivery({
      productId: agentProduct,
      warehouseId,
      quantity: 2,
      referenceType: 'STORE_ORDER',
      referenceId: agentOrder.id,
      idempotencyKey: `STORE_ORDER:${agentOrder.id}:${agentOrder.items[0].id}:SALES_DELIVERY`,
    });
    await prisma.storeOrder.update({
      where: { id: agentOrder.id },
      data: { agentDispatchedAt: new Date() },
    });
    const orderIds = [shipped.id, openOrder.id, agentOrder.id];

    const dry = await backfill.run({ dryRun: true, orderIds });
    expect(dry.orders.map((o) => o.action)).toEqual([
      'MOVE_TO_TRANSIT',
      'RESERVE',
      'MARK',
    ]);
    expect(dry.summary).toMatchObject({
      candidates: 3,
      moveToTransit: 1,
      reserve: 1,
      mark: 1,
    });
    expect(await whOnHand(product)).toBe(10); // the dry run wrote nothing
    expect(
      (
        await prisma.storeOrder.findMany({ where: { id: { in: orderIds } } })
      ).every((o) => o.stockStatus === 'PENDING'),
    ).toBe(true);

    const applied = await backfill.run({
      dryRun: false,
      userId: actorId,
      orderIds,
    });
    expect(applied.orders.map((o) => o.after)).toEqual([
      'IN_TRANSIT',
      'RESERVED',
      'IN_TRANSIT',
    ]);
    expect(await whOnHand(product)).toBe(8);
    expect((await view(shipped.id)).lines[0]).toMatchObject({
      reserved: 0,
      inTransit: 2,
    });
    expect((await view(openOrder.id)).lines[0].reserved).toBe(2);
    expect(await whOnHand(agentProduct)).toBe(3); // never issued twice
    expect(await available(product)).toBe(6);

    const again = await backfill.run({
      dryRun: false,
      userId: actorId,
      orderIds,
    });
    expect(again.orders).toHaveLength(0);
    expect(await whOnHand(product)).toBe(8);

    // The R14-shipped order now delivers out of transit like any R15 parcel.
    await deliver(shipped.id);
    expect(await invoicesOf(shipped.id)).toHaveLength(1);
    expect(await owned(product)).toBe(8);
  });

  // ── Accounting review follow-ups (review-accounting.md H2, M3, M4, L7) ──

  it('H2 — goods still with the carrier: a delivery never accepts more than the order still has to deliver; items / fulfillment method cannot be amended; a pickup collection and a whole-order recognition are refused', async () => {
    const cat = await makeCategory();
    const product = await makeProduct({ categoryId: cat.id, cost: 60 });
    await open(product, 10);

    // (a) 3 dispatched, the line lowered to 2 under the parcel (pre-fix amendment / data fix).
    const capped = await createOrder([
      { productId: product, quantity: 3, unitPrice: 100 },
    ]);
    const cappedItem = await itemOf(capped.id);
    await ship(capped.id);
    await prisma.storeOrderItem.update({
      where: { id: cappedItem.id },
      data: { quantity: 2, agreedAmount: 200 },
    });
    expect(
      await codeOf(
        deliver(capped.id, [{ storeOrderItemId: cappedItem.id, quantity: 3 }]),
      ),
    ).toBe('DELIVERED_EXCEEDS_ORDERED');
    await deliver(capped.id);
    const [capInvoice, ...extra] = await invoicesOf(capped.id);
    expect(extra).toHaveLength(0);
    expect(capInvoice.items[0].quantity).toBe(2);
    expect(Number(capInvoice.grandTotal)).toBe(200);
    expect(
      (await journalOf('SALES_INVOICE', capInvoice.id))
        .debit(cat.cogsAccountId)
        .toString(),
    ).toBe('120'); // 2 × 60 — never a unit without a document
    expect((await view(capped.id)).lines[0]).toMatchObject({
      delivered: 2,
      inTransit: 1,
    });
    expect(await inTransit(product)).toBe(1);

    // (b) a failed delivery: the goods stay with the carrier.
    const failed = await createOrder([
      { productId: product, quantity: 2, unitPrice: 50 },
    ]);
    const failedItem = await itemOf(failed.id);
    await ship(failed.id);
    await shipping.markDeliveryFailed(failed.id, actorId);
    const actor = { userId: actorId };
    const line = (quantity: number, agreedAmount: number) =>
      ({
        items: [
          { itemId: failedItem.id, productId: product, quantity, agreedAmount },
        ],
      }) as AmendChangesDto;
    const quantity = await amendments.preview(failed.id, line(1, 50), actor);
    expect(quantity.canCommit).toBe(false);
    expect(quantity.impacts.map((i) => i.code)).toContain('ORDER_IN_TRANSIT');
    const method = await amendments.preview(
      failed.id,
      { fulfillmentMethod: 'PICKUP' },
      actor,
    );
    expect(method.impacts.map((i) => i.code)).toContain('ORDER_IN_TRANSIT');
    const price = await amendments.preview(failed.id, line(2, 80), actor);
    expect(price.impacts.map((i) => i.code)).not.toContain('ORDER_IN_TRANSIT');

    // (c) moved to pickup anyway (pre-fix data): collection and recognition refuse.
    await prisma.storeOrder.update({
      where: { id: failed.id },
      data: {
        fulfillmentMethod: StoreOrderFulfillmentMethod.PICKUP,
        fulfillmentStatusId:
          statusResolver.fulfillmentStatusIdByCode('READY_FOR_PICKUP'),
      },
    });
    expect(
      await codeOf(
        storeOrders.transitionPickup(failed.id, 'COLLECTED', actorId),
      ),
    ).toBe('GOODS_IN_TRANSIT');
    const loaded = (await recognition.loadOrder(prisma, failed.id))!;
    const preflight = await recognition.preflight(loaded, {
      kind: 'WHOLE_ORDER',
      shipmentId: null,
    });
    expect(preflight.issues.map((i) => i.code)).toContain('GOODS_IN_TRANSIT');
    expect(await invoicesOf(failed.id)).toHaveLength(0);
    expect(await inTransit(product)).toBe(3);
  });

  it('M3 — manual documents never touch the goods-in-transit warehouse and only take goods out of the damaged-goods warehouse', async () => {
    const cat = await makeCategory();
    const product = await makeProduct({ categoryId: cat.id, cost: 5 });
    await open(product, 4);
    const order = await createOrder([
      { productId: product, quantity: 2, unitPrice: 20 },
    ]);
    const item = await itemOf(order.id);
    await ship(order.id);
    await shipping.markDeliveryFailed(order.id, actorId);
    await stock.receiveBack(
      order.id,
      {
        idempotencyKey: randomUUID(),
        lines: [
          { storeOrderItemId: item.id, quantity: 1, condition: 'DAMAGED' },
        ],
      },
      actorId,
    );
    expect(await inTransit(product)).toBe(1);
    expect(await sumAt(product, damagedId)).toBe(1);

    const refused = 'SYSTEM_WAREHOUSE_REFUSED';
    // Transit: no adjustment (either way), transfer, opening, receipt, sale, reservation.
    expect(
      await codeOf(
        inventory.adjustment(
          {
            productId: product,
            warehouseId: transitId,
            quantity: -1,
            reason: 'x',
          },
          actorId,
        ),
      ),
    ).toBe(refused);
    expect(
      await codeOf(
        inventory.transfer(
          {
            sourceWarehouseId: transitId,
            destinationWarehouseId: warehouseId,
            lines: [{ productId: product, quantity: 1 }],
          },
          actorId,
        ),
      ),
    ).toBe(refused);
    expect(
      await codeOf(
        inventory.openingBalance({
          productId: product,
          warehouseId: transitId,
          quantity: 1,
        }),
      ),
    ).toBe(refused);
    expect(
      await codeOf(
        inventory.postSalesDelivery({
          productId: product,
          warehouseId: transitId,
          quantity: 1,
          referenceType: 'SALES_INVOICE',
          referenceId: randomUUID(),
        }),
      ),
    ).toBe(refused);
    expect(
      await codeOf(
        inventory.reserve({
          productId: product,
          warehouseId: transitId,
          quantity: 1,
          referenceType: 'SALES_ORDER',
          referenceId: randomUUID(),
        }),
      ),
    ).toBe(refused);
    // Damaged: nothing goes in or is sold from it; write-off and transfer out are allowed.
    expect(
      await codeOf(
        inventory.adjustment(
          {
            productId: product,
            warehouseId: damagedId,
            quantity: 1,
            reason: 'x',
          },
          actorId,
        ),
      ),
    ).toBe(refused);
    expect(
      await codeOf(
        inventory.transfer(
          {
            sourceWarehouseId: warehouseId,
            destinationWarehouseId: damagedId,
            lines: [{ productId: product, quantity: 1 }],
          },
          actorId,
        ),
      ),
    ).toBe(refused);
    expect(
      await codeOf(
        inventory.postSalesDelivery({
          productId: product,
          warehouseId: damagedId,
          quantity: 1,
          referenceType: 'SALES_INVOICE',
          referenceId: randomUUID(),
        }),
      ),
    ).toBe(refused);
    await inventory.transfer(
      {
        sourceWarehouseId: damagedId,
        destinationWarehouseId: warehouseId,
        lines: [{ productId: product, quantity: 1 }],
      },
      actorId,
    );
    expect(await sumAt(product, damagedId)).toBe(0);
    // The order's own unit is still in transit and delivers / comes back normally.
    expect(await inTransit(product)).toBe(1);
    expect((await view(order.id)).lines[0].inTransit).toBe(1);
  });

  it('M4 — a kit recipe changed after dispatch: delivery and receive-back move exactly the components that went into transit; a reship never mixes the two recipes', async () => {
    const catA = await makeCategory();
    const catB = await makeCategory();
    const catC = await makeCategory();
    const catKit = await makeCategory();
    const a = await makeProduct({ categoryId: catA.id, cost: 10 });
    const b = await makeProduct({ categoryId: catB.id, cost: 15 });
    const c = await makeProduct({ categoryId: catC.id, cost: 7 });
    const kit = await makeProduct({ categoryId: catKit.id, supply: 'KIT' });
    await open(a, 12);
    await open(b, 6);
    await open(c, 5);
    const v1 = await recipes.create(
      kit,
      {
        lines: [
          { componentProductId: a, quantity: '2', unitId },
          { componentProductId: b, quantity: '1', unitId },
        ],
      },
      actorId,
    );
    await recipes.activate(v1.id, actorId);
    const delivered = await createOrder([
      { productId: kit, quantity: 1, unitPrice: 300 },
    ]);
    const returned = await createOrder([
      { productId: kit, quantity: 1, unitPrice: 300 },
    ]);
    const mixed = await createOrder([
      { productId: kit, quantity: 2, unitPrice: 600 },
    ]);
    const returnedItem = await itemOf(returned.id);
    const mixedItem = await itemOf(mixed.id);
    await ship(delivered.id);
    await ship(returned.id);
    await shipping.markDeliveryFailed(returned.id, actorId);
    await ship(mixed.id, [{ storeOrderItemId: mixedItem.id, quantity: 1 }]);
    await shipping.markDeliveryFailed(mixed.id, actorId);
    expect(await inTransit(a)).toBe(6);
    expect(await inTransit(b)).toBe(3);

    // The recipe changes while the parcels are with the carrier.
    const v2 = await recipes.create(
      kit,
      {
        lines: [
          { componentProductId: a, quantity: '1', unitId },
          { componentProductId: c, quantity: '1', unitId },
        ],
      },
      actorId,
    );
    await recipes.activate(v2.id, actorId);

    await deliver(delivered.id);
    const [invoice] = await invoicesOf(delivered.id);
    expect(invoice).toBeDefined();
    const issued = await prisma.inventoryMovement.findMany({
      where: { referenceId: invoice.id, type: 'SALES_DELIVERY' },
    });
    expect(
      Object.fromEntries(issued.map((m) => [m.productId, m.quantity])),
    ).toEqual({ [a]: -2, [b]: -1 });
    expect(issued.every((m) => m.recipeId === v1.id)).toBe(true);
    expect(
      (invoice.items[0].fulfillmentSnapshot as { recipeId: string }).recipeId,
    ).toBe(v1.id);
    expect(
      (await journalOf('SALES_INVOICE', invoice.id))
        .debit(catKit.cogsAccountId)
        .toString(),
    ).toBe('35'); // 2 × 10 + 15, the components that left
    expect(await inTransit(c)).toBe(0);

    await stock.receiveBack(
      returned.id,
      {
        idempotencyKey: randomUUID(),
        lines: [
          {
            storeOrderItemId: returnedItem.id,
            quantity: 1,
            condition: 'SALEABLE',
          },
        ],
      },
      actorId,
    );
    expect((await view(returned.id)).lines[0].returnedSaleable).toBe(1);
    expect(await inTransit(a)).toBe(2); // the mixed order's unit only
    expect(await inTransit(b)).toBe(1);

    // A reship carrying the v1 unit cannot add a v2 unit to the same line.
    await shipping.markNeedsReshipment(mixed.id, actorId);
    await shipping.createReshipment(mixed.id, actorId);
    expect(
      await codeOf(
        ship(mixed.id, [{ storeOrderItemId: mixedItem.id, quantity: 2 }]),
      ),
    ).toBe('KIT_RECIPE_CHANGED_IN_TRANSIT');
    await ship(mixed.id, [{ storeOrderItemId: mixedItem.id, quantity: 1 }]);
    await deliver(mixed.id);
    const [mixedInvoice] = await invoicesOf(mixed.id);
    const mixedIssued = await prisma.inventoryMovement.findMany({
      where: { referenceId: mixedInvoice.id, type: 'SALES_DELIVERY' },
    });
    expect(
      Object.fromEntries(mixedIssued.map((m) => [m.productId, m.quantity])),
    ).toEqual({ [a]: -2, [b]: -1 });
    expect(await inTransit(a)).toBe(0);
    expect(await inTransit(b)).toBe(0);
  });

  it('L7 — a delivered attempt moved back before its invoice exists: the accepted quantities are void and the goods can be received back', async () => {
    const cat = await makeCategory();
    const product = await makeProduct({ categoryId: cat.id }); // no cost → recognition fails
    await open(product, 3);
    const order = await createOrder([
      { productId: product, quantity: 2, unitPrice: 40 },
    ]);
    const item = await itemOf(order.id);
    await ship(order.id);
    await deliver(order.id);
    expect(await invoicesOf(order.id)).toHaveLength(0);
    expect((await view(order.id)).lines[0]).toMatchObject({
      delivered: 2,
      inTransit: 0,
    });

    await shipping.setShippingStatus(order.id, deliveryFailedStatusId, actorId);
    const v = await view(order.id);
    expect(v.lines[0]).toMatchObject({ delivered: 0, inTransit: 2 });
    expect(v.stockStatus).toBe('RETURNING');
    expect(v.canReceiveBack).toBe(true);
    await stock.receiveBack(
      order.id,
      {
        idempotencyKey: randomUUID(),
        lines: [
          { storeOrderItemId: item.id, quantity: 2, condition: 'SALEABLE' },
        ],
      },
      actorId,
    );
    expect(await inTransit(product)).toBe(0);
    expect(await whOnHand(product)).toBe(3);
  });
});
