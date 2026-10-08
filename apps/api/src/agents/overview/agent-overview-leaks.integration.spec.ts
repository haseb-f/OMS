/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment -- supertest response bodies are untyped JSON under assertion */
import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import type { Server } from 'http';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../common/errors/all-exceptions.filter';
import { formatValidationErrors } from '../../common/errors/format-validation-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { UserSessionsService } from '../../auth/sessions/user-sessions.service';
import { AgentsService } from '../admin/agents.service';
import { AgentAgreementsService } from '../admin/agent-agreements.service';
import { AgentUsersService } from '../admin/agent-users.service';
import { leakedKeys } from '../pricing/leaked-keys.test-util';

/**
 * R15 W1 — agent overviews over the real HTTP pipeline (AppModule, real
 * guards and JWTs, local Postgres, tagged fixtures):
 *  - scope: company with / without `agents.finance.view` (money absent, not
 *    zero), agent admin with / without `agent.reports.view_team`, agent
 *    employee own-only;
 *  - 1.6: no carrier cost / margin key in anything an agent token receives
 *    (dashboard, quote, create / convert responses, leads, sales reports).
 */
describe('R15 W1 — agent overviews: scope and no cost leak (HTTP integration)', () => {
  jest.setTimeout(300_000);
  let moduleRef: TestingModule;
  let app: INestApplication;
  let http: Server;
  let prisma: PrismaService;
  let resolver: PermissionsResolverService;
  let sessionTokens: UserSessionsService;

  const tag = randomUUID().slice(0, 6).toUpperCase();
  const lower = tag.toLowerCase();
  let phoneSeq = 0;
  const phone = () =>
    `+2010${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}${String(++phoneSeq % 100).padStart(2, '0')}`;

  let egId: string;
  let agentAId: string;
  let agentBId: string;
  let productAId: string;
  const users: Record<
    'viewer' | 'finance' | 'adminA' | 'adminNoTeam' | 'salesA1' | 'salesA2',
    { id: string; token: string }
  > = {} as never;
  /** Bodies received by agent tokens — every one is checked for leaked keys. */
  const agentBodies: Array<{ path: string; body: unknown }> = [];

  const get = (token: string, path: string) =>
    request(http).get(path).set('Authorization', `Bearer ${token}`);
  const post = (token: string, path: string, body: object = {}) =>
    request(http).post(path).set('Authorization', `Bearer ${token}`).send(body);
  const agentGet = async (token: string, path: string) => {
    const res = await get(token, path);
    agentBodies.push({ path, body: res.body });
    return res;
  };
  const agentPost = async (token: string, path: string, body: object) => {
    const res = await post(token, path, body);
    agentBodies.push({ path, body: res.body });
    return res;
  };
  const pickupOrder = (amount: number) => ({
    pricingMode: 'SHIPPING_ADDED',
    lines: [{ productId: productAId, quantity: 1, lineAmount: amount }],
    fulfillmentMethod: 'PICKUP',
    paymentType: 'PREPAID',
    countryId: egId,
  });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
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
    resolver = moduleRef.get(PermissionsResolverService);
    sessionTokens = moduleRef.get(UserSessionsService, { strict: false });
    const agents = moduleRef.get(AgentsService, { strict: false });
    const agreements = moduleRef.get(AgentAgreementsService, { strict: false });
    const agentUsers = moduleRef.get(AgentUsersService, { strict: false });

    const internalUser = async (key: string, permissions: string[]) => {
      const user = await prisma.user.create({
        data: {
          email: `ovw-${key}-${lower}@test.local`,
          username: `ovw-${key}-${lower}`,
          fullName: `Overview ${key} ${tag}`,
          passwordHash: 'x',
          isSuperAdmin: key === 'root',
        },
      });
      for (const name of permissions) {
        const permission = await prisma.permission.findUniqueOrThrow({
          where: { name },
        });
        await prisma.userPermission.create({
          data: { userId: user.id, permissionId: permission.id },
        });
      }
      return {
        id: user.id,
        token: await sessionTokens.issueAccessToken({
          sub: user.id,
          email: user.email,
        }),
      };
    };
    const root = await internalUser('root', []);
    users.viewer = await internalUser('viewer', ['agents.view']);
    users.finance = await internalUser('finance', [
      'agents.view',
      'agents.finance.view',
      'agents.users.view',
    ]);

    const currencyId = (
      await prisma.currency.create({
        data: { code: `O${tag}`, name: `Overview Test ${tag}` },
      })
    ).id;
    const eg = await prisma.country.findFirst({ where: { code: 'EG' } });
    if (!eg) throw new Error('Expected country EG in the local database.');
    egId = eg.id;
    const categoryId = (
      await prisma.productCategory.create({
        data: { name: `ovw-${tag}-category` },
      })
    ).id;
    const unitId = (
      await prisma.unit.create({ data: { name: `ovw-${tag}-unit` } })
    ).id;

    const makeAgent = async (suffix: string) => {
      const agent = await agents.create(
        {
          name: `Overview Agent ${suffix} ${tag}`,
          email: `ovw-agent-${suffix.toLowerCase()}-${lower}@test.local`,
          currencyId,
        },
        root.id,
      );
      const agreement = await agreements.create(
        agent.id,
        {
          effectiveFrom: '2020-01-01',
          productCommissionRatePercent: 10,
          serviceCommissionRatePercent: 10,
          shippingPolicy: 'FLAT_FEE_PER_SHIPMENT',
          commissionEarningEvent: 'DELIVERED',
          returnCommissionTreatment: 'REVERSE',
          customerShippingChargeOwner: 'COMPANY',
          providerFeesBorneBy: 'AGENT',
          shippingFeePerShipment: 15,
          returnFeePerShipment: 20,
          serviceFeePerOrder: 0,
          allowAgentDestinations: false,
          payoutHoldDays: 7,
        },
        root.id,
      );
      await agreements.activate(agent.id, agreement.id, root.id);
      const product = await prisma.product.create({
        data: {
          sku: `OVW-${tag}-${suffix}`,
          name: `Overview Product ${suffix} ${tag}`,
          internalName: `Overview Product ${suffix}`,
          displayName: `Overview Product ${suffix}`,
          categoryId,
          unitId,
          type: 'PURCHASE_AND_SALE',
          isPurchasable: true,
          isSellable: true,
          isInventoryItem: true,
          itemType: 'PRODUCT',
          salesPrice: 600,
          ownerAgentId: agent.id,
        },
      });
      return { agentId: agent.id, productId: product.id };
    };
    ({ agentId: agentAId, productId: productAId } = await makeAgent('A'));
    ({ agentId: agentBId } = await makeAgent('B'));

    const agentUser = async (key: string, role: 'ADMIN' | 'SALES') => {
      const created = await agentUsers.create(
        agentAId,
        {
          email: `ovw-${key}-${lower}@test.local`,
          username: `ovw-${key}-${lower}`,
          fullName: `Overview ${key} ${tag}`,
          agentRole: role,
        },
        root.id,
      );
      await prisma.user.update({
        where: { id: created.id },
        data: { mustChangePassword: false },
      });
      return {
        id: created.id,
        token: await sessionTokens.issueAccessToken({
          sub: created.id,
          email: created.email,
          typ: 'agent',
          agentId: agentAId,
        }),
      };
    };
    users.adminA = await agentUser('admina', 'ADMIN');
    users.adminNoTeam = await agentUser('adminnoteam', 'ADMIN');
    users.salesA1 = await agentUser('salesa1', 'SALES');
    users.salesA2 = await agentUser('salesa2', 'SALES');
    // An agent admin without the team-report right (R15 D15-18).
    const viewTeam = await prisma.permission.findUniqueOrThrow({
      where: { name: 'agent.reports.view_team' },
    });
    await prisma.userPermission.deleteMany({
      where: { userId: users.adminNoTeam.id, permissionId: viewTeam.id },
    });
    resolver.invalidate(users.adminNoTeam.id);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('agent order entry responses (fixtures for the overviews)', () => {
    it('quote, create and lead conversion succeed for agent users', async () => {
      const quote = await agentPost(
        users.salesA1.token,
        '/agent-portal/orders/quote',
        pickupOrder(1000),
      );
      expect(quote.status).toBe(200);
      expect(quote.body.valid).toBe(true);

      const first = await agentPost(
        users.salesA1.token,
        '/agent-portal/orders',
        {
          ...pickupOrder(1000),
          customer: {
            name: `Ovw Customer 1 ${tag}`,
            mobile: phone(),
            countryId: egId,
          },
          idempotencyKey: `ovw-1-${tag}`,
        },
      );
      expect(first.status).toBe(201);
      const second = await agentPost(
        users.salesA1.token,
        '/agent-portal/orders',
        {
          ...pickupOrder(400),
          customer: {
            name: `Ovw Customer 2 ${tag}`,
            mobile: phone(),
            countryId: egId,
          },
          idempotencyKey: `ovw-2-${tag}`,
        },
      );
      expect(second.status).toBe(201);
      const third = await agentPost(
        users.salesA2.token,
        '/agent-portal/orders',
        {
          ...pickupOrder(250),
          customer: {
            name: `Ovw Customer 3 ${tag}`,
            mobile: phone(),
            countryId: egId,
          },
          idempotencyKey: `ovw-3-${tag}`,
        },
      );
      expect(third.status).toBe(201);

      // salesA1's first order reached the customer.
      const delivered = await prisma.statusDefinition.findFirstOrThrow({
        where: {
          workflowType: 'FULFILLMENT',
          code: 'DELIVERED',
          deletedAt: null,
        },
      });
      await prisma.storeOrder.update({
        where: { id: first.body.id },
        data: { fulfillmentStatusId: delivered.id },
      });

      const lead = await agentPost(users.salesA1.token, '/agent-portal/leads', {
        customerName: `Ovw Lead ${tag}`,
        mobileNumber: phone(),
        countryId: egId,
        productId: productAId,
        quantity: 1,
      });
      expect(lead.status).toBe(201);
      const openLead = await agentPost(
        users.salesA2.token,
        '/agent-portal/leads',
        {
          customerName: `Ovw Lead 2 ${tag}`,
          mobileNumber: phone(),
          countryId: egId,
        },
      );
      expect(openLead.status).toBe(201);
      const converted = await agentPost(
        users.salesA1.token,
        `/agent-portal/leads/${lead.body.id}/convert`,
        { ...pickupOrder(300), idempotencyKey: `ovw-lead-${tag}` },
      );
      expect(converted.status).toBe(201);

      await agentGet(users.salesA1.token, '/agent-portal/leads?pageSize=50');
      await agentGet(
        users.salesA1.token,
        `/agent-portal/leads/${lead.body.id}`,
      );
      await agentGet(users.adminA.token, '/agent-portal/orders?pageSize=50');
      await agentGet(
        users.adminA.token,
        `/agent-portal/orders/${first.body.id}`,
      );
      await agentGet(users.adminA.token, '/agent-portal/products');
    });
  });

  describe('agent portal dashboard scope', () => {
    it('agent employee: own orders, own sales value / delivered value / returns — no agent money, no team', async () => {
      const res = await agentGet(
        users.salesA1.token,
        '/agent-portal/dashboard',
      );
      expect(res.status).toBe(200);
      expect(res.body.scope).toBe('OWN');
      // salesA1: 1000 (delivered) + 400 + 300 (converted lead).
      expect(res.body.fulfillment.total).toBe(3);
      expect(res.body.own).toEqual({
        orderValue: 1700,
        deliveredValue: 1000,
        deliveredCount: 1,
        returnCount: 0,
      });
      expect(res.body.leads).toEqual({ total: 1, fresh: 0, converted: 1 });
      expect(res.body.sales).toBeNull();
      expect(res.body.collections).toBeNull();
      expect(res.body.position).toBeNull();
      expect(res.body.payouts).toBeNull();
      expect(res.body.team).toBeNull();

      const other = await agentGet(
        users.salesA2.token,
        '/agent-portal/dashboard',
      );
      expect(other.body.own.orderValue).toBe(250);
      expect(other.body.own.deliveredValue).toBe(0);
      expect(other.body.leads.total).toBe(1);
    });

    it('agent admin with agent.reports.view_team: the whole agent plus the per-employee breakdown', async () => {
      const res = await agentGet(users.adminA.token, '/agent-portal/dashboard');
      expect(res.status).toBe(200);
      expect(res.body.scope).toBe('ALL');
      expect(res.body.own).toBeNull();
      expect(res.body.fulfillment.total).toBe(4);
      expect(res.body.sales.totalOrderValue).toBe(1950);
      expect(res.body.leads).toEqual({
        total: 2,
        fresh: expect.any(Number),
        converted: 1,
      });
      const byUser = new Map(
        (res.body.team as Array<{ user: { id: string } | null }>).map((row) => [
          row.user?.id ?? null,
          row,
        ]),
      );
      expect(byUser.get(users.salesA1.id)).toMatchObject({
        fulfillment: { total: 3 },
        leads: { total: 1, converted: 1 },
        sales: { orderValue: 1700, deliveredValue: 1000 },
      });
      expect(byUser.get(users.salesA2.id)).toMatchObject({
        fulfillment: { total: 1 },
        sales: { orderValue: 250 },
      });
      expect(byUser.get(users.adminA.id)).toMatchObject({
        fulfillment: { total: 0 },
      });
    });

    it('agent admin without agent.reports.view_team: browses every order, but sales figures are its own (D15-18)', async () => {
      const res = await agentGet(
        users.adminNoTeam.token,
        '/agent-portal/dashboard',
      );
      expect(res.status).toBe(200);
      // Records scope: counts of what the user can browse.
      expect(res.body.scope).toBe('ALL');
      expect(res.body.fulfillment.total).toBe(4);
      expect(res.body.leads.total).toBe(2);
      // Report scope: own figures only (the admin owns no order), no agent-wide money.
      expect(res.body.own).toEqual({
        orderValue: 0,
        deliveredValue: 0,
        deliveredCount: 0,
        returnCount: 0,
      });
      expect(res.body.sales.totalOrderValue).toBe(0);
      expect(res.body.collections).toBeNull();
      expect(res.body.position).toBeNull();
      expect(res.body.payouts).toBeNull();
      expect(res.body.team).toBeNull();
    });

    it('a sales user delegated agent.records.view_all sees agent-wide counts, never colleagues sales figures', async () => {
      const grant = async (name: string) => {
        const permission = await prisma.permission.findUniqueOrThrow({
          where: { name },
        });
        await prisma.userPermission.create({
          data: { userId: users.salesA1.id, permissionId: permission.id },
        });
        return permission.id;
      };
      const granted: string[] = [];
      try {
        granted.push(await grant('agent.records.view_all'));
        resolver.invalidate(users.salesA1.id);
        const res = await agentGet(
          users.salesA1.token,
          '/agent-portal/dashboard',
        );
        expect(res.status).toBe(200);
        expect(res.body.scope).toBe('ALL');
        expect(res.body.fulfillment.total).toBe(4);
        expect(res.body.leads.total).toBe(2);
        expect(res.body.own.orderValue).toBe(1700);
        expect(res.body.sales).toBeNull();
        expect(res.body.team).toBeNull();

        // With the statement right too: still only their own sales, no agent money.
        granted.push(await grant('agent.statement.view'));
        resolver.invalidate(users.salesA1.id);
        const withMoney = await agentGet(
          users.salesA1.token,
          '/agent-portal/dashboard',
        );
        expect(withMoney.body.sales.totalOrderValue).toBe(1700);
        expect(withMoney.body.collections).toBeNull();
        expect(withMoney.body.position).toBeNull();
        expect(withMoney.body.team).toBeNull();
      } finally {
        await prisma.userPermission.deleteMany({
          where: { userId: users.salesA1.id, permissionId: { in: granted } },
        });
        resolver.invalidate(users.salesA1.id);
      }
    });
  });

  describe('company overviews', () => {
    it('agent tokens are refused', async () => {
      for (const path of ['/agents-overview', `/agents/${agentAId}/overview`]) {
        const res = await get(users.adminA.token, path);
        expect([path, res.status]).toEqual([path, 403]);
      }
    });

    it('agents.view without finance: stage counts and leads, money absent (not zero), no team', async () => {
      const list = await get(
        users.viewer.token,
        `/agents-overview?ids=${agentAId},${agentBId}`,
      );
      expect(list.status).toBe(200);
      expect(list.body.finance).toBe(false);
      expect(
        list.body.items.map((row: { agent: { id: string } }) => row.agent.id),
      ).toEqual([agentAId, agentBId]);
      const [rowA, rowB] = list.body.items;
      expect(rowA.fulfillment.total).toBe(4);
      expect(rowA.leads).toEqual({
        total: 2,
        fresh: expect.any(Number),
        converted: 1,
      });
      expect(rowB.fulfillment.total).toBe(0);
      for (const key of ['sales', 'delivered', 'collections', 'position']) {
        expect(rowA).not.toHaveProperty(key);
      }
      expect(list.body.totals).not.toHaveProperty('collections');
      expect(list.body.totals.agents.total).toBeGreaterThanOrEqual(2);
      expect(list.body.totals.orders.open).toBeGreaterThanOrEqual(4);

      const one = await get(users.viewer.token, `/agents/${agentAId}/overview`);
      expect(one.status).toBe(200);
      expect(one.body.fulfillment.total).toBe(4);
      expect(one.body.leads.total).toBe(2);
      for (const key of [
        'sales',
        'delivered',
        'returns',
        'collections',
        'position',
        'payouts',
        'team',
      ]) {
        expect(one.body).not.toHaveProperty(key);
      }
    });

    it('with agents.finance.view (+ users.view): money and the team breakdown', async () => {
      const list = await get(
        users.finance.token,
        `/agents-overview?ids=${agentAId}`,
      );
      expect(list.status).toBe(200);
      expect(list.body.finance).toBe(true);
      expect(list.body.items[0].sales.totalOrderValue).toBe(1950);
      expect(list.body.items[0].delivered).toEqual({ count: 1, value: 1000 });
      expect(list.body.items[0].collections).toEqual({
        awaitingVerificationCount: 0,
        awaitingVerificationAmount: 0,
      });
      expect(list.body.items[0].position).toHaveProperty('available');
      expect(list.body.totals.collections).toHaveProperty(
        'awaitingVerificationCount',
      );

      const one = await get(
        users.finance.token,
        `/agents/${agentAId}/overview`,
      );
      expect(one.status).toBe(200);
      expect(one.body.sales.totalOrderValue).toBe(1950);
      expect(one.body.position).toHaveProperty('balance');
      const salesRow = one.body.team.find(
        (row: { user: { id: string } | null }) =>
          row.user?.id === users.salesA1.id,
      );
      expect(salesRow.sales).toEqual({
        orderValue: 1700,
        deliveredValue: 1000,
        deliveredCount: 1,
      });
    });

    it('rejects ids that are not UUIDs and answers 404 for an unknown agent', async () => {
      expect(
        (await get(users.viewer.token, '/agents-overview?ids=abc')).status,
      ).toBe(400);
      expect(
        (await get(users.viewer.token, `/agents/${randomUUID()}/overview`))
          .status,
      ).toBe(404);
    });
  });

  describe('1.6 — nothing an agent token receives exposes carrier cost or margin', () => {
    it('agent portal sales reports', async () => {
      for (const path of [
        '/agent-portal/sales-reports/live',
        '/agent-portal/sales-reports/performance',
      ]) {
        await agentGet(users.adminA.token, path);
        await agentGet(users.salesA1.token, path);
      }
    });

    it('every collected body is free of cost / margin keys', () => {
      expect(agentBodies.length).toBeGreaterThan(15);
      for (const { path, body } of agentBodies) {
        expect({ path, leaked: leakedKeys(body) }).toEqual({
          path,
          leaked: [],
        });
      }
    });
  });
});
