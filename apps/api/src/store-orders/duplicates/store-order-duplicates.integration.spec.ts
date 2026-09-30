/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment -- supertest response bodies are untyped JSON under assertion */
import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server } from 'http';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { LeadSource } from '@prisma/client';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../common/errors/all-exceptions.filter';
import { formatValidationErrors } from '../../common/errors/format-validation-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { LeadsService } from '../../leads/leads.service';
import { AgentsService } from '../../agents/admin/agents.service';
import { AgentAgreementsService } from '../../agents/admin/agent-agreements.service';
import { AgentUsersService } from '../../agents/admin/agent-users.service';
import type { CreateAgreementDto } from '../../agents/admin/dto/agreement.dto';

/**
 * Round 5 Spec 1B — duplicate warning + idempotent order submission over the
 * real HTTP pipeline (AppModule, real guards/JWTs, local Postgres, tagged
 * fixtures). Acceptance items 8 and 9 of spec-1-orders.md.
 */
describe('Spec 1B — order duplicates + idempotent create (HTTP integration)', () => {
  jest.setTimeout(300_000);
  let moduleRef: TestingModule;
  let app: INestApplication;
  let http: Server;
  let prisma: PrismaService;
  let jwt: JwtService;
  let resolver: PermissionsResolverService;
  let leads: LeadsService;

  const tag = randomUUID().slice(0, 6).toUpperCase();
  const lower = tag.toLowerCase();
  let phoneSeq = 0;
  const phone = () =>
    `+2010${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}${String(++phoneSeq % 100).padStart(2, '0')}`;

  let egId: string;
  let currencyId: string;
  let companyProductId: string;
  let productAId: string;
  let productBId: string;
  let agentAId: string;

  type Actor = { id: string; token: string };
  const users: Record<
    'empA' | 'empB' | 'manager' | 'reviewer' | 'agentA' | 'agentB',
    Actor
  > = {} as never;

  const post = (actor: Actor, path: string, body: object = {}) =>
    request(http)
      .post(path)
      .set('Authorization', `Bearer ${actor.token}`)
      .send(body);
  const get = (actor: Actor, path: string) =>
    request(http).get(path).set('Authorization', `Bearer ${actor.token}`);

  const grant = async (userId: string, names: string[]) => {
    for (const name of names) {
      const permission = await prisma.permission.upsert({
        where: { name },
        create: { name },
        update: {},
      });
      await prisma.userPermission.upsert({
        where: {
          userId_permissionId: { userId, permissionId: permission.id },
        },
        create: { userId, permissionId: permission.id },
        update: {},
      });
    }
    resolver.invalidate(userId);
  };

  const internalUser = async (key: string, permissions: string[]) => {
    const user = await prisma.user.create({
      data: {
        email: `dup-${key}-${lower}@test.local`,
        username: `dup-${key}-${lower}`,
        fullName: `Dup ${key} ${tag}`,
        passwordHash: 'x',
      },
    });
    await grant(user.id, permissions);
    return {
      id: user.id,
      token: jwt.sign({ sub: user.id, email: user.email }),
    };
  };

  const orderBody = (
    customer: { name: string; phone: string },
    extra: object = {},
  ) => ({
    partner: { ...customer, countryId: egId },
    currencyId,
    source: 'MANUAL',
    items: [{ productId: companyProductId, quantity: 1, unitPrice: 100 }],
    ...extra,
  });

  const agentOrderBody = (
    productId: string,
    customer: { name: string; mobile: string },
    extra: object = {},
  ) => ({
    pricingMode: 'SHIPPING_ADDED',
    lines: [{ productId, quantity: 1, lineAmount: 100 }],
    fulfillmentMethod: 'PICKUP',
    paymentType: 'PREPAID',
    customer: { ...customer, countryId: egId },
    ...extra,
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
    jwt = moduleRef.get(JwtService);
    resolver = moduleRef.get(PermissionsResolverService);
    leads = moduleRef.get(LeadsService, { strict: false });
    const agents = moduleRef.get(AgentsService, { strict: false });
    const agreements = moduleRef.get(AgentAgreementsService, { strict: false });
    const agentUsers = moduleRef.get(AgentUsersService, { strict: false });

    const eg = await prisma.country.findFirst({ where: { code: 'EG' } });
    if (!eg) throw new Error('Expected country EG in the local database.');
    egId = eg.id;
    currencyId = (
      await prisma.currency.create({
        data: { code: `D${tag}`, name: `Dup Test ${tag}` },
      })
    ).id;
    const categoryId = (
      await prisma.productCategory.create({
        data: { name: `dup-${tag}-category` },
      })
    ).id;
    const unitId = (
      await prisma.unit.create({ data: { name: `dup-${tag}-unit` } })
    ).id;
    const makeProduct = async (suffix: string, ownerAgentId: string | null) =>
      (
        await prisma.product.create({
          data: {
            sku: `DUP-${tag}-${suffix}`,
            name: `Dup Product ${suffix} ${tag}`,
            internalName: `Dup Product ${suffix}`,
            displayName: `Dup Product ${suffix}`,
            categoryId,
            unitId,
            type: 'PURCHASE_AND_SALE',
            isPurchasable: true,
            isSellable: true,
            isInventoryItem: true,
            itemType: 'PRODUCT',
            salesPrice: 100,
            weight: 1,
            width: 1,
            height: 1,
            length: 1,
            ownerAgentId,
          },
        })
      ).id;
    companyProductId = await makeProduct('CO', null);

    const sales = [
      'store-orders.view',
      'store-orders.create',
      'store-orders.edit',
      'crm.leads.view',
      'crm.leads.edit',
      'crm.leads.convert',
    ];
    users.empA = await internalUser('empa', sales);
    users.empB = await internalUser('empb', sales);
    // `crm.leads.manage` = ALL sales scope (sees every owner's orders).
    users.manager = await internalUser('manager', [
      ...sales,
      'crm.leads.manage',
    ]);
    users.reviewer = await internalUser('reviewer', [
      'store-orders.view',
      'store-orders.duplicate_review',
    ]);

    const admin = await prisma.user.create({
      data: {
        email: `dup-admin-${lower}@test.local`,
        username: `dup-admin-${lower}`,
        fullName: `Dup Admin ${tag}`,
        passwordHash: 'x',
        isSuperAdmin: true,
      },
    });
    const terms: CreateAgreementDto = {
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
    };
    const makeAgent = async (suffix: string) => {
      const agent = await agents.create(
        {
          name: `Dup Agent ${suffix} ${tag}`,
          email: `dup-agent-${suffix.toLowerCase()}-${lower}@test.local`,
          currencyId,
        },
        admin.id,
      );
      const agreement = await agreements.create(agent.id, terms, admin.id);
      await agreements.activate(agent.id, agreement.id, admin.id);
      const productId = await makeProduct(`AG${suffix}`, agent.id);
      const created = await agentUsers.create(
        agent.id,
        {
          email: `dup-agentuser-${suffix.toLowerCase()}-${lower}@test.local`,
          username: `dup-agentuser-${suffix.toLowerCase()}-${lower}`,
          fullName: `Dup Agent User ${suffix} ${tag}`,
          agentRole: 'ADMIN',
        },
        admin.id,
      );
      await prisma.user.update({
        where: { id: created.id },
        data: { mustChangePassword: false },
      });
      return {
        agentId: agent.id,
        productId,
        actor: {
          id: created.id,
          token: jwt.sign({
            sub: created.id,
            email: created.email,
            typ: 'agent',
            agentId: agent.id,
          }),
        },
      };
    };
    const a = await makeAgent('A');
    const b = await makeAgent('B');
    agentAId = a.agentId;
    productAId = a.productId;
    productBId = b.productId;
    users.agentA = a.actor;
    users.agentB = b.actor;
  });

  afterAll(async () => {
    await app?.close();
  });

  // ── Acceptance 8 — internal (company) orders ───────────────────────────

  describe('phone match (company orders)', () => {
    const p1 = phone();
    const customer = { name: `Returning Customer ${tag}`, phone: p1 };
    let firstOrder: { id: string; internalOrderId: string; partnerId: string };

    beforeAll(async () => {
      const res = await post(users.empA, '/store-orders', orderBody(customer));
      expect(res.status).toBe(201);
      firstOrder = res.body;
    });

    it('warns another employee — independent of who created the first order', async () => {
      const own = await post(users.empB, '/store-orders/duplicate-check', {
        phone: p1,
        name: 'Someone else',
        countryId: egId,
      });
      expect(own.status).toBe(200);
      expect(own.body).toMatchObject({
        kind: 'PHONE',
        crossScope: false,
        customer: { id: firstOrder.partnerId, name: customer.name },
        // empB (own scope) cannot open empA's order — only counted.
        orders: [],
        otherOrdersCount: 1,
      });
      expect(own.body.customer.phoneMasked).not.toBe(p1);
      expect(own.body.customer.phoneMasked.endsWith(p1.slice(-3))).toBe(true);

      const manager = await post(
        users.manager,
        '/store-orders/duplicate-check',
        { phone: p1, countryId: egId },
      );
      expect(manager.body.kind).toBe('PHONE');
      expect(manager.body.orders).toEqual([
        expect.objectContaining({
          id: firstOrder.id,
          orderNumber: firstOrder.internalOrderId,
          active: true,
          total: 100,
        }),
      ]);
      expect(manager.body.otherOrdersCount).toBe(0);
    });

    it('refuses a submit without a resolution (409, same scoped payload) and writes nothing', async () => {
      const before = await prisma.storeOrder.count({
        where: { partnerId: firstOrder.partnerId },
      });
      const res = await post(users.empB, '/store-orders', orderBody(customer));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DUPLICATE_ACKNOWLEDGEMENT_REQUIRED');
      expect(res.body.details.duplicate).toMatchObject({
        kind: 'PHONE',
        crossScope: false,
        customer: { id: firstOrder.partnerId },
      });
      const different = await post(
        users.empB,
        '/store-orders',
        orderBody(customer, {
          duplicateResolution: { decision: 'DIFFERENT_CUSTOMER' },
        }),
      );
      expect(different.status).toBe(409);
      expect(
        await prisma.storeOrder.count({
          where: { partnerId: firstOrder.partnerId },
        }),
      ).toBe(before);
    });

    it('an intentional new order reuses the existing customer and is recorded', async () => {
      const res = await post(
        users.empB,
        '/store-orders',
        orderBody(
          { name: 'Typed differently', phone: p1 },
          {
            duplicateResolution: {
              decision: 'INTENTIONAL_NEW_ORDER',
              customerId: firstOrder.partnerId,
            },
          },
        ),
      );
      expect(res.status).toBe(201);
      expect(res.body.partnerId).toBe(firstOrder.partnerId);
      expect(res.body.duplicateReviewStatus).toBe('NONE');
      const activity = await prisma.storeOrderActivity.findFirst({
        where: { storeOrderId: res.body.id, action: 'INTENTIONAL_NEW_ORDER' },
      });
      expect(activity?.details).toContain(firstOrder.internalOrderId);
      const samePhonePartners = await prisma.partner.count({
        where: { deletedAt: null, OR: [{ phone: p1 }, { mobile: p1 }] },
      });
      expect(samePhonePartners).toBe(1);
    });

    it('a stale customer id is refused', async () => {
      const res = await post(
        users.empB,
        '/store-orders',
        orderBody(customer, {
          duplicateResolution: {
            decision: 'INTENTIONAL_NEW_ORDER',
            customerId: randomUUID(),
          },
        }),
      );
      expect(res.status).toBe(409);
    });

    it('lead conversion enforces the same gate and reuses the customer', async () => {
      const lead = await leads.create({
        customerName: `Lead For Returning ${tag}`,
        mobileNumber: p1,
        countryId: egId,
        currencyId,
        source: LeadSource.MANUAL,
        quantity: 1,
        salesEmployeeId: users.empA.id,
      });
      const body = {
        items: [
          { productId: companyProductId, quantity: 1, agreedAmount: 150 },
        ],
        paymentType: 'PREPAID',
        declarationKind: 'UNPAID',
        idempotencyKey: `lead-key-${tag}`,
      };
      const refused = await post(users.empA, `/leads/${lead.id}/convert`, body);
      expect(refused.status).toBe(409);
      expect(refused.body.details.duplicate.customer.id).toBe(
        firstOrder.partnerId,
      );

      const converted = await post(users.empA, `/leads/${lead.id}/convert`, {
        ...body,
        duplicateResolution: { decision: 'INTENTIONAL_NEW_ORDER' },
      });
      expect(converted.status).toBe(200);
      const order = await prisma.storeOrder.findUniqueOrThrow({
        where: { leadId: lead.id },
      });
      expect(order.partnerId).toBe(firstOrder.partnerId);
      expect(order.creationIdempotencyKey).toBe(
        `lead-convert:${users.empA.id}:lead-key-${tag}`,
      );

      // Retry (double click) → the converted lead, never a second order.
      const retry = await post(users.empA, `/leads/${lead.id}/convert`, {
        ...body,
        duplicateResolution: { decision: 'INTENTIONAL_NEW_ORDER' },
      });
      expect(retry.status).toBe(200);
      expect(retry.body.idempotentReplay).toBe(true);
      expect(
        await prisma.storeOrder.count({ where: { leadId: lead.id } }),
      ).toBe(1);
    });
  });

  describe('name-only match (soft, never merged)', () => {
    let existingPartnerId: string;
    const storedName = `أحمد عبد الله ${tag}`;
    const typedName = `احمد عبدالله ${tag.toLowerCase()}`;

    beforeAll(async () => {
      const res = await post(
        users.empA,
        '/store-orders',
        orderBody({ name: storedName, phone: phone() }),
      );
      expect(res.status).toBe(201);
      existingPartnerId = res.body.partnerId;
    });

    it('returns a soft NAME warning for an Arabic-normalized name with a new phone', async () => {
      const res = await post(users.empB, '/store-orders/duplicate-check', {
        phone: phone(),
        name: typedName,
        countryId: egId,
      });
      expect(res.body).toMatchObject({
        kind: 'NAME',
        candidates: [
          expect.objectContaining({ id: existingPartnerId, orderCount: 1 }),
        ],
      });
    });

    it('never merges on name alone', async () => {
      const unresolved = await post(
        users.empB,
        '/store-orders',
        orderBody({ name: typedName, phone: phone() }),
      );
      expect(unresolved.status).toBe(201);
      expect(unresolved.body.partnerId).not.toBe(existingPartnerId);

      const different = await post(
        users.empB,
        '/store-orders',
        orderBody(
          { name: typedName, phone: phone() },
          { duplicateResolution: { decision: 'DIFFERENT_CUSTOMER' } },
        ),
      );
      expect(different.status).toBe(201);
      expect(different.body.partnerId).not.toBe(existingPartnerId);
      expect(
        await prisma.storeOrderActivity.count({
          where: {
            storeOrderId: different.body.id,
            action: 'DUPLICATE_DIFFERENT_CUSTOMER',
          },
        }),
      ).toBe(1);

      const same = await post(
        users.empB,
        '/store-orders',
        orderBody(
          { name: typedName, phone: phone() },
          {
            duplicateResolution: {
              decision: 'USE_EXISTING_CUSTOMER',
              customerId: existingPartnerId,
            },
          },
        ),
      );
      expect(same.status).toBe(201);
      expect(same.body.partnerId).toBe(existingPartnerId);
    });
  });

  // ── Acceptance 8 — agent isolation and cross-scope review ──────────────

  describe('agents', () => {
    const companyPhone = phone();
    const agentAPhone = phone();
    const agentACustomer = `Agent A Customer ${tag}`;
    let companyOrder: { internalOrderId: string; partnerId: string };
    let agentAOrder: { id: string; internalOrderId: string };
    let agentAPartnerId: string;
    let flaggedOrderId: string;

    const secretsOf = () => [
      companyOrder.internalOrderId,
      companyOrder.partnerId,
      `Company Secret ${tag}`,
      agentAOrder.internalOrderId,
      agentAPartnerId,
      agentACustomer,
    ];
    const expectNoLeak = (body: unknown) => {
      const text = JSON.stringify(body);
      for (const secret of secretsOf()) expect(text).not.toContain(secret);
    };

    beforeAll(async () => {
      const company = await post(
        users.empA,
        '/store-orders',
        orderBody({ name: `Company Secret ${tag}`, phone: companyPhone }),
      );
      expect(company.status).toBe(201);
      companyOrder = company.body;
      const agentOrder = await post(
        users.agentA,
        '/agent-portal/orders',
        agentOrderBody(productAId, {
          name: agentACustomer,
          mobile: agentAPhone,
        }),
      );
      expect(agentOrder.status).toBe(201);
      agentAOrder = agentOrder.body;
      agentAPartnerId = (
        await prisma.storeOrder.findUniqueOrThrow({
          where: { id: agentAOrder.id },
        })
      ).partnerId;
    });

    it('a company customer seen from an agent is only { kind: PHONE, crossScope: true }', async () => {
      const res = await post(
        users.agentA,
        '/agent-portal/orders/duplicate-check',
        {
          phone: companyPhone,
          name: `Company Secret ${tag}`,
          countryId: egId,
        },
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ kind: 'PHONE', crossScope: true });
    });

    it('another agent sees no data of agent A — neither on check nor in the 409', async () => {
      const check = await post(
        users.agentB,
        '/agent-portal/orders/duplicate-check',
        { phone: agentAPhone, name: agentACustomer },
      );
      expect(check.body).toEqual({ kind: 'PHONE', crossScope: true });

      // Name-only never crosses agents either.
      const byName = await post(
        users.agentB,
        '/agent-portal/orders/duplicate-check',
        { phone: phone(), name: agentACustomer },
      );
      expect(byName.body).toEqual({ kind: 'NONE' });

      const refused = await post(
        users.agentB,
        '/agent-portal/orders',
        agentOrderBody(productBId, {
          name: agentACustomer,
          mobile: agentAPhone,
        }),
      );
      expect(refused.status).toBe(409);
      expect(refused.body.details).toEqual({
        duplicate: { kind: 'PHONE', crossScope: true },
      });
      expectNoLeak(refused.body);
    });

    it('cross-scope: created in the caller’s scope, flagged for review', async () => {
      const res = await post(
        users.agentB,
        '/agent-portal/orders',
        agentOrderBody(
          productBId,
          { name: `Agent B Customer ${tag}`, mobile: agentAPhone },
          { duplicateResolution: { decision: 'INTENTIONAL_NEW_ORDER' } },
        ),
      );
      expect(res.status).toBe(201);
      expectNoLeak(res.body);
      const order = await prisma.storeOrder.findUniqueOrThrow({
        where: { id: res.body.id },
      });
      expect(order.duplicateReviewStatus).toBe('PENDING');
      expect(order.partnerId).not.toBe(agentAPartnerId);
      flaggedOrderId = order.id;
    });

    it('the agent’s own customer is an in-scope match with its orders', async () => {
      const res = await post(
        users.agentA,
        '/agent-portal/orders/duplicate-check',
        { phone: agentAPhone },
      );
      expect(res.body).toMatchObject({
        kind: 'PHONE',
        crossScope: false,
        customer: { id: agentAPartnerId },
        orders: [expect.objectContaining({ id: agentAOrder.id })],
      });
      // In-scope repeat needs a decision and reuses the agent's customer.
      const refused = await post(
        users.agentA,
        '/agent-portal/orders',
        agentOrderBody(productAId, {
          name: agentACustomer,
          mobile: agentAPhone,
        }),
      );
      expect(refused.status).toBe(409);
      const repeat = await post(
        users.agentA,
        '/agent-portal/orders',
        agentOrderBody(
          productAId,
          { name: agentACustomer, mobile: agentAPhone },
          { duplicateResolution: { decision: 'INTENTIONAL_NEW_ORDER' } },
        ),
      );
      expect(repeat.status).toBe(201);
      const row = await prisma.storeOrder.findUniqueOrThrow({
        where: { id: repeat.body.id },
      });
      expect(row.partnerId).toBe(agentAPartnerId);
      expect(row.duplicateReviewStatus).toBe('NONE');
    });

    it('an internal reviewer sees and resolves the flagged order; others cannot', async () => {
      const queue = await get(
        users.reviewer,
        `/store-orders?duplicateReviewStatus=PENDING&pageSize=200`,
      );
      expect(queue.status).toBe(200);
      expect(queue.body.items.map((row: { id: string }) => row.id)).toContain(
        flaggedOrderId,
      );
      const denied = await get(
        users.empA,
        `/store-orders?duplicateReviewStatus=PENDING`,
      );
      expect(denied.status).toBe(403);

      const detail = await get(
        users.reviewer,
        `/store-orders/${flaggedOrderId}/duplicate-review`,
      );
      expect(detail.status).toBe(200);
      expect(detail.body.order.duplicateReviewStatus).toBe('PENDING');
      expect(
        detail.body.matches.map(
          (match: { customer: { id: string } }) => match.customer.id,
        ),
      ).toContain(agentAPartnerId);

      const resolved = await post(
        users.reviewer,
        `/store-orders/${flaggedOrderId}/duplicate-review/resolve`,
        { decision: 'CONFIRMED_DISTINCT', note: 'Different person' },
      );
      expect(resolved.status).toBe(200);
      expect(resolved.body.order).toMatchObject({
        duplicateReviewStatus: 'CONFIRMED_DISTINCT',
        reviewedBy: { id: users.reviewer.id },
        reviewNote: 'Different person',
      });
      const again = await post(
        users.reviewer,
        `/store-orders/${flaggedOrderId}/duplicate-review/resolve`,
        { decision: 'CONFIRMED_DUPLICATE' },
      );
      expect(again.status).toBe(409);
      const forbidden = await post(
        users.empA,
        `/store-orders/${flaggedOrderId}/duplicate-review/resolve`,
        { decision: 'CONFIRMED_DUPLICATE' },
      );
      expect(forbidden.status).toBe(403);
    });
  });

  // ── Acceptance 9 — double click / retry with the same key ─────────────

  describe('idempotent submission', () => {
    it('manual create: a retry with the same key returns the first order', async () => {
      const key = `form-${tag}-1`;
      const body = orderBody(
        { name: `Idem Customer ${tag}`, phone: phone() },
        { creationIdempotencyKey: key },
      );
      const first = await post(users.empA, '/store-orders', body);
      expect(first.status).toBe(201);
      const retry = await post(users.empA, '/store-orders', body);
      expect(retry.status).toBe(200);
      expect(retry.body).toMatchObject({
        id: first.body.id,
        idempotentReplay: true,
      });
      expect(
        await prisma.storeOrder.count({
          where: {
            creationIdempotencyKey: `store-order:${users.empA.id}:${key}`,
          },
        }),
      ).toBe(1);
      // Another user's identical key is a different form — never a replay of it.
      const other = await post(users.empB, '/store-orders', {
        ...body,
        duplicateResolution: { decision: 'INTENTIONAL_NEW_ORDER' },
      });
      expect(other.status).toBe(201);
      expect(other.body.id).not.toBe(first.body.id);
    });

    it('manual create: a concurrent double submit creates one order', async () => {
      const key = `form-${tag}-2`;
      const body = orderBody(
        { name: `Double Click ${tag}`, phone: phone() },
        { creationIdempotencyKey: key },
      );
      const [a, b] = await Promise.all([
        post(users.empA, '/store-orders', body),
        post(users.empA, '/store-orders', body),
      ]);
      for (const res of [a, b]) expect([200, 201]).toContain(res.status);
      expect(a.body.id).toBe(b.body.id);
      expect(
        await prisma.storeOrder.count({
          where: {
            creationIdempotencyKey: `store-order:${users.empA.id}:${key}`,
          },
        }),
      ).toBe(1);
    });

    it('agent order: the same key returns the first order and is written to the column', async () => {
      const key = `agent-form-${tag}`;
      const body = agentOrderBody(
        productAId,
        { name: `Agent Idem ${tag}`, mobile: phone() },
        { idempotencyKey: key },
      );
      const first = await post(users.agentA, '/agent-portal/orders', body);
      expect(first.status).toBe(201);
      const retry = await post(users.agentA, '/agent-portal/orders', body);
      expect(retry.body).toMatchObject({
        id: first.body.id,
        idempotentReplay: true,
      });
      const row = await prisma.storeOrder.findUniqueOrThrow({
        where: { id: first.body.id },
      });
      expect(row.creationIdempotencyKey).toBe(`agent-order:${agentAId}:${key}`);
      expect(
        await prisma.storeOrderActivity.count({
          where: { storeOrderId: row.id, action: 'AGENT_ORDER_IDEMPOTENCY' },
        }),
      ).toBe(1);
    });
  });
});
