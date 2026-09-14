import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server } from 'http';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { ProductType } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { PostingProvidersModule } from '../accounting/posting-providers/posting-providers.module';
import { StoreOrdersModule } from './store-orders.module';
import { StoreOrdersService } from './store-orders.service';
import { PartnersModule } from '../partners/partners.module';
import { AllExceptionsFilter } from '../common/errors/all-exceptions.filter';

/**
 * OMS Leads + Customers + Orders Finalization — Closure QA item 1.
 *
 * `customers.lookup_global` / `orders.lookup_global` are checked by the real
 * `PermissionsGuard` sitting in front of `PartnersController`/
 * `StoreOrdersController` (same class-level `@UseGuards(JwtAuthGuard,
 * PermissionsGuard)` every other guarded controller uses) — this spec
 * exercises that full HTTP pipeline with a real JWT and a real,
 * permission-less user, rather than mocking the guard, so a regression in
 * the actual wiring (route ordering, action-name typo in
 * `permission-catalog.ts`, a missing `@PermissionAction`) fails this test
 * the same way it would fail in production. The matched Customer/Order
 * fixtures exist for the whole run specifically so a leak — data returned
 * despite the 403 — has something real to leak.
 */
describe('Global Lookup — permission denial (HTTP)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaService;
  let jwt: JwtService;
  let storeOrders: StoreOrdersService;

  const suffix = randomUUID().slice(0, 8);
  const customerName = `عميل بدون صلاحية ${suffix}`;
  const saudiNational = `5${Math.floor(10000000 + Math.random() * 89999999)}`;
  const saudiE164Phone = `+966${saudiNational}`;

  let unauthorizedUserId: string;
  let unauthorizedToken: string;
  let categoryId: string;
  let unitId: string;
  let productId: string;
  let currencyId: string;
  let orderId: string;
  let partnerId: string;
  let internalOrderId: string;

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
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    httpServer = app.getHttpServer() as Server;

    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
    storeOrders = moduleRef.get(StoreOrdersService);

    // A real, freshly-created user with ZERO UserPermission rows and
    // isSuperAdmin=false — never a mock, so PermissionsResolverService
    // genuinely resolves "no grant" the same way it would for a real
    // under-provisioned account.
    const unauthorizedUser = await prisma.user.create({
      data: {
        email: `no-lookup-perm-${suffix}@example.test`,
        username: `no-lookup-perm-${suffix}`,
        fullName: `No Lookup Permission ${suffix}`,
        passwordHash: 'test-hash',
      },
    });
    unauthorizedUserId = unauthorizedUser.id;
    unauthorizedToken = jwt.sign({
      sub: unauthorizedUserId,
      email: unauthorizedUser.email,
    });

    const category = await prisma.productCategory.create({
      data: { name: `No Perm Lookup Category ${suffix}` },
    });
    categoryId = category.id;
    const unit = await prisma.unit.create({
      data: { name: `No Perm Lookup Unit ${suffix}` },
    });
    unitId = unit.id;

    const productName = `No Perm Lookup Product ${suffix}`;
    const product = await prisma.product.create({
      data: {
        name: productName,
        internalName: productName,
        displayName: productName,
        sku: `NO-PERM-LOOKUP-${suffix}`,
        categoryId,
        unitId,
        type: ProductType.SERVICE,
        isPurchasable: false,
        isSellable: true,
        isInventoryItem: false,
      },
    });
    productId = product.id;

    const currency = await prisma.currency.findFirstOrThrow();
    currencyId = currency.id;

    const order = await storeOrders.create({
      partner: { name: customerName, phone: saudiE164Phone },
      currencyId,
      items: [{ productId, quantity: 1, unitPrice: 40 }],
    });
    orderId = order.id;
    const created = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: orderId },
    });
    internalOrderId = created.internalOrderId;
    partnerId = created.partnerId;
  });

  afterAll(async () => {
    await prisma.globalLookupAudit.deleteMany({
      where: { userId: unauthorizedUserId },
    });
    await prisma.storeOrderActivity.deleteMany({
      where: { storeOrderId: orderId },
    });
    await prisma.storeOrderItem.deleteMany({
      where: { storeOrderId: orderId },
    });
    await prisma.storeOrder.deleteMany({ where: { id: orderId } });
    await prisma.partnerRoleAssignment.deleteMany({ where: { partnerId } });
    await prisma.customerProfile.deleteMany({ where: { partnerId } });
    await prisma.partner.deleteMany({ where: { id: partnerId } });
    await prisma.product.deleteMany({
      where: { sku: { startsWith: 'NO-PERM-LOOKUP-' } },
    });
    await prisma.unit.deleteMany({ where: { id: unitId } });
    await prisma.productCategory.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { id: unauthorizedUserId } });

    await app.close();
    await prisma.$disconnect();
    await moduleRef.close();
  });

  describe('customers.lookup_global', () => {
    it('returns 403 and no Customer data for a user without the permission', async () => {
      const res = await request(httpServer)
        .get('/partners/global-lookup')
        .query({ phone: saudiE164Phone })
        .set('Authorization', `Bearer ${unauthorizedToken}`);

      expect(res.status).toBe(403);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain(customerName);
      expect(body).not.toContain(partnerId);
      expect(res.body).not.toHaveProperty('totalOrders');
      expect(res.body).not.toHaveProperty('recentOrders');
      expect(res.body).not.toHaveProperty('lastOrder');
    });

    it('cannot be bypassed by adding extra/spoofed query parameters', async () => {
      const res = await request(httpServer)
        .get('/partners/global-lookup')
        .query({
          phone: saudiE164Phone,
          isSuperAdmin: 'true',
          bypass: 'true',
          role: 'ADMIN',
        })
        .set('Authorization', `Bearer ${unauthorizedToken}`);

      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(customerName);
    });

    it('does not write a GlobalLookupAudit row for a denied attempt (guard runs before the handler)', async () => {
      const audits = await prisma.globalLookupAudit.findMany({
        where: { userId: unauthorizedUserId, action: 'GLOBAL_CUSTOMER_LOOKUP' },
      });
      expect(audits).toHaveLength(0);
    });
  });

  describe('orders.lookup_global', () => {
    it('returns 403 and no Order data for a user without the permission', async () => {
      const res = await request(httpServer)
        .get('/store-orders/global-lookup')
        .query({ orderNumber: internalOrderId })
        .set('Authorization', `Bearer ${unauthorizedToken}`);

      expect(res.status).toBe(403);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain(internalOrderId);
      expect(body).not.toContain(customerName);
      expect(res.body).not.toHaveProperty('orderNumber');
      expect(res.body).not.toHaveProperty('customerName');
      expect(res.body).not.toHaveProperty('paymentStatus');
    });

    it('cannot be bypassed by adding extra/spoofed query parameters', async () => {
      const res = await request(httpServer)
        .get('/store-orders/global-lookup')
        .query({
          orderNumber: internalOrderId,
          ownerId: unauthorizedUserId,
          isSuperAdmin: 'true',
        })
        .set('Authorization', `Bearer ${unauthorizedToken}`);

      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(internalOrderId);
    });

    it('does not write a GlobalLookupAudit row for a denied attempt (guard runs before the handler)', async () => {
      const audits = await prisma.globalLookupAudit.findMany({
        where: { userId: unauthorizedUserId, action: 'GLOBAL_ORDER_LOOKUP' },
      });
      expect(audits).toHaveLength(0);
    });
  });

  it('rejects an unauthenticated request (no bearer token) before any permission check', async () => {
    const [phoneRes, orderRes] = await Promise.all([
      request(httpServer)
        .get('/partners/global-lookup')
        .query({ phone: saudiE164Phone }),
      request(httpServer)
        .get('/store-orders/global-lookup')
        .query({ orderNumber: internalOrderId }),
    ]);
    expect(phoneRes.status).toBe(401);
    expect(orderRes.status).toBe(401);
  });
});
