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
import { LeadSource, ProductType } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { PostingProvidersModule } from '../accounting/posting-providers/posting-providers.module';
import { StoreOrdersModule } from '../store-orders/store-orders.module';
import { StoreOrdersService } from '../store-orders/store-orders.service';
import { PartnersModule } from '../partners/partners.module';
import { LeadsModule } from '../leads/leads.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { AllExceptionsFilter } from '../common/errors/all-exceptions.filter';
import { formatValidationErrors } from '../common/errors/format-validation-errors';

/**
 * R7 (workstream B) — default employee scope, proven over the real HTTP
 * pipeline (JwtAuthGuard / PermissionsGuard / controllers / services) on the
 * local Postgres. A user must never read another user's lead or order through
 * the list, the bare-id ("select all") list, search, the unassigned counter,
 * the by-id / direct URL, the workflow status-history or can-fulfill. Explicit
 * supervisory grants (team manager, `crm.leads.manage`) still work; Shipping
 * and Finance visibility never widens the generic lists; agent records never
 * reach an internal own/team scope; agent tokens never reach internal routes.
 */
describe('R7 sales scope isolation (HTTP)', () => {
  jest.setTimeout(120_000);

  let moduleRef: TestingModule;
  let app: INestApplication;
  let http: Server;
  let prisma: PrismaService;
  let jwt: JwtService;
  let resolver: PermissionsResolverService;
  let storeOrders: StoreOrdersService;

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const leadIds: string[] = [];
  const orderIds: string[] = [];
  const partnerIds: string[] = [];
  const agentIds: string[] = [];
  const teamIds: string[] = [];
  let categoryId: string;
  let unitId: string;
  let productId: string;
  let currencyId: string;
  let countryId: string;
  let leadStatusId: string;

  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const lead: Record<string, string> = {};
  const order: Record<string, string> = {};
  const names: Record<string, string> = {};

  const auth = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

  async function grant(userId: string, permissionNames: string[]) {
    for (const name of permissionNames) {
      const permission = await prisma.permission.upsert({
        where: { name },
        update: {},
        create: { name },
      });
      await prisma.userPermission.upsert({
        where: {
          userId_permissionId: { userId, permissionId: permission.id },
        },
        update: {},
        create: { userId, permissionId: permission.id },
      });
    }
    resolver.invalidate(userId);
  }

  async function makeUser(key: string, permissionNames: string[]) {
    const user = await prisma.user.create({
      data: {
        email: `r7s-${key}-${suffix}@example.test`,
        username: `r7s-${key}-${suffix}`,
        fullName: `R7 Scope ${key} ${suffix}`,
        passwordHash: 'x',
      },
    });
    userIds.push(user.id);
    ids[key] = user.id;
    tokens[key] = jwt.sign({ sub: user.id, email: user.email });
    await grant(user.id, permissionNames);
    return user.id;
  }

  let seq = 0;
  async function makeLead(
    key: string,
    owner: string | null,
    agentId: string | null = null,
  ) {
    seq += 1;
    names[key] = `R7Lead${key}${suffix}`;
    const row = await prisma.lead.create({
      data: {
        leadNumber: `R7S-${suffix}-${key}`,
        customerName: names[key],
        mobileNumber: `+96653${String(1_000_000 + seq * 7 + Math.floor(Math.random() * 5000)).padStart(7, '0')}`,
        countryId,
        currencyId,
        statusId: leadStatusId,
        quantity: 1,
        source: LeadSource.MANUAL,
        salesEmployeeId: owner,
        agentId,
      },
    });
    leadIds.push(row.id);
    lead[key] = row.id;
  }

  async function makeOrder(
    key: string,
    owner: string | null,
    agentId: string | null = null,
  ) {
    seq += 1;
    names[`o${key}`] = `R7Cust${key}${suffix}`;
    const created = await storeOrders.create({
      partner: {
        name: names[`o${key}`],
        phone: `+96654${String(2_000_000 + seq * 11 + Math.floor(Math.random() * 5000)).padStart(7, '0')}`,
      },
      currencyId,
      items: [{ productId, quantity: 1, unitPrice: 40 }],
    });
    orderIds.push(created.id);
    order[key] = created.id;
    // Fixtures start outside the Shipping queue and owned by `owner`.
    await prisma.shipment.deleteMany({ where: { storeOrderId: created.id } });
    await prisma.storeOrder.update({
      where: { id: created.id },
      data: { employeeId: owner, agentId },
    });
    const partner = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: created.id },
      select: { partnerId: true },
    });
    partnerIds.push(partner.partnerId);
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        PostingProvidersModule,
        PartnersModule,
        StoreOrdersModule,
        LeadsModule,
        WorkflowModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
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
    http = app.getHttpServer() as Server;
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
    resolver = moduleRef.get(PermissionsResolverService);
    storeOrders = moduleRef.get(StoreOrdersService);

    countryId = (
      await prisma.country.findFirstOrThrow({ where: { deletedAt: null } })
    ).id;
    currencyId = (
      await prisma.currency.findFirstOrThrow({ where: { deletedAt: null } })
    ).id;
    leadStatusId = (
      await prisma.statusDefinition.findFirstOrThrow({
        where: { workflowType: 'LEAD', code: 'NEW' },
      })
    ).id;
    categoryId = (
      await prisma.productCategory.create({
        data: { name: `R7 Scope Category ${suffix}` },
      })
    ).id;
    unitId = (
      await prisma.unit.create({ data: { name: `R7 Scope Unit ${suffix}` } })
    ).id;
    const productName = `R7 Scope Product ${suffix}`;
    productId = (
      await prisma.product.create({
        data: {
          name: productName,
          internalName: productName,
          displayName: productName,
          sku: `R7-SCOPE-${suffix}`,
          categoryId,
          unitId,
          type: ProductType.SERVICE,
          isPurchasable: false,
          isSellable: true,
          isInventoryItem: false,
        },
      })
    ).id;

    const salesPerms = [
      'crm.leads.view',
      'crm.leads.create',
      'crm.leads.edit',
      'store-orders.view',
      'store-orders.edit',
    ];
    await makeUser('A', salesPerms);
    await makeUser('B', salesPerms);
    await makeUser('finance', ['finance.view', 'store-orders.view']);
    await makeUser('shipping', [
      'shipping.view',
      'shipping.edit',
      'store-orders.view',
    ]);
    // Team manager WITHOUT crm.leads.manage — manages a team with A only.
    await makeUser('tm', ['crm.leads.view', 'store-orders.view']);
    // Team manager WITH the explicit supervisory grant.
    await makeUser('tmManage', [
      'crm.leads.view',
      'crm.leads.manage',
      'store-orders.view',
    ]);
    // Company-wide supervisor (explicit grant, no team).
    await makeUser('manager', [
      'crm.leads.view',
      'crm.leads.manage',
      'store-orders.view',
    ]);
    // A user holding sales permissions but whose order access is `manage`.
    await makeUser('ordersManage', [
      'store-orders.view',
      'store-orders.manage',
    ]);

    for (const [key, managerKey, memberKey] of [
      ['t1', 'tm', 'A'],
      ['t2', 'tmManage', 'A'],
    ] as const) {
      const department = await prisma.department.findFirstOrThrow();
      const team = await prisma.salesTeam.create({
        data: {
          code: `R7S-${suffix}-${key}`,
          name: `R7 Scope Team ${key} ${suffix}`,
          departmentId: department.id,
          managerId: ids[managerKey],
          members: { create: [{ userId: ids[memberKey] }] },
        },
      });
      teamIds.push(team.id);
    }

    const agentPartner = await prisma.partner.create({
      data: {
        name: `R7 Scope Agent Partner ${suffix}`,
        partnerNumber: `R7S-AG-${suffix}`,
      },
    });
    partnerIds.push(agentPartner.id);
    const agent = await prisma.agent.create({
      data: {
        agentNumber: `R7S-${suffix}`,
        partnerId: agentPartner.id,
        name: `R7 Scope Agent ${suffix}`,
        currencyId,
      },
    });
    agentIds.push(agent.id);
    ids.agent = agent.id;

    await makeLead('A', ids.A);
    await makeLead('B', ids.B);
    await makeLead('U', null);
    await makeLead('G', null, agent.id);
    await makeOrder('A', ids.A);
    await makeOrder('B', ids.B);
    await makeOrder('G', null, agent.id);
  });

  afterAll(async () => {
    await prisma.shipment.deleteMany({
      where: { storeOrderId: { in: orderIds } },
    });
    await prisma.storeOrderActivity.deleteMany({
      where: { storeOrderId: { in: orderIds } },
    });
    await prisma.storeOrderItem.deleteMany({
      where: { storeOrderId: { in: orderIds } },
    });
    await prisma.storeOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.leadActivity.deleteMany({
      where: { leadId: { in: leadIds } },
    });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
    await prisma.salesTeamMember.deleteMany({
      where: { salesTeamId: { in: teamIds } },
    });
    await prisma.salesTeam.deleteMany({ where: { id: { in: teamIds } } });
    await prisma.agent.deleteMany({ where: { id: { in: agentIds } } });
    await prisma.partnerRoleAssignment.deleteMany({
      where: { partnerId: { in: partnerIds } },
    });
    await prisma.customerProfile.deleteMany({
      where: { partnerId: { in: partnerIds } },
    });
    await prisma.partnerPhoneKey.deleteMany({
      where: { partnerId: { in: partnerIds } },
    });
    await prisma.partner.deleteMany({ where: { id: { in: partnerIds } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.unit.deleteMany({ where: { id: unitId } });
    await prisma.productCategory.deleteMany({ where: { id: categoryId } });
    await prisma.userPermission.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
    await prisma.$disconnect();
    await moduleRef.close();
  });

  const idsOf = (body: unknown) =>
    ((body as { items: { id: string }[] }).items ?? []).map((row) => row.id);

  describe('Leads — default own scope', () => {
    it('A lists only A’s lead: not B’s, not unassigned, not an agent lead', async () => {
      const res = await request(http).get('/leads').set(auth('A'));
      expect(res.status).toBe(200);
      const got = idsOf(res.body);
      expect(got).toContain(lead.A);
      expect(got).not.toContain(lead.B);
      expect(got).not.toContain(lead.U);
      expect(got).not.toContain(lead.G);
    });

    it('A cannot open B’s lead by id (404, no disclosure) nor its sub-resources', async () => {
      for (const path of [
        `/leads/${lead.B}`,
        `/leads/${lead.B}/follow-ups`,
        `/leads/${lead.B}/notes`,
        `/leads/${lead.B}/activities`,
        `/leads/${lead.B}/assignments`,
      ]) {
        const res = await request(http).get(path).set(auth('A'));
        expect(res.status).toBe(404);
        expect(JSON.stringify(res.body)).not.toContain(names.B);
      }
      const opened = await request(http).get(`/leads/${lead.A}`).set(auth('A'));
      expect(opened.status).toBe(200);
    });

    it('A cannot mutate B’s lead (update / archive)', async () => {
      const patch = await request(http)
        .patch(`/leads/${lead.B}`)
        .set(auth('A'))
        .send({ customerName: 'hijacked' });
      expect(patch.status).toBe(404);
      const del = await request(http).delete(`/leads/${lead.B}`).set(auth('A'));
      // 403 (no archive permission) or 404 (out of scope) — never a success.
      expect([403, 404]).toContain(del.status);
      const row = await prisma.lead.findUniqueOrThrow({
        where: { id: lead.B },
      });
      expect(row.customerName).toBe(names.B);
      expect(row.deletedAt).toBeNull();
    });

    it('search by B’s name or number finds nothing for A, and finds it for B', async () => {
      const byName = await request(http)
        .get('/leads')
        .query({ search: names.B })
        .set(auth('A'));
      expect(byName.status).toBe(200);
      expect((byName.body as { total: number }).total).toBe(0);
      const byOwn = await request(http)
        .get('/leads')
        .query({ search: names.B })
        .set(auth('B'));
      expect(idsOf(byOwn.body)).toEqual([lead.B]);
    });

    it('the bare-id ("select all") list and filters never widen the scope', async () => {
      const res = await request(http).get('/leads/ids').set(auth('A'));
      expect(res.status).toBe(200);
      const got = (res.body as { ids: string[] }).ids;
      expect(got).toContain(lead.A);
      expect(got).not.toContain(lead.B);
      // Spoofed owner filters / scope params are ignored or empty — never B's.
      const spoof = await request(http)
        .get('/leads')
        .query({ salesEmployeeId: ids.B, unassigned: 'true', scope: 'all' })
        .set(auth('A'));
      expect(idsOf(spoof.body)).not.toContain(lead.B);
      expect(idsOf(spoof.body)).not.toContain(lead.U);
    });

    it('counters never include other users’ or unassigned leads', async () => {
      const res = await request(http)
        .get('/leads/unassigned-count')
        .set(auth('A'));
      expect(res.status).toBe(200);
      expect((res.body as { count: number }).count).toBe(0);
      const list = await request(http).get('/leads').set(auth('A'));
      expect((list.body as { unassignedCount: number }).unassignedCount).toBe(
        0,
      );
      expect((list.body as { total: number }).total).toBe(1);
    });

    it('workflow status-history of B’s lead is not readable by A', async () => {
      const res = await request(http)
        .get(`/workflow/LEAD/${lead.B}/status-history`)
        .set(auth('A'));
      expect(res.status).toBe(404);
      const own = await request(http)
        .get(`/workflow/LEAD/${lead.A}/status-history`)
        .set(auth('A'));
      expect(own.status).toBe(200);
    });
  });

  describe('Leads — explicit supervisory grants', () => {
    it('a Team Manager without crm.leads.manage sees own + team members only: no unassigned, no agent leads', async () => {
      const res = await request(http).get('/leads').set(auth('tm'));
      const got = idsOf(res.body);
      expect(got).toContain(lead.A);
      expect(got).not.toContain(lead.B);
      expect(got).not.toContain(lead.U);
      expect(got).not.toContain(lead.G);
      const one = await request(http).get(`/leads/${lead.U}`).set(auth('tm'));
      expect(one.status).toBe(404);
      const count = await request(http)
        .get('/leads/unassigned-count')
        .set(auth('tm'));
      expect((count.body as { count: number }).count).toBe(0);
    });

    it('a Team Manager WITH crm.leads.manage also sees the unassigned INTERNAL pool, still not agent leads or other teams', async () => {
      const res = await request(http).get('/leads/ids').set(auth('tmManage'));
      const got = (res.body as { ids: string[] }).ids;
      expect(got).toContain(lead.A);
      expect(got).toContain(lead.U);
      expect(got).not.toContain(lead.B);
      expect(got).not.toContain(lead.G);
    });

    it('a company-wide supervisor (crm.leads.manage, no team) keeps the full view', async () => {
      const res = await request(http).get('/leads/ids').set(auth('manager'));
      const got = (res.body as { ids: string[] }).ids;
      for (const key of ['A', 'B', 'U']) expect(got).toContain(lead[key]);
    });

    it('an Agent token never reaches internal lead routes (deny-by-default)', async () => {
      const agentToken = jwt.sign({
        sub: ids.A,
        email: 'agent@example.test',
        typ: 'agent',
        agentId: ids.agent,
      });
      for (const path of ['/leads', `/leads/${lead.G}`, '/store-orders']) {
        const res = await request(http)
          .get(path)
          .set({ Authorization: `Bearer ${agentToken}` });
        expect(res.status).toBe(403);
        expect(JSON.stringify(res.body)).toContain('AGENT_ACCESS_DENIED');
      }
    });
  });

  describe('Store orders — default own scope', () => {
    it('A lists only A’s order; B’s, unassigned and agent orders are absent (list, ids, search)', async () => {
      const list = await request(http).get('/store-orders').set(auth('A'));
      expect(list.status).toBe(200);
      const got = idsOf(list.body);
      expect(got).toContain(order.A);
      expect(got).not.toContain(order.B);
      expect(got).not.toContain(order.G);

      const bare = await request(http).get('/store-orders/ids').set(auth('A'));
      const bareIds = (bare.body as { ids: string[] }).ids;
      expect(bareIds).toContain(order.A);
      expect(bareIds).not.toContain(order.B);

      const search = await request(http)
        .get('/store-orders')
        .query({ search: names.oB })
        .set(auth('A'));
      expect((search.body as { total: number }).total).toBe(0);
      const own = await request(http)
        .get('/store-orders')
        .query({ search: names.oB })
        .set(auth('B'));
      expect(idsOf(own.body)).toEqual([order.B]);
    });

    it('A cannot open B’s order by id or direct URL, nor read its history / fulfillment gate / payment context', async () => {
      for (const path of [
        `/store-orders/${order.B}`,
        `/store-orders/${order.B}/can-fulfill`,
        `/store-orders/${order.B}/payment-context`,
        `/store-orders/${order.B}/shipping-handoff`,
        `/workflow/STORE_ORDER/${order.B}/status-history`,
      ]) {
        const res = await request(http).get(path).set(auth('A'));
        expect(res.status).toBe(404);
        expect(JSON.stringify(res.body)).not.toContain(names.oB);
      }
      const own = await request(http)
        .get(`/store-orders/${order.A}/can-fulfill`)
        .set(auth('A'));
      expect(own.status).toBe(200);
    });

    it('A cannot mutate B’s order (note / archive)', async () => {
      const note = await request(http)
        .post(`/store-orders/${order.B}/notes`)
        .set(auth('A'))
        .send({ text: 'nope' });
      expect(note.status).toBe(404);
      const archive = await request(http)
        .post(`/store-orders/${order.B}/archive`)
        .set(auth('A'));
      expect([403, 404]).toContain(archive.status);
      const row = await prisma.storeOrder.findUniqueOrThrow({
        where: { id: order.B },
      });
      expect(row.deletedAt).toBeNull();
    });

    it('the duplicate-review filter needs its own permission and never becomes an unscoped list', async () => {
      const denied = await request(http)
        .get('/store-orders')
        .query({ duplicateReviewStatus: 'PENDING' })
        .set(auth('A'));
      expect(denied.status).toBe(403);
      await grant(ids.A, ['store-orders.duplicate_review']);
      const allowed = await request(http)
        .get('/store-orders')
        .query({ duplicateReviewStatus: 'PENDING' })
        .set(auth('A'));
      expect(allowed.status).toBe(200);
      // Only flagged orders — none of this suite's (unflagged) orders appear.
      const got = idsOf(allowed.body);
      for (const key of ['A', 'B', 'G']) expect(got).not.toContain(order[key]);
      await prisma.userPermission.deleteMany({
        where: {
          userId: ids.A,
          permission: { name: 'store-orders.duplicate_review' },
        },
      });
      resolver.invalidate(ids.A);
    });
  });

  describe('Store orders — Shipping and Finance never widen the generic list', () => {
    it('Shipping lists no sales orders, and opens only an order that is in the Shipping queue', async () => {
      const list = await request(http)
        .get('/store-orders')
        .set(auth('shipping'));
      expect(list.status).toBe(200);
      const got = idsOf(list.body);
      for (const key of ['A', 'B', 'G']) expect(got).not.toContain(order[key]);

      const before = await request(http)
        .get(`/store-orders/${order.B}`)
        .set(auth('shipping'));
      expect(before.status).toBe(404);

      await prisma.shipment.create({
        data: { storeOrderId: order.B, attemptNumber: 1 },
      });
      const after = await request(http)
        .get(`/store-orders/${order.B}`)
        .set(auth('shipping'));
      expect(after.status).toBe(200);
      // …but a queued order is still not a sales-list entry for them.
      const stillNoList = await request(http)
        .get('/store-orders')
        .set(auth('shipping'));
      expect(idsOf(stillNoList.body)).not.toContain(order.B);
      await prisma.shipment.deleteMany({ where: { storeOrderId: order.B } });
    });

    it('Finance has no broad list and cannot open an order without payment activity', async () => {
      const list = await request(http)
        .get('/store-orders')
        .set(auth('finance'));
      const got = idsOf(list.body);
      for (const key of ['A', 'B', 'G']) expect(got).not.toContain(order[key]);
      const byId = await request(http)
        .get(`/store-orders/${order.A}`)
        .set(auth('finance'));
      expect(byId.status).toBe(404);
    });

    it('an explicit store-orders.manage grant keeps the cross-owner view (preserved)', async () => {
      const list = await request(http)
        .get('/store-orders/ids')
        .set(auth('ordersManage'));
      const got = (list.body as { ids: string[] }).ids;
      for (const key of ['A', 'B', 'G']) expect(got).toContain(order[key]);
      const byId = await request(http)
        .get(`/store-orders/${order.B}`)
        .set(auth('ordersManage'));
      expect(byId.status).toBe(200);
    });

    it('a Team Manager sees team orders only', async () => {
      const list = await request(http).get('/store-orders/ids').set(auth('tm'));
      const got = (list.body as { ids: string[] }).ids;
      expect(got).toContain(order.A);
      expect(got).not.toContain(order.B);
      expect(got).not.toContain(order.G);
    });
  });
});
