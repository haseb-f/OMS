import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { UserSessionsService } from '../../auth/sessions/user-sessions.service';
import type { Server } from 'http';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ProductType } from '@prisma/client';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsCoreModule } from '../../permissions/permissions-core.module';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { PhoneModule } from '../../common/phone/phone.module';
import { AuthModule } from '../../auth/auth.module';
import { PostingProvidersModule } from '../../accounting/posting-providers/posting-providers.module';
import { PartnersModule } from '../../partners/partners.module';
import { StoreOrdersModule } from '../store-orders.module';
import { StoreOrdersService } from '../store-orders.service';
import { SalesOrdersModule } from '../../sales-orders/sales-orders.module';
import { ImportCenterModule } from '../../import-center/import-center.module';
import { ObjectStorageModule } from '../../common/storage/object-storage.module';
import {
  ASSIGN_CARRIER_REQUIRED_MESSAGE,
  ShippingUpdatesImportHandler,
} from '../../import-center/handlers/shipping-updates-import.handler';
import { AllExceptionsFilter } from '../../common/errors/all-exceptions.filter';
import { formatValidationErrors } from '../../common/errors/format-validation-errors';
import { BulkUpdateShipmentsDto } from './dto/bulk-update-shipments.dto';
import { BulkSetShippingStatusDto } from './dto/bulk-set-shipping-status.dto';

/**
 * R14 W2 (spec-2 §B) — crafted requests against every path that can assign
 * or change a shipment's shipping company / tracking number. A sales user
 * (store-orders.edit, no shipping rights) and a shipping user WITHOUT
 * `shipping.assign_carrier` get 403 (import / sync rows: a per-row rejection)
 * and the shipment stays unchanged; a user holding `shipping.assign_carrier`
 * succeeds. Bulk endpoints cannot carry carrier / tracking at all.
 */
