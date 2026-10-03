import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EmployeeStatus } from '@prisma/client';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadEligibilityService } from './lead-eligibility.service';

/**
 * R7 — the eligibility matrix of the ONE shared "who may receive a Lead" rule
 * set (auto distribution, drains, manual eligible-assignees and
 * `assertEligibleEmployee` all use it), against the real local Postgres.
 */
describe('Lead eligibility matrix (integration)', () => {
  jest.setTimeout(120_000);

  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: LeadEligibilityService;

  const tag = `r7e-${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [];
  const profileIds: string[] = [];
  const partnerIds: string[] = [];
  const teamIds: string[] = [];
  const agentIds: string[] = [];
  const u: Record<string, string> = {};
  let departmentA: string;
  let departmentB: string;
  let currencyId: string;

  async function makeUser(
    key: string,
    options: {
      flag?: boolean;
      edit?: boolean;
      active?: boolean;
      locked?: boolean;
      deleted?: boolean;
      departmentId?: string;
      agentId?: string;
    } = {},
  ) {
    const user = await prisma.user.create({
      data: {
        email: `${tag}-${key}@test.local`,
        username: `${tag}-${key}`,
        fullName: `${tag} ${key}`,
        passwordHash: 'x',
        salesDistributionEligible: options.flag ?? false,
        isActive: options.active ?? true,
        isLocked: options.locked ?? false,
        deletedAt: options.deleted ? new Date() : null,
        departmentId: options.departmentId ?? departmentA,
        ...(options.agentId
          ? { userType: 'AGENT', agentId: options.agentId, agentRole: 'SALES' }
          : {}),
      },
    });
    userIds.push(user.id);
    u[key] = user.id;
    if (options.edit) {
      const permission = await prisma.permission.upsert({
        where: { name: 'crm.leads.edit' },
        update: {},
        create: { name: 'crm.leads.edit' },
      });
      await prisma.userPermission.create({
        data: { userId: user.id, permissionId: permission.id },
      });
    }
    return user.id;
  }

  async function makeEmployment(key: string, status: EmployeeStatus) {
    const partner = await prisma.partner.create({
      data: { name: `${tag} emp ${key}`, partnerNumber: `${tag}-P-${key}` },
    });
    partnerIds.push(partner.id);
    const profile = await prisma.employeeProfile.create({
      data: {
        partnerId: partner.id,
        userId: u[key],
        employeeCode: `${tag}-E-${key}`,
        employmentStatus: status,
      },
    });
    profileIds.push(profile.id);
  }

  const mine = (rows: { id: string }[]) =>
    rows.filter((row) => userIds.includes(row.id));

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [LeadEligibilityService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(LeadEligibilityService);

    const departments = await prisma.department.findMany({
      where: { deletedAt: null },
      take: 2,
    });
    departmentA = departments[0].id;
    departmentB = (departments[1] ?? departments[0]).id;
    currencyId = (await prisma.currency.findFirstOrThrow()).id;

    await makeUser('sales', { flag: true, edit: true });
    await makeUser('salesTwo', { flag: true, edit: true });
    // Finance / Shipping / HR staff who happen to hold the lead permission.
    await makeUser('financeEdit', { flag: false, edit: true });
    await makeUser('shippingEdit', { flag: false, edit: true });
    await makeUser('hrEdit', { flag: false, edit: true });
    // Flagged but cannot handle leads.
    await makeUser('flaggedNoPerm', { flag: true, edit: false });
    await makeUser('inactive', { flag: true, edit: true, active: false });
    await makeUser('locked', { flag: true, edit: true, locked: true });
    await makeUser('deleted', { flag: true, edit: true, deleted: true });
    await makeUser('terminated', { flag: true, edit: true });
    await makeUser('onLeave', { flag: true, edit: true });
    await makeUser('activeEmployee', { flag: true, edit: true });
    await makeUser('otherDept', {
      flag: true,
      edit: true,
      departmentId: departmentB,
    });
    await makeUser('outsideTeam', { flag: true, edit: true });

    await makeEmployment('terminated', EmployeeStatus.TERMINATED);
    await makeEmployment('onLeave', EmployeeStatus.INACTIVE);
    await makeEmployment('activeEmployee', EmployeeStatus.ACTIVE);

    // Agent user (even flagged + permitted) lives in a different pool.
    const agentPartner = await prisma.partner.create({
      data: { name: `${tag} agent`, partnerNumber: `${tag}-AGP` },
    });
    partnerIds.push(agentPartner.id);
    const agent = await prisma.agent.create({
      data: {
        agentNumber: `${tag}-AG`,
        partnerId: agentPartner.id,
        name: `${tag} Agent`,
        currencyId,
      },
    });
    agentIds.push(agent.id);
    await makeUser('agentUser', { flag: true, edit: true, agentId: agent.id });

    const team = await prisma.salesTeam.create({
      data: {
        code: `${tag}-T`,
        name: `${tag} team`,
        departmentId: departmentA,
        managerId: u.sales,
        members: { create: [{ userId: u.salesTwo }] },
      },
    });
    teamIds.push(team.id);
  });

  afterAll(async () => {
    await prisma.salesTeamMember.deleteMany({
      where: { salesTeamId: { in: teamIds } },
    });
    await prisma.salesTeam.deleteMany({ where: { id: { in: teamIds } } });
    await prisma.employeeProfile.deleteMany({
      where: { id: { in: profileIds } },
    });
    await prisma.userPermission.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.agent.deleteMany({ where: { id: { in: agentIds } } });
    await prisma.partner.deleteMany({ where: { id: { in: partnerIds } } });
    await prisma.$disconnect();
    await moduleRef.close();
  });

  it('only active, unlocked, internal, employed, permitted AND sales-designated users are eligible', async () => {
    const { eligible } = await service.evaluate();
    const got = mine(eligible).map((row) => row.id);
    expect(new Set(got)).toEqual(
      new Set([
        u.sales,
        u.salesTwo,
        u.activeEmployee,
        u.otherDept,
        u.outsideTeam,
      ]),
    );
  });

  it('excludes Finance / Shipping / HR staff holding crm.leads.edit unless flagged', async () => {
    const { excluded } = await service.evaluate();
    const byId = new Map(excluded.map((row) => [row.id, row]));
    for (const key of ['financeEdit', 'shippingEdit', 'hrEdit']) {
      expect(byId.get(u[key])?.reason).toBe('NOT_SALES_DESIGNATED');
    }
  });

  it('reports a reason code for every other excluded user', async () => {
    const { excluded } = await service.evaluate();
    const reason = (key: string) =>
      excluded.find((row) => row.id === u[key])?.reason;
    expect(reason('flaggedNoPerm')).toBe('NO_PERMISSION');
    expect(reason('inactive')).toBe('INACTIVE');
    expect(reason('locked')).toBe('LOCKED');
    expect(reason('deleted')).toBe('DELETED');
    expect(reason('terminated')).toBe('TERMINATED');
    expect(reason('onLeave')).toBe('ON_LEAVE');
    expect(reason('agentUser')).toBe('AGENT_USER');
  });

  it('applies the policy team: only members/manager of the selected team', async () => {
    const { eligible, excluded } = await service.evaluate({
      teamId: teamIds[0],
    });
    expect(new Set(mine(eligible).map((row) => row.id))).toEqual(
      new Set([u.sales, u.salesTwo]),
    );
    const outside = excluded.find((row) => row.id === u.outsideTeam);
    expect(outside?.reasons).toContain('WRONG_TEAM');
  });

  it('applies the policy department (previously ignored)', async () => {
    if (departmentA === departmentB) return;
    const { eligible, excluded } = await service.evaluate({
      departmentId: departmentB,
    });
    expect(new Set(mine(eligible).map((row) => row.id))).toEqual(
      new Set([u.otherDept]),
    );
    expect(excluded.find((row) => row.id === u.sales)?.reasons).toContain(
      'WRONG_DEPARTMENT',
    );
  });

  it('a missing or inactive team has no recipients (never "everyone")', async () => {
    const ids = await service.getEligibleIds({ teamId: randomUUID() });
    expect(mine(ids.map((id) => ({ id })))).toEqual([]);
  });

  it('keeps a deterministic order across calls (Round Robin fairness)', async () => {
    const first = (await service.evaluate()).eligible.map((row) => row.id);
    const second = (await service.evaluate()).eligible.map((row) => row.id);
    expect(second).toEqual(first);
  });

  describe('manual assignment uses the same rules (assertEligible)', () => {
    it('accepts an eligible employee', async () => {
      await expect(service.assertEligible(u.sales)).resolves.toMatchObject({
        id: u.sales,
      });
    });

    it('rejects a non-designated employee with a precise code', async () => {
      await expect(service.assertEligible(u.financeEdit)).rejects.toMatchObject(
        { response: { code: 'NOT_SALES_DESIGNATED' } },
      );
    });

    it.each([
      'flaggedNoPerm',
      'inactive',
      'locked',
      'terminated',
      'onLeave',
      'agentUser',
    ])('rejects %s', async (key) => {
      await expect(service.assertEligible(u[key])).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects an unknown user', async () => {
      await expect(service.assertEligible(randomUUID())).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
