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
import { LeadSource, ProductType } from '@prisma/client';
import { UserSessionsService } from '../auth/sessions/user-sessions.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { AuthModule } from '../auth/auth.module';
import { SalesScopeModule } from '../sales-scope/sales-scope.module';
import { SalesScopeService } from '../sales-scope/sales-scope.service';
import { SalesPerformanceModule } from '../sales-performance/sales-performance.module';
import { SalesPerformanceService } from '../sales-performance/sales-performance.service';
import { SalesTargetsModule } from '../sales-targets/sales-targets.module';
import { AllExceptionsFilter } from '../common/errors/all-exceptions.filter';
import { formatValidationErrors } from '../common/errors/format-validation-errors';
import { SalesReportsModule } from './sales-reports.module';
import {
  SalesReportsService,
  type LiveReport,
  type PerformanceReport,
} from './sales-reports.service';

/**
 * R15 W6 (D15-18, requirements 6.1–6.5) — sales-figure visibility on every
 * surface over the real HTTP pipeline and Postgres: `/sales-reports/*`,
 * `/agent-portal/sales-reports/*`, the home dashboard (`/sales/performance`)
 * and the HR ranking. Own scopes return own figures + own rank and never
 * another employee's id or name; browse keys (`store-orders.view_all`,
 * `crm.leads.manage`, `agent.records.view_all`) never widen figures; the
 * dashboard and the reports agree for the same user and period.
 *
 * Fixture (May 2021, Cairo = UTC+2): valid orders S2 5 · S1 3 (+1 cancelled)
 * · MGR 2 · S3 1 (+1 cancelled) · 1 unassigned; team T = {S1, S2} managed by
 * MGR; team T2 = {S3} managed by MGR2, who also holds `store-orders.view_all`;
 * agent G: GSALES 2 · GADMIN 1 · GVIEW 1; agent H: HADMIN 3.
 */
