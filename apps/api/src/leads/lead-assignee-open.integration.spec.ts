import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { Server } from 'http';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { LeadAssignmentMethod, LeadSource } from '@prisma/client';
import { UserSessionsService } from '../auth/sessions/user-sessions.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { LeadsModule } from './leads.module';
import { LeadAssignmentsService } from './assignments/lead-assignments.service';
import { LeadAssigneeOpensService } from './opens/lead-assignee-opens.service';
import { AgentLeadsService } from '../agents/orders/agent-leads.service';
import { LeadsService } from './leads.service';
import { AllExceptionsFilter } from '../common/errors/all-exceptions.filter';

interface OpenBody {
  recorded: boolean;
  openedByAssigneeAt: string | null;
}

interface ListRow {
  id: string;
  openedByAssigneeAt: string | null;
  status: { code: string };
}

/**
 * R20 — «لم يُفتح» follows the ASSIGNED employee, for every viewer.
 *  - only the current assignee's detail open records it (`POST /leads/:id/open`);
 *  - a manager / Super Admin open, a list load or a detail GET never does;
 *  - opening never changes the business status (or `updatedAt`);
 *  - repeat opens keep the first timestamp and move `lastOpenedAt` / count;
 *  - reassignment: the new owner starts unopened, the previous owner's
 *    history row stays and their later open no longer counts;
 *  - agent leads: only the agent's own assigned user, through the portal.
 * Real HTTP pipeline (auth, permissions, sales scope) on a local Postgres.
 */
