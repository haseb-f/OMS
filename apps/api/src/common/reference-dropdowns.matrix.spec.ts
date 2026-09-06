import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsModule } from '../products/products.module';
import { ProductsService } from '../products/products.service';
import { AuthModule } from '../auth/auth.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { ProductStatus } from '@prisma/client';

/**
 * Practical dropdown integrity matrix — queries the same canonical tables
 * active forms use for initial options (via Prisma / ProductsService).
 */
describe('Business reference dropdown matrix', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let products: ProductsService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        AuthModule,
        ProductsModule,
        PermissionsCoreModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    products = moduleRef.get(ProductsService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('Department catalog has selectable rows', async () => {
    const count = await prisma.department.count({
      where: { deletedAt: null, isActive: true },
    });
    expect(count).toBeGreaterThan(0);
  });

  it('Currency catalog has selectable rows', async () => {
    const count = await prisma.currency.count({ where: { deletedAt: null } });
    expect(count).toBeGreaterThan(0);
  });

  it('Country catalog has selectable rows', async () => {
    const count = await prisma.country.count({ where: { deletedAt: null } });
    expect(count).toBeGreaterThan(0);
  });

  it('Unit catalog has selectable rows', async () => {
    const count = await prisma.unit.count({ where: { deletedAt: null } });
    expect(count).toBeGreaterThan(0);
  });

  it('Warehouse catalog has selectable rows', async () => {
    const count = await prisma.warehouse.count({
      where: { deletedAt: null, isActive: true },
    });
    expect(count).toBeGreaterThan(0);
  });

  it('Payment Method catalog has selectable rows', async () => {
    const count = await prisma.paymentMethod.count({
      where: { deletedAt: null },
    });
    expect(count).toBeGreaterThan(0);
  });

  it('Product ACTIVE+isSellable initial page is non-empty', async () => {
    const result = await products.findAll({
      status: [ProductStatus.ACTIVE],
      isSellable: true,
      pageSize: 25,
      sortBy: 'displayName',
      sortOrder: 'asc',
    });
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('Leads and StoreOrders remain newest-first by createdAt', async () => {
    const leads = await prisma.lead.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { createdAt: true },
    });
    for (let i = 1; i < leads.length; i += 1) {
      expect(leads[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
        leads[i].createdAt.getTime(),
      );
    }

    const orders = await prisma.storeOrder.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { createdAt: true },
    });
    for (let i = 1; i < orders.length; i += 1) {
      expect(orders[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
        orders[i].createdAt.getTime(),
      );
    }
  });
});
