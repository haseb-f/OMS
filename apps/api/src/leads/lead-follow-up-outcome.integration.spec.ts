import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LeadSource, WorkflowType } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PhoneModule } from '../common/phone/phone.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { NumberingModule } from '../numbering/numbering.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { SalesScopeModule } from '../sales-scope/sales-scope.module';
import type { SalesScope } from '../sales-scope/sales-scope.service';
import { LeadsModule } from './leads.module';
import { LeadsService } from './leads.service';
import { LeadAssignmentsService } from './assignments/lead-assignments.service';
import { AgentLeadsService } from '../agents/orders/agent-leads.service';
import { CreateLeadFollowUpDto } from './dto/create-lead-follow-up.dto';
import { FindLeadsQueryDto } from './dto/find-leads-query.dto';
import { LEAD_FOLLOW_UP_OUTCOMES } from './follow-up-outcomes';

/**
 * R6 (spec C1) — the follow-up outcome is the lead's follow-up
 * classification. Real local Postgres; fixtures are tagged
 * DEMO-R6-20261001-* and removed afterwards.
 */
describe('Lead follow-up outcome (integration)', () => {
  jest.setTimeout(120_000);

  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let leads: LeadsService;
  let agentLeads: AgentLeadsService;
  let dbUnreachable = false;

  const tag = `DEMO-R6-20261001-FU-${randomUUID().slice(0, 6).toUpperCase()}`;
  const leadIds: string[] = [];
  const userIds: string[] = [];
  const agentIds: string[] = [];
  const partnerIds: string[] = [];
  let seq = 0;
  let refs: { countryId: string; currencyId: string; statusId: string };
  let actorId: string;

  const superScope = (): SalesScope => ({
    kind: 'ALL',
    ownerIds: null,
    userId: actorId,
    isSuperAdmin: true,
    canManageLeads: true,
    canViewLeads: true,
    canViewStoreOrders: true,
    canViewShipping: true,
    canEditShipping: true,
    canViewPaymentEvidence: true,
    canManagePaymentEvidence: true,
  });

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
    leads = moduleRef.get(LeadsService);
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbUnreachable = true;
      return;
    }
    // Agents have no permission here → visibility = their own leads only.
    agentLeads = new AgentLeadsService(
      prisma,
      { hasPermission: () => Promise.resolve(false) } as never,
      leads,
      moduleRef.get(LeadAssignmentsService),
    );
    const country = await prisma.country.findFirstOrThrow({
      where: { deletedAt: null },
      select: { id: true },
    });
    const currency = await prisma.currency.findFirstOrThrow({
      where: { deletedAt: null },
      select: { id: true },
    });
    const status = await prisma.statusDefinition.findFirstOrThrow({
      where: { workflowType: WorkflowType.LEAD, code: 'IN_PROGRESS' },
      select: { id: true },
    });
    refs = {
      countryId: country.id,
      currencyId: currency.id,
      statusId: status.id,
    };
    actorId = await makeUser('actor');
  });

  afterAll(async () => {
    if (prisma && !dbUnreachable) {
      await prisma.leadFollowUp.deleteMany({
        where: { leadId: { in: leadIds } },
      });
      await prisma.leadActivity.deleteMany({
        where: { leadId: { in: leadIds } },
      });
      await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
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
    agent?: { agentId: string },
  ): Promise<string> {
    const id = `${tag}-${label}-${++seq}`.toLowerCase();
    const user = await prisma.user.create({
      data: {
        email: `${id}@test.local`,
        username: id,
        fullName: `${tag} ${label}`,
        passwordHash: 'x',
        ...(agent
          ? { userType: 'AGENT', agentId: agent.agentId, agentRole: 'SALES' }
          : {}),
      },
    });
    userIds.push(user.id);
    return user.id;
  }

  async function makeAgent(label: string) {
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
  }

  async function makeLead(
    extra: { agentId?: string; salesEmployeeId?: string } = {},
  ) {
    const lead = await prisma.lead.create({
      data: {
        leadNumber: `${tag}-L${++seq}`,
        customerName: `${tag} Customer ${seq}`,
        mobileNumber: `+96650${String(1_000_000 + seq).padStart(7, '0')}`,
        countryId: refs.countryId,
        currencyId: refs.currencyId,
        statusId: refs.statusId,
        quantity: 1,
        source: LeadSource.MANUAL,
        salesEmployeeId: extra.salesEmployeeId ?? actorId,
        agentId: extra.agentId ?? null,
      },
    });
    leadIds.push(lead.id);
    return lead.id;
  }

  async function addFollowUp(leadId: string, dto: CreateLeadFollowUpDto) {
    return leads.addFollowUp(leadId, dto, actorId, superScope());
  }

  async function current(leadId: string) {
    return prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { followUpOutcome: true, followUpOutcomeAt: true },
    });
  }

  it('the DTO accepts only the closed outcome list', async () => {
    for (const outcome of LEAD_FOLLOW_UP_OUTCOMES) {
      const errors = await validate(
        plainToInstance(CreateLeadFollowUpDto, { outcome }),
      );
      expect(errors).toHaveLength(0);
    }
    const bad = await validate(
      plainToInstance(CreateLeadFollowUpDto, { outcome: 'called back' }),
    );
    expect(bad.map((e) => e.property)).toEqual(['outcome']);
  });

  it('the list filter accepts outcome codes and none only', async () => {
    const ok = await validate(
      plainToInstance(FindLeadsQueryDto, {
        followUpOutcomes: 'interested,none',
      }),
    );
    expect(ok).toHaveLength(0);
    const bad = await validate(
      plainToInstance(FindLeadsQueryDto, { followUpOutcomes: 'maybe' }),
    );
    expect(bad.map((e) => e.property)).toEqual(['followUpOutcomes']);
  });

  liveIt(
    'a follow-up with an outcome becomes the current classification; one without leaves it',
    async () => {
      const leadId = await makeLead();
      expect(await current(leadId)).toEqual({
        followUpOutcome: null,
        followUpOutcomeAt: null,
      });

      const first = await addFollowUp(leadId, { outcome: 'noAnswer' });
      expect(await current(leadId)).toEqual({
        followUpOutcome: 'noAnswer',
        followUpOutcomeAt: first.createdAt,
      });

      await addFollowUp(leadId, { note: 'no result recorded' });
      expect((await current(leadId)).followUpOutcome).toBe('noAnswer');

      const latest = await addFollowUp(leadId, { outcome: 'interested' });
      expect(await current(leadId)).toEqual({
        followUpOutcome: 'interested',
        followUpOutcomeAt: latest.createdAt,
      });
      // History is kept: every follow-up row stays.
      expect(await leads.listFollowUps(leadId)).toHaveLength(3);
    },
  );

  liveIt(
    'a follow-up that is not the latest never overwrites a newer outcome',
    async () => {
      const leadId = await makeLead();
      // A follow-up completed later than "now" is the latest one.
      const future = new Date(Date.now() + 60 * 60 * 1000);
      await prisma.leadFollowUp.create({
        data: {
          leadId,
          userId: actorId,
          outcome: 'callback',
          completedAt: future,
        },
      });
      await prisma.lead.update({
        where: { id: leadId },
        data: { followUpOutcome: 'callback', followUpOutcomeAt: future },
      });
      await addFollowUp(leadId, { outcome: 'wrongNumber' });
      expect(await current(leadId)).toEqual({
        followUpOutcome: 'callback',
        followUpOutcomeAt: future,
      });
    },
  );

  liveIt('an unknown outcome is refused by the service too', async () => {
    const leadId = await makeLead();
    await expect(
      addFollowUp(leadId, { outcome: 'maybe' as never }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await leads.listFollowUps(leadId)).toHaveLength(0);
  });

  liveIt(
    'the migration backfill takes the latest valid outcome by COALESCE(completedAt, createdAt)',
    async () => {
      const t = (minutes: number) =>
        new Date(Date.UTC(2026, 8, 1, 10, minutes));
      const followUp = (
        leadId: string,
        outcome: string,
        createdAt: Date,
        extra: { completedAt?: Date; deletedAt?: Date; followUpAt?: Date } = {},
      ) =>
        prisma.leadFollowUp.create({
          data: { leadId, userId: actorId, outcome, createdAt, ...extra },
        });

      // A: latest valid one wins; legacy free text, deleted rows and the
      // (future) next-contact date never decide.
      const a = await makeLead();
      await followUp(a, 'noAnswer', t(1));
      await followUp(a, 'interested', t(5), { followUpAt: t(59) });
      await followUp(a, 'no answer', t(9));
      await followUp(a, 'callback', t(12), { deletedAt: t(13) });
      // B: completedAt orders before createdAt.
      const b = await makeLead();
      await followUp(b, 'answered', t(20), { completedAt: t(40) });
      await followUp(b, 'notInterested', t(30));
      // C: only legacy text → stays NULL.
      const c = await makeLead();
      await followUp(c, 'qualified soon', t(1));

      await runBackfill([a, b, c]);

      expect(await current(a)).toEqual({
        followUpOutcome: 'interested',
        followUpOutcomeAt: t(5),
      });
      expect(await current(b)).toEqual({
        followUpOutcome: 'answered',
        followUpOutcomeAt: t(40),
      });
      expect(await current(c)).toEqual({
        followUpOutcome: null,
        followUpOutcomeAt: null,
      });
    },
  );

  /** Runs the migration's own backfill statement, limited to `ids`. */
  async function runBackfill(ids: string[]) {
    const sql = readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20261001143000_r6_lead_follow_up_outcome/migration.sql',
      ),
      'utf8',
    );
    const update = sql.slice(sql.indexOf('UPDATE "leads"'));
    const terminator = 'WHERE l."id" = latest."lead_id";';
    expect(update).toContain(terminator);
    const scoped = update.replace(
      terminator,
      `WHERE l."id" = latest."lead_id" AND l."id" IN (${ids
        .map((id) => `'${id}'::uuid`)
        .join(', ')});`,
    );
    await prisma.$executeRawUnsafe(scoped);
  }

  liveIt(
    'the list filters by follow-up classification (codes and none)',
    async () => {
      const interested = await makeLead();
      await addFollowUp(interested, { outcome: 'interested' });
      const noAnswer = await makeLead();
      await addFollowUp(noAnswer, { outcome: 'noAnswer' });
      const none = await makeLead();
      const ids = [interested, noAnswer, none];

      const list = async (
        followUpOutcomes: FindLeadsQueryDto['followUpOutcomes'],
      ) =>
        (
          await leads.findAll(
            { ids, followUpOutcomes, lifecycle: 'all', pageSize: 10 },
            superScope(),
          )
        ).items
          .map((row) => row.id)
          .sort();

      expect(await list(['interested'])).toEqual([interested]);
      expect(await list(['interested', 'noAnswer'])).toEqual(
        [interested, noAnswer].sort(),
      );
      expect(await list(['none'])).toEqual([none]);
      expect(await list(['noAnswer', 'none'])).toEqual([noAnswer, none].sort());
      const row = (
        await leads.findAll(
          { ids: [interested], lifecycle: 'all' },
          superScope(),
        )
      ).items[0];
      expect(row.followUpOutcome).toBe('interested');
    },
  );

  liveIt(
    'agents read the outcome of their own leads only (read-only, scoped)',
    async () => {
      const agentA = await makeAgent('Agent A');
      const agentB = await makeAgent('Agent B');
      const salesA = await makeUser('agent-a-sales', { agentId: agentA });
      const salesB = await makeUser('agent-b-sales', { agentId: agentB });
      const leadA = await makeLead({
        agentId: agentA,
        salesEmployeeId: salesA,
      });
      await addFollowUp(leadA, { outcome: 'callback' });

      const ctxA = {
        userId: salesA,
        agentId: agentA,
        agentRole: 'SALES' as const,
      };
      const ctxB = {
        userId: salesB,
        agentId: agentB,
        agentRole: 'SALES' as const,
      };

      const detail = await agentLeads.get(ctxA, leadA);
      expect(detail.followUpOutcome).toBe('callback');
      expect(detail.followUpOutcomeAt).toBeInstanceOf(Date);
      // Only the outcome fields are added — no follow-up history, no notes.
      expect(Object.keys(detail)).not.toContain('followUps');

      const listA = await agentLeads.list(ctxA, { search: tag });
      expect(listA.items.map((row) => row.id)).toEqual([leadA]);
      expect(listA.items[0].followUpOutcome).toBe('callback');

      await expect(agentLeads.get(ctxB, leadA)).rejects.toThrow(
        'Lead not found.',
      );
      const listB = await agentLeads.list(ctxB, { search: tag });
      expect(listB.items).toHaveLength(0);
    },
  );
});
