/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- supertest response bodies are untyped JSON under assertion */
import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server } from 'http';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { ProductType, SalesDocumentStatus } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { SalesScopeModule } from '../sales-scope/sales-scope.module';
import { AllExceptionsFilter } from '../common/errors/all-exceptions.filter';
import { CustomerHistoryModule } from './customer-history.module';

/**
 * Round 14 (W4, spec-4 §3/§4) — `GET /customers/:partnerId/history` and the
 * repeat-customer numbers over the real HTTP pipeline on the local Postgres:
 * the caller's sales scope decides which orders are listed (another
 * employee's order is only counted), agent data never appears, the financial
 * section needs `finance.view` / `customers.view_financials`, and the counts
 * follow the one shared definition.
 */
describe('R14 customer history (HTTP)', () => {
  jest.setTimeout(120_000);

  let moduleRef: TestingModule;
  let app: INestApplication;
  let http: Server;
  let prisma: PrismaService;
  let jwt: JwtService;
  let resolver: PermissionsResolverService;

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const orderIds: string[] = [];
  const documentIds: string[] = [];
  let partnerId: string;
  let agentPartnerId: string;
  let agentId: string;
  let categoryId: string;
  let unitId: string;
  let productId: string;
  let currencyId: string;
  const order: Record<string, string> = {};
  const documentNumber: Record<string, string> = {};

  const auth = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const history = (who: string, id = partnerId) =>
    request(http).get(`/customers/${id}/history`).set(auth(who));
  const stats = (who: string, id = partnerId) =>
    request(http).get(`/customers/${id}/order-stats`).set(auth(who));

  async function makeUser(key: string, names: string[]) {
    const user = await prisma.user.create({
      data: {
        email: `r14h-${key}-${suffix}@example.test`,
        username: `r14h-${key}-${suffix}`,
        fullName: `R14 History ${key} ${suffix}`,
        passwordHash: 'x',
      },
    });
    userIds.push(user.id);
    ids[key] = user.id;
    tokens[key] = jwt.sign({ sub: user.id, email: user.email });
    for (const name of names) {
      const permission = await prisma.permission.upsert({
        where: { name },
        update: {},
        create: { name },
      });
      await prisma.userPermission.create({
        data: { userId: user.id, permissionId: permission.id },
      });
    }
    resolver.invalidate(user.id);
  }

  async function statusId(code: string) {
    return (
      await prisma.statusDefinition.findFirstOrThrow({
        where: { workflowType: 'FULFILLMENT', code },
      })
    ).id;
  }

  async function makeOrder(
    key: string,
    owner: string | null,
    fulfillment: string,
    daysAgo: number,
    agent: string | null = null,
  ) {
    const created = await prisma.storeOrder.create({
      data: {
        internalOrderId: `R14H-${suffix}-${key}`,
        partnerId: agent ? agentPartnerId : partnerId,
        currencyId,
        employeeId: owner,
        agentId: agent,
        orderDate: new Date(Date.now() - daysAgo * 86_400_000),
        fulfillmentStatusId: await statusId(fulfillment),
        items: {
          create: [{ productId, quantity: 2, unitPrice: 40, agreedAmount: 80 }],
        },
      },
    });
    orderIds.push(created.id);
    order[key] = created.id;
  }

  async function makeDocument(
    key: string,
    status: SalesDocumentStatus,
    createdBy: string,
  ) {
    const created = await prisma.salesOrderDocument.create({
      data: {
        orderNumber: `R14H-SO-${suffix}-${key}`,
        partnerId,
        status,
        createdBy,
        grandTotal: 500,
      },
    });
    documentIds.push(created.id);
    documentNumber[key] = created.orderNumber;
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        SalesScopeModule,
        CustomerHistoryModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    http = app.getHttpServer() as Server;
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
    resolver = moduleRef.get(PermissionsResolverService);

    currencyId = (
      await prisma.currency.findFirstOrThrow({ where: { deletedAt: null } })
    ).id;
    categoryId = (
      await prisma.productCategory.create({
        data: { name: `R14 History Category ${suffix}` },
      })
    ).id;
    unitId = (
      await prisma.unit.create({ data: { name: `R14 History Unit ${suffix}` } })
    ).id;
    const productName = `R14 History Product ${suffix}`;
    productId = (
      await prisma.product.create({
        data: {
          name: productName,
          internalName: productName,
          displayName: productName,
          sku: `R14-HIST-${suffix}`,
          categoryId,
          unitId,
          type: ProductType.SERVICE,
          isPurchasable: false,
          isSellable: true,
          isInventoryItem: false,
        },
      })
    ).id;

    const sales = ['partners.view', 'store-orders.view', 'crm.leads.view'];
    await makeUser('empA', [...sales, 'sales.orders.view']);
    await makeUser('empB', sales);
    await makeUser('viewFinancials', [...sales, 'customers.view_financials']);
    await makeUser('finance', [...sales, 'finance.view']);
    await makeUser('noPartners', ['store-orders.view']);

    partnerId = (
      await prisma.partner.create({
        data: {
          name: `R14 History Customer ${suffix}`,
          partnerNumber: `R14H-${suffix}`,
          roles: { create: { role: 'CUSTOMER' } },
        },
      })
    ).id;
    agentPartnerId = (
      await prisma.partner.create({
        data: {
          name: `R14 History Agent Customer ${suffix}`,
          partnerNumber: `R14H-AC-${suffix}`,
          roles: { create: { role: 'CUSTOMER' } },
        },
      })
    ).id;
    const agentCompany = await prisma.partner.create({
      data: {
        name: `R14 History Agent ${suffix}`,
        partnerNumber: `R14H-AG-${suffix}`,
      },
    });
    agentId = (
      await prisma.agent.create({
        data: {
          agentNumber: `R14H-${suffix}`,
          partnerId: agentCompany.id,
          name: `R14 History Agent ${suffix}`,
          currencyId,
        },
      })
    ).id;
    ids.agentCompany = agentCompany.id;

    // placed: A1, A2, B1 (A3 cancelled; the agent's order is the agent's business)
    // completed: A1 (DELIVERED), B1 (COLLECTED)
    await makeOrder('A1', ids.empA, 'DELIVERED', 30);
    await makeOrder('A2', ids.empA, 'UNFULFILLED', 2);
    await makeOrder('A3', ids.empA, 'CANCELLED', 10);
    await makeOrder('B1', ids.empB, 'COLLECTED', 5);
    // An agent order of the SAME customer record: never listed nor counted.
    const agentOrder = await prisma.storeOrder.create({
      data: {
        internalOrderId: `R14H-${suffix}-AGENT`,
        partnerId,
        currencyId,
        agentId,
        fulfillmentStatusId: await statusId('DELIVERED'),
      },
    });
    orderIds.push(agentOrder.id);
    order.AGENT = agentOrder.id;
    // An agent-only customer.
    await makeOrder('AGONLY', null, 'DELIVERED', 3, agentId);

    // B2B: D1 placed (empA), D2 DRAFT (not placed, empA), D3 delivered (empB).
    await makeDocument('D1', SalesDocumentStatus.CONFIRMED, ids.empA);
    await makeDocument('D2', SalesDocumentStatus.DRAFT, ids.empA);
    await makeDocument('D3', SalesDocumentStatus.DELIVERED, ids.empB);
  });

  afterAll(async () => {
    await prisma.salesOrderDocument.deleteMany({
      where: { id: { in: documentIds } },
    });
    await prisma.storeOrderItem.deleteMany({
      where: { storeOrderId: { in: orderIds } },
    });
    await prisma.storeOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.agent.deleteMany({ where: { id: agentId } });
    const partners = [partnerId, agentPartnerId, ids.agentCompany];
    await prisma.partnerRoleAssignment.deleteMany({
      where: { partnerId: { in: partners } },
    });
    await prisma.partner.deleteMany({ where: { id: { in: partners } } });
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

  it('lists only the orders the caller can open; another employee’s order is only counted', async () => {
    const res = await history('empA');
    expect(res.status).toBe(200);
    const body = res.body as {
      orders: { id: string; type: string; number: string }[];
      otherOrdersCount: number;
    };
    const listed = body.orders.map((o) => o.number).sort();
    expect(listed).toEqual(
      [
        `R14H-${suffix}-A1`,
        `R14H-${suffix}-A2`,
        `R14H-${suffix}-A3`,
        documentNumber.D1,
        documentNumber.D2,
      ].sort(),
    );
    // B1 (empB's store order) + D3 (empB's sales order) are counted, never listed.
    expect(body.otherOrdersCount).toBe(2);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(order.B1);
    expect(raw).not.toContain(`R14H-${suffix}-B1`);
    expect(raw).not.toContain(documentNumber.D3);
    // Agent data never appears.
    expect(raw).not.toContain(order.AGENT);
    expect(raw).not.toContain('R14H-' + suffix + '-AGENT');

    const b = await history('empB');
    expect(
      (b.body as { orders: { number: string }[] }).orders.map((o) => o.number),
    ).toEqual([`R14H-${suffix}-B1`]);
  });

  it('describes each order: products, statuses, total and a newest-first order', async () => {
    const res = await history('empA');
    const orders = (
      res.body as {
        orders: {
          number: string;
          productSummary: string;
          products: { name: string; quantity: number }[];
          fulfillmentStatus: { code: string } | null;
          documentStatus: string | null;
          paymentStatus: string | null;
          total: number;
          date: string;
        }[];
      }
    ).orders;
    const a1 = orders.find((o) => o.number === `R14H-${suffix}-A1`)!;
    expect(a1.productSummary).toBe(`R14 History Product ${suffix}`);
    expect(a1.products).toEqual([
      { name: `R14 History Product ${suffix}`, quantity: 2 },
    ]);
    expect(a1.fulfillmentStatus?.code).toBe('DELIVERED');
    expect(a1.paymentStatus).toBe('PAYMENT_PENDING');
    expect(a1.total).toBe(80);
    const d1 = orders.find((o) => o.number === documentNumber.D1)!;
    expect(d1.documentStatus).toBe('CONFIRMED');
    const dates = orders.map((o) => new Date(o.date).getTime());
    expect([...dates].sort((x, y) => y - x)).toEqual(dates);
  });

  it('counts placed / completed orders company-wide with the shared definition', async () => {
    const res = await history('empA');
    // store placed A1 A2 B1 + B2B placed D1 D3 = 5; completed A1 B1 + D3 = 3.
    expect(res.body.summary).toMatchObject({
      placedOrders: 5,
      completedPurchases: 3,
    });
    const own = await stats('empA');
    expect(own.status).toBe(200);
    expect(own.body).toEqual({ placedOrders: 5, completedPurchases: 3 });
  });

  it('builds a chronological timeline of the caller’s own orders', async () => {
    const res = await history('empA');
    const timeline = res.body.timeline as {
      kind: string;
      reference: string;
      at: string;
    }[];
    const kinds = (reference: string) =>
      timeline.filter((e) => e.reference === reference).map((e) => e.kind);
    expect(kinds(`R14H-${suffix}-A1`).sort()).toEqual(['DELIVERY', 'ORDER']);
    expect(kinds(`R14H-${suffix}-A3`).sort()).toEqual([
      'CANCELLATION',
      'ORDER',
    ]);
    expect(kinds(`R14H-${suffix}-B1`)).toEqual([]);
    const times = timeline.map((e) => new Date(e.at).getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);
  });

  it('hides the financial section without finance.view / customers.view_financials', async () => {
    const plain = await history('empA');
    expect(plain.body.financials).toBeNull();
    const plainTimeline = plain.body.timeline as { kind: string }[];
    expect(plainTimeline.some((e) => e.kind === 'PAYMENT')).toBe(false);

    for (const who of ['viewFinancials', 'finance']) {
      const res = await history(who);
      expect(res.status).toBe(200);
      expect(res.body.financials).toEqual(
        expect.objectContaining({
          outstandingBalance: expect.any(Number),
          payments: expect.any(Array),
        }),
      );
    }
  });

  it('requires partners.view for the history; agents are refused', async () => {
    expect((await history('noPartners')).status).toBe(403);
    const agentToken = jwt.sign({
      sub: ids.empA,
      email: 'agent@example.test',
      typ: 'agent',
      agentId,
    });
    const res = await request(http)
      .get(`/customers/${partnerId}/history`)
      .set({ Authorization: `Bearer ${agentToken}` });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('R14 History Customer');
  });

  it('an agent-only customer shows no company order', async () => {
    const res = await history('empA', agentPartnerId);
    expect(res.status).toBe(200);
    expect(res.body.orders).toEqual([]);
    expect(res.body.otherOrdersCount).toBe(0);
    expect(res.body.summary.placedOrders).toBe(0);
  });

  it('order-stats: numbers only, and 404 for a caller with no view and no scope', async () => {
    expect((await stats('noPartners')).status).toBe(404);
    const res = await stats('empB');
    expect(Object.keys(res.body as object).sort()).toEqual([
      'completedPurchases',
      'placedOrders',
    ]);
  });
});