describe('Lead opened by the assigned employee (R20)', () => {
  jest.setTimeout(120_000);

  let moduleRef: TestingModule;
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaService;
  let assignments: LeadAssignmentsService;
  let opens: LeadAssigneeOpensService;
  let agentLeadsAs: (team: boolean) => AgentLeadsService;
  const tag = `R20-OPEN-${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [];
  const leadIds: string[] = [];
  const agentIds: string[] = [];
  const partnerIds: string[] = [];
  let seq = 0;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let refs: { countryId: string; currencyId: string; newStatusId: string };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        LeadsModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    httpServer = app.getHttpServer() as Server;
    prisma = moduleRef.get(PrismaService);
    assignments = moduleRef.get(LeadAssignmentsService);
    opens = moduleRef.get(LeadAssigneeOpensService);
    const leads = moduleRef.get(LeadsService);
    // Agent visibility: `team` = agent.reports.view_team (sees every lead of the agent).
    agentLeadsAs = (team: boolean) =>
      new AgentLeadsService(
        prisma,
        { hasPermission: () => Promise.resolve(team) } as never,
        leads,
        assignments,
        opens,
      );
    const sessions = moduleRef.get(UserSessionsService, { strict: false });

    const [country, currency, newStatus] = await Promise.all([
      prisma.country.findFirstOrThrow({ where: { deletedAt: null } }),
      prisma.currency.findFirstOrThrow({ where: { deletedAt: null } }),
      prisma.statusDefinition.findFirstOrThrow({
        where: { workflowType: 'LEAD', code: 'NEW' },
      }),
    ]);
    refs = {
      countryId: country.id,
      currencyId: currency.id,
      newStatusId: newStatus.id,
    };
    const perm = (name: string) =>
      prisma.permission.upsert({
        where: { name },
        update: {},
        create: { name },
      });
    const viewPerm = await perm('crm.leads.view');
    const managePerm = await perm('crm.leads.manage');

    const persona = async (
      key: string,
      options: { manage?: boolean; superAdmin?: boolean } = {},
    ) => {
      const id = `${tag}-${key}`.toLowerCase();
      const user = await prisma.user.create({
        data: {
          email: `${id}@example.test`,
          username: id,
          fullName: `${tag} ${key}`,
          passwordHash: 'test-hash',
          isSuperAdmin: options.superAdmin ?? false,
        },
      });
      userIds.push(user.id);
      ids[key] = user.id;
      await prisma.userPermission.create({
        data: { userId: user.id, permissionId: viewPerm.id },
      });
      if (options.manage) {
        await prisma.userPermission.create({
          data: { userId: user.id, permissionId: managePerm.id },
        });
      }
      tokens[key] = await sessions.issueAccessToken({
        sub: user.id,
        email: user.email,
      });
    };
    await persona('ahmed');
    await persona('sara');
    await persona('manager', { manage: true });
    await persona('admin', { superAdmin: true });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.leadActivity.deleteMany({
        where: { leadId: { in: leadIds } },
      });
      await prisma.leadAssignment.deleteMany({
        where: { leadId: { in: leadIds } },
      });
      await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
      await prisma.userPermission.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.agent.deleteMany({ where: { id: { in: agentIds } } });
      await prisma.partner.deleteMany({ where: { id: { in: partnerIds } } });
    }
    if (app) await app.close();
  });

  async function makeLead(ownerId: string, agentId: string | null = null) {
    const lead = await prisma.lead.create({
      data: {
        leadNumber: `${tag}-L${++seq}`,
        customerName: `${tag} Customer ${seq}`,
        mobileNumber: `+96650${String(1_000_000 + seq).padStart(7, '0')}`,
        countryId: refs.countryId,
        currencyId: refs.currencyId,
        statusId: refs.newStatusId,
        quantity: 1,
        source: LeadSource.MANUAL,
        salesEmployeeId: ownerId,
        assignedAt: new Date(),
        agentId,
      },
      select: { id: true },
    });
    leadIds.push(lead.id);
    return lead.id;
  }

  const openAs = (key: string, leadId: string) =>
    request(httpServer)
      .post(`/leads/${leadId}/open`)
      .set('Authorization', `Bearer ${tokens[key]}`);

  async function listRow(key: string, leadId: string): Promise<ListRow> {
    const res = await request(httpServer)
      .get('/leads')
      .query({ search: tag, pageSize: 100, lifecycle: 'all' })
      .set('Authorization', `Bearer ${tokens[key]}`);
    expect(res.status).toBe(200);
    const row = (res.body as { items: ListRow[] }).items.find(
      (item) => item.id === leadId,
    );
    if (!row) throw new Error(`lead ${leadId} not in ${key}'s list`);
    return row;
  }

  const state = (leadId: string) =>
    prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: {
        openedByAssigneeAt: true,
        firstOpenedAt: true,
        updatedAt: true,
        status: { select: { code: true } },
      },
    });

  const history = (leadId: string) =>
    prisma.leadAssigneeOpen.findMany({
      where: { leadId },
      orderBy: { firstOpenedAt: 'asc' },
    });

  it('lists, detail GETs and manager / admin opens never mark it opened', async () => {
    const leadId = await makeLead(ids.ahmed);
    for (const key of ['ahmed', 'manager', 'admin']) {
      expect((await listRow(key, leadId)).openedByAssigneeAt).toBeNull();
    }
    const detail = await request(httpServer)
      .get(`/leads/${leadId}`)
      .set('Authorization', `Bearer ${tokens.ahmed}`);
    expect(detail.status).toBe(200);

    for (const key of ['manager', 'admin']) {
      const res = await openAs(key, leadId);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        recorded: false,
        openedByAssigneeAt: null,
      });
    }
    expect((await state(leadId)).openedByAssigneeAt).toBeNull();
    expect(await history(leadId)).toHaveLength(0);
    for (const key of ['ahmed', 'manager', 'admin']) {
      expect((await listRow(key, leadId)).openedByAssigneeAt).toBeNull();
    }
  });

  it('the assignee open clears it for employee, manager and admin; status unchanged', async () => {
    const leadId = await makeLead(ids.ahmed);
    const before = await state(leadId);

    const res = await openAs('ahmed', leadId);
    expect(res.status).toBe(200);
    expect((res.body as OpenBody).recorded).toBe(true);
    expect((res.body as OpenBody).openedByAssigneeAt).toEqual(
      expect.any(String),
    );

    const after = await state(leadId);
    expect(after.status.code).toBe('NEW');
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.openedByAssigneeAt).not.toBeNull();
    expect(after.firstOpenedAt).toEqual(after.openedByAssigneeAt);
    expect(
      await prisma.statusHistory.count({ where: { entityId: leadId } }),
    ).toBe(0);
    for (const key of ['ahmed', 'manager', 'admin']) {
      const row = await listRow(key, leadId);
      expect(row.openedByAssigneeAt).not.toBeNull();
      expect(row.status.code).toBe('NEW');
    }
    const activity = await prisma.leadActivity.count({
      where: { leadId, type: 'OPENED_BY_ASSIGNEE' },
    });
    expect(activity).toBe(1);
  });

  it('repeat opens are idempotent: first timestamp kept, last + count move', async () => {
    const leadId = await makeLead(ids.ahmed);
    await openAs('ahmed', leadId).expect(200);
    const first = await state(leadId);
    const [row1] = await history(leadId);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await openAs('ahmed', leadId).expect(200);
    await openAs('ahmed', leadId).expect(200);

    const again = await state(leadId);
    expect(again.openedByAssigneeAt).toEqual(first.openedByAssigneeAt);
    const rows = await history(leadId);
    expect(rows).toHaveLength(1);
    expect(rows[0].firstOpenedAt).toEqual(row1.firstOpenedAt);
    expect(rows[0].lastOpenedAt.getTime()).toBeGreaterThan(
      row1.lastOpenedAt.getTime(),
    );
    expect(rows[0].openCount).toBe(3);
    expect(
      await prisma.leadActivity.count({
        where: { leadId, type: 'OPENED_BY_ASSIGNEE' },
      }),
    ).toBe(1);
  });

  it('reassignment: new owner unopened, previous history kept, previous owner no longer counts', async () => {
    const leadId = await makeLead(ids.ahmed);
    await openAs('ahmed', leadId).expect(200);
    expect((await state(leadId)).openedByAssigneeAt).not.toBeNull();

    // Re-assigning the same owner is not a new assignee: the flag stays.
    await assignments.assign(leadId, {
      salesEmployeeId: ids.ahmed,
      method: LeadAssignmentMethod.MANUAL,
      skipEligibilityCheck: true,
    });
    expect((await state(leadId)).openedByAssigneeAt).not.toBeNull();

    await assignments.assign(leadId, {
      salesEmployeeId: ids.sara,
      method: LeadAssignmentMethod.MANUAL,
      skipEligibilityCheck: true,
    });
    expect((await state(leadId)).openedByAssigneeAt).toBeNull();
    for (const key of ['sara', 'manager', 'admin']) {
      expect((await listRow(key, leadId)).openedByAssigneeAt).toBeNull();
    }
    // The previous owner is outside the lead now (own scope → 404) and, even
    // through the service, an open by a non-assignee records nothing.
    await openAs('ahmed', leadId).expect(404);
    expect((await opens.record(leadId, ids.ahmed, null)).recorded).toBe(false);
    expect((await state(leadId)).openedByAssigneeAt).toBeNull();
    const kept = await history(leadId);
    expect(kept.map((row) => row.userId)).toEqual([ids.ahmed]);
    expect(kept[0].openCount).toBe(1);

    await openAs('sara', leadId).expect(200);
    expect((await state(leadId)).openedByAssigneeAt).not.toBeNull();
    expect((await history(leadId)).map((row) => row.userId).sort()).toEqual(
      [ids.ahmed, ids.sara].sort(),
    );
    expect((await state(leadId)).status.code).toBe('NEW');
  });

  it('agent leads: only the agent’s own assigned user, through the portal', async () => {
    const makeAgent = async (label: string) => {
      const partner = await prisma.partner.create({
        data: { partnerNumber: `${tag}-P${++seq}`, name: `${tag} ${label}` },
      });
      partnerIds.push(partner.id);
      const agent = await prisma.agent.create({
        data: {
          agentNumber: `${tag}-A${++seq}`,
          partnerId: partner.id,
          name: `${tag} ${label}`,
          currencyId: refs.currencyId,
        },
      });
      agentIds.push(agent.id);
      return agent.id;
    };
    const agentUser = async (agentId: string, role: 'ADMIN' | 'SALES') => {
      const id = `${tag}-agent-${++seq}`.toLowerCase();
      const user = await prisma.user.create({
        data: {
          email: `${id}@example.test`,
          username: id,
          fullName: `${tag} agent user ${seq}`,
          passwordHash: 'test-hash',
          userType: 'AGENT',
          agentId,
          agentRole: role,
        },
      });
      userIds.push(user.id);
      return {
        userId: user.id,
        agentId,
        agentRole: role,
      };
    };
    const agentA = await makeAgent('Agent A');
    const agentB = await makeAgent('Agent B');
    const sellerA = await agentUser(agentA, 'SALES');
    const adminA = await agentUser(agentA, 'ADMIN');
    const sellerB = await agentUser(agentB, 'SALES');
    const leadId = await makeLead(sellerA.userId, agentA);

    // Company staff never mark an agent's lead (admin sees it, records nothing).
    const companyOpen = await openAs('admin', leadId);
    expect(companyOpen.status).toBe(200);
    expect((companyOpen.body as OpenBody).recorded).toBe(false);
    // The agent's assignee id through the COMPANY boundary does not count either.
    expect((await opens.record(leadId, sellerA.userId, null)).recorded).toBe(
      false,
    );
    // Another agent: not found. The agent's admin (team visibility): no record.
    await expect(
      agentLeadsAs(true).recordOpen(sellerB, leadId),
    ).rejects.toThrow();
    expect((await agentLeadsAs(true).recordOpen(adminA, leadId)).recorded).toBe(
      false,
    );
    expect((await state(leadId)).openedByAssigneeAt).toBeNull();

    const own = await agentLeadsAs(false).recordOpen(sellerA, leadId);
    expect(own.recorded).toBe(true);
    const portalRow = await agentLeadsAs(true).get(adminA, leadId);
    expect(portalRow.openedByAssigneeAt).not.toBeNull();
    expect((await state(leadId)).status.code).toBe('NEW');
    expect((await listRow('admin', leadId)).openedByAssigneeAt).not.toBeNull();
  });
});
