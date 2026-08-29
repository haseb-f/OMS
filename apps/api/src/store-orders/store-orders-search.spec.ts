import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { ProductType, StoreOrderShippingStage } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { PostingProvidersModule } from '../accounting/posting-providers/posting-providers.module';
import { StoreOrdersModule } from './store-orders.module';
import { StoreOrdersService } from './store-orders.service';

/**
 * Complete Store Orders Search — server-side `search` must find an order
 * by OMS order number, External Order ID, Arabic customer name, or
 * customer phone in any common representation, and must combine correctly
 * with the existing payment/shipping/source/date filters. Runs against the
 * real local Postgres (docker-compose `oms-postgres`), same pattern as
 * every other store-orders integration spec — the behavior under test
 * (Prisma `where` composition, phone-candidate matching) is exactly the
 * kind of thing a mocked Prisma client would let drift from reality.
 */
describe('Store Orders — Complete Search', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: StoreOrdersService;

  let categoryId: string;
  let unitId: string;
  let productId: string;
  let currencyId: string;

  const suffix = randomUUID().slice(0, 8);
  const externalOrderId = `SEARCH-TEST-EXT-${suffix}`;
  const arabicCustomerName = `عميل اختبار البحث ${suffix}`;
  // A fresh, randomized Saudi mobile per run — never a fixed literal, so a
  // prior run's leftover fixture (same phone) can never dedup-merge into
  // this run's customer via `CustomersService.findOrCreate`'s phone match
  // and silently keep the OLD name/rows attached.
  const saudiNational = `5${Math.floor(10000000 + Math.random() * 89999999)}`;
  const saudiE164Phone = `+966${saudiNational}`;

  let orderId: string;
  let internalOrderId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        PostingProvidersModule,
        StoreOrdersModule,
      ],
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(StoreOrdersService);

    const category = await prisma.productCategory.create({
      data: { name: `Search Test Category ${suffix}` },
    });
    categoryId = category.id;
    const unit = await prisma.unit.create({
      data: { name: `Search Test Unit ${suffix}` },
    });
    unitId = unit.id;

    const productSku = `SEARCH-TEST-${suffix}`;
    const productName = `Search Test Product ${suffix}`;
    const product = await prisma.product.create({
      data: {
        name: productName,
        internalName: productName,
        displayName: productName,
        sku: productSku,
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

    const order = await service.create({
      externalOrderId,
      partner: { name: arabicCustomerName, phone: saudiE164Phone },
      currencyId,
      items: [{ productId, quantity: 1, unitPrice: 50 }],
    });
    orderId = order.id;
    const created = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: orderId },
    });
    internalOrderId = created.internalOrderId;
  });

  afterAll(async () => {
    const order = await prisma.storeOrder.findUnique({
      where: { id: orderId },
    });
    await prisma.storeOrderActivity.deleteMany({
      where: { storeOrderId: orderId },
    });
    await prisma.storeOrderItem.deleteMany({
      where: { storeOrderId: orderId },
    });
    await prisma.storeOrder.deleteMany({ where: { id: orderId } });
    if (order) {
      await prisma.partnerRoleAssignment.deleteMany({
        where: { partnerId: order.partnerId },
      });
      await prisma.customerProfile.deleteMany({
        where: { partnerId: order.partnerId },
      });
      await prisma.partner.deleteMany({ where: { id: order.partnerId } });
    }
    await prisma.product.deleteMany({
      where: { sku: { startsWith: 'SEARCH-TEST-' } },
    });
    await prisma.unit.deleteMany({ where: { id: unitId } });
    await prisma.productCategory.deleteMany({ where: { id: categoryId } });

    await prisma.$disconnect();
    await moduleRef.close();
  });

  it('finds the order by its OMS internal order number', async () => {
    const result = await service.findAll({ search: internalOrderId });
    expect(result.items.map((i) => i.id)).toContain(orderId);
  });

  it('finds the order by a partial OMS order number', async () => {
    const result = await service.findAll({
      search: internalOrderId.slice(0, internalOrderId.length - 2),
    });
    expect(result.items.map((i) => i.id)).toContain(orderId);
  });

  it('finds the order by its External Order ID', async () => {
    const result = await service.findAll({ search: externalOrderId });
    expect(result.items.map((i) => i.id)).toContain(orderId);
  });

  it('finds the order by a partial External Order ID', async () => {
    const result = await service.findAll({
      search: externalOrderId.slice(0, 12),
    });
    expect(result.items.map((i) => i.id)).toContain(orderId);
  });

  it('finds the order by the full Arabic customer name', async () => {
    const result = await service.findAll({ search: arabicCustomerName });
    expect(result.items.map((i) => i.id)).toContain(orderId);
  });

  it('finds the order by a partial Arabic customer name', async () => {
    const result = await service.findAll({
      search: arabicCustomerName.split(' ')[1],
    });
    expect(result.items.map((i) => i.id)).toContain(orderId);
  });

  it('trims surrounding spaces before searching', async () => {
    const result = await service.findAll({ search: `  ${externalOrderId}  ` });
    expect(result.items.map((i) => i.id)).toContain(orderId);
  });

  it('finds the order by Saudi local format with trunk zero', async () => {
    const result = await service.findAll({ search: `0${saudiNational}` });
    expect(result.items.map((i) => i.id)).toContain(orderId);
  });

  it('finds the order by the bare Saudi national number', async () => {
    const result = await service.findAll({ search: saudiNational });
    expect(result.items.map((i) => i.id)).toContain(orderId);
  });

  it('finds the order by the Saudi calling code without "+"', async () => {
    const result = await service.findAll({ search: `966${saudiNational}` });
    expect(result.items.map((i) => i.id)).toContain(orderId);
  });

  it('finds the order by the full Saudi international "+" format', async () => {
    const result = await service.findAll({ search: saudiE164Phone });
    expect(result.items.map((i) => i.id)).toContain(orderId);
  });

  it('combines search with an unrelated payment/shipping/source filter correctly (excludes when the filter does not match)', async () => {
    const result = await service.findAll({
      search: externalOrderId,
      shippingStage: [StoreOrderShippingStage.READY_FOR_SHIPPING],
    });
    expect(result.items.map((i) => i.id)).not.toContain(orderId);
  });

  it('combines search with a matching source filter correctly (includes when the filter matches)', async () => {
    const created = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: orderId },
    });
    const result = await service.findAll({
      search: externalOrderId,
      source: [created.source],
    });
    expect(result.items.map((i) => i.id)).toContain(orderId);
  });

  it('returns an empty result set (never an error) for a search term matching nothing', async () => {
    const result = await service.findAll({ search: `no-such-order-${suffix}` });
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('findAllIds shares the exact same search/filter composition as findAll', async () => {
    const result = await service.findAllIds({ search: externalOrderId });
    expect(result.ids).toContain(orderId);
  });
});
