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
import { Prisma } from '@prisma/client';
import { personNameKey, personNameKeySql } from '../../common/text/person-name';

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
  const createdProductIds: string[] = [];

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
        salesDistributionEligible: true,
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
    const trackProduct = async (suffix: string, owner: string | null) => {
      const id = await makeProduct(suffix, owner);
      createdProductIds.push(id);
      return id;
    };
    companyProductId = await trackProduct('CO', null);

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
      const productId = await trackProduct(`AG${suffix}`, agent.id);
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
    // Never leave sellable fixtures behind for specs that pick "any active
    // product" (archived, not deleted — orders still reference them).
    if (prisma && createdProductIds.length) {
      await prisma.product.updateMany({
        where: { id: { in: createdProductIds } },
        data: { deletedAt: new Date(), status: 'INACTIVE' },
      });
    }
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

    it('checks every supplied number — a new phone with an existing mobile is a match', async () => {
      const res = await post(users.empB, '/store-orders', {
        ...orderBody({ name: customer.name, phone: phone() }),
        partner: {
          name: customer.name,
          phone: phone(),
          mobile: p1,
          countryId: egId,
        },
      });
      expect(res.status).toBe(409);
      expect(res.body.details.duplicate.customer.id).toBe(firstOrder.partnerId);
      // An empty phone is absent, not a number.
      const empty = await post(users.empB, '/store-orders', {
        ...orderBody({ name: customer.name, phone: phone() }),
        partner: {
          name: customer.name,
          phone: '',
          mobile: p1,
          countryId: egId,
        },
      });
      expect(empty.status).toBe(409);
    });

    it('audits a check that reaches another owner’s orders', async () => {
      const before = new Date();
      await post(users.empB, '/store-orders/duplicate-check', {
        phone: p1,
        countryId: egId,
      });
      const audit = await prisma.globalLookupAudit.findFirst({
        where: {
          userId: users.empB.id,
          matchedPartnerId: firstOrder.partnerId,
          createdAt: { gte: before },
        },
      });
      expect(audit).not.toBeNull();
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

      // The same dialog key on another lead is refused, never a replay.
      const other = await leads.create({
        customerName: `Other Lead ${tag}`,
        mobileNumber: phone(),
        countryId: egId,
        currencyId,
        source: LeadSource.MANUAL,
        quantity: 1,
        salesEmployeeId: users.empA.id,
      });
      const reused = await post(users.empA, `/leads/${other.id}/convert`, body);
      expect(reused.status).toBe(409);
      expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
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
      // Own-scope user: name + masked phone only, no order history.
      expect(res.body).toMatchObject({
        kind: 'NAME',
        candidates: [
          expect.objectContaining({
            id: existingPartnerId,
            hasOrders: true,
            orderCount: null,
            lastOrderDate: null,
          }),
        ],
      });
      const manager = await post(
        users.manager,
        '/store-orders/duplicate-check',
        { phone: phone(), name: typedName, countryId: egId },
      );
      expect(manager.body.candidates).toEqual([
        expect.objectContaining({ id: existingPartnerId, orderCount: 1 }),
      ]);
    });

    it('SQL and JS name keys agree', async () => {
      const samples = [
        storedName,
        typedName,
        `ا${String.fromCharCode(0x0654)}حمد`,
        `مو${String.fromCharCode(0x0654)}من علی`,
        `کمال${String.fromCharCode(0x200c)}الدين`,
        'مُحَمَّد  فاطمة',
      ];
      for (const sample of samples) {
        const [row] = await prisma.$queryRaw<{ k: string }[]>(
          Prisma.sql`SELECT ${personNameKeySql('v.n')} AS k FROM (VALUES (${sample}::text)) AS v(n)`,
        );
        expect(row.k).toBe(personNameKey(sample));
      }
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

    // O3 (owner decision 2026-10-01) — previously a new customer for agent
    // B. One phone = one customer: the order joins agent A's customer record,
    // stays agent B's order and is flagged; agent B still sees nothing of A.
    it('cross-scope: attached to the one customer of the phone, flagged for review, isolated', async () => {
      const partnersBefore = await prisma.partner.count({
        where: { OR: [{ phone: agentAPhone }, { mobile: agentAPhone }] },
      });
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
      expect(order.partnerId).toBe(agentAPartnerId);
      expect(
        await prisma.partner.count({
          where: { OR: [{ phone: agentAPhone }, { mobile: agentAPhone }] },
        }),
      ).toBe(partnersBefore);
      flaggedOrderId = order.id;

      // Agent B sees its own order with the customer as it typed it…
      const own = await get(users.agentB, `/agent-portal/orders/${order.id}`);
      expect(own.status).toBe(200);
      expect(own.body.customer.name).toBe(`Agent B Customer ${tag}`);
      expectNoLeak(own.body);
      // …never agent A's order, in the list or by id.
      const list = await get(users.agentB, '/agent-portal/orders?pageSize=200');
      expectNoLeak(list.body);
      expect(
        (await get(users.agentB, `/agent-portal/orders/${agentAOrder.id}`))
          .status,
      ).toBe(404);
      // A repeat check is now in agent B's scope: its own order and typed
      // name only.
      const again = await post(
        users.agentB,
        '/agent-portal/orders/duplicate-check',
        { phone: agentAPhone },
      );
      expect(again.body).toMatchObject({
        kind: 'PHONE',
        crossScope: false,
        customer: { name: `Agent B Customer ${tag}` },
        orders: [expect.objectContaining({ id: order.id })],
        otherOrdersCount: 0,
      });
      expect(again.body.orders).toHaveLength(1);
      const { customer: _shared, ...rest } = again.body as {
        customer: unknown;
      };
      void _shared;
      expectNoLeak(rest);
    });

    it('O3 — company → agent: the agent order joins the company customer, flagged, nothing of the company side leaks', async () => {
      const res = await post(
        users.agentA,
        '/agent-portal/orders',
        agentOrderBody(
          productAId,
          { name: `Agent A typed ${tag}`, mobile: companyPhone },
          { duplicateResolution: { decision: 'INTENTIONAL_NEW_ORDER' } },
        ),
      );
      expect(res.status).toBe(201);
      const companySecrets = [
        companyOrder.internalOrderId,
        companyOrder.partnerId,
        `Company Secret ${tag}`,
      ];
      const list = await get(users.agentA, '/agent-portal/orders?pageSize=200');
      const detail = await get(
        users.agentA,
        `/agent-portal/orders/${res.body.id}`,
      );
      for (const body of [res.body, list.body, detail.body]) {
        const text = JSON.stringify(body);
        for (const secret of companySecrets) {
          expect(text).not.toContain(secret);
        }
      }
      expect(detail.body.customer.name).toBe(`Agent A typed ${tag}`);
      const order = await prisma.storeOrder.findUniqueOrThrow({
        where: { id: res.body.id },
      });
      expect(order.partnerId).toBe(companyOrder.partnerId);
      expect(order.duplicateReviewStatus).toBe('PENDING');
      // The company customer record is unchanged.
      expect(
        (
          await prisma.partner.findUniqueOrThrow({
            where: { id: companyOrder.partnerId },
          })
        ).name,
      ).toBe(`Company Secret ${tag}`);
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
      // O3 — the other side is the same customer's orders in another scope.
      expect(detail.body.matches[0]).toMatchObject({
        customer: { id: agentAPartnerId },
        sameCustomer: true,
        orders: expect.arrayContaining([
          expect.objectContaining({ id: agentAOrder.id }),
        ]),
      });

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

  // ── Review fixes: scope of NONE, agent-owned customers on company orders

  describe('review queue scope and agent-owned customers', () => {
    const agentPhone = phone();
    const agentLeadPhone = phone();
    let agentPartnerId: string;
    let agentLeadPartnerId: string;
    let companyOrderId: string;

    const agentCustomer = async (mobile: string) => {
      const agentOrder = await post(
        users.agentA,
        '/agent-portal/orders',
        agentOrderBody(productAId, { name: `Agent Owned ${tag}`, mobile }),
      );
      expect(agentOrder.status).toBe(201);
      return (
        await prisma.storeOrder.findUniqueOrThrow({
          where: { id: agentOrder.body.id },
        })
      ).partnerId;
    };

    beforeAll(async () => {
      agentPartnerId = await agentCustomer(agentPhone);
      agentLeadPartnerId = await agentCustomer(agentLeadPhone);
    });

    // O3 — previously "new customer, flagged": the company order now joins
    // the agent's customer record (one phone = one customer), flagged.
    it('an agent-owned customer is cross-scope for a company order: same customer, flagged', async () => {
      const check = await post(users.empA, '/store-orders/duplicate-check', {
        phone: agentPhone,
        countryId: egId,
      });
      expect(check.body).toEqual({ kind: 'PHONE', crossScope: true });

      const refused = await post(
        users.empA,
        '/store-orders',
        orderBody({ name: `Company Buyer ${tag}`, phone: agentPhone }),
      );
      expect(refused.status).toBe(409);

      const created = await post(
        users.empA,
        '/store-orders',
        orderBody(
          { name: `Company Buyer ${tag}`, phone: agentPhone },
          { duplicateResolution: { decision: 'INTENTIONAL_NEW_ORDER' } },
        ),
      );
      expect(created.status).toBe(201);
      expect(created.body.partnerId).toBe(agentPartnerId);
      expect(created.body.duplicateReviewStatus).toBe('PENDING');
      companyOrderId = created.body.id;

      // The customer record now carries the company order too.
      expect(
        await prisma.storeOrder.count({
          where: { partnerId: agentPartnerId, agentId: null },
        }),
      ).toBe(1);

      const detail = await get(
        users.reviewer,
        `/store-orders/${companyOrderId}/duplicate-review`,
      );
      expect(detail.status).toBe(200);
      expect(
        detail.body.matches.map(
          (match: { customer: { id: string } }) => match.customer.id,
        ),
      ).toContain(agentPartnerId);
    });

    // O3 — previously "never adopts": the conversion joins the customer.
    it('company lead conversion attaches to the agent’s customer too, flagged', async () => {
      const lead = await leads.create({
        customerName: `Lead Agent Phone ${tag}`,
        mobileNumber: agentLeadPhone,
        countryId: egId,
        currencyId,
        source: LeadSource.MANUAL,
        quantity: 1,
        salesEmployeeId: users.empA.id,
      });
      const res = await post(users.empA, `/leads/${lead.id}/convert`, {
        items: [{ productId: companyProductId, quantity: 1, agreedAmount: 90 }],
        paymentType: 'PREPAID',
        declarationKind: 'UNPAID',
        city: `Lead City ${tag}`,
        duplicateResolution: { decision: 'INTENTIONAL_NEW_ORDER' },
      });
      expect(res.status).toBe(200);
      const order = await prisma.storeOrder.findUniqueOrThrow({
        where: { leadId: lead.id },
      });
      expect(order.partnerId).toBe(agentLeadPartnerId);
      expect(order.duplicateReviewStatus).toBe('PENDING');
      // A record shared with an agent scope is never rewritten by the
      // company conversion's destination.
      expect(
        (
          await prisma.partner.findUniqueOrThrow({
            where: { id: agentLeadPartnerId },
          })
        ).city,
      ).not.toBe(`Lead City ${tag}`);
    });

    it('duplicateReviewStatus=NONE keeps the caller’s own sales scope', async () => {
      const res = await get(
        users.empA,
        '/store-orders?duplicateReviewStatus=NONE&pageSize=200',
      );
      expect(res.status).toBe(200);
      expect(
        res.body.items.every(
          (row: { employeeId: string | null }) =>
            row.employeeId === users.empA.id,
        ),
      ).toBe(true);
      const ids = await get(
        users.empA,
        '/store-orders/ids?duplicateReviewStatus=NONE',
      );
      expect(ids.status).toBe(200);
    });

    it('an order that was never flagged has no duplicate review (404)', async () => {
      const plain = await post(
        users.empA,
        '/store-orders',
        orderBody({ name: `Plain ${tag}`, phone: phone() }),
      );
      const res = await get(
        users.reviewer,
        `/store-orders/${plain.body.id}/duplicate-review`,
      );
      expect(res.status).toBe(404);
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

    it('manual create: the same key with other data, or of an archived order, is refused', async () => {
      const key = `form-${tag}-3`;
      const body = orderBody(
        { name: `Key Reuse ${tag}`, phone: phone() },
        { creationIdempotencyKey: key },
      );
      const first = await post(users.empA, '/store-orders', body);
      expect(first.status).toBe(201);
      const changed = await post(users.empA, '/store-orders', {
        ...body,
        notes: 'different order',
      });
      expect(changed.status).toBe(409);
      expect(changed.body.code).toBe('IDEMPOTENCY_KEY_REUSED');

      await prisma.storeOrder.update({
        where: { id: first.body.id },
        data: { deletedAt: new Date() },
      });
      const archived = await post(users.empA, '/store-orders', body);
      expect(archived.status).toBe(409);
      expect(archived.body.code).toBe('ORDER_KEY_ALREADY_USED');
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

  // ── R11 — recognition across formats, known customers, ambiguous numbers ──

  describe('R11 recognition', () => {
    let saId: string;
    beforeAll(async () => {
      const sa = await prisma.country.findFirst({ where: { code: 'SA' } });
      if (!sa) throw new Error('Expected country SA in the local database.');
      saId = sa.id;
    });

    it('a local number typed under another default country still recognises the customer (valid readings only)', async () => {
      const egPhone = phone();
      const created = await post(
        users.empA,
        '/store-orders',
        orderBody({ name: `Cross Region ${tag}`, phone: egPhone }),
      );
      expect(created.status).toBe(201);
      const national = `0${egPhone.slice(3)}`;
      // Saudi Arabia selected, an Egyptian national number typed.
      for (const input of [national, `00${egPhone.slice(1)}`, egPhone]) {
        const res = await post(users.empA, '/store-orders/duplicate-check', {
          phone: input,
          countryId: saId,
        });
        expect(res.body).toMatchObject({
          kind: 'PHONE',
          crossScope: false,
          customer: { id: created.body.partnerId },
        });
      }
      // One digit off is never a match (no suffix stripping).
      const off = await post(users.empA, '/store-orders/duplicate-check', {
        phone: `${egPhone.slice(0, -1)}${(Number(egPhone.slice(-1)) + 1) % 10}`,
      });
      expect(off.body.kind).toBe('NONE');
    });

    it('Arabic-Indic digits are digits', async () => {
      const egPhone = phone();
      const created = await post(
        users.empA,
        '/store-orders',
        orderBody({ name: `Arabic Digits ${tag}`, phone: egPhone }),
      );
      expect(created.status).toBe(201);
      const arabic = egPhone.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
      const res = await post(users.empA, '/store-orders/duplicate-check', {
        phone: arabic,
      });
      expect(res.body.kind).toBe('PHONE');
    });

    it('a customer with NO order yet is recognised — informational, masked, never blocking', async () => {
      const knownPhone = phone();
      const partner = await prisma.partner.create({
        data: {
          partnerNumber: `PT-R11-${tag}-K`,
          name: `Known Without Orders ${tag}`,
          phone: knownPhone,
          entityType: 'PERSON',
          roles: { create: { role: 'CUSTOMER' } },
          phoneKeys: { create: { phoneE164: knownPhone, kind: 'PHONE' } },
        },
      });
      const res = await post(users.empB, '/store-orders/duplicate-check', {
        phone: knownPhone,
      });
      expect(res.status).toBe(200);
      expect(res.body.kind).toBe('KNOWN');
      expect(res.body.customer.nameMasked).toMatch(/•/);
      expect(res.body.customer.nameMasked).not.toContain('Without');
      expect(res.body.customer.phoneMasked.endsWith(knownPhone.slice(-3))).toBe(
        true,
      );
      expect(res.body.customer).not.toHaveProperty('id');
      // Not blocking: the order is created and attaches to that customer.
      const order = await post(
        users.empB,
        '/store-orders',
        orderBody({ name: `Known Without Orders ${tag}`, phone: knownPhone }),
      );
      expect(order.status).toBe(201);
      expect(order.body.partnerId).toBe(partner.id);
    });

    it('legacy duplicate records of one number force an explicit choice — never silent, never merged', async () => {
      const shared = phone();
      const first = await post(
        users.empA,
        '/store-orders',
        orderBody({ name: `Legacy One ${tag}`, phone: shared }),
      );
      expect(first.status).toBe(201);
      // A second, UNKEYED customer record of the same number (created before one phone = one customer).
      const legacy = await prisma.partner.create({
        data: {
          partnerNumber: `PT-R11-${tag}-L`,
          name: `Legacy Two ${tag}`,
          phone: shared,
          entityType: 'PERSON',
          roles: { create: { role: 'CUSTOMER' } },
        },
      });
      await prisma.storeOrder.create({
        data: {
          internalOrderId: `R11-${tag}-LEG`,
          partnerId: legacy.id,
          currencyId,
          employeeId: users.empA.id,
        },
      });
      const check = await post(users.empA, '/store-orders/duplicate-check', {
        phone: shared,
      });
      expect(check.body.kind).toBe('PHONE');
      expect(check.body.alternatives).toHaveLength(1);
      expect(check.body.alternatives[0].id).toBe(legacy.id);
      // No customer named → refused as ambiguous.
      const unnamed = await post(
        users.empA,
        '/store-orders',
        orderBody(
          { name: `Legacy One ${tag}`, phone: shared },
          { duplicateResolution: { decision: 'INTENTIONAL_NEW_ORDER' } },
        ),
      );
      expect(unnamed.status).toBe(409);
      expect(unnamed.body.code).toBe('DUPLICATE_ACKNOWLEDGEMENT_REQUIRED');
      // A customer that is not one of the records → refused (stale).
      const stranger = await post(
        users.empA,
        '/store-orders',
        orderBody(
          { name: `Legacy One ${tag}`, phone: shared },
          {
            duplicateResolution: {
              decision: 'INTENTIONAL_NEW_ORDER',
              customerId: randomUUID(),
            },
          },
        ),
      );
      expect(stranger.status).toBe(409);
      // The chosen record receives the order; nothing is merged.
      const chosen = await post(
        users.empA,
        '/store-orders',
        orderBody(
          { name: `Legacy One ${tag}`, phone: shared },
          {
            duplicateResolution: {
              decision: 'INTENTIONAL_NEW_ORDER',
              customerId: legacy.id,
            },
          },
        ),
      );
      expect(chosen.status).toBe(201);
      expect(chosen.body.partnerId).toBe(legacy.id);
      expect(
        await prisma.partner.count({
          where: { phone: shared, deletedAt: null },
        }),
      ).toBe(2);
    });

    it('the order keeps its own delivery destination and never rewrites the customer', async () => {
      const own = phone();
      const created = await post(
        users.empA,
        '/store-orders',
        orderBody(
          { name: `Delivery ${tag}`, phone: own },
          { delivery: { countryId: saId, city: 'Jeddah', address: 'Hotel 5' } },
        ),
      );
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        deliveryCountryId: saId,
        deliveryCity: 'Jeddah',
        deliveryAddress: 'Hotel 5',
      });
      const partner = await prisma.partner.findUniqueOrThrow({
        where: { id: created.body.partnerId },
      });
      expect(partner.city).toBeNull();
      expect(partner.address).toBeNull();
    });

    it('a known customer on the first number never hides a real match on the second', async () => {
      const knownPhone = phone();
      await prisma.partner.create({
        data: {
          partnerNumber: `PT-R11-${tag}-K2`,
          name: `Known First ${tag}`,
          phone: knownPhone,
          entityType: 'PERSON',
          roles: { create: { role: 'CUSTOMER' } },
          phoneKeys: { create: { phoneE164: knownPhone, kind: 'PHONE' } },
        },
      });
      const withOrders = phone();
      const first = await post(
        users.empA,
        '/store-orders',
        orderBody({ name: `Has Orders ${tag}`, phone: withOrders }),
      );
      expect(first.status).toBe(201);
      const second = await post(users.empA, '/store-orders', {
        ...orderBody({ name: `Two Numbers ${tag}`, phone: knownPhone }),
        partner: {
          name: `Two Numbers ${tag}`,
          phone: knownPhone,
          mobile: withOrders,
          countryId: egId,
        },
      });
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('DUPLICATE_ACKNOWLEDGEMENT_REQUIRED');
    });

    it('a lead repeated on the same number is never blocked as a duplicate order', async () => {
      await grant(users.empA.id, ['crm.leads.create']);
      const leadPhone = phone();
      const make = (n: number) =>
        post(users.empA, '/leads', {
          customerName: `Repeat Lead ${n} ${tag}`,
          mobileNumber: leadPhone,
          countryId: egId,
          currencyId,
          source: 'MANUAL',
        });
      const [one, two] = [await make(1), await make(2)];
      expect(one.status).toBe(201);
      expect(two.status).toBe(201);
    });
  });
});