describe('Sales report visibility (HTTP + DB)', () => {
  jest.setTimeout(120_000);

  let moduleRef: TestingModule;
  let app: INestApplication;
  let http: Server;
  let prisma: PrismaService;
  let sessionTokens: UserSessionsService;
  let resolver: PermissionsResolverService;
  let reports: SalesReportsService;
  let salesScope: SalesScopeService;
  let dashboard: SalesPerformanceService;

  const tag = randomUUID().slice(0, 6).toUpperCase();
  const ids: Record<string, string> = {};
  const names: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const leadIds: string[] = [];
  const agentIds: string[] = [];
  const partnerIds: string[] = [];
  let currencyId: string;
  let teamId: string;
  let team2Id: string;
  let productId: string;
  let categoryId: string;
  let unitId: string;
  let customerId: string;
  const status: Record<string, string> = {};

  // 2021-05-20 is a Thursday; 12:00 Cairo.
  const NOW = new Date('2021-05-20T10:00:00Z');
  const TODAY = '2021-05-20T09:00:00Z';
  const RANGE = 'from=2021-05-01&to=2021-05-20';
  const SELLER = ['crm.leads.view', 'store-orders.view', 'reports.sales.view'];

  const get = (who: string, path: string) =>
    request(http).get(path).set('Authorization', `Bearer ${tokens[who]}`);

  async function grant(userId: string, permissions: string[]) {
    for (const name of permissions) {
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
    options: {
      agent?: { agentId: string; role: 'ADMIN' | 'SALES' };
      superAdmin?: boolean;
    } = {},
  ) {
    const { agent } = options;
    names[key] = `R15V-${key}-${tag}`;
    const user = await prisma.user.create({
      data: {
        email: `r15v-${key.toLowerCase()}-${tag.toLowerCase()}@example.test`,
        username: `r15v-${key.toLowerCase()}-${tag.toLowerCase()}`,
        fullName: names[key],
        passwordHash: 'x',
        isSuperAdmin: options.superAdmin ?? false,
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
        name: `R15V Agent ${key} ${tag}`,
        partnerNumber: `R15V-${key}-${tag}`,
      },
    });
    partnerIds.push(partner.id);
    const agent = await prisma.agent.create({
      data: {
        agentNumber: `R15V-${key}-${tag}`,
        partnerId: partner.id,
        name: `R15V Agent ${key} ${tag}`,
        currencyId,
      },
    });
    agentIds.push(agent.id);
    ids[key] = agent.id;
  }

  let seq = 0;
  async function makeOrders(
    count: number,
    o: {
      owner: string | null;
      orderDate: string;
      status?: string;
      agentId?: string;
    },
  ) {
    for (let i = 0; i < count; i += 1) {
      seq += 1;
      const created = await prisma.storeOrder.create({
        data: {
          internalOrderId: `R15V-${tag}-${seq}`,
          partnerId: customerId,
          orderDate: new Date(o.orderDate),
          employeeId: o.owner,
          agentId: o.agentId ?? null,
          currencyId,
          payableTotal: 100,
          paymentType: 'PREPAID',
          fulfillmentStatusId: o.status ? status[o.status] : null,
          items: {
            create: [
              { productId, quantity: 1, unitPrice: 100, agreedAmount: 100 },
            ],
          },
        },
      });
      orderIds.push(created.id);
    }
  }

  async function makeLead(owner: string | null, createdAt: string) {
    seq += 1;
    const [country, lead] = await Promise.all([
      prisma.country.findFirstOrThrow({ select: { id: true } }),
      prisma.statusDefinition.findFirstOrThrow({
        where: { workflowType: 'LEAD', code: 'NEW', deletedAt: null },
        select: { id: true },
      }),
    ]);
    const created = await prisma.lead.create({
      data: {
        leadNumber: `R15V-L-${tag}-${seq}`,
        customerName: `R15V Lead ${seq}`,
        mobileNumber: `+2010${String(seq).padStart(8, '0')}`,
        countryId: country.id,
        currencyId,
        quantity: 1,
        statusId: lead.id,
        source: LeadSource.MANUAL,
        salesEmployeeId: owner,
        createdAt: new Date(createdAt),
      },
    });
    leadIds.push(created.id);
  }

  /** Every fixture person except `self` — none of them may appear in an own-scope response. */
  function othersOf(self: string, keys: string[]) {
    return keys
      .filter((key) => key !== self)
      .flatMap((key) => [ids[key], names[key]]);
  }
  const COMPANY = [
    'S1',
    'S2',
    'S3',
    'MGR',
    'MGR2',
    'VIEWALL',
    'LEADMGR',
    'BROWSE',
  ];
  const AGENT_G = ['GADMIN', 'GSALES', 'GVIEW'];

  function expectNoneOf(body: unknown, leaked: string[]) {
    const json = JSON.stringify(body);
    for (const value of leaked) expect(json).not.toContain(value);
  }

  const agentCtx = (key: string, agent: string, role: 'ADMIN' | 'SALES') => ({
    userId: ids[key],
    agentId: ids[agent],
    agentRole: role,
  });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        AuthModule,
        SalesScopeModule,
        SalesReportsModule,
        SalesPerformanceModule,
        SalesTargetsModule,
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
    salesScope = moduleRef.get(SalesScopeService);
    dashboard = moduleRef.get(SalesPerformanceService);

    currencyId = (
      await prisma.currency.create({
        data: { code: `V${tag}`, name: `R15V ${tag}` },
      })
    ).id;
    for (const code of ['DELIVERED', 'CANCELLED']) {
      status[code] = (
        await prisma.statusDefinition.findFirstOrThrow({
          where: { workflowType: 'FULFILLMENT', code, deletedAt: null },
        })
      ).id;
    }
    categoryId = (
      await prisma.productCategory.create({ data: { name: `R15V Cat ${tag}` } })
    ).id;
    unitId = (await prisma.unit.create({ data: { name: `R15V Unit ${tag}` } }))
      .id;
    productId = (
      await prisma.product.create({
        data: {
          name: `R15V Product ${tag}`,
          internalName: `R15V Product ${tag}`,
          displayName: `R15V Product ${tag}`,
          sku: `R15V-${tag}`,
          categoryId,
          unitId,
          type: ProductType.SERVICE,
          isPurchasable: false,
          isSellable: true,
          isInventoryItem: false,
        },
      })
    ).id;
    const customer = await prisma.partner.create({
      data: { name: `R15V Customer ${tag}`, partnerNumber: `R15V-C-${tag}` },
    });
    customerId = customer.id;
    partnerIds.push(customer.id);

    await makeUser('S1', SELLER);
    await makeUser('S2', SELLER);
    await makeUser('S3', SELLER);
    await makeUser('MGR', SELLER);
    await makeUser('VIEWALL', [...SELLER, 'reports.sales.view_all']);
    // Browse / lead-management keys that used to widen reports.
    await makeUser('LEADMGR', [...SELLER, 'crm.leads.manage']);
    await makeUser('BROWSE', [...SELLER, 'store-orders.view_all']);
    // A team manager who may also browse every order: still the team only.
    await makeUser('MGR2', [...SELLER, 'store-orders.view_all']);
    await makeUser('HRUSER', ['hr.sales-targets.view']);
    await makeUser('NOPERM', []);
    await makeUser('SUPER', [], { superAdmin: true });
    const department = await prisma.department.findFirstOrThrow();
    teamId = (
      await prisma.salesTeam.create({
        data: {
          code: `R15V-T-${tag}`,
          name: `R15V Team ${tag}`,
          departmentId: department.id,
          managerId: ids.MGR,
          members: { create: [{ userId: ids.S1 }, { userId: ids.S2 }] },
        },
      })
    ).id;
    team2Id = (
      await prisma.salesTeam.create({
        data: {
          code: `R15V-T2-${tag}`,
          name: `R15V Team 2 ${tag}`,
          departmentId: department.id,
          managerId: ids.MGR2,
          members: { create: [{ userId: ids.S3 }] },
        },
      })
    ).id;

    await makeAgent('G');
    await makeAgent('H');
    const portal = ['agent.dashboard.view'];
    await makeUser(
      'GADMIN',
      [...portal, 'agent.records.view_all', 'agent.reports.view_team'],
      {
        agent: { agentId: ids.G, role: 'ADMIN' },
      },
    );
    await makeUser('GSALES', portal, {
      agent: { agentId: ids.G, role: 'SALES' },
    });
    // A sales user delegated "view every record" — still own figures only.
    await makeUser('GVIEW', [...portal, 'agent.records.view_all'], {
      agent: { agentId: ids.G, role: 'SALES' },
    });
    await makeUser('HADMIN', [...portal, 'agent.reports.view_team'], {
      agent: { agentId: ids.H, role: 'ADMIN' },
    });

    const may10 = '2021-05-10T09:00:00Z';
    await makeOrders(3, {
      owner: ids.S2,
      orderDate: TODAY,
      status: 'DELIVERED',
    });
    await makeOrders(2, { owner: ids.S2, orderDate: may10 });
    await makeOrders(1, {
      owner: ids.S1,
      orderDate: TODAY,
      status: 'DELIVERED',
    });
    await makeOrders(1, {
      owner: ids.S1,
      orderDate: TODAY,
      status: 'CANCELLED',
    });
    await makeOrders(2, { owner: ids.S1, orderDate: may10 });
    await makeOrders(2, { owner: ids.MGR, orderDate: '2021-05-12T09:00:00Z' });
    await makeOrders(1, { owner: ids.S3, orderDate: TODAY });
    await makeOrders(1, {
      owner: ids.S3,
      orderDate: may10,
      status: 'CANCELLED',
    });
    await makeOrders(1, { owner: null, orderDate: TODAY });
    await makeOrders(2, {
      owner: ids.GSALES,
      agentId: ids.G,
      orderDate: TODAY,
    });
    await makeOrders(1, {
      owner: ids.GADMIN,
      agentId: ids.G,
      orderDate: TODAY,
    });
    await makeOrders(1, { owner: ids.GVIEW, agentId: ids.G, orderDate: may10 });
    await makeOrders(3, {
      owner: ids.HADMIN,
      agentId: ids.H,
      orderDate: TODAY,
    });

    const may15 = '2021-05-15T09:00:00Z';
    await makeLead(ids.S1, may15);
    await makeLead(ids.S2, may15);
    await makeLead(null, may15);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
      await prisma.storeOrderItem.deleteMany({
        where: { storeOrderId: { in: orderIds } },
      });
      await prisma.storeOrder.deleteMany({ where: { id: { in: orderIds } } });
      await prisma.salesTeam.deleteMany({
        where: { id: { in: [teamId, team2Id].filter(Boolean) } },
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
      await prisma.currency.deleteMany({ where: { id: currencyId } });
    }
    await app?.close();
  });

  // -------------------------------------------------------------------------
  // The one resolver
  // -------------------------------------------------------------------------

  it('resolver: only reports.sales.view_all / super admin widen; browse keys keep their list scope', async () => {
    const label = async (key: string) =>
      (await reports.companyScope(ids[key])).label;
    expect(await label('S1')).toBe('OWN');
    expect(await label('LEADMGR')).toBe('OWN');
    expect(await label('BROWSE')).toBe('OWN');
    expect(await label('VIEWALL')).toBe('ALL');
    expect(await label('SUPER')).toBe('ALL');
    const team = await reports.companyScope(ids.MGR);
    expect(team.label).toBe('TEAM');
    expect([...(team.ownerIds ?? [])].sort()).toEqual(
      [ids.MGR, ids.S1, ids.S2].sort(),
    );
    // Browsing every order never turns a team manager's report into ALL.
    const team2 = await reports.companyScope(ids.MGR2);
    expect(team2.label).toBe('TEAM');
    expect([...(team2.ownerIds ?? [])].sort()).toEqual(
      [ids.MGR2, ids.S3].sort(),
    );
    // The record (list / by-id) scope is untouched.
    expect((await salesScope.resolve(ids.LEADMGR)).kind).toBe('ALL');
    expect((await salesScope.resolve(ids.BROWSE)).canViewAllOrders).toBe(true);
    expect((await salesScope.resolve(ids.MGR2)).canViewAllOrders).toBe(true);

    const agentLabel = async (
      key: string,
      agent: string,
      role: 'ADMIN' | 'SALES',
    ) => (await reports.agentScope(agentCtx(key, agent, role))).label;
    expect(await agentLabel('GADMIN', 'G', 'ADMIN')).toBe('AGENT_ALL');
    expect(await agentLabel('GSALES', 'G', 'SALES')).toBe('AGENT_OWN');
    expect(await agentLabel('GVIEW', 'G', 'SALES')).toBe('AGENT_OWN');
  });

  // -------------------------------------------------------------------------
  // /sales-reports/*
  // -------------------------------------------------------------------------

  it('reports OWN: own row + company position only — no colleague anywhere in the JSON', async () => {
    const body = (
      await get('S1', `/sales-reports/performance?${RANGE}`).expect(200)
    ).body as PerformanceReport;
    expect(body.scope).toBe('OWN');
    expect(body.ownRank).toEqual({ position: 2, of: 4 });
    expect(body.employees).toHaveLength(1);
    expect(body.employees[0]).toMatchObject({
      userId: ids.S1,
      rank: 2,
      orders: 4,
      valid: 3,
      cancelled: 1,
    });
    expect(body.teams).toBeNull();
    expect(body.agents).toBeNull();
    expect(body.unassigned).toBeNull();
    expectNoneOf(body, othersOf('S1', [...COMPANY, ...AGENT_G]));

    const live = (await get('S1', '/sales-reports/live').expect(200))
      .body as LiveReport;
    expect(live.scope).toBe('OWN');
    // Live cards on the fixture day: S1's own two orders only.
    const fixed = await reports.live(await reports.companyScope(ids.S1), NOW);
    expect(fixed.periods.find((p) => p.period === 'today')).toMatchObject({
      orders: 2,
      valid: 1,
      cancelled: 1,
    });
  });

  it('reports: crm.leads.manage and store-orders.view_all alone do NOT widen (own figures, own rank)', async () => {
    for (const key of ['LEADMGR', 'BROWSE']) {
      const body = (
        await get(key, `/sales-reports/performance?${RANGE}`).expect(200)
      ).body as PerformanceReport;
      expect(body.scope).toBe('OWN');
      expect(body.employees).toEqual([]);
      expect(body.ownRank).toEqual({ position: null, of: 4 });
      expect(body.paymentMix).toEqual([]);
      expectNoneOf(body, othersOf(key, COMPANY));
    }
    const live = await reports.live(
      await reports.companyScope(ids.LEADMGR),
      NOW,
    );
    expect(live.periods.every((period) => period.orders === 0)).toBe(true);
  });

  it('reports TEAM: the team ranked within itself + own company position; never another employee', async () => {
    const body = (
      await get('MGR', `/sales-reports/performance?${RANGE}`).expect(200)
    ).body as PerformanceReport;
    expect(body.scope).toBe('TEAM');
    expect(body.employees.map((row) => [row.userId, row.rank])).toEqual([
      [ids.S2, 1],
      [ids.S1, 2],
      [ids.MGR, 3],
    ]);
    expect(body.ownRank).toEqual({ position: 3, of: 4 });
    expect(body.teams?.map((team) => team.teamId)).toEqual([teamId]);
    expect(body.agents).toBeNull();
    expect(body.unassigned).toBeNull();
    expectNoneOf(body, [
      ids.S3,
      names.S3,
      ids.MGR2,
      names.MGR2,
      ids.GSALES,
      names.GSALES,
    ]);
    // Live cards: the team's orders only (S2 3 + S1 2 today; no S3, no
    // unassigned, no agent order).
    const live = await reports.live(await reports.companyScope(ids.MGR), NOW);
    expect(live.periods.find((p) => p.period === 'today')).toMatchObject({
      orders: 5,
      valid: 4,
      cancelled: 1,
    });
  });

  it('reports TEAM + store-orders.view_all: still the team only (the browse key never widens figures)', async () => {
    const body = (
      await get('MGR2', `/sales-reports/performance?${RANGE}`).expect(200)
    ).body as PerformanceReport;
    expect(body.scope).toBe('TEAM');
    expect(body.employees.map((row) => row.userId)).toEqual([ids.S3]);
    expect(body.employees[0].rank).toBe(1);
    expect(body.teams?.map((team) => team.teamId)).toEqual([team2Id]);
    expect(body.ownRank).toEqual({ position: null, of: 4 });
    expect(body.unassigned).toBeNull();
    expectNoneOf(body, othersOf('MGR2', ['S1', 'S2', 'MGR', 'VIEWALL']));
  });

  it('reports ALL (reports.sales.view_all): everyone ranked, unassigned and agents as separate unranked rows', async () => {
    const body = (
      await get('VIEWALL', `/sales-reports/performance?${RANGE}`).expect(200)
    ).body as PerformanceReport;
    expect(body.scope).toBe('ALL');
    expect(body.employees.map((row) => [row.userId, row.rank])).toEqual([
      [ids.S2, 1],
      [ids.S1, 2],
      [ids.MGR, 3],
      [ids.S3, 4],
    ]);
    expect(body.employees.every((row) => row.userId !== null)).toBe(true);
    expect(body.unassigned).toMatchObject({ orders: 1, valid: 1 });
    expect(body.agents).toMatchObject({ orders: 7, valid: 7 });
    expect(body.ownRank).toEqual({ position: null, of: 4 });
    // Live cards: every company order (S2 3 + S1 2 + S3 1 + unassigned 1),
    // never an agent order.
    const live = await reports.live(
      await reports.companyScope(ids.VIEWALL),
      NOW,
    );
    expect(live.periods.find((p) => p.period === 'today')).toMatchObject({
      orders: 7,
      valid: 6,
    });
    // The own rank over the whole company equals the ALL table's rank.
    for (const key of ['S1', 'S2', 'S3', 'MGR']) {
      const own = (
        await get(key, `/sales-reports/performance?${RANGE}`).expect(200)
      ).body as PerformanceReport;
      const row = body.employees.find((entry) => entry.userId === ids[key]);
      expect(own.ownRank.position).toBe(row?.rank);
    }
    // By amount (within one currency) the same rule holds.
    const byAmount = `${RANGE}&rankBy=amount&currency=V${tag}`;
    const all = (
      await get('VIEWALL', `/sales-reports/performance?${byAmount}`).expect(200)
    ).body as PerformanceReport;
    const s3 = (
      await get('S3', `/sales-reports/performance?${byAmount}`).expect(200)
    ).body as PerformanceReport;
    expect(s3.ownRank.position).toBe(
      all.employees.find((row) => row.userId === ids.S3)?.rank,
    );
  });

  it('agent reports: view_team sees the agent team; records.view_all alone stays own; never another agent', async () => {
    const admin = (
      await get(
        'GADMIN',
        `/agent-portal/sales-reports/performance?${RANGE}`,
      ).expect(200)
    ).body as PerformanceReport;
    expect(admin.scope).toBe('AGENT_ALL');
    expect(admin.employees.map((row) => row.rank)).toEqual([1, 2, 2]);
    expect(admin.employees[0].userId).toBe(ids.GSALES);
    expect(new Set(admin.employees.map((row) => row.userId))).toEqual(
      new Set([ids.GSALES, ids.GADMIN, ids.GVIEW]),
    );
    expect(admin.ownRank).toEqual({ position: 2, of: 3 });
    expectNoneOf(admin, [ids.HADMIN, names.HADMIN, ids.S1, names.S1]);

    for (const [key, position] of [
      ['GVIEW', 2],
      ['GSALES', 1],
    ] as const) {
      const own = (
        await get(
          key,
          `/agent-portal/sales-reports/performance?${RANGE}`,
        ).expect(200)
      ).body as PerformanceReport;
      expect(own.scope).toBe('AGENT_OWN');
      expect(own.employees.map((row) => row.userId)).toEqual([ids[key]]);
      expect(own.ownRank).toEqual({ position, of: 3 });
      expect(own.employees[0].rank).toBe(position);
      expectNoneOf(own, othersOf(key, [...AGENT_G, 'HADMIN']));
    }
    const live = (
      await get('GVIEW', '/agent-portal/sales-reports/live').expect(200)
    ).body as LiveReport;
    expect(live.scope).toBe('AGENT_OWN');

    const h = (
      await get(
        'HADMIN',
        `/agent-portal/sales-reports/performance?${RANGE}`,
      ).expect(200)
    ).body as PerformanceReport;
    expect(h.employees.map((row) => row.userId)).toEqual([ids.HADMIN]);
    expectNoneOf(
      h,
      AGENT_G.flatMap((key) => [ids[key], names[key]]),
    );
  });

  it('report gates: reports.sales.view required; agent and company tokens never cross', async () => {
    await get('NOPERM', '/sales-reports/performance').expect(403);
    await get('HRUSER', '/sales-reports/live').expect(403);
    await get('GADMIN', '/sales-reports/live').expect(403);
    await get('S1', '/agent-portal/sales-reports/live').expect(403);
  });

  // -------------------------------------------------------------------------
  // Home dashboard — GET /sales/performance
  // -------------------------------------------------------------------------

  it('dashboard gate: NONE / HR-only users and agent tokens get 403, never a leaderboard', async () => {
    await get('NOPERM', '/sales/performance').expect(403);
    await get('HRUSER', '/sales/performance?period=today').expect(403);
    await get('GADMIN', '/sales/performance').expect(403);
    const own = await get('S1', '/sales/performance?period=week').expect(200);
    expect(own.body).toMatchObject({
      scope: 'OWN',
      ranking: { leaderboard: [] },
    });
    expectNoneOf(own.body, othersOf('S1', COMPANY));
  });

  it('dashboard OWN: own figures + "rank X of N"; browse keys stay own', async () => {
    const s1 = await dashboard.dashboard(ids.S1, 'month', NOW);
    expect(s1.scope).toBe('OWN');
    expect(s1.ranking).toEqual({
      self: { rank: 2, orders: 3, of: 4 },
      leaderboard: [],
    });
    expect(s1.kpis).toMatchObject({ orders: 4, delivered: 1, newLeads: 1 });
    expectNoneOf(s1, othersOf('S1', COMPANY));

    const today = await dashboard.dashboard(ids.S1, 'today', NOW);
    expect(today.ranking.self).toEqual({ rank: 2, orders: 1, of: 3 });

    for (const key of ['LEADMGR', 'BROWSE']) {
      const body = await dashboard.dashboard(ids[key], 'month', NOW);
      expect(body.scope).toBe('OWN');
      expect(body.kpis).toMatchObject({ orders: 0, delivered: 0, newLeads: 0 });
      expect(body.ranking).toEqual({
        self: { rank: null, orders: 0, of: 4 },
        leaderboard: [],
      });
      expectNoneOf(body, othersOf(key, COMPANY));
    }
  });

  it('dashboard TEAM / ALL: team leaderboard ranked within the team; company leaderboard only with view_all', async () => {
    const team = await dashboard.dashboard(ids.MGR, 'month', NOW);
    expect(team.scope).toBe('TEAM');
    expect(
      team.ranking.leaderboard.map((row) => [row.userId, row.rank, row.orders]),
    ).toEqual([
      [ids.S2, 1, 5],
      [ids.S1, 2, 3],
      [ids.MGR, 3, 2],
    ]);
    expect(team.ranking.self).toEqual({ rank: 3, orders: 2, of: 4 });
    expect(team.kpis.newLeads).toBe(2);
    expectNoneOf(team, [ids.S3, names.S3]);

    // store-orders.view_all used to widen the order KPIs: now the team only.
    const team2 = await dashboard.dashboard(ids.MGR2, 'month', NOW);
    expect(team2.scope).toBe('TEAM');
    expect(team2.kpis).toMatchObject({ orders: 2, delivered: 0, newLeads: 0 });
    expect(team2.ranking.leaderboard.map((row) => row.userId)).toEqual([
      ids.S3,
    ]);
    expectNoneOf(team2, othersOf('MGR2', ['S1', 'S2', 'MGR', 'VIEWALL']));

    const all = await dashboard.dashboard(ids.VIEWALL, 'month', NOW);
    expect(all.scope).toBe('ALL');
    expect(all.ranking.leaderboard.map((row) => row.userId)).toEqual([
      ids.S2,
      ids.S1,
      ids.MGR,
      ids.S3,
    ]);
    expect(all.kpis).toMatchObject({ orders: 14, delivered: 4, newLeads: 3 });
  });

  it('dashboard = reports for the same user and period (orderDate, Cairo days, same rank)', async () => {
    for (const key of ['S1', 'MGR', 'VIEWALL', 'LEADMGR', 'S3']) {
      const scope = await reports.companyScope(ids[key]);
      const live = await reports.live(scope, NOW);
      const bucket = (period: string) =>
        live.periods.find((entry) => entry.period === period);
      const performance = await reports.performance(
        scope,
        { from: '2021-05-01', to: '2021-05-20' },
        NOW,
      );
      const month = await dashboard.dashboard(ids[key], 'month', NOW);
      const today = await dashboard.dashboard(ids[key], 'today', NOW);
      expect(month.kpis.orders).toBe(bucket('thisMonth')?.orders);
      expect(today.kpis.orders).toBe(bucket('today')?.orders);
      expect(month.kpis.delivered).toBe(
        bucket('thisMonth')?.statusBreakdown.find(
          (row) => row.code === 'DELIVERED',
        )?.count ?? 0,
      );
      expect(month.ranking.self.rank).toBe(performance.ownRank.position);
      expect(month.ranking.self.of).toBe(performance.ownRank.of);
    }
  });

  // -------------------------------------------------------------------------
  // HR ranking — an HR screen (hr.sales-targets.view), documented exception
  // -------------------------------------------------------------------------

  it('HR ranking: hr.sales-targets.view only; a salesperson gets 403 there and only their own row from /me', async () => {
    await get('S1', '/sales-targets/ranking').expect(403);
    await get('HRUSER', '/sales-targets/ranking').expect(200);
    const me = await get('S1', '/sales-targets/me').expect(200);
    expect(JSON.stringify(me.body)).not.toContain('leaderboard');
  });
});
