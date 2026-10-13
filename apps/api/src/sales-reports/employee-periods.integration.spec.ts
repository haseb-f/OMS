import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import type { Server } from 'http';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { ProductType } from '@prisma/client';
import { UserSessionsService } from '../auth/sessions/user-sessions.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { AuthModule } from '../auth/auth.module';
import { SalesScopeModule } from '../sales-scope/sales-scope.module';
import { AllExceptionsFilter } from '../common/errors/all-exceptions.filter';
import { formatValidationErrors } from '../common/errors/format-validation-errors';
import type { AgentRequestContext } from '../auth/guards/jwt-auth.guard';
import type { CompanyReportScope } from '../sales-scope/sales-report-scope';
import { SalesReportsModule } from './sales-reports.module';
import {
  SalesReportsService,
  type EmployeePeriodsReport,
  type EmployeePeriodsRow,
  type PeriodStats,
} from './sales-reports.service';
import { LIVE_PERIODS, livePeriodRanges } from './sales-metrics';

/**
 * R20 §B — employee performance by period over the real HTTP pipeline and the
 * local Postgres. Proves:
 * - the five boxes of every employee EQUAL the Live report of that employee
 *   alone (same scope type, same Cairo period bounds, same tally) — incl. the
 *   boundaries (Cairo midnight, "last 7 days" = today + the 6 previous days,
 *   month edges), cancelled (counted apart, no amount), returned (still a
 *   sale), deleted (never) and currencies (never added together);
 * - the rank equals the Employees ranking for "this month" (count);
 * - pagination by employee (no duplicates, rank order, total);
 * - scope isolation: OWN = own card (+ own company rank) even without orders,
 *   TEAM = own + members, ALL = every company employee + the separate
 *   unassigned / agents rows, agent admin = own agent only, agent sales = own
 *   only, other agents never, tokens never cross.
 */
