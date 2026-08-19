import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  ProductType,
  PaymentStatus,
  StoreOrderPaymentStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ImportCenterModule } from '../import-center.module';
import { StoreOrdersModule } from '../../store-orders/store-orders.module';
import { StoreOrdersImportHandler } from '../handlers/store-orders-import.handler';
import { BankTransactionsImportHandler } from '../handlers/bank-transactions-import.handler';
import { StoreOrderPaymentSyncService } from '../../store-orders/store-order-payment-sync.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { PermissionsCoreModule } from '../../permissions/permissions-core.module';
import { PhoneModule } from '../../common/phone/phone.module';
import { AuthModule } from '../../auth/auth.module';
import { ImportRowNeedsReviewError } from '../import-type.interface';
import { GoogleSheetsService } from '../google-sheets.service';
import { SyncOrchestratorService } from './sync-orchestrator.service';
import { SyncSourceConfigService } from './sync-source-config.service';

/**
 * Data Synchronization — the 12 scenarios called for in the feature spec.
 * Runs against the real local Postgres (docker-compose `oms-postgres`),
 * exercising the actual handlers/services `SyncOrchestratorService` drives
 * — never mocked Prisma — since the behavior under test (idempotency,
 * needs-review, permission enforcement, write-back timing) is exactly the
 * kind of thing a mock would let drift from reality. Only `GoogleSheetsService`
 * is faked (scenarios 11/12), since no real spreadsheet/network is available
 * in CI — everything downstream of "here are the sheet's rows" is real.
 */
/**
 * Own label namespace per run. This suite and `shipping-sync.spec.ts` both
 * create Sync Sources and both sweep them by label prefix in `afterAll`; when
 * Jest runs them in parallel against the shared dev database, a shared prefix
 * meant one suite's cleanup deleted the other suite's live config mid-test.
 */
const SOURCE_LABEL_PREFIX = `Sync Test Source DS-${randomUUID()}`;

/**
 * Same reasoning for the users this suite creates: both sync suites used to
 * create `sync-test-*` accounts and delete every one of them in `afterAll`,
 * so whichever finished first removed the other's still-referenced employee
 * and mid-run rows then failed to resolve Employee Email.
 */
const USER_EMAIL_PREFIX = 'sync-test-ds-';

