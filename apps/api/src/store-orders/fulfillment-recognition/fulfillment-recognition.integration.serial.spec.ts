import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { HttpException } from '@nestjs/common';
import {
  AccountType,
  InventoryMovementType,
  JournalEntryStatus,
  PartnerRoleType,
  PaymentOrigin,
  PaymentStatus,
  Prisma,
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
import { SalesOrdersModule } from '../../sales/orders/sales-orders.module';
import { SalesOrdersService } from '../../sales/orders/sales-orders.service';
import { SalesInvoicesModule } from '../../sales/invoices/sales-invoices.module';
import { SalesInvoicesService } from '../../sales/invoices/sales-invoices.service';
import { SalesReturnsModule } from '../../sales/returns/sales-returns.module';
import { SalesReturnsService } from '../../sales/returns/sales-returns.service';
import { AssemblyModule } from '../../assembly/assembly.module';
import { AssemblyService } from '../../assembly/assembly.service';
import { AgentLedgerModule } from '../../agents/finance/agent-ledger.module';
import { AgentFulfillmentService } from '../../agents/finance/agent-fulfillment.service';
import { TraceabilityModule } from '../../traceability/traceability.module';
import { TraceabilityService } from '../../traceability/traceability.service';
import { StoreOrderCollectionService } from '../../accounting/store-order-collection/store-order-collection.service';
import { ShippingUpdatesImportHandler } from '../../import-center/handlers/shipping-updates-import.handler';
import { StoreOrdersModule } from '../store-orders.module';
import { StoreOrdersService } from '../store-orders.service';
import { StoreOrderShipmentOperationsService } from '../shipments/store-order-shipment-operations.service';
import { StoreOrderShipmentsService } from '../shipments/store-order-shipments.service';
import { StoreOrderActivityService } from '../activities/store-order-activity.service';
import { WorkflowStatusResolverService } from '../../workflow/workflow-status-resolver.service';
import { FulfillmentRecognitionService } from './fulfillment-recognition.service';
import { RecognitionRepairService } from './recognition-repair.service';

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
 * R14 W3 (spec-3 §7) — company store order revenue / stock / COGS recognition
 * at delivery, against the real local Postgres (run with DATABASE_URL pointing
 * at a local test DB such as oms_r14_w3, never `oms`). Every scenario drives the
 * real shipment operations / pickup workflow / import handler, so the
 * post-commit hooks are exercised exactly as in production. Tagged fixtures
 * (R14W3-<tag>) are kept, like the R13 serial suites: they are consistent.
 */
describe('Store order recognition at delivery (integration)', () => {
  jest.setTimeout(600_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let inventory: InventoryService;
  let recipes: RecipeManagementService;
  let salesOrders: SalesOrdersService;
  let salesInvoices: SalesInvoicesService;
  let returns: SalesReturnsService;
  let assembly: AssemblyService;
  let storeOrders: StoreOrdersService;
  let shipping: StoreOrderShipmentOperationsService;
  let recognition: FulfillmentRecognitionService;
  let repair: RecognitionRepairService;
  let collection: StoreOrderCollectionService;
  let traceability: TraceabilityService;
  let statusResolver: WorkflowStatusResolverService;

  const tag = randomUUID().slice(0, 8).toUpperCase();
  let actorId: string;
  let unitId: string;
  let warehouseId: string;
  let customerId: string;
  let currencyId: string;
  let paymentSourceId: string;
  let receivingAccountId: string;
  let deliveredStatusId: string;
  let returnedStatusId: string;
  let agentId: string;
  let seq = 0;

  const makeCategory = async () => {
    const suffix = `${++seq}`;
    const account = async (kind: string, accountType: AccountType) =>
      (
        await prisma.chartOfAccount.create({
          data: {
            code: `R14W3-${tag}-${suffix}-${kind}`,
            name: `R14 W3 ${suffix} ${kind} ${tag}`,
            accountType,
          },
        })
      ).id;
    const inventoryAccountId = await account('INV', AccountType.ASSET);
    const cogsAccountId = await account('COGS', AccountType.EXPENSE);
    const category = await prisma.productCategory.create({
      data: {
        name: `r14w3-${tag}-${suffix}`,
        inventoryAccountId,
        cogsAccountId,
      },
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
    const product = await prisma.product.create({
      data: {
        sku: `R14W3-${tag}-${suffix}`,
        name: `R14 W3 ${tag} ${suffix}`,
        internalName: `R14 W3 ${suffix}`,
        displayName: `R14 W3 ${suffix}`,
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
    });
    return product.id;
  };

  const open = (productId: string, quantity: number) =>
    inventory.openingBalance({ productId, warehouseId, quantity });

  const onHand = async (productId: string) =>
    (await inventory.getStock(productId, warehouseId)).onHand;

  const reservedFor = async (orderId: string, productId?: string) =>
    (
      await prisma.inventoryMovement.aggregate({
        where: {
          referenceType: 'STORE_ORDER',
          referenceId: orderId,
          productId,
          type: {
            in: [
              InventoryMovementType.RESERVATION,
              InventoryMovementType.RESERVATION_RELEASE,
            ],
          },
        },
        _sum: { quantity: true },
      })
    )._sum.quantity ?? 0;

  const makeOrder = async (
    lines: { productId: string; quantity: number; amount: number }[],
    opts: { pickup?: boolean; agentId?: string } = {},
  ) => {
    const order = await prisma.storeOrder.create({
      data: {
        internalOrderId: `R14W3-${tag}-${++seq}`,
        partnerId: customerId,
        currencyId,
        paymentType: 'CASH_ON_DELIVERY',
        fulfillmentMethod: opts.pickup ? 'PICKUP' : 'SHIPPING',
        agentId: opts.agentId ?? null,
        ...(opts.pickup
          ? {
              fulfillmentStatusId: statusResolver.fulfillmentStatusIdByCode(
                'AWAITING_PREPARATION',
              ),
            }
          : {}),
        items: {
          create: lines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            unitPrice: line.amount / line.quantity,
            agreedAmount: line.amount,
          })),
        },
      },
      include: { items: true },
    });
    return order;
  };

  const loadOrder = (id: string) =>
    prisma.storeOrder.findUniqueOrThrow({
      where: { id },
      select: {
        recognitionStatus: true,
        recognitionError: true,
        recognitionAttemptedAt: true,
      },
    });

  const invoicesOf = (storeOrderId: string) =>
    prisma.salesInvoice.findMany({
      where: { storeOrderId, deletedAt: null, status: { not: 'CANCELLED' } },
      include: { items: true },
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
      entry,
      debit: (id: string) => sum(id, 'debit'),
      credit: (id: string) => sum(id, 'credit'),
      totals,
    };
  };

  const ship = (orderId: string) => shipping.markShipped(orderId, actorId);
  const deliver = (orderId: string) => shipping.markDelivered(orderId, actorId);

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
        SalesOrdersModule,
        SalesInvoicesModule,
        SalesReturnsModule,
        StoreOrdersModule,
        AgentLedgerModule,
        AssemblyModule,
        TraceabilityModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    const get = <T>(type: new (...args: never[]) => T) =>
      moduleRef.get(type, { strict: false });
    inventory = get(InventoryService);
    recipes = get(RecipeManagementService);
    salesOrders = get(SalesOrdersService);
    salesInvoices = get(SalesInvoicesService);
    returns = get(SalesReturnsService);
    assembly = get(AssemblyService);
    storeOrders = get(StoreOrdersService);
    shipping = get(StoreOrderShipmentOperationsService);
    recognition = get(FulfillmentRecognitionService);
    repair = get(RecognitionRepairService);
    collection = get(StoreOrderCollectionService);
    traceability = get(TraceabilityService);
    statusResolver = get(WorkflowStatusResolverService);

    const lower = tag.toLowerCase();
    actorId = (
      await prisma.user.create({
        data: {
          email: `r14w3-${lower}@test.local`,
          username: `r14w3-${lower}`,
          fullName: `R14 W3 ${tag}`,
          passwordHash: 'x',
          isSuperAdmin: true,
        },
      })
    ).id;
    unitId = (await prisma.unit.create({ data: { name: `r14w3-${tag}-pc` } }))
      .id;
    warehouseId = (
      await prisma.warehouse.create({
        data: { code: `R14W3-${tag}`, name: `R14 W3 WH ${tag}` },
      })
    ).id;
    customerId = (
      await prisma.partner.create({
        data: {
          partnerNumber: `PT-R14W3-${tag}`,
          name: `R14 W3 customer ${tag}`,
          roles: { create: { role: PartnerRoleType.CUSTOMER } },
        },
      })
    ).id;
    const settings = await prisma.postingSettings.findFirstOrThrow();
    currencyId = settings.functionalCurrencyId!;
    const source = await prisma.paymentSource.findFirstOrThrow({
      where: { deletedAt: null, isActive: true },
      select: { id: true },
    });
    paymentSourceId = source.id;
    const bank = await prisma.chartOfAccount.create({
      data: {
        code: `R14W3-${tag}-BANK`,
        name: `R14 W3 bank ${tag}`,
        accountType: AccountType.ASSET,
      },
    });
    receivingAccountId = (
      await prisma.receivingAccount.create({
        data: {
          name: `R14 W3 RA ${tag}`,
          code: `R14W3-RA-${tag}`,
          chartOfAccountId: bank.id,
        },
      })
    ).id;
    deliveredStatusId = (
      await prisma.shippingStatus.findFirstOrThrow({
        where: { code: 'DELIVERED', deletedAt: null },
        select: { id: true },
      })
    ).id;
    returnedStatusId = (
      await prisma.shippingStatus.create({
        data: {
          code: `RETURNED_R14W3_${tag}`,
          name: `مرتجع R14 W3 ${tag}`,
          color: 'warning',
          isDefault: false,
          isSystem: false,
          isImportable: true,
          sortOrder: 900,
          syncBehavior: 'FINAL',
        },
      })
    ).id;
    const agentPartner = await prisma.partner.create({
      data: {
        partnerNumber: `PT-R14W3-${tag}-AGT`,
        name: `R14 W3 agent ${tag}`,
      },
    });
    agentId = (
      await prisma.agent.create({
        data: {
          agentNumber: `AG-R14W3-${tag}`,
          partnerId: agentPartner.id,
          name: `R14 W3 Agent ${tag}`,
          currencyId,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('COD stocked item: shipped → reserved, delivered before payment → invoice + stock + COGS; the later receipt allocates; return after delivery → RETURN_PENDING → sales return reverses', async () => {
    const cat = await makeCategory();
    const product = await makeProduct({ categoryId: cat.id, cost: 25 });
    await open(product, 10);
    const order = await makeOrder([
      { productId: product, quantity: 3, amount: 300 },
    ]);

    await ship(order.id);
    expect(await reservedFor(order.id, product)).toBe(3);
    expect(await onHand(product)).toBe(10);
    expect((await loadOrder(order.id)).recognitionStatus).toBe('RESERVED');

    // Delivered while still unpaid (COD) — recognition never waits for payment.
    await deliver(order.id);
    const [invoice, ...more] = await invoicesOf(order.id);
    expect(more).toHaveLength(0);
    expect(invoice.status).toBe('CONFIRMED');
    expect(Number(invoice.grandTotal)).toBe(300);
    expect(await onHand(product)).toBe(7);
    expect(await reservedFor(order.id)).toBe(0);
    const sale = await journalOf('SALES_INVOICE', invoice.id);
    expect(sale.totals.debit.equals(sale.totals.credit)).toBe(true);
    expect(sale.debit(cat.cogsAccountId).toString()).toBe('75'); // 3 × 25
    expect(sale.credit(cat.inventoryAccountId).toString()).toBe('75');
    expect((await loadOrder(order.id)).recognitionStatus).toBe('RECOGNIZED');

    // Payment verified after delivery: the receipt allocates to the invoice.
    await prisma.payment.create({
      data: {
        paymentNumber: `PAY-R14W3-${tag}-${++seq}`,
        storeOrderId: order.id,
        paymentDate: new Date(),
        amount: 300,
        currencyId,
        paymentSourceId,
        receivingAccountId,
        origin: PaymentOrigin.SALES_DECLARATION,
        senderName: 'R14 W3 customer',
        status: PaymentStatus.VERIFIED,
        verifiedAt: new Date(),
      },
    });
    await collection.syncVerifiedPayments(order.id, actorId);
    const allocated = await prisma.financialTransactionAllocation.aggregate({
      where: { salesInvoiceId: invoice.id },
      _sum: { allocatedAmount: true },
    });
    expect(Number(allocated._sum.allocatedAmount)).toBe(300);

    // Returned after delivery → flagged; the user posts the sales return.
    await shipping.setShippingStatus(order.id, returnedStatusId, actorId);
    expect((await loadOrder(order.id)).recognitionStatus).toBe(
      'RETURN_PENDING',
    );
    expect(await onHand(product)).toBe(7); // nothing automatic
    const salesReturn = await returns.create({
      partnerId: customerId,
      salesInvoiceId: invoice.id,
      items: [
        {
          productId: product,
          warehouseId,
          unitId,
          quantity: 3,
          unitPrice: 100,
          salesInvoiceItemId: invoice.items[0].id,
        },
      ],
    });
    await returns.submit(salesReturn.id);
    await returns.approve(salesReturn.id);
    await returns.confirm(salesReturn.id, actorId);
    expect(await onHand(product)).toBe(10);
    const back = await journalOf('SALES_RETURN', salesReturn.id);
    expect(back.debit(cat.inventoryAccountId).toString()).toBe('75');
    expect(back.credit(cat.cogsAccountId).toString()).toBe('75');
  });

  it('kit: components reserved at shipment and issued at delivery; COGS once from the components', async () => {
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
    const order = await makeOrder([
      { productId: kit, quantity: 2, amount: 600 },
    ]);

    await ship(order.id);
    expect(await reservedFor(order.id, a)).toBe(4);
    expect(await reservedFor(order.id, b)).toBe(2);
    expect(await reservedFor(order.id, kit)).toBe(0);

    await deliver(order.id);
    const [invoice] = await invoicesOf(order.id);
    expect(await onHand(a)).toBe(2);
    expect(await onHand(b)).toBe(1);
    expect(await reservedFor(order.id)).toBe(0);
    const deliveries = await prisma.inventoryMovement.findMany({
      where: { referenceId: invoice.id, type: 'SALES_DELIVERY' },
    });
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((m) => m.parentProductId === kit)).toBe(true);
    const sale = await journalOf('SALES_INVOICE', invoice.id);
    expect(sale.debit(catKit.cogsAccountId).toString()).toBe('70');
    expect(sale.credit(catA.inventoryAccountId).toString()).toBe('40');
    expect(sale.credit(catB.inventoryAccountId).toString()).toBe('30');
  });

  it('service-only order: revenue invoice, no stock movement, no COGS', async () => {
    const cat = await makeCategory();
    const service = await makeProduct({ categoryId: cat.id, service: true });
    const order = await makeOrder([
      { productId: service, quantity: 1, amount: 80 },
    ]);
    await ship(order.id);
    expect((await loadOrder(order.id)).recognitionStatus).toBe('NOT_DUE');
    await deliver(order.id);
    const [invoice] = await invoicesOf(order.id);
    expect(Number(invoice.grandTotal)).toBe(80);
    expect(
      await prisma.inventoryMovement.count({
        where: { referenceId: { in: [invoice.id, order.id] } },
      }),
    ).toBe(0);
    const sale = await journalOf('SALES_INVOICE', invoice.id);
    expect(sale.debit(cat.cogsAccountId).toString()).toBe('0');
    expect((await loadOrder(order.id)).recognitionStatus).toBe('RECOGNIZED');
  });

  it('assembled finished good is issued as itself — its components are not deducted again', async () => {
    const catC = await makeCategory();
    const catF = await makeCategory();
    const component = await makeProduct({ categoryId: catC.id, cost: 10 });
    await open(component, 8);
    const fg = await makeProduct({ categoryId: catF.id, supply: 'ASSEMBLED' });
    const draft = await recipes.create(
      fg,
      { lines: [{ componentProductId: component, quantity: '4', unitId }] },
      actorId,
    );
    await recipes.activate(draft.id, actorId);
    await assembly.create(
      { productId: fg, warehouseId, quantity: 2 },
      actorId,
      {
        includeCosts: true,
      },
    );
    expect(await onHand(component)).toBe(0);
    expect(await onHand(fg)).toBe(2);
    const order = await makeOrder([
      { productId: fg, quantity: 1, amount: 120 },
    ]);

    await ship(order.id);
    await deliver(order.id);
    const [invoice] = await invoicesOf(order.id);
    expect(await onHand(fg)).toBe(1);
    expect(await onHand(component)).toBe(0);
    const sale = await journalOf('SALES_INVOICE', invoice.id);
    expect(sale.debit(catF.cogsAccountId).toString()).toBe('40'); // 4 × 10
    expect(sale.credit(catC.inventoryAccountId).toString()).toBe('0');
  });

  it('repeated and concurrent delivered callbacks → one invoice, one movement set, one journal', async () => {
    const cat = await makeCategory();
    const product = await makeProduct({ categoryId: cat.id, cost: 5 });
    await open(product, 4);
    const order = await makeOrder([
      { productId: product, quantity: 2, amount: 50 },
    ]);
    await ship(order.id);

    await Promise.all([
      deliver(order.id),
      deliver(order.id),
      shipping.setShippingStatus(order.id, deliveredStatusId, actorId),
    ]);
    await deliver(order.id);
    await shipping.bulkUpdateStatus(
      [
        (
          await prisma.shipment.findFirstOrThrow({
            where: { storeOrderId: order.id },
          })
        ).id,
      ],
      'DELIVERED',
      actorId,
    );
    await Promise.all([
      recognition.afterShipmentStatus(
        order.id,
        { status: 'DELIVERED' },
        actorId,
      ),
      recognition.afterShipmentStatus(
        order.id,
        { status: 'DELIVERED' },
        actorId,
      ),
      recognition.afterShipmentStatus(
        order.id,
        { status: 'DELIVERED' },
        actorId,
      ),
    ]);

    const invoices = await invoicesOf(order.id);
    expect(invoices).toHaveLength(1);
    expect(
      await prisma.inventoryMovement.count({
        where: { referenceId: invoices[0].id, type: 'SALES_DELIVERY' },
      }),
    ).toBe(1);
    expect(await onHand(product)).toBe(2);
    await journalOf('SALES_INVOICE', invoices[0].id);
    const order2 = await loadOrder(order.id);
    expect(order2.recognitionStatus).toBe('RECOGNIZED');
    expect(order2.recognitionError).toBeNull();
    // A manual retry on a recognised order is a duplicate.
    expect(await codeOf(storeOrders.generateInvoice(order.id, actorId))).toBe(
      'DUPLICATE',
    );
  });

  it('missing cost → FAILED with an actionable code, no invoice, the delivery is still saved; the manual retry recognises once fixed', async () => {
    const cat = await makeCategory();
    const product = await makeProduct({ categoryId: cat.id, cost: 9 });
    await open(product, 5);
    await prisma.product.update({
      where: { id: product },
      data: { currentCost: null },
    });
    const order = await makeOrder([
      { productId: product, quantity: 1, amount: 40 },
    ]);

    // Before delivery the manual retry is refused.
    expect(await codeOf(storeOrders.generateInvoice(order.id, actorId))).toBe(
      'RECOGNITION_NOT_DUE',
    );
    await ship(order.id);
    const shipment = await deliver(order.id);
    expect(shipment.status).toBe('DELIVERED');
    expect(await invoicesOf(order.id)).toHaveLength(0);
    const failed = await loadOrder(order.id);
    expect(failed.recognitionStatus).toBe('FAILED');
    expect(failed.recognitionError).toMatchObject({
      code: 'MISSING_COST',
      stage: 'RECOGNITION',
    });
    expect(
      (failed.recognitionError as { messageAr: string }).messageAr,
    ).toContain(`R14W3-${tag}`);
    expect(
      await prisma.storeOrderActivity.count({
        where: { storeOrderId: order.id, action: 'RECOGNITION_FAILED' },
      }),
    ).toBe(1);
    expect(await codeOf(storeOrders.generateInvoice(order.id, actorId))).toBe(
      'MISSING_COST',
    );

    // Traceability reports FAILED with the reason (not PENDING).
    const trace = await traceability.trace('STORE_ORDER', order.id, actorId);
    const stock = trace.groups.find((g) => g.key === 'STOCK_MOVEMENTS')!;
    expect(stock.state).toBe('FAILED');
    expect(stock.reason?.code).toBe('MISSING_COST');
    expect(stock.items.some((item) => item.status === 'RESERVATION')).toBe(
      true,
    );

    await prisma.product.update({
      where: { id: product },
      data: { currentCost: 9 },
    });
    const invoice = await storeOrders.generateInvoice(order.id, actorId);
    expect(invoice.invoiceNumber).toEqual(expect.any(String));
    const done = await loadOrder(order.id);
    expect(done.recognitionStatus).toBe('RECOGNIZED');
    expect(done.recognitionError).toBeNull();
    expect(await onHand(product)).toBe(4);
    const traced = await traceability.trace('STORE_ORDER', order.id, actorId);
    expect(traced.groups.find((g) => g.key === 'STOCK_MOVEMENTS')!.state).toBe(
      'FOUND',
    );
  });

  it('delivery failure before delivery releases the reservation; a reshipment reserves again', async () => {
    const cat = await makeCategory();
    const product = await makeProduct({ categoryId: cat.id, cost: 4 });
    await open(product, 3);
    const order = await makeOrder([
      { productId: product, quantity: 2, amount: 20 },
    ]);
    await ship(order.id);
    expect(await reservedFor(order.id)).toBe(2);
    await shipping.markDeliveryFailed(order.id, actorId);
    expect(await reservedFor(order.id)).toBe(0);
    expect((await loadOrder(order.id)).recognitionStatus).toBe('NOT_DUE');
    await shipping.markNeedsReshipment(order.id, actorId);
    await shipping.createReshipment(order.id, actorId);
    await ship(order.id);
    expect(await reservedFor(order.id)).toBe(2);
    await deliver(order.id);
    expect(await onHand(product)).toBe(1);
    expect(await reservedFor(order.id)).toBe(0);
  });

  it('free-of-charge delivery still posts COGS (no receivable, no zero revenue line)', async () => {
    const cat = await makeCategory();
    const product = await makeProduct({ categoryId: cat.id, cost: 12 });
    await open(product, 2);
    const order = await makeOrder([
      { productId: product, quantity: 1, amount: 0 },
    ]);
    await ship(order.id);
    await deliver(order.id);
    const [invoice] = await invoicesOf(order.id);
    expect(Number(invoice.grandTotal)).toBe(0);
    const sale = await journalOf('SALES_INVOICE', invoice.id);
    expect(sale.debit(cat.cogsAccountId).toString()).toBe('12');
    expect(sale.credit(cat.inventoryAccountId).toString()).toBe('12');
    expect(
      sale.entry.lines.every(
        (line) => !D(line.debit).isZero() || !D(line.credit).isZero(),
      ),
    ).toBe(true);
    expect(sale.entry.lines).toHaveLength(2);
  });

  it('pickup: READY reserves, COLLECTED recognises', async () => {
    const cat = await makeCategory();
    const product = await makeProduct({ categoryId: cat.id, cost: 3 });
    await open(product, 5);
    const order = await makeOrder(
      [{ productId: product, quantity: 2, amount: 30 }],
      { pickup: true },
    );
    await storeOrders.transitionPickup(order.id, 'READY_FOR_PICKUP', actorId);
    expect(await reservedFor(order.id)).toBe(2);
    await storeOrders.transitionPickup(order.id, 'COLLECTED', actorId);
    expect(await invoicesOf(order.id)).toHaveLength(1);
    expect(await onHand(product)).toBe(3);
    expect((await loadOrder(order.id)).recognitionStatus).toBe('RECOGNIZED');
  });

  it('shipping import DELIVERED recognises the company order through the same hook', async () => {
    const cat = await makeCategory();
    const product = await makeProduct({ categoryId: cat.id, cost: 6 });
    await open(product, 2);
    const order = await makeOrder([
      { productId: product, quantity: 1, amount: 15 },
    ]);
    const handler = new ShippingUpdatesImportHandler(
      prisma,
      moduleRef.get(StoreOrderShipmentsService, { strict: false }),
      moduleRef.get(StoreOrderActivityService, { strict: false }),
      { register: () => undefined } as never,
      { resolveOptional: () => Promise.resolve(undefined) } as never,
      moduleRef.get(AgentFulfillmentService, { strict: false }),
      recognition,
      { hasPermission: () => Promise.resolve(true) } as never,
    );
    await handler.importRow(
      {
        systemOrderId: order.internalOrderId,
        status: 'SHIPPED',
        trackingNumber: `TRK-${tag}`,
      },
      actorId,
    );
    expect(await reservedFor(order.id)).toBe(1);
    await handler.importRow(
      {
        systemOrderId: order.internalOrderId,
        status: 'DELIVERED',
        trackingNumber: `TRK-${tag}`,
      },
      actorId,
    );
    expect(await invoicesOf(order.id)).toHaveLength(1);
    expect(await onHand(product)).toBe(1);
  });

  it('agent order: the recognition hooks never touch it and the manual invoice is refused', async () => {
    const cat = await makeCategory();
    const product = await makeProduct({ categoryId: cat.id, owner: agentId });
    await open(product, 3);
    const order = await makeOrder(
      [{ productId: product, quantity: 1, amount: 50 }],
      { agentId },
    );
    await recognition.afterShipmentStatus(
      order.id,
      { status: 'SHIPPED' },
      actorId,
    );
    await recognition.afterShipmentStatus(
      order.id,
      { status: 'DELIVERED' },
      actorId,
    );
    expect(await reservedFor(order.id)).toBe(0);
    expect(await invoicesOf(order.id)).toHaveLength(0);
    expect((await loadOrder(order.id)).recognitionStatus).toBe('NOT_DUE');
    expect(await codeOf(storeOrders.generateInvoice(order.id, actorId))).toBe(
      'AGENT_ORDER_NO_COMPANY_INVOICE',
    );
  });

  it('B2B regression: a sales order reserves at confirm and its invoice issues the stock', async () => {
    const cat = await makeCategory();
    const product = await makeProduct({ categoryId: cat.id, cost: 8 });
    await open(product, 4);
    const order = await salesOrders.create({
      partnerId: customerId,
      items: [
        { productId: product, warehouseId, unitId, quantity: 3, unitPrice: 20 },
      ],
    });
    await salesOrders.confirm(order.id, actorId);
    const invoice = await salesOrders.convertToInvoice(
      order.id,
      { items: [{ salesOrderItemId: order.items[0].id, quantity: 3 }] },
      actorId,
    );
    await salesInvoices.confirm(invoice.id, actorId);
    expect(await onHand(product)).toBe(1);
    const sale = await journalOf('SALES_INVOICE', invoice.id);
    expect(sale.debit(cat.cogsAccountId).toString()).toBe('24');
  });

  it('repair: dry run lists a delivered, never-recognised order; apply recognises it; a second apply is a no-op', async () => {
    const cat = await makeCategory();
    const product = await makeProduct({ categoryId: cat.id, cost: 11 });
    await open(product, 3);
    const order = await makeOrder([
      { productId: product, quantity: 2, amount: 90 },
    ]);
    // Pre-R14 state: delivered through a path that never recognised it.
    await prisma.shipment.create({
      data: {
        storeOrderId: order.id,
        attemptNumber: 1,
        status: 'DELIVERED',
      },
    });
    await prisma.storeOrder.update({
      where: { id: order.id },
      data: {
        fulfillmentStatusId:
          statusResolver.fulfillmentStatusIdByCode('DELIVERED'),
      },
    });

    const dry = await repair.run({ dryRun: true, orderIds: [order.id] });
    expect(dry.orders).toHaveLength(1);
    expect(dry.orders[0]).toMatchObject({
      result: 'WOULD_RECOGNIZE',
      predictedInvoiceTotal: 90,
      predictedCogs: '22.00',
    });
    expect(dry.orders[0].stock[0]).toMatchObject({ required: 2, onHand: 3 });
    expect(await invoicesOf(order.id)).toHaveLength(0);

    const applied = await repair.run({
      dryRun: false,
      userId: actorId,
      orderIds: [order.id],
    });
    expect(applied.orders[0].result).toBe('RECOGNIZED');
    expect(applied.reconciliation.before.onHandByProduct[product]).toBe(3);
    expect(applied.reconciliation.after?.onHandByProduct[product]).toBe(1);
    expect(
      D(applied.reconciliation.after!.cogsGl)
        .sub(applied.reconciliation.before.cogsGl)
        .toString(),
    ).toBe('22');
    expect(await invoicesOf(order.id)).toHaveLength(1);

    const again = await repair.run({
      dryRun: false,
      userId: actorId,
      orderIds: [order.id],
    });
    expect(again.orders).toHaveLength(0);
    expect(await invoicesOf(order.id)).toHaveLength(1);
    expect(await onHand(product)).toBe(1);
  });
});
