import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server } from 'http';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { LeadsModule } from './leads.module';
import { LeadsService } from './leads.service';
import { AllExceptionsFilter } from '../common/errors/all-exceptions.filter';
import { formatValidationErrors } from '../common/errors/format-validation-errors';
import type { SalesScope } from '../sales-scope/sales-scope.service';

interface LeadListResponseBody {
  total: number;
  items: Array<{ id: string }>;
}

function leadList(body: unknown): LeadListResponseBody {
  return body as LeadListResponseBody;
}

/**
 * OMS Final Hotfix — Issue 3 (Sales Agents seeing all Leads) closure QA.
 *
 * Root-cause investigation (see the milestone's final report) found the
 * backend scope enforcement in `LeadsService.buildLeadWhere()` /
 * `SalesScopeService.leadWhere()` already correct: `AUTHORIZED_SCOPE AND
 * SEARCH AND FILTERS`, never `OR`. These tests lock that behavior in via
 * the real HTTP pipeline (`JwtAuthGuard`/`PermissionsGuard`/
 * `LeadsController`) with two real, minimally-permissioned Sales Agent
 * users — the same shape as this repo's seeded Ahmed/Sara test personas —
 * so a future regression that re-introduces an OR-based scope leak, an
 * unfiltered endpoint, or a whitelisted-away authorization param fails
 * here the same way it would in the browser.
 */