describe('Data Synchronization', () => {
  let prisma: PrismaService;
  let storeOrdersHandler: StoreOrdersImportHandler;
  let bankTransactionsHandler: BankTransactionsImportHandler;
  let paymentSync: StoreOrderPaymentSyncService;
  let permissionsResolver: PermissionsResolverService;

  let categoryId: string;
  let unitId: string;
  let currencyId: string;
  let currencyCode: string;
  let productDisplayName: string;
  let productSku: string;
  let paymentSourceId: string;
  let receivingAccountId: string;
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
      ],
    }).compile();
    // `.compile()` alone never runs `OnModuleInit` — `.init()` triggers the
    // handlers' `onModuleInit()` (`ImportTypeRegistryService.register(this)`),
    // the same registration `main.ts`'s real `app.init()` performs.
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    storeOrdersHandler = moduleRef.get(StoreOrdersImportHandler);
    bankTransactionsHandler = moduleRef.get(BankTransactionsImportHandler);
    paymentSync = moduleRef.get(StoreOrderPaymentSyncService);
    permissionsResolver = moduleRef.get(PermissionsResolverService);

    const category = await prisma.productCategory.create({
      data: { name: `Sync Test Category ${randomUUID()}` },
    });
    categoryId = category.id;

    const unit = await prisma.unit.create({
      data: { name: `Sync Test Unit ${randomUUID()}` },
    });
    unitId = unit.id;

    // Shared master data is picked oldest-first so this suite always binds to
    // a seeded record. An unordered findFirst could latch onto a transient
    // fixture another suite creates and deletes while running in parallel,
    // which then made rows fail to resolve mid-run.
    const currency = await prisma.currency.findFirst({
      orderBy: { createdAt: 'asc' },
    });
    if (!currency) throw new Error('Expected at least one seeded Currency.');
    currencyId = currency.id;
    currencyCode = currency.code;

    productSku = `SYNC-TEST-${randomUUID().slice(0, 8)}`;
    productDisplayName = `Sync Test Product ${productSku}`;
    const product = await prisma.product.create({
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
    void product;

    const paymentSource = await prisma.paymentSource.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!paymentSource)
      throw new Error('Expected at least one seeded active PaymentSource.');
    paymentSourceId = paymentSource.id;

    const receivingAccount = await prisma.receivingAccount.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!receivingAccount) {
      throw new Error('Expected at least one seeded active ReceivingAccount.');
    }
    receivingAccountId = receivingAccount.id;

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
      orderBy: { createdAt: 'asc' },
    });
    paymentMethodLabel = paymentMethod.name;
  });

  afterAll(async () => {
    // Every fixture this suite creates is named/tagged distinctively
    // ("Sync Test ...") specifically so it can be swept up here — this
    // suite runs against the real local dev database, never a throwaway
    // one, and must not leave rows an operator would see in the app.
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

    const leftoverItems = await prisma.storeOrderItem.findMany({
      where: { product: { sku: productSku } },
      select: { storeOrderId: true },
    });
    const leftoverOrderIds = leftoverItems.map((item) => item.storeOrderId);
    if (leftoverOrderIds.length > 0) {
      await prisma.payment.deleteMany({
        where: { storeOrderId: { in: leftoverOrderIds } },
      });
      await prisma.storeOrderActivity.deleteMany({
        where: { storeOrderId: { in: leftoverOrderIds } },
      });
      await prisma.storeOrderItem.deleteMany({
        where: { storeOrderId: { in: leftoverOrderIds } },
      });
      await prisma.storeOrder.deleteMany({
        where: { id: { in: leftoverOrderIds } },
      });
    }

    const customers = await prisma.customer.findMany({
      where: {
        OR: [
          { name: { startsWith: 'Sync Test Customer' } },
          { name: { startsWith: 'Sheet Customer' } },
        ],
      },
      select: { id: true },
    });
    const customerIds = customers.map((c) => c.id);
    const orders = await prisma.storeOrder.findMany({
      where: { customerId: { in: customerIds } },
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);
    await prisma.payment.deleteMany({
      where: { storeOrderId: { in: orderIds } },
    });
    await prisma.storeOrderActivity.deleteMany({
      where: { storeOrderId: { in: orderIds } },
    });
    await prisma.storeOrderItem.deleteMany({
      where: { storeOrderId: { in: orderIds } },
    });
    await prisma.storeOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });

    await prisma.bankTransaction.deleteMany({
      where: { account: { startsWith: 'Sync Test Account' } },
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
      externalOrderId: `EXT-${randomUUID()}`,
      orderDate: '2026-08-01',
      customerName: 'Sync Test Customer',
      customerPhone: `+9665${Math.floor(10000000 + Math.random() * 89999999)}`,
      countryName,
      address: 'Test address',
      productSku: productDisplayName,
      quantity: '1',
      paidAmount: '100',
      currencyCode,
      paymentMethodLabel,
      agentEmail: employeeEmail,
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------
  // 1. Sync same Store Order twice -> no duplicate.
  // ---------------------------------------------------------------------
  it('rejects a repeated External Order ID as a duplicate, never creating a second order', async () => {
    const row = storeOrderRow();
    const first = await storeOrdersHandler.importRow(row);
    expect(first.id).toBeTruthy();

    await expect(storeOrdersHandler.importRow(row)).rejects.toThrow(
      BadRequestException,
    );

    const orders = await prisma.storeOrder.findMany({
      where: { externalOrderId: row.externalOrderId, deletedAt: null },
    });
    expect(orders).toHaveLength(1);
  });

  // ---------------------------------------------------------------------
  // 2. New External Order ID + existing phone -> Needs Review.
  // ---------------------------------------------------------------------
  it('flags a new External Order ID with an already-known phone as Needs Review, never auto-creating', async () => {
    const sharedPhone = `+9665${Math.floor(10000000 + Math.random() * 89999999)}`;
    const firstRow = storeOrderRow({ customerPhone: sharedPhone });
    await storeOrdersHandler.importRow(firstRow);

    const secondRow = storeOrderRow({ customerPhone: sharedPhone });
    await expect(storeOrdersHandler.importRow(secondRow)).rejects.toThrow(
      ImportRowNeedsReviewError,
    );

    const orders = await prisma.storeOrder.findMany({
      where: { externalOrderId: secondRow.externalOrderId },
    });
    expect(orders).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // 3. Accept a duplicate-phone order -> creates a new order.
  // ---------------------------------------------------------------------
  it('creates a new Store Order once a duplicate-phone needs-review row is confirmed', async () => {
    const sharedPhone = `+9665${Math.floor(10000000 + Math.random() * 89999999)}`;
    await storeOrdersHandler.importRow(
      storeOrderRow({ customerPhone: sharedPhone }),
    );

    const reviewRow = storeOrderRow({ customerPhone: sharedPhone });
    await expect(storeOrdersHandler.importRow(reviewRow)).rejects.toThrow(
      ImportRowNeedsReviewError,
    );

    const result = await storeOrdersHandler.resolveNeedsReview(reviewRow);
    expect(result.id).toBeTruthy();

    const order = await prisma.storeOrder.findUnique({
      where: { id: result.id },
    });
    expect(order?.externalOrderId).toBe(reviewRow.externalOrderId);

    const customerOrders = await prisma.storeOrder.findMany({
      where: { customer: { phone: sharedPhone } },
    });
    expect(customerOrders.length).toBeGreaterThanOrEqual(2);
  });

  // ---------------------------------------------------------------------
  // 4. Reject a duplicate-phone order -> no order created.
  // ---------------------------------------------------------------------
  it('never creates a Store Order for a needs-review row that is rejected instead of confirmed', async () => {
    const sharedPhone = `+9665${Math.floor(10000000 + Math.random() * 89999999)}`;
    await storeOrdersHandler.importRow(
      storeOrderRow({ customerPhone: sharedPhone }),
    );

    const reviewRow = storeOrderRow({ customerPhone: sharedPhone });
    await expect(storeOrdersHandler.importRow(reviewRow)).rejects.toThrow(
      ImportRowNeedsReviewError,
    );

    // Rejecting is simply "never call resolveNeedsReview" — the row is
    // never written by any path (see `ImportJobsService.rejectRow`, which
    // only ever updates the `ImportJobError` row, never the target service).
    const orders = await prisma.storeOrder.findMany({
      where: { externalOrderId: reviewRow.externalOrderId },
    });
    expect(orders).toHaveLength(0);
  });

  function cashFlowRow(overrides: Partial<Record<string, string>> = {}) {
    return {
      transactionId: '',
      transactionDate: '2026-08-01',
      valueDate: '',
      account: `Sync Test Account ${randomUUID()}`,
      reference: `REF-${randomUUID()}`,
      description: 'Test transaction',
      debit: '',
      credit: '250',
      amount: '',
      currencyCode,
      balance: '',
      bankName: '',
      branch: '',
      notes: '',
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------
  // 5. Existing Cash Flow transaction -> no duplicate.
  // ---------------------------------------------------------------------
  it('upserts a re-synced Cash Flow row by fingerprint instead of duplicating it', async () => {
    const row = cashFlowRow();
    const first = await bankTransactionsHandler.importRow(row);
    const second = await bankTransactionsHandler.importRow({ ...row });
    expect(second.id).toBe(first.id);

    const matches = await prisma.bankTransaction.findMany({
      where: { reference: row.reference, account: row.account },
    });
    expect(matches).toHaveLength(1);
  });

  // ---------------------------------------------------------------------
  // 6. New Cash Flow transaction -> imported.
  // ---------------------------------------------------------------------
  it('imports a genuinely new Cash Flow transaction as its own row', async () => {
    const rowA = cashFlowRow();
    const rowB = cashFlowRow();
    const resultA = await bankTransactionsHandler.importRow(rowA);
    const resultB = await bankTransactionsHandler.importRow(rowB);
    expect(resultA.id).not.toBe(resultB.id);
  });

  // ---------------------------------------------------------------------
  // Reconciliation fixture: one Store Order shared by scenarios 7-9.
  // ---------------------------------------------------------------------
  async function createReconciliationOrder(paidAmount: number) {
    const row = storeOrderRow({ paidAmount: String(paidAmount) });
    const result = await storeOrdersHandler.importRow(row);
    return prisma.storeOrder.findUniqueOrThrow({ where: { id: result.id } });
  }

  async function createVerifiedPayment(storeOrderId: string, amount: number) {
    return prisma.payment.create({
      data: {
        paymentNumber: `PAY-TEST-${randomUUID().slice(0, 8)}`,
        storeOrderId,
        amount,
        currencyId,
        paymentSourceId,
        receivingAccountId,
        senderName: 'Sync Test Payer',
        status: PaymentStatus.VERIFIED,
        paymentDate: new Date(),
      },
    });
  }

  // ---------------------------------------------------------------------
  // 7. Multiple payments for one order -> supported.
  // ---------------------------------------------------------------------
  it('sums multiple VERIFIED payments against a single Store Order', async () => {
    const order = await createReconciliationOrder(300);
    await createVerifiedPayment(order.id, 100);
    await createVerifiedPayment(order.id, 200);
    await paymentSync.recompute(order.id);

    const updated = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(updated.paymentStatus).toBe(
      StoreOrderPaymentStatus.FULLY_PAID_RECONCILED,
    );
    expect(updated.shippingStage).toBe('READY_FOR_SHIPPING');
  });

  // ---------------------------------------------------------------------
  // 8. Unmatched payment -> remains unmatched/unreconciled against the order.
  // ---------------------------------------------------------------------
  it('leaves an order only partially reconciled while a payment is still missing', async () => {
    const order = await createReconciliationOrder(300);
    await createVerifiedPayment(order.id, 100);
    await paymentSync.recompute(order.id);

    const updated = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(updated.paymentStatus).toBe(StoreOrderPaymentStatus.PARTIALLY_PAID);
  });

  // ---------------------------------------------------------------------
  // 9. Order without any payment -> remains unreconciled (PAYMENT_PENDING), still visible.
  // ---------------------------------------------------------------------
  it('leaves a payment-less order at PAYMENT_PENDING rather than silently reconciling it', async () => {
    const order = await createReconciliationOrder(150);
    await paymentSync.recompute(order.id);

    const updated = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(updated.paymentStatus).toBe(StoreOrderPaymentStatus.PAYMENT_PENDING);
    expect(updated.shippingStage).toBe('NOT_READY');

    const stillListed = await prisma.storeOrder.findUnique({
      where: { id: order.id },
    });
    expect(stillListed).not.toBeNull();
  });

  // ---------------------------------------------------------------------
  // 10. Unauthorized user -> cannot execute sync.
  // ---------------------------------------------------------------------
  it('denies import-center.sync to a user granted no permissions at all', async () => {
    const suffix = randomUUID().slice(0, 8);
    const user = await prisma.user.create({
      data: {
        email: `${USER_EMAIL_PREFIX}${suffix}@example.test`,
        username: `${USER_EMAIL_PREFIX}${suffix}`,
        fullName: 'Sync Tester',
        passwordHash: 'x',
        isSuperAdmin: false,
      },
    });

    const allowed = await permissionsResolver.hasPermission(
      user.id,
      'import-center.sync',
    );
    expect(allowed).toBe(false);

    // Same user, now actually granted the permission — proves the denial
    // above is a real permission check, not a hasPermission()/catalog gap.
    const permission = await prisma.permission.findUnique({
      where: { name: 'import-center.sync' },
    });
    expect(permission).not.toBeNull();
    await prisma.userPermission.create({
      data: { userId: user.id, permissionId: permission!.id },
    });
    permissionsResolver.invalidate(user.id);
    const allowedAfterGrant = await permissionsResolver.hasPermission(
      user.id,
      'import-center.sync',
    );
    expect(allowedAfterGrant).toBe(true);
  });

  // ---------------------------------------------------------------------
  // 11 & 12: Successful sync -> Import Job/audit created; write-back only
  // after a successful DB commit. Both need a fake GoogleSheetsService
  // (scenarios above never touch it) — everything else (ImportJobsService,
  // SyncOrchestratorService, SyncSourceConfigService, Prisma) is real.
  // ---------------------------------------------------------------------
  describe('sync run auditing + write-back timing', () => {
    let orchestrator: SyncOrchestratorService;
    let sources: SyncSourceConfigService;
    let innerModuleRef: TestingModule;
    let fakeSheets: {
      rows: Record<string, string>[];
      calls: { method: string; args: unknown[] }[];
      getSheetAsCsv: jest.Mock;
      getSpreadsheetMetadata: jest.Mock;
      resolveSheetTitle: jest.Mock;
      writeRowResults: jest.Mock;
      ensureResultColumns: jest.Mock;
    };

    const HEADERS = [
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
    ];

    function toCsv(rows: Record<string, string>[]): string {
      const lines = [HEADERS.join(',')];
      for (const row of rows) {
        lines.push(HEADERS.map((h) => row[h] ?? '').join(','));
      }
      return lines.join('\n');
    }

    beforeEach(async () => {
      fakeSheets = {
        rows: [],
        calls: [],
        getSheetAsCsv: jest.fn(),
        getSpreadsheetMetadata: jest.fn(),
        resolveSheetTitle: jest.fn().mockResolvedValue('Sheet1'),
        writeRowResults: jest.fn(),
        ensureResultColumns: jest.fn(),
      };
      fakeSheets.writeRowResults.mockImplementation(
        (
          _id: string,
          written: { rowNumber: number; values: Record<string, string> }[],
        ) => {
          for (const row of written) {
            const index = row.rowNumber - 2;
            if (!fakeSheets.rows[index]) continue;
            Object.assign(fakeSheets.rows[index], row.values);
          }
          return Promise.resolve();
        },
      );
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

    it('records a successful sync as an ImportJob and updates the source Last Sync summary', async () => {
      const row = {
        'External Order ID': `EXT-${randomUUID()}`,
        'Order Date': '2026-08-01',
        'Customer Name': 'Sheet Customer',
        'Customer Phone': `+9665${Math.floor(10000000 + Math.random() * 89999999)}`,
        Country: countryName,
        'Detailed Address': 'Test address',
        'Product SKU': productDisplayName,
        Quantity: '2',
        'Paid Amount': '50',
        Currency: currencyCode,
        'Payment Method': paymentMethodLabel,
        'Employee Email': employeeEmail,
      };
      const source = await createSource([row]);

      const preview = await orchestrator.preview(source.id);
      expect(preview.totalRows).toBe(1);
      expect(preview.willImportCount).toBe(1);

      const commitResult = await orchestrator.commit(source.id, preview.jobId);
      expect(commitResult.status).toBe('SUCCESS');
      expect(commitResult.importedCount).toBe(1);

      const job = await prisma.importJob.findUniqueOrThrow({
        where: { id: preview.jobId },
      });
      expect(job.successCount).toBe(1);
      expect(job.sourceConnector).toBe('google-sheets');

      const updatedSource = await prisma.syncSourceConfig.findUniqueOrThrow({
        where: { id: source.id },
      });
      expect(updatedSource.lastSyncStatus).toBe('SUCCESS');
      expect(updatedSource.lastSyncedAt).not.toBeNull();

      const order = await prisma.storeOrder.findFirst({
        where: { externalOrderId: row['External Order ID'] },
      });
      expect(order).not.toBeNull();
    });

    it('never writes back to the sheet before commit, and writes back only once the DB commit has actually succeeded', async () => {
      const row = {
        'External Order ID': `EXT-${randomUUID()}`,
        'Order Date': '2026-08-01',
        'Customer Name': 'Sheet Customer 2',
        'Customer Phone': `+9665${Math.floor(10000000 + Math.random() * 89999999)}`,
        Country: countryName,
        'Detailed Address': 'Test address',
        'Product SKU': productDisplayName,
        Quantity: '1',
        'Paid Amount': '75',
        Currency: currencyCode,
        'Payment Method': paymentMethodLabel,
        'Employee Email': employeeEmail,
      };
      const source = await createSource([row]);

      const preview = await orchestrator.preview(source.id);
      expect(fakeSheets.writeRowResults).not.toHaveBeenCalled();

      await orchestrator.commit(source.id, preview.jobId);
      expect(fakeSheets.writeRowResults).toHaveBeenCalledTimes(1);

      const call = fakeSheets.writeRowResults.mock.calls[0] as [
        string,
        { rowNumber: number; values: Record<string, string> }[],
      ];
      const writtenRows = call[1];
      expect(Object.keys(writtenRows[0].values).sort()).toEqual(
        ['Error Message', 'Sync Status', 'System Order ID'].sort(),
      );
      expect(writtenRows[0].values['Sync Status']).toBe('تم الاستيراد');
      expect(writtenRows[0].values['System Order ID']).toMatch(/.+/);
      expect(writtenRows[0].values['Error Message']).toBe('');
    });

    it('writes back exactly Sync Status/System Order ID/Error Message for a rejected row — no OMS Processed At, no order id', async () => {
      const row = {
        'External Order ID': `EXT-${randomUUID()}`,
        'Order Date': '2026-08-01',
        'Customer Name': 'Sheet Customer 3',
        'Customer Phone': `+9665${Math.floor(10000000 + Math.random() * 89999999)}`,
        Country: 'Not A Real Country',
        'Detailed Address': 'Test address',
        'Product SKU': productDisplayName,
        Quantity: '1',
        'Paid Amount': '75',
        Currency: currencyCode,
        'Payment Method': paymentMethodLabel,
        'Employee Email': employeeEmail,
      };
      const source = await createSource([row]);

      const preview = await orchestrator.preview(source.id);
      expect(preview.errorCount).toBe(1);
      expect(fakeSheets.writeRowResults).toHaveBeenCalled();
      const previewCall = fakeSheets.writeRowResults.mock.calls[0] as [
        string,
        { rowNumber: number; values: Record<string, string> }[],
      ];
      expect(previewCall[1][0].values['Sync Status']).toBe('خطأ');
      expect(previewCall[1][0].values['System Order ID']).toBe('');
      expect(previewCall[1][0].values['Error Message']).toContain(
        'الدولة «Not A Real Country» غير موجودة في البيانات الأساسية.',
      );

      const commitResult = await orchestrator.commit(
        source.id,
        preview.jobId,
        undefined,
        {
          acceptRowNumbers: [],
        },
      );
      expect(commitResult.importedCount).toBe(0);

      const order = await prisma.storeOrder.findFirst({
        where: { externalOrderId: row['External Order ID'] },
      });
      expect(order).toBeNull();
    });

    function validSheetRow(overrides: Record<string, string> = {}) {
      return {
        'External Order ID': `EXT-${randomUUID()}`,
        'Order Date': '2026-08-01',
        'Customer Name': 'Sheet Customer',
        'Customer Phone': `+9665${Math.floor(10000000 + Math.random() * 89999999)}`,
        Country: countryName,
        'Detailed Address': 'Test address',
        'Product SKU': productDisplayName,
        Quantity: '1',
        'Paid Amount': '75',
        Currency: currencyCode,
        'Payment Method': paymentMethodLabel,
        'Employee Email': employeeEmail,
        ...overrides,
      };
    }

    it('TEST 1 — imported order starts PAYMENT_PENDING / NOT_READY with OMS number written back', async () => {
      const row = validSheetRow({ 'Customer Name': 'Sheet Customer Inc' });
      const source = await createSource([row]);
      const preview = await orchestrator.preview(source.id);
      expect(preview.incremental?.newCount).toBe(1);
      expect(fakeSheets.writeRowResults).not.toHaveBeenCalled();

      const commitResult = await orchestrator.commit(
        source.id,
        preview.jobId,
        undefined,
        { acceptRowNumbers: preview.rows.flatMap((r) => r.rowNumbers) },
      );
      expect(commitResult.importedCount).toBe(1);
      const order = await prisma.storeOrder.findFirstOrThrow({
        where: { externalOrderId: row['External Order ID'] },
      });
      expect(order.paymentStatus).toBe(StoreOrderPaymentStatus.PAYMENT_PENDING);
      expect(order.shippingStage).toBe('NOT_READY');
      expect(fakeSheets.rows[0]['Sync Status']).toBe('تم الاستيراد');
      expect(fakeSheets.rows[0]['System Order ID']).toBe(order.internalOrderId);
      expect(fakeSheets.rows[0]['Error Message']).toBe('');
    });

    it('TEST 4/5/6 — second identical sync skips imported rows and creates no duplicates', async () => {
      const row = validSheetRow({
        'Customer Name': 'Sheet Customer Idempotent',
      });
      const source = await createSource([row]);
      const first = await orchestrator.preview(source.id);
      await orchestrator.commit(source.id, first.jobId, undefined, {
        acceptRowNumbers: first.rows.flatMap((r) => r.rowNumbers),
      });

      const second = await orchestrator.preview(source.id);
      expect(second.incremental?.nothingToSync).toBe(true);
      expect(second.incremental?.importedSkippedCount).toBe(1);
      expect(second.rows).toHaveLength(0);
      expect(second.willImportCount).toBe(0);

      await orchestrator.commit(source.id, second.jobId, undefined, {
        acceptRowNumbers: [],
      });
      const orders = await prisma.storeOrder.findMany({
        where: { externalOrderId: row['External Order ID'] },
      });
      expect(orders).toHaveLength(1);
    });

    it('TEST 3/4 — unchanged failures are skipped; a corrected row is retried and imported', async () => {
      const row = validSheetRow({
        'Customer Name': 'Sheet Customer Retry',
        Country: 'Not A Real Country',
      });
      const source = await createSource([row]);
      const failed = await orchestrator.preview(source.id);
      expect(failed.errorCount).toBe(1);
      expect(failed.rows[0]?.lifecycle).toBe('NEW');

      const unchanged = await orchestrator.preview(source.id);
      expect(unchanged.incremental?.unchangedSkippedCount).toBe(1);
      expect(unchanged.rows).toHaveLength(0);

      fakeSheets.rows[0].Country = countryName;
      const retried = await orchestrator.preview(source.id);
      expect(retried.rows).toHaveLength(1);
      expect(retried.rows[0]?.lifecycle).toBe('RETRY');
      expect(retried.rows[0]?.status).toBe('READY');

      await orchestrator.commit(source.id, retried.jobId, undefined, {
        acceptRowNumbers: retried.rows.flatMap((r) => r.rowNumbers),
      });
      const order = await prisma.storeOrder.findFirstOrThrow({
        where: { externalOrderId: row['External Order ID'] },
      });
      expect(fakeSheets.rows[0]['Sync Status']).toBe('تم الاستيراد');
      expect(fakeSheets.rows[0]['System Order ID']).toBe(order.internalOrderId);
      expect(fakeSheets.rows[0]['Error Message']).toBe('');
    });

    it('TEST 7 — grouped Arabic errors are written once without repeating values', async () => {
      const row = validSheetRow({
        Country: 'Not A Real Country',
        'Customer Phone': '00',
      });
      const source = await createSource([row]);
      await orchestrator.preview(source.id);
      const written = fakeSheets.rows[0]['Error Message'];
      expect(written).toMatch(/رقم الجوال|الدولة/);
      const phoneMatches = written.match(/رقم الجوال/g) ?? [];
      expect(phoneMatches.length).toBeLessThanOrEqual(1);
    });

    it('TEST 11 — Google write failure after import keeps the OMS order and returns an actionable error', async () => {
      const row = validSheetRow({
        'Customer Name': 'Sheet Customer Write Fail',
      });
      const source = await createSource([row]);
      const preview = await orchestrator.preview(source.id);
      fakeSheets.writeRowResults.mockRejectedValueOnce(
        new BadRequestException(
          'تعذر تحديث جدول بيانات Google. لم يتم تغيير حالة المزامنة في الشيت.',
        ),
      );
      const commitResult = await orchestrator.commit(
        source.id,
        preview.jobId,
        undefined,
        { acceptRowNumbers: preview.rows.flatMap((r) => r.rowNumbers) },
      );
      expect(commitResult.writebackError).toBeTruthy();
      expect(commitResult.status).toBe('PARTIAL');
      const order = await prisma.storeOrder.findFirst({
        where: { externalOrderId: row['External Order ID'] },
      });
      expect(order).not.toBeNull();
      expect(fakeSheets.rows[0]['Sync Status'] ?? '').not.toBe('تم الاستيراد');
    });
  });
});
