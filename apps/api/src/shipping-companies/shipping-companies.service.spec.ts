import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { ShippingCompaniesModule } from './shipping-companies.module';
import { ShippingCompaniesService } from './shipping-companies.service';

describe('ShippingCompaniesService', () => {
  let moduleRef: TestingModule;
  let service: ShippingCompaniesService;
  let prisma: PrismaService;
  const createdIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        AuthModule,
        ShippingCompaniesModule,
      ],
    }).compile();
    await moduleRef.init();
    service = moduleRef.get(ShippingCompaniesService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    if (createdIds.length) {
      await prisma.shippingCompany.deleteMany({
        where: { id: { in: createdIds } },
      });
    }
    await prisma.$disconnect();
    await moduleRef.close();
  });

  it('creates, edits, archives, and restores a shipping company', async () => {
    const name = `شركة شحن ${randomUUID().slice(0, 8)}`;
    const created = await service.create({ name, description: 'اختبار' });
    createdIds.push(created.id);
    expect(created.name).toBe(name);

    const updated = await service.update(created.id, {
      name,
      description: 'محدّث',
    });
    expect(updated.description).toBe('محدّث');

    const archived = await service.archive(created.id);
    expect(archived.deletedAt).not.toBeNull();

    const restored = await service.restore(created.id);
    expect(restored.deletedAt).toBeNull();
  });
});
