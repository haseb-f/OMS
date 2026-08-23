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

  // -------------------------------------------------------------------
  // Shipping Status Configuration + Final-Shipment Sync Rules.
  // -------------------------------------------------------------------

  it('backfills DELIVERED (تم التسليم) as the one documented FINAL example — every other seeded status stays UNDER_SYNC', async () => {
    const statuses = await prisma.shippingStatus.findMany({
      where: { isSystem: true, deletedAt: null },
    });
    const byCode = new Map(statuses.map((s) => [s.code, s]));
    expect(byCode.get('DELIVERED')?.syncBehavior).toBe('FINAL');
    for (const status of statuses) {
      if (status.code === 'DELIVERED') continue;
      expect(status.syncBehavior).toBe('UNDER_SYNC');
    }
  });

  it('backfill produces exactly one active default status', async () => {
    const defaults = await prisma.shippingStatus.findMany({
      where: { isDefault: true, deletedAt: null },
    });
    expect(defaults).toHaveLength(1);
    expect(defaults[0].code).toBe(DEFAULT_SHIPPING_STATUS_CODE);
  });

  it('rejects an invalid sync behavior value', async () => {
    await expect(
      service.create({
        name: `سلوك خاطئ ${randomUUID().slice(0, 6)}`,
        syncBehavior: 'NOT_A_VALUE',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates a status with FINAL sync behavior and allows editing it back to UNDER_SYNC', async () => {
    const name = `منتهية ${randomUUID().slice(0, 8)}`;
    const created = await service.create({ name, syncBehavior: 'FINAL' });
    createdIds.push(created.id);
    expect(created.syncBehavior).toBe('FINAL');

    const updated = await service.update(created.id, {
      syncBehavior: 'UNDER_SYNC',
    });
    expect(updated.syncBehavior).toBe('UNDER_SYNC');
  });

  it('rejects creating a second default status and names the existing default in Arabic', async () => {
    await expect(
      service.create({
        name: `افتراضي جديد ${randomUUID().slice(0, 6)}`,
        isDefault: true,
      }),
    ).rejects.toThrow(/الحالة الافتراضية الحالية/);
  });

  it('rejects editing a non-default status to default while another default exists', async () => {
    const name = `قيد التجهيز ${randomUUID().slice(0, 8)}`;
    const created = await service.create({ name, color: 'info' });
    createdIds.push(created.id);

    await expect(
      service.update(created.id, { isDefault: true }),
    ).rejects.toThrow(/الحالة الافتراضية الحالية/);
    const reloaded = await prisma.shippingStatus.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(reloaded.isDefault).toBe(false);
  });

  it('rejects unsetting the default status directly — must use the safe replacement flow', async () => {
    const def = await service.findDefault();
    await expect(service.update(def.id, { isDefault: false })).rejects.toThrow(
      BadRequestException,
    );
    const stillDefault = await prisma.shippingStatus.findUniqueOrThrow({
      where: { id: def.id },
    });
    expect(stillDefault.isDefault).toBe(true);
  });

  it('safely replaces the default status atomically via setDefault, then restores the original', async () => {
    const originalDefault = await service.findDefault();
    const name = `افتراضي مؤقت ${randomUUID().slice(0, 8)}`;
    const created = await service.create({ name, color: 'info' });
    createdIds.push(created.id);

    const promoted = await service.setDefault(created.id);
    expect(promoted.isDefault).toBe(true);

    const previousReloaded = await prisma.shippingStatus.findUniqueOrThrow({
      where: { id: originalDefault.id },
    });
    expect(previousReloaded.isDefault).toBe(false);
    const defaultsAfterPromote = await prisma.shippingStatus.findMany({
      where: { isDefault: true, deletedAt: null },
    });
    expect(defaultsAfterPromote).toHaveLength(1);
    expect(defaultsAfterPromote[0].id).toBe(created.id);

    // Restore — other suites rely on جاهز للشحن remaining the default.
    const restored = await service.setDefault(originalDefault.id);
    expect(restored.isDefault).toBe(true);
    const defaultsAfterRestore = await prisma.shippingStatus.findMany({
      where: { isDefault: true, deletedAt: null },
    });
    expect(defaultsAfterRestore).toHaveLength(1);
    expect(defaultsAfterRestore[0].id).toBe(originalDefault.id);
  });

  it('scopes name uniqueness to active statuses — an archived name can be reused', async () => {
    const name = `قابل لإعادة الاستخدام ${randomUUID().slice(0, 8)}`;
    const first = await service.create({ name });
    createdIds.push(first.id);
    await service.archive(first.id);

    const second = await service.create({ name });
    createdIds.push(second.id);
    expect(second.id).not.toBe(first.id);
    expect(second.name).toBe(name);
  });
});