describe('Lead ownership scope (Ahmed/Sara regression)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaService;
  let jwt: JwtService;
  let leadsService: LeadsService;

  const suffix = randomUUID().slice(0, 8);

  let ahmedId: string;
  let saraId: string;
  let ahmedToken: string;
  let saraToken: string;
  let countryId: string;
  let currencyId: string;
  let newStatusId: string;

  let ahmedLead1Id: string;
  let ahmedLead2Id: string;
  let saraLead1Id: string;

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
    // Mirrors main.ts's real bootstrap pipe exactly — without it, query
    // strings like `pageSize=100` never get coerced to numbers and
    // unrecognized params like `scope=all` never get stripped, so this
    // suite would pass/fail on behavior the real server doesn't have.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: (errors) =>
          new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: 'Validation failed.',
            fields: formatValidationErrors(errors),
          }),
      }),
    );
    await app.init();
    httpServer = app.getHttpServer() as Server;

    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
    leadsService = moduleRef.get(LeadsService);

    const country = await prisma.country.findFirstOrThrow({
      where: { deletedAt: null },
    });
    countryId = country.id;
    const currency = await prisma.currency.findFirstOrThrow({
      where: { deletedAt: null },
    });
    currencyId = currency.id;
    const newStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workflowType: 'LEAD', code: 'NEW' },
    });
    newStatusId = newStatus.id;

    // Real "own-scope only" Sales Agents — crm.leads.view/create only, no
    // crm.leads.manage and not a SalesTeam manager, the exact seeded
    // Ahmed/Sara persona shape from the previous milestone.
    const [viewPerm, createPerm] = await Promise.all([
      prisma.permission.upsert({
        where: { name: 'crm.leads.view' },
        update: {},
        create: { name: 'crm.leads.view' },
      }),
      prisma.permission.upsert({
        where: { name: 'crm.leads.create' },
        update: {},
        create: { name: 'crm.leads.create' },
      }),
    ]);

    const ahmed = await prisma.user.create({
      data: {
        email: `ahmed-scope-${suffix}@example.test`,
        username: `ahmed-scope-${suffix}`,
        fullName: `Ahmed Scope Test ${suffix}`,
        passwordHash: 'test-hash',
      },
    });
    ahmedId = ahmed.id;
    const sara = await prisma.user.create({
      data: {
        email: `sara-scope-${suffix}@example.test`,
        username: `sara-scope-${suffix}`,
        fullName: `Sara Scope Test ${suffix}`,
        passwordHash: 'test-hash',
      },
    });
    saraId = sara.id;

    for (const userId of [ahmedId, saraId]) {
      for (const permission of [viewPerm, createPerm]) {
        await prisma.userPermission.create({
          data: { userId, permissionId: permission.id },
        });
      }
    }

    ahmedToken = jwt.sign({ sub: ahmedId, email: ahmed.email });
    saraToken = jwt.sign({ sub: saraId, email: sara.email });

    const makeLead = (customerName: string, ownerId: string) =>
      prisma.lead.create({
        data: {
          leadNumber: `LD-TEST-${suffix}-${randomUUID().slice(0, 6)}`,
          customerName,
          mobileNumber: `+9665${Math.floor(10000000 + Math.random() * 89999999)}`,
          countryId,
          currencyId,
          quantity: 1,
          statusId: newStatusId,
          source: 'MANUAL',
          salesEmployeeId: ownerId,
        },
        select: { id: true },
      });

    const [ahmedLead1, ahmedLead2, saraLead1] = await Promise.all([
      makeLead(`Ahmed Lead One ${suffix}`, ahmedId),
      makeLead(`Ahmed Lead Two ${suffix}`, ahmedId),
      makeLead(`Sara Lead One ${suffix}`, saraId),
    ]);
    ahmedLead1Id = ahmedLead1.id;
    ahmedLead2Id = ahmedLead2.id;
    saraLead1Id = saraLead1.id;
  });

  afterAll(async () => {
    await prisma.lead.deleteMany({
      where: { id: { in: [ahmedLead1Id, ahmedLead2Id, saraLead1Id] } },
    });
    await prisma.userPermission.deleteMany({
      where: { userId: { in: [ahmedId, saraId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [ahmedId, saraId] } } });

    await app.close();
    await prisma.$disconnect();
    await moduleRef.close();
  });

  describe('A. Own-scope list', () => {
    it("Ahmed's list contains exactly his 2 leads, never Sara's", async () => {
      const res = await request(httpServer)
        .get('/leads')
        .query({ pageSize: 100 })
        .set('Authorization', `Bearer ${ahmedToken}`);

      expect(res.status).toBe(200);
      expect(leadList(res.body).total).toBe(2);
      const ids = leadList(res.body).items.map((l: { id: string }) => l.id);
      expect(ids.sort()).toEqual([ahmedLead1Id, ahmedLead2Id].sort());
      expect(ids).not.toContain(saraLead1Id);
    });

    it("Sara's list contains exactly her 1 lead, never Ahmed's", async () => {
      const res = await request(httpServer)
        .get('/leads')
        .query({ pageSize: 100 })
        .set('Authorization', `Bearer ${saraToken}`);

      expect(res.status).toBe(200);
      expect(leadList(res.body).total).toBe(1);
      expect(leadList(res.body).items.map((l: { id: string }) => l.id)).toEqual(
        [saraLead1Id],
      );
    });

    it('rows and total always agree — no "7 rows, 100 total" leak', async () => {
      const res = await request(httpServer)
        .get('/leads')
        .query({ pageSize: 1 })
        .set('Authorization', `Bearer ${ahmedToken}`);

      expect(res.status).toBe(200);
      expect(leadList(res.body).items).toHaveLength(1);
      expect(leadList(res.body).total).toBe(2);
    });
  });

  describe('B. Ordinary search stays scoped', () => {
    it("Ahmed searching Sara's exact customer name gets 0 results", async () => {
      const res = await request(httpServer)
        .get('/leads')
        .query({ search: `Sara Lead One ${suffix}` })
        .set('Authorization', `Bearer ${ahmedToken}`);

      expect(res.status).toBe(200);
      expect(leadList(res.body).total).toBe(0);
      expect(leadList(res.body).items).toHaveLength(0);
    });

    it("Ahmed searching Sara's lead number gets 0 results", async () => {
      const saraLead = await prisma.lead.findUniqueOrThrow({
        where: { id: saraLead1Id },
        select: { leadNumber: true },
      });
      const res = await request(httpServer)
        .get('/leads')
        .query({ search: saraLead.leadNumber })
        .set('Authorization', `Bearer ${ahmedToken}`);

      expect(res.status).toBe(200);
      expect(leadList(res.body).total).toBe(0);
    });
  });

  describe('C. Query tampering cannot expand scope', () => {
    it('salesEmployeeId=<Sara> from Ahmed returns 0, never Sara data', async () => {
      const res = await request(httpServer)
        .get('/leads')
        .query({ salesEmployeeId: saraId })
        .set('Authorization', `Bearer ${ahmedToken}`);

      expect(res.status).toBe(200);
      expect(leadList(res.body).total).toBe(0);
    });

    it('unassigned=true from Ahmed never returns Sara-owned leads', async () => {
      const res = await request(httpServer)
        .get('/leads')
        .query({ unassigned: true })
        .set('Authorization', `Bearer ${ahmedToken}`);

      expect(res.status).toBe(200);
      const ids = leadList(res.body).items.map((l: { id: string }) => l.id);
      expect(ids).not.toContain(saraLead1Id);
      expect(ids).not.toContain(ahmedLead1Id);
    });

    it('unrecognized scope=all / ownerId params are silently stripped, not honored', async () => {
      const res = await request(httpServer)
        .get('/leads')
        .query({
          pageSize: 100,
          scope: 'all',
          ownerId: saraId,
          employeeId: saraId,
        })
        .set('Authorization', `Bearer ${ahmedToken}`);

      expect(res.status).toBe(200);
      expect(leadList(res.body).total).toBe(2);
      const ids = leadList(res.body).items.map((l: { id: string }) => l.id);
      expect(ids).not.toContain(saraLead1Id);
    });
  });

  describe('Direct access denial', () => {
    it("Sara cannot open Ahmed's Lead by ID directly", async () => {
      const res = await request(httpServer)
        .get(`/leads/${ahmedLead1Id}`)
        .set('Authorization', `Bearer ${saraToken}`);

      expect(res.status).toBe(404);
    });

    it("Ahmed cannot open Sara's Lead by ID directly", async () => {
      const res = await request(httpServer)
        .get(`/leads/${saraLead1Id}`)
        .set('Authorization', `Bearer ${ahmedToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('D. Manager (TEAM scope)', () => {
    it('a manager scope over both agents sees both of their leads', async () => {
      const teamScope: SalesScope = {
        kind: 'TEAM',
        ownerIds: [ahmedId, saraId],
        userId: ahmedId,
        isSuperAdmin: false,
        canManageLeads: true,
        canViewLeads: true,
        canViewStoreOrders: true,
        canViewShipping: false,
        canEditShipping: false,
        canViewPaymentEvidence: true,
        canManagePaymentEvidence: false,
      };
      const result = await leadsService.findAll({ pageSize: 100 }, teamScope);
      const ids = result.items.map((l) => l.id);
      expect(ids).toEqual(
        expect.arrayContaining([ahmedLead1Id, ahmedLead2Id, saraLead1Id]),
      );
    });
  });

  describe('E. Admin (ALL scope)', () => {
    it('ALL scope sees every test lead regardless of owner', async () => {
      const allScope: SalesScope = {
        kind: 'ALL',
        ownerIds: null,
        userId: ahmedId,
        isSuperAdmin: true,
        canManageLeads: true,
        canViewLeads: true,
        canViewStoreOrders: true,
        canViewShipping: true,
        canEditShipping: true,
        canViewPaymentEvidence: true,
        canManagePaymentEvidence: true,
      };
      const result = await leadsService.findAll({ pageSize: 100 }, allScope);
      const ids = result.items.map((l) => l.id);
      expect(ids).toEqual(
        expect.arrayContaining([ahmedLead1Id, ahmedLead2Id, saraLead1Id]),
      );
    });
  });
});
