import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { UserSessionsService } from '../auth/sessions/user-sessions.service';
import type { Server } from 'http';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { ProductType, type StoreOrderPaymentType } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { AuthModule } from '../auth/auth.module';
import { SalesScopeModule } from '../sales-scope/sales-scope.module';
import { AllExceptionsFilter } from '../common/errors/all-exceptions.filter';
import { formatValidationErrors } from '../common/errors/format-validation-errors';
import { SalesReportsModule } from './sales-reports.module';
import {
  SalesReportsService,
  type LiveBucket,
  type PerformanceReport,
} from './sales-reports.service';
import type { AgentRequestContext } from '../auth/guards/jwt-auth.guard';

/**
 * R13 spec E — sales reports over the real HTTP pipeline and the local
 * Postgres. Seeded orders across Cairo midnight, two currencies created for
 * this test (so sums are exact even for an ALL viewer), cancelled /
 * returned / deleted orders and two agents. Proves the metric definitions,
 * the ranking and the scope boundaries (OWN never sees a colleague, TEAM
 * sees its members, ALL sees agents only as a separate row, agent A never
 * sees agent B, agent tokens never reach the company endpoints).
 */
describe('Sales reports (HTTP + DB)', () => {
  jest.setTimeout(120_000);

  let moduleRef: TestingModule;
  let app: INestApplication;
  let http: Server;
  let prisma: PrismaService;
  let sessionTokens: UserSessionsService;
  let resolver: PermissionsResolverService;
  let reports: SalesReportsService;

  const tag = randomUUID().slice(0, 6).toUpperCase();
  const cur1 = `E1${tag}`;
  const cur2 = `E2${tag}`;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const agentIds: string[] = [];
  const partnerIds: string[] = [];
  const currencyIds: string[] = [];
  let teamId: string;
  let productId: string;
  let categoryId: string;
  let unitId: string;
  let partnerId: string;
  const status: Record<string, string> = {};

  // "Now" for the Live cards: 2021-03-10 12:00 Cairo (UTC+2, no DST in 2021).
  const NOW = new Date('2021-03-10T10:00:00Z');
  const RANGE = 'from=2021-03-01&to=2021-03-10';

  const get = (who: string, path: string) =>
    request(http).get(path).set('Authorization', `Bearer ${tokens[who]}`);

  async function grant(userId: string, names: string[]) {
    for (const name of names) {
      const permission = await prisma.permission.upsert({
        where: { name },
        update: {},
        create: { name },
      });
      await prisma.userPermission.upsert({
        where: { userId_permissionId: { userId, permissionId: permission.id } },
        update: {},
        create: { userId, permissionId: permission.id },
      });
    }
    resolver.invalidate(userId);
  }

  async function makeUser(
    key: string,
    permissions: string[],
    agent?: { agentId: string; role: 'ADMIN' | 'SALES' },
  ) {
    const user = await prisma.user.create({
      data: {
        email: `r13e-${key.toLowerCase()}-${tag.toLowerCase()}@example.test`,
        username: `r13e-${key.toLowerCase()}-${tag.toLowerCase()}`,
        fullName: `R13E ${key} ${tag}`,
        passwordHash: 'x',
        ...(agent
          ? {
              userType: 'AGENT' as const,
              agentId: agent.agentId,
              agentRole: agent.role,
            }
          : {}),
      },
    });
    userIds.push(user.id);
    ids[key] = user.id;
    tokens[key] = agent
      ? await sessionTokens.issueAccessToken({
          sub: user.id,
          email: user.email,
          typ: 'agent',
          agentId: agent.agentId,
        })
      : await sessionTokens.issueAccessToken({
          sub: user.id,
          email: user.email,
        });
    await grant(user.id, permissions);
    return user.id;
  }

  async function makeAgent(key: string) {
    const partner = await prisma.partner.create({
      data: {
        name: `R13E Agent ${key} ${tag}`,
        partnerNumber: `R13E-${key}-${tag}`,
      },
    });
    partnerIds.push(partner.id);
    const agent = await prisma.agent.create({
      data: {
        agentNumber: `R13E-${key}-${tag}`,
        partnerId: partner.id,
        name: `R13E Agent ${key} ${tag}`,
        currencyId: currencyIds[0],
      },
    });
    agentIds.push(agent.id);
    ids[key] = agent.id;
  }

  let seq = 0;
  async function makeOrder(o: {
    owner: string | null;
    currency: string;
    orderDate: string;
    status?: string;
    payableTotal?: number;
    lines?: number[];
    agentId?: string;
    paymentType?: StoreOrderPaymentType;
    deleted?: boolean;
  }) {
    seq += 1;
    const lines = o.lines ?? [o.payableTotal ?? 0];
    const created = await prisma.storeOrder.create({
      data: {
        internalOrderId: `R13E-${tag}-${seq}`,
        partnerId,
        orderDate: new Date(o.orderDate),
        employeeId: o.owner,
        agentId: o.agentId ?? null,
        currencyId: o.currency === cur1 ? currencyIds[0] : currencyIds[1],
        payableTotal: o.lines ? null : (o.payableTotal ?? null),
        paymentType: o.paymentType ?? 'PREPAID',
        fulfillmentStatusId: o.status ? status[o.status] : null,
        deletedAt: o.deleted ? new Date() : null,
        items: {
          create: lines.map((amount) => ({
            productId,
            quantity: 1,
            unitPrice: amount,
            agreedAmount: amount,
          })),
        },
      },
    });
    orderIds.push(created.id);
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        AuthModule,
        SalesScopeModule,
        SalesReportsModule,
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
    sessionTokens = moduleRef.get(UserSessionsService, { strict: false });
    resolver = moduleRef.get(PermissionsResolverService);
    reports = moduleRef.get(SalesReportsService);

    for (const code of [cur1, cur2]) {
      const currency = await prisma.currency.create({
        data: { code, name: `R13E ${code}` },
      });
      currencyIds.push(currency.id);
    }
    for (const code of ['DELIVERED', 'RETURNED', 'CANCELLED']) {
      status[code] = (
        await prisma.statusDefinition.findFirstOrThrow({
          where: { workflowType: 'FULFILLMENT', code, deletedAt: null },
        })
      ).id;
    }
    categoryId = (
      await prisma.productCategory.create({ data: { name: `R13E Cat ${tag}` } })
    ).id;
    unitId = (await prisma.unit.create({ data: { name: `R13E Unit ${tag}` } }))
      .id;
    productId = (
      await prisma.product.create({
        data: {
          name: `R13E Product ${tag}`,
          internalName: `R13E Product ${tag}`,
          displayName: `R13E Product ${tag}`,
          sku: `R13E-${tag}`,
          categoryId,
          unitId,
          type: ProductType.SERVICE,
          isPurchasable: false,
          isSellable: true,
          isInventoryItem: false,
        },
      })
    ).id;
    const partner = await prisma.partner.create({
      data: { name: `R13E Customer ${tag}`, partnerNumber: `R13E-C-${tag}` },
    });
    partnerId = partner.id;
    partnerIds.push(partner.id);

    const seller = ['store-orders.view', 'reports.sales.view'];
    await makeUser('A', seller);
    await makeUser('B', seller);
    await makeUser('M', seller); // manages team T (member A)
    await makeUser('ALL', [...seller, 'reports.sales.view_all']);
    await makeUser('NOREPORT', ['store-orders.view']);
    const department = await prisma.department.findFirstOrThrow();
    teamId = (
      await prisma.salesTeam.create({
        data: {
          code: `R13E-T-${tag}`,
          name: `R13E Team ${tag}`,
          departmentId: department.id,
          managerId: ids.M,
          members: { create: [{ userId: ids.A }] },
        },
      })
    ).id;

    await makeAgent('G');
    await makeAgent('H');
    await makeUser('GA', ['agent.dashboard.view', 'agent.reports.view_team'], {
      agentId: ids.G,
      role: 'ADMIN',
    });
    await makeUser('GS', ['agent.dashboard.view'], {
      agentId: ids.G,
      role: 'SALES',
    });
    await makeUser('HA', ['agent.dashboard.view', 'agent.reports.view_team'], {
      agentId: ids.H,
      role: 'ADMIN',
    });

    const today = '2021-03-10T09:00:00Z';
    // Employee A.
    await makeOrder({
      owner: ids.A,
      currency: cur1,
      orderDate: today,
      status: 'DELIVERED',
      lines: [100, 50],
    }); // legacy: Σ lines = 150
    await makeOrder({
      owner: ids.A,
      currency: cur2,
      orderDate: today,
      payableTotal: 200,
      paymentType: 'CASH_ON_DELIVERY',
    }); // no status → UNFULFILLED
    await makeOrder({
      owner: ids.A,
      currency: cur1,
      orderDate: today,
      status: 'CANCELLED',
      payableTotal: 999,
    });
    await makeOrder({
      owner: ids.A,
      currency: cur1,
      orderDate: '2021-03-09T21:30:00Z',
      status: 'RETURNED',
      payableTotal: 40,
    }); // 23:30 Cairo, 9 Mar
    await makeOrder({
      owner: ids.A,
      currency: cur1,
      orderDate: '2021-03-09T22:30:00Z',
      status: 'DELIVERED',
      payableTotal: 70,
    }); // 00:30 Cairo, 10 Mar
    await makeOrder({
      owner: ids.A,
      currency: cur1,
      orderDate: today,
      status: 'DELIVERED',
      payableTotal: 5000,
      deleted: true,
    });
    // Employee B.
    await makeOrder({
      owner: ids.B,
      currency: cur1,
      orderDate: today,
      status: 'DELIVERED',
      payableTotal: 500,
    });
    await makeOrder({
      owner: ids.B,
      currency: cur1,
      orderDate: '2021-02-15T10:00:00Z',
      status: 'DELIVERED',
      payableTotal: 30,
    });
    // Agents (G sold by GA, H by HA).
    await makeOrder({
      owner: ids.GA,
      agentId: ids.G,
      currency: cur1,
      orderDate: today,
      status: 'DELIVERED',
      payableTotal: 300,
    });
    await makeOrder({
      owner: ids.HA,
      agentId: ids.H,
      currency: cur1,
      orderDate: today,
      status: 'DELIVERED',
      payableTotal: 77,
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.storeOrderItem.deleteMany({
        where: { storeOrderId: { in: orderIds } },
      });
      await prisma.storeOrder.deleteMany({ where: { id: { in: orderIds } } });
      if (teamId) await prisma.salesTeam.delete({ where: { id: teamId } });
      await prisma.userPermission.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.agent.deleteMany({ where: { id: { in: agentIds } } });
      await prisma.partner.deleteMany({ where: { id: { in: partnerIds } } });
      await prisma.product.deleteMany({ where: { id: productId } });
      await prisma.unit.deleteMany({ where: { id: unitId } });
      await prisma.productCategory.deleteMany({ where: { id: categoryId } });
      await prisma.currency.deleteMany({ where: { id: { in: currencyIds } } });
    }
    await app?.close();
  });

  const bucket = (periods: LiveBucket[], period: string) =>
    periods.find((entry) => entry.period === period) as LiveBucket;
  const mine = (amounts: Array<{ currencyCode: string; amount: number }>) =>
    amounts.filter((a) => a.currencyCode === cur1 || a.currencyCode === cur2);

  it('Live: exact counts and per-currency sums per bucket across Cairo midnight (OWN)', async () => {
    const live = await reports.live(await reports.companyScope(ids.A), NOW);
    expect(live.scope).toBe('OWN');
    const today = bucket(live.periods, 'today');
    expect([today.from, today.to]).toEqual(['2021-03-10', '2021-03-10']);
    expect(today).toMatchObject({
      orders: 4,
      valid: 3,
      cancelled: 1,
      returned: 0,
    });
    expect(today.amounts).toEqual([
      { currencyCode: cur1, amount: 220 },
      { currencyCode: cur2, amount: 200 },
    ]);
    expect(today.statusBreakdown).toEqual(
      expect.arrayContaining([
        { code: 'DELIVERED', count: 2 },
        { code: 'UNFULFILLED', count: 1 },
        { code: 'CANCELLED', count: 1 },
      ]),
    );
    const yesterday = bucket(live.periods, 'yesterday');
    expect(yesterday).toMatchObject({
      orders: 1,
      valid: 1,
      cancelled: 0,
      returned: 1,
    });
    expect(yesterday.amounts).toEqual([{ currencyCode: cur1, amount: 40 }]);
    for (const period of ['last7Days', 'thisMonth']) {
      const b = bucket(live.periods, period);
      expect(b).toMatchObject({
        orders: 5,
        valid: 4,
        cancelled: 1,
        returned: 1,
      });
      expect(b.amounts).toEqual([
        { currencyCode: cur1, amount: 260 },
        { currencyCode: cur2, amount: 200 },
      ]);
    }
    expect(bucket(live.periods, 'lastMonth')).toMatchObject({
      orders: 0,
      amounts: [],
    });
  });

  it('Live: ALL sees every employee but never adds agent orders or another currency', async () => {
    const live = await reports.live(await reports.companyScope(ids.ALL), NOW);
    expect(live.scope).toBe('ALL');
    expect(mine(bucket(live.periods, 'today').amounts)).toEqual([
      { currencyCode: cur1, amount: 720 },
      { currencyCode: cur2, amount: 200 },
    ]);
    expect(mine(bucket(live.periods, 'lastMonth').amounts)).toEqual([
      { currencyCode: cur1, amount: 30 },
    ]);
    // OWN B never sees A.
    const b = await reports.live(await reports.companyScope(ids.B), NOW);
    expect(bucket(b.periods, 'today')).toMatchObject({ orders: 1, valid: 1 });
    expect(bucket(b.periods, 'today').amounts).toEqual([
      { currencyCode: cur1, amount: 500 },
    ]);
  });

  it('Live: agent admin sees its agent only, agent sales its own only', async () => {
    const agentCtx = (
      key: string,
      agent: string,
      role: 'ADMIN' | 'SALES',
    ): AgentRequestContext => ({
      userId: ids[key],
      agentId: ids[agent],
      agentRole: role,
    });
    const ga = await reports.live(
      await reports.agentScope(agentCtx('GA', 'G', 'ADMIN')),
      NOW,
    );
    expect(ga.scope).toBe('AGENT_ALL');
    expect(bucket(ga.periods, 'today')).toMatchObject({ orders: 1, valid: 1 });
    expect(bucket(ga.periods, 'today').amounts).toEqual([
      { currencyCode: cur1, amount: 300 },
    ]);
    const gs = await reports.live(
      await reports.agentScope(agentCtx('GS', 'G', 'SALES')),
      NOW,
    );
    expect(gs.scope).toBe('AGENT_OWN');
    expect(bucket(gs.periods, 'today')).toMatchObject({
      orders: 0,
      amounts: [],
    });
  });

  it('Performance (OWN over HTTP): own row only, payment mix per currency', async () => {
    const res = await get('A', `/sales-reports/performance?${RANGE}`).expect(
      200,
    );
    const body = res.body as PerformanceReport;
    expect(body.scope).toBe('OWN');
    expect(body.employees).toHaveLength(1);
    expect(body.ownRank).toEqual({ position: 1, of: 2 });
    expect(body.employees[0]).toMatchObject({
      rank: 1,
      userId: ids.A,
      orders: 5,
      valid: 4,
      cancelled: 1,
      returned: 1,
    });
    expect(body.teams).toBeNull();
    expect(body.agents).toBeNull();
    expect(body.paymentMix).toEqual([
      {
        currencyCode: cur1,
        prepaid: { count: 3, amount: 260 },
        cod: { count: 0, amount: 0 },
      },
      {
        currencyCode: cur2,
        prepaid: { count: 0, amount: 0 },
        cod: { count: 1, amount: 200 },
      },
    ]);
  });

  it('Performance (ALL): ranked by count, by amount within one currency, agents as a separate row', async () => {
    const byCount = (
      await get('ALL', `/sales-reports/performance?${RANGE}`).expect(200)
    ).body as PerformanceReport;
    const order = (report: PerformanceReport) =>
      report.employees
        .filter((row) => row.userId === ids.A || row.userId === ids.B)
        .map((row) => row.userId);
    expect(order(byCount)).toEqual([ids.A, ids.B]);
    expect(byCount.employees.some((row) => row.userId === ids.GA)).toBe(false);
    expect(mine(byCount.agents?.amounts ?? [])).toEqual([
      { currencyCode: cur1, amount: 377 },
    ]);
    expect(byCount.teams?.find((team) => team.teamId === teamId)).toMatchObject(
      {
        valid: 4,
        manager: { userId: ids.M },
        members: [{ userId: ids.A }],
      },
    );

    const byAmount = (
      await get(
        'ALL',
        `/sales-reports/performance?${RANGE}&rankBy=amount&currency=${cur1}`,
      ).expect(200)
    ).body as PerformanceReport;
    expect(order(byAmount)).toEqual([ids.B, ids.A]);
    const b = byAmount.employees.find((row) => row.userId === ids.B);
    expect(b?.rankValue).toBe(500);

    await get(
      'ALL',
      `/sales-reports/performance?${RANGE}&rankBy=amount`,
    ).expect(400);
    await get(
      'ALL',
      '/sales-reports/performance?from=2021-03-10&to=2021-03-01',
    ).expect(400);
  });

  it('Performance (TEAM): manager sees the team member, never other employees or agents', async () => {
    const body = (
      await get('M', `/sales-reports/performance?${RANGE}`).expect(200)
    ).body as PerformanceReport;
    expect(body.scope).toBe('TEAM');
    expect(body.employees.map((row) => row.userId)).toEqual([ids.A]);
    expect(body.agents).toBeNull();
    expect(body.teams).toHaveLength(1);
    expect(body.teams?.[0]).toMatchObject({ teamId, orders: 5, valid: 4 });
  });

  it('Agent portal: agent A never sees agent B; no teams or agents rows', async () => {
    const ga = (
      await get(
        'GA',
        `/agent-portal/sales-reports/performance?${RANGE}`,
      ).expect(200)
    ).body as PerformanceReport;
    expect(ga.employees.map((row) => row.userId)).toEqual([ids.GA]);
    expect(ga.employees[0].amounts).toEqual([
      { currencyCode: cur1, amount: 300 },
    ]);
    expect(ga.teams).toBeNull();
    expect(ga.agents).toBeNull();
    const ha = (
      await get(
        'HA',
        `/agent-portal/sales-reports/performance?${RANGE}`,
      ).expect(200)
    ).body as PerformanceReport;
    expect(ha.employees.map((row) => row.userId)).toEqual([ids.HA]);
    const gs = (
      await get(
        'GS',
        `/agent-portal/sales-reports/performance?${RANGE}`,
      ).expect(200)
    ).body as PerformanceReport;
    expect(gs.employees).toEqual([]);
    await get('GA', '/agent-portal/sales-reports/live').expect(200);
  });

  it('gates: permission required; agent and company tokens never cross', async () => {
    await get('NOREPORT', '/sales-reports/live').expect(403);
    await get('GA', '/sales-reports/live').expect(403);
    await get('A', '/agent-portal/sales-reports/live').expect(403);
    await get('A', '/sales-reports/live').expect(200);
  });
});