describe('R14 shipping carrier / tracking authorization', () => {
  jest.setTimeout(180_000);

  let moduleRef: TestingModule;
  let app: INestApplication;
  let http: Server;
  let prisma: PrismaService;
  let sessions: UserSessionsService;
  let resolver: PermissionsResolverService;
  let importHandler: ShippingUpdatesImportHandler;

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const auth = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  let orderId: string;
  let internalOrderId: string;
  let partnerId: string;
  let companyId: string;
  let companyName: string;
  let otherCompanyId: string;
  let categoryId: string;
  let unitId: string;
  let productId: string;

  async function makeUser(key: string, names: string[]) {
    const user = await prisma.user.create({
      data: {
        email: `r14w2s-${key}-${suffix}@example.test`,
        username: `r14w2s-${key}-${suffix}`,
        fullName: `R14 W2 Ship ${key} ${suffix}`,
        passwordHash: 'x',
      },
    });
    userIds.push(user.id);
    ids[key] = user.id;
    tokens[key] = await sessions.issueAccessToken({
      sub: user.id,
      email: user.email,
    });
    for (const name of names) {
      const permission = await prisma.permission.upsert({
        where: { name },
        update: {},
        create: { name },
      });
      await prisma.userPermission.create({
        data: { userId: user.id, permissionId: permission.id },
      });
    }
    resolver.invalidate(user.id);
  }

  const shipment = () =>
    prisma.shipment.findFirstOrThrow({
      where: { storeOrderId: orderId, deletedAt: null },
      orderBy: { attemptNumber: 'desc' },
      select: {
        id: true,
        shippingCompanyId: true,
        trackingNumber: true,
        status: true,
      },
    });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        PostingProvidersModule,
        PartnersModule,
        StoreOrdersModule,
        SalesOrdersModule,
        ImportCenterModule,
        ObjectStorageModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: (errors) =>
          new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: 'Validation failed.',
            fields: formatValidationErrors(errors),
          }),
      }),
    );
    await app.init();
    http = app.getHttpServer() as Server;
    prisma = moduleRef.get(PrismaService);
    sessions = moduleRef.get(UserSessionsService, { strict: false });
    resolver = moduleRef.get(PermissionsResolverService);
    importHandler = moduleRef.get(ShippingUpdatesImportHandler);

    await makeUser('sales', ['store-orders.view', 'store-orders.edit']);
    await makeUser('shipEditOnly', [
      'store-orders.view',
      'shipping.view',
      'shipping.edit',
    ]);
    await makeUser('shipper', [
      'store-orders.view',
      'shipping.view',
      'shipping.edit',
      'shipping.assign_carrier',
    ]);

    companyName = `R14 W2 Carrier ${suffix}`;
    companyId = (
      await prisma.shippingCompany.create({ data: { name: companyName } })
    ).id;
    otherCompanyId = (
      await prisma.shippingCompany.create({
        data: { name: `R14 W2 Carrier B ${suffix}` },
      })
    ).id;

    categoryId = (
      await prisma.productCategory.create({
        data: { name: `R14 W2 Category ${suffix}` },
      })
    ).id;
    unitId = (
      await prisma.unit.create({ data: { name: `R14 W2 Unit ${suffix}` } })
    ).id;
    const productName = `R14 W2 Product ${suffix}`;
    productId = (
      await prisma.product.create({
        data: {
          name: productName,
          internalName: productName,
          displayName: productName,
          sku: `R14-W2-${suffix}`,
          categoryId,
          unitId,
          type: ProductType.SERVICE,
          isPurchasable: false,
          isSellable: true,
          isInventoryItem: false,
        },
      })
    ).id;
    const currencyId = (
      await prisma.currency.findFirstOrThrow({ where: { deletedAt: null } })
    ).id;
    const created = await moduleRef.get(StoreOrdersService).create({
      partner: {
        name: `R14 W2 Customer ${suffix}`,
        phone: `+96655${String(3_000_000 + Math.floor(Math.random() * 900_000)).padStart(7, '0')}`,
      },
      currencyId,
      items: [{ productId, quantity: 1, unitPrice: 40 }],
    });
    orderId = created.id;
    const order = await prisma.storeOrder.update({
      where: { id: orderId },
      data: { employeeId: ids.sales },
      select: { internalOrderId: true, partnerId: true },
    });
    internalOrderId = order.internalOrderId!;
    partnerId = order.partnerId;
    // The order is in the Shipping queue (a shipment exists) so shipping staff
    // can open it; the sales user opens it as its owner.
    const existing = await prisma.shipment.findFirst({
      where: { storeOrderId: orderId },
    });
    if (!existing) {
      await prisma.shipment.create({
        data: { storeOrderId: orderId, attemptNumber: 1 },
      });
    }
  });

  afterAll(async () => {
    await prisma.shipment.deleteMany({ where: { storeOrderId: orderId } });
    await prisma.storeOrderActivity.deleteMany({
      where: { storeOrderId: orderId },
    });
    await prisma.storeOrderItem.deleteMany({
      where: { storeOrderId: orderId },
    });
    await prisma.storeOrder.deleteMany({ where: { id: orderId } });
    await prisma.partnerRoleAssignment.deleteMany({ where: { partnerId } });
    await prisma.customerProfile.deleteMany({ where: { partnerId } });
    await prisma.partnerPhoneKey.deleteMany({ where: { partnerId } });
    await prisma.partner.deleteMany({ where: { id: partnerId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.unit.deleteMany({ where: { id: unitId } });
    await prisma.productCategory.deleteMany({ where: { id: categoryId } });
    await prisma.shippingCompany.deleteMany({
      where: { id: { in: [companyId, otherCompanyId] } },
    });
    await prisma.userPermission.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
    await prisma.$disconnect();
    await moduleRef.close();
  });

  describe.each(['sales', 'shipEditOnly'])(
    '%s (no shipping.assign_carrier)',
    (who) => {
      it('store-order shipping-company → 403, shipment unchanged', async () => {
        const before = await shipment();
        const res = await request(http)
          .post(`/store-orders/${orderId}/shipments/shipping-company`)
          .set(auth(who))
          .send({ shippingCompanyId: companyId });
        expect(res.status).toBe(403);
        expect(await shipment()).toEqual(before);
      });

      it('store-order tracking-number → 403, shipment unchanged', async () => {
        const before = await shipment();
        const res = await request(http)
          .post(`/store-orders/${orderId}/shipments/tracking-number`)
          .set(auth(who))
          .send({ trackingNumber: `TRK-${who}-${suffix}` });
        expect(res.status).toBe(403);
        expect(await shipment()).toEqual(before);
      });

      it('legacy sales-orders shipping-company / tracking-number → 403', async () => {
        const legacyId = randomUUID();
        const company = await request(http)
          .post(`/sales-orders/${legacyId}/shipping-company`)
          .set(auth(who))
          .send({ shippingCompanyId: companyId });
        expect(company.status).toBe(403);
        const tracking = await request(http)
          .post(`/sales-orders/${legacyId}/tracking-number`)
          .set(auth(who))
          .send({ trackingNumber: `TRK-${suffix}` });
        expect(tracking.status).toBe(403);
      });

      it('shipping-updates import row setting carrier / tracking is rejected per row, nothing written', async () => {
        const before = await shipment();
        await expect(
          importHandler.importRow(
            {
              systemOrderId: internalOrderId,
              status: 'LABEL_CREATED',
              shippingCompanyName: companyName,
              trackingNumber: `TRK-IMP-${who}-${suffix}`,
            },
            ids[who],
          ),
        ).rejects.toThrow(ASSIGN_CARRIER_REQUIRED_MESSAGE);
        expect(await shipment()).toEqual(before);
      });
    },
  );

  it('a holder of shipping.assign_carrier assigns the carrier and tracking number', async () => {
    const company = await request(http)
      .post(`/store-orders/${orderId}/shipments/shipping-company`)
      .set(auth('shipper'))
      .send({ shippingCompanyId: companyId });
    expect(company.status).toBe(200);
    const tracking = await request(http)
      .post(`/store-orders/${orderId}/shipments/tracking-number`)
      .set(auth('shipper'))
      .send({ trackingNumber: `TRK-OK-${suffix}` });
    expect(tracking.status).toBe(200);
    expect(await shipment()).toMatchObject({
      shippingCompanyId: companyId,
      trackingNumber: `TRK-OK-${suffix}`,
    });
  });

  it('an import row repeating the current carrier / tracking needs no carrier right', async () => {
    const current = await shipment();
    const result = await importHandler.importRow(
      {
        systemOrderId: internalOrderId,
        status: 'LABEL_CREATED',
        shippingCompanyName: companyName,
        trackingNumber: current.trackingNumber!,
      },
      ids.shipEditOnly,
      { dryRun: true },
    );
    expect(result.id).toBeTruthy();
  });

  it('a holder of shipping.assign_carrier changes the carrier through an import row', async () => {
    const result = await importHandler.importRow(
      {
        systemOrderId: internalOrderId,
        status: 'LABEL_CREATED',
        trackingNumber: `TRK-IMP-OK-${suffix}`,
      },
      ids.shipper,
    );
    expect(result.id).toBeTruthy();
    expect((await shipment()).trackingNumber).toBe(`TRK-IMP-OK-${suffix}`);
  });

  it('bulk shipping endpoints cannot carry a carrier or tracking number', () => {
    for (const [dto, body] of [
      [
        BulkUpdateShipmentsDto,
        { shipmentIds: [randomUUID()], targetStatus: 'SHIPPED' },
      ],
      [
        BulkSetShippingStatusDto,
        { storeOrderIds: [randomUUID()], shippingStatusId: 'x' },
      ],
    ] as const) {
      const instance = plainToInstance(dto as ClassConstructor<object>, {
        ...body,
        shippingCompanyId: otherCompanyId,
        trackingNumber: 'INJECTED',
      });
      const errors = validateSync(instance, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors.map((e) => e.property).sort()).toEqual([
        'shippingCompanyId',
        'trackingNumber',
      ]);
    }
  });

  it('agent tokens never reach the carrier endpoints (boundary unchanged)', async () => {
    const agentUser = await prisma.user.findFirst({
      where: { userType: 'AGENT', deletedAt: null },
      select: { id: true, email: true },
    });
    if (!agentUser) return; // no agent user in this database
    const token = await sessions.issueAccessToken({
      sub: agentUser.id,
      email: agentUser.email,
    });
    const res = await request(http)
      .post(`/store-orders/${orderId}/shipments/shipping-company`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ shippingCompanyId: otherCompanyId });
    expect(res.status).toBe(403);
    expect((await shipment()).shippingCompanyId).toBe(companyId);
  });
});
