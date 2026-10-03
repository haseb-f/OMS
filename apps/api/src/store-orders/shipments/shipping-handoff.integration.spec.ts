/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- supertest response bodies are untyped JSON under assertion */
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
import { ExchangeRatesService } from '../../accounting/fx/exchange-rates.service';
import { AgentsService } from '../../agents/admin/agents.service';
import { AgentAgreementsService } from '../../agents/admin/agent-agreements.service';
import { AgentDestinationsService } from '../../agents/admin/agent-destinations.service';
import { AgentUsersService } from '../../agents/admin/agent-users.service';
import { StoreOrderPaymentDeclarationService } from '../payment-declaration/store-order-payment-declaration.service';
import { PaymentsService } from '../../payments/payments.service';
import { StoreOrderPaymentSyncService } from '../store-order-payment-sync.service';
import { ensureShippingQueued } from './shipping-handoff';
import {
  applyShippingHandoffRepair,
  planShippingHandoffRepair,
} from './shipping-handoff-repair';

/**
 * R6 SHIP — converted / created eligible orders reach the internal Shipping
 * queue (`GET /shipping`) without any operator action. Real HTTP pipeline
 * (AppModule, guards, JWTs) on the local Postgres with tagged fixtures.
 */
describe('R6 SHIP — Sales → Shipping queue handoff (HTTP integration)', () => {
  jest.setTimeout(300_000);
  let moduleRef: TestingModule;
  let app: INestApplication;
  let http: Server;
  let prisma: PrismaService;
  let jwt: JwtService;

  const tag = randomUUID().slice(0, 6).toUpperCase();
  const lower = tag.toLowerCase();
  let phoneSeq = 0;
  const phone = () =>
    `+2011${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}${String(++phoneSeq % 100).padStart(2, '0')}`;

  let internal: { id: string; token: string };
  let agentSales: { id: string; token: string };
  let egId: string;
  let currencyId: string;
  let agentCurrencyId: string;
  let companyProductId: string;
  let agentProductId: string;
  let agentDigitalProductId: string;
  let destinationId: string;
  let paymentMethodId: string;
  let newLeadStatusId: string;
  let shippingCompanyId: string;

  const get = (token: string, path: string) =>
    request(http).get(path).set('Authorization', `Bearer ${token}`);
  const post = (token: string, path: string, body: object = {}) =>
    request(http).post(path).set('Authorization', `Bearer ${token}`).send(body);

  /** The order's rows in the internal Shipping queue (searched by number). */
  const queueRows = async (internalOrderId: string, extra = '') => {
    const res = await get(
      internal.token,
      `/shipping?search=${internalOrderId}${extra}&pageSize=50`,
    );
    expect(res.status).toBe(200);
    return res.body.items as Array<{
      id: string;
      status: string | null;
      attemptNumber: number;
      storeOrder: { internalOrderId: string };
    }>;
  };

  const handoff = async (storeOrderId: string) => {
    const res = await get(
      internal.token,
      `/store-orders/${storeOrderId}/shipping-handoff`,
    );
    expect(res.status).toBe(200);
    return res.body as {
      applicable: boolean;
      queued: boolean;
      blocker: string | null;
    };
  };

  const liveShipments = (storeOrderId: string) =>
    prisma.shipment.count({ where: { storeOrderId, deletedAt: null } });

  const makeLead = async (
    overrides: { source?: 'MANUAL' | 'EXCEL' | 'GOOGLE_SHEETS' } = {},
  ) =>
    prisma.lead.create({
      data: {
        leadNumber: `LD-R6SHIP-${tag}-${randomUUID().slice(0, 6)}`,
        customerName: `DEMO-R6-20261001 Ship Lead ${tag}`,
        mobileNumber: phone(),
        countryId: egId,
        currencyId,
        quantity: 1,
        statusId: newLeadStatusId,
        source: overrides.source ?? 'MANUAL',
        salesEmployeeId: internal.id,
      },
    });

  const convertInternal = async (
    body: {
      paymentType: 'PREPAID' | 'CASH_ON_DELIVERY';
      fulfillmentMethod?: 'SHIPPING' | 'PICKUP';
    },
    source?: 'MANUAL' | 'EXCEL' | 'GOOGLE_SHEETS',
  ) => {
    const lead = await makeLead({ source });
    const res = await post(internal.token, `/leads/${lead.id}/convert`, {
      items: [{ productId: companyProductId, quantity: 1, agreedAmount: 300 }],
      paymentType: body.paymentType,
      fulfillmentMethod: body.fulfillmentMethod ?? 'SHIPPING',
      currencyId,
      declarationKind: 'UNPAID',
      countryId: egId,
      idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(200);
    return prisma.storeOrder.findUniqueOrThrow({
      where: { leadId: lead.id },
      select: { id: true, internalOrderId: true, source: true },
    });
  };

  const agentLeadConvert = async (body: object) => {
    const lead = await post(agentSales.token, '/agent-portal/leads', {
      customerName: `DEMO-R6-20261001 Agent Lead ${tag}`,
      mobileNumber: phone(),
      countryId: egId,
      productId: agentProductId,
      quantity: 1,
    });
    expect(lead.status).toBe(201);
    const res = await post(
      agentSales.token,
      `/agent-portal/leads/${lead.body.id}/convert`,
      {
        pricingMode: 'SHIPPING_ADDED',
        lines: [{ productId: agentProductId, quantity: 1, lineAmount: 1000 }],
        fulfillmentMethod: 'SHIPPING',
        countryId: egId,
        ...body,
      },
    );
    expect(res.status).toBe(201);
    return res.body as {
      id: string;
      internalOrderId: string;
      fulfillment: { shippingBlocker: string | null; shipments: unknown[] };
    };
  };

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

    const user = await prisma.user.create({
      data: {
        email: `r6ship-internal-${lower}@test.local`,
        username: `r6ship-internal-${lower}`,
        fullName: `DEMO-R6-20261001 Ship Internal ${tag}`,
        passwordHash: 'x',
        isSuperAdmin: true,
      },
    });
    internal = {
      id: user.id,
      token: jwt.sign({ sub: user.id, email: user.email }),
    };

    const eg = await prisma.country.findFirst({ where: { code: 'EG' } });
    if (!eg) throw new Error('Expected country EG in the local database.');
    egId = eg.id;
    newLeadStatusId = (
      await prisma.statusDefinition.findFirstOrThrow({
        where: { workflowType: 'LEAD', code: 'NEW' },
      })
    ).id;

    currencyId = (
      await prisma.currency.create({
        data: { code: `S${tag}`, name: `R6 Ship Test ${tag}` },
      })
    ).id;
    const functionalId = await moduleRef
      .get(ExchangeRatesService)
      .requireFunctionalCurrencyId();
    const rateDay = new Date();
    rateDay.setUTCDate(rateDay.getUTCDate() - 3);
    rateDay.setUTCHours(0, 0, 0, 0);
    await prisma.exchangeRate.create({
      data: {
        fromCurrencyId: currencyId,
        toCurrencyId: functionalId,
        rate: 1,
        effectiveDate: rateDay,
      },
    });
    agentCurrencyId = (
      await prisma.currency.create({
        data: { code: `A${tag}`, name: `R6 Ship Agent ${tag}` },
      })
    ).id;

    const product = await prisma.product.findFirst({
      where: { deletedAt: null, status: 'ACTIVE', ownerAgentId: null },
      select: { id: true },
    });
    if (!product) throw new Error('Expected an active company product.');
    companyProductId = product.id;

    const clearing = await prisma.chartOfAccount.create({
      data: {
        code: `R6SHIP-CLR-${tag}`,
        name: `R6 Ship Clearing ${tag}`,
        accountType: 'ASSET',
      },
    });
    paymentMethodId = (
      await prisma.paymentMethod.create({
        data: {
          name: `R6 Ship Method ${tag}`,
          accountId: clearing.id,
          requiresReconciliation: false,
        },
      })
    ).id;
    shippingCompanyId = (
      await prisma.shippingCompany.create({
        data: { name: `DEMO-R6-20261001 Carrier ${tag}` },
      })
    ).id;

    // Agent fixture (same shape as the agent portal integration spec).
    const agents = moduleRef.get(AgentsService, { strict: false });
    const agreements = moduleRef.get(AgentAgreementsService, { strict: false });
    const destinations = moduleRef.get(AgentDestinationsService, {
      strict: false,
    });
    const agentUsers = moduleRef.get(AgentUsersService, { strict: false });
    const agent = await agents.create(
      {
        name: `DEMO-R6-20261001 Ship Agent ${tag}`,
        email: `r6ship-agent-${lower}@test.local`,
        currencyId: agentCurrencyId,
      },
      internal.id,
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
      internal.id,
    );
    await agreements.upsertShippingRate(agent.id, agreement.id, {
      countryId: egId,
      amount: 100,
    });
    await agreements.activate(agent.id, agreement.id, internal.id);
    const agentMethod = await prisma.paymentMethod.create({
      data: {
        name: `R6 Ship Agent Method ${tag}`,
        requiresReconciliation: false,
      },
    });
    destinationId = (
      await destinations.create(
        agent.id,
        {
          paymentMethodId: agentMethod.id,
          ownership: 'COMPANY',
          label: `Company ${tag}`,
        },
        internal.id,
      )
    ).id;
    const categoryId = (
      await prisma.productCategory.create({
        data: { name: `r6ship-${tag}-category` },
      })
    ).id;
    const unitId = (
      await prisma.unit.create({ data: { name: `r6ship-${tag}-unit` } })
    ).id;
    const agentProduct = (suffix: string, isInventoryItem: boolean) =>
      prisma.product.create({
        data: {
          sku: `R6SHIP-${tag}-${suffix}`,
          name: `DEMO-R6-20261001 Ship Product ${suffix} ${tag}`,
          internalName: `R6 Ship Product ${suffix}`,
          displayName: `R6 Ship Product ${suffix}`,
          categoryId,
          unitId,
          type: 'PURCHASE_AND_SALE',
          isPurchasable: true,
          isSellable: true,
          isInventoryItem,
          itemType: isInventoryItem ? 'PRODUCT' : 'SERVICE',
          salesPrice: 600,
          ownerAgentId: agent.id,
          ...(isInventoryItem
            ? { weight: 1, width: 1, height: 1, length: 1 }
            : {}),
        },
      });
    agentProductId = (await agentProduct('P', true)).id;
    agentDigitalProductId = (await agentProduct('D', false)).id;
    const sales = await agentUsers.create(
      agent.id,
      {
        email: `r6ship-sales-${lower}@test.local`,
        username: `r6ship-sales-${lower}`,
        fullName: `DEMO-R6-20261001 Agent Sales ${tag}`,
        agentRole: 'SALES',
        extraPermissions: [],
      },
      internal.id,
    );
    await prisma.user.update({
      where: { id: sales.id },
      data: { mustChangePassword: false },
    });
    agentSales = {
      id: sales.id,
      token: jwt.sign({
        sub: sales.id,
        email: sales.email,
        typ: 'agent',
        agentId: agent.id,
      }),
    };
  });

  afterAll(async () => {
    await app?.close();
  });

  it('internal lead conversion (COD, Google Sheets lead) appears in GET /shipping as Ready for shipping', async () => {
    const order = await convertInternal(
      { paymentType: 'CASH_ON_DELIVERY' },
      'GOOGLE_SHEETS',
    );
    expect(order.source).toBe('GOOGLE_SHEETS');
    const rows = await queueRows(order.internalOrderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: null, attemptNumber: 1 });

    // READY_FOR_SHIPPING is accepted and maps to "no carrier status yet".
    expect(
      await queueRows(order.internalOrderId, '&status=READY_FOR_SHIPPING'),
    ).toHaveLength(1);
    expect(
      await queueRows(order.internalOrderId, '&status=SHIPPED'),
    ).toHaveLength(0);
    expect(
      await queueRows(
        order.internalOrderId,
        '&status=READY_FOR_SHIPPING,LABEL_CREATED',
      ),
    ).toHaveLength(1);
    // Every StoreOrderSource is filterable.
    expect(
      await queueRows(order.internalOrderId, '&source=GOOGLE_SHEETS'),
    ).toHaveLength(1);
    expect(
      await queueRows(order.internalOrderId, '&source=MANUAL'),
    ).toHaveLength(0);
    const ids = await get(
      internal.token,
      `/shipping/ids?status=READY_FOR_SHIPPING&search=${order.internalOrderId}`,
    );
    expect(ids.body.ids).toEqual([rows[0].id]);

    expect(await handoff(order.id)).toMatchObject({
      applicable: true,
      queued: true,
      blocker: null,
    });
    const activity = await prisma.storeOrderActivity.findFirst({
      where: { storeOrderId: order.id, action: 'SHIPMENT_CREATED' },
    });
    expect(activity?.details).toContain('queued for Shipping');
  });

  it('the existing shipment workflow runs on the auto-created attempt (no second attempt)', async () => {
    const order = await convertInternal({ paymentType: 'CASH_ON_DELIVERY' });
    const [queued] = await queueRows(order.internalOrderId);
    const assigned = await post(
      internal.token,
      `/store-orders/${order.id}/shipments/shipping-company`,
      { shippingCompanyId },
    );
    expect(assigned.status).toBe(200);
    expect(assigned.body.id).toBe(queued.id);
    const tracked = await post(
      internal.token,
      `/store-orders/${order.id}/shipments/tracking-number`,
      { trackingNumber: `TRK-${tag}` },
    );
    expect(tracked.status).toBe(200);
    expect(tracked.body.id).toBe(queued.id);
    expect(
      await prisma.shipment.count({ where: { storeOrderId: order.id } }),
    ).toBe(1);
    // Still Ready for shipping (no carrier status yet), now with a carrier.
    const rows = await queueRows(
      order.internalOrderId,
      '&status=READY_FOR_SHIPPING',
    );
    expect(rows).toHaveLength(1);
  });

  it('a queued COD order does not count as "fulfillment started" for Sales declarations', async () => {
    const order = await convertInternal({ paymentType: 'CASH_ON_DELIVERY' });
    const declarations = moduleRef.get(StoreOrderPaymentDeclarationService, {
      strict: false,
    });
    const result = await declarations.declare(
      order.id,
      {
        kind: 'PARTIAL',
        amount: 50,
        paymentMethodId,
        paymentDate: new Date().toISOString().slice(0, 10),
        currencyId,
      },
      randomUUID(),
      {
        userId: internal.id,
        origin: 'SALES_DECLARATION',
        allowCorrection: false,
      },
    );
    expect(result.declaredPaymentStatus).toBe('PARTIALLY_PAID');
    expect(await liveShipments(order.id)).toBe(1);
  });

  it('internal prepaid (unpaid) conversion is blocked with the payment reason; pickup never queues', async () => {
    const prepaid = await convertInternal({ paymentType: 'PREPAID' });
    expect(await queueRows(prepaid.internalOrderId)).toHaveLength(0);
    expect(await handoff(prepaid.id)).toMatchObject({
      queued: false,
      blocker: 'PAYMENT_REQUIRED',
    });

    const pickup = await convertInternal({
      paymentType: 'CASH_ON_DELIVERY',
      fulfillmentMethod: 'PICKUP',
    });
    expect(await queueRows(pickup.internalOrderId)).toHaveLength(0);
    expect(await liveShipments(pickup.id)).toBe(0);
    expect(await handoff(pickup.id)).toMatchObject({
      applicable: false,
      blocker: 'PICKUP',
    });
  });

  it('agent conversion, prepaid with a FULL declaration, reaches the internal queue', async () => {
    const order = await agentLeadConvert({
      paymentType: 'PREPAID',
      declaration: {
        kind: 'FULL',
        destinationId,
        paymentDate: new Date().toISOString().slice(0, 10),
        reference: `R6-FULL-${tag}`,
      },
    });
    expect(order.fulfillment.shippingBlocker).toBeNull();
    expect(order.fulfillment.shipments).toHaveLength(1);
    const rows = await queueRows(
      order.internalOrderId,
      '&status=READY_FOR_SHIPPING',
    );
    expect(rows).toHaveLength(1);
  });

  it('agent prepaid partial → blocked (read-only reason), then the full declaration queues it', async () => {
    const order = await agentLeadConvert({ paymentType: 'PREPAID' });
    expect(order.fulfillment.shippingBlocker).toBe('PAYMENT_REQUIRED');
    const today = new Date().toISOString().slice(0, 10);
    const partial = await post(
      agentSales.token,
      `/agent-portal/orders/${order.id}/payment-declaration`,
      {
        kind: 'PARTIAL',
        amount: 300,
        destinationId,
        paymentDate: today,
        idempotencyKey: `r6-partial-${tag}`,
      },
    );
    expect(partial.status).toBe(200);
    expect(partial.body.fulfillment.shippingBlocker).toBe('PAYMENT_REQUIRED');
    expect(await queueRows(order.internalOrderId)).toHaveLength(0);
    expect(await handoff(order.id)).toMatchObject({
      queued: false,
      blocker: 'PAYMENT_REQUIRED',
    });

    const full = await post(
      agentSales.token,
      `/agent-portal/orders/${order.id}/payment-declaration`,
      {
        kind: 'FULL',
        destinationId,
        paymentDate: today,
        idempotencyKey: `r6-full-${tag}`,
      },
    );
    expect(full.status).toBe(200);
    expect(full.body.fulfillment.shippingBlocker).toBeNull();
    expect(await queueRows(order.internalOrderId)).toHaveLength(1);
  });

  it('agent direct order (COD) is queued; a digital-only agent order never is', async () => {
    const create = (productId: string) =>
      post(agentSales.token, '/agent-portal/orders', {
        pricingMode: 'SHIPPING_ADDED',
        lines: [{ productId, quantity: 1, lineAmount: 400 }],
        fulfillmentMethod: 'SHIPPING',
        paymentType: 'CASH_ON_DELIVERY',
        countryId: egId,
        customer: {
          name: `DEMO-R6-20261001 Agent Customer ${tag}`,
          mobile: phone(),
          countryId: egId,
        },
        idempotencyKey: randomUUID(),
      });
    const physical = await create(agentProductId);
    expect(physical.status).toBe(201);
    expect(await queueRows(physical.body.internalOrderId)).toHaveLength(1);

    const digital = await create(agentDigitalProductId);
    expect(digital.status).toBe(201);
    expect(digital.body.fulfillment.shippingBlocker).toBe('NOT_SHIPPABLE');
    expect(await queueRows(digital.body.internalOrderId)).toHaveLength(0);
    expect(await liveShipments(digital.body.id)).toBe(0);
  });

  it('archived / cancelled orders never show an untouched attempt in the queue', async () => {
    const archived = await convertInternal({ paymentType: 'CASH_ON_DELIVERY' });
    expect(await queueRows(archived.internalOrderId)).toHaveLength(1);
    const res = await post(
      internal.token,
      `/store-orders/${archived.id}/archive`,
    );
    expect(res.status).toBe(200);
    expect(await queueRows(archived.internalOrderId)).toHaveLength(0);
    expect(await liveShipments(archived.id)).toBe(0);
    const withdrawn = await prisma.storeOrderActivity.findFirst({
      where: { storeOrderId: archived.id, action: 'SHIPPING_QUEUE_WITHDRAWN' },
    });
    expect(withdrawn).not.toBeNull();

    // Cancelled order (fulfillment CANCELLED) with an untouched attempt:
    // excluded from the queue listing.
    const cancelled = await convertInternal({
      paymentType: 'CASH_ON_DELIVERY',
    });
    const cancelledStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workflowType: 'FULFILLMENT', code: 'CANCELLED' },
    });
    await prisma.storeOrder.update({
      where: { id: cancelled.id },
      data: { fulfillmentStatusId: cancelledStatus.id },
    });
    expect(await queueRows(cancelled.internalOrderId)).toHaveLength(0);
    expect(await handoff(cancelled.id)).toMatchObject({
      blocker: 'ORDER_CANCELLED',
    });
  });

  it('ensureQueued is idempotent and concurrency-safe (one attempt #1)', async () => {
    const order = await prisma.storeOrder.create({
      data: {
        internalOrderId: `SO-R6SHIP-${tag}-C`,
        partnerId: (
          await prisma.partner.create({
            data: {
              partnerNumber: `PT-R6SHIP-${tag}`,
              name: `DEMO-R6-20261001 Concurrency ${tag}`,
            },
          })
        ).id,
        currencyId,
        paymentType: 'CASH_ON_DELIVERY',
        fulfillmentMethod: 'SHIPPING',
        shippingStage: 'READY_FOR_SHIPPING',
        items: {
          create: [
            {
              productId: companyProductId,
              quantity: 1,
              unitPrice: 100,
              agreedAmount: 100,
            },
          ],
        },
      },
    });
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        prisma.$transaction((tx) => ensureShippingQueued(tx, order.id)),
      ),
    );
    expect(results.filter((r) => r.outcome === 'QUEUED')).toHaveLength(1);
    expect(
      results.filter((r) => r.outcome === 'ALREADY_IN_SHIPPING'),
    ).toHaveLength(5);
    expect(
      await prisma.shipment.findMany({
        where: { storeOrderId: order.id },
        select: { attemptNumber: true },
      }),
    ).toEqual([{ attemptNumber: 1 }]);
    const again = await prisma.$transaction((tx) =>
      ensureShippingQueued(tx, order.id),
    );
    expect(again.outcome).toBe('ALREADY_IN_SHIPPING');
  });

  const salesActor = () => ({
    userId: internal.id,
    origin: 'SALES_DECLARATION' as const,
    allowCorrection: false,
  });
  const declareFull = (storeOrderId: string) =>
    moduleRef
      .get(StoreOrderPaymentDeclarationService, { strict: false })
      .declare(
        storeOrderId,
        {
          kind: 'FULL',
          paymentMethodId,
          paymentDate: new Date().toISOString().slice(0, 10),
          currencyId,
        },
        randomUUID(),
        salesActor(),
      );
  const attempts = (storeOrderId: string) =>
    prisma.shipment.findMany({
      where: { storeOrderId },
      orderBy: { attemptNumber: 'asc' },
      select: { attemptNumber: true, deletedAt: true },
    });

  it('archiving an order keeps a worked-on attempt (tracking) untouched', async () => {
    const order = await convertInternal({ paymentType: 'CASH_ON_DELIVERY' });
    const tracked = await post(
      internal.token,
      `/store-orders/${order.id}/shipments/tracking-number`,
      { trackingNumber: `TRK-KEEP-${tag}` },
    );
    expect(tracked.status).toBe(200);
    const res = await post(internal.token, `/store-orders/${order.id}/archive`);
    expect(res.status).toBe(200);
    const rows = await prisma.shipment.findMany({
      where: { storeOrderId: order.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deletedAt: null,
      trackingNumber: `TRK-KEEP-${tag}`,
    });
    expect(
      await prisma.storeOrderActivity.count({
        where: { storeOrderId: order.id, action: 'SHIPPING_QUEUE_WITHDRAWN' },
      }),
    ).toBe(0);
  });

  it('a rejected FULL claim withdraws the queued attempt; declaring again restores #1 (no #2)', async () => {
    const order = await convertInternal({ paymentType: 'PREPAID' });
    expect(await liveShipments(order.id)).toBe(0);
    const first = await declareFull(order.id);
    expect(await queueRows(order.internalOrderId)).toHaveLength(1);

    await moduleRef
      .get(PaymentsService, { strict: false })
      .reject(first.payment!.id, {
        rejectedById: internal.id,
        rejectionReason: 'Not received',
      });
    expect(await liveShipments(order.id)).toBe(0);
    expect(await queueRows(order.internalOrderId)).toHaveLength(0);
    expect(await handoff(order.id)).toMatchObject({
      queued: false,
      blocker: 'PAYMENT_REQUIRED',
    });
    expect(
      await prisma.storeOrderActivity.count({
        where: { storeOrderId: order.id, action: 'SHIPPING_QUEUE_WITHDRAWN' },
      }),
    ).toBe(1);

    await declareFull(order.id);
    expect(await attempts(order.id)).toEqual([
      { attemptNumber: 1, deletedAt: null },
    ]);
    expect(await queueRows(order.internalOrderId)).toHaveLength(1);
  });

  it('an amendment SHIPPING → PICKUP withdraws the untouched attempt', async () => {
    const order = await convertInternal({ paymentType: 'CASH_ON_DELIVERY' });
    expect(await liveShipments(order.id)).toBe(1);
    const changes = { fulfillmentMethod: 'PICKUP' };
    const preview = await post(
      internal.token,
      `/store-orders/${order.id}/amendments/preview`,
      { changes },
    );
    expect(preview.status).toBe(200);
    const { version } = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: order.id },
      select: { version: true },
    });
    const committed = await post(
      internal.token,
      `/store-orders/${order.id}/amendments`,
      {
        changes,
        expectedVersion: version,
        reason: 'Customer will collect',
        acknowledgements:
          (preview.body as { requiredAcknowledgements?: string[] })
            .requiredAcknowledgements ?? [],
      },
    );
    expect(committed.status).toBe(201);
    expect(await liveShipments(order.id)).toBe(0);
    expect(await queueRows(order.internalOrderId)).toHaveLength(0);
  });

  it('Finance-verified payment (payment sync) queues a prepaid order', async () => {
    const order = await convertInternal({ paymentType: 'PREPAID' });
    expect(await liveShipments(order.id)).toBe(0);
    // A claim on another order supplies the required payment columns.
    const template = await convertInternal({ paymentType: 'PREPAID' });
    const claim = (await declareFull(template.id)).payment!;
    await prisma.payment.create({
      data: {
        paymentNumber: `PAY-R6SHIP-${tag}-V`,
        senderName: claim.senderName,
        amount: 300,
        currencyId,
        paymentSourceId: claim.paymentSourceId,
        paymentMethodId: claim.paymentMethodId,
        paymentDate: claim.paymentDate,
        origin: claim.origin,
        status: 'VERIFIED',
        verifiedAt: new Date(),
        storeOrderId: order.id,
      },
    });
    await moduleRef
      .get(StoreOrderPaymentSyncService, { strict: false })
      .recompute(order.id);
    const fresh = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: order.id },
      select: { paymentStatus: true, declaredPaymentStatus: true },
    });
    expect(fresh).toMatchObject({
      paymentStatus: 'FULLY_PAID_RECONCILED',
      declaredPaymentStatus: 'UNPAID',
    });
    expect(await queueRows(order.internalOrderId)).toHaveLength(1);
  });

  it('repair: dry-run lists an eligible order; apply queues it once (BULK, audited); a second apply is a no-op', async () => {
    const partner = await prisma.partner.create({
      data: {
        partnerNumber: `PT-R6SHIP-${tag}-R`,
        name: `DEMO-R6-20261001 Repair ${tag}`,
      },
    });
    const order = await prisma.storeOrder.create({
      data: {
        internalOrderId: `SO-R6SHIP-${tag}-R`,
        partnerId: partner.id,
        currencyId,
        paymentType: 'CASH_ON_DELIVERY',
        fulfillmentMethod: 'SHIPPING',
        shippingStage: 'READY_FOR_SHIPPING',
        items: {
          create: [
            {
              productId: companyProductId,
              quantity: 1,
              unitPrice: 100,
              agreedAmount: 100,
            },
          ],
        },
      },
    });
    const plan = await planShippingHandoffRepair(prisma);
    const mine = plan.eligible.filter((row) => row.id === order.id);
    expect(mine.map((row) => row.internalOrderId)).toEqual([
      order.internalOrderId,
    ]);
    expect(await liveShipments(order.id)).toBe(0); // the dry run wrote nothing

    const scoped = { ...plan, eligible: mine };
    const applied = await applyShippingHandoffRepair(
      prisma,
      scoped,
      internal.id,
    );
    expect(applied.outcomes).toEqual({ QUEUED: 1 });
    const audit = await prisma.storeOrderActivity.findFirstOrThrow({
      where: { storeOrderId: order.id, action: 'SHIPPING_QUEUED_REPAIR' },
    });
    expect(audit).toMatchObject({ source: 'BULK', performedById: internal.id });

    const again = await applyShippingHandoffRepair(prisma, scoped, internal.id);
    expect(again.outcomes).toEqual({ ALREADY_IN_SHIPPING: 1 });
    expect(
      (await planShippingHandoffRepair(prisma)).eligible.some(
        (row) => row.id === order.id,
      ),
    ).toBe(false);
    expect(
      await prisma.shipment.count({ where: { storeOrderId: order.id } }),
    ).toBe(1);
  });

  it('agent tokens are refused on the internal Shipping endpoints', async () => {
    for (const path of [
      '/shipping',
      '/shipping/ids',
      '/shipping/statuses',
      `/store-orders/${randomUUID()}/shipping-handoff`,
    ]) {
      expect((await get(agentSales.token, path)).status).toBe(403);
    }
  });

  it('rejects an unknown status filter value', async () => {
    const res = await get(internal.token, '/shipping?status=NOT_A_STATUS');
    expect(res.status).toBe(400);
  });
});
