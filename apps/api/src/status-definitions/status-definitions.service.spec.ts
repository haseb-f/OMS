import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { WorkflowType } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { StatusDefinitionsModule } from './status-definitions.module';
import { StatusDefinitionsService } from './status-definitions.service';

describe('StatusDefinitionsService', () => {
  let moduleRef: TestingModule;
  let service: StatusDefinitionsService;
  let prisma: PrismaService;
  const createdIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        AuthModule,
        StatusDefinitionsModule,
      ],
    }).compile();
    await moduleRef.init();
    service = moduleRef.get(StatusDefinitionsService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    if (createdIds.length) {
      await prisma.workflowTransition.deleteMany({
        where: {
          OR: [
            { fromStatusId: { in: createdIds } },
            { toStatusId: { in: createdIds } },
          ],
        },
      });
      await prisma.statusDefinition.deleteMany({
        where: { id: { in: createdIds } },
      });
    }
    await prisma.$disconnect();
    await moduleRef.close();
  });

  it('refuses to archive the default status of a workflow', async () => {
    const def = await service.findByCode(WorkflowType.LEAD, 'NEW');
    await expect(service.archive(def!.id)).rejects.toThrow(BadRequestException);
  });

  it('refuses to archive a status required by core business logic even when unused', async () => {
    const qualified = await service.findByCode(WorkflowType.LEAD, 'QUALIFIED');
    await expect(service.archive(qualified!.id)).rejects.toThrow(
      BadRequestException,
    );
    const still = await prisma.statusDefinition.findUnique({
      where: { id: qualified!.id },
    });
    expect(still?.deletedAt).toBeNull();
  });

  it('retired the superseded ASSIGNED and CONTACTED LEAD statuses (zero usage, non-default)', async () => {
    const assigned = await prisma.statusDefinition.findFirst({
      where: { workflowType: WorkflowType.LEAD, code: 'ASSIGNED' },
    });
    const contacted = await prisma.statusDefinition.findFirst({
      where: { workflowType: WorkflowType.LEAD, code: 'CONTACTED' },
    });
    expect(assigned?.deletedAt).not.toBeNull();
    expect(contacted?.deletedAt).not.toBeNull();
  });

  it('deactivated every workflow transition touching a retired status', async () => {
    const contacted = await prisma.statusDefinition.findFirst({
      where: { workflowType: WorkflowType.LEAD, code: 'CONTACTED' },
    });
    const live = await prisma.workflowTransition.count({
      where: {
        OR: [{ fromStatusId: contacted!.id }, { toStatusId: contacted!.id }],
        isActive: true,
        deletedAt: null,
      },
    });
    expect(live).toBe(0);
  });

  it('archives and restores a genuinely unused custom status, cascading to its transitions', async () => {
    const created = await service.create({
      workflowType: WorkflowType.LEAD,
      code: `TEST_${randomUUID().slice(0, 8)}`,
      name: `اختبار ${randomUUID().slice(0, 6)}`,
      color: 'neutral',
    });
    createdIds.push(created.id);

    const newStatus = await service.findByCode(WorkflowType.LEAD, 'NEW');
    const transition = await prisma.workflowTransition.create({
      data: {
        workflowType: WorkflowType.LEAD,
        fromStatusId: newStatus!.id,
        toStatusId: created.id,
        labelAr: 'اختبار',
        isActive: true,
      },
    });

    const archived = await service.archive(created.id);
    expect(archived.deletedAt).not.toBeNull();

    const transitionAfterArchive = await prisma.workflowTransition.findUnique({
      where: { id: transition.id },
    });
    expect(transitionAfterArchive?.isActive).toBe(false);

    const restored = await service.restore(created.id);
    expect(restored.deletedAt).toBeNull();
  });

  it('refuses to archive a status a live Lead currently holds', async () => {
    const country = await prisma.country.findFirst({
      where: { deletedAt: null },
      select: { id: true },
    });
    const currency = await prisma.currency.findFirst({
      where: { deletedAt: null },
      select: { id: true },
    });
    if (!country || !currency) {
      throw new Error('Country/currency seed required for this test.');
    }

    const created = await service.create({
      workflowType: WorkflowType.LEAD,
      code: `TEST_${randomUUID().slice(0, 8)}`,
      name: `اختبار ${randomUUID().slice(0, 6)}`,
      color: 'neutral',
    });
    createdIds.push(created.id);

    const lead = await prisma.lead.create({
      data: {
        leadNumber: `LEAD-TEST-${randomUUID()}`,
        customerName: 'Status Archive Guard',
        mobileNumber: `05${randomUUID().replace(/\D/g, '').slice(0, 8)}`,
        countryId: country.id,
        currencyId: currency.id,
        quantity: 1,
        source: 'MANUAL',
        statusId: created.id,
      },
    });

    await expect(service.archive(created.id)).rejects.toThrow(
      BadRequestException,
    );

    await prisma.lead.delete({ where: { id: lead.id } });
  });
});
