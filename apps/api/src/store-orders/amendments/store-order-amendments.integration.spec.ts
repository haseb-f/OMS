/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- supertest response bodies are untyped JSON under assertion */
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
import {
  PaymentOrigin,
  PaymentStatus,
  type ShipmentStatus,
} from '@prisma/client';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../common/errors/all-exceptions.filter';
import { formatValidationErrors } from '../../common/errors/format-validation-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { WorkflowStatusResolverService } from '../../workflow/workflow-status-resolver.service';
import { ExchangeRatesService } from '../../accounting/fx/exchange-rates.service';
import { StoreOrderShipmentsService } from '../shipments/store-order-shipments.service';
import { SalesInvoicesService } from '../../sales/invoices/sales-invoices.service';
import { AgentsService } from '../../agents/admin/agents.service';
import { AgentAgreementsService } from '../../agents/admin/agent-agreements.service';
import { AgentUsersService } from '../../agents/admin/agent-users.service';
import type { CreateAgreementDto } from '../../agents/admin/dto/agreement.dto';
import type { AgentOrderSnapshot } from '../../agents/common/agent-terms';
import { leakedKeys } from '../../agents/pricing/leaked-keys.test-util';

/**
 * Round 5 Spec 1A — order amendments until delivery over the real HTTP
 * pipeline (AppModule, guards, JWTs, local Postgres, tagged fixtures).
 * Acceptance items 1–7 of spec-1-orders.md.
 */
