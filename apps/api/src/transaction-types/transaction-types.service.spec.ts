import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { TransactionTypesModule } from './transaction-types.module';
import { TransactionTypesService } from './transaction-types.service';
import { SYSTEM_TRANSACTION_TYPES } from './transaction-type.catalog';

describe('TransactionTypesService', () => {
  let moduleRef: TestingModule;
  let service: TransactionTypesService;
  let prisma: PrismaService;
  const createdIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        AuthModule,
        TransactionTypesModule,
      ],
    }).compile();
    await moduleRef.init();
    service = moduleRef.get(TransactionTypesService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    if (createdIds.length) {
      await prisma.transactionType.deleteMany({
        where: { id: { in: createdIds } },
      });
    }
    await prisma.$disconnect();
    await moduleRef.close();
  });

  it('seeds every system type from the catalog as isSystem = true', async () => {
    const rows = await prisma.transactionType.findMany({
      where: { isSystem: true, deletedAt: null },
    });
    const byCode = new Map(rows.map((row) => [row.code, row]));
    for (const entry of SYSTEM_TRANSACTION_TYPES) {
      const row = byCode.get(entry.code);
      expect(row).toBeDefined();
      expect(row?.direction).toBe(entry.direction);
    }
  });

  it('lists only IN types for direction=IN and only OUT types for direction=OUT', async () => {
    const inResult = await service.findAll({ direction: 'IN' } as never, {
      direction: 'IN',
    });
    expect(inResult.items.length).toBeGreaterThan(0);
    expect(inResult.items.every((item) => item.direction === 'IN')).toBe(true);

    const outResult = await service.findAll({ direction: 'OUT' } as never, {
      direction: 'OUT',
    });
    expect(outResult.items.length).toBeGreaterThan(0);
    expect(outResult.items.every((item) => item.direction === 'OUT')).toBe(
      true,
    );
  });

  it('refuses to change a system type direction or matching target', async () => {
    const system = await prisma.transactionType.findFirstOrThrow({
      where: { isSystem: true, deletedAt: null },
    });
    await expect(
      service.update(system.id, {
        direction: system.direction === 'IN' ? 'OUT' : 'IN',
      } as never),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.update(system.id, { matchingTarget: 'ACCOUNT' } as never),
    ).rejects.toThrow(BadRequestException);

    const reloaded = await prisma.transactionType.findUniqueOrThrow({
      where: { id: system.id },
    });
    expect(reloaded.direction).toBe(system.direction);
    expect(reloaded.matchingTarget).toBe(system.matchingTarget);
  });

  it('allows renaming a system type in place — same id preserved', async () => {
    const system = await prisma.transactionType.findFirstOrThrow({
      where: { isSystem: true, deletedAt: null },
    });
    const originalName = system.nameAr;
    const renamed = await service.update(system.id, {
      nameAr: `${originalName} (test)`,
    });
    expect(renamed.id).toBe(system.id);
    expect(renamed.nameAr).toBe(`${originalName} (test)`);

    const restored = await service.update(system.id, {
      nameAr: originalName,
    });
    expect(restored.nameAr).toBe(originalName);
  });

  it('refuses to archive a system type', async () => {
    const system = await prisma.transactionType.findFirstOrThrow({
      where: { isSystem: true, deletedAt: null },
    });
    await expect(service.archive(system.id)).rejects.toThrow(
      BadRequestException,
    );
    const reloaded = await prisma.transactionType.findUniqueOrThrow({
      where: { id: system.id },
    });
    expect(reloaded.deletedAt).toBeNull();
  });

  it('creates a custom type with a system-generated code, edits, archives, and restores it', async () => {
    const nameAr = `نوع تجريبي ${randomUUID().slice(0, 8)}`;
    const created = await service.create({
      nameAr,
      direction: 'IN',
    } as never);
    createdIds.push(created.id);

    expect(created.isSystem).toBe(false);
    expect(created.code.startsWith('USR_')).toBe(true);
    expect(created.direction).toBe('IN');

    const updated = await service.update(created.id, {
      nameAr: `${nameAr} محدث`,
      direction: 'OUT',
    } as never);
    expect(updated.nameAr).toBe(`${nameAr} محدث`);
    expect(updated.direction).toBe('OUT');
    expect(updated.id).toBe(created.id);

    const archived = await service.archive(created.id);
    expect(archived.deletedAt).not.toBeNull();

    const restored = await service.restore(created.id);
    expect(restored.deletedAt).toBeNull();
  });

  it('rejects an empty Arabic name on create', async () => {
    await expect(
      service.create({ nameAr: '   ', direction: 'IN' } as never),
    ).rejects.toThrow(BadRequestException);
  });
});
