/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- supertest response bodies are untyped JSON under assertion */
import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
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
import { todayBusinessDate } from '../../common/time/business-date';
import { PrismaService } from '../../prisma/prisma.service';
import { UserSessionsService } from '../../auth/sessions/user-sessions.service';
import { InventoryService } from '../../inventory/inventory.service';
import { ExchangeRatesService } from '../../accounting/fx/exchange-rates.service';
import { PaymentsService } from '../../payments/payments.service';
import { StoreOrderShipmentOperationsService } from '../../store-orders/shipments/store-order-shipment-operations.service';
import { AgentsService } from '../admin/agents.service';
import {
  AGENT_AGREEMENT_ENTITY,
  AgentAgreementsService,
} from '../admin/agent-agreements.service';
import { AgentUsersService } from '../admin/agent-users.service';
import { AgentOrdersService } from '../orders/agent-orders.service';
import type { CreateAgreementDto } from '../admin/dto/agreement.dto';
import type { CreateAgentOrderDto } from '../orders/dto/agent-order.dto';
import type { AgentOrderSnapshot } from '../common/agent-terms';
import { leakedKeys } from '../pricing/leaked-keys.test-util';
import { inForceAtWhere } from './shipping-agreement-resolution';

/**
 * R17 §2 + §3 acceptance (specs/round17-refinements/README.md) — editable,
 * versioned agent agreements and the COD collection fee, through the real
 * HTTP pipeline on the local Postgres. The spec's numeric example: shipping
 * v1 base 25 SAR + COD fee 10 → O1 (COD) 35; edit at t2 → v2 base 30 + fee
 * 12; O1 stays 35 (snapshot, ledger), O2 (COD) 42, O3 (prepaid) 30.
 * Serial: it configures the agent posting accounts (restored afterwards) so
 * O1 can be earned and its ledger read.
 */
