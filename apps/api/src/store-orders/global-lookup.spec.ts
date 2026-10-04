import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
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
import { PartnersService } from '../partners/partners.service';

/**
 * OMS Leads + Customers + Orders Finalization — Part G/H acceptance:
 * exact-phone Customer lookup and exact-order-number Order lookup must (1)
 * return a safe, limited DTO (never payments/receipts/owner identity), (2)
 * work regardless of who owns the matched Order (that is the entire point
 * of a "global" lookup, distinct from `SalesScopeService`'s own-scope
 * enforcement covered by `store-orders-search.spec.ts` and
 * `sales-scope.payment-evidence.spec.ts`), and (3) write a
 * `GlobalLookupAudit` row on every call, matched or not. Runs against the
 * real local Postgres, same convention as the other store-orders specs.
 */
// R7: full details only for a customer/order the caller can already open under
// their own scope; somebody else's record is shown in the minimal masked shape.
describe('Global Customer/Order Lookup', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let storeOrders: StoreOrdersService;
  let partners: PartnersService;

  const suffix = randomUUID().slice(0, 8);
  const customerName = `عميل بحث شامل ${suffix}`;
  const saudiNational = `5${Math.floor(10000000 + Math.random() * 89999999)}`;
  const saudiE164Phone = `+966${saudiNational}`;

  /** A stranger: holds no scope over the order. */
  let userId: string;
  /** The order’s owner: own scope (store-orders.view). */
  let ownerId: string;
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
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    storeOrders = moduleRef.get(StoreOrdersService);
    partners = moduleRef.get(PartnersService);

    const user = await prisma.user.create({
      data: {
        email: `global-lookup-${suffix}@example.test`,
        username: `global-lookup-${suffix}`,
        fullName: `Global Lookup Test User ${suffix}`,
        passwordHash: 'test-hash',
      },
    });
    userId = user.id;

    const owner = await prisma.user.create({
      data: {
        email: `global-lookup-owner-${suffix}@example.test`,
        username: `global-lookup-owner-${suffix}`,
        fullName: `Global Lookup Owner ${suffix}`,
        passwordHash: 'test-hash',
      },
    });
    ownerId = owner.id;
    const view = await prisma.permission.upsert({
      where: { name: 'store-orders.view' },
      update: {},
      create: { name: 'store-orders.view' },
    });
    await prisma.userPermission.create({
      data: { userId: ownerId, permissionId: view.id },
    });

    const category = await prisma.productCategory.create({
      data: { name: `Global Lookup Category ${suffix}` },
    });
    categoryId = category.id;
    const unit = await prisma.unit.create({
      data: { name: `Global Lookup Unit ${suffix}` },
    });
    unitId = unit.id;

    const productName = `Global Lookup Product ${suffix}`;
    const product = await prisma.product.create({
      data: {
        name: productName,
        internalName: productName,
        displayName: productName,
        sku: `GLOBAL-LOOKUP-${suffix}`,
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
      items: [{ productId, quantity: 2, unitPrice: 75 }],
    });
    orderId = order.id;
    const created = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: orderId },
    });
    internalOrderId = created.internalOrderId;
    partnerId = created.partnerId;
    await prisma.storeOrder.update({
      where: { id: orderId },
      data: { employeeId: ownerId },
    });
  });

  afterAll(async () => {
    await prisma.globalLookupAudit.deleteMany({
      where: { userId: { in: [userId, ownerId] } },
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
      where: { sku: { startsWith: 'GLOBAL-LOOKUP-' } },
    });
    await prisma.unit.deleteMany({ where: { id: unitId } });
    await prisma.productCategory.deleteMany({ where: { id: categoryId } });
    await prisma.userPermission.deleteMany({ where: { userId: ownerId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, ownerId] } } });

    await prisma.$disconnect();
    await moduleRef.close();
  });

  describe('Customer global lookup (exact phone)', () => {
    it('returns a safe summary with the previous order for the caller’s OWN customer', async () => {
      const result = await partners.globalLookupByPhone(
        saudiE164Phone,
        ownerId,
      );
      expect(result).not.toBeNull();
      if (result?.restricted !== false)
        throw new Error('expected full details');
      expect(result.name).toBe(customerName);
      expect(result.totalOrders).toBe(1);
      expect(result.lastOrder?.orderNumber).toBe(internalOrderId);
      expect(result.recentOrders).toHaveLength(1);
      // Safe DTO — never financial/payment evidence or another agent's identity.
      expect(result).not.toHaveProperty('payments');
      expect(result).not.toHaveProperty('receivableBalance');
    });

    it('resolves any equivalent representation of the same Saudi number', async () => {
      const result = await partners.globalLookupByPhone(
        `0${saudiNational}`,
        ownerId,
      );
      expect(result && !result.restricted && result.id).toBe(partnerId);
    });

    it('shows somebody else’s customer in the minimal masked shape only', async () => {
      const result = await partners.globalLookupByPhone(saudiE164Phone, userId);
      expect(result).not.toBeNull();
      expect(result?.restricted).toBe(true);
      for (const forbidden of [
        'id',
        'name',
        'phone',
        'mobile',
        'address',
        'city',
        'totalOrders',
        'lastOrder',
        'recentOrders',
      ]) {
        expect(result).not.toHaveProperty(forbidden);
      }
      expect(JSON.stringify(result)).not.toContain(customerName);
      expect(JSON.stringify(result)).not.toContain(saudiNational);
    });

    it('returns null (not an error) for a phone with no Customer', async () => {
      // A random number — a fixed one may belong to a legacy customer of the
      // shared dev DB (stored without "+", matched via the SA fallback).
      const result = await partners.globalLookupByPhone(
        `+9665${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        userId,
      );
      expect(result).toBeNull();
    });

    it('audits every lookup, matched or not', async () => {
      const audits = await prisma.globalLookupAudit.findMany({
        where: {
          userId: { in: [userId, ownerId] },
          action: 'GLOBAL_CUSTOMER_LOOKUP',
        },
      });
      expect(audits.length).toBeGreaterThanOrEqual(3);
      expect(audits.some((a) => a.matchedPartnerId === partnerId)).toBe(true);
      expect(audits.some((a) => a.matchedPartnerId === null)).toBe(true);
    });
  });

  describe('Order global lookup (exact order number)', () => {
    it('returns a safe read-only summary for the caller’s OWN order', async () => {
      const result = await storeOrders.globalLookupByOrderNumber(
        internalOrderId,
        ownerId,
      );
      expect(result).not.toBeNull();
      if (result?.restricted !== false)
        throw new Error('expected full details');
      expect(result.orderNumber).toBe(internalOrderId);
      expect(result.customerName).toBe(customerName);
      // Safe DTO — no owner identity, no payments/receipts.
      expect(result).not.toHaveProperty('employeeId');
      expect(result).not.toHaveProperty('payments');
      expect(result).not.toHaveProperty('receipts');
    });

    it('shows an order outside the caller’s scope in the minimal masked shape only', async () => {
      const result = await storeOrders.globalLookupByOrderNumber(
        internalOrderId,
        userId,
      );
      expect(result?.restricted).toBe(true);
      for (const forbidden of [
        'id',
        'customerName',
        'customerPhone',
        'products',
        'paymentStatus',
        'shippingStage',
        'orderDate',
      ]) {
        expect(result).not.toHaveProperty(forbidden);
      }
      expect(JSON.stringify(result)).not.toContain(customerName);
    });

    it('returns null (not an error) for an unknown order number', async () => {
      const result = await storeOrders.globalLookupByOrderNumber(
        `NO-SUCH-ORDER-${suffix}`,
        userId,
      );
      expect(result).toBeNull();
    });

    it('audits every lookup, matched or not', async () => {
      const audits = await prisma.globalLookupAudit.findMany({
        where: {
          userId: { in: [userId, ownerId] },
          action: 'GLOBAL_ORDER_LOOKUP',
        },
      });
      expect(audits.length).toBeGreaterThanOrEqual(2);
      expect(audits.some((a) => a.matchedStoreOrderId === orderId)).toBe(true);
      expect(audits.some((a) => a.matchedStoreOrderId === null)).toBe(true);
    });
  });
});
