import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ProductType, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ImportCenterModule } from '../import-center.module';
import { StoreOrdersModule } from '../../store-orders/store-orders.module';
import { StoreOrdersImportHandler } from '../handlers/store-orders-import.handler';
import { ShippingUpdatesImportHandler } from '../handlers/shipping-updates-import.handler';
import { StoreOrderShipmentsService } from '../../store-orders/shipments/store-order-shipments.service';
import { StoreOrderShipmentOperationsService } from '../../store-orders/shipments/store-order-shipment-operations.service';
import { PermissionsCoreModule } from '../../permissions/permissions-core.module';
import { PhoneModule } from '../../common/phone/phone.module';
import { AuthModule } from '../../auth/auth.module';
import { GoogleSheetsService } from '../google-sheets.service';
import { ObjectStorageModule } from '../../common/storage/object-storage.module';
import {
  SyncOrchestratorService,
  type ShippingSyncRowReport,
} from './sync-orchestrator.service';
import { SyncSourceConfigService } from './sync-source-config.service';

/**
 * Two-Way Google Sheets Shipping Workflow — the 12 scenarios (A-L) called
 * for in the feature spec. Runs against the real local Postgres, exercising
 * the actual `ShippingUpdatesImportHandler`/`SyncOrchestratorService` — the
 * same code path both a CSV upload through Import Center and a Google
 * Sheets sync drive. Only `GoogleSheetsService` is faked (scenarios I/J/K,
 * which go through the orchestrator) since no real spreadsheet is available
 * in CI.
 */
/**
 * Own label namespace per run — see the matching constant in
 * `data-synchronization.spec.ts`. Both suites sweep Sync Sources by label
 * prefix, so sharing one prefix let a parallel run's cleanup delete this
 * suite's live config mid-test.
 */
const SOURCE_LABEL_PREFIX = `Sync Test Source SH-${randomUUID()}`;

/** Own user namespace — see the matching constant in `data-synchronization.spec.ts`. */
const USER_EMAIL_PREFIX = 'sync-test-sh-';