describe('Sales reports — employee periods (HTTP + DB)', () => {
  jest.setTimeout(120_000);

  let moduleRef: TestingModule;
  let app: INestApplication;
  let http: Server;
  let prisma: PrismaService;
  let sessionTokens: UserSessionsService;
  let resolver: PermissionsResolverService;
  let reports: SalesReportsService;

  const tag = randomUUID().slice(0, 6).toUpperCase();
  const cur1 = `B1${tag}`;
  const cur2 = `B2${tag}`;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const agentIds: string[] = [];
  const partnerIds: string[] = [];
  const currencyIds: string[] = [];
  const profileIds: string[] = [];
  let teamId: string;
  let productId: string;
  let categoryId: string;
  let unitId: string;
  let partnerId: string;
  const status: Record<string, string> = {};

  // 2022-03-10 12:00 Cairo (UTC+2, no DST in 2022). Last 7 days = 4..10 March.
  const NOW = new Date('2022-03-10T10:00:00Z');

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
        email: `r20b-${key.toLowerCase()}-${tag.toLowerCase()}@example.test`,
        username: `r20b-${key.toLowerCase()}-${tag.toLowerCase()}`,
        fullName: `R20B ${key} ${tag}`,
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
    tokens[key] = await sessionTokens.issueAccessToken(
      agent
        ? {
            sub: user.id,
            email: user.email,
            typ: 'agent',
            agentId: agent.agentId,
          }
        : { sub: user.id, email: user.email },
    );
    await grant(user.id, permissions);
  }

  async function makeAgent(key: string) {
    const partner = await prisma.partner.create({
      data: {
        name: `R20B Agent ${key} ${tag}`,
        partnerNumber: `R20B-${key}-${tag}`,
      },
    });
    partnerIds.push(partner.id);
    const agent = await prisma.agent.create({
      data: {
        agentNumber: `R20B-${key}-${tag}`,
        partnerId: partner.id,
        name: `R20B Agent ${key} ${tag}`,
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
    orderDate: string | Date;
    status?: string;
    payableTotal: number;
    agentId?: string;
    deleted?: boolean;
  }) {
    seq += 1;
    const created = await prisma.storeOrder.create({
      data: {
        internalOrderId: `R20B-${tag}-${seq}`,
        partnerId,
        orderDate: new Date(o.orderDate),
        employeeId: o.owner,
        agentId: o.agentId ?? null,
        currencyId: o.currency === cur1 ? currencyIds[0] : currencyIds[1],
        payableTotal: o.payableTotal,
        paymentType: 'PREPAID',
        fulfillmentStatusId: o.status ? status[o.status] : null,
        deletedAt: o.deleted ? new Date() : null,
        items: {
          create: [
            {
              productId,
              quantity: 1,
              unitPrice: o.payableTotal,
              agreedAmount: o.payableTotal,
            },
          ],
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
        data: { code, name: `R20B ${code}` },
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
      await prisma.productCategory.create({ data: { name: `R20B Cat ${tag}` } })
    ).id;
    unitId = (await prisma.unit.create({ data: { name: `R20B Unit ${tag}` } }))
      .id;
    productId = (
      await prisma.product.create({
        data: {
          name: `R20B Product ${tag}`,
          internalName: `R20B Product ${tag}`,
          displayName: `R20B Product ${tag}`,
          sku: `R20B-${tag}`,
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
      data: { name: `R20B Customer ${tag}`, partnerNumber: `R20B-C-${tag}` },
    });
    partnerId = partner.id;
    partnerIds.push(partner.id);

    const seller = ['store-orders.view', 'reports.sales.view'];
    for (const key of ['A', 'B', 'C', 'D', 'M']) await makeUser(key, seller);
    await makeUser('ALL', [...seller, 'reports.sales.view_all']);
    await makeUser('NOREPORT', ['store-orders.view']);
    // A has an HR profile (employee code); everyone else shows the username.
    const profilePartner = await prisma.partner.create({
      data: { name: `R20B Emp A ${tag}`, partnerNumber: `R20B-E-${tag}` },
    });
    partnerIds.push(profilePartner.id);
    profileIds.push(
      (
        await prisma.employeeProfile.create({
          data: {
            partnerId: profilePartner.id,
            userId: ids.A,
            employeeCode: `R20B-EMP-${tag}`,
          },
        })
      ).id,
    );
    const department = await prisma.department.findFirstOrThrow();
    teamId = (
      await prisma.salesTeam.create({
        data: {
          code: `R20B-T-${tag}`,
          name: `R20B Team ${tag}`,
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

    const today = '2022-03-10T09:00:00Z';
    const A = (orderDate: string, payableTotal: number, extra = {}) =>
      makeOrder({
        owner: ids.A,
        currency: cur1,
        orderDate,
        payableTotal,
        ...extra,
      });
    await A(today, 150, { status: 'DELIVERED' });
    await makeOrder({
      owner: ids.A,
      currency: cur2,
      orderDate: today,
      payableTotal: 200,
    });
    await A(today, 999, { status: 'CANCELLED' });
    await A('2022-03-09T21:30:00Z', 40, { status: 'RETURNED' }); // 23:30 Cairo 9 Mar — yesterday
    await A('2022-03-09T22:30:00Z', 70, { status: 'DELIVERED' }); // 00:30 Cairo 10 Mar — today
    await A(today, 5000, { status: 'DELIVERED', deleted: true });
    await A('2022-03-04T10:00:00Z', 10); // 6 days ago — inside the last 7 days
    await A('2022-03-03T22:00:00Z', 2); // exactly 00:00 Cairo 4 Mar — first instant of the last 7 days
    await A('2022-03-03T21:59:00Z', 20); // 23:59 Cairo 3 Mar — this month, not last 7 days
    await A('2022-03-01T00:30:00Z', 6); // 02:30 Cairo 1 Mar — this month
    await A('2022-02-28T21:30:00Z', 5); // 23:30 Cairo 28 Feb — last month
    // B: today + last month. C: last month only (listed, not ranked this month).
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
      orderDate: '2022-02-15T10:00:00Z',
      payableTotal: 30,
    });
    await makeOrder({
      owner: ids.C,
      currency: cur2,
      orderDate: '2022-02-10T10:00:00Z',
      payableTotal: 80,
    });
    // No owner (company) and agents.
    await makeOrder({
      owner: null,
      currency: cur1,
      orderDate: today,
      payableTotal: 11,
    });
    await makeOrder({
      owner: ids.GA,
      agentId: ids.G,
      currency: cur1,
      orderDate: today,
      payableTotal: 300,
    });
    await makeOrder({
      owner: ids.HA,
      agentId: ids.H,
      currency: cur1,
      orderDate: today,
      payableTotal: 77,
    });
    // Real "now" orders for the HTTP scope checks (the endpoints use the clock).
    const now = new Date(Date.now() - 60_000);
    await makeOrder({
      owner: ids.A,
      currency: cur1,
      orderDate: now,
      payableTotal: 1,
    });
    await makeOrder({
      owner: ids.GA,
      agentId: ids.G,
      currency: cur1,
      orderDate: now,
      payableTotal: 3,
    });
    await makeOrder({
      owner: ids.HA,
      agentId: ids.H,
      currency: cur1,
      orderDate: now,
      payableTotal: 7,
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.storeOrderItem.deleteMany({
        where: { storeOrderId: { in: orderIds } },
      });
      await prisma.storeOrder.deleteMany({ where: { id: { in: orderIds } } });
      if (teamId) await prisma.salesTeam.delete({ where: { id: teamId } });
      await prisma.employeeProfile.deleteMany({
        where: { id: { in: profileIds } },
      });
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

  const mine = (amounts: Array<{ currencyCode: string; amount: number }>) =>
    amounts.filter((a) => a.currencyCode === cur1 || a.currencyCode === cur2);
  const box = (row: EmployeePeriodsRow | PeriodStats[], period: string) =>
    (Array.isArray(row) ? row : row.periods).find(
      (entry) => entry.period === period,
    ) as PeriodStats;
  const ownScope = (userId: string): CompanyReportScope => ({
    audience: 'company',
    label: 'OWN',
    userId,
    ownerIds: [userId],
  });
  /** Every page of a scope (pageSize 1 → one employee per page). */
  async function allPages(
    scope: Parameters<SalesReportsService['employeePeriods']>[0],
    pageSize: number,
  ): Promise<EmployeePeriodsReport[]> {
    const pages: EmployeePeriodsReport[] = [];
    for (let page = 1; ; page += 1) {
      const report = await reports.employeePeriods(
        scope,
        { page, pageSize },
        NOW,
      );
      pages.push(report);
      if (page * pageSize >= report.total) return pages;
    }
  }

  it('boundaries: the five Live periods, last 7 days includes today', async () => {
    const report = await reports.employeePeriods(
      await reports.companyScope(ids.A),
      {},
      NOW,
    );
    expect(report.periods).toEqual([
      { period: 'today', from: '2022-03-10', to: '2022-03-10' },
      { period: 'yesterday', from: '2022-03-09', to: '2022-03-09' },
      { period: 'last7Days', from: '2022-03-04', to: '2022-03-10' },
      { period: 'thisMonth', from: '2022-03-01', to: '2022-03-10' },
      { period: 'lastMonth', from: '2022-02-01', to: '2022-02-28' },
    ]);
    expect(report.periods).toEqual(
      livePeriodRanges(NOW).map(({ period, from, to }) => ({
        period,
        from,
        to,
      })),
    );
    expect(report.rankPeriod).toBe('thisMonth');
  });

  it('values: exact counts and per-currency sums per period (OWN A)', async () => {
    const report = await reports.employeePeriods(
      await reports.companyScope(ids.A),
      {},
      NOW,
    );
    expect(report.scope).toBe('OWN');
    expect(report.employees).toHaveLength(1);
    const a = report.employees[0];
    expect(a).toMatchObject({ userId: ids.A, reference: `R20B-EMP-${tag}` });
    expect(a.periods.map((entry) => entry.period)).toEqual([...LIVE_PERIODS]);
    expect(box(a, 'today')).toMatchObject({
      orders: 4,
      valid: 3,
      cancelled: 1,
      returned: 0,
    });
    expect(box(a, 'today').amounts).toEqual([
      { currencyCode: cur1, amount: 220 },
      { currencyCode: cur2, amount: 200 },
    ]);
    expect(box(a, 'yesterday')).toMatchObject({
      orders: 1,
      valid: 1,
      returned: 1,
    });
    expect(box(a, 'yesterday').amounts).toEqual([
      { currencyCode: cur1, amount: 40 },
    ]);
    expect(box(a, 'last7Days')).toMatchObject({
      orders: 7,
      valid: 6,
      cancelled: 1,
      returned: 1,
    });
    expect(box(a, 'last7Days').amounts).toEqual([
      { currencyCode: cur1, amount: 272 },
      { currencyCode: cur2, amount: 200 },
    ]);
    expect(box(a, 'thisMonth')).toMatchObject({ orders: 9, valid: 8 });
    expect(box(a, 'thisMonth').amounts).toEqual([
      { currencyCode: cur1, amount: 298 },
      { currencyCode: cur2, amount: 200 },
    ]);
    expect(box(a, 'lastMonth')).toMatchObject({ orders: 1, valid: 1 });
    expect(box(a, 'lastMonth').amounts).toEqual([
      { currencyCode: cur1, amount: 5 },
    ]);
  });

  it('proof: every box equals the Live report of that employee alone (ALL, every page)', async () => {
    const scope = await reports.companyScope(ids.ALL);
    expect(scope.label).toBe('ALL');
    const pages = await allPages(scope, 1);
    const rows = pages.flatMap((page) => page.employees);
    for (const key of ['A', 'B', 'C']) {
      expect(rows.some((row) => row.userId === ids[key])).toBe(true);
    }
    // Agent employees never appear in the company list.
    expect(rows.some((row) => row.userId === ids.GA)).toBe(false);
    for (const row of rows) {
      const live = await reports.live(ownScope(row.userId), NOW);
      for (const period of LIVE_PERIODS) {
        const liveBucket = live.periods.find(
          (entry) => entry.period === period,
        )!;
        const expected: PeriodStats = {
          period,
          orders: liveBucket.orders,
          valid: liveBucket.valid,
          cancelled: liveBucket.cancelled,
          returned: liveBucket.returned,
          amounts: liveBucket.amounts,
        };
        expect({ user: row.name, ...box(row, period) }).toEqual({
          user: row.name,
          ...expected,
        });
      }
    }
  });

  it('rank = the Employees ranking for this month; pagination keeps rank order', async () => {
    const scope = await reports.companyScope(ids.ALL);
    const pages = await allPages(scope, 1);
    const rows = pages.flatMap((page) => page.employees);
    expect(pages.every((page) => page.employees.length === 1)).toBe(true);
    expect(new Set(rows.map((row) => row.userId)).size).toBe(rows.length);
    expect(rows.length).toBe(pages[0].total);
    const month = livePeriodRanges(NOW).find(
      (range) => range.period === 'thisMonth',
    )!;
    const ranking = await reports.employeeRanking(scope, month, 'count', null);
    const rankOf = new Map(
      ranking.employees.map((entry) => [entry.userId, entry.rank]),
    );
    for (const row of rows)
      expect(row.rank).toBe(rankOf.get(row.userId) ?? null);
    // Ranked first (ascending), then the unranked (no order this month).
    const ranks = rows.map((row) => row.rank);
    const firstUnranked = ranks.indexOf(null);
    const ranked = firstUnranked < 0 ? ranks : ranks.slice(0, firstUnranked);
    expect(ranked).toEqual([...ranked].sort((x, y) => (x ?? 0) - (y ?? 0)));
    if (firstUnranked >= 0) {
      expect(ranks.slice(firstUnranked).every((rank) => rank === null)).toBe(
        true,
      );
    }
    const a = rows.find((row) => row.userId === ids.A)!;
    const b = rows.find((row) => row.userId === ids.B)!;
    const c = rows.find((row) => row.userId === ids.C)!;
    expect(a.rank).toBeLessThan(b.rank!);
    expect(c.rank).toBeNull();
    expect(box(c, 'lastMonth').amounts).toEqual([
      { currencyCode: cur2, amount: 80 },
    ]);
    expect(b.reference).toBe(`r20b-b-${tag.toLowerCase()}`);
  });

  it('ALL: unassigned and agents are separate period rows, never employees', async () => {
    const report = await reports.employeePeriods(
      await reports.companyScope(ids.ALL),
      { pageSize: 50 },
      NOW,
    );
    expect(mine(box(report.unassigned!, 'today').amounts)).toEqual([
      { currencyCode: cur1, amount: 11 },
    ]);
    expect(mine(box(report.agents!, 'today').amounts)).toEqual([
      { currencyCode: cur1, amount: 377 },
    ]);
    expect(report.unassigned!.map((entry) => entry.period)).toEqual([
      ...LIVE_PERIODS,
    ]);
  });

  it('OWN: own card even without orders, own company rank, nobody else', async () => {
    const b = await reports.employeePeriods(
      await reports.companyScope(ids.B),
      {},
      NOW,
    );
    expect(b.employees.map((row) => row.userId)).toEqual([ids.B]);
    expect(b.total).toBe(1);
    expect(b.unassigned).toBeNull();
    expect(b.agents).toBeNull();
    expect(b.employees[0].rank).toBe(b.ownRank.position);
    expect(b.ownRank.position).toBeGreaterThan(1); // A sold more this month
    const d = await reports.employeePeriods(
      await reports.companyScope(ids.D),
      {},
      NOW,
    );
    expect(d.employees).toHaveLength(1);
    expect(d.employees[0]).toMatchObject({ userId: ids.D, rank: null });
    expect(d.employees[0].periods.every((entry) => entry.orders === 0)).toBe(
      true,
    );
    expect(d.ownRank.position).toBeNull();
  });

  it('TEAM: the manager sees own + members only', async () => {
    const m = await reports.employeePeriods(
      await reports.companyScope(ids.M),
      {},
      NOW,
    );
    expect(m.scope).toBe('TEAM');
    expect(m.employees.map((row) => row.userId)).toEqual([ids.A]);
    expect(m.total).toBe(1);
    expect(m.employees[0].rank).toBe(1);
    expect(m.agents).toBeNull();
    expect(m.unassigned).toBeNull();
  });

  it('agents: admin sees its agent only, sales its own only', async () => {
    const ctx = (
      key: string,
      agent: string,
      role: 'ADMIN' | 'SALES',
    ): AgentRequestContext => ({
      userId: ids[key],
      agentId: ids[agent],
      agentRole: role,
    });
    const ga = await reports.employeePeriods(
      await reports.agentScope(ctx('GA', 'G', 'ADMIN')),
      {},
      NOW,
    );
    expect(ga.scope).toBe('AGENT_ALL');
    expect(ga.employees.map((row) => row.userId)).toEqual([ids.GA]);
    expect(box(ga.employees[0], 'today').amounts).toEqual([
      { currencyCode: cur1, amount: 300 },
    ]);
    const gs = await reports.employeePeriods(
      await reports.agentScope(ctx('GS', 'G', 'SALES')),
      {},
      NOW,
    );
    expect(gs.scope).toBe('AGENT_OWN');
    expect(gs.employees.map((row) => row.userId)).toEqual([ids.GS]);
    expect(gs.employees[0].periods.every((entry) => entry.orders === 0)).toBe(
      true,
    );
  });

  it('HTTP: scopes, isolation and validation on the real clock', async () => {
    const body = async (who: string, path: string) =>
      (await get(who, path).expect(200)).body as EmployeePeriodsReport;
    const a = await body('A', '/sales-reports/employee-periods');
    expect(a.scope).toBe('OWN');
    expect(a.employees.map((row) => row.userId)).toEqual([ids.A]);
    expect(mine(box(a.employees[0], 'today').amounts)).toEqual([
      { currencyCode: cur1, amount: 1 },
    ]);
    expect(a.unassigned).toBeNull();

    const m = await body('M', '/sales-reports/employee-periods');
    expect(m.scope).toBe('TEAM');
    expect(m.employees.map((row) => row.userId)).toEqual([ids.A]);

    const seen: string[] = [];
    for (let page = 1; ; page += 1) {
      const all = await body(
        'ALL',
        `/sales-reports/employee-periods?page=${page}&pageSize=50`,
      );
      expect(all.scope).toBe('ALL');
      expect(all.agents).not.toBeNull();
      seen.push(...all.employees.map((row) => row.userId));
      if (page * 50 >= all.total) break;
    }
    expect(seen).toContain(ids.A);
    expect(seen).not.toContain(ids.GA);
    expect(seen).not.toContain(ids.HA);

    const ga = await body('GA', '/agent-portal/sales-reports/employee-periods');
    expect(ga.employees.map((row) => row.userId)).toEqual([ids.GA]);
    expect(mine(box(ga.employees[0], 'today').amounts)).toEqual([
      { currencyCode: cur1, amount: 3 },
    ]);
    expect(ga.agents).toBeNull();
    const ha = await body('HA', '/agent-portal/sales-reports/employee-periods');
    expect(ha.employees.map((row) => row.userId)).toEqual([ids.HA]);
    const gs = await body('GS', '/agent-portal/sales-reports/employee-periods');
    expect(gs.employees.map((row) => row.userId)).toEqual([ids.GS]);

    await get('NOREPORT', '/sales-reports/employee-periods').expect(403);
    await get('GA', '/sales-reports/employee-periods').expect(403);
    await get('A', '/agent-portal/sales-reports/employee-periods').expect(403);
    await get('ALL', '/sales-reports/employee-periods?pageSize=51').expect(400);
    await get('ALL', '/sales-reports/employee-periods?page=0').expect(400);
  });
});
