import { Test, type TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsCoreModule } from '../../permissions/permissions-core.module';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { PhoneModule } from '../../common/phone/phone.module';
import { AuthModule } from '../../auth/auth.module';
import { PostingProvidersModule } from '../../accounting/posting-providers/posting-providers.module';
import { FxModule } from '../../accounting/fx/fx.module';
import { ObjectStorageModule } from '../../common/storage/object-storage.module';
import { StoreOrdersModule } from '../../store-orders/store-orders.module';
import { AgentsAdminModule } from '../../agents/admin/agents-admin.module';
import { AgentsService } from '../../agents/admin/agents.service';
import { AgentAgreementsService } from '../../agents/admin/agent-agreements.service';
import { AgentUsersService } from '../../agents/admin/agent-users.service';
import { AgentShippingAgreementsModule } from '../../agents/shipping-agreements/agent-shipping-agreements.module';
import { AgentShippingAgreementsService } from '../../agents/shipping-agreements/agent-shipping-agreements.service';
import {
  activateShippingAgreement,
  everyService,
} from '../../agents/shipping-agreements/shipping-agreement.fixture';
import type { AgentRequestContext } from '../../auth/guards/jwt-auth.guard';
import { ImportCenterModule } from '../import-center.module';
import { GoogleSheetsService } from '../google-sheets.service';
import { ImportWorkspaceService } from '../import-workspace.service';
import { LeadsImportHandler } from '../handlers/leads-import.handler';
import { StoreOrdersImportHandler } from '../handlers/store-orders-import.handler';
import type { ImportActor } from '../import-type.interface';

/**
 * R15 W2 — permission-controlled lead / store-order imports, end to end
 * through the actor-checked workspace the company and agent endpoints share
 * (real local Postgres; the Google Sheets client is a fake — never the real
 * API). Tagged fixtures are left in place like the other integration specs.
 */