describe('Shipping Sync (Two-Way Google Sheets Workflow)', () => {
  let prisma: PrismaService;
  let storeOrdersHandler: StoreOrdersImportHandler;
  let shippingHandler: ShippingUpdatesImportHandler;
  let shipmentsService: StoreOrderShipmentsService;
  let operations: StoreOrderShipmentOperationsService;

  let categoryId: string;
  let unitId: string;
  let currencyCode: string;
  let productSku: string;
  let productDisplayName: string;
  let shippingCompanyName: string;
  let employeeEmail: string;
  let countryName: string;
  let paymentMethodLabel: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        ImportCenterModule,
        StoreOrdersModule,
        ObjectStorageModule,
      ],
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    storeOrdersHandler = moduleRef.get(StoreOrdersImportHandler);
    shippingHandler = moduleRef.get(ShippingUpdatesImportHandler);
    shipmentsService = moduleRef.get(StoreOrderShipmentsService);
    operations = moduleRef.get(StoreOrderShipmentOperationsService);

    const category = await prisma.productCategory.create({
      data: { name: `Sync Test Category ${randomUUID()}` },
    });
    categoryId = category.id;

    const unit = await prisma.unit.create({
      data: { name: `Sync Test Unit ${randomUUID()}` },
    });
    unitId = unit.id;

    const currency = await prisma.currency.findFirst();
    if (!currency) throw new Error('Expected at least one seeded Currency.');
    currencyCode = currency.code;

    productSku = `SHIP-SYNC-TEST-${randomUUID().slice(0, 8)}`;
    productDisplayName = `Shipping Sync Test Product ${productSku}`;
    await prisma.product.create({
      data: {
        name: productDisplayName,
        internalName: productDisplayName,
        displayName: productDisplayName,
        sku: productSku,
        categoryId,
        unitId,
        type: ProductType.SERVICE,
        isPurchasable: false,
        isSellable: true,
        isInventoryItem: false,
      },
    });

    shippingCompanyName = `Sync Test Shipping Company ${randomUUID().slice(0, 8)}`;
    await prisma.shippingCompany.create({
      data: { name: shippingCompanyName },
    });

    const employeeSuffix = randomUUID().slice(0, 8);
    const employee = await prisma.user.create({
      data: {
        email: `${USER_EMAIL_PREFIX}${employeeSuffix}@example.test`,
        username: `${USER_EMAIL_PREFIX}${employeeSuffix}`,
        fullName: 'Sync Test Employee',
        passwordHash: 'x',
        isSuperAdmin: false,
      },
    });
    employeeEmail = employee.email;

    const country = await prisma.country.findFirstOrThrow({
      where: { deletedAt: null, isActive: true, code: 'SA' },
    });
    countryName = country.name;

    const paymentMethod = await prisma.paymentMethod.findFirstOrThrow({
      where: { deletedAt: null },
    });
    paymentMethodLabel = paymentMethod.name;
  });

  afterAll(async () => {
    const syncSources = await prisma.syncSourceConfig.findMany({
      where: { label: { startsWith: SOURCE_LABEL_PREFIX } },
      select: { id: true, importJobId: true },
    });
    const syncJobIds = syncSources
      .map((s) => s.importJobId)
      .filter((id): id is string => !!id);
    await prisma.syncSourceConfig.deleteMany({
      where: { id: { in: syncSources.map((s) => s.id) } },
    });
    await prisma.importJobError.deleteMany({
      where: { importJobId: { in: syncJobIds } },
    });
    await prisma.importJob.deleteMany({ where: { id: { in: syncJobIds } } });

    const customers = await prisma.partner.findMany({
      where: { name: { startsWith: 'Sync Test Customer' } },
      select: { id: true },
    });
    const customerIds = customers.map((c) => c.id);
    const orders = await prisma.storeOrder.findMany({
      where: { partnerId: { in: customerIds } },
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);
    await prisma.shipment.deleteMany({
      where: { storeOrderId: { in: orderIds } },
    });
    await prisma.storeOrderActivity.deleteMany({
      where: { storeOrderId: { in: orderIds } },
    });
    await prisma.storeOrderItem.deleteMany({
      where: { storeOrderId: { in: orderIds } },
    });
    await prisma.storeOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.partnerRoleAssignment.deleteMany({
      where: { partnerId: { in: customerIds } },
    });
    await prisma.customerProfile.deleteMany({
      where: { partnerId: { in: customerIds } },
    });
    await prisma.partner.deleteMany({ where: { id: { in: customerIds } } });

    await prisma.shippingCompany.deleteMany({
      where: { name: { startsWith: 'Sync Test Shipping Company' } },
    });

    const users = await prisma.user.findMany({
      where: { email: { startsWith: USER_EMAIL_PREFIX } },
      select: { id: true },
    });
    await prisma.userPermission.deleteMany({
      where: { userId: { in: users.map((u) => u.id) } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: users.map((u) => u.id) } },
    });

    await prisma.product.deleteMany({ where: { sku: productSku } });
    await prisma.productCategory.deleteMany({ where: { id: categoryId } });
    await prisma.unit.deleteMany({ where: { id: unitId } });

    await prisma.$disconnect();
  });

  function storeOrderRow(overrides: Partial<Record<string, string>> = {}) {
    return {
      externalOrderId: `SHIP-EXT-${randomUUID()}`,
      orderDate: '2026-08-01',
      customerName: 'Sync Test Customer',
      customerPhone: `+9665${Math.floor(10000000 + Math.random() * 89999999)}`,
      countryName,
      address: 'Test address',
      productSku: productDisplayName,
      quantity: '1',
      paidAmount: '100',
      paymentType: 'CASH_ON_DELIVERY',
      currencyCode,
      paymentMethodLabel,
      agentEmail: employeeEmail,
      ...overrides,
    };
  }

  async function createAcceptedOrder() {
    const row = storeOrderRow();
    const result = await storeOrdersHandler.importRow(row);
    await prisma.storeOrder.update({
      where: { id: result.id },
      data: { paymentType: 'CASH_ON_DELIVERY' },
    });
    return prisma.storeOrder.findUniqueOrThrow({ where: { id: result.id } });
  }

  function shippingRow(
    externalOrderId: string,
    overrides: Partial<Record<string, string>> = {},
  ) {
    return {
      externalOrderId,
      status: '',
      trackingNumber: '',
      shippingCompanyName: '',
      notes: '',
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------
  // A. Accepted order + valid update -> shipment created/updated.
  // ---------------------------------------------------------------------
  it('creates a Shipment for an accepted Store Order on a valid status update', async () => {
    const order = await createAcceptedOrder();
    const result = await shippingHandler.importRow(
      shippingRow(order.externalOrderId!, { status: 'LABEL_CREATED' }),
    );
    expect(result.id).toBeTruthy();
    expect(result.noChange).toBeFalsy();

    const shipment = await prisma.shipment.findUniqueOrThrow({
      where: { id: result.id },
    });
    expect(shipment.status).toBe(ShipmentStatus.LABEL_CREATED);
    expect(shipment.storeOrderId).toBe(order.id);
  });

  // ---------------------------------------------------------------------
  // B. Repeat sync with unchanged data -> NO_CHANGE, no duplicate write.
  // ---------------------------------------------------------------------
  it('reports NO_CHANGE on a repeat sync of an already-applied row', async () => {
    const order = await createAcceptedOrder();
    const row = shippingRow(order.externalOrderId!, { status: 'SHIPPED' });
    const first = await shippingHandler.importRow(row);
    expect(first.noChange).toBeFalsy();

    const second = await shippingHandler.importRow(row);
    expect(second.noChange).toBe(true);
    expect(second.id).toBe(first.id);
  });

  // ---------------------------------------------------------------------
  // C. Invalid/unknown External Order ID -> NOT_FOUND, nothing written.
  // ---------------------------------------------------------------------
  it('rejects an unknown External Order ID as NOT_FOUND without creating anything', async () => {
    const unknownId = `SHIP-EXT-UNKNOWN-${randomUUID()}`;
    let caught: BadRequestException | undefined;
    try {
      await shippingHandler.importRow(
        shippingRow(unknownId, { status: 'SHIPPED' }),
      );
    } catch (error) {
      caught = error as BadRequestException;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect(caught?.getResponse()).toMatchObject({ code: 'NOT_FOUND' });

    const shipments = await prisma.shipment.findMany({
      where: { storeOrder: { externalOrderId: unknownId } },
    });
    expect(shipments).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // D. A row for a Store Order that was never accepted into OMS (rejected
  //    or still pending review during Store Order import) is ignored the
  //    same way as C — there is no Store Order to resolve against, so it
  //    can never silently create one.
  // ---------------------------------------------------------------------
  it('ignores a shipping row for an order that was never accepted as a Store Order', async () => {
    const neverAcceptedId = `SHIP-EXT-NEVER-ACCEPTED-${randomUUID()}`;
    await expect(
      shippingHandler.importRow(
        shippingRow(neverAcceptedId, { status: 'DELIVERED' }),
      ),
    ).rejects.toThrow(BadRequestException);

    const order = await prisma.storeOrder.findFirst({
      where: { externalOrderId: neverAcceptedId },
    });
    expect(order).toBeNull();
  });

  // ---------------------------------------------------------------------
  // E. Unknown/inactive Shipping Company -> REJECTED, never auto-created.
  // ---------------------------------------------------------------------
  it('rejects a row referencing a Shipping Company that does not exist in Master Data', async () => {
    const order = await createAcceptedOrder();
    let caught: BadRequestException | undefined;
    try {
      await shippingHandler.importRow(
        shippingRow(order.externalOrderId!, {
          status: 'LABEL_CREATED',
          shippingCompanyName: `Nonexistent Shipping Co ${randomUUID()}`,
        }),
      );
    } catch (error) {
      caught = error as BadRequestException;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect(caught?.getResponse()).toMatchObject({
      code: 'MASTER_DATA_NOT_FOUND',
    });

    const companies = await prisma.shippingCompany.findMany({
      where: { name: { contains: 'Nonexistent Shipping Co' } },
    });
    expect(companies).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // F. Invalid transition -> REJECTED, shipment left unchanged.
  // ---------------------------------------------------------------------
  it('rejects NEEDS_RESHIPMENT unless the current shipment is DELIVERY_FAILED', async () => {
    const order = await createAcceptedOrder();
    await shippingHandler.importRow(
      shippingRow(order.externalOrderId!, { status: 'SHIPPED' }),
    );

    await expect(
      shippingHandler.importRow(
        shippingRow(order.externalOrderId!, { status: 'NEEDS_RESHIPMENT' }),
      ),
    ).rejects.toThrow(BadRequestException);

    const current = await shipmentsService.getCurrent(order.id);
    expect(current?.status).toBe(ShipmentStatus.SHIPPED);
  });

  // ---------------------------------------------------------------------
  // G. DELIVERED with no tracking number (and none on file) -> REJECTED.
  // ---------------------------------------------------------------------
  it('rejects DELIVERED without a Tracking Number, in Arabic, matching the spec example', async () => {
    const order = await createAcceptedOrder();
    await expect(
      shippingHandler.importRow(
        shippingRow(order.externalOrderId!, { status: 'DELIVERED' }),
      ),
    ).rejects.toThrow('رقم التتبع مطلوب لهذه الحالة.');

    const current = await shipmentsService.getCurrent(order.id);
    expect(current).toBeNull();
  });

  // ---------------------------------------------------------------------
  // H. Reship -> a NEW Shipment row, the old one preserved (never mutated).
  // ---------------------------------------------------------------------
  it('creates a new Shipment on reship while preserving the original attempt', async () => {
    // Starts at SHIPPED, not DELIVERED — DELIVERED is now the seeded FINAL
    // example (Shipping Status Configuration + Final-Shipment Sync Rules),
    // so a shipment that reaches it is skipped by every later sync row
    // (see the FINAL-status describe block below). Reship only requires
    // NEEDS_RESHIPMENT, never DELIVERED, so this stays entirely UNDER_SYNC.
    const order = await createAcceptedOrder();
    await shippingHandler.importRow(
      shippingRow(order.externalOrderId!, { status: 'SHIPPED' }),
    );
    await shippingHandler.importRow(
      shippingRow(order.externalOrderId!, { status: 'DELIVERY_FAILED' }),
    );
    await shippingHandler.importRow(
      shippingRow(order.externalOrderId!, { status: 'NEEDS_RESHIPMENT' }),
    );
    const reshipResult = await shippingHandler.importRow(
      shippingRow(order.externalOrderId!, { status: 'LABEL_CREATED' }),
    );

    const allAttempts = await shipmentsService.findAllForOrder(order.id);
    expect(allAttempts).toHaveLength(2);
    expect(allAttempts[0].status).toBe(ShipmentStatus.NEEDS_RESHIPMENT);
    expect(allAttempts[0].isReship).toBe(false);
    expect(allAttempts[1].id).toBe(reshipResult.id);
    expect(allAttempts[1].status).toBe(ShipmentStatus.LABEL_CREATED);
    expect(allAttempts[1].isReship).toBe(true);
  });

  // ---------------------------------------------------------------------
  // Final-Shipment Sync Rules — Shipping Status Configuration.
  // ---------------------------------------------------------------------
  describe('Final-Shipment Sync Rules', () => {
    async function statusIdByCode(code: string): Promise<string> {
      const status = await prisma.shippingStatus.findFirstOrThrow({
        where: { code, deletedAt: null },
      });
      return status.id;
    }

    it('applies an incoming FINAL status once, then skips it on the next sync run', async () => {
      const order = await createAcceptedOrder();
      const first = await shippingHandler.importRow(
        shippingRow(order.externalOrderId!, {
          status: 'DELIVERED',
          trackingNumber: `TRK-${randomUUID().slice(0, 8)}`,
        }),
      );
      expect(first.noChange).toBeFalsy();
      expect(first.skippedFinal).toBeFalsy();
      const shipment = await prisma.shipment.findUniqueOrThrow({
        where: { id: first.id },
      });
      expect(shipment.status).toBe(ShipmentStatus.DELIVERED);

      const second = await shippingHandler.importRow(
        shippingRow(order.externalOrderId!, {
          status: 'DELIVERED',
          trackingNumber: `TRK-${randomUUID().slice(0, 8)}`,
        }),
      );
      expect(second.skippedFinal).toBe(true);
      expect(second.id).toBe(first.id);
    });

    it('skips an existing FINAL shipment before validating the incoming row fields at all', async () => {
      const order = await createAcceptedOrder();
      await shippingHandler.importRow(
        shippingRow(order.externalOrderId!, {
          status: 'DELIVERED',
          trackingNumber: `TRK-${randomUUID().slice(0, 8)}`,
        }),
      );
      const before = await shipmentsService.getCurrent(order.id);

      // Garbage that would normally throw (unknown status text, unknown
      // shipping company) — must never be reached once current is FINAL.
      const result = await shippingHandler.importRow(
        shippingRow(order.externalOrderId!, {
          status: 'حالة غير معرفة إطلاقًا',
          shippingCompanyName: `Nonexistent Co ${randomUUID()}`,
        }),
      );
      expect(result.skippedFinal).toBe(true);
      expect(result.id).toBe(before!.id);

      const after = await shipmentsService.getCurrent(order.id);
      expect(after?.status).toBe(ShipmentStatus.DELIVERED);
      expect(after?.updatedAt.getTime()).toBe(before!.updatedAt.getTime());
    });

    it('keeps an UNDER_SYNC shipment eligible for repeated updates across syncs', async () => {
      const order = await createAcceptedOrder();
      await shippingHandler.importRow(
        shippingRow(order.externalOrderId!, { status: 'LABEL_CREATED' }),
      );
      const second = await shippingHandler.importRow(
        shippingRow(order.externalOrderId!, { status: 'SHIPPED' }),
      );
      expect(second.skippedFinal).toBeFalsy();
      const third = await shippingHandler.importRow(
        shippingRow(order.externalOrderId!, { status: 'OUT_FOR_DELIVERY' }),
      );
      expect(third.skippedFinal).toBeFalsy();

      const shipment = await shipmentsService.getCurrent(order.id);
      expect(shipment?.status).toBe(ShipmentStatus.OUT_FOR_DELIVERY);
    });

    it('lets a permitted user directly change a shipment to any status — no forced sequence, no rigid transition matrix', async () => {
      const order = await createAcceptedOrder();
      await shippingHandler.importRow(
        shippingRow(order.externalOrderId!, { status: 'LABEL_CREATED' }),
      );
      // Straight to DELIVERED — never walked through SHIPPED/OUT_FOR_DELIVERY.
      const deliveredId = await statusIdByCode('DELIVERED');
      const jumped = await operations.setShippingStatus(order.id, deliveredId);
      expect(jumped.status).toBe(ShipmentStatus.DELIVERED);
    });

    it('reopening a FINAL shipment back to UNDER_SYNC logs SHIPMENT_REOPENED and makes it eligible for sync again', async () => {
      const order = await createAcceptedOrder();
      await shippingHandler.importRow(
        shippingRow(order.externalOrderId!, {
          status: 'DELIVERED',
          trackingNumber: `TRK-${randomUUID().slice(0, 8)}`,
        }),
      );

      const skipped = await shippingHandler.importRow(
        shippingRow(order.externalOrderId!, { status: 'DELIVERY_FAILED' }),
      );
      expect(skipped.skippedFinal).toBe(true);

      const deliveryFailedId = await statusIdByCode('DELIVERY_FAILED');
      const reopened = await operations.setShippingStatus(
        order.id,
        deliveryFailedId,
      );
      expect(reopened.status).toBe(ShipmentStatus.DELIVERY_FAILED);

      const reopenedActivity = await prisma.storeOrderActivity.findMany({
        where: { storeOrderId: order.id, action: 'SHIPMENT_REOPENED' },
      });
      expect(reopenedActivity).toHaveLength(1);

      // Now eligible for sync again — no longer silently skipped as final.
      // The reopen itself (a manual write) is newer than the shipment's
      // last successful sync stamp, so the very next sync row correctly
      // raises the existing conflict-review gate rather than the
      // final-status skip — proving it re-entered the normal UNDER_SYNC
      // flow, not that it stayed final.
      const resumeRow = shippingRow(order.externalOrderId!, {
        status: 'NEEDS_RESHIPMENT',
      });
      await expect(shippingHandler.importRow(resumeRow)).rejects.toThrow(
        'تم تعديل الشحنة في النظام بعد آخر مزامنة',
      );

      // Human confirms the review — the row applies exactly like any other
      // UNDER_SYNC update from here on.
      const resumed = await shippingHandler.resolveNeedsReview(resumeRow);
      expect(resumed.skippedFinal).toBeFalsy();
      const shipment = await shipmentsService.getCurrent(order.id);
      expect(shipment?.status).toBe(ShipmentStatus.NEEDS_RESHIPMENT);
    });

    it('logs SHIPMENT_FINALIZED when a direct change lands on FINAL, distinct from SHIPMENT_REOPENED leaving one', async () => {
      const order = await createAcceptedOrder();
      await shippingHandler.importRow(
        shippingRow(order.externalOrderId!, { status: 'LABEL_CREATED' }),
      );

      const deliveredId = await statusIdByCode('DELIVERED');
      await operations.setShippingStatus(order.id, deliveredId);
      const finalizedActivity = await prisma.storeOrderActivity.findMany({
        where: { storeOrderId: order.id, action: 'SHIPMENT_FINALIZED' },
      });
      expect(finalizedActivity).toHaveLength(1);

      const shippedId = await statusIdByCode('SHIPPED');
      await operations.setShippingStatus(order.id, shippedId);
      const reopenedActivity = await prisma.storeOrderActivity.findMany({
        where: { storeOrderId: order.id, action: 'SHIPMENT_REOPENED' },
      });
      expect(reopenedActivity).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------
  // Orchestrator-driven scenarios (I, J, K, L) — need a fake
  // GoogleSheetsService since no real spreadsheet is reachable in CI.
  // ---------------------------------------------------------------------
  describe('via SyncOrchestratorService (Google Sheets channel)', () => {
    let orchestrator: SyncOrchestratorService;
    let sources: SyncSourceConfigService;
    let innerModuleRef: TestingModule;
    let fakeSheets: {
      rows: Record<string, string>[];
      getSheetAsCsv: jest.Mock;
      getSpreadsheetMetadata: jest.Mock;
      resolveSheetTitle: jest.Mock;
      writeRowResults: jest.Mock;
      ensureResultColumns: jest.Mock;
      getHeaders: jest.Mock;
      renameHeader: jest.Mock;
    };

    const HEADERS = [
      'External Order ID',
      'Shipping Status',
      'Tracking Number',
      'Shipping Company',
      'Notes',
    ];

    function toCsv(rows: Record<string, string>[]): string {
      const lines = [HEADERS.join(',')];
      for (const row of rows)
        lines.push(HEADERS.map((h) => row[h] ?? '').join(','));
      return lines.join('\n');
    }

    beforeEach(async () => {
      fakeSheets = {
        rows: [],
        getSheetAsCsv: jest.fn(),
        getSpreadsheetMetadata: jest.fn(),
        resolveSheetTitle: jest.fn().mockResolvedValue('Sheet1'),
        writeRowResults: jest.fn(),
        ensureResultColumns: jest.fn((_id: string, names: string[]) => {
          for (const name of names) {
            for (const row of fakeSheets.rows) {
              if (!(name in row)) row[name] = '';
            }
          }
          return Promise.resolve(
            Object.fromEntries(
              names.map((name, index) => [name, `COL${index}`]),
            ),
          );
        }),
        getHeaders: jest.fn(() => {
          if (fakeSheets.rows[0])
            return Promise.resolve(Object.keys(fakeSheets.rows[0]));
          return Promise.resolve([...HEADERS]);
        }),
        renameHeader: jest.fn((_id: string, from: string, to: string) => {
          for (const row of fakeSheets.rows) {
            if (from in row && !(to in row)) {
              row[to] = row[from];
              delete row[from];
            }
          }
          return Promise.resolve(true);
        }),
      };
      fakeSheets.getSheetAsCsv.mockImplementation(() =>
        Promise.resolve(toCsv(fakeSheets.rows)),
      );

      innerModuleRef = await Test.createTestingModule({
        imports: [
          PrismaModule,
          PermissionsCoreModule,
          PhoneModule,
          AuthModule,
          ImportCenterModule,
          StoreOrdersModule,
          ObjectStorageModule,
        ],
      })
        .overrideProvider(GoogleSheetsService)
        .useValue(fakeSheets)
        .compile();
      await innerModuleRef.init();

      orchestrator = innerModuleRef.get(SyncOrchestratorService);
      sources = innerModuleRef.get(SyncSourceConfigService);
    });

    afterEach(async () => {
      await innerModuleRef.close();
    });

    async function createSource(rows: Record<string, string>[]) {
      fakeSheets.rows = rows;
      return sources.create({
        sourceType: 'SHIPPING_UPDATES',
        label: `${SOURCE_LABEL_PREFIX} ${randomUUID()}`,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${randomUUID()}/edit`,
        columnMapping: {
          externalOrderId: 'External Order ID',
          status: 'Shipping Status',
          trackingNumber: 'Tracking Number',
          shippingCompanyName: 'Shipping Company',
          notes: 'Notes',
        },
      });
    }

    function sheetRow(
      externalOrderId: string,
      options: {
        status?: string;
        trackingNumber?: string;
        shippingCompany?: string;
        notes?: string;
      } = {},
    ): Record<string, string> {
      return {
        'External Order ID': externalOrderId,
        'Shipping Status': options.status ?? '',
        'Tracking Number': options.trackingNumber ?? '',
        'Shipping Company': options.shippingCompany ?? '',
        Notes: options.notes ?? '',
      };
    }

    // ---------------------------------------------------------------------
    // I. Multi-row batch -> every row processed and correctly attributed.
    // ---------------------------------------------------------------------
    it('processes a multi-row batch, updating every order to its own requested status', async () => {
      const orderA = await createAcceptedOrder();
      const orderB = await createAcceptedOrder();
      const orderC = await createAcceptedOrder();
      const source = await createSource([
        sheetRow(orderA.externalOrderId!, { status: 'LABEL_CREATED' }),
        sheetRow(orderB.externalOrderId!, { status: 'SHIPPED' }),
        sheetRow(orderC.externalOrderId!, { status: 'OUT_FOR_DELIVERY' }),
      ]);

      const preview = await orchestrator.preview(source.id);
      expect(preview.totalRows).toBe(3);
      expect(preview.willImportCount).toBe(3);

      const commitResult = await orchestrator.commit(source.id, preview.jobId);
      expect(commitResult.importedCount).toBe(3);
      expect(commitResult.errorCount).toBe(0);

      const [shipmentA, shipmentB, shipmentC] = await Promise.all([
        shipmentsService.getCurrent(orderA.id),
        shipmentsService.getCurrent(orderB.id),
        shipmentsService.getCurrent(orderC.id),
      ]);
      expect(shipmentA?.status).toBe(ShipmentStatus.LABEL_CREATED);
      expect(shipmentB?.status).toBe(ShipmentStatus.SHIPPED);
      expect(shipmentC?.status).toBe(ShipmentStatus.OUT_FOR_DELIVERY);
    });

    // ---------------------------------------------------------------------
    // J. Sort/reorder resilience -> matching is by External Order ID, never
    //    by physical row position, so reordering the sheet between syncs
    //    must still update the correct order.
    // ---------------------------------------------------------------------
    it('still resolves the correct order after the sheet rows are reordered between syncs', async () => {
      const orderA = await createAcceptedOrder();
      const orderB = await createAcceptedOrder();

      const firstSource = await createSource([
        sheetRow(orderA.externalOrderId!, { status: 'LABEL_CREATED' }),
        sheetRow(orderB.externalOrderId!, { status: 'LABEL_CREATED' }),
      ]);
      const firstPreview = await orchestrator.preview(firstSource.id);
      await orchestrator.commit(firstSource.id, firstPreview.jobId);

      // Simulate a human reordering the spreadsheet rows before the next
      // sync: B now comes first, and each order asks for a DIFFERENT next
      // status than the other.
      fakeSheets.rows = [
        sheetRow(orderB.externalOrderId!, { status: 'OUT_FOR_DELIVERY' }),
        sheetRow(orderA.externalOrderId!, { status: 'SHIPPED' }),
      ];
      const secondPreview = await orchestrator.preview(firstSource.id);
      await orchestrator.commit(firstSource.id, secondPreview.jobId);

      const [shipmentA, shipmentB] = await Promise.all([
        shipmentsService.getCurrent(orderA.id),
        shipmentsService.getCurrent(orderB.id),
      ]);
      expect(shipmentA?.status).toBe(ShipmentStatus.SHIPPED);
      expect(shipmentB?.status).toBe(ShipmentStatus.OUT_FOR_DELIVERY);
    });

    // ---------------------------------------------------------------------
    // K. Write-back after reorder -> the report/write-back rows line up
    //    with the sheet's NEW physical row order, not the old one.
    // ---------------------------------------------------------------------
    it("writes the sync report back matching the sheet's current row order after a reorder", async () => {
      const orderA = await createAcceptedOrder();
      const orderB = await createAcceptedOrder();

      const source = await createSource([
        sheetRow(orderA.externalOrderId!, { status: 'LABEL_CREATED' }),
        sheetRow(orderB.externalOrderId!, { status: 'LABEL_CREATED' }),
      ]);
      const firstPreview = await orchestrator.preview(source.id);
      await orchestrator.commit(source.id, firstPreview.jobId);

      // Reordered: B is now row 2, A is now row 3.
      fakeSheets.rows = [
        sheetRow(orderB.externalOrderId!, { status: 'SHIPPED' }),
        sheetRow(orderA.externalOrderId!, { status: 'SHIPPED' }),
      ];
      const secondPreview = await orchestrator.preview(source.id);
      const commitResult = await orchestrator.commit(
        source.id,
        secondPreview.jobId,
      );

      const rows = commitResult.rows as ShippingSyncRowReport[];
      const byExternalId = new Map(rows.map((r) => [r.externalOrderId, r]));
      expect(byExternalId.get(orderA.externalOrderId!)?.result).toBe('UPDATED');
      expect(byExternalId.get(orderB.externalOrderId!)?.result).toBe('UPDATED');

      const call = fakeSheets.writeRowResults.mock.calls[
        fakeSheets.writeRowResults.mock.calls.length - 1
      ] as [string, { rowNumber: number; values: Record<string, string> }[]];
      const writtenByRow = new Map(call[1].map((r) => [r.rowNumber, r.values]));
      // Row 2 in the reordered sheet is B's row, row 3 is A's — the written
      // "Shipment ID" for each row must match that order's OWN shipment,
      // never the other order's (which a row-number-based match would risk).
      const shipmentA = await shipmentsService.getCurrent(orderA.id);
      const shipmentB = await shipmentsService.getCurrent(orderB.id);
      expect(writtenByRow.get(2)?.['Shipment ID']).toBe(shipmentB!.id);
      expect(writtenByRow.get(3)?.['Shipment ID']).toBe(shipmentA!.id);
    });

    // ---------------------------------------------------------------------
    // L. Repeat sync with no changes -> NO_CHANGE, never a duplicate Shipment.
    // ---------------------------------------------------------------------
    it('never creates a duplicate Shipment on a repeat sync of unchanged data', async () => {
      const order = await createAcceptedOrder();
      const source = await createSource([
        sheetRow(order.externalOrderId!, { status: 'SHIPPED' }),
      ]);

      const firstPreview = await orchestrator.preview(source.id);
      const firstCommit = await orchestrator.commit(
        source.id,
        firstPreview.jobId,
      );
      expect(firstCommit.rows?.[0].result).toBe('UPDATED');

      const secondPreview = await orchestrator.preview(source.id);
      const secondCommit = await orchestrator.commit(
        source.id,
        secondPreview.jobId,
      );
      expect(secondCommit.rows?.[0].result).toBe('NO_CHANGE');

      const allAttempts = await shipmentsService.findAllForOrder(order.id);
      expect(allAttempts).toHaveLength(1);
    });

    // ---------------------------------------------------------------------
    // Shared-sheet column isolation (spec scenarios 7-10): Store Orders Sync
    // and Shipping Sync point at the SAME physical spreadsheet/tab — one
    // `SyncSourceConfig` row per sourceType against the same spreadsheetId+
    // gid, exactly like the real "Default Agent" sheet — with DISTINCT
    // column subsets and DISTINCT write-back keys, proving neither sync type
    // can read the other's input columns or clobber the other's result
    // columns.
    // ---------------------------------------------------------------------
    describe('shared-sheet column isolation (Store Orders + Shipping on one sheet)', () => {
      const SHARED_HEADERS = [
        // Store Orders input (A:P equivalent)
        'External Order ID',
        'Order Date',
        'Customer Name',
        'Customer Phone',
        'Country',
        'Detailed Address',
        'Product SKU',
        'Quantity',
        'Paid Amount',
        'Currency',
        'Payment Method',
        'Employee Email',
        // Shipping input (T:W equivalent) — lives on the SAME row/sheet
        'Shipping Status',
        'Tracking Number',
        'Shipping Company',
        'Notes',
      ];

      function toSharedCsv(rows: Record<string, string>[]): string {
        const lines = [SHARED_HEADERS.join(',')];
        for (const row of rows) {
          lines.push(SHARED_HEADERS.map((h) => row[h] ?? '').join(','));
        }
        return lines.join('\n');
      }

      async function createStoreOrdersSource(rows: Record<string, string>[]) {
        fakeSheets.rows = rows;
        fakeSheets.getSheetAsCsv.mockImplementation(() =>
          Promise.resolve(toSharedCsv(fakeSheets.rows)),
        );
        return sources.create({
          sourceType: 'STORE_ORDERS',
          label: `${SOURCE_LABEL_PREFIX} ${randomUUID()}`,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${randomUUID()}/edit`,
          columnMapping: {
            externalOrderId: 'External Order ID',
            orderDate: 'Order Date',
            customerName: 'Customer Name',
            customerPhone: 'Customer Phone',
            countryName: 'Country',
            address: 'Detailed Address',
            productSku: 'Product SKU',
            quantity: 'Quantity',
            paidAmount: 'Paid Amount',
            currencyCode: 'Currency',
            paymentMethodLabel: 'Payment Method',
            agentEmail: 'Employee Email',
          },
        });
      }

      async function createShippingSource(rows: Record<string, string>[]) {
        fakeSheets.rows = rows;
        fakeSheets.getSheetAsCsv.mockImplementation(() =>
          Promise.resolve(toSharedCsv(fakeSheets.rows)),
        );
        return sources.create({
          sourceType: 'SHIPPING_UPDATES',
          label: `${SOURCE_LABEL_PREFIX} ${randomUUID()}`,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${randomUUID()}/edit`,
          columnMapping: {
            externalOrderId: 'External Order ID',
            status: 'Shipping Status',
            trackingNumber: 'Tracking Number',
            shippingCompanyName: 'Shipping Company',
            notes: 'Notes',
          },
        });
      }

      function sharedRow(
        overrides: Partial<Record<string, string>> = {},
      ): Record<string, string> {
        return {
          'External Order ID': `SHARED-EXT-${randomUUID()}`,
          'Order Date': '2026-08-01',
          'Customer Name': 'Sync Test Customer',
          'Customer Phone': `+9665${Math.floor(10000000 + Math.random() * 89999999)}`,
          Country: countryName,
          'Detailed Address': 'Test address',
          'Product SKU': productDisplayName,
          Quantity: '1',
          'Paid Amount': '100',
          Currency: currencyCode,
          'Payment Method': paymentMethodLabel,
          'Employee Email': employeeEmail,
          'Shipping Status': '',
          'Tracking Number': '',
          'Shipping Company': '',
          Notes: '',
          ...overrides,
        };
      }

      it('Store Orders Sync writes ONLY Sync Status/System Order ID/Error Message — never a Shipping key — even on a row that also carries shipping input columns', async () => {
        const row = sharedRow();
        const source = await createStoreOrdersSource([row]);

        const preview = await orchestrator.preview(source.id);
        const commitResult = await orchestrator.commit(
          source.id,
          preview.jobId,
        );
        expect(commitResult.importedCount).toBe(1);

        const call = fakeSheets.writeRowResults.mock.calls[0] as [
          string,
          { rowNumber: number; values: Record<string, string> }[],
        ];
        const keys = Object.keys(call[1][0].values).sort();
        expect(keys).toEqual(
          ['Error Message', 'Sync Status', 'System Order ID'].sort(),
        );
        expect(keys).not.toContain('Shipping Sync Status');
        expect(keys).not.toContain('Shipping Sync Message');
        expect(keys).not.toContain('Shipment ID');
      });

      it('Shipping Sync reads only its own T:W-equivalent input columns — ignoring the Store Orders A:P data present on the same row — and writes ONLY its own result columns', async () => {
        // A real accepted Store Order the shipping row will target —
        // Shipping Sync must match an EXISTING order, never create one.
        const order = await createAcceptedOrder();

        const row = sharedRow({
          'External Order ID': order.externalOrderId!,
          // Deliberately blank/garbage Store-Orders-shaped input alongside
          // the real shipping input — Shipping Sync's `columnMapping` never
          // references these header names, so it must ignore them entirely
          // rather than getting confused or blocked by their presence.
          'Customer Name': '',
          'Customer Phone': '',
          Country: '',
          'Detailed Address': '',
          'Product SKU': '',
          Quantity: '',
          'Paid Amount': '',
          Currency: '',
          'Payment Method': '',
          'Employee Email': '',
          'Shipping Status': 'LABEL_CREATED',
          'Shipping Company': shippingCompanyName,
        });
        const source = await createShippingSource([row]);

        const preview = await orchestrator.preview(source.id);
        expect(preview.totalRows).toBe(1);
        expect(preview.willImportCount).toBe(1);

        const commitResult = await orchestrator.commit(
          source.id,
          preview.jobId,
        );
        expect(commitResult.importedCount).toBe(1);

        const shipment = await shipmentsService.getCurrent(order.id);
        expect(shipment?.status).toBe(ShipmentStatus.LABEL_CREATED);

        const call = fakeSheets.writeRowResults.mock.calls[0] as [
          string,
          { rowNumber: number; values: Record<string, string> }[],
        ];
        const keys = Object.keys(call[1][0].values).sort();
        expect(keys).toEqual(
          [
            'Shipment ID',
            'Shipping Sync Message',
            'Shipping Sync Status',
          ].sort(),
        );
        expect(keys).not.toContain('Sync Status');
        expect(keys).not.toContain('System Order ID');
        expect(keys).not.toContain('Error Message');
      });
    });

    describe('reuses the Store Orders Google Sheets source', () => {
      const REUSE_HEADERS = [
        'External Order ID',
        'Order Date',
        'Customer Name',
        'Customer Phone',
        'Country',
        'Detailed Address',
        'Product SKU',
        'Quantity',
        'Paid Amount',
        'Currency',
        'Payment Method',
        'Employee Email',
        'Sync Status',
        'System Order ID',
        'Error Message',
        'Shipping Status',
        'Tracking Number',
        'Shipping Company',
        'Shipping Label URL',
      ];

      function toReuseCsv(rows: Record<string, string>[]): string {
        const lines = [REUSE_HEADERS.join(',')];
        for (const row of rows) {
          lines.push(REUSE_HEADERS.map((h) => row[h] ?? '').join(','));
        }
        return lines.join('\n');
      }

      function reuseRow(
        overrides: Partial<Record<string, string>> = {},
      ): Record<string, string> {
        return {
          'External Order ID': `REUSE-EXT-${randomUUID()}`,
          'Order Date': '2026-08-01',
          'Customer Name': 'Sync Test Customer',
          'Customer Phone': `+9665${Math.floor(10000000 + Math.random() * 89999999)}`,
          Country: countryName,
          'Detailed Address': 'Test address',
          'Product SKU': productDisplayName,
          Quantity: '1',
          'Paid Amount': '100',
          Currency: currencyCode,
          'Payment Method': paymentMethodLabel,
          'Employee Email': employeeEmail,
          'Sync Status': 'تم الاستيراد',
          'System Order ID': '',
          'Error Message': '',
          'Shipping Status': '',
          'Tracking Number': '',
          'Shipping Company': '',
          'Shipping Label URL': '',
          ...overrides,
        };
      }

      async function createStoreOrdersOnly(rows: Record<string, string>[]) {
        fakeSheets.rows = rows;
        fakeSheets.getSheetAsCsv.mockImplementation(() =>
          Promise.resolve(toReuseCsv(fakeSheets.rows)),
        );
        return sources.create({
          sourceType: 'STORE_ORDERS',
          label: `${SOURCE_LABEL_PREFIX} ${randomUUID()}`,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${randomUUID()}/edit`,
          columnMapping: {
            externalOrderId: 'External Order ID',
            orderDate: 'Order Date',
            customerName: 'Customer Name',
            customerPhone: 'Customer Phone',
            countryName: 'Country',
            address: 'Detailed Address',
            productSku: 'Product SKU',
            quantity: 'Quantity',
            paidAmount: 'Paid Amount',
            currencyCode: 'Currency',
            paymentMethodLabel: 'Payment Method',
            agentEmail: 'Employee Email',
          },
        });
      }

      it('lists the Store Orders source for Shipping Sync without a SHIPPING_UPDATES config', async () => {
        const source = await createStoreOrdersOnly([reuseRow()]);
        const listed = await sources.findAll('SHIPPING_UPDATES');
        expect(listed.some((item) => item.id === source.id)).toBe(true);
        expect(
          listed.every(
            (item) =>
              item.sourceType !== 'SHIPPING_UPDATES' || item.id !== source.id,
          ),
        ).toBe(true);
      });

      it('skips empty T:W and does not write shipping results or Q:R:S', async () => {
        const order = await createAcceptedOrder();
        const source = await createStoreOrdersOnly([
          reuseRow({
            'External Order ID': order.externalOrderId!,
            'System Order ID': order.internalOrderId,
          }),
        ]);

        const preview = await orchestrator.preview(source.id, undefined, {
          runAs: 'SHIPPING_UPDATES',
        });
        expect(preview.willImportCount).toBe(0);

        const commitResult = await orchestrator.commit(
          source.id,
          preview.jobId,
          undefined,
          { runAs: 'SHIPPING_UPDATES' },
        );
        expect(commitResult.importedCount).toBe(0);
        expect(fakeSheets.writeRowResults).not.toHaveBeenCalled();
      });

      it('accepts Shipping Status in column T without requiring legacy Status mapping', async () => {
        const order = await createAcceptedOrder();
        const source = await createStoreOrdersOnly([
          reuseRow({
            'External Order ID': order.externalOrderId!,
            'System Order ID': order.internalOrderId,
            'Shipping Status': 'LABEL_CREATED',
            'Tracking Number': 'TRK-MAP',
            'Shipping Company': shippingCompanyName,
          }),
        ]);

        await expect(
          orchestrator.preview(source.id, undefined, {
            runAs: 'SHIPPING_UPDATES',
          }),
        ).resolves.toMatchObject({
          willImportCount: 1,
        });
        expect(fakeSheets.renameHeader).not.toHaveBeenCalled();
      });

      it('reads T:W from the Store Orders source and writes only X+ shipping results', async () => {
        const order = await createAcceptedOrder();
        const qrsBefore = {
          'Sync Status': 'تم الاستيراد',
          'System Order ID': order.internalOrderId,
          'Error Message': 'keep-qrs',
        };
        const twBefore = {
          'Shipping Status': 'LABEL_CREATED',
          'Tracking Number': 'TRK-KEEP',
          'Shipping Company': shippingCompanyName,
          'Shipping Label URL': 'https://label.example/awb',
        };
        const source = await createStoreOrdersOnly([
          reuseRow({
            'External Order ID': order.externalOrderId!,
            ...qrsBefore,
            ...twBefore,
          }),
        ]);

        const preview = await orchestrator.preview(source.id, undefined, {
          runAs: 'SHIPPING_UPDATES',
        });
        expect(preview.willImportCount).toBe(1);

        const commitResult = await orchestrator.commit(
          source.id,
          preview.jobId,
          undefined,
          { runAs: 'SHIPPING_UPDATES' },
        );
        expect(commitResult.importedCount).toBe(1);

        const shipment = await shipmentsService.getCurrent(order.id);
        expect(shipment?.status).toBe(ShipmentStatus.LABEL_CREATED);
        expect(shipment?.trackingNumber).toBe('TRK-KEEP');

        const call = fakeSheets.writeRowResults.mock.calls[0] as [
          string,
          { rowNumber: number; values: Record<string, string> }[],
          string | undefined,
          { minStartColumn?: string } | undefined,
        ];
        const keys = Object.keys(call[1][0].values).sort();
        expect(keys).toEqual(
          [
            'Shipment ID',
            'Shipping Sync Message',
            'Shipping Sync Status',
          ].sort(),
        );
        expect(keys).not.toContain('Sync Status');
        expect(keys).not.toContain('System Order ID');
        expect(keys).not.toContain('Error Message');
        expect(keys).not.toContain('Shipping Status');
        expect(keys).not.toContain('Tracking Number');
        expect(call[3]).toEqual({ minStartColumn: 'X' });
        expect(fakeSheets.rows[0]['Sync Status']).toBe(
          qrsBefore['Sync Status'],
        );
        expect(fakeSheets.rows[0]['System Order ID']).toBe(
          qrsBefore['System Order ID'],
        );
        expect(fakeSheets.rows[0]['Error Message']).toBe(
          qrsBefore['Error Message'],
        );
        expect(fakeSheets.rows[0]['Shipping Status']).toBe(
          twBefore['Shipping Status'],
        );
        expect(fakeSheets.rows[0]['Tracking Number']).toBe(
          twBefore['Tracking Number'],
        );
      });

      // ---------------------------------------------------------------------
      // System Order ID (column R) MUST be the primary resolution key — see
      // the "URGENT PRODUCTION FIX" shipping sync spec: R populated + a
      // successful Store Order Sync (Q) must resolve/update even when an
      // External Order ID lookup would have failed on its own.
      // ---------------------------------------------------------------------
      it('resolves and updates shipping by System Order ID even when the External Order ID lookup would fail', async () => {
        const order = await createAcceptedOrder();
        const source = await createStoreOrdersOnly([
          reuseRow({
            // Deliberately WRONG/unmatchable External Order ID — proves
            // resolution never falls back to it once System Order ID (R)
            // is populated.
            'External Order ID': `DFUOR-${randomUUID()}`,
            'Sync Status': 'تم الاستيراد',
            'System Order ID': order.internalOrderId,
            'Shipping Status': 'LABEL_CREATED',
            'Shipping Company': shippingCompanyName,
          }),
        ]);

        const preview = await orchestrator.preview(source.id, undefined, {
          runAs: 'SHIPPING_UPDATES',
        });
        expect(preview.willImportCount).toBe(1);

        const commitResult = await orchestrator.commit(
          source.id,
          preview.jobId,
          undefined,
          { runAs: 'SHIPPING_UPDATES' },
        );
        expect(commitResult.importedCount).toBe(1);
        expect(commitResult.errorCount).toBe(0);

        const shipment = await shipmentsService.getCurrent(order.id);
        expect(shipment?.status).toBe(ShipmentStatus.LABEL_CREATED);
        expect(shipment?.storeOrderId).toBe(order.id);
      });

      it('still syncs shipping for a successful Store Order row carrying a historical Error Message in column S', async () => {
        const order = await createAcceptedOrder();
        const source = await createStoreOrdersOnly([
          reuseRow({
            'External Order ID': order.externalOrderId!,
            'Sync Status': 'تم الاستيراد',
            'System Order ID': order.internalOrderId,
            // A stale message left over from an earlier, unrelated failure —
            // must never block Shipping Sync once Q/R represent a
            // successfully linked OMS order.
            'Error Message': 'خطأ قديم غير ذي صلة',
            'Shipping Status': 'SHIPPED',
            'Shipping Company': shippingCompanyName,
          }),
        ]);

        const commitResult = await orchestrator.commit(
          source.id,
          (
            await orchestrator.preview(source.id, undefined, {
              runAs: 'SHIPPING_UPDATES',
            })
          ).jobId,
          undefined,
          { runAs: 'SHIPPING_UPDATES' },
        );
        expect(commitResult.importedCount).toBe(1);

        const shipment = await shipmentsService.getCurrent(order.id);
        expect(shipment?.status).toBe(ShipmentStatus.SHIPPED);
      });

      it('falls back to normalized External Order ID when System Order ID (R) is empty', async () => {
        const order = await createAcceptedOrder();
        const source = await createStoreOrdersOnly([
          reuseRow({
            // Uppercased on purpose — StoreOrder.externalOrderId is stored
            // normalized (trim + lowercase); the fallback lookup must
            // normalize too, not exact-match the raw sheet value.
            'External Order ID': order.externalOrderId!.toUpperCase(),
            'Sync Status': 'تم الاستيراد',
            'System Order ID': '',
            'Shipping Status': 'OUT_FOR_DELIVERY',
            'Shipping Company': shippingCompanyName,
          }),
        ]);

        const preview = await orchestrator.preview(source.id, undefined, {
          runAs: 'SHIPPING_UPDATES',
        });
        expect(preview.willImportCount).toBe(1);

        const commitResult = await orchestrator.commit(
          source.id,
          preview.jobId,
          undefined,
          { runAs: 'SHIPPING_UPDATES' },
        );
        expect(commitResult.importedCount).toBe(1);

        const shipment = await shipmentsService.getCurrent(order.id);
        expect(shipment?.status).toBe(ShipmentStatus.OUT_FOR_DELIVERY);
      });

      it('produces a clear Arabic error for a stale/invalid System Order ID and never creates an order or falls back', async () => {
        // A real order whose External Order ID WOULD resolve, proving the
        // stale R never silently falls back to it.
        const decoyOrder = await createAcceptedOrder();
        const staleSystemOrderId = `STO-STALE-${randomUUID()}`;
        const source = await createStoreOrdersOnly([
          reuseRow({
            'External Order ID': decoyOrder.externalOrderId!,
            'Sync Status': 'تم الاستيراد',
            'System Order ID': staleSystemOrderId,
            'Shipping Status': 'SHIPPED',
            'Shipping Company': shippingCompanyName,
          }),
        ]);

        const preview = await orchestrator.preview(source.id, undefined, {
          runAs: 'SHIPPING_UPDATES',
        });
        const commitResult = await orchestrator.commit(
          source.id,
          preview.jobId,
          undefined,
          { runAs: 'SHIPPING_UPDATES' },
        );
        expect(commitResult.importedCount).toBe(0);
        expect(commitResult.errorCount).toBe(1);

        const rows = commitResult.rows as ShippingSyncRowReport[];
        expect(rows[0].message).toContain('تعذر العثور على طلب OMS');
        expect(rows[0].message).toContain(staleSystemOrderId);

        // Never fell back to the decoy order's External Order ID.
        const decoyShipment = await shipmentsService.getCurrent(decoyOrder.id);
        expect(decoyShipment).toBeNull();
      });

      it('lets a failed shipping row retry after the sheet is corrected', async () => {
        const order = await createAcceptedOrder();
        const staleSystemOrderId = `STO-STALE-${randomUUID()}`;
        const source = await createStoreOrdersOnly([
          reuseRow({
            'External Order ID': order.externalOrderId!,
            'Sync Status': 'تم الاستيراد',
            'System Order ID': staleSystemOrderId,
            'Shipping Status': 'SHIPPED',
            'Shipping Company': shippingCompanyName,
          }),
        ]);

        const firstPreview = await orchestrator.preview(source.id, undefined, {
          runAs: 'SHIPPING_UPDATES',
        });
        const firstCommit = await orchestrator.commit(
          source.id,
          firstPreview.jobId,
          undefined,
          { runAs: 'SHIPPING_UPDATES' },
        );
        expect(firstCommit.errorCount).toBe(1);
        expect(await shipmentsService.getCurrent(order.id)).toBeNull();

        // Employee corrects System Order ID to the real value and reruns.
        fakeSheets.rows[0]['System Order ID'] = order.internalOrderId;
        const secondPreview = await orchestrator.preview(source.id, undefined, {
          runAs: 'SHIPPING_UPDATES',
        });
        const secondCommit = await orchestrator.commit(
          source.id,
          secondPreview.jobId,
          undefined,
          { runAs: 'SHIPPING_UPDATES' },
        );
        expect(secondCommit.importedCount).toBe(1);
        expect(secondCommit.errorCount).toBe(0);

        const shipment = await shipmentsService.getCurrent(order.id);
        expect(shipment?.status).toBe(ShipmentStatus.SHIPPED);
      });

      it('is idempotent on rerun for an already-synced row resolved by System Order ID — no duplicate Shipment', async () => {
        const order = await createAcceptedOrder();
        const source = await createStoreOrdersOnly([
          reuseRow({
            'External Order ID': order.externalOrderId!,
            'Sync Status': 'تم الاستيراد',
            'System Order ID': order.internalOrderId,
            'Shipping Status': 'SHIPPED',
            'Shipping Company': shippingCompanyName,
          }),
        ]);

        const firstPreview = await orchestrator.preview(source.id, undefined, {
          runAs: 'SHIPPING_UPDATES',
        });
        const firstCommit = await orchestrator.commit(
          source.id,
          firstPreview.jobId,
          undefined,
          { runAs: 'SHIPPING_UPDATES' },
        );
        expect(firstCommit.importedCount).toBe(1);
        const firstShipment = await shipmentsService.getCurrent(order.id);

        const secondPreview = await orchestrator.preview(source.id, undefined, {
          runAs: 'SHIPPING_UPDATES',
        });
        const secondCommit = await orchestrator.commit(
          source.id,
          secondPreview.jobId,
          undefined,
          { runAs: 'SHIPPING_UPDATES' },
        );
        const rows = secondCommit.rows as ShippingSyncRowReport[];
        expect(rows[0].result).toBe('NO_CHANGE');
        expect(rows[0].shipmentId).toBe(firstShipment!.id);

        const allAttempts = await shipmentsService.findAllForOrder(order.id);
        expect(allAttempts).toHaveLength(1);
      });

      // ---------------------------------------------------------------------
      // Final-Shipment Sync Rules — Reporting: a skipped-final row is a
      // concise, non-error result and writes only X:Y:Z, never Q:R:S/T:W.
      // ---------------------------------------------------------------------
      it('classifies a repeat sync of an already-FINAL shipment as SKIPPED_FINAL, not an error, and writes only X:Y:Z', async () => {
        const order = await createAcceptedOrder();
        await shippingHandler.importRow(
          shippingRow(order.externalOrderId!, {
            status: 'DELIVERED',
            trackingNumber: `TRK-${randomUUID().slice(0, 8)}`,
          }),
        );

        const source = await createStoreOrdersOnly([
          reuseRow({
            'External Order ID': order.externalOrderId!,
            'System Order ID': order.internalOrderId,
            'Shipping Status': 'تم التسليم',
          }),
        ]);
        const preview = await orchestrator.preview(source.id, undefined, {
          runAs: 'SHIPPING_UPDATES',
        });
        const commitResult = await orchestrator.commit(
          source.id,
          preview.jobId,
          undefined,
          { runAs: 'SHIPPING_UPDATES' },
        );
        expect(commitResult.errorCount).toBe(0);
        expect(commitResult.skippedFinalCount).toBe(1);

        const rows = commitResult.rows as ShippingSyncRowReport[];
        expect(rows[0].result).toBe('SKIPPED_FINAL');

        const call = fakeSheets.writeRowResults.mock.calls[0] as [
          string,
          { rowNumber: number; values: Record<string, string> }[],
        ];
        const keys = Object.keys(call[1][0].values).sort();
        expect(keys).toEqual(
          [
            'Shipment ID',
            'Shipping Sync Message',
            'Shipping Sync Status',
          ].sort(),
        );
      });
    });
  });
});
