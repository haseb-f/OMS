/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- supertest response bodies are untyped JSON under assertion */
import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  HttpException,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import type { Server } from 'http';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AccountType, PaymentOrigin, PaymentStatus } from '@prisma/client';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../common/errors/all-exceptions.filter';
import { formatValidationErrors } from '../../common/errors/format-validation-errors';
import {
  addCalendarDays,
  todayBusinessDate,
} from '../../common/time/business-date';
import { PrismaService } from '../../prisma/prisma.service';
import { UserSessionsService } from '../../auth/sessions/user-sessions.service';
import { InventoryService } from '../../inventory/inventory.service';
import { ExchangeRatesService } from '../../accounting/fx/exchange-rates.service';
import { PaymentsService } from '../../payments/payments.service';
import { StoreOrderShipmentOperationsService } from '../../store-orders/shipments/store-order-shipment-operations.service';
import { AgentsService } from '../admin/agents.service';
import { AgentAgreementsService } from '../admin/agent-agreements.service';
import { AgentUsersService } from '../admin/agent-users.service';
import { AgentOrdersService } from '../orders/agent-orders.service';
import { AgentStatementService } from '../finance/agent-statement.service';
import { AgentCommissionReportService } from '../finance/agent-commission-report.service';
import type { CreateAgreementDto } from '../admin/dto/agreement.dto';
import type { CreateAgentOrderDto } from '../orders/dto/agent-order.dto';
import type { AgentOrderSnapshot } from '../common/agent-terms';
import { leakedKeys } from '../pricing/leaked-keys.test-util';
import { SHIPPING_AGREEMENT_ENTITY } from './agent-shipping-agreements.service';

async function expectCode(promise: Promise<unknown>, code: string) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(HttpException);
  expect((caught as HttpException).getResponse()).toMatchObject({ code });
  return (caught as HttpException).getResponse() as { message: string };
}

/**
 * R15 W3 (D15-13) acceptance — the agent shipping agreement document
 * (Agent → Settings): draft CRUD and validation, activation (overlap,
 * replace from date, coverage), deactivate / discard / duplicate, the
 * agreement in force on the order date at submission, actionable missing
 * messages, no repricing, the portal view, and the worked example 3.11.
 * Real HTTP pipeline (AppModule, guards, JWTs) on the local Postgres.
 */
