import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { UserSessionsService } from '../auth/sessions/user-sessions.service';
import type { Server } from 'http';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { LeadsModule } from './leads.module';
import { AllExceptionsFilter } from '../common/errors/all-exceptions.filter';

interface ListBody {
  items: Array<{ id: string; viewedByMe: boolean }>;
}

/**
 * R7 - "viewed by this employee" is read state, not a business status:
 *  - recording it never changes status / firstOpenedAt / follow-up fields;
 *  - it is per user (one employee's view does not mark it for another);
 *  - it is idempotent (one row, first `viewedAt` kept);
 *  - it only accepts a lead the caller's sales scope can read.
 * Real HTTP pipeline + two own-scope agents (same persona shape as
 * lead-scope.regression.spec.ts).
 */
describe('Lead viewed marker (per-employee read state)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaService;
  const suffix = randomUUID().slice(0, 8);
  let ahmedId: string;
  let saraId: string;
  let ahmedToken: string;
  let saraToken: string;
  let ahmedLeadId: string;
  let saraLeadId: string;

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
    const sessionTokens = moduleRef.get(UserSessionsService, { strict: false });

    const country = await prisma.country.findFirstOrThrow({
      where: { deletedAt: null },
    });
    const currency = await prisma.currency.findFirstOrThrow({
      where: { deletedAt: null },
    });
    const newStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workflowType: 'LEAD', code: 'NEW' },
    });
    const viewPerm = await prisma.permission.upsert({
      where: { name: 'crm.leads.view' },
      update: {},
      create: { name: 'crm.leads.view' },
    });

    const makeUser = (name: string) =>
      prisma.user.create({
        data: {
          email: `${name}-viewed-${suffix}@example.test`,
          username: `${name}-viewed-${suffix}`,
          fullName: `${name} Viewed Test ${suffix}`,
          passwordHash: 'test-hash',
        },
      });
    const [ahmed, sara] = await Promise.all([
      makeUser('ahmed'),
      makeUser('sara'),
    ]);
    ahmedId = ahmed.id;
    saraId = sara.id;
    for (const userId of [ahmedId, saraId]) {
      await prisma.userPermission.create({
        data: { userId, permissionId: viewPerm.id },
      });
    }
    ahmedToken = await sessionTokens.issueAccessToken({
      sub: ahmedId,
      email: ahmed.email,
    });
    saraToken = await sessionTokens.issueAccessToken({
      sub: saraId,
      email: sara.email,
    });

    const makeLead = (name: string, ownerId: string) =>
      prisma.lead.create({
        data: {
          leadNumber: `LD-VIEWED-${suffix}-${randomUUID().slice(0, 6)}`,
          customerName: `${name} ${suffix}`,
          mobileNumber: `+9665${Math.floor(10000000 + Math.random() * 89999999)}`,
          countryId: country.id,
          currencyId: currency.id,
          quantity: 1,
          statusId: newStatus.id,
          source: 'MANUAL',
          salesEmployeeId: ownerId,
        },
        select: { id: true },
      });
    ahmedLeadId = (await makeLead('Ahmed Viewed Lead', ahmedId)).id;
    saraLeadId = (await makeLead('Sara Viewed Lead', saraId)).id;
  });

  afterAll(async () => {
    await prisma.leadView.deleteMany({
      where: { leadId: { in: [ahmedLeadId, saraLeadId] } },
    });
    await prisma.lead.deleteMany({
      where: { id: { in: [ahmedLeadId, saraLeadId] } },
    });
    await prisma.userPermission.deleteMany({
      where: { userId: { in: [ahmedId, saraId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [ahmedId, saraId] } } });
    await app.close();
    await prisma.$disconnect();
    await moduleRef.close();
  });

  const listAs = async (token: string): Promise<ListBody> => {
    const res = await request(httpServer)
      .get('/leads')
      .query({ pageSize: 100 })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as ListBody;
  };

  it('is false until the employee opens the lead, then true - for that employee only', async () => {
    expect((await listAs(ahmedToken)).items[0].viewedByMe).toBe(false);

    const res = await request(httpServer)
      .post(`/leads/${ahmedLeadId}/viewed`)
      .set('Authorization', `Bearer ${ahmedToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ leadId: ahmedLeadId, viewedByMe: true });

    expect((await listAs(ahmedToken)).items[0].viewedByMe).toBe(true);
    // Sara has her own lead only; her marker is independent of Ahmed's.
    expect((await listAs(saraToken)).items[0].viewedByMe).toBe(false);
  });

  it('never changes the business status, first-open or follow-up state', async () => {
    const before = await prisma.lead.findUniqueOrThrow({
      where: { id: ahmedLeadId },
    });
    await request(httpServer)
      .post(`/leads/${ahmedLeadId}/viewed`)
      .set('Authorization', `Bearer ${ahmedToken}`)
      .expect(200);
    const after = await prisma.lead.findUniqueOrThrow({
      where: { id: ahmedLeadId },
    });
    expect(after.statusId).toBe(before.statusId);
    expect(after.firstOpenedAt).toBeNull();
    expect(after.followUpOutcome).toBe(before.followUpOutcome);
    expect(after.nextFollowUpAt).toEqual(before.nextFollowUpAt);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it('is idempotent - one row per (lead, user), first viewedAt kept', async () => {
    const first = await prisma.leadView.findUniqueOrThrow({
      where: { leadId_userId: { leadId: ahmedLeadId, userId: ahmedId } },
    });
    await request(httpServer)
      .post(`/leads/${ahmedLeadId}/viewed`)
      .set('Authorization', `Bearer ${ahmedToken}`)
      .expect(200);
    const rows = await prisma.leadView.findMany({
      where: { leadId: ahmedLeadId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].viewedAt).toEqual(first.viewedAt);
  });

  it('refuses a lead outside the caller scope and records nothing', async () => {
    const res = await request(httpServer)
      .post(`/leads/${saraLeadId}/viewed`)
      .set('Authorization', `Bearer ${ahmedToken}`);
    expect(res.status).toBe(404);
    expect(
      await prisma.leadView.count({
        where: { leadId: saraLeadId, userId: ahmedId },
      }),
    ).toBe(0);
  });

  it('plain GET /leads/:id stays a pure read (writes no view)', async () => {
    await request(httpServer)
      .get(`/leads/${saraLeadId}`)
      .set('Authorization', `Bearer ${saraToken}`)
      .expect(200);
    expect(await prisma.leadView.count({ where: { leadId: saraLeadId } })).toBe(
      0,
    );
  });
});
