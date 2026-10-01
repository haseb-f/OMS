import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { LeadDistributionMode, LeadSource, WorkflowType } from '@prisma/client';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PhoneModule } from '../../common/phone/phone.module';
import { PermissionsCoreModule } from '../../permissions/permissions-core.module';
import { AuthModule } from '../../auth/auth.module';
import { UsersModule } from '../../users/users.module';
import { NumberingModule } from '../../numbering/numbering.module';
import { WorkflowModule } from '../../workflow/workflow.module';
import { SalesScopeModule } from '../../sales-scope/sales-scope.module';
import { LeadsModule } from '../leads.module';
import { LeadAutoDistributionService } from './lead-auto-distribution.service';

/** Same key the service serializes drains on (lead-auto-distribution.service.ts). */
const DRAIN_LOCK_KEY = 7_341_026;

/**
 * R6 (spec C3) — distribution regressions on the real local Postgres:
 * agent leads never enter the internal pool, a re-run never reassigns owned
 * leads, and a concurrent drain answers `alreadyRunning`. Serial: it changes
 * the one global distribution policy (restored afterwards) and drains every
 * unowned lead, so ambient unowned rows are parked for each drain.
 */
describe('Lead distribution (integration, serial)', () => {
  jest.setTimeout(180_000);

  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let distribution: LeadAutoDistributionService;
  let dbUnreachable = false;

  const tag = `DEMO-R6-20261001-DS-${randomUUID().slice(0, 6).toUpperCase()}`;
  const leadIds: string[] = [];
  const userIds: string[] = [];
  const agentIds: string[] = [];
  const partnerIds: string[] = [];
  let previousPolicyId: string | null = null;
  let seq = 0;
  let refs: { countryId: string; currencyId: string; statusId: string };
  let actorId: string;
  let salesIds: string[] = [];
  let agentUserId: string;
  let agentId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PhoneModule,
        PermissionsCoreModule,
        AuthModule,
        SalesScopeModule,
        UsersModule,
        NumberingModule,
        WorkflowModule,
        LeadsModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    distribution = moduleRef.get(LeadAutoDistributionService);
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbUnreachable = true;
      return;
    }
    previousPolicyId = (await distribution.getLatestPolicy())?.id ?? null;
    const country = await prisma.country.findFirstOrThrow({
      where: { deletedAt: null },
      select: { id: true },
    });
    const currency = await prisma.currency.findFirstOrThrow({
      where: { deletedAt: null },
      select: { id: true },
    });
    const status = await prisma.statusDefinition.findFirstOrThrow({
      where: { workflowType: WorkflowType.LEAD, code: 'NEW' },
      select: { id: true },
    });
    refs = {
      countryId: country.id,
      currencyId: currency.id,
      statusId: status.id,
    };
    actorId = await makeUser('actor');
    salesIds = [
      await makeUser('sales-1', { leadsEdit: true }),
      await makeUser('sales-2', { leadsEdit: true }),
    ];
    const partner = await prisma.partner.create({
      data: { partnerNumber: `${tag}-P`, name: `${tag} Agent` },
    });
    partnerIds.push(partner.id);
    agentId = (
      await prisma.agent.create({
        data: {
          agentNumber: `${tag}-A`,
          partnerId: partner.id,
          name: `${tag} Agent`,
          currencyId: refs.currencyId,
        },
      })
    ).id;
    agentIds.push(agentId);
    // Even an agent user holding crm.leads.edit is never in the internal pool.
    agentUserId = await makeUser('agent-sales', {
      leadsEdit: true,
      agentId,
    });
  });

  afterAll(async () => {
    if (prisma && !dbUnreachable) {
      await prisma.leadDistributionPolicy.updateMany({
        where: { createdBy: actorId, isActive: true },
        data: { isActive: false },
      });
      if (previousPolicyId) {
        await prisma.leadDistributionPolicy.update({
          where: { id: previousPolicyId },
          data: { isActive: true },
        });
      }
      await prisma.leadAssignment.deleteMany({
        where: { leadId: { in: leadIds } },
      });
      await prisma.leadActivity.deleteMany({
        where: { leadId: { in: leadIds } },
      });
      await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
      await prisma.leadDistributionState.updateMany({
        where: { lastAssignedEmployeeId: { in: userIds } },
        data: { lastAssignedEmployeeId: null },
      });
      await prisma.userPermission.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.agent.deleteMany({ where: { id: { in: agentIds } } });
      await prisma.partner.deleteMany({ where: { id: { in: partnerIds } } });
    }
    if (moduleRef) await moduleRef.close();
  });

  function liveIt(name: string, fn: () => Promise<void>) {
    it(name, async () => {
      if (dbUnreachable) return;
      await fn();
    });
  }

  async function makeUser(
    label: string,
    options: { leadsEdit?: boolean; agentId?: string } = {},
  ) {
    const handle = `${tag}-${label}-${++seq}`.toLowerCase();
    const user = await prisma.user.create({
      data: {
        email: `${handle}@test.local`,
        username: handle,
        fullName: `${tag} ${label}`,
        passwordHash: 'x',
        ...(options.agentId
          ? { userType: 'AGENT', agentId: options.agentId, agentRole: 'SALES' }
          : {}),
      },
    });
    userIds.push(user.id);
    if (options.leadsEdit) {
      const permission = await prisma.permission.upsert({
        where: { name: 'crm.leads.edit' },
        create: { name: 'crm.leads.edit' },
        update: {},
      });
      await prisma.userPermission.create({
        data: { userId: user.id, permissionId: permission.id },
      });
    }
    return user.id;
  }

  async function makeUnownedLead(agent?: string) {
    const lead = await prisma.lead.create({
      data: {
        leadNumber: `${tag}-L${++seq}`,
        customerName: `${tag} Customer ${seq}`,
        mobileNumber: `+96651${String(1_000_000 + seq).padStart(7, '0')}`,
        countryId: refs.countryId,
        currencyId: refs.currencyId,
        statusId: refs.statusId,
        quantity: 1,
        source: LeadSource.MANUAL,
        salesEmployeeId: null,
        agentId: agent ?? null,
        distributionHeld: true,
      },
    });
    leadIds.push(lead.id);
    return lead.id;
  }

  /**
   * Parks every other unowned company lead (temporary soft delete) while
   * `fn` runs, so the drain only sees this spec's leads; restores them.
   */
  async function isolated<T>(fn: () => Promise<T>): Promise<T> {
    const ambient = await prisma.lead.findMany({
      where: {
        deletedAt: null,
        salesEmployeeId: null,
        id: { notIn: leadIds },
      },
      select: { id: true },
    });
    const parked = ambient.map((row) => row.id);
    if (parked.length) {
      await prisma.lead.updateMany({
        where: { id: { in: parked } },
        data: { deletedAt: new Date() },
      });
    }
    try {
      return await fn();
    } finally {
      if (parked.length) {
        await prisma.lead.updateMany({
          where: { id: { in: parked } },
          data: { deletedAt: null },
        });
      }
    }
  }

  const owners = async (ids: string[]) =>
    Object.fromEntries(
      (
        await prisma.lead.findMany({
          where: { id: { in: ids } },
          select: { id: true, salesEmployeeId: true },
        })
      ).map((row) => [row.id, row.salesEmployeeId]),
    );

  liveIt(
    'an automatic drain assigns company leads to internal staff and never touches agent leads',
    async () => {
      const company = [await makeUnownedLead(), await makeUnownedLead()];
      const agentLead = await makeUnownedLead(agentId);

      const pool = await distribution.getEligibleEmployeeIds();
      expect(pool).toEqual(expect.arrayContaining(salesIds));
      expect(pool).not.toContain(agentUserId);

      const { run } = await isolated(() =>
        distribution.applyMode({
          mode: LeadDistributionMode.CONTINUOUS,
          actorId,
        }),
      );
      expect(run).toMatchObject({ assigned: 2, failureReason: null });

      const after = await owners([...company, agentLead]);
      for (const id of company) {
        expect(after[id]).toBeTruthy();
        expect(pool).toContain(after[id]);
      }
      expect(after[agentLead]).toBeNull();
      // The agent lead is not even counted as pending internal work.
      const snapshot = await distribution.getPolicySnapshot();
      expect(snapshot.eligibleCount).toBe(snapshot.eligible.length);
      expect(snapshot.team).toBeNull();
    },
  );

  liveIt('re-running the drain never reassigns owned leads', async () => {
    const leadId = await makeUnownedLead();
    await isolated(() =>
      distribution.applyMode({
        mode: LeadDistributionMode.CONTINUOUS,
        actorId,
      }),
    );
    const before = await owners(leadIds);
    const assignmentsBefore = await prisma.leadAssignment.count({
      where: { leadId: { in: leadIds } },
    });
    expect(before[leadId]).toBeTruthy();

    const { run, reused } = await isolated(() =>
      distribution.applyMode({
        mode: LeadDistributionMode.CONTINUOUS,
        actorId,
      }),
    );
    expect(reused).toBe(true);
    expect(run).toMatchObject({ assigned: 0, skipped: 0 });
    expect(await owners(leadIds)).toEqual(before);
    expect(
      await prisma.leadAssignment.count({ where: { leadId: { in: leadIds } } }),
    ).toBe(assignmentsBefore);
  });

  liveIt(
    'a drain started while another holds the lock answers alreadyRunning',
    async () => {
      const leadId = await makeUnownedLead();
      await isolated(async () => {
        let release!: () => void;
        const released = new Promise<void>((resolve) => (release = resolve));
        let locked!: () => void;
        const lockTaken = new Promise<void>((resolve) => (locked = resolve));
        const holder = prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DRAIN_LOCK_KEY})`;
            locked();
            await released;
          },
          { timeout: 60_000 },
        );
        await lockTaken;
        try {
          const run = await distribution.distributePending({
            includeHeld: true,
          });
          expect(run).toEqual({
            assigned: 0,
            skipped: 0,
            failureCode: null,
            failureReason: null,
            alreadyRunning: true,
          });
        } finally {
          release();
          await holder;
        }
      });
      expect((await owners([leadId]))[leadId]).toBeNull();
    },
  );
});