describe('Spec 1A — order amendments (HTTP integration)', () => {
  jest.setTimeout(300_000);
  let moduleRef: TestingModule;
  let app: INestApplication;
  let http: Server;
  let prisma: PrismaService;
  let jwt: JwtService;
  let resolver: PermissionsResolverService;

  const tag = randomUUID().slice(0, 6).toUpperCase();
  const lower = tag.toLowerCase();
  let seq = 0;
  const next = () => `${tag}-${++seq}`;
  const phone = () =>
    `+2011${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}${String(++seq % 100).padStart(2, '0')}`;

  let egId: string;
  let currencyId: string;
  let otherCurrencyId: string;
  let productId: string;
  let product2Id: string;
  let agentProductId: string;
  let agentAId: string;
  let paymentSourceId: string;
  let carrierCoId: string;
  const createdProductIds: string[] = [];

  type Actor = { id: string; token: string };
  const users: Record<
    'sales' | 'noAmend' | 'admin' | 'agentA' | 'agentB',
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

  const internalUser = async (
    key: string,
    permissions: string[],
    isSuperAdmin = false,
  ): Promise<Actor> => {
    const user = await prisma.user.create({
      data: {
        email: `amd-${key}-${lower}@test.local`,
        username: `amd-${key}-${lower}`,
        fullName: `Amend ${key} ${tag}`,
        passwordHash: 'x',
        isSuperAdmin,
      },
    });
    await grant(user.id, permissions);
    return {
      id: user.id,
      token: jwt.sign({ sub: user.id, email: user.email }),
    };
  };

  /** A company order (qty 1 × 100) owned by the sales user. */
  const companyOrder = async () => {
    const res = await post(users.sales, '/store-orders', {
      partner: {
        name: `Amend Customer ${next()}`,
        phone: phone(),
        countryId: egId,
      },
      currencyId,
      source: 'MANUAL',
      items: [{ productId, quantity: 1, unitPrice: 100 }],
    });
    expect(res.status).toBe(201);
    return res.body as {
      id: string;
      internalOrderId: string;
      items: Array<{ id: string }>;
      partnerId: string;
    };
  };

  const loadOrder = (id: string) =>
    prisma.storeOrder.findUniqueOrThrow({
      where: { id },
      include: {
        items: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        fulfillmentStatus: true,
      },
    });

  const addPayment = (
    storeOrderId: string,
    amount: number,
    status: PaymentStatus,
    extra: { agentId?: string; currency?: string } = {},
  ) =>
    prisma.payment.create({
      data: {
        paymentNumber: `PAY-AMD-${next()}`,
        storeOrderId,
        paymentDate: new Date(),
        amount,
        currencyId: extra.currency ?? currencyId,
        paymentSourceId,
        origin: PaymentOrigin.SALES_DECLARATION,
        senderName: 'Amend customer',
        status,
        ...(extra.agentId
          ? { agentId: extra.agentId, destinationOwnership: 'COMPANY' as const }
          : {}),
      },
    });

  const addShipment = (
    storeOrderId: string,
    status: ShipmentStatus,
    trackingNumber: string | null = null,
  ) =>
    prisma.shipment.create({
      data: { storeOrderId, attemptNumber: 1, status, trackingNumber },
    });

  const amountChange = (
    order: { items: Array<{ id: string }> },
    amount: number,
  ) => ({
    items: [
      {
        itemId: order.items[0].id,
        productId,
        quantity: 1,
        agreedAmount: amount,
      },
    ],
  });

  const preview = (
    actor: Actor,
    id: string,
    changes: object,
    base = '/store-orders',
  ) => post(actor, `${base}/${id}/amendments/preview`, { changes });

  const commit = (
    actor: Actor,
    id: string,
    body: {
      changes: object;
      expectedVersion: number;
      reason?: string;
      acknowledgements?: string[];
      impactsFingerprint?: string;
    },
    base = '/store-orders',
  ) =>
    post(actor, `${base}/${id}/amendments`, {
      reason: 'Customer asked for a change',
      ...body,
    });

  const codes = (body: { impacts: Array<{ code: string }> }) =>
    body.impacts.map((i) => i.code);

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
    const agentUsers = moduleRef.get(AgentUsersService, { strict: false });

    const eg = await prisma.country.findFirst({ where: { code: 'EG' } });
    if (!eg) throw new Error('Expected country EG in the local database.');
    egId = eg.id;
    // Functional currency for the agent agreement (no FX needed).
    currencyId = await moduleRef
      .get(ExchangeRatesService, { strict: false })
      .requireFunctionalCurrencyId();
    otherCurrencyId = (
      await prisma.currency.create({
        data: { code: `A${tag}`, name: `Amend Test ${tag}` },
      })
    ).id;
    paymentSourceId = (
      await prisma.paymentSource.findFirstOrThrow({
        where: { deletedAt: null, isActive: true },
      })
    ).id;
    carrierCoId = (
      await prisma.shippingCompany.create({
        data: { name: `Amend carrier ${tag}`, type: 'EXTERNAL_COMPANY' },
      })
    ).id;
    const categoryId = (
      await prisma.productCategory.create({
        data: { name: `amd-${tag}-category` },
      })
    ).id;
    const unitId = (
      await prisma.unit.create({ data: { name: `amd-${tag}-unit` } })
    ).id;
    const makeProduct = async (suffix: string, owner: string | null) => {
      const product = await prisma.product.create({
        data: {
          sku: `AMD-${tag}-${suffix}`,
          name: `Amend Product ${suffix} ${tag}`,
          internalName: `Amend Product ${suffix}`,
          displayName: `Amend Product ${suffix}`,
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
          ownerAgentId: owner,
        },
      });
      createdProductIds.push(product.id);
      return product.id;
    };
    productId = await makeProduct('P1', null);
    product2Id = await makeProduct('P2', null);

    users.sales = await internalUser('sales', [
      'store-orders.view',
      'store-orders.create',
      'store-orders.edit',
      'store-orders.amend',
      'partners.edit',
      'agents.view',
      'crm.leads.manage',
    ]);
    users.noAmend = await internalUser('noamend', [
      'store-orders.view',
      'store-orders.edit',
      'crm.leads.manage',
    ]);
    users.admin = await internalUser('admin', [], true);

    const terms: CreateAgreementDto = {
      effectiveFrom: '2020-01-01',
      productCommissionRatePercent: 10,
      serviceCommissionRatePercent: 10,
      shippingPolicy: 'PREDETERMINED_CHARGE',
      commissionEarningEvent: 'DELIVERED',
      returnCommissionTreatment: 'REVERSE',
      customerShippingChargeOwner: 'COMPANY',
      providerFeesBorneBy: 'AGENT',
      shippingFeePerShipment: 0,
      returnFeePerShipment: 0,
      serviceFeePerOrder: 0,
      allowAgentDestinations: false,
      payoutHoldDays: 0,
    };
    const makeAgent = async (suffix: string) => {
      const agent = await agents.create(
        {
          name: `Amend Agent ${suffix} ${tag}`,
          email: `amd-agent-${suffix.toLowerCase()}-${lower}@test.local`,
          currencyId,
        },
        users.admin.id,
      );
      const agreement = await agreements.create(
        agent.id,
        terms,
        users.admin.id,
      );
      for (const tariff of [
        { deliveryChannel: 'CARRIER', paymentType: 'PREPAID', amount: 25 },
        {
          deliveryChannel: 'CARRIER',
          paymentType: 'CASH_ON_DELIVERY',
          amount: 35,
        },
        {
          deliveryChannel: 'INTERNAL_COURIER',
          paymentType: 'CASH_ON_DELIVERY',
          amount: 25,
        },
      ]) {
        const res = await request(http)
          .put(`/agents/${agent.id}/agreements/${agreement.id}/shipping-rates`)
          .set('Authorization', `Bearer ${users.admin.token}`)
          .send({ countryId: egId, ...tariff });
        expect(res.status).toBe(200);
      }
      await agreements.activate(agent.id, agreement.id, users.admin.id);
      const created = await agentUsers.create(
        agent.id,
        {
          email: `amd-agentuser-${suffix.toLowerCase()}-${lower}@test.local`,
          username: `amd-agentuser-${suffix.toLowerCase()}-${lower}`,
          fullName: `Amend Agent User ${suffix} ${tag}`,
          agentRole: 'ADMIN',
        },
        users.admin.id,
      );
      await prisma.user.update({
        where: { id: created.id },
        data: { mustChangePassword: false },
      });
      return {
        agentId: agent.id,
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
    users.agentA = a.actor;
    users.agentB = b.actor;
    agentProductId = await makeProduct('AGA', agentAId);
  });

  afterAll(async () => {
    if (prisma && createdProductIds.length) {
      await prisma.product.updateMany({
        where: { id: { in: createdProductIds } },
        data: { deletedAt: new Date(), status: 'INACTIVE' },
      });
    }
    await app?.close();
  });

  // ── Acceptance 1 — unpaid order ─────────────────────────────────────────

  it('acceptance 1 — unpaid: items, quantities, prices and currency recomputed, audited, version +1', async () => {
    const order = await companyOrder();
    const changes = {
      items: [
        {
          itemId: order.items[0].id,
          productId,
          quantity: 2,
          agreedAmount: 180,
        },
        { productId: product2Id, quantity: 1, agreedAmount: 50 },
      ],
      currencyId: otherCurrencyId,
    };
    const denied = await preview(users.noAmend, order.id, changes);
    expect(denied.status).toBe(403);

    const res = await preview(users.sales, order.id, changes);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      version: 0,
      canCommit: true,
      requiredAcknowledgements: [],
      totals: { previous: '100.00', next: '230.00' },
    });
    expect(codes(res.body)).toContain('TOTALS_CHANGED');
    // Preview never writes.
    expect((await loadOrder(order.id)).items).toHaveLength(1);

    const noReason = await post(
      users.sales,
      `/store-orders/${order.id}/amendments`,
      {
        changes,
        expectedVersion: 0,
      },
    );
    expect(noReason.status).toBe(400);

    const done = await commit(users.sales, order.id, {
      changes,
      expectedVersion: 0,
    });
    expect(done.status).toBe(201);
    expect(done.body.version).toBe(1);
    expect(done.body.order.total).toBe('230.00');

    const saved = await loadOrder(order.id);
    expect(saved.version).toBe(1);
    expect(saved.currencyId).toBe(otherCurrencyId);
    expect(saved.items.map((i) => Number(i.agreedAmount)).sort()).toEqual(
      [180, 50].sort(),
    );
    expect(saved.items.find((i) => i.productId === productId)?.quantity).toBe(
      2,
    );

    const amendments = await prisma.storeOrderAmendment.findMany({
      where: { storeOrderId: order.id },
    });
    expect(amendments).toHaveLength(1);
    expect(amendments[0]).toMatchObject({
      version: 1,
      reason: 'Customer asked for a change',
      actorId: users.sales.id,
      actorType: 'INTERNAL',
    });
    const snapshot = amendments[0].previousSnapshot as {
      lines: unknown[];
      payableTotal: string;
    };
    expect(snapshot.payableTotal).toBe('100.00');
    expect(snapshot.lines).toHaveLength(1);
    const activity = await prisma.storeOrderActivity.findFirst({
      where: { storeOrderId: order.id, action: 'ORDER_AMENDED' },
    });
    expect(activity?.details).toContain('reason: Customer asked for a change');

    const history = await get(
      users.sales,
      `/store-orders/${order.id}/amendments`,
    );
    expect(history.status).toBe(200);
    expect(history.body[0]).toMatchObject({
      version: 1,
      actorType: 'INTERNAL',
    });

    // Another commercial mutation path also bumps the version.
    const lineAmounts = await post(
      users.sales,
      `/store-orders/${order.id}/line-amounts`,
      {
        items: [{ itemId: saved.items[0].id, agreedAmount: 190 }],
      },
    );
    expect(lineAmounts.status).toBe(200);
    expect((await loadOrder(order.id)).version).toBe(2);

    const nothing = await preview(users.sales, order.id, {
      currencyId: otherCurrencyId,
    });
    expect(nothing.status).toBe(400);
    expect(nothing.body.code).toBe('AMENDMENT_NO_CHANGES');
  });

  // ── Acceptance 2 — declared (not posted) payment ─────────────────────────

  it('acceptance 2 — declared paid: declaration kept, discrepancy re-evaluated; currency change flags it for Finance', async () => {
    const order = await companyOrder();
    const declaration = await addPayment(order.id, 100, PaymentStatus.PENDING);
    await prisma.storeOrder.update({
      where: { id: order.id },
      data: { declaredPaymentStatus: 'PAID', declaredAmount: 100 },
    });
    const changes = amountChange(order, 80);
    const res = await preview(users.sales, order.id, changes);
    expect(res.status).toBe(200);
    expect(res.body.requiredAcknowledgements).toEqual([
      'DECLARATION_REEVALUATED',
    ]);

    const unacknowledged = await commit(users.sales, order.id, {
      changes,
      expectedVersion: 0,
    });
    expect(unacknowledged.status).toBe(409);
    expect(unacknowledged.body.code).toBe('AMENDMENT_ACKNOWLEDGEMENT_REQUIRED');

    const done = await commit(users.sales, order.id, {
      changes,
      expectedVersion: 0,
      acknowledgements: ['DECLARATION_REEVALUATED'],
    });
    expect(done.status).toBe(201);
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: declaration.id },
    });
    expect(Number(payment.amount)).toBe(100);
    expect(payment.status).toBe('PENDING');
    let saved = await loadOrder(order.id);
    expect(Number(saved.declaredAmount)).toBe(100);
    expect(saved.declaredPaymentStatus).toBe('PAID');
    expect(saved.paymentDiscrepancy).toBe(true);
    expect(saved.paymentDiscrepancyReason).toContain(
      'exceeds the amended total 80.00',
    );

    const currency = await preview(users.sales, order.id, {
      currencyId: otherCurrencyId,
    });
    expect(currency.body.requiredAcknowledgements).toContain(
      'CURRENCY_DECLARATIONS_REVIEW',
    );
    const switched = await commit(users.sales, order.id, {
      changes: { currencyId: otherCurrencyId },
      expectedVersion: 1,
      acknowledgements: ['CURRENCY_DECLARATIONS_REVIEW'],
    });
    expect(switched.status).toBe(201);
    saved = await loadOrder(order.id);
    expect(saved.currencyId).toBe(otherCurrencyId);
    expect(saved.paymentDiscrepancyReason).toContain('need Finance review');
    // The declaration keeps its original currency and amount.
    const after = await prisma.payment.findUniqueOrThrow({
      where: { id: declaration.id },
    });
    expect(after.currencyId).toBe(currencyId);
  });

  // ── Acceptance 3 — posted payment, undelivered ──────────────────────────

  it('acceptance 3 — posted: amount down → OVERPAID + refund pointer, payment unchanged; currency change blocked with the exact prior step', async () => {
    const order = await companyOrder();
    const posted = await addPayment(order.id, 100, PaymentStatus.VERIFIED);
    await prisma.storeOrder.update({
      where: { id: order.id },
      data: {
        paymentStatus: 'FULLY_PAID_RECONCILED',
        declaredPaymentStatus: 'PAID',
        declaredAmount: 100,
      },
    });
    const changes = amountChange(order, 80);
    const res = await preview(users.sales, order.id, changes);
    const refund = res.body.impacts.find(
      (i: { code: string }) => i.code === 'PAYMENT_OVERPAID_REFUND',
    );
    expect(refund).toMatchObject({
      severity: 'ACKNOWLEDGE',
      params: { excess: '20.00' },
    });
    expect(refund.message).toContain('Customer refunds');

    const done = await commit(users.sales, order.id, {
      changes,
      expectedVersion: 0,
      acknowledgements: ['PAYMENT_OVERPAID_REFUND'],
    });
    expect(done.status).toBe(201);
    const saved = await loadOrder(order.id);
    expect(saved.paymentStatus).toBe('OVERPAID');
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: posted.id },
    });
    expect(Number(payment.amount)).toBe(100);
    expect(payment.status).toBe('VERIFIED');

    const currency = await preview(users.sales, order.id, {
      currencyId: otherCurrencyId,
    });
    expect(currency.body.canCommit).toBe(false);
    const blocked = currency.body.impacts.find(
      (i: { code: string }) => i.code === 'CURRENCY_LOCKED_BY_PAYMENT',
    );
    expect(blocked.severity).toBe('BLOCKING');
    expect(blocked.message).toContain(
      `Reverse or refund payment ${posted.paymentNumber} (100.00`,
    );
    const refused = await commit(users.sales, order.id, {
      changes: { currencyId: otherCurrencyId },
      expectedVersion: 1,
    });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('AMENDMENT_BLOCKED');
    expect((await loadOrder(order.id)).currencyId).toBe(currencyId);
  });

  // ── Acceptance 4 — window ───────────────────────────────────────────────

  it('acceptance 4 — delivered / collected refused; in transit: items refused, price allowed', async () => {
    const delivered = await companyOrder();
    await addShipment(delivered.id, 'DELIVERED');
    const locked = await preview(
      users.sales,
      delivered.id,
      amountChange(delivered, 90),
    );
    expect(locked.body.canCommit).toBe(false);
    expect(codes(locked.body)).toEqual(['ORDER_LOCKED_AFTER_DELIVERY']);
    expect(
      (
        await commit(users.sales, delivered.id, {
          changes: amountChange(delivered, 90),
          expectedVersion: 0,
        })
      ).status,
    ).toBe(422);

    const collected = await companyOrder();
    await prisma.storeOrder.update({
      where: { id: collected.id },
      data: {
        fulfillmentMethod: 'PICKUP',
        fulfillmentStatusId: moduleRef
          .get(WorkflowStatusResolverService, { strict: false })
          .fulfillmentStatusIdByCode('COLLECTED'),
      },
    });
    expect(
      codes(
        (await preview(users.sales, collected.id, amountChange(collected, 90)))
          .body,
      ),
    ).toEqual(['ORDER_LOCKED_AFTER_DELIVERY']);

    const transit = await companyOrder();
    await addShipment(transit.id, 'SHIPPED', `TRK-${next()}`);
    const items = await preview(users.sales, transit.id, {
      items: [
        {
          itemId: transit.items[0].id,
          productId,
          quantity: 3,
          agreedAmount: 100,
        },
      ],
    });
    expect(items.body.canCommit).toBe(false);
    expect(codes(items.body)).toContain('ORDER_IN_TRANSIT');
    const price = await commit(users.sales, transit.id, {
      changes: amountChange(transit, 120),
      expectedVersion: 0,
    });
    expect(price.status).toBe(201);
    expect(price.body.order.total).toBe('120.00');
  });

  // ── Acceptance 5 — concurrency ──────────────────────────────────────────

  it('acceptance 5 — a second commit on a stale version is 409 ORDER_VERSION_CONFLICT', async () => {
    const order = await companyOrder();
    const [first, second] = [
      amountChange(order, 110),
      amountChange(order, 130),
    ];
    expect((await preview(users.sales, order.id, first)).body.version).toBe(0);
    expect((await preview(users.sales, order.id, second)).body.version).toBe(0);
    expect(
      (
        await commit(users.sales, order.id, {
          changes: first,
          expectedVersion: 0,
        })
      ).status,
    ).toBe(201);
    const stale = await commit(users.sales, order.id, {
      changes: second,
      expectedVersion: 0,
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      code: 'ORDER_VERSION_CONFLICT',
      details: { currentVersion: 1, changedBy: expect.any(String) },
    });
    expect(stale.body.message).toContain('Reload to see the latest version');
    expect(Number((await loadOrder(order.id)).items[0].agreedAmount)).toBe(110);
  });

  // ── Acceptance 6 — label issued ─────────────────────────────────────────

  it('acceptance 6 — label issued: acknowledgement required, shipment flagged for reissue', async () => {
    const order = await companyOrder();
    const tracking = `TRK-${next()}`;
    const shipment = await addShipment(order.id, 'LABEL_CREATED', tracking);
    const changes = {
      items: [
        {
          itemId: order.items[0].id,
          productId,
          quantity: 2,
          agreedAmount: 200,
        },
      ],
    };
    const res = await preview(users.sales, order.id, changes);
    const label = res.body.impacts.find(
      (i: { code: string }) => i.code === 'LABEL_REISSUE_REQUIRED',
    );
    expect(label).toMatchObject({
      severity: 'ACKNOWLEDGE',
      params: { tracking },
    });
    expect(
      (await commit(users.sales, order.id, { changes, expectedVersion: 0 }))
        .status,
    ).toBe(409);
    const done = await commit(users.sales, order.id, {
      changes,
      expectedVersion: 0,
      acknowledgements: ['LABEL_REISSUE_REQUIRED'],
    });
    expect(done.status).toBe(201);
    const flagged = await prisma.shipment.findUniqueOrThrow({
      where: { id: shipment.id },
    });
    expect(flagged.labelReissueRequired).toBe(true);
    expect(flagged.labelReissueRequestedById).toBe(users.sales.id);
    expect(
      await prisma.storeOrderActivity.count({
        where: { storeOrderId: order.id, action: 'LABEL_REISSUE_REQUIRED' },
      }),
    ).toBe(1);

    const shipments = moduleRef.get(StoreOrderShipmentsService, {
      strict: false,
    });
    await expect(shipments.markShipped(order.id)).rejects.toMatchObject({
      response: { code: 'LABEL_REISSUE_REQUIRED' },
    });
    // Review HIGH 1 — imports / sheet sync cannot record the flagged
    // parcel as shipped either, unless the same update brings a new label.
    await expect(
      shipments.setStatus(order.id, 'SHIPPED'),
    ).rejects.toMatchObject({
      response: { code: 'LABEL_REISSUE_REQUIRED' },
    });
    await expect(
      shipments.setStatus(order.id, 'DELIVERED'),
    ).rejects.toMatchObject({
      response: { code: 'LABEL_REISSUE_REQUIRED' },
    });
    await shipments.setLabel(order.id, 'https://labels.test/new.pdf');
    expect(
      (await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } }))
        .labelReissueRequired,
    ).toBe(false);
  });

  // ── Review findings ─────────────────────────────────────────────────────

  it('HIGH 1 — an import that brings a new label ships the flagged parcel and clears the flag', async () => {
    const order = await companyOrder();
    const shipment = await addShipment(
      order.id,
      'LABEL_CREATED',
      `TRK-${next()}`,
    );
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: { labelReissueRequired: true },
    });
    const shipments = moduleRef.get(StoreOrderShipmentsService, {
      strict: false,
    });
    await shipments.setStatus(order.id, 'SHIPPED', undefined, {
      labelReissued: true,
    });
    const after = await prisma.shipment.findUniqueOrThrow({
      where: { id: shipment.id },
    });
    expect(after).toMatchObject({
      status: 'SHIPPED',
      labelReissueRequired: false,
    });
  });

  it('MEDIUM 6 — COD with a label issued: a total change needs the label reissued; prepaid does not', async () => {
    const cod = await companyOrder();
    await prisma.storeOrder.update({
      where: { id: cod.id },
      data: { paymentType: 'CASH_ON_DELIVERY' },
    });
    await addShipment(cod.id, 'LABEL_CREATED', `TRK-${next()}`);
    expect(
      codes((await preview(users.sales, cod.id, amountChange(cod, 90))).body),
    ).toContain('LABEL_REISSUE_REQUIRED');
    const prepaid = await companyOrder();
    await addShipment(prepaid.id, 'LABEL_CREATED', `TRK-${next()}`);
    expect(
      codes(
        (await preview(users.sales, prepaid.id, amountChange(prepaid, 90)))
          .body,
      ),
    ).not.toContain('LABEL_REISSUE_REQUIRED');
    // Switching prepaid → COD changes what the carrier collects.
    expect(
      codes(
        (
          await preview(users.sales, prepaid.id, {
            paymentType: 'CASH_ON_DELIVERY',
          })
        ).body,
      ),
    ).toContain('LABEL_REISSUE_REQUIRED');
  });

  it('MEDIUM 5/8 — customer switch: another address is a destination change; out-of-scope customers are refused', async () => {
    const order = await companyOrder();
    await addShipment(order.id, 'LABEL_CREATED', `TRK-${next()}`);
    const other = await prisma.partner.create({
      data: {
        partnerNumber: `AMD-P-${next()}`,
        name: `Amend other ${tag}`,
        city: 'Alexandria',
        address: 'Other street',
        countryId: egId,
        roles: { create: { role: 'CUSTOMER' } },
      },
    });
    const switched = await preview(users.sales, order.id, {
      customer: { partnerId: other.id },
      destination: {
        countryId: egId,
        city: 'Alexandria',
        address: 'Other street',
      },
    });
    expect(codes(switched.body)).toEqual(
      expect.arrayContaining(['LABEL_REISSUE_REQUIRED']),
    );
    expect(codes(switched.body)).not.toContain('CUSTOMER_OUT_OF_SCOPE');

    // An own-scope user may not attach another owner's customer.
    const own = await internalUser('own', [
      'store-orders.view',
      'store-orders.create',
      'store-orders.edit',
      'store-orders.amend',
    ]);
    const ownOrder = await post(own, '/store-orders', {
      partner: {
        name: `Own customer ${next()}`,
        phone: phone(),
        countryId: egId,
      },
      currencyId,
      source: 'MANUAL',
      items: [{ productId, quantity: 1, unitPrice: 100 }],
    });
    expect(ownOrder.status).toBe(201);
    const foreign = await preview(own, ownOrder.body.id, {
      customer: { partnerId: order.partnerId },
    });
    expect(foreign.status).toBe(200);
    expect(codes(foreign.body)).toContain('CUSTOMER_OUT_OF_SCOPE');
    expect(foreign.body.canCommit).toBe(false);
  });

  it('MEDIUM 4 — a cancelled store-order invoice cannot return to draft while another invoice exists', async () => {
    const order = await companyOrder();
    const cancelled = await prisma.salesInvoice.create({
      data: {
        invoiceNumber: `AMD-INV-${next()}`,
        partnerId: order.partnerId,
        storeOrderId: order.id,
        status: 'CANCELLED',
      },
    });
    const active = await prisma.salesInvoice.create({
      data: {
        invoiceNumber: `AMD-INV-${next()}`,
        partnerId: order.partnerId,
        storeOrderId: order.id,
        status: 'CONFIRMED',
      },
    });
    const invoices = moduleRef.get(SalesInvoicesService, { strict: false });
    await expect(invoices.returnToDraft(cancelled.id)).rejects.toMatchObject({
      response: { code: 'STORE_ORDER_ALREADY_INVOICED' },
    });
    expect(
      (
        await prisma.salesInvoice.findUniqueOrThrow({
          where: { id: cancelled.id },
        })
      ).status,
    ).toBe('CANCELLED');
    expect(active.status).toBe('CONFIRMED');
  });

  it('LOW — a commit against a changed impact set is a stale preview (409)', async () => {
    const order = await companyOrder();
    const changes = amountChange(order, 80);
    const first = await preview(users.sales, order.id, changes);
    await addPayment(order.id, 100, PaymentStatus.VERIFIED);
    const stale = await commit(users.sales, order.id, {
      changes,
      expectedVersion: 0,
      impactsFingerprint: first.body.impactsFingerprint,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('AMENDMENT_PREVIEW_STALE');
  });

  // ── Acceptance 7 — agent orders ─────────────────────────────────────────

  describe('acceptance 7 — agent orders', () => {
    const portal = '/agent-portal/orders';
    const createAgentOrder = async (over: object = {}) => {
      const res = await post(users.agentA, portal, {
        pricingMode: 'SHIPPING_ADDED',
        lines: [{ productId: agentProductId, quantity: 1, lineAmount: 400 }],
        fulfillmentMethod: 'SHIPPING',
        paymentType: 'CASH_ON_DELIVERY',
        countryId: egId,
        city: 'Cairo',
        customer: {
          name: `Agent customer ${next()}`,
          mobile: phone(),
          countryId: egId,
        },
        ...over,
      });
      expect(res.status).toBe(201);
      return await loadOrder(res.body.id);
    };

    it('re-quotes pricing, tariff and commission; the previous snapshot stays in the amendment', async () => {
      const order = await createAgentOrder();
      expect(order.shippingPricingStatus).toBe('PENDING_METHOD');
      expect(Number(order.payableTotal)).toBe(435);

      const changes = {
        items: [
          {
            itemId: order.items[0].id,
            productId: agentProductId,
            quantity: 2,
            agreedAmount: 700,
          },
        ],
        paymentType: 'PREPAID',
      };
      const res = await preview(users.agentA, order.id, changes, portal);
      expect(res.status).toBe(200);
      expect(codes(res.body)).toEqual(
        expect.arrayContaining([
          'AGENT_REQUOTED',
          'AGENT_SHIPPING_REPRICED',
          'TOTALS_CHANGED',
        ]),
      );
      expect(leakedKeys(res.body)).toEqual([]);

      const done = await commit(
        users.agentA,
        order.id,
        { changes, expectedVersion: 0 },
        portal,
      );
      expect(done.status).toBe(201);
      expect(leakedKeys(done.body)).toEqual([]);
      const saved = await loadOrder(order.id);
      expect(Number(saved.payableTotal)).toBe(725);
      expect(saved.paymentType).toBe('PREPAID');
      const snapshot =
        saved.agentTermsSnapshot as unknown as AgentOrderSnapshot;
      expect(snapshot.agentShippingCharge).toMatchObject({
        amount: 25,
        paymentType: 'PREPAID',
      });
      expect(snapshot.lines?.[0].commission).toBeDefined();
      const amendment = await prisma.storeOrderAmendment.findFirstOrThrow({
        where: { storeOrderId: order.id },
      });
      expect(amendment.actorType).toBe('AGENT');
      const previous = amendment.previousSnapshot as unknown as {
        agentTermsSnapshot: AgentOrderSnapshot;
        payableTotal: string;
      };
      expect(previous.payableTotal).toBe('435.00');
      expect(previous.agentTermsSnapshot.agentShippingCharge?.amount).toBe(35);

      // Shipping chose the carrier; a later payment-type change re-resolves
      // the tariff for that channel (internal amendment).
      await prisma.storeOrder.update({
        where: { id: order.id },
        data: { declaredPaymentStatus: 'PAID', declaredAmount: 725 },
      });
      const assigned = await post(
        users.admin,
        `/store-orders/${order.id}/shipments/shipping-company`,
        {
          shippingCompanyId: carrierCoId,
        },
      );
      expect(assigned.status).toBe(200);
      const assignedOrder = await loadOrder(order.id);
      expect(assignedOrder.shippingPricingStatus).toBe('CONFIRMED');
      // The W2 re-pricing on assignment is a commercial mutation too.
      expect(assignedOrder.version).toBe(2);

      // Review HIGH 3 — an amount-only amendment never re-reads live
      // tariffs: an agreement edit after submission changes nothing.
      await prisma.agentShippingRate.updateMany({
        where: {
          agreement: { agentId: agentAId },
          deliveryChannel: 'CARRIER',
          paymentType: 'PREPAID',
        },
        data: { amount: 99 },
      });
      const amountOnly = {
        items: [
          {
            itemId: assignedOrder.items[0].id,
            productId: agentProductId,
            quantity: 2,
            agreedAmount: 650,
          },
        ],
      };
      const frozenPreview = await preview(users.sales, order.id, amountOnly);
      expect(frozenPreview.body.totals.next).toBe('675.00');
      expect(codes(frozenPreview.body)).not.toContain(
        'AGENT_SHIPPING_REPRICED',
      );
      expect(
        (
          await commit(users.sales, order.id, {
            changes: amountOnly,
            expectedVersion: 2,
          })
        ).status,
      ).toBe(201);
      const frozen = await loadOrder(order.id);
      const frozenSnap =
        frozen.agentTermsSnapshot as unknown as AgentOrderSnapshot;
      expect(frozenSnap.agentShippingCharge).toMatchObject({
        amount: 25,
        source: 'TARIFF',
        deliveryChannel: 'CARRIER',
      });
      expect(frozenSnap.agentShippingCharge?.byChannel?.CARRIER?.amount).toBe(
        25,
      );
      expect(Number(frozen.shippingCharge)).toBe(25);
      expect(Number(frozen.payableTotal)).toBe(675);

      // Review HIGH 2 — with the delivery method chosen, the preview shows
      // the payable the confirmed fee yields and the commit ends there, with
      // declared / Finance statuses computed on it.
      const cod = await preview(users.sales, order.id, {
        paymentType: 'CASH_ON_DELIVERY',
      });
      expect(cod.body.totals.next).toBe('685.00');
      const repriced = cod.body.impacts.find(
        (i: { code: string }) => i.code === 'AGENT_SHIPPING_REPRICED',
      );
      expect(repriced.params).toMatchObject({
        next: '35.00',
        nextStatus: 'CONFIRMED',
      });
      const internal = await commit(users.sales, order.id, {
        changes: { paymentType: 'CASH_ON_DELIVERY' },
        expectedVersion: frozen.version,
        impactsFingerprint: cod.body.impactsFingerprint,
      });
      expect(internal.status).toBe(201);
      const final = await loadOrder(order.id);
      expect(final.shippingPricingStatus).toBe('CONFIRMED');
      expect(Number(final.shippingCharge)).toBe(35);
      expect(Number(final.payableTotal)).toBe(685);
      // Declared 725 (set above, no claim rows) → recomputed on 685: unpaid.
      expect(final.declaredPaymentStatus).toBe('UNPAID');
      expect(internal.body.version).toBe(final.version);
    });

    it('earned commission → blocked', async () => {
      const order = await createAgentOrder({ fulfillmentMethod: 'PICKUP' });
      await prisma.storeOrder.update({
        where: { id: order.id },
        data: { agentEarnedAt: new Date() },
      });
      const res = await preview(
        users.agentA,
        order.id,
        {
          items: [
            {
              itemId: order.items[0].id,
              productId: agentProductId,
              quantity: 1,
              agreedAmount: 300,
            },
          ],
        },
        portal,
      );
      expect(res.body.canCommit).toBe(false);
      expect(codes(res.body)).toContain('AGENT_COMMISSION_EARNED');
    });

    it('another agent’s order is 404; an agent cannot amend an order with a posted payment', async () => {
      const order = await createAgentOrder({ fulfillmentMethod: 'PICKUP' });
      const changes = {
        items: [
          {
            itemId: order.items[0].id,
            productId: agentProductId,
            quantity: 1,
            agreedAmount: 450,
          },
        ],
      };
      const foreign = await preview(users.agentB, order.id, changes, portal);
      expect(foreign.status).toBe(404);
      expect(
        (
          await commit(
            users.agentB,
            order.id,
            { changes, expectedVersion: 0 },
            portal,
          )
        ).status,
      ).toBe(404);

      await addPayment(order.id, 100, PaymentStatus.VERIFIED, {
        agentId: agentAId,
      });
      const agent = await preview(users.agentA, order.id, changes, portal);
      expect(agent.body.canCommit).toBe(false);
      expect(codes(agent.body)).toContain('AGENT_FINANCIAL_RECORDS');
      expect(leakedKeys(agent.body)).toEqual([]);
      // Internal staff may still amend it (posted payment never edited).
      const staff = await preview(users.sales, order.id, changes);
      expect(codes(staff.body)).not.toContain('AGENT_FINANCIAL_RECORDS');
    });
  });
});
