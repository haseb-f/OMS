import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { ShippingStatusesModule } from './shipping-statuses.module';
import { ShippingStatusesService } from './shipping-statuses.service';
import { DEFAULT_SHIPPING_STATUS_CODE } from '../shipping/shipping-status.catalog';

describe('ShippingStatusesService', () => {
  let moduleRef: TestingModule;
  let service: ShippingStatusesService;
  let prisma: PrismaService;
  const createdIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        AuthModule,
        ShippingStatusesModule,
      ],
    }).compile();
    await moduleRef.init();
    service = moduleRef.get(ShippingStatusesService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    if (createdIds.length) {
      await prisma.shippingStatus.deleteMany({
        where: { id: { in: createdIds } },
      });
    }
    await prisma.$disconnect();
    await moduleRef.close();
  });

  it('exposes the protected default جاهز للشحن', async () => {
    const def = await service.findDefault();
    expect(def.code).toBe(DEFAULT_SHIPPING_STATUS_CODE);
    expect(def.name).toBe('جاهز للشحن');
    expect(def.isDefault).toBe(true);
    expect(def.isSystem).toBe(true);
  });

  it('refuses to archive the default system status', async () => {
    const def = await service.findDefault();
    await expect(service.archive(def.id)).rejects.toThrow(BadRequestException);
    const still = await prisma.shippingStatus.findUnique({
      where: { id: def.id },
    });
    expect(still?.deletedAt).toBeNull();
  });

  it('creates, edits color, archives, and restores a user-managed status', async () => {
    const name = `قيد التجهيز ${randomUUID().slice(0, 8)}`;
    const created = await service.create({ name, color: 'info' });
    createdIds.push(created.id);
    expect(created.isSystem).toBe(false);
    expect(created.isDefault).toBe(false);
    expect(created.color).toBe('info');
    expect(created.code.startsWith('USR_')).toBe(true);

    const updated = await service.update(created.id, {
      name,
      color: 'warning',
    });
    expect(updated.color).toBe('warning');
    expect(updated.name).toBe(name);

    const archived = await service.archive(created.id);
    expect(archived.deletedAt).not.toBeNull();

    const restored = await service.restore(created.id);
    expect(restored.deletedAt).toBeNull();
  });

  it('rejects arbitrary CSS colors', async () => {
    await expect(
      service.create({
        name: `لون ${randomUUID().slice(0, 6)}`,
        color: '#ff00aa',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
