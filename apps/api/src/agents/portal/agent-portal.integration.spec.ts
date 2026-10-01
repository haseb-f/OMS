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
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../common/errors/all-exceptions.filter';
import { formatValidationErrors } from '../../common/errors/format-validation-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { ObjectStorageService } from '../../common/storage/object-storage.service';
import { AgentsService } from '../admin/agents.service';
import { AgentAgreementsService } from '../admin/agent-agreements.service';
import { AgentDestinationsService } from '../admin/agent-destinations.service';
import { AgentUsersService } from '../admin/agent-users.service';
import type { CreateAgreementDto } from '../admin/dto/agreement.dto';

/**
 * Agents milestone B3 — `/agent-portal/*` over the real HTTP pipeline
 * (AppModule, real guards, real JWTs, local Postgres, tagged fixtures):
 * separation matrix, cross-agent isolation, permission checks, the portal
 * happy path and live deactivation.
 */
describe('Agents B3 — agent portal API (HTTP integration)', () => {
  jest.setTimeout(300_000);
  let moduleRef: TestingModule;
  let app: INestApplication;
  let http: Server;
  let prisma: PrismaService;
  let jwt: JwtService;
  let resolver: PermissionsResolverService;

  const tag = randomUUID().slice(0, 6).toUpperCase();
  const lower = tag.toLowerCase();
  let phoneSeq = 0;
  const phone = () =>
    `+2010${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}${String(++phoneSeq % 100).padStart(2, '0')}`;

  let egId: string;
  let agentAId: string;
  let agentBId: string;
  let productAId: string;
  let productBId: string;
  let destinationAId: string;
  let destinationBId: string;

  const users: Record<
    'internal' | 'adminA' | 'adminA2' | 'salesA1' | 'salesA2' | 'adminB',
    { id: string; token: string }
  > = {} as never;

  let orderA1Id: string; // owned by salesA1
  let orderBId: string; // agent B
  let leadBId: string;
  let payoutAId: string;
  let payoutBId: string;
  let payoutAAttachmentId: string;
  let payoutBAttachmentId: string;
  let proofAttachmentId: string;

  const terms = (): CreateAgreementDto => ({
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
  });

  const get = (token: string, path: string) =>
    request(http).get(path).set('Authorization', `Bearer ${token}`);
  const post = (token: string, path: string, body: object = {}) =>
    request(http).post(path).set('Authorization', `Bearer ${token}`).send(body);
  const put = (token: string, path: string, body: object = {}) =>
    request(http).put(path).set('Authorization', `Bearer ${token}`).send(body);

  const agentToken = (user: { id: string; email: string; agentId: string }) =>
    jwt.sign({
      sub: user.id,
      email: user.email,
      typ: 'agent',
      agentId: user.agentId,
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
    const agents = moduleRef.get(AgentsService, { strict: false });
    const agreements = moduleRef.get(AgentAgreementsService, { strict: false });
    const destinations = moduleRef.get(AgentDestinationsService, {
      strict: false,
    });
    const agentUsers = moduleRef.get(AgentUsersService, { strict: false });
    const storage = moduleRef.get(ObjectStorageService, { strict: false });

    const internal = await prisma.user.create({
      data: {
        email: `portal-internal-${lower}@test.local`,
        username: `portal-internal-${lower}`,
        fullName: `Portal Internal ${tag}`,
        passwordHash: 'x',
        isSuperAdmin: true,
      },
    });
    users.internal = {
      id: internal.id,
      token: jwt.sign({ sub: internal.id, email: internal.email }),
    };

    const currencyId = (
      await prisma.currency.create({
        data: { code: `P${tag}`, name: `Portal Test ${tag}` },
      })
    ).id;
    const eg = await prisma.country.findFirst({ where: { code: 'EG' } });
    if (!eg) throw new Error('Expected country EG in the local database.');
    egId = eg.id;
    const categoryId = (
      await prisma.productCategory.create({
        data: { name: `portal-${tag}-category` },
      })
    ).id;
    const unitId = (
      await prisma.unit.create({ data: { name: `portal-${tag}-unit` } })
    ).id;
    const paymentMethodId = (
      await prisma.paymentMethod.create({
        data: { name: `Portal Method ${tag}`, requiresReconciliation: false },
      })
    ).id;

    const makeAgent = async (suffix: string) => {
      const agent = await agents.create(
        {
          name: `Portal Agent ${suffix} ${tag}`,
          email: `portal-agent-${suffix.toLowerCase()}-${lower}@test.local`,
          currencyId,
        },
        internal.id,
      );
      const agreement = await agreements.create(agent.id, terms(), internal.id);
      await agreements.upsertShippingRate(agent.id, agreement.id, {
        countryId: egId,
        amount: 100,
      });
      await agreements.activate(agent.id, agreement.id, internal.id);
      const destination = await destinations.create(
        agent.id,
        { paymentMethodId, ownership: 'COMPANY', label: `Company ${suffix}` },
        internal.id,
      );
      const product = await prisma.product.create({
        data: {
          sku: `PRT-${tag}-${suffix}`,
          name: `Portal Product ${suffix} ${tag}`,
          internalName: `Portal Product ${suffix}`,
          displayName: `Portal Product ${suffix}`,
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
      return {
        agentId: agent.id,
        productId: product.id,
        destinationId: destination.id,
      };
    };
    const a = await makeAgent('A');
    const b = await makeAgent('B');
    agentAId = a.agentId;
    productAId = a.productId;
    destinationAId = a.destinationId;
    agentBId = b.agentId;
    productBId = b.productId;
    destinationBId = b.destinationId;

    const makeUser = async (
      agentId: string,
      key: string,
      role: 'ADMIN' | 'SALES',
      extra: 'agent.team.manage'[] = [],
    ) => {
      const created = await agentUsers.create(
        agentId,
        {
          email: `portal-${key}-${lower}@test.local`,
          username: `portal-${key}-${lower}`,
          fullName: `Portal ${key} ${tag}`,
          agentRole: role,
          extraPermissions: extra,
        },
        internal.id,
      );
      // The user has already replaced the temporary password (S7 blocks
      // every portal call until then — covered by its own test).
      await prisma.user.update({
        where: { id: created.id },
        data: { mustChangePassword: false },
      });
      return {
        id: created.id,
        token: agentToken({ id: created.id, email: created.email, agentId }),
      };
    };
    users.adminA = await makeUser(agentAId, 'admina', 'ADMIN', [
      'agent.team.manage',
    ]);
    users.adminA2 = await makeUser(agentAId, 'admina2', 'ADMIN');
    users.salesA1 = await makeUser(agentAId, 'salesa1', 'SALES');
    users.salesA2 = await makeUser(agentAId, 'salesa2', 'SALES');
    users.adminB = await makeUser(agentBId, 'adminb', 'ADMIN', [
      'agent.team.manage',
    ]);

    // Payout fixtures (read-only in the portal): one per agent, with evidence.
    const glAccount = await prisma.chartOfAccount.findFirstOrThrow({
      where: { deletedAt: null },
      select: { id: true },
    });
    const payingAccountId = (
      await prisma.receivingAccount.create({
        data: {
          name: `Portal bank ${tag}`,
          code: `PRT-RA-${tag}`,
          chartOfAccountId: glAccount.id,
        },
      })
    ).id;
    const makePayout = async (agentId: string, suffix: string) => {
      const payout = await prisma.agentPayout.create({
        data: {
          payoutNumber: `APO-T${tag}-${suffix}`,
          agentId,
          amount: 50,
          currencyId,
          payingAccountId,
          payoutDate: new Date(),
          reference: `REF-${tag}-${suffix}`,
          notes: `internal payout note ${tag}`,
          idempotencyKey: `portal-po-${tag}-${suffix}`,
        },
      });
      const storageKey = `tests/agent-portal/${tag}-${suffix}.pdf`;
      await storage.put(
        storageKey,
        Buffer.from(`%PDF-1.4\n% payout ${suffix}\n`),
        'application/pdf',
      );
      const attachment = await prisma.attachment.create({
        data: {
          fileName: `${tag}-${suffix}.pdf`,
          originalName: `payout-${suffix}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 20,
          storageProvider: storage.provider(),
          storageKey,
          uploadedById: internal.id,
          finalizedAt: new Date(),
        },
      });
      await prisma.agentPayoutAttachment.create({
        data: { payoutId: payout.id, attachmentId: attachment.id },
      });
      return { payoutId: payout.id, attachmentId: attachment.id };
    };
    ({ payoutId: payoutAId, attachmentId: payoutAAttachmentId } =
      await makePayout(agentAId, 'A'));
    ({ payoutId: payoutBId, attachmentId: payoutBAttachmentId } =
      await makePayout(agentBId, 'B'));
  });

  afterAll(async () => {
    await app?.close();
  });

  // ── (a) separation matrix ──────────────────────────────────────────────

  describe('separation matrix', () => {
    const fakeId = '00000000-0000-4000-8000-000000000000';
    const internalEndpoints: Array<['get' | 'post', string]> = [
      ['get', '/store-orders'],
      ['get', '/store-orders/ids'],
      ['get', '/shipping'],
      ['get', '/shipping/ids'],
      ['post', `/store-orders/${fakeId}/shipments/ship`],
      ['post', `/payments/${fakeId}/confirm`],
      ['get', '/payment-reconciliation/methods'],
      ['post', `/payment-reconciliation/methods/${fakeId}/lines`],
      ['get', '/payment-settlements'],
      ['post', `/agent-finance/collections/${fakeId}/verify`],
      ['post', `/agent-finance/agents/${fakeId}/payouts`],
      ['get', `/agent-finance/agents/${fakeId}/statement`],
      ['get', '/import-center/jobs'],
      ['get', '/import-center/types'],
      ['get', '/products/catalog'],
      ['get', '/products'],
      ['get', '/partners/catalog'],
      ['get', '/partners/ids'],
      ['get', '/leads'],
      ['get', '/leads/ids'],
      ['get', '/users'],
      ['get', '/agents'],
      ['post', '/agent-orders/quote'],
      ['get', `/attachments/${fakeId}/file`],
    ];

    it.each(['adminA', 'salesA1'] as const)(
      '%s token → 403 on every internal endpoint',
      async (who) => {
        for (const [method, path] of internalEndpoints) {
          const res =
            method === 'get'
              ? await get(users[who].token, path)
              : await post(users[who].token, path);
          if (res.status !== 403) {
            throw new Error(`${method.toUpperCase()} ${path} → ${res.status}`);
          }
        }
      },
    );

    it('internal token → 403 on /agent-portal routes', async () => {
      for (const path of [
        '/agent-portal/me',
        '/agent-portal/dashboard',
        '/agent-portal/orders',
        '/agent-portal/leads',
        '/agent-portal/statement',
        '/agent-portal/team',
      ]) {
        const res = await get(users.internal.token, path);
        expect([path, res.status]).toEqual([path, 403]);
      }
      const quote = await post(
        users.internal.token,
        '/agent-portal/orders/quote',
        {
          pricingMode: 'SHIPPING_ADDED',
          lines: [{ productId: productAId, quantity: 1, lineAmount: 10 }],
        },
      );
      expect(quote.status).toBe(403);
    });

    it('R6 A.3: agent tokens get 403 on internal settings writes, even with a stored domain row', async () => {
      const domainKey = await prisma.permission.upsert({
        where: { name: 'settings.finance.manage' },
        update: {},
        create: {
          name: 'settings.finance.manage',
          description: 'Permission Matrix: settings.finance.manage',
        },
      });
      // A stray internal row on an agent user must never authorize anything.
      await prisma.userPermission.create({
        data: { userId: users.adminA.id, permissionId: domainKey.id },
      });
      resolver.invalidate(users.adminA.id);
      try {
        for (const path of [
          '/payment-methods',
          '/number-series',
          '/shipping-companies',
          '/cost-components',
          '/workflow/transitions',
        ]) {
          const res = await post(users.adminA.token, path);
          expect([path, res.status]).toEqual([path, 403]);
        }
        const patch = await request(http)
          .patch('/accounting/posting-settings')
          .set('Authorization', `Bearer ${users.adminA.token}`)
          .send({});
        expect(patch.status).toBe(403);
      } finally {
        await prisma.userPermission.deleteMany({
          where: { userId: users.adminA.id, permissionId: domainKey.id },
        });
        resolver.invalidate(users.adminA.id);
      }
    });

    it('agent token without a bearer or with a forged agentId is refused', async () => {
      expect((await request(http).get('/agent-portal/me')).status).toBe(401);
      const forged = agentToken({
        id: users.salesA1.id,
        email: 'x@test.local',
        agentId: agentBId,
      });
      expect((await get(forged, '/agent-portal/me')).status).toBe(401);
    });
  });

  // ── (d) happy path ─────────────────────────────────────────────────────

  describe('happy path', () => {
    it('me + products', async () => {
      const me = await get(users.salesA1.token, '/agent-portal/me');
      expect(me.status).toBe(200);
      expect(me.body.agent.id).toBe(agentAId);
      expect(me.body.user.agentRole).toBe('SALES');
      expect(me.body.agreement.productCommissionRatePercent).toBe(10);
      expect(me.body.agreement.serviceCommissionRatePercent).toBe(10);
      expect(me.body.agreement.shippingRates[0].amount).toBe(100);
      expect(me.body.user.permissions).toContain('agent.orders.create');

      const products = await get(users.salesA1.token, '/agent-portal/products');
      expect(products.status).toBe(200);
      expect(products.body.items.map((p: { id: string }) => p.id)).toEqual([
        productAId,
      ]);
      expect(products.body.items[0].listPrice).toBe(600);
      expect(products.body.stockVisible).toBe(false);
      expect(products.body.items[0].available).toBeNull();
      const adminProducts = await get(
        users.adminA.token,
        '/agent-portal/products',
      );
      expect(adminProducts.body.stockVisible).toBe(true);
      expect(adminProducts.body.items[0].available).toBe(0);
    });

    it('lead → convert (shipping added 1000 + 100)', async () => {
      const lead = await post(users.salesA1.token, '/agent-portal/leads', {
        customerName: `Portal Lead ${tag}`,
        mobileNumber: phone(),
        countryId: egId,
        productId: productAId,
        quantity: 1,
      });
      expect(lead.status).toBe(201);
      expect(lead.body.agentId).toBe(agentAId);
      const converted = await post(
        users.salesA1.token,
        `/agent-portal/leads/${lead.body.id}/convert`,
        {
          pricingMode: 'SHIPPING_ADDED',
          lines: [{ productId: productAId, quantity: 1, lineAmount: 1000 }],
          fulfillmentMethod: 'SHIPPING',
          paymentType: 'PREPAID',
          countryId: egId,
        },
      );
      expect(converted.status).toBe(201);
      expect(converted.body.breakdown).toMatchObject({
        mode: 'SHIPPING_ADDED',
        merchandiseAmount: 1000,
        shippingCharge: 100,
        shippingChargeSource: 'RATE',
        payableTotal: 1100,
      });
      expect(converted.body.lead.id).toBe(lead.body.id);
    });

    it('quote + direct order (shipping included 1000 incl 100 ⇒ 900/100), idempotent', async () => {
      const body = {
        pricingMode: 'SHIPPING_INCLUDED',
        agreedTotal: 1000,
        lines: [{ productId: productAId, quantity: 1 }],
        fulfillmentMethod: 'SHIPPING',
        paymentType: 'PREPAID',
        countryId: egId,
        customer: {
          name: `Portal Customer ${tag}`,
          mobile: phone(),
          countryId: egId,
        },
        notes: 'agent note',
        // Internal-only fields are ignored for agent callers.
        agentId: agentBId,
        ownerUserId: users.adminA.id,
      };
      const quote = await post(
        users.salesA1.token,
        '/agent-portal/orders/quote',
        body,
      );
      expect(quote.status).toBe(200);
      expect(quote.body.valid).toBe(true);
      expect(quote.body.breakdown).toMatchObject({
        merchandiseAmount: 900,
        shippingCharge: 100,
        payableTotal: 1000,
      });

      const key = `portal-order-${tag}`;
      const created = await post(
        users.salesA1.token,
        '/agent-portal/orders',
        body,
      ).set('Idempotency-Key', key);
      expect(created.status).toBe(201);
      expect(created.body.breakdown).toMatchObject({
        mode: 'SHIPPING_INCLUDED',
        merchandiseAmount: 900,
        shippingCharge: 100,
        payableTotal: 1000,
      });
      expect(created.body.owner.id).toBe(users.salesA1.id);
      expect(created.body).not.toHaveProperty('notes');
      orderA1Id = created.body.id;
      const retried = await post(
        users.salesA1.token,
        '/agent-portal/orders',
        body,
      ).set('Idempotency-Key', key);
      expect(retried.body.id).toBe(orderA1Id);
      const stored = await prisma.storeOrder.findUniqueOrThrow({
        where: { id: orderA1Id },
        select: { agentId: true, employeeId: true },
      });
      expect(stored).toEqual({
        agentId: agentAId,
        employeeId: users.salesA1.id,
      });
    });

    it('declares full payment with proof; detail shows declared, not verified', async () => {
      const destinations = await get(
        users.salesA1.token,
        '/agent-portal/payment-destinations',
      );
      expect(destinations.status).toBe(200);
      expect(destinations.body).toEqual([
        expect.objectContaining({ id: destinationAId, ownership: 'COMPANY' }),
      ]);

      const staged = await request(http)
        .post('/attachments/staging')
        .set('Authorization', `Bearer ${users.salesA1.token}`)
        .attach('file', Buffer.from('%PDF-1.4\n% proof of payment\n'), {
          filename: 'proof.pdf',
          contentType: 'application/pdf',
        });
      expect(staged.status).toBe(201);
      const declared = await post(
        users.salesA1.token,
        `/agent-portal/orders/${orderA1Id}/payment-declaration`,
        {
          kind: 'FULL',
          destinationId: destinationAId,
          paymentDate: new Date().toISOString().slice(0, 10),
          reference: `TRX-${tag}`,
          idempotencyKey: `portal-decl-${tag}`,
          stagedAttachmentIds: [staged.body.id],
        },
      );
      expect(declared.status).toBe(200);
      expect(declared.body.payment).toMatchObject({
        declaredPaymentStatus: 'PAID',
        declaredAmount: 1000,
        financeVerifiedAmount: 0,
        remainingToDeclare: 0,
      });
      const claim = declared.body.payment.claims[0];
      expect(claim).toMatchObject({
        amount: 1000,
        financeStatus: 'PENDING',
        verification: 'DECLARED_AWAITING_FINANCE',
        stage: 'DECLARED',
        destination: { id: destinationAId },
      });
      expect(claim.attachments).toHaveLength(1);
      proofAttachmentId = claim.attachments[0].attachmentId;
      expect(
        declared.body.timeline.map((e: { event: string }) => e.event),
      ).toEqual(['ORDER_CREATED', 'PAYMENT_DECLARED']);

      const file = await get(
        users.salesA1.token,
        `/agent-portal/attachments/${proofAttachmentId}/file`,
      );
      expect(file.status).toBe(200);
      expect(file.headers['content-type']).toContain('application/pdf');

      const list = await get(
        users.salesA1.token,
        '/agent-portal/orders?declaredPaymentStatus=PAID&pageSize=200',
      );
      expect(list.status).toBe(200);
      expect(list.body.items.map((o: { id: string }) => o.id)).toEqual([
        orderA1Id,
      ]);
      expect(list.body.items[0].breakdown).toMatchObject({
        merchandiseAmount: 900,
        shippingCharge: 100,
        payableTotal: 1000,
      });
      const tooBig = await get(
        users.salesA1.token,
        '/agent-portal/orders?pageSize=201',
      );
      expect(tooBig.status).toBe(400);
    });

    it('agent B creates its own lead and order', async () => {
      const lead = await post(users.adminB.token, '/agent-portal/leads', {
        customerName: `Portal Lead B ${tag}`,
        mobileNumber: phone(),
        countryId: egId,
      });
      expect(lead.status).toBe(201);
      leadBId = lead.body.id;
      const order = await post(users.adminB.token, '/agent-portal/orders', {
        pricingMode: 'SHIPPING_ADDED',
        lines: [{ productId: productBId, quantity: 1, lineAmount: 500 }],
        fulfillmentMethod: 'SHIPPING',
        countryId: egId,
        customer: {
          name: `Portal Customer B ${tag}`,
          mobile: phone(),
          countryId: egId,
        },
      });
      expect(order.status).toBe(201);
      orderBId = order.body.id;
      // Agent A's product is simply unavailable to agent B.
      const cross = await post(
        users.adminB.token,
        '/agent-portal/orders/quote',
        {
          pricingMode: 'SHIPPING_ADDED',
          lines: [{ productId: productAId, quantity: 1, lineAmount: 500 }],
          countryId: egId,
        },
      );
      expect(cross.body.valid).toBe(false);
      expect(cross.body.issues[0].code).toBe('PRODUCT_NOT_AVAILABLE');
    });
  });

  // ── (b) isolation ──────────────────────────────────────────────────────

  describe('isolation', () => {
    it('agent A users get 404 for agent B records, even with B ids', async () => {
      for (const who of ['adminA', 'salesA1'] as const) {
        const t = users[who].token;
        expect((await get(t, `/agent-portal/orders/${orderBId}`)).status).toBe(
          404,
        );
        expect((await get(t, `/agent-portal/leads/${leadBId}`)).status).toBe(
          404,
        );
        expect(
          (
            await post(
              t,
              `/agent-portal/orders/${orderBId}/payment-declaration`,
              {
                kind: 'FULL',
                destinationId: destinationBId,
                paymentDate: '2026-09-01',
                idempotencyKey: `x-${who}-${tag}`,
              },
            )
          ).status,
        ).toBe(404);
        expect(
          (
            await post(t, `/agent-portal/leads/${leadBId}/convert`, {
              pricingMode: 'SHIPPING_ADDED',
              lines: [{ productId: productBId, quantity: 1, lineAmount: 10 }],
              countryId: egId,
            })
          ).status,
        ).toBe(404);
        expect(
          (
            await get(
              t,
              `/agent-portal/attachments/${payoutBAttachmentId}/file`,
            )
          ).status,
        ).toBe(404);
      }
      expect(
        (await get(users.adminA.token, `/agent-portal/payouts/${payoutBId}`))
          .status,
      ).toBe(404);
      const ordersA = await get(
        users.adminA.token,
        '/agent-portal/orders?pageSize=200',
      );
      expect(ordersA.body.items.map((o: { id: string }) => o.id)).not.toContain(
        orderBId,
      );
      const leadsA = await get(
        users.adminA.token,
        '/agent-portal/leads?pageSize=200',
      );
      expect(leadsA.body.items.map((l: { id: string }) => l.id)).not.toContain(
        leadBId,
      );
      const payoutsA = await get(users.adminA.token, '/agent-portal/payouts');
      expect(payoutsA.body.items.map((p: { id: string }) => p.id)).toEqual([
        payoutAId,
      ]);
      const statementA = await get(
        users.adminA.token,
        '/agent-portal/statement',
      );
      expect(statementA.status).toBe(200);
      expect(statementA.body.agent.id).toBe(agentAId);
      // agent B's proof/evidence and agent A's proof are mutually invisible
      expect(
        (
          await get(
            users.adminB.token,
            `/agent-portal/attachments/${proofAttachmentId}/file`,
          )
        ).status,
      ).toBe(404);
      expect(
        (await get(users.adminB.token, `/agent-portal/orders/${orderA1Id}`))
          .status,
      ).toBe(404);
    });

    it('Sales without view_all sees only own orders; Admin sees all of own agent', async () => {
      const own = await get(
        users.salesA2.token,
        '/agent-portal/orders?pageSize=200',
      );
      expect(own.status).toBe(200);
      expect(own.body.total).toBe(0);
      expect(
        (await get(users.salesA2.token, `/agent-portal/orders/${orderA1Id}`))
          .status,
      ).toBe(404);
      expect(
        (
          await get(
            users.salesA2.token,
            `/agent-portal/attachments/${proofAttachmentId}/file`,
          )
        ).status,
      ).toBe(404);
      const all = await get(
        users.adminA.token,
        '/agent-portal/orders?pageSize=200',
      );
      expect(all.body.total).toBe(2);
      expect(
        (await get(users.adminA.token, `/agent-portal/orders/${orderA1Id}`))
          .status,
      ).toBe(200);
      expect(
        (
          await get(
            users.adminA.token,
            `/agent-portal/attachments/${proofAttachmentId}/file`,
          )
        ).status,
      ).toBe(200);
    });

    it('dashboard: own scope and no money figures without statement.view', async () => {
      const sales = await get(users.salesA1.token, '/agent-portal/dashboard');
      expect(sales.status).toBe(200);
      expect(sales.body.scope).toBe('OWN');
      expect(sales.body.fulfillment.total).toBe(2);
      expect(sales.body.sales).toBeNull();
      expect(sales.body.position).toBeNull();
      const sales2 = await get(users.salesA2.token, '/agent-portal/dashboard');
      expect(sales2.body.fulfillment.total).toBe(0);
      const admin = await get(users.adminA.token, '/agent-portal/dashboard');
      expect(admin.body.scope).toBe('ALL');
      expect(admin.body.fulfillment.total).toBe(2);
      expect(admin.body.sales.totalOrderValue).toBe(2100);
      expect(admin.body.position).not.toBeNull();
    });

    it('R6 A.5: OWN scope with statement.view gets own sales only — never agent-level money', async () => {
      const statementView = await prisma.permission.findUniqueOrThrow({
        where: { name: 'agent.statement.view' },
      });
      await prisma.userPermission.create({
        data: { userId: users.salesA1.id, permissionId: statementView.id },
      });
      resolver.invalidate(users.salesA1.id);
      try {
        const sales = await get(users.salesA1.token, '/agent-portal/dashboard');
        expect(sales.status).toBe(200);
        expect(sales.body.scope).toBe('OWN');
        // Own orders only (both agent-A orders belong to salesA1).
        expect(sales.body.sales.totalOrderValue).toBe(2100);
        expect(sales.body.returns).toBeNull();
        expect(sales.body.collections).toBeNull();
        expect(sales.body.position).toBeNull();
        expect(sales.body.payouts).toBeNull();
        // A second Sales user of the same agent with statement.view sees
        // only their own (zero) sales — never salesA1's.
        await prisma.userPermission.create({
          data: { userId: users.salesA2.id, permissionId: statementView.id },
        });
        resolver.invalidate(users.salesA2.id);
        const sales2 = await get(
          users.salesA2.token,
          '/agent-portal/dashboard',
        );
        expect(sales2.body.sales.totalOrderValue).toBe(0);
        expect(sales2.body.collections).toBeNull();
        // Agent Admin of the same agent keeps the whole-agent view.
        const admin = await get(users.adminA.token, '/agent-portal/dashboard');
        expect(admin.body.scope).toBe('ALL');
        expect(admin.body.collections).not.toBeNull();
        expect(admin.body.payouts).not.toBeNull();
        // Agent B's Admin sees only agent B.
        const adminB = await get(users.adminB.token, '/agent-portal/dashboard');
        expect(adminB.body.agent.id).toBe(agentBId);
      } finally {
        await prisma.userPermission.deleteMany({
          where: {
            userId: { in: [users.salesA1.id, users.salesA2.id] },
            permissionId: statementView.id,
          },
        });
        resolver.invalidate(users.salesA1.id);
        resolver.invalidate(users.salesA2.id);
      }
    });

    it('payout detail is read-only, own agent only, with evidence', async () => {
      const detail = await get(
        users.adminA.token,
        `/agent-portal/payouts/${payoutAId}`,
      );
      expect(detail.status).toBe(200);
      expect(detail.body).not.toHaveProperty('notes');
      expect(detail.body).not.toHaveProperty('idempotencyKey');
      expect(detail.body).not.toHaveProperty('ledgerEntries');
      expect(detail.body.attachments[0].attachmentId).toBe(payoutAAttachmentId);
      const file = await get(
        users.adminA.token,
        `/agent-portal/attachments/${payoutAAttachmentId}/file`,
      );
      expect(file.status).toBe(200);
      // Sales has orders.view but not payouts.view → payout evidence hidden.
      expect(
        (
          await get(
            users.salesA1.token,
            `/agent-portal/attachments/${payoutAAttachmentId}/file`,
          )
        ).status,
      ).toBe(404);
    });
  });

  // ── (c) permissions ────────────────────────────────────────────────────

  describe('permissions', () => {
    it('Sales cannot manage team, view statement, payouts or stock', async () => {
      const t = users.salesA1.token;
      for (const path of [
        '/agent-portal/team',
        '/agent-portal/statement',
        '/agent-portal/statement/summary',
        '/agent-portal/statement/print-data',
        '/agent-portal/payouts',
        `/agent-portal/payouts/${payoutAId}`,
        '/agent-portal/stock',
      ]) {
        expect([path, (await get(t, path)).status]).toEqual([path, 403]);
      }
      expect(
        (
          await post(t, '/agent-portal/team', {
            email: `x-${lower}@test.local`,
            username: `x-${lower}`,
            fullName: 'X',
          })
        ).status,
      ).toBe(403);
      expect(
        (await post(t, `/agent-portal/team/${users.salesA2.id}/deactivate`))
          .status,
      ).toBe(403);
      expect(
        (
          await post(t, `/agent-portal/leads/${randomUUID()}/assign`, {
            salesUserId: users.salesA2.id,
          })
        ).status,
      ).toBe(403);
    });

    it('Admin: create Sales (temp password once, affiliation from context), cannot grant team.manage or touch ADMIN users', async () => {
      const t = users.adminA.token;
      const created = await post(t, '/agent-portal/team', {
        email: `portal-new-${lower}@test.local`,
        username: `portal-new-${lower}`,
        fullName: `Portal New ${tag}`,
        // Affiliation fields in the body are never honored.
        agentId: agentBId,
        agentRole: 'ADMIN',
        userType: 'INTERNAL',
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        agentId: agentAId,
        agentRole: 'SALES',
        userType: 'AGENT',
      });
      expect(typeof created.body.temporaryPassword).toBe('string');
      expect(created.body).not.toHaveProperty('passwordHash');
      const newId = created.body.id as string;
      const list = await get(t, '/agent-portal/team');
      expect(
        list.body.find((u: { id: string }) => u.id === newId),
      ).not.toHaveProperty('temporaryPassword');

      const grantManage = await put(
        t,
        `/agent-portal/team/${newId}/permissions`,
        {
          permissionNames: ['agent.orders.view', 'agent.team.manage'],
        },
      );
      expect(grantManage.status).toBe(403);
      expect(grantManage.body.code).toBe('AGENT_DELEGATION_EXCEEDED');
      const internalPerm = await put(
        t,
        `/agent-portal/team/${newId}/permissions`,
        {
          permissionNames: ['store-orders.view'],
        },
      );
      expect(internalPerm.status).toBe(400);
      const ok = await put(t, `/agent-portal/team/${newId}/permissions`, {
        permissionNames: ['agent.orders.view', 'agent.stock.view'],
      });
      expect(ok.status).toBe(200);
      expect(ok.body.permissions).toEqual([
        'agent.orders.view',
        'agent.stock.view',
      ]);

      // Another ADMIN of the same agent (and itself) are out of reach.
      const otherAdmin = await post(
        t,
        `/agent-portal/team/${users.adminA2.id}/deactivate`,
      );
      expect(otherAdmin.status).toBe(403);
      expect(otherAdmin.body.code).toBe('AGENT_TEAM_ADMIN_TARGET');
      expect(
        (await post(t, `/agent-portal/team/${users.adminA.id}/deactivate`))
          .status,
      ).toBe(403);
      // Agent B's user → not found.
      expect(
        (await post(t, `/agent-portal/team/${users.adminB.id}/reset-password`))
          .status,
      ).toBe(404);
      const reset = await post(t, `/agent-portal/team/${newId}/reset-password`);
      expect(reset.status).toBe(200);
      expect(typeof reset.body.temporaryPassword).toBe('string');
      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: newId },
        select: { agentId: true, agentRole: true, userType: true },
      });
      expect(stored).toEqual({
        agentId: agentAId,
        agentRole: 'SALES',
        userType: 'AGENT',
      });
    });

    it('Admin assigns a lead only within its own agent', async () => {
      const lead = await post(users.adminA.token, '/agent-portal/leads', {
        customerName: `Portal Assign ${tag}`,
        mobileNumber: phone(),
        countryId: egId,
      });
      expect(lead.status).toBe(201);
      const assigned = await post(
        users.adminA.token,
        `/agent-portal/leads/${lead.body.id}/assign`,
        { salesUserId: users.salesA2.id },
      );
      expect(assigned.status).toBe(200);
      expect(assigned.body.salesEmployee.id).toBe(users.salesA2.id);
      const visible = await get(
        users.salesA2.token,
        `/agent-portal/leads/${lead.body.id}`,
      );
      expect(visible.status).toBe(200);
      const cross = await post(
        users.adminA.token,
        `/agent-portal/leads/${lead.body.id}/assign`,
        { salesUserId: users.adminB.id },
      );
      expect(cross.status).toBeGreaterThanOrEqual(400);
      expect(cross.status).toBeLessThan(500);
      expect(
        (
          await post(
            users.adminA.token,
            `/agent-portal/leads/${leadBId}/assign`,
            {
              salesUserId: users.salesA2.id,
            },
          )
        ).status,
      ).toBe(404);
    });

    it('statement + print data carry no journal/posting internals', async () => {
      const res = await get(
        users.adminA.token,
        '/agent-portal/statement/print-data?from=2020-01-01',
      );
      expect(res.status).toBe(200);
      expect(res.body.document.kind).toBe('AGENT_STATEMENT');
      expect(res.body.agent).not.toHaveProperty('partnerId');
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('journalEntry');
      expect(text).not.toContain('postingStatus');
      const summary = await get(
        users.adminA.token,
        '/agent-portal/statement/summary',
      );
      expect(summary.status).toBe(200);
      expect(summary.body.orders.count).toBe(2);
    });
  });

  // ── review fixes (S1, S6, S7, S8, countries, lead fulfillment) ─────────

  describe('review fixes', () => {
    // O3 (owner decision 2026-10-01): the order now joins the company
    // customer holding the phone (was: a new customer); S1 still holds — the
    // portal shows only what was typed and the record is never updated. No
    // identity oracle: an investor record answers exactly like a customer.
    it('S1 + O3: the order joins the one customer of the phone; detail, list and search show only the typed customer', async () => {
      const mobile = phone();
      const company = await prisma.partner.create({
        data: {
          partnerNumber: `PT-PS1-${tag}`,
          name: `Company Person ${tag}`,
          mobile,
          phone: mobile,
          email: `company-${lower}@test.local`,
          address: 'COMPANY ADDRESS',
          roles: { create: { role: 'CUSTOMER' } },
        },
      });
      const body = (customerMobile: string, extra: object = {}) => ({
        pricingMode: 'SHIPPING_ADDED',
        lines: [{ productId: productAId, quantity: 1, lineAmount: 200 }],
        countryId: egId,
        customer: {
          name: `Typed ${tag}`,
          mobile: customerMobile,
          countryId: egId,
          address: 'Typed address',
          email: 'ignored@test.local',
          taxNumber: 'IGNORED',
        },
        ...extra,
      });
      // A customer outside the agent's scope: only { crossScope: true }.
      const unacknowledged = await post(
        users.salesA1.token,
        '/agent-portal/orders',
        body(mobile),
      );
      expect(unacknowledged.status).toBe(409);
      expect(unacknowledged.body.details).toEqual({
        duplicate: { kind: 'PHONE', crossScope: true },
      });
      const created = await post(
        users.salesA1.token,
        '/agent-portal/orders',
        body(mobile, {
          duplicateResolution: { decision: 'INTENTIONAL_NEW_ORDER' },
        }),
      );
      expect(created.status).toBe(201);
      expect(created.body.customer).toEqual({
        name: `Typed ${tag}`,
        mobile,
        city: null,
        address: 'Typed address',
        country: expect.objectContaining({ id: egId }),
      });
      const text = JSON.stringify(created.body);
      expect(text).not.toContain('COMPANY ADDRESS');
      expect(text).not.toContain(`company-${lower}@test.local`);
      expect(text).not.toContain(`Company Person ${tag}`);
      expect(text).not.toContain(company.id);
      const stored = await prisma.storeOrder.findUniqueOrThrow({
        where: { id: created.body.id },
        select: { partnerId: true, duplicateReviewStatus: true },
      });
      expect(stored).toEqual({
        partnerId: company.id,
        duplicateReviewStatus: 'PENDING',
      });
      const after = await prisma.partner.findUniqueOrThrow({
        where: { id: company.id },
        include: { roles: true },
      });
      expect(after).toMatchObject({
        name: `Company Person ${tag}`,
        address: 'COMPANY ADDRESS',
      });
      expect(after.roles.map((r) => r.role)).toEqual(['CUSTOMER']);
      const list = await get(
        users.salesA1.token,
        `/agent-portal/orders?search=${encodeURIComponent(`Typed ${tag}`)}`,
      );
      expect(list.body.items[0].customer).toEqual({
        name: `Typed ${tag}`,
        mobile,
      });
      // The master record's name is not searchable from the portal.
      const byMaster = await get(
        users.salesA1.token,
        `/agent-portal/orders?search=${encodeURIComponent(`Company Person ${tag}`)}`,
      );
      expect(byMaster.body.items).toHaveLength(0);

      // An investor record holding the number: the same uniform answer, the
      // order attached (CUSTOMER role added), flagged — no oracle.
      const investorMobile = phone();
      const investor = await prisma.partner.create({
        data: {
          partnerNumber: `PT-PS1I-${tag}`,
          name: `Investor Person ${tag}`,
          mobile: investorMobile,
          phone: investorMobile,
          roles: { create: { role: 'INVESTOR' } },
        },
      });
      const investorCheck = await post(
        users.salesA1.token,
        '/agent-portal/orders/duplicate-check',
        { phone: investorMobile, countryId: egId },
      );
      expect(investorCheck.body).toEqual({ kind: 'PHONE', crossScope: true });
      const unacked = await post(
        users.salesA1.token,
        '/agent-portal/orders',
        body(investorMobile),
      );
      expect(unacked.status).toBe(409);
      expect(unacked.body.details).toEqual(unacknowledged.body.details);
      const onInvestor = await post(
        users.salesA1.token,
        '/agent-portal/orders',
        body(investorMobile, {
          duplicateResolution: { decision: 'INTENTIONAL_NEW_ORDER' },
        }),
      );
      expect(onInvestor.status).toBe(201);
      expect(JSON.stringify(onInvestor.body)).not.toContain('Investor');
      expect(
        await prisma.storeOrder.findUniqueOrThrow({
          where: { id: onInvestor.body.id },
          select: { partnerId: true, duplicateReviewStatus: true },
        }),
      ).toEqual({ partnerId: investor.id, duplicateReviewStatus: 'PENDING' });
      expect(
        (
          await prisma.partner.findUniqueOrThrow({
            where: { id: investor.id },
            include: { roles: true },
          })
        ).roles
          .map((r) => r.role)
          .sort(),
      ).toEqual(['CUSTOMER', 'INVESTOR']);
    });

    it('S8: statement lines expose only whitelisted calculation inputs', async () => {
      const agent = await prisma.agent.findUniqueOrThrow({
        where: { id: agentAId },
      });
      const entryNumber = `AL-T-${tag}`;
      await prisma.agentLedgerEntry.create({
        data: {
          entryNumber,
          agentId: agentAId,
          entryType: 'PROVIDER_FEE',
          entryDate: new Date(),
          sourceType: 'TEST_BASIS',
          sourceId: randomUUID(),
          currencyId: agent.currencyId,
          debit: 1,
          basis: {
            settlementNumber: 'STL-SECRET',
            settlementFee: 99,
            lineAmount: 10,
            payingAccountId: 'secret-account',
          },
          description: 'basis whitelist',
        },
      });
      const res = await get(
        users.adminA.token,
        '/agent-portal/statement?from=2020-01-01',
      );
      expect(res.status).toBe(200);
      const line = res.body.lines.find(
        (l: { entryNumber: string }) => l.entryNumber === entryNumber,
      );
      expect(line.basis).toEqual({ lineAmount: 10 });
      const print = await get(
        users.adminA.token,
        '/agent-portal/statement/print-data?from=2020-01-01',
      );
      expect(JSON.stringify(print.body)).not.toContain('secret-account');
      expect(JSON.stringify(print.body)).not.toContain('settlementFee');
    });

    it('S8: internal Finance evidence on an agent claim is not agent-visible', async () => {
      const claim = await prisma.payment.findFirstOrThrow({
        where: { storeOrderId: orderA1Id, deletedAt: null },
      });
      const attachment = await prisma.attachment.create({
        data: {
          fileName: `finance-${tag}.pdf`,
          originalName: `finance-evidence-${tag}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 20,
          storageProvider: 'local',
          storageKey: `tests/agent-portal/finance-${tag}.pdf`,
          uploadedById: users.internal.id,
          finalizedAt: new Date(),
        },
      });
      await prisma.paymentAttachment.create({
        data: {
          paymentId: claim.id,
          attachmentId: attachment.id,
          uploadedById: users.internal.id,
          fileUrl: `/attachments/${attachment.id}/file`,
          attachmentType: 'FINANCE_EVIDENCE',
        },
      });
      const detail = await get(
        users.salesA1.token,
        `/agent-portal/orders/${orderA1Id}`,
      );
      const ids = detail.body.payment.claims.flatMap(
        (c: { attachments: Array<{ attachmentId: string }> }) =>
          c.attachments.map((a) => a.attachmentId),
      );
      expect(ids).toContain(proofAttachmentId);
      expect(ids).not.toContain(attachment.id);
      expect(
        (
          await get(
            users.salesA1.token,
            `/agent-portal/attachments/${attachment.id}/file`,
          )
        ).status,
      ).toBe(404);
    });

    it('S7: a temporary password only unlocks profile, logout and change-password', async () => {
      const created = await post(users.adminA.token, '/agent-portal/team', {
        email: `portal-temp-${lower}@test.local`,
        username: `portal-temp-${lower}`,
        fullName: `Portal Temp ${tag}`,
      });
      expect(created.status).toBe(201);
      const token = agentToken({
        id: created.body.id,
        email: created.body.email,
        agentId: agentAId,
      });
      const blocked = await get(token, '/agent-portal/me');
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('MUST_CHANGE_PASSWORD');
      expect((await get(token, '/auth/me')).status).toBe(200);
      const wrong = await post(token, '/auth/change-password', {
        currentPassword: 'not-the-password',
        newPassword: 'N3w-Secret-Pass',
      });
      expect(wrong.status).toBe(400);
      const changed = await post(token, '/auth/change-password', {
        currentPassword: created.body.temporaryPassword,
        newPassword: 'N3w-Secret-Pass',
      });
      expect(changed.status).toBe(200);
      expect((await get(token, '/agent-portal/me')).status).toBe(200);
      // An Admin reset issues a temporary password again — blocked again.
      const reset = await post(
        users.adminA.token,
        `/agent-portal/team/${created.body.id}/reset-password`,
      );
      expect(reset.status).toBe(200);
      expect((await get(token, '/agent-portal/me')).body.code).toBe(
        'MUST_CHANGE_PASSWORD',
      );
    });

    it('S6: the internal Users API refuses agent users and lists internal users by default', async () => {
      const t = users.internal.token;
      const patch = await request(http)
        .patch(`/users/${users.salesA1.id}`)
        .set('Authorization', `Bearer ${t}`)
        .send({ fullName: 'Hijacked' });
      expect(patch.status).toBe(409);
      expect(patch.body.code).toBe('AGENT_USER_MANAGED_IN_AGENTS');
      for (const path of [
        `/users/${users.salesA1.id}/reset-password`,
        `/users/${users.salesA1.id}/permissions`,
        `/users/${users.salesA1.id}/lock`,
        `/users/${users.salesA1.id}/force-password-change`,
      ]) {
        const res = await post(t, path, { permissionNames: [] });
        expect([path, res.status]).toEqual([path, 409]);
      }
      const del = await request(http)
        .delete(`/users/${users.salesA1.id}`)
        .set('Authorization', `Bearer ${t}`);
      expect(del.status).toBe(409);
      const internalList = await get(
        t,
        `/users?search=${encodeURIComponent(`Portal salesa1 ${tag}`)}`,
      );
      expect(internalList.status).toBe(200);
      expect(internalList.body).toHaveLength(0);
      const agentList = await get(
        t,
        `/users?userType=AGENT&search=${encodeURIComponent(`Portal salesa1 ${tag}`)}`,
      );
      expect(agentList.body.map((u: { id: string }) => u.id)).toEqual([
        users.salesA1.id,
      ]);
    });

    it('countries + lead fulfillment method (default on conversion)', async () => {
      const countries = await get(
        users.salesA1.token,
        '/agent-portal/countries',
      );
      expect(countries.status).toBe(200);
      expect(countries.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: egId, code: 'EG' }),
        ]),
      );
      const lead = await post(users.salesA1.token, '/agent-portal/leads', {
        customerName: `Pickup Lead ${tag}`,
        mobileNumber: phone(),
        countryId: egId,
        fulfillmentMethod: 'PICKUP',
      });
      expect(lead.status).toBe(201);
      expect(lead.body.fulfillmentMethod).toBe('PICKUP');
      const converted = await post(
        users.salesA1.token,
        `/agent-portal/leads/${lead.body.id}/convert`,
        {
          pricingMode: 'SHIPPING_ADDED',
          lines: [{ productId: productAId, quantity: 1, lineAmount: 300 }],
        },
      );
      expect(converted.status).toBe(201);
      expect(converted.body.fulfillmentMethod).toBe('PICKUP');
      expect(converted.body.breakdown.shippingCharge).toBe(0);
    });
  });

  // ── (e) live deactivation ──────────────────────────────────────────────

  describe('deactivation', () => {
    it('a deactivated agent user gets 401 on the next request', async () => {
      expect((await get(users.salesA2.token, '/agent-portal/me')).status).toBe(
        200,
      );
      const res = await post(
        users.adminA.token,
        `/agent-portal/team/${users.salesA2.id}/deactivate`,
      );
      expect(res.status).toBe(200);
      expect(res.body.isActive).toBe(false);
      expect((await get(users.salesA2.token, '/agent-portal/me')).status).toBe(
        401,
      );
      await post(
        users.adminA.token,
        `/agent-portal/team/${users.salesA2.id}/activate`,
      );
      expect((await get(users.salesA2.token, '/agent-portal/me')).status).toBe(
        200,
      );
    });

    it('users of a deactivated agent get 401 on the next request', async () => {
      expect((await get(users.adminB.token, '/agent-portal/me')).status).toBe(
        200,
      );
      await prisma.agent.update({
        where: { id: agentBId },
        data: { status: 'INACTIVE' },
      });
      resolver.invalidate(users.adminB.id);
      expect((await get(users.adminB.token, '/agent-portal/me')).status).toBe(
        401,
      );
      expect(
        (await get(users.adminB.token, '/agent-portal/orders')).status,
      ).toBe(401);
    });
  });
});
