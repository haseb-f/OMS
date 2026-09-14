import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingModule } from '../numbering/numbering.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { PartnersModule } from '../partners/partners.module';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { InvestorTypesModule } from './investor-types.module';
import { InvestorTypesService } from './investor-types.service';
import { InvestorsModule } from '../investors/investors.module';
import { InvestorsService } from '../investors/investors.service';

/**
 * Investor Engine Milestone 4, Part A — Investor Type as configurable
 * Master Data. Covers the acceptance-gate items owned by these two
 * services: assignability gating (active/archived) and that an Investor's
 * historical Investor Type value survives the type later being deactivated
 * (mission Part A #4/#6/#69/#70). Runs against the real local Postgres,
 * same pattern as investment-opportunities.service.spec.ts.
 */
describe('InvestorTypesService + Investor Type assignment', () => {
  let moduleRef: TestingModule;
  let investorTypesService: InvestorTypesService;
  let investorsService: InvestorsService;
  let prisma: PrismaService;

  const prefix = `IT-TEST-${randomUUID().slice(0, 6)}`;
  let activeTypeId: string;
  let inactiveTypeId: string;
  const createdInvestorIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        NumberingModule,
        MasterDataModule,
        PhoneModule,
        PermissionsCoreModule,
        AuthModule,
        PartnersModule,
        InvestorTypesModule,
        InvestorsModule,
      ],
    }).compile();
    await moduleRef.init();

    investorTypesService = moduleRef.get(InvestorTypesService);
    investorsService = moduleRef.get(InvestorsService);
    prisma = moduleRef.get(PrismaService);

    const active = await investorTypesService.create({
      name: `${prefix}-active`,
    });
    activeTypeId = active.id;
    const inactive = await investorTypesService.create({
      name: `${prefix}-inactive`,
      isActive: false,
    });
    inactiveTypeId = inactive.id;
  });

  afterAll(async () => {
    await prisma.investorProfile.updateMany({
      where: { id: { in: createdInvestorIds } },
      data: { investorTypeId: null },
    });
    for (const id of createdInvestorIds) {
      const investor = await prisma.investorProfile.findUnique({
        where: { id },
      });
      if (investor) {
        await prisma.investorProfile.delete({ where: { id } });
        await prisma.partner
          .delete({ where: { id: investor.partnerId } })
          .catch(() => undefined);
      }
    }
    await prisma.investorType.deleteMany({
      where: { id: { in: [activeTypeId, inactiveTypeId] } },
    });
    await moduleRef.close();
  });

  it('assertAssignable accepts an active type', async () => {
    await expect(
      investorTypesService.assertAssignable(activeTypeId),
    ).resolves.toMatchObject({
      id: activeTypeId,
    });
  });

  it('assertAssignable rejects an inactive type', async () => {
    await expect(
      investorTypesService.assertAssignable(inactiveTypeId),
    ).rejects.toThrow(BadRequestException);
  });

  it('assertAssignable rejects an archived (soft-deleted) type', async () => {
    const archived = await investorTypesService.create({
      name: `${prefix}-archived`,
    });
    await investorTypesService.archive(archived.id);
    await expect(
      investorTypesService.assertAssignable(archived.id),
    ).rejects.toThrow(BadRequestException);
    await prisma.investorType.delete({ where: { id: archived.id } });
  });

  it('InvestorsService.create rejects assigning an inactive Investor Type', async () => {
    await expect(
      investorsService.create({
        name: `${prefix} Investor`,
        investorTypeId: inactiveTypeId,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('InvestorsService.create accepts an active Investor Type, and update preserves a since-deactivated one', async () => {
    const investor = await investorsService.create({
      name: `${prefix} Investor 2`,
      investorTypeId: activeTypeId,
    });
    createdInvestorIds.push(investor.id);
    expect(investor.investorTypeId).toBe(activeTypeId);

    // Deactivate the type after assignment.
    await investorTypesService.update(activeTypeId, { isActive: false });

    // Historical value must still be readable...
    const reloaded = await investorsService.findOne(investor.id);
    expect(reloaded.investorTypeId).toBe(activeTypeId);
    expect(reloaded.investorType?.isActive).toBe(false);

    // ...and an unrelated field edit that does NOT touch investorTypeId
    // must not be blocked by the type having since gone inactive.
    const resaved = await investorsService.update(investor.id, {
      notes: 'unrelated edit',
    });
    expect(resaved.investorTypeId).toBe(activeTypeId);

    // Re-activate for other tests / clarity.
    await investorTypesService.update(activeTypeId, { isActive: true });
  });
});