describe('R15 W2 — sales imports (integration)', () => {
  jest.setTimeout(300_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let resolver: PermissionsResolverService;
  let workspace: ImportWorkspaceService;

  const tag = randomUUID().slice(0, 6).toUpperCase();
  const lower = tag.toLowerCase();
  const SERVICE_ACCOUNT = 'oms-import@test.iam.gserviceaccount.com';
  let sheetCsv = '';
  const sheets = {
    serviceAccountEmail: () => SERVICE_ACCOUNT,
    getSpreadsheetMetadata: jest.fn(() =>
      Promise.resolve({
        title: `Sheet ${tag}`,
        sheets: [{ sheetId: 0, title: 'Sheet1' }],
      }),
    ),
    getSheetAsCsv: jest.fn(() => Promise.resolve(sheetCsv)),
  };

  let countryName: string;
  let currencyCode: string;
  let agentCurrencyCode: string;
  let paymentMethodName: string;
  let serviceSku: string;
  let physicalSku: string;
  let agentProductSku: string;
  let agentAId: string;
  let agentBName: string;

  const ids: Record<string, string> = {};
  const emails: Record<string, string> = {};
  let agentSales: AgentRequestContext;
  let phoneSeq = 0;
  const phone = () =>
    `050${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}${String(++phoneSeq % 1000).padStart(3, '0')}`;

  const company = (key: string): ImportActor => ({ userId: ids[key] });
  const agentActor = (): ImportActor => ({
    userId: agentSales.userId,
    agent: agentSales,
  });

  const grant = async (userId: string, names: string[]) => {
    for (const name of names) {
      const permission = await prisma.permission.upsert({
        where: { name },
        create: { name },
        update: {},
      });
      await prisma.userPermission.upsert({
        where: {
          userId_permissionId: { userId, permissionId: permission.id },
        },
        create: { userId, permissionId: permission.id },
        update: {},
      });
    }
    resolver.invalidate(userId);
  };

  const makeUser = async (key: string, permissions: string[]) => {
    emails[key] = `w2-${key}-${lower}@test.local`;
    ids[key] = (
      await prisma.user.create({
        data: {
          email: emails[key],
          username: `w2-${key}-${lower}`,
          fullName: `W2 ${key} ${tag}`,
          passwordHash: 'x',
          salesDistributionEligible: true,
        },
      })
    ).id;
    await grant(ids[key], permissions);
  };

  const csv = (rows: Record<string, string>[]) => {
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const cell = (value: string) =>
      /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    return [
      headers.join(','),
      ...rows.map((row) =>
        headers.map((header) => cell(row[header] ?? '')).join(','),
      ),
    ].join('\n');
  };

  /** Create → upload (CSV) → map (headers named after field keys) → preview. */
  const prepare = async (
    actor: ImportActor,
    type: 'LEADS' | 'STORE_ORDERS',
    rows: Record<string, string>[],
  ) => {
    const job = await workspace.create(type, actor);
    const content = csv(rows);
    await workspace.upload(job.id, actor, {
      originalname: 'import.csv',
      buffer: Buffer.from(content, 'utf8'),
    } as Express.Multer.File);
    const fieldKeys = new Set(
      (type === 'LEADS'
        ? moduleRef.get(LeadsImportHandler)
        : moduleRef.get(StoreOrdersImportHandler)
      ).fields.map((field) => field.key),
    );
    const headers = content.split('\n')[0].split(',');
    await workspace.setMapping(job.id, actor, {
      columnMapping: Object.fromEntries(
        headers.filter((h) => fieldKeys.has(h)).map((h) => [h, h]),
      ),
    });
    const preview = await workspace.validate(job.id, actor);
    return { jobId: job.id, preview };
  };

  const importRows = async (
    actor: ImportActor,
    type: 'LEADS' | 'STORE_ORDERS',
    rows: Record<string, string>[],
  ) => {
    const { jobId, preview } = await prepare(actor, type, rows);
    const result = await workspace.run(jobId, actor);
    return { jobId, preview, result };
  };

  const orderRow = (over: Record<string, string> = {}) => ({
    orderDate: '2026-10-01',
    customerName: `W2 Customer ${tag} ${++phoneSeq}`,
    customerPhone: phone(),
    countryName,
    address: 'Test address',
    productSku: serviceSku,
    quantity: '1',
    unitPrice: '100',
    currencyCode,
    ...over,
  });

  const leadRow = (over: Record<string, string> = {}) => ({
    customerName: `W2 Lead ${tag} ${++phoneSeq}`,
    mobileNumber: phone(),
    countryName,
    ...over,
  });

  async function expectHttp(
    promise: Promise<unknown>,
    type: new (...args: never[]) => HttpException,
    code?: string,
  ) {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(type);
    if (code) {
      expect((caught as HttpException).getResponse()).toMatchObject({ code });
    }
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        PostingProvidersModule,
        FxModule,
        ObjectStorageModule,
        ImportCenterModule,
        StoreOrdersModule,
        AgentsAdminModule,
        AgentShippingAgreementsModule,
      ],
    })
      .overrideProvider(GoogleSheetsService)
      .useValue(sheets)
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    resolver = moduleRef.get(PermissionsResolverService);
    workspace = moduleRef.get(ImportWorkspaceService);

    const country = await prisma.country.findFirstOrThrow({
      where: { code: 'SA', deletedAt: null },
    });
    countryName = country.name;
    currencyCode = `W${tag}`;
    await prisma.currency.create({
      data: { code: currencyCode, name: `W2 Currency ${tag}` },
    });
    paymentMethodName = `W2 Method ${tag}`;
    await prisma.paymentMethod.create({
      data: { name: paymentMethodName, requiresReconciliation: false },
    });
    const categoryId = (
      await prisma.productCategory.create({
        data: { name: `w2-${tag}-category` },
      })
    ).id;
    const unitId = (
      await prisma.unit.create({ data: { name: `w2-${tag}-unit` } })
    ).id;
    const product = async (
      sku: string,
      opts: { inventory: boolean; owner?: string },
    ) =>
      prisma.product.create({
        data: {
          sku,
          name: `W2 ${sku}`,
          internalName: `W2 ${sku}`,
          displayName: `W2 ${sku}`,
          categoryId,
          unitId,
          type: opts.inventory ? 'PURCHASE_AND_SALE' : 'SERVICE',
          isPurchasable: opts.inventory,
          isSellable: true,
          isInventoryItem: opts.inventory,
          itemType: opts.inventory ? 'PRODUCT' : 'SERVICE',
          salesPrice: 100,
          ownerAgentId: opts.owner ?? null,
        },
      });
    serviceSku = `W2-${tag}-SVC`;
    physicalSku = `W2-${tag}-PHY`;
    await product(serviceSku, { inventory: false });
    await product(physicalSku, { inventory: true });

    const sellerPermissions = [
      'store-orders.import',
      'store-orders.view',
      'store-orders.edit',
      'crm.leads.import',
      'crm.leads.view',
      'crm.leads.edit',
    ];
    await makeUser('importerA', sellerPermissions);
    await makeUser('importerB', sellerPermissions);
    await makeUser('ordersOnly', ['store-orders.import', 'store-orders.view']);
    await makeUser('plain', ['crm.leads.view', 'store-orders.view']);
    await makeUser('manager', [
      'crm.leads.manage',
      'crm.leads.import',
      'crm.leads.edit',
    ]);
    await makeUser('admin', ['import-center.manage', 'store-orders.view']);

    // Agent A (agreement in force) and agent B, as the agent order specs do.
    const superAdminId = (ids.super = (
      await prisma.user.create({
        data: {
          email: `w2-super-${lower}@test.local`,
          username: `w2-super-${lower}`,
          fullName: `W2 Super ${tag}`,
          passwordHash: 'x',
          isSuperAdmin: true,
        },
      })
    ).id);
    agentCurrencyCode = `V${tag}`;
    const agentCurrencyId = (
      await prisma.currency.create({
        data: { code: agentCurrencyCode, name: `W2 Agent Currency ${tag}` },
      })
    ).id;
    const agents = moduleRef.get(AgentsService);
    const agreements = moduleRef.get(AgentAgreementsService);
    agentAId = (
      await agents.create(
        {
          name: `W2 Agent A ${tag}`,
          email: `w2-agent-a-${lower}@test.local`,
          currencyId: agentCurrencyId,
        },
        superAdminId,
      )
    ).id;
    agentBName = `W2 Agent B ${tag}`;
    await agents.create(
      {
        name: agentBName,
        email: `w2-agent-b-${lower}@test.local`,
        currencyId: agentCurrencyId,
      },
      superAdminId,
    );
    const agreement = await agreements.create(
      agentAId,
      {
        effectiveFrom: '2020-01-01',
        productCommissionRatePercent: 10,
        serviceCommissionRatePercent: 10,
        shippingPolicy: 'FLAT_FEE_PER_SHIPMENT',
        commissionEarningEvent: 'DELIVERED',
        returnCommissionTreatment: 'REVERSE',
        customerShippingChargeOwner: 'COMPANY',
        providerFeesBorneBy: 'AGENT',
        shippingFeePerShipment: 15,
        returnFeePerShipment: 20,
        serviceFeePerOrder: 0,
        allowAgentDestinations: false,
        payoutHoldDays: 7,
      },
      superAdminId,
    );
    await activateShippingAgreement(
      moduleRef.get(AgentShippingAgreementsService),
      agentAId,
      everyService(50, { countryId: country.id }),
      superAdminId,
    );
    await agreements.activate(agentAId, agreement.id, superAdminId);
    agentProductSku = `W2-${tag}-AGT`;
    await product(agentProductSku, { inventory: false, owner: agentAId });
    const sales = await moduleRef.get(AgentUsersService).create(
      agentAId,
      {
        email: `w2-agent-sales-${lower}@test.local`,
        username: `w2-agent-sales-${lower}`,
        fullName: `W2 Agent Sales ${tag}`,
        agentRole: 'SALES',
      },
      superAdminId,
    );
    agentSales = { userId: sales.id, agentId: agentAId, agentRole: 'SALES' };
  });

  afterAll(async () => {
    // Leave no lead recipients behind: other suites (lead distribution and
    // eligibility) consider every flagged user or crm.leads.edit holder.
    const userIds = Object.values(ids);
    await prisma?.userPermission.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma?.user.updateMany({
      where: { id: { in: userIds } },
      data: { salesDistributionEligible: false, isActive: false },
    });
    await moduleRef?.close();
  });

  describe('permissions and job ownership (D15-16)', () => {
    it('a salesperson with store-orders.import (no import-center.*) imports a store order as its owner', async () => {
      const row = orderRow();
      const { result } = await importRows(
        company('ordersOnly'),
        'STORE_ORDERS',
        [row],
      );
      expect(result.summary).toMatchObject({ created: 1, rejected: 0 });
      const order = await prisma.storeOrder.findFirstOrThrow({
        where: { partner: { name: row.customerName } },
      });
      expect(order.employeeId).toBe(ids.ordersOnly);
      expect(order.source).toBe('IMPORT');
      expect(order.creationIdempotencyKey).toMatch(
        /^import:company:[0-9a-f]{64}$/,
      );
    });

    it('a shared mapping template is replaced only by its creator or an Import Center administrator (review L2)', async () => {
      const name = `W2 template ${tag}`;
      const columnMapping = { customerName: 'Customer Name' };
      await workspace.saveMappingTemplate(
        { importType: 'STORE_ORDERS', name, columnMapping },
        company('importerA'),
      );
      await expectHttp(
        workspace.saveMappingTemplate(
          { importType: 'STORE_ORDERS', name, columnMapping: {} },
          company('importerB'),
        ),
        ForbiddenException,
      );
      await workspace.saveMappingTemplate(
        { importType: 'STORE_ORDERS', name, columnMapping },
        company('importerA'),
      );
      const replaced = await workspace.saveMappingTemplate(
        { importType: 'STORE_ORDERS', name, columnMapping: {} },
        company('admin'),
      );
      expect(replaced.columnMapping).toEqual({});
    });

    it('without the type permission the import is refused (403), whatever else is held', async () => {
      await expectHttp(
        workspace.create('STORE_ORDERS', company('plain')),
        ForbiddenException,
        'IMPORT_PERMISSION_REQUIRED',
      );
      await expectHttp(
        workspace.create('LEADS', company('ordersOnly')),
        ForbiddenException,
      );
      // An administrator type stays behind import-center.manage.
      await expectHttp(
        workspace.create('PRODUCTS', company('importerA')),
        ForbiddenException,
      );
      const types = await workspace.types(company('ordersOnly'));
      expect(types.map((type) => type.type)).toEqual(['STORE_ORDERS']);
    });

    it("user B can neither read, list, preview nor run user A's job; the administrator can read it", async () => {
      const { jobId } = await prepare(company('importerA'), 'LEADS', [
        leadRow(),
      ]);
      await expectHttp(
        workspace.get(jobId, company('importerB')),
        NotFoundException,
      );
      await expectHttp(
        workspace.validate(jobId, company('importerB')),
        NotFoundException,
      );
      await expectHttp(
        workspace.run(jobId, company('importerB')),
        NotFoundException,
      );
      await expectHttp(
        workspace.exportErrors(jobId, company('importerB')),
        NotFoundException,
      );
      const listB = await workspace.list(company('importerB'));
      expect(listB.map((job) => job.id)).not.toContain(jobId);
      const listA = await workspace.list(company('importerA'));
      expect(listA.map((job) => job.id)).toContain(jobId);
      expect(listA[0]).not.toHaveProperty('fileContent');
      expect((await workspace.get(jobId, company('admin'))).id).toBe(jobId);
    });
  });

  describe('owner column (2.11)', () => {
    it('defaults to the importer; naming a colleague without assignment rights rejects the row', async () => {
      const own = leadRow();
      const other = leadRow({ agentEmail: emails.importerB });
      const { preview, result } = await importRows(
        company('importerA'),
        'LEADS',
        [own, other],
      );
      expect(preview.errors.map((error) => error.rowNumber)).toEqual([3]);
      expect(preview.errors[0].message).toContain('cannot assign records');
      expect(result.summary).toMatchObject({ created: 1, rejected: 1 });
      const lead = await prisma.lead.findFirstOrThrow({
        where: { customerName: own.customerName },
      });
      expect(lead.salesEmployeeId).toBe(ids.importerA);
      expect(lead.importRowKey).toMatch(/^lead-import:company:/);
      expect(
        await prisma.lead.count({
          where: { customerName: other.customerName },
        }),
      ).toBe(0);
    });

    it('a manager (crm.leads.manage) assigns the lead to the named employee', async () => {
      const row = leadRow({ agentEmail: emails.importerB });
      const { result } = await importRows(company('manager'), 'LEADS', [row]);
      expect(result.summary).toMatchObject({ created: 1 });
      const lead = await prisma.lead.findFirstOrThrow({
        where: { customerName: row.customerName },
      });
      expect(lead.salesEmployeeId).toBe(ids.importerB);
    });
  });

  describe('payment and stock (2.8, 2.10)', () => {
    it('a paid amount becomes one PENDING declaration — never verified, never a receipt or journal entry', async () => {
      const row = orderRow({
        unitPrice: '150',
        paidAmount: '150',
        paymentMethodLabel: paymentMethodName,
      });
      const { result } = await importRows(
        company('importerA'),
        'STORE_ORDERS',
        [row],
      );
      expect(result.summary).toMatchObject({ created: 1, rejected: 0 });
      const order = await prisma.storeOrder.findFirstOrThrow({
        where: { partner: { name: row.customerName } },
        include: { payments: true },
      });
      expect(order.declaredPaymentStatus).toBe('PAID');
      expect(order.payments).toHaveLength(1);
      expect(order.payments[0]).toMatchObject({
        status: 'PENDING',
        origin: 'SALES_DECLARATION',
      });
      expect(
        await prisma.paymentReceiptLink.count({
          where: { paymentId: order.payments[0].id },
        }),
      ).toBe(0);
      expect(
        await prisma.journalEntry.count({
          where: { sourceId: { in: [order.id, order.payments[0].id] } },
        }),
      ).toBe(0);
    });

    it('a paid amount above the order total and a missing price are row errors (preview = run)', async () => {
      const over = orderRow({
        paidAmount: '500',
        paymentMethodLabel: paymentMethodName,
      });
      const noPrice = orderRow({ unitPrice: '' });
      const { preview, result } = await importRows(
        company('importerA'),
        'STORE_ORDERS',
        [over, noPrice],
      );
      expect(preview.errors.map((error) => error.message).join(' ')).toMatch(
        /exceeds the order total[\s\S]*Unit Price or Line Amount/,
      );
      expect(result.summary).toMatchObject({ created: 0, rejected: 2 });
    });

    it('preview warns when a tracked product has no available stock', async () => {
      const { preview } = await prepare(company('importerA'), 'STORE_ORDERS', [
        orderRow({ productSku: physicalSku, quantity: '3' }),
      ]);
      expect(preview.errors).toEqual([]);
      expect(
        preview.warnings.map((warning) => warning.message).join(' '),
      ).toContain('awaiting stock');
    });
  });

  describe('retry safety and repeat customers (2.7, 2.9)', () => {
    it('re-importing the same file skips every row (0 created); a double run runs once', async () => {
      const rows = [orderRow(), orderRow()];
      const first = await importRows(
        company('importerA'),
        'STORE_ORDERS',
        rows,
      );
      expect(first.result.summary).toMatchObject({ created: 2 });

      const again = await importRows(
        company('importerA'),
        'STORE_ORDERS',
        rows,
      );
      expect(again.preview.summary).toMatchObject({
        skippedCount: 2,
        newCount: 0,
      });
      expect(again.result.summary).toMatchObject({ created: 0, skipped: 2 });
      expect(again.result.status).toBe('COMPLETED');
      expect(again.preview.skipped[0].reason).toContain(
        'Already imported as order',
      );

      const fresh = orderRow();
      const { jobId } = await prepare(company('importerA'), 'STORE_ORDERS', [
        fresh,
      ]);
      const runs = await Promise.allSettled([
        workspace.run(jobId, company('importerA')),
        workspace.run(jobId, company('importerA')),
      ]);
      const rejected = runs.filter(
        (run): run is PromiseRejectedResult => run.status === 'rejected',
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect(
        await prisma.storeOrder.count({
          where: { partner: { name: fresh.customerName } },
        }),
      ).toBe(1);
    });

    it('a phone match needs review (customer shown); confirming or "Repeat customer = yes" creates a repeat order for the same customer', async () => {
      const shared = phone();
      const firstRow = orderRow({ customerPhone: shared });
      await importRows(company('importerA'), 'STORE_ORDERS', [firstRow]);
      const firstOrder = await prisma.storeOrder.findFirstOrThrow({
        where: { partner: { name: firstRow.customerName } },
      });

      const reviewRow = orderRow({
        customerPhone: shared,
        customerName: firstRow.customerName,
        orderDate: '2026-10-02',
      });
      const review = await importRows(company('importerA'), 'STORE_ORDERS', [
        reviewRow,
      ]);
      expect(review.preview.needsReview[0].reason).toContain(
        firstRow.customerName,
      );
      expect(review.result.summary).toMatchObject({
        created: 0,
        needsReview: 1,
      });
      const [pending] = await workspace.rows(
        review.jobId,
        company('importerA'),
        'NEEDS_REVIEW',
      );
      await workspace.confirmRow(
        review.jobId,
        pending.id,
        company('importerA'),
      );
      const confirmedJob = await workspace.get(
        review.jobId,
        company('importerA'),
      );
      expect(confirmedJob.summary).toMatchObject({
        created: 1,
        needsReview: 0,
      });

      const repeatRow = orderRow({
        customerPhone: shared,
        customerName: firstRow.customerName,
        orderDate: '2026-10-03',
        repeatCustomer: 'نعم',
      });
      const repeat = await importRows(company('importerA'), 'STORE_ORDERS', [
        repeatRow,
      ]);
      expect(repeat.result.summary).toMatchObject({ created: 1 });

      const orders = await prisma.storeOrder.findMany({
        where: { partnerId: firstOrder.partnerId, deletedAt: null },
        orderBy: { orderDate: 'asc' },
      });
      expect(orders).toHaveLength(3);
      expect(orders.slice(1).map((order) => order.sourceChannel)).toEqual([
        'مكرر',
        'مكرر',
      ]);
    });
  });

  describe('continuous sync and one-time import never ingest a row twice (2.13)', () => {
    it('leads: a row synced first is skipped by the one-time import, and vice versa', async () => {
      const handler = moduleRef.get(LeadsImportHandler);
      const synced = leadRow({ externalOrderId: `W2-L-${tag}-1` });
      await handler.importRow(synced, ids.super, {
        context: { source: 'GOOGLE_SHEETS' },
      });
      const oneTime = await importRows(company('importerA'), 'LEADS', [synced]);
      expect(oneTime.result.summary).toMatchObject({ created: 0, skipped: 1 });
      expect(oneTime.preview.skipped[0].reason).toContain(
        'Already imported as lead',
      );

      const imported = leadRow();
      await importRows(company('importerA'), 'LEADS', [imported]);
      const replay = await handler.importRow(imported, ids.super, {
        context: { source: 'GOOGLE_SHEETS' },
      });
      expect(replay.skipped).toContain('Already imported as lead');
      expect(
        await prisma.lead.count({
          where: {
            customerName: { in: [synced.customerName, imported.customerName] },
          },
        }),
      ).toBe(2);
    });

    it('store orders: the sync stamps the same row key a one-time import computes', async () => {
      const handler = moduleRef.get(StoreOrdersImportHandler);
      const externalOrderId = `W2-SO-${tag}-1`;
      const row = orderRow({
        externalOrderId,
        paidAmount: '100',
        paymentMethodLabel: paymentMethodName,
        agentEmail: emails.importerA,
        productSku: `W2 ${serviceSku}`,
      });
      await handler.importRow({ ...row, unitPrice: '' }, ids.super, {
        context: { source: 'GOOGLE_SHEETS', allowRepeatCustomer: 'true' },
      });
      const oneTime = await importRows(company('importerA'), 'STORE_ORDERS', [
        { ...row, paidAmount: '', paymentMethodLabel: '' },
      ]);
      expect(oneTime.result.summary).toMatchObject({ created: 0, skipped: 1 });
      expect(oneTime.preview.skipped[0].reason).toContain(
        'Already imported as order',
      );
      expect(
        await prisma.storeOrder.count({
          where: { externalOrderId: externalOrderId.toLowerCase() },
        }),
      ).toBe(1);
    });
  });

  describe('agent imports (spec §7)', () => {
    const agentRow = (over: Record<string, string> = {}) =>
      orderRow({
        productSku: agentProductSku,
        currencyCode: agentCurrencyCode,
        unitPrice: '200',
        ...over,
      });

    it('an agent SALES user needs agent.orders.import; with it the order belongs to the token agent and an Agent column is ignored', async () => {
      await expectHttp(
        workspace.create('STORE_ORDERS', agentActor()),
        ForbiddenException,
      );
      await grant(agentSales.userId, ['agent.orders.import']);
      const row = agentRow({ Agent: agentBName });
      const { preview, result } = await importRows(
        agentActor(),
        'STORE_ORDERS',
        [row],
      );
      expect(
        preview.warnings.map((warning) => warning.message).join(' '),
      ).toContain('"Agent"');
      expect(result.summary).toMatchObject({ created: 1, rejected: 0 });
      const order = await prisma.storeOrder.findFirstOrThrow({
        where: { agentId: agentAId, partner: { name: row.customerName } },
      });
      expect(order.agentId).toBe(agentAId);
      expect(order.employeeId).toBe(agentSales.userId);
      expect(order.creationIdempotencyKey).toMatch(
        new RegExp(`^agent-order:${agentAId}:import:[0-9a-f]{64}$`),
      );

      const again = await importRows(agentActor(), 'STORE_ORDERS', [row]);
      expect(again.result.summary).toMatchObject({ created: 0, skipped: 1 });
    });

    it('company products are not in the agent catalogue, and agent rows cannot name another owner', async () => {
      const { preview } = await prepare(agentActor(), 'STORE_ORDERS', [
        agentRow({ productSku: serviceSku }),
        agentRow({ agentEmail: emails.importerA }),
      ]);
      expect(preview.errors.map((error) => error.rowNumber)).toEqual([2, 3]);
    });

    it('naming an agent colleague as owner needs agent.records.assign; with it the colleague owns the order', async () => {
      await grant(agentSales.userId, ['agent.orders.import']);
      const colleague = await moduleRef.get(AgentUsersService).create(
        agentAId,
        {
          email: `w2-agent-colleague-${lower}@test.local`,
          username: `w2-agent-colleague-${lower}`,
          fullName: `W2 Agent Colleague ${tag}`,
          agentRole: 'SALES',
        },
        ids.super,
      );
      const named = () =>
        agentRow({ agentEmail: `w2-agent-colleague-${lower}@test.local` });

      const refused = await prepare(agentActor(), 'STORE_ORDERS', [named()]);
      expect(refused.preview.errors.map((error) => error.rowNumber)).toEqual([
        2,
      ]);

      await grant(agentSales.userId, ['agent.records.assign']);
      const row = named();
      const { result } = await importRows(agentActor(), 'STORE_ORDERS', [row]);
      expect(result.summary).toMatchObject({ created: 1, rejected: 0 });
      const order = await prisma.storeOrder.findFirstOrThrow({
        where: { agentId: agentAId, partner: { name: row.customerName } },
      });
      expect(order.employeeId).toBe(colleague.id);
    });

    it('agent and company jobs never cross', async () => {
      const agentJob = await workspace.create('STORE_ORDERS', agentActor());
      const companyJob = await workspace.create(
        'STORE_ORDERS',
        company('importerA'),
      );
      await expectHttp(
        workspace.get(agentJob.id, company('admin')),
        NotFoundException,
      );
      await expectHttp(
        workspace.get(companyJob.id, agentActor()),
        NotFoundException,
      );
      expect(
        (await workspace.list(company('admin'))).map((job) => job.id),
      ).not.toContain(agentJob.id);
      expect((await workspace.list(agentActor())).map((job) => job.id)).toEqual(
        expect.not.arrayContaining([companyJob.id]),
      );
      // A lead import needs its own agent key.
      await expectHttp(
        workspace.create('LEADS', agentActor()),
        ForbiddenException,
      );
    });
  });

  describe('Google Sheets connections (D15-17)', () => {
    const url = (id: string) =>
      `https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`;

    it('the first importer owns a sheet; another user or agent is refused; a sync sheet is refused', async () => {
      const sheetId = `w2sheet${lower}`;
      sheetCsv = csv([leadRow()]);
      const jobA = await workspace.create('LEADS', company('importerA'));
      await workspace.uploadFromGoogleSheets(
        jobA.id,
        company('importerA'),
        url(sheetId),
      );
      const connection = await prisma.importSheetConnection.findUniqueOrThrow({
        where: { spreadsheetId: sheetId },
      });
      expect(connection).toMatchObject({
        ownerUserId: ids.importerA,
        agentId: null,
        revokedAt: null,
      });
      const listed = await workspace.sheetConnections(company('importerA'));
      expect(listed.serviceAccountEmail).toBe(SERVICE_ACCOUNT);
      expect(listed.connections.map((row) => row.spreadsheetId)).toContain(
        sheetId,
      );
      // Refresh re-reads the owner's sheet.
      await workspace.setMapping(jobA.id, company('importerA'), {
        columnMapping: {
          customerName: 'customerName',
          mobileNumber: 'mobileNumber',
          countryName: 'countryName',
        },
      });
      await workspace.refresh(jobA.id, company('importerA'));

      const jobB = await workspace.create('LEADS', company('importerB'));
      await expectHttp(
        workspace.uploadFromGoogleSheets(
          jobB.id,
          company('importerB'),
          url(sheetId),
        ),
        ConflictException,
        'SHEET_CONNECTED_BY_ANOTHER_USER',
      );
      await grant(agentSales.userId, ['agent.leads.import']);
      const agentJob = await workspace.create('LEADS', agentActor());
      await expectHttp(
        workspace.uploadFromGoogleSheets(
          agentJob.id,
          agentActor(),
          url(sheetId),
        ),
        ConflictException,
        'SHEET_CONNECTED_BY_ANOTHER_USER',
      );

      const syncSheetId = `w2sync${lower}`;
      await prisma.syncSourceConfig.create({
        data: {
          sourceType: 'LEADS',
          label: `W2 Sync ${tag}`,
          spreadsheetId: syncSheetId,
        },
      });
      await expectHttp(
        workspace.uploadFromGoogleSheets(
          jobB.id,
          company('importerB'),
          url(syncSheetId),
        ),
        BadRequestException,
        'SHEET_SYNCHRONISED',
      );
      expect(
        await prisma.importSheetConnection.count({
          where: { spreadsheetId: syncSheetId },
        }),
      ).toBe(0);
    });

    it('an agent lead import from its own sheet belongs to the agent and the importing agent user', async () => {
      const row = leadRow({ productSku: agentProductSku });
      sheetCsv = csv([row]);
      const job = await workspace.create('LEADS', agentActor());
      await workspace.uploadFromGoogleSheets(
        job.id,
        agentActor(),
        url(`w2agentsheet${lower}`),
      );
      await workspace.setMapping(job.id, agentActor(), {
        columnMapping: {
          customerName: 'customerName',
          mobileNumber: 'mobileNumber',
          countryName: 'countryName',
          productSku: 'productSku',
        },
      });
      const result = await workspace.run(job.id, agentActor());
      expect(result.summary).toMatchObject({ created: 1 });
      const lead = await prisma.lead.findFirstOrThrow({
        where: { customerName: row.customerName },
      });
      expect(lead).toMatchObject({
        agentId: agentAId,
        salesEmployeeId: agentSales.userId,
        source: 'GOOGLE_SHEETS',
      });
      const connection = await prisma.importSheetConnection.findUniqueOrThrow({
        where: { spreadsheetId: `w2agentsheet${lower}` },
      });
      expect(connection).toMatchObject({
        agentId: agentAId,
        ownerUserId: null,
      });
    });
  });
});