describe('R17 — versioned agent agreements + COD collection fee (HTTP integration)', () => {
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

  let internalId: string;
  let internalToken: string;
  let viewerToken: string;
  let currencyId: string;
  let egId: string;
  let categoryId: string;
  let unitId: string;
  let warehouseId: string;
  let carrierCoId: string;
  let paymentSourceId: string;
  let paymentMethodId: string;
  const originalSettings: Record<string, string | null> = {};
  const AGENT_ACCOUNT_KEYS = [
    'agentFundsPayableAccountId',
    'agentCommissionRevenueAccountId',
    'agentServiceRevenueAccountId',
  ] as const;

  const get = (token: string, path: string) =>
    request(http).get(path).set('Authorization', `Bearer ${token}`);
  const post = (token: string, path: string, body: object = {}) =>
    request(http).post(path).set('Authorization', `Bearer ${token}`).send(body);

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

  const shippingBase = (agentId: string) =>
    `/agents/${agentId}/shipping-agreements`;

  /** Agent + ACTIVE commission agreement + ACTIVE shipping v1 (base 25, COD fee 10). */
  const makeAgent = async (suffix: string) => {
    const agent = await agents.create(
      {
        name: `R17 agent ${suffix} ${tag}`,
        email: `r17-agent-${suffix.toLowerCase()}-${lower}@test.local`,
        currencyId,
      },
      internalId,
    );
    const agreement = await agreements.create(agent.id, terms(), internalId);
    await agreements.activate(agent.id, agreement.id, internalId);
    const draft = await post(internalToken, shippingBase(agent.id), {
      effectiveFrom: '2020-01-01',
      codCollectionFee: 10,
      rates: [{ service: 'ANY', amount: 25 }],
    });
    expect(draft.status).toBe(201);
    const v1 = await post(
      internalToken,
      `${shippingBase(agent.id)}/${draft.body.id}/activate`,
    );
    expect(v1.status).toBe(201);
    expect(v1.body).toMatchObject({
      status: 'ACTIVE',
      versionNumber: 1,
      codCollectionFee: 10,
      rates: [{ service: 'ANY', amount: 25, codFee: 'ADDED' }],
    });
    return { agent, agreementId: agreement.id, v1: v1.body };
  };

  const makeProduct = async (owner: string) => {
    const sku = `R17P-${next()}`;
    const product = await prisma.product.create({
      data: {
        sku,
        name: `R17 product ${sku}`,
        internalName: sku,
        displayName: `R17 product ${sku}`,
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
    customer: { name: `R17 customer ${tag}`, mobile: phone(), countryId: egId },
    ...over,
  });

  const snapshotOf = async (id: string) =>
    (
      await prisma.storeOrder.findUniqueOrThrow({
        where: { id },
        select: { agentTermsSnapshot: true },
      })
    ).agentTermsSnapshot as unknown as AgentOrderSnapshot;

  const orderRow = (id: string) =>
    prisma.storeOrder.findUniqueOrThrow({ where: { id } });

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
        email: `r17-internal-${lower}@test.local`,
        username: `r17-internal-${lower}`,
        fullName: `R17 Internal ${tag}`,
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
        email: `r17-viewer-${lower}@test.local`,
        username: `r17-viewer-${lower}`,
        fullName: `R17 Viewer ${tag}`,
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
    categoryId = (
      await prisma.productCategory.create({
        data: { name: `r17-${tag}-category` },
      })
    ).id;
    unitId = (await prisma.unit.create({ data: { name: `r17-${tag}-unit` } }))
      .id;
    warehouseId = (
      await prisma.warehouse.create({
        data: { code: `R17-${tag}`, name: `R17 WH ${tag}` },
      })
    ).id;
    carrierCoId = (
      await prisma.shippingCompany.create({
        data: { name: `R17 carrier ${tag}`, type: 'EXTERNAL_COMPANY' },
      })
    ).id;
    const clearing = await prisma.chartOfAccount.create({
      data: {
        code: `R17-CLR-${tag}`,
        name: `R17 clearing ${tag}`,
        accountType: AccountType.ASSET,
      },
    });
    paymentMethodId = (
      await prisma.paymentMethod.create({
        data: {
          name: `R17 method ${tag}`,
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

    // Agent posting accounts (restored in afterAll) — the earning event posts.
    const settings = await prisma.postingSettings.findFirstOrThrow();
    for (const key of AGENT_ACCOUNT_KEYS) originalSettings[key] = settings[key];
    const account = (code: string, type: AccountType) =>
      prisma.chartOfAccount.create({
        data: {
          code: `${code}-${tag}`,
          name: `${code} ${tag}`,
          accountType: type,
        },
      });
    await prisma.postingSettings.update({
      where: { id: settings.id },
      data: {
        agentFundsPayableAccountId:
          settings.agentFundsPayableAccountId ??
          (await account('R17-PAY', AccountType.LIABILITY)).id,
        agentCommissionRevenueAccountId:
          settings.agentCommissionRevenueAccountId ??
          (await account('R17-COM', AccountType.REVENUE)).id,
        agentServiceRevenueAccountId:
          settings.agentServiceRevenueAccountId ??
          (await account('R17-SRV', AccountType.REVENUE)).id,
      },
    });
  });

  afterAll(async () => {
    const settings = await prisma?.postingSettings.findFirst();
    if (settings) {
      await prisma.postingSettings.update({
        where: { id: settings.id },
        data: {
          agentFundsPayableAccountId:
            originalSettings.agentFundsPayableAccountId ?? null,
          agentCommissionRevenueAccountId:
            originalSettings.agentCommissionRevenueAccountId ?? null,
          agentServiceRevenueAccountId:
            originalSettings.agentServiceRevenueAccountId ?? null,
        },
      });
    }
    await app?.close();
  });

  it('numeric example: O1 COD 35 under v1; edit at t2 → v2 (30 + 12); O1 keeps 35 (snapshot + ledger), O2 COD 42, O3 prepaid 30', async () => {
    const { agent, v1 } = await makeAgent('NUM');
    const productId = await makeProduct(agent.id);

    // t1 — O1 (COD): 25 + 10 = 35, the same on every channel → CONFIRMED.
    const o1 = await orders.createAgentOrder(orderInput(productId), {
      userId: internalId,
    });
    expect(Number(o1.shippingCharge)).toBe(35);
    expect((await orderRow(o1.id)).shippingPricingStatus).toBe('CONFIRMED');
    const o1Snapshot = await snapshotOf(o1.id);
    expect(o1Snapshot.agentShippingCharge).toMatchObject({
      amount: 35,
      base: 25,
      codFee: 10,
      codFeeMode: 'ADDED',
      shippingAgreementId: v1.id,
      shippingAgreementVersion: 1,
      byChannel: {
        CARRIER: { amount: 35, base: 25, codFee: 10, codFeeMode: 'ADDED' },
        INTERNAL_COURIER: { amount: 35, codFeeMode: 'ADDED' },
      },
    });
    expect(o1Snapshot.assessedAt).toEqual(expect.any(String));
    // An order to be amended later, also assessed under v1.
    const o4 = await orders.createAgentOrder(orderInput(productId), {
      userId: internalId,
    });
    const beforeEdit = new Date();

    // t2 — Edit: a new version from the save instant; v1 closes at t2.
    const edited = await post(
      internalToken,
      `${shippingBase(agent.id)}/${v1.id}/versions`,
      { codCollectionFee: 12, rates: [{ service: 'ANY', amount: 30 }] },
    );
    expect(edited.status).toBe(201);
    const v2 = edited.body;
    expect(v2).toMatchObject({
      status: 'ACTIVE',
      versionNumber: 2,
      codCollectionFee: 12,
      supersedes: { id: v1.id },
      inForceToday: true,
      effectiveFrom: `${today}T00:00:00.000Z`,
      rates: [{ service: 'ANY', amount: 30, codFee: 'ADDED' }],
    });
    const t2 = new Date(v2.activeFrom);
    expect(t2.getTime()).toBeGreaterThanOrEqual(beforeEdit.getTime());
    const closed = await get(
      internalToken,
      `${shippingBase(agent.id)}/${v1.id}`,
    );
    expect(closed.body).toMatchObject({
      status: 'ACTIVE',
      activeTo: v2.activeFrom,
      effectiveTo: `${today}T00:00:00.000Z`,
      inForceToday: false,
      supersededBy: { id: v2.id, versionNumber: 2 },
      codCollectionFee: 10,
      rates: [{ service: 'ANY', amount: 25 }],
    });
    expect(closed.body.activity[0]).toMatchObject({ type: 'VERSION_CLOSED' });
    expect(v2.activity[0]).toMatchObject({ type: 'VERSION_CREATED' });
    const created = await prisma.masterDataActivityLog.findFirstOrThrow({
      where: { entityId: v2.id, type: 'VERSION_CREATED' },
    });
    expect(created.createdBy).toBe(internalId);
    expect((created.metadata as { changes: unknown[] }).changes).toEqual(
      expect.arrayContaining([
        { field: 'codCollectionFee', from: 10, to: 12 },
        expect.objectContaining({
          field: 'rate',
          key: 'ANY#*',
          from: { amount: 25, codFee: 'ADDED' },
          to: { amount: 30, codFee: 'ADDED' },
        }),
      ]),
    );
    // Never two versions in force at one instant: v1 before t2, v2 from t2.
    const inForceAt = (instant: Date) =>
      prisma.agentShippingAgreement.findMany({
        where: inForceAtWhere(agent.id, instant),
        select: { id: true },
      });
    expect(await inForceAt(new Date(t2.getTime() - 1))).toEqual([
      { id: v1.id },
    ]);
    expect(await inForceAt(t2)).toEqual([{ id: v2.id }]);
    expect(
      (await get(internalToken, shippingBase(agent.id))).body.inForceId,
    ).toBe(v2.id);

    // t3 — O2 (COD) 30 + 12 = 42; O3 (prepaid) 30 — never the fee.
    const o2 = await orders.createAgentOrder(orderInput(productId), {
      userId: internalId,
    });
    expect(Number(o2.shippingCharge)).toBe(42);
    expect((await snapshotOf(o2.id)).agentShippingCharge).toMatchObject({
      amount: 42,
      base: 30,
      codFee: 12,
      codFeeMode: 'ADDED',
      shippingAgreementId: v2.id,
      shippingAgreementVersion: 2,
    });
    const o3 = await orders.createAgentOrder(
      orderInput(productId, { paymentType: 'PREPAID' }),
      { userId: internalId },
    );
    expect(Number(o3.shippingCharge)).toBe(30);
    expect((await snapshotOf(o3.id)).agentShippingCharge).toMatchObject({
      amount: 30,
      base: 30,
      codFee: 0,
      codFeeMode: 'NONE',
    });

    // O1 is never repriced: order row and snapshot unchanged.
    expect(Number((await orderRow(o1.id)).shippingCharge)).toBe(35);
    expect((await snapshotOf(o1.id)).agentShippingCharge).toEqual(
      o1Snapshot.agentShippingCharge,
    );

    // O1 goes through the whole flow after the edit: carrier confirms from
    // its frozen charges (35), delivered, paid → the ledger books 35.
    expect(
      (
        await post(
          internalToken,
          `/store-orders/${o1.id}/shipments/shipping-company`,
          { shippingCompanyId: carrierCoId },
        )
      ).status,
    ).toBe(200);
    expect((await snapshotOf(o1.id)).agentShippingCharge).toMatchObject({
      amount: 35,
      source: 'TARIFF',
      base: 25,
      codFee: 10,
      codFeeMode: 'ADDED',
      shippingAgreementId: v1.id,
    });
    await shipments.markShipped(o1.id, internalId);
    await shipments.markDelivered(o1.id, internalId);
    const payment = await prisma.payment.create({
      data: {
        paymentNumber: `PAY-R17-${next()}`,
        storeOrderId: o1.id,
        paymentDate: new Date(),
        amount: 1035,
        currencyId,
        paymentSourceId,
        paymentMethodId,
        origin: PaymentOrigin.SALES_DECLARATION,
        senderName: 'R17 customer',
        status: PaymentStatus.PENDING,
        agentId: agent.id,
        destinationOwnership: 'COMPANY',
      },
    });
    await moduleRef
      .get(PaymentsService, { strict: false })
      .confirm(payment.id, internalId);
    const ledger = await prisma.agentLedgerEntry.findMany({
      where: { storeOrderId: o1.id },
      orderBy: { entryNumber: 'asc' },
    });
    const shippingRows = ledger.filter((entry) =>
      ['SHIPPING_FEE', 'CUSTOMER_SHIPPING_RETAINED'].includes(entry.entryType),
    );
    expect(shippingRows.map((e) => [e.entryType, Number(e.debit)])).toEqual([
      ['CUSTOMER_SHIPPING_RETAINED', 35],
    ]);
    expect(shippingRows[0].basis).toMatchObject({
      shippingCharge: 35,
      agentShippingCharge: 35,
      difference: 0,
    });
    expect(
      ledger.find((entry) => entry.entryType === 'COMMISSION')?.debit,
    ).toEqual(expect.anything());

    // Amendment after the edit: O4 COD → prepaid is re-assessed from its own
    // snapshot (v1: prepaid 25), never from v2 (30); audited with the
    // previous snapshot.
    const o4Row = await orderRow(o4.id);
    const amended = await post(
      internalToken,
      `/store-orders/${o4.id}/amendments`,
      {
        changes: { paymentType: 'PREPAID' },
        expectedVersion: o4Row.version,
        reason: 'Customer pays in advance',
      },
    );
    expect(amended.status).toBe(201);
    const o4After = await orderRow(o4.id);
    expect(o4After.paymentType).toBe('PREPAID');
    expect(Number(o4After.shippingCharge)).toBe(25);
    const o4Snapshot = await snapshotOf(o4.id);
    expect(o4Snapshot.agentShippingCharge).toMatchObject({
      amount: 25,
      base: 25,
      codFeeMode: 'NONE',
      paymentType: 'PREPAID',
      shippingAgreementId: v1.id,
    });
    const amendment = await prisma.storeOrderAmendment.findFirstOrThrow({
      where: { storeOrderId: o4.id },
    });
    expect(amendment).toMatchObject({
      actorId: internalId,
      reason: 'Customer pays in advance',
      changes: expect.objectContaining({
        fields: expect.objectContaining({
          paymentType: { old: 'CASH_ON_DELIVERY', new: 'PREPAID' },
        }),
      }),
    });
    const previous = amendment.previousSnapshot as unknown as {
      agentTermsSnapshot: AgentOrderSnapshot;
    };
    expect(previous.agentTermsSnapshot.agentShippingCharge?.amount).toBe(35);

    // The agent sees its tariff: base, COD fee and mode — never cost / margin.
    const admin = await agentUsers.create(
      agent.id,
      {
        email: `r17-admin-${lower}@test.local`,
        username: `r17-admin-${lower}`,
        fullName: `R17 admin ${tag}`,
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
    const me = await get(adminToken, '/agent-portal/me');
    expect(me.status).toBe(200);
    expect(me.body.shippingAgreement).toMatchObject({
      agreementNumber: v2.agreementNumber,
      versionNumber: 2,
      codCollectionFee: 12,
      rates: [
        {
          service: 'ANY',
          amount: 30,
          codFee: 'ADDED',
          codAmount: 42,
        },
      ],
    });
    expect(leakedKeys(me.body)).toEqual([]);
  });

  it('INCLUDED COD rows are all-inclusive; duplicate rows are rejected; a closed version is read-only', async () => {
    const { agent, v1 } = await makeAgent('INC');
    const productId = await makeProduct(agent.id);
    const path = `${shippingBase(agent.id)}/${v1.id}/versions`;
    const duplicate = await post(internalToken, path, {
      rates: [
        { service: 'ANY', amount: 25 },
        { service: 'ANY', amount: 26 },
      ],
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('SHIPPING_AGREEMENT_RATE_DUPLICATE');
    const unchanged = await post(internalToken, path, {
      codCollectionFee: 10,
      rates: [{ service: 'ANY', amount: 25 }],
    });
    expect(unchanged.status).toBe(422);
    expect(unchanged.body.code).toBe('AGREEMENT_NO_CHANGES');

    const v2 = await post(internalToken, path, {
      codCollectionFee: 10,
      rates: [
        { service: 'ANY', amount: 25 },
        { service: 'COD_CARRIER', amount: 35, codFee: 'INCLUDED' },
        { service: 'COD_INTERNAL_COURIER', amount: 35, codFee: 'INCLUDED' },
      ],
    });
    expect(v2.status).toBe(201);
    const order = await orders.createAgentOrder(orderInput(productId), {
      userId: internalId,
    });
    expect(Number(order.shippingCharge)).toBe(35);
    expect((await snapshotOf(order.id)).agentShippingCharge).toMatchObject({
      amount: 35,
      base: 35,
      codFee: 0,
      codFeeMode: 'INCLUDED',
    });
    // v1 is closed: editing it again is refused (read-only history).
    const again = await post(internalToken, path, {
      rates: [{ service: 'ANY', amount: 99 }],
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('SHIPPING_AGREEMENT_NOT_IN_FORCE');
  });

  it('commission agreement edit: new version from the save instant; earlier orders keep 35 %, new orders 30 %; audited', async () => {
    const { agent, agreementId } = await makeAgent('COM');
    const productId = await makeProduct(agent.id);
    const before = await orders.createAgentOrder(orderInput(productId), {
      userId: internalId,
    });
    const path = `/agents/${agent.id}/agreements/${agreementId}/versions`;
    const edited = await post(internalToken, path, {
      productCommissionRatePercent: 30,
    });
    expect(edited.status).toBe(201);
    expect(edited.body).toMatchObject({
      status: 'ACTIVE',
      versionNumber: 2,
      supersedes: { id: agreementId },
      productCommissionRatePercent: '30',
      serviceCommissionRatePercent: '25',
    });
    expect(edited.body.activity[0]).toMatchObject({
      type: 'VERSION_CREATED',
      metadata: {
        changes: [{ field: 'productCommissionRatePercent', from: 35, to: 30 }],
      },
    });
    const old = await get(
      internalToken,
      `/agents/${agent.id}/agreements/${agreementId}`,
    );
    expect(old.body).toMatchObject({
      status: 'ENDED',
      activeTo: edited.body.activeFrom,
      productCommissionRatePercent: '35',
      supersededBy: { id: edited.body.id },
    });
    const logged = await prisma.masterDataActivityLog.findMany({
      where: { entityType: AGENT_AGREEMENT_ENTITY, entityId: agreementId },
    });
    expect(logged.map((entry) => entry.type)).toEqual(['VERSION_CLOSED']);
    const list = await get(internalToken, `/agents/${agent.id}/agreements`);
    expect(
      list.body.map((row: { versionNumber: number; inForceNow: boolean }) => [
        row.versionNumber,
        row.inForceNow,
      ]),
    ).toEqual([
      [2, true],
      [1, false],
    ]);

    const after = await orders.createAgentOrder(orderInput(productId), {
      userId: internalId,
    });
    const beforeSnap = await snapshotOf(before.id);
    const afterSnap = await snapshotOf(after.id);
    expect(beforeSnap).toMatchObject({
      agreementId,
      productCommissionRatePercent: 35,
    });
    expect(beforeSnap.lines?.[0].commission?.ratePercent).toBe(35);
    expect(afterSnap).toMatchObject({
      agreementId: edited.body.id,
      agreementVersion: 2,
      productCommissionRatePercent: 30,
    });
    expect(afterSnap.lines?.[0].commission?.ratePercent).toBe(30);

    // The ENDED version is read-only; an unchanged edit creates nothing.
    const closed = await post(internalToken, path, {
      productCommissionRatePercent: 20,
    });
    expect(closed.status).toBe(409);
    expect(closed.body.code).toBe('AGREEMENT_NOT_IN_FORCE');
    const same = await post(
      internalToken,
      `/agents/${agent.id}/agreements/${edited.body.id}/versions`,
      { productCommissionRatePercent: 30 },
    );
    expect(same.status).toBe(422);
    expect(same.body.code).toBe('AGREEMENT_NO_CHANGES');
  });

  it('permission: agents.agreements.manage only — viewers 403, agents never reach the internal API', async () => {
    const { agent, agreementId, v1 } = await makeAgent('PERM');
    const commission = `/agents/${agent.id}/agreements/${agreementId}/versions`;
    const shipping = `${shippingBase(agent.id)}/${v1.id}/versions`;
    const viewerCommission = await post(viewerToken, commission, {
      productCommissionRatePercent: 30,
    });
    expect(viewerCommission.status).toBe(403);
    const viewerShipping = await post(viewerToken, shipping, {
      rates: [{ service: 'ANY', amount: 30 }],
    });
    expect(viewerShipping.status).toBe(403);
    const admin = await agentUsers.create(
      agent.id,
      {
        email: `r17-perm-${lower}@test.local`,
        username: `r17-perm-${lower}`,
        fullName: `R17 perm ${tag}`,
        agentRole: 'ADMIN',
      },
      internalId,
    );
    await prisma.user.update({
      where: { id: admin.id },
      data: { mustChangePassword: false },
    });
    const agentToken = await sessionTokens.issueAccessToken({
      sub: admin.id,
      email: admin.email,
      typ: 'agent',
      agentId: agent.id,
    });
    for (const path of [commission, shipping]) {
      const denied = await post(agentToken, path, {
        productCommissionRatePercent: 30,
        rates: [{ service: 'ANY', amount: 30 }],
      });
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('AGENT_ACCESS_DENIED');
    }
    // Nothing changed.
    expect(
      await prisma.agentShippingAgreement.count({
        where: { agentId: agent.id },
      }),
    ).toBe(1);
    expect(
      await prisma.agentAgreement.count({ where: { agentId: agent.id } }),
    ).toBe(1);
  });
});