describe('R15 W3 — agent shipping agreements (HTTP integration)', () => {
  jest.setTimeout(300_000);
  let moduleRef: TestingModule;
  let app: INestApplication;
  let http: Server;
  let prisma: PrismaService;
  let sessionTokens: UserSessionsService;
  let agents: AgentsService;
  let agreements: AgentAgreementsService;
  let agentUsers: AgentUsersService;
  let orders: AgentOrdersService;
  let shipments: StoreOrderShipmentOperationsService;

  const tag = randomUUID().slice(0, 6).toUpperCase();
  const lower = tag.toLowerCase();
  let seq = 0;
  const next = () => `${tag}-${++seq}`;
  let phoneSeq = 0;
  const phone = () =>
    `+2010${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}${String(++phoneSeq % 100).padStart(2, '0')}`;
  const today = todayBusinessDate();
  const tomorrow = addCalendarDays(today, 1);

  let internalId: string;
  let internalToken: string;
  let viewerToken: string; // agents.view only
  let currencyId: string;
  let egId: string;
  let saId: string;
  let categoryId: string;
  let unitId: string;
  let warehouseId: string;
  let carrierCoId: string;
  let paymentSourceId: string;
  let paymentMethodId: string;

  const get = (token: string, path: string) =>
    request(http).get(path).set('Authorization', `Bearer ${token}`);
  const post = (token: string, path: string, body: object = {}) =>
    request(http).post(path).set('Authorization', `Bearer ${token}`).send(body);
  const patch = (token: string, path: string, body: object = {}) =>
    request(http)
      .patch(path)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const del = (token: string, path: string) =>
    request(http).delete(path).set('Authorization', `Bearer ${token}`);

  const terms = (
    over: Partial<CreateAgreementDto> = {},
  ): CreateAgreementDto => ({
    effectiveFrom: '2020-01-01',
    productCommissionRatePercent: 35,
    serviceCommissionRatePercent: 25,
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
    ...over,
  });

  /** An active agent with an ACTIVE commission agreement (no shipping agreement yet). */
  const makeAgent = async (suffix: string) => {
    const agent = await agents.create(
      {
        name: `W3 agent ${suffix} ${tag}`,
        email: `w3-agent-${suffix.toLowerCase()}-${lower}@test.local`,
        currencyId,
      },
      internalId,
    );
    const agreement = await agreements.create(agent.id, terms(), internalId);
    await agreements.activate(agent.id, agreement.id, internalId);
    return agent;
  };

  const base = (agentId: string) => `/agents/${agentId}/shipping-agreements`;

  const createDraft = async (agentId: string, body: object) => {
    const res = await post(internalToken, base(agentId), body);
    expect(res.status).toBe(201);
    return res.body as { id: string; agreementNumber: string };
  };
  const activate = (agentId: string, id: string, body: object = {}) =>
    post(internalToken, `${base(agentId)}/${id}/activate`, body);

  const makeProduct = async (owner: string) => {
    const sku = `W3P-${next()}`;
    const product = await prisma.product.create({
      data: {
        sku,
        name: `W3 product ${sku}`,
        internalName: sku,
        displayName: `W3 product ${sku}`,
        categoryId,
        unitId,
        type: 'PURCHASE_AND_SALE',
        status: 'ACTIVE',
        isPurchasable: true,
        isSellable: true,
        isInventoryItem: true,
        itemType: 'PRODUCT',
        salesPrice: 1000,
        preferredWarehouseId: warehouseId,
        ownerAgentId: owner,
      },
    });
    await moduleRef
      .get(InventoryService, { strict: false })
      .openingBalance(
        { productId: product.id, warehouseId, quantity: 50 },
        internalId,
      );
    return product.id;
  };

  const orderInput = (
    productId: string,
    over: Partial<CreateAgentOrderDto> = {},
  ): CreateAgentOrderDto => ({
    pricingMode: 'SHIPPING_ADDED',
    lines: [{ productId, quantity: 1, lineAmount: 1000 }],
    fulfillmentMethod: 'SHIPPING',
    paymentType: 'CASH_ON_DELIVERY',
    countryId: egId,
    city: 'Cairo',
    customer: { name: `W3 customer ${tag}`, mobile: phone(), countryId: egId },
    ...over,
  });

  const snapshotOf = async (id: string) =>
    (
      await prisma.storeOrder.findUniqueOrThrow({
        where: { id },
        select: { agentTermsSnapshot: true },
      })
    ).agentTermsSnapshot as unknown as AgentOrderSnapshot;

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
    sessionTokens = moduleRef.get(UserSessionsService, { strict: false });
    agents = moduleRef.get(AgentsService, { strict: false });
    agreements = moduleRef.get(AgentAgreementsService, { strict: false });
    agentUsers = moduleRef.get(AgentUsersService, { strict: false });
    orders = moduleRef.get(AgentOrdersService, { strict: false });
    shipments = moduleRef.get(StoreOrderShipmentOperationsService, {
      strict: false,
    });

    const internal = await prisma.user.create({
      data: {
        email: `w3-internal-${lower}@test.local`,
        username: `w3-internal-${lower}`,
        fullName: `W3 Internal ${tag}`,
        passwordHash: 'x',
        isSuperAdmin: true,
      },
    });
    internalId = internal.id;
    internalToken = await sessionTokens.issueAccessToken({
      sub: internal.id,
      email: internal.email,
    });
    const viewer = await prisma.user.create({
      data: {
        email: `w3-viewer-${lower}@test.local`,
        username: `w3-viewer-${lower}`,
        fullName: `W3 Viewer ${tag}`,
        passwordHash: 'x',
      },
    });
    const view = await prisma.permission.upsert({
      where: { name: 'agents.view' },
      create: { name: 'agents.view' },
      update: {},
    });
    await prisma.userPermission.create({
      data: { userId: viewer.id, permissionId: view.id },
    });
    viewerToken = await sessionTokens.issueAccessToken({
      sub: viewer.id,
      email: viewer.email,
    });

    currencyId = await moduleRef
      .get(ExchangeRatesService, { strict: false })
      .requireFunctionalCurrencyId();
    egId = (await prisma.country.findFirstOrThrow({ where: { code: 'EG' } }))
      .id;
    saId = (await prisma.country.findFirstOrThrow({ where: { code: 'SA' } }))
      .id;
    categoryId = (
      await prisma.productCategory.create({
        data: { name: `w3-${tag}-category` },
      })
    ).id;
    unitId = (await prisma.unit.create({ data: { name: `w3-${tag}-unit` } }))
      .id;
    warehouseId = (
      await prisma.warehouse.create({
        data: { code: `W3-${tag}`, name: `W3 WH ${tag}` },
      })
    ).id;
    carrierCoId = (
      await prisma.shippingCompany.create({
        data: { name: `W3 carrier ${tag}`, type: 'EXTERNAL_COMPANY' },
      })
    ).id;
    // A payment method posts to a real ASSET clearing account (owner rule 1).
    const clearing = await prisma.chartOfAccount.create({
      data: {
        code: `W3-CLR-${tag}`,
        name: `W3 clearing ${tag}`,
        accountType: AccountType.ASSET,
      },
    });
    paymentMethodId = (
      await prisma.paymentMethod.create({
        data: {
          name: `W3 method ${tag}`,
          accountId: clearing.id,
          requiresReconciliation: false,
        },
      })
    ).id;
    paymentSourceId = (
      await prisma.paymentSource.findFirstOrThrow({
        where: { deletedAt: null, isActive: true },
      })
    ).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('draft CRUD: generated number, agent currency, rate rules, duplicates named, audit; view vs manage', async () => {
    const agent = await makeAgent('CRUD');
    const draft = await createDraft(agent.id, { effectiveFrom: '2020-01-01' });
    expect(draft).toMatchObject({
      agreementNumber: expect.stringMatching(/^ASA-\d{4}-\d{4,}$/),
      status: 'DRAFT',
      currencyId,
      rates: [],
      coverage: { destinations: [], missing: [], complete: true },
      activation: { ready: false, problems: ['SHIPPING_AGREEMENT_NO_RATES'] },
    });
    const ratesPath = `${base(agent.id)}/${draft.id}/rates`;

    // Service required (no wildcard); amount ≥ 0; a city needs its country.
    expect(
      (await post(internalToken, ratesPath, { countryId: egId, amount: 5 }))
        .status,
    ).toBe(400);
    expect(
      (
        await post(internalToken, ratesPath, {
          service: 'COD_CARRIER',
          amount: -1,
        })
      ).status,
    ).toBe(400);
    const cityOnly = await post(internalToken, ratesPath, {
      service: 'COD_CARRIER',
      city: 'Cairo',
      amount: 5,
    });
    expect(cityOnly.status).toBe(422);
    expect(cityOnly.body.code).toBe('SHIPPING_AGREEMENT_CITY_NEEDS_COUNTRY');

    // 0 = explicitly free; all destinations / country / city rows.
    const free = await post(internalToken, ratesPath, {
      service: 'PREPAID_CARRIER',
      amount: 0,
    });
    expect(free.status).toBe(201);
    await post(internalToken, ratesPath, {
      service: 'COD_CARRIER',
      countryId: egId,
      amount: 60,
    });
    const city = await post(internalToken, ratesPath, {
      service: 'COD_INTERNAL_COURIER',
      countryId: egId,
      city: ' Cairo ',
      amount: 40,
    });
    expect(city.status).toBe(201);
    expect(city.body.rates).toHaveLength(3);
    const cairoRow = city.body.rates.find(
      (r: { service: string }) => r.service === 'COD_INTERNAL_COURIER',
    );
    expect(cairoRow).toMatchObject({ city: 'Cairo', scope: 'CITY' });

    // Same service + destination (city compared case-insensitively) → named.
    const duplicate = await post(internalToken, ratesPath, {
      service: 'COD_INTERNAL_COURIER',
      countryId: egId,
      city: 'CAIRO',
      amount: 45,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('SHIPPING_AGREEMENT_RATE_DUPLICATE');
    expect(duplicate.body.message).toContain(
      'Internal courier COD to Egypt / Cairo already has 40.00',
    );
    expect(duplicate.body.existingRateId).toBe(cairoRow.id);

    // Edit / remove a row; dates validated.
    const edited = await patch(internalToken, `${ratesPath}/${cairoRow.id}`, {
      service: 'COD_INTERNAL_COURIER',
      countryId: egId,
      city: 'Cairo',
      amount: 45,
    });
    expect(edited.status).toBe(200);
    const freeRow = edited.body.rates.find(
      (r: { service: string }) => r.service === 'PREPAID_CARRIER',
    );
    expect(freeRow).toMatchObject({ amount: 0, scope: 'ALL', countryId: null });
    const removed = await del(internalToken, `${ratesPath}/${freeRow.id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.rates).toHaveLength(2);
    const badRange = await patch(
      internalToken,
      `${base(agent.id)}/${draft.id}`,
      { effectiveTo: '2019-12-31' },
    );
    expect(badRange.status).toBe(422);
    expect(badRange.body.code).toBe('SHIPPING_AGREEMENT_INVALID_RANGE');
    const dated = await patch(internalToken, `${base(agent.id)}/${draft.id}`, {
      effectiveTo: '2020-12-31',
      notes: 'Q1 charges',
    });
    expect(dated.status).toBe(200);
    expect(dated.body).toMatchObject({ notes: 'Q1 charges' });

    // Reads with agents.view; every write needs agents.agreements.manage.
    expect((await get(viewerToken, base(agent.id))).status).toBe(200);
    expect(
      (await get(viewerToken, `${base(agent.id)}/${draft.id}`)).status,
    ).toBe(200);
    expect(
      (await post(viewerToken, base(agent.id), { effectiveFrom: today }))
        .status,
    ).toBe(403);
    expect(
      (
        await post(viewerToken, ratesPath, {
          service: 'COD_CARRIER',
          amount: 1,
        })
      ).status,
    ).toBe(403);
    expect((await activate(agent.id, draft.id)).status).toBe(201);

    const audit = await prisma.masterDataActivityLog.findMany({
      where: { entityType: SHIPPING_AGREEMENT_ENTITY, entityId: draft.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((a) => a.type)).toEqual([
      'CREATED',
      'RATE_ADDED',
      'RATE_ADDED',
      'RATE_ADDED',
      'RATE_UPDATED',
      'RATE_REMOVED',
      'UPDATED',
      'ACTIVATED',
    ]);
    expect(audit.every((a) => a.createdBy === internalId)).toBe(true);
    const detail = await get(internalToken, `${base(agent.id)}/${draft.id}`);
    expect(detail.body.activity[0]).toMatchObject({
      type: 'ACTIVATED',
      user: { id: internalId },
    });
    // Details are stored in both languages ("العربية — English").
    expect(detail.body.activity[0].description).toMatch(
      /^فُعّلت .* — Activated /,
    );
    expect(detail.body.activatedByUser).toMatchObject({ id: internalId });
  });

  it('activation: needs a rate; coverage warns, never blocks; an active agreement is immutable', async () => {
    const agent = await makeAgent('ACT');
    const empty = await createDraft(agent.id, { effectiveFrom: '2020-01-01' });
    const refused = await activate(agent.id, empty.id);
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('SHIPPING_AGREEMENT_NO_RATES');

    const draft = await createDraft(agent.id, {
      effectiveFrom: '2020-01-01',
      rates: [{ service: 'COD_CARRIER', countryId: egId, amount: 60 }],
    });
    const active = await activate(agent.id, draft.id);
    expect(active.status).toBe(201);
    expect(active.body).toMatchObject({
      status: 'ACTIVE',
      inForceToday: true,
      activatedByUser: { id: internalId },
      coverage: { complete: false },
    });
    expect(
      active.body.coverage.missing.map((m: { service: string }) => m.service),
    ).toEqual([
      'PREPAID_CARRIER',
      'COD_INTERNAL_COURIER',
      'PREPAID_INTERNAL_COURIER',
    ]);

    // Immutable once active: no edit, no rate change, no discard.
    for (const res of [
      await patch(internalToken, `${base(agent.id)}/${draft.id}`, {
        notes: 'x',
      }),
      await post(internalToken, `${base(agent.id)}/${draft.id}/rates`, {
        service: 'PREPAID_CARRIER',
        amount: 1,
      }),
      await post(internalToken, `${base(agent.id)}/${draft.id}/discard`),
      await activate(agent.id, draft.id),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SHIPPING_AGREEMENT_NOT_DRAFT');
    }
  });

  it('overlap is refused (named, with dates); "replace from" closes the earlier one the day before; deactivate / discard / duplicate', async () => {
    const agent = await makeAgent('OVL');
    const first = await createDraft(agent.id, {
      effectiveFrom: '2020-01-01',
      rates: [{ service: 'COD_CARRIER', countryId: egId, amount: 50 }],
    });
    expect((await activate(agent.id, first.id)).status).toBe(201);

    // Duplicate → a draft from tomorrow with the same rows.
    const dup = await post(
      internalToken,
      `${base(agent.id)}/${first.id}/duplicate`,
    );
    expect(dup.status).toBe(201);
    expect(dup.body).toMatchObject({
      status: 'DRAFT',
      effectiveFrom: `${tomorrow}T00:00:00.000Z`,
      effectiveTo: null,
      rates: [{ service: 'COD_CARRIER', countryId: egId, amount: 50 }],
      activation: {
        ready: true,
        overlapping: [{ id: first.id, effectiveFrom: '2020-01-01' }],
        replaceCloses: today,
      },
    });
    expect(dup.body.agreementNumber).not.toBe(first.agreementNumber);

    // Without "replace from" the overlap is refused and named.
    const overlap = await activate(agent.id, dup.body.id);
    expect(overlap.status).toBe(409);
    expect(overlap.body).toMatchObject({
      code: 'SHIPPING_AGREEMENT_OVERLAP',
      canReplace: true,
      overlapping: [
        {
          agreementNumber: first.agreementNumber,
          effectiveFrom: '2020-01-01',
          effectiveTo: null,
        },
      ],
    });
    expect(overlap.body.message).toContain(
      `${first.agreementNumber} (2020-01-01 → ∞)`,
    );

    // A draft starting before the active one can never replace it.
    const earlier = await createDraft(agent.id, {
      effectiveFrom: '2019-06-01',
      rates: [{ service: 'COD_CARRIER', countryId: egId, amount: 1 }],
    });
    const notReplaceable = await activate(agent.id, earlier.id, {
      replaceFrom: true,
    });
    expect(notReplaceable.status).toBe(409);
    expect(notReplaceable.body).toMatchObject({
      code: 'SHIPPING_AGREEMENT_OVERLAP',
      canReplace: false,
    });
    const discarded = await post(
      internalToken,
      `${base(agent.id)}/${earlier.id}/discard`,
    );
    expect(discarded.status).toBe(201);
    expect(
      (await get(internalToken, `${base(agent.id)}/${earlier.id}`)).status,
    ).toBe(404);

    // Replace from tomorrow: the first closes today, in the same transaction.
    const replaced = await activate(agent.id, dup.body.id, {
      replaceFrom: true,
    });
    expect(replaced.status).toBe(201);
    expect(replaced.body).toMatchObject({
      status: 'ACTIVE',
      supersedes: { id: first.id },
      inForceToday: false,
    });
    const old = await get(internalToken, `${base(agent.id)}/${first.id}`);
    expect(old.body).toMatchObject({
      status: 'ACTIVE',
      effectiveTo: `${today}T00:00:00.000Z`,
      inForceToday: true,
      supersededBy: { id: dup.body.id },
    });
    expect(old.body.activity[0]).toMatchObject({ type: 'REPLACED' });
    const list = await get(internalToken, base(agent.id));
    expect(list.body.inForceId).toBe(first.id);
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([
      dup.body.id,
      first.id,
    ]);

    // Deactivate: reason required; never applies again; never deleted.
    const noReason = await post(
      internalToken,
      `${base(agent.id)}/${first.id}/deactivate`,
      { reason: '  ' },
    );
    expect(noReason.status).toBe(400);
    const off = await post(
      internalToken,
      `${base(agent.id)}/${first.id}/deactivate`,
      { reason: 'Carrier contract renegotiated' },
    );
    expect(off.status).toBe(201);
    expect(off.body).toMatchObject({
      status: 'INACTIVE',
      deactivationReason: 'Carrier contract renegotiated',
      deactivatedByUser: { id: internalId },
      inForceToday: false,
    });
    expect((await get(internalToken, base(agent.id))).body.inForceId).toBe(
      null,
    );
    const again = await post(
      internalToken,
      `${base(agent.id)}/${first.id}/deactivate`,
      { reason: 'again' },
    );
    expect(again.body.code).toBe('SHIPPING_AGREEMENT_NOT_ACTIVE');
  });

  it('a PREDETERMINED_CHARGE commission agreement warns at activation when no shipping agreement covers its start', async () => {
    const agent = await agents.create(
      {
        name: `W3 agent WARN ${tag}`,
        email: `w3-agent-warn-${lower}@test.local`,
        currencyId,
      },
      internalId,
    );
    const first = await agreements.create(
      agent.id,
      terms({ effectiveTo: '2020-12-31' }),
      internalId,
    );
    const warned = await agreements.activate(agent.id, first.id, internalId);
    expect(warned.warnings).toEqual([
      expect.objectContaining({ code: 'SHIPPING_AGREEMENT_NOT_IN_FORCE' }),
    ]);
    const shipping = await createDraft(agent.id, {
      effectiveFrom: '2021-01-01',
      rates: [{ service: 'COD_CARRIER', amount: 10 }],
    });
    expect((await activate(agent.id, shipping.id)).status).toBe(201);
    const second = await agreements.create(
      agent.id,
      terms({ effectiveFrom: '2021-01-01' }),
      internalId,
    );
    const clean = await agreements.activate(agent.id, second.id, internalId);
    expect(clean.warnings).toEqual([]);
  });

  it('a shipping agreement alone locks the agent settlement currency', async () => {
    const agent = await agents.create(
      {
        name: `W3 agent CUR ${tag}`,
        email: `w3-agent-cur-${lower}@test.local`,
        currencyId,
      },
      internalId,
    );
    await createDraft(agent.id, { effectiveFrom: today });
    const other = await prisma.currency.findFirstOrThrow({
      where: { id: { not: currencyId }, deletedAt: null },
      select: { id: true },
    });
    await expectCode(
      agents.update(agent.id, { currencyId: other.id }, internalId),
      'AGENT_CURRENCY_LOCKED',
    );
  });

  it('submission uses the agreement in force on the order date; missing agreement / combination are actionable, never zero', async () => {
    const agent = await makeAgent('DATE');
    const productId = await makeProduct(agent.id);

    // No shipping agreement at all.
    const none = await expectCode(
      orders.createAgentOrder(orderInput(productId), { userId: internalId }),
      'AGENT_SHIPPING_AGREEMENT_MISSING',
    );
    expect(none.message).toContain(
      `No active shipping agreement for W3 agent DATE ${tag} on ${today}`,
    );
    expect(none.message).toContain('Agent → Settings → Shipping agreement');

    const y2020 = await createDraft(agent.id, {
      effectiveFrom: '2020-01-01',
      effectiveTo: '2020-12-31',
      rates: [
        { service: 'COD_CARRIER', countryId: egId, amount: 50 },
        { service: 'COD_INTERNAL_COURIER', countryId: egId, amount: 50 },
      ],
    });
    expect((await activate(agent.id, y2020.id)).status).toBe(201);
    const current = await createDraft(agent.id, {
      effectiveFrom: '2021-01-01',
      rates: [
        { service: 'COD_CARRIER', countryId: egId, amount: 80 },
        { service: 'COD_INTERNAL_COURIER', countryId: egId, amount: 80 },
      ],
    });
    expect((await activate(agent.id, current.id)).status).toBe(201);

    const backDated = await orders.createAgentOrder(
      orderInput(productId, { orderDate: '2020-06-01' }),
      { userId: internalId },
    );
    expect(Number(backDated.shippingCharge)).toBe(50);
    expect((await snapshotOf(backDated.id)).agentShippingCharge).toMatchObject({
      amount: 50,
      shippingAgreementId: y2020.id,
      shippingAgreementNumber: y2020.agreementNumber,
      service: 'COD_CARRIER',
    });
    const now = await orders.createAgentOrder(orderInput(productId), {
      userId: internalId,
    });
    expect(Number(now.shippingCharge)).toBe(80);
    expect(
      (await snapshotOf(now.id)).agentShippingCharge?.shippingAgreementNumber,
    ).toBe(current.agreementNumber);

    // The agreement lacks the combination (prepaid / Saudi Arabia) → named.
    const combo = await expectCode(
      orders.createAgentOrder(
        orderInput(productId, { paymentType: 'PREPAID' }),
        {
          userId: internalId,
        },
      ),
      'AGENT_SHIPPING_TARIFF_MISSING',
    );
    expect(combo.message).toContain(
      `Shipping agreement ${current.agreementNumber} has no charge for Prepaid carrier / Internal courier prepaid to Egypt / Cairo`,
    );
    const quote = await orders.quote(
      orderInput(productId, { countryId: saId, city: 'Riyadh' }),
      { userId: internalId },
    );
    expect(quote.valid).toBe(false);
    expect(quote.shipping.charge).toBeNull();
    expect(quote.issues.map((i) => i.code)).toEqual([
      'AGENT_SHIPPING_TARIFF_MISSING',
    ]);
  });

  it('worked example 3.11 — Cairo COD 1,000 + 60 at 35 %: pending 40 / 60 → carrier confirms 60 → earned → statement; a later agreement never reprices it', async () => {
    const agent = await makeAgent('AG');
    const productId = await makeProduct(agent.id);
    const asa = await createDraft(agent.id, {
      effectiveFrom: '2020-01-01',
      rates: [
        { service: 'COD_CARRIER', countryId: egId, amount: 60 },
        {
          service: 'COD_INTERNAL_COURIER',
          countryId: egId,
          city: 'Cairo',
          amount: 40,
        },
        { service: 'PREPAID_CARRIER', amount: 70 },
      ],
    });
    expect((await activate(agent.id, asa.id)).status).toBe(201);

    // Submission: channel unknown → provisional (carrier estimate 60).
    const order = await orders.createAgentOrder(orderInput(productId), {
      userId: internalId,
    });
    let row = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(row.shippingPricingStatus).toBe('PENDING_METHOD');
    expect(Number(row.shippingCharge)).toBe(60);
    expect(Number(row.payableTotal)).toBe(1060);
    let snap = await snapshotOf(order.id);
    expect(snap.agentShippingCharge).toMatchObject({
      amount: 60,
      provisional: true,
      deliveryChannel: 'CARRIER',
      shippingAgreementNumber: asa.agreementNumber,
      byChannel: {
        CARRIER: { amount: 60, service: 'COD_CARRIER' },
        INTERNAL_COURIER: { amount: 40, service: 'COD_INTERNAL_COURIER' },
      },
    });

    // Shipping assigns the carrier → CONFIRMED 60 (COD carrier).
    const assigned = await post(
      internalToken,
      `/store-orders/${order.id}/shipments/shipping-company`,
      { shippingCompanyId: carrierCoId },
    );
    expect(assigned.status).toBe(200);
    row = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(row.shippingPricingStatus).toBe('CONFIRMED');
    snap = await snapshotOf(order.id);
    expect(snap.agentShippingCharge).toMatchObject({
      amount: 60,
      source: 'TARIFF',
      provisional: false,
      service: 'COD_CARRIER',
      shippingAgreementNumber: asa.agreementNumber,
    });

    // Delivered → earned; the customer pays 1,060 COD.
    await shipments.markShipped(order.id, internalId);
    await shipments.markDelivered(order.id, internalId);
    const payment = await prisma.payment.create({
      data: {
        paymentNumber: `PAY-W3-${next()}`,
        storeOrderId: order.id,
        paymentDate: new Date(),
        amount: 1060,
        currencyId,
        paymentSourceId,
        paymentMethodId,
        origin: PaymentOrigin.SALES_DECLARATION,
        senderName: 'W3 customer',
        status: PaymentStatus.PENDING,
        agentId: agent.id,
        destinationOwnership: 'COMPANY',
      },
    });
    await moduleRef
      .get(PaymentsService, { strict: false })
      .confirm(payment.id, internalId);
    const ledger = await prisma.agentLedgerEntry.findMany({
      where: {
        storeOrderId: order.id,
        entryType: { in: ['COMMISSION', 'CUSTOMER_SHIPPING_RETAINED'] },
      },
      orderBy: { entryNumber: 'asc' },
    });
    expect(ledger.map((e) => [e.entryType, Number(e.debit)])).toEqual([
      ['COMMISSION', 350],
      ['CUSTOMER_SHIPPING_RETAINED', 60],
    ]);
    expect(ledger[1].basis).toMatchObject({
      shippingCharge: 60,
      agentShippingCharge: 60,
      difference: 0,
    });
    const report = await moduleRef
      .get(AgentCommissionReportService, { strict: false })
      .report(agent.id, {});
    expect(report.summary).toMatchObject({
      totalSales: 1000,
      customerCharges: 60,
      totalCommission: 350,
      shippingRetained: 60,
      agentShippingCharges: 60,
      netEntitlement: 650,
    });
    const { balances } = await moduleRef
      .get(AgentStatementService, { strict: false })
      .balances(agent.id);
    expect(balances.find((b) => b.currencyId === currencyId)?.balance).toBe(
      650,
    );

    // New version from today (COD carrier 75) replaces the agreement.
    const v2 = await post(
      internalToken,
      `${base(agent.id)}/${asa.id}/duplicate`,
      { effectiveFrom: today },
    );
    const carrierRow = v2.body.rates.find(
      (r: { service: string }) => r.service === 'COD_CARRIER',
    );
    await patch(
      internalToken,
      `${base(agent.id)}/${v2.body.id}/rates/${carrierRow.id}`,
      { service: 'COD_CARRIER', countryId: egId, amount: 75 },
    );
    expect(
      (await activate(agent.id, v2.body.id, { replaceFrom: true })).status,
    ).toBe(201);
    // The earned order is unchanged; a new order is priced from v2.
    const after = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(Number(after.shippingCharge)).toBe(60);
    expect((await snapshotOf(order.id)).agentShippingCharge).toMatchObject({
      amount: 60,
      shippingAgreementNumber: asa.agreementNumber,
    });
    const newer = await orders.createAgentOrder(orderInput(productId), {
      userId: internalId,
    });
    expect(Number(newer.shippingCharge)).toBe(75);
    expect(
      (await snapshotOf(newer.id)).agentShippingCharge?.shippingAgreementNumber,
    ).toBe(v2.body.agreementNumber);

    // Deactivated: the next order is refused with the actionable message;
    // the order priced under v2 keeps its frozen charges and still confirms.
    await post(internalToken, `${base(agent.id)}/${v2.body.id}/deactivate`, {
      reason: 'Renegotiation',
    });
    await expectCode(
      orders.createAgentOrder(orderInput(productId), { userId: internalId }),
      'AGENT_SHIPPING_AGREEMENT_MISSING',
    );
    expect(
      (
        await post(
          internalToken,
          `/store-orders/${newer.id}/shipments/shipping-company`,
          { shippingCompanyId: carrierCoId },
        )
      ).status,
    ).toBe(200);
    expect((await snapshotOf(newer.id)).agentShippingCharge).toMatchObject({
      amount: 75,
      source: 'TARIFF',
      shippingAgreementNumber: v2.body.agreementNumber,
    });

    // Portal /me (agent admin): today's agreement charges only, no leak.
    const admin = await agentUsers.create(
      agent.id,
      {
        email: `w3-admin-${lower}@test.local`,
        username: `w3-admin-${lower}`,
        fullName: `W3 admin ${tag}`,
        agentRole: 'ADMIN',
      },
      internalId,
    );
    await prisma.user.update({
      where: { id: admin.id },
      data: { mustChangePassword: false },
    });
    const adminToken = await sessionTokens.issueAccessToken({
      sub: admin.id,
      email: admin.email,
      typ: 'agent',
      agentId: agent.id,
    });
    // Nothing in force today after the deactivation.
    expect(
      (await get(adminToken, '/agent-portal/me')).body.shippingAgreement,
    ).toBeNull();
    const v3 = await post(
      internalToken,
      `${base(agent.id)}/${asa.id}/duplicate`,
      { effectiveFrom: today },
    );
    expect((await activate(agent.id, v3.body.id)).status).toBe(201);
    const me = await get(adminToken, '/agent-portal/me');
    expect(me.status).toBe(200);
    expect(me.body.shippingAgreement).toMatchObject({
      agreementNumber: v3.body.agreementNumber,
      rates: [
        { service: 'PREPAID_CARRIER', country: null, city: null, amount: 70 },
        { service: 'COD_CARRIER', country: { id: egId }, amount: 60 },
        {
          service: 'COD_INTERNAL_COURIER',
          country: { id: egId },
          city: 'Cairo',
          amount: 40,
        },
      ],
    });
    expect(leakedKeys(me.body)).toEqual([]);
    // Agents never reach the internal agreement API (deny-by-default).
    const denied = await get(adminToken, base(agent.id));
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('AGENT_ACCESS_DENIED');
  });
});
