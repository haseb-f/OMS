/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment -- supertest response bodies are untyped JSON under assertion */
import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  HttpException,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server } from 'http';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { PaymentOrigin, PaymentStatus, type Prisma } from '@prisma/client';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../common/errors/all-exceptions.filter';
import { formatValidationErrors } from '../../common/errors/format-validation-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../../inventory/inventory.service';
import { ExchangeRatesService } from '../../accounting/fx/exchange-rates.service';
import { StoreOrderShipmentOperationsService } from '../../store-orders/shipments/store-order-shipment-operations.service';
import { CarrierReconciliationService } from '../../carrier-reconciliation/carrier-reconciliation.service';
import { AgentsService } from '../admin/agents.service';
import { AgentAgreementsService } from '../admin/agent-agreements.service';
import { AgentUsersService } from '../admin/agent-users.service';
import { AgentOrdersService } from '../orders/agent-orders.service';
import type { CreateAgreementDto } from '../admin/dto/agreement.dto';
import type { CreateAgentOrderDto } from '../orders/dto/agent-order.dto';
import type { AgentOrderSnapshot } from '../common/agent-terms';
import { AgentFulfillmentService } from '../finance/agent-fulfillment.service';
import { leakedKeys } from './leaked-keys.test-util';

async function expectCode(promise: Promise<unknown>, code: string) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(HttpException);
  expect((caught as HttpException).getResponse()).toMatchObject({ code });
}

/**
 * Spec 2 (Round 5) acceptance — agent shipping tariffs, pricing status,
 * shipping included / added, customer-total confirmation, earning with the
 * resolved fee, carrier charges never touching the agent ledger, internal
 * margin, portal leak closure and product linking. Real HTTP pipeline
 * (AppModule, guards, JWTs) on the local Postgres; tagged fixtures.
 */
describe('Spec 2 — agent shipping tariffs and pricing (HTTP integration)', () => {
  jest.setTimeout(300_000);
  let moduleRef: TestingModule;
  let app: INestApplication;
  let http: Server;
  let prisma: PrismaService;
  let jwt: JwtService;
  let orders: AgentOrdersService;
  let shipments: StoreOrderShipmentOperationsService;
  let carrier: CarrierReconciliationService;
  let fulfillment: AgentFulfillmentService;

  const tag = randomUUID().slice(0, 6).toUpperCase();
  const lower = tag.toLowerCase();
  let seq = 0;
  const next = () => `${tag}-${++seq}`;
  let phoneSeq = 0;
  const phone = () =>
    `+2010${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}${String(++phoneSeq % 100).padStart(2, '0')}`;

  let internalId: string;
  let internalToken: string;
  let adminToken: string; // agent A admin (view_all, statement)
  let currencyId: string;
  let paymentMethodId: string;
  let paymentSourceId: string;
  let egId: string;
  let categoryId: string;
  let unitId: string;
  let warehouseId: string;
  let agentAId: string; // worked tariff
  let agentBId: string; // carrier 25 / internal COD 35 (acceptance 4)
  let productAId: string;
  let productBId: string;
  let carrierCoId: string;
  let courierCoId: string;

  const get = (token: string, path: string) =>
    request(http).get(path).set('Authorization', `Bearer ${token}`);
  const post = (token: string, path: string, body: object = {}) =>
    request(http).post(path).set('Authorization', `Bearer ${token}`).send(body);
  const put = (token: string, path: string, body: object = {}) =>
    request(http).put(path).set('Authorization', `Bearer ${token}`).send(body);

  type TariffInput = {
    deliveryChannel: 'ANY' | 'CARRIER' | 'INTERNAL_COURIER';
    paymentType: 'ANY' | 'PREPAID' | 'CASH_ON_DELIVERY';
    amount: number;
  };
  let makeAgent: (
    suffix: string,
    tariffs: TariffInput[],
    over?: Partial<CreateAgreementDto>,
  ) => Promise<string>;

  const terms = (
    over: Partial<CreateAgreementDto> = {},
  ): CreateAgreementDto => ({
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
    ...over,
  });

  const makeProduct = async (owner: string | null, stocked = true) => {
    const sku = `R5P-${next()}`;
    const product = await prisma.product.create({
      data: {
        sku,
        name: `R5 pricing ${sku}`,
        internalName: sku,
        displayName: `R5 pricing ${sku}`,
        categoryId,
        unitId,
        type: 'PURCHASE_AND_SALE',
        status: 'ACTIVE',
        isPurchasable: true,
        isSellable: true,
        isInventoryItem: stocked,
        itemType: 'PRODUCT',
        salesPrice: 100,
        preferredWarehouseId: warehouseId,
        ownerAgentId: owner,
      },
    });
    if (stocked) {
      await moduleRef
        .get(InventoryService, { strict: false })
        .openingBalance(
          { productId: product.id, warehouseId, quantity: 50 },
          internalId,
        );
    }
    return product.id;
  };

  const orderInput = (
    productId: string,
    over: Partial<CreateAgentOrderDto> = {},
  ): CreateAgentOrderDto => ({
    pricingMode: 'SHIPPING_ADDED',
    lines: [{ productId, quantity: 1, lineAmount: 400 }],
    fulfillmentMethod: 'SHIPPING',
    paymentType: 'CASH_ON_DELIVERY',
    countryId: egId,
    city: 'Riyadh',
    customer: { name: `R5 customer ${tag}`, mobile: phone(), countryId: egId },
    ...over,
  });

  const createOrder = async (
    productId: string,
    over: Partial<CreateAgentOrderDto> = {},
  ) => {
    const order = await orders.createAgentOrder(orderInput(productId, over), {
      userId: internalId,
    });
    return order.id;
  };

  const assign = (orderId: string, shippingCompanyId: string) =>
    post(internalToken, `/store-orders/${orderId}/shipments/shipping-company`, {
      shippingCompanyId,
    });

  const loadOrder = (id: string) =>
    prisma.storeOrder.findUniqueOrThrow({
      where: { id },
      include: {
        items: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      },
    });

  const snapshotOf = async (id: string) =>
    (await loadOrder(id)).agentTermsSnapshot as unknown as AgentOrderSnapshot;

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
    orders = moduleRef.get(AgentOrdersService, { strict: false });
    shipments = moduleRef.get(StoreOrderShipmentOperationsService, {
      strict: false,
    });
    carrier = moduleRef.get(CarrierReconciliationService, { strict: false });
    fulfillment = moduleRef.get(AgentFulfillmentService, { strict: false });
    const agents = moduleRef.get(AgentsService, { strict: false });
    const agreements = moduleRef.get(AgentAgreementsService, { strict: false });
    const agentUsers = moduleRef.get(AgentUsersService, { strict: false });

    const internal = await prisma.user.create({
      data: {
        email: `r5p-internal-${lower}@test.local`,
        username: `r5p-internal-${lower}`,
        fullName: `R5 Pricing Internal ${tag}`,
        passwordHash: 'x',
        isSuperAdmin: true,
      },
    });
    internalId = internal.id;
    internalToken = jwt.sign({ sub: internal.id, email: internal.email });

    // The functional currency: agent postings need no FX rate.
    currencyId = await moduleRef
      .get(ExchangeRatesService, { strict: false })
      .requireFunctionalCurrencyId();
    const eg = await prisma.country.findFirst({ where: { code: 'EG' } });
    if (!eg) throw new Error('Expected country EG in the local database.');
    egId = eg.id;
    categoryId = (
      await prisma.productCategory.create({
        data: { name: `r5p-${tag}-category` },
      })
    ).id;
    unitId = (await prisma.unit.create({ data: { name: `r5p-${tag}-unit` } }))
      .id;
    warehouseId = (
      await prisma.warehouse.create({
        data: { code: `R5P-${tag}`, name: `R5 pricing WH ${tag}` },
      })
    ).id;
    paymentMethodId = (
      await prisma.paymentMethod.create({
        data: { name: `R5 method ${tag}`, requiresReconciliation: false },
      })
    ).id;
    paymentSourceId = (
      await prisma.paymentSource.findFirstOrThrow({
        where: { deletedAt: null, isActive: true },
      })
    ).id;
    carrierCoId = (
      await prisma.shippingCompany.create({
        data: { name: `R5 carrier ${tag}`, type: 'EXTERNAL_COMPANY' },
      })
    ).id;
    courierCoId = (
      await prisma.shippingCompany.create({
        data: { name: `R5 courier ${tag}`, type: 'INTERNAL_DELIVERY' },
      })
    ).id;

    makeAgent = async (suffix, tariffs, over = {}) => {
      const agent = await agents.create(
        {
          name: `R5 agent ${suffix} ${tag}`,
          email: `r5p-agent-${suffix.toLowerCase()}-${lower}@test.local`,
          currencyId,
        },
        internal.id,
      );
      const agreement = await agreements.create(
        agent.id,
        terms(over),
        internal.id,
      );
      // Tariff CRUD through the agreement admin endpoint (spec 2B).
      for (const tariff of tariffs) {
        const res = await put(
          internalToken,
          `/agents/${agent.id}/agreements/${agreement.id}/shipping-rates`,
          { countryId: egId, ...tariff },
        );
        expect(res.status).toBe(200);
      }
      await agreements.activate(agent.id, agreement.id, internal.id);
      return agent.id;
    };
    agentAId = await makeAgent('A', [
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
    ]);
    agentBId = await makeAgent('B', [
      { deliveryChannel: 'CARRIER', paymentType: 'ANY', amount: 25 },
      {
        deliveryChannel: 'INTERNAL_COURIER',
        paymentType: 'CASH_ON_DELIVERY',
        amount: 35,
      },
    ]);
    productAId = await makeProduct(agentAId);
    productBId = await makeProduct(agentBId);

    const admin = await agentUsers.create(
      agentAId,
      {
        email: `r5p-admin-${lower}@test.local`,
        username: `r5p-admin-${lower}`,
        fullName: `R5 admin ${tag}`,
        agentRole: 'ADMIN',
      },
      internal.id,
    );
    await prisma.user.update({
      where: { id: admin.id },
      data: { mustChangePassword: false },
    });
    adminToken = jwt.sign({
      sub: admin.id,
      email: admin.email,
      typ: 'agent',
      agentId: agentAId,
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('tariff CRUD: the agreement lists channel × payment type rows; one row per key', async () => {
    const res = await get(internalToken, `/agents/${agentAId}/agreements`);
    expect(res.status).toBe(200);
    const rates = res.body[0].shippingRates.map(
      (r: { deliveryChannel: string; paymentType: string; amount: string }) =>
        `${r.deliveryChannel}/${r.paymentType}=${Number(r.amount)}`,
    );
    expect(rates.sort()).toEqual([
      'CARRIER/CASH_ON_DELIVERY=35',
      'CARRIER/PREPAID=25',
      'INTERNAL_COURIER/CASH_ON_DELIVERY=25',
    ]);
  });

  it('acceptance 1+2 — COD: pending at submission, dispatch refused, carrier 35 / courier 25 on assignment, re-resolved before dispatch, frozen after', async () => {
    const quote = await orders.quote(orderInput(productAId), {
      userId: internalId,
    });
    expect(quote.valid).toBe(true);
    expect(quote.shippingPricingStatus).toBe('PENDING_METHOD');
    expect(quote.agentShippingCharge).toMatchObject({
      amount: 35,
      provisional: true,
      deliveryChannel: 'CARRIER',
    });

    const id = await createOrder(productAId);
    let order = await loadOrder(id);
    expect(order.shippingPricingStatus).toBe('PENDING_METHOD');
    expect(Number(order.shippingCharge)).toBe(35);
    expect(Number(order.payableTotal)).toBe(435);

    // No delivery method yet → dispatch refused.
    await expectCode(
      shipments.markShipped(id, internalId),
      'AGENT_SHIPPING_PRICING_PENDING',
    );
    expect((await loadOrder(id)).agentDispatchedAt).toBeNull();

    const toCarrier = await assign(id, carrierCoId);
    expect(toCarrier.status).toBe(200);
    order = await loadOrder(id);
    expect(order.shippingPricingStatus).toBe('CONFIRMED');
    let snap = await snapshotOf(id);
    expect(snap.agentShippingCharge).toMatchObject({
      amount: 35,
      source: 'TARIFF',
      provisional: false,
      deliveryChannel: 'CARRIER',
      paymentType: 'CASH_ON_DELIVERY',
    });

    // Re-assignment before dispatch re-resolves (lower payable applied).
    expect((await assign(id, courierCoId)).status).toBe(200);
    order = await loadOrder(id);
    snap = await snapshotOf(id);
    expect(snap.agentShippingCharge).toMatchObject({
      amount: 25,
      deliveryChannel: 'INTERNAL_COURIER',
    });
    expect(Number(order.shippingCharge)).toBe(25);
    expect(Number(order.payableTotal)).toBe(425);
    expect(order.customerTotalStatus).toBe('NONE');
    const audit = await prisma.storeOrderActivity.findMany({
      where: { storeOrderId: id, action: 'AGENT_SHIPPING_TARIFF_RESOLVED' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit).toHaveLength(2);
    expect(audit[1].details).toContain('35.00 → 25.00');

    await shipments.markShipped(id, internalId);
    expect((await loadOrder(id)).agentDispatchedAt).not.toBeNull();
    // After dispatch the tariff is frozen.
    expect((await assign(id, carrierCoId)).status).toBe(200);
    expect((await snapshotOf(id)).agentShippingCharge).toMatchObject({
      amount: 25,
      deliveryChannel: 'INTERNAL_COURIER',
    });
  });

  it('acceptance 1 — prepaid: carrier 25; internal courier has no tariff → assignment refused (names the combination)', async () => {
    const id = await createOrder(productAId, { paymentType: 'PREPAID' });
    expect((await loadOrder(id)).shippingPricingStatus).toBe('PENDING_METHOD');
    // Prepaid shipments need a full paid declaration first (fulfillment gate).
    await prisma.storeOrder.update({
      where: { id },
      data: { declaredPaymentStatus: 'PAID', declaredAmount: 425 },
    });
    const refused = await assign(id, courierCoId);
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('AGENT_SHIPPING_TARIFF_MISSING');
    expect(refused.body.message).toContain('Internal courier × Prepaid');
    expect((await loadOrder(id)).shippingPricingStatus).toBe('PENDING_METHOD');

    expect((await assign(id, carrierCoId)).status).toBe(200);
    const order = await loadOrder(id);
    expect(order.shippingPricingStatus).toBe('CONFIRMED');
    expect(Number(order.shippingCharge)).toBe(25);
  });

  it('acceptance 3 — shipping included: agreed total 500, fee 35 → merchandise 465, shipping 35, difference 0', async () => {
    const id = await createOrder(productAId, {
      pricingMode: 'SHIPPING_INCLUDED',
      agreedTotal: 500,
      lines: [{ productId: productAId, quantity: 2 }],
    });
    // Courier first (25 → merchandise 475), then the carrier (35 → 465).
    expect((await assign(id, courierCoId)).status).toBe(200);
    expect(Number((await loadOrder(id)).merchandiseAmount)).toBe(475);
    expect((await assign(id, carrierCoId)).status).toBe(200);
    const order = await loadOrder(id);
    expect(Number(order.payableTotal)).toBe(500);
    expect(Number(order.shippingCharge)).toBe(35);
    expect(Number(order.merchandiseAmount)).toBe(465);
    expect(
      order.items.reduce((s, i) => s + Number(i.agreedAmount), 0),
    ).toBeCloseTo(465, 2);
    const snap = await snapshotOf(id);
    expect(
      Number(order.shippingCharge) - snap.agentShippingCharge!.amount,
    ).toBe(0);
  });

  it('acceptance 4+5 — shipping added: 425 → 435 needs the customer; paid 425 shows 10 outstanding; earning retains the resolved fee once', async () => {
    const id = await createOrder(productBId);
    let order = await loadOrder(id);
    expect(order.shippingPricingStatus).toBe('PENDING_METHOD');
    expect(Number(order.payableTotal)).toBe(425);
    await prisma.payment.create({
      data: {
        paymentNumber: `PAY-R5P-${next()}`,
        storeOrderId: id,
        paymentDate: new Date(),
        amount: 425,
        currencyId,
        paymentSourceId,
        paymentMethodId,
        origin: PaymentOrigin.SALES_DECLARATION,
        senderName: 'R5 customer',
        status: PaymentStatus.VERIFIED,
        agentId: agentBId,
        destinationOwnership: 'COMPANY',
      },
    });

    expect((await assign(id, courierCoId)).status).toBe(200);
    order = await loadOrder(id);
    expect(order.shippingPricingStatus).toBe('CONFIRMED');
    expect(order.customerTotalStatus).toBe('CONFIRMATION_REQUIRED');
    // Nothing is re-billed silently: the provisional total stays claimable.
    expect(Number(order.payableTotal)).toBe(425);
    const pending = await get(
      internalToken,
      `/agent-orders/${id}/shipping-pricing`,
    );
    expect(pending.status).toBe(200);
    expect(pending.body.customerTotalChange).toMatchObject({
      previousPayableTotal: 425,
      proposedPayableTotal: 435,
    });

    // Delivered while the customer has not agreed → no earning yet.
    await shipments.markShipped(id, internalId);
    await shipments.markDelivered(id, internalId);
    expect((await loadOrder(id)).agentEarnedAt).toBeNull();

    const stale = await post(
      internalToken,
      `/agent-orders/${id}/customer-total/confirm`,
      { expectedPayableTotal: 430 },
    );
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('AGENT_CUSTOMER_TOTAL_CHANGED');
    const confirmed = await post(
      internalToken,
      `/agent-orders/${id}/customer-total/confirm`,
      { expectedPayableTotal: 435 },
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({
      customerTotalStatus: 'CONFIRMED',
      payableTotal: 435,
      customerShipping: 35,
      paidAmount: 425,
      outstanding: 10,
    });
    expect(
      (
        await prisma.storeOrderActivity.findFirst({
          where: { storeOrderId: id, action: 'AGENT_CUSTOMER_TOTAL_CONFIRMED' },
        })
      )?.details,
    ).toContain('Customer agreed to pay 435.00');

    // The confirmation retried the earning event: retained = resolved fee.
    expect((await loadOrder(id)).agentEarnedAt).not.toBeNull();
    const ledger = await prisma.agentLedgerEntry.findMany({
      where: { storeOrderId: id },
    });
    const retained = ledger.filter(
      (e) => e.entryType === 'CUSTOMER_SHIPPING_RETAINED',
    );
    expect(retained).toHaveLength(1);
    expect(Number(retained[0].debit)).toBe(35);
    expect(retained[0].basis).toMatchObject({
      agentShippingCharge: 35,
      appliedToAgentShippingCharge: 35,
      difference: 0,
    });
    // No second shipping debit.
    expect(ledger.some((e) => e.entryType === 'SHIPPING_FEE')).toBe(false);
  });

  it('acceptance 5 — carrier charges never create an agent ledger entry; internal margin = fee − carrier cost (25 − 20 = 5)', async () => {
    const id = await createOrder(productAId, { paymentType: 'PREPAID' });
    await prisma.storeOrder.update({
      where: { id },
      data: { declaredPaymentStatus: 'PAID', declaredAmount: 425 },
    });
    expect((await assign(id, carrierCoId)).status).toBe(200);
    await shipments.markShipped(id, internalId);
    await shipments.markDelivered(id, internalId);
    const shipment = await prisma.shipment.findFirstOrThrow({
      where: { storeOrderId: id, deletedAt: null },
    });
    const before = await prisma.agentLedgerEntry.findMany({
      where: { agentId: agentAId },
      select: { id: true },
    });
    const charge = await prisma.carrierCharge.create({
      data: {
        carrierNameRaw: `R5 carrier ${tag}`,
        carrierReference: `R5-CR-${next()}`,
        chargeAmount: 20,
        currencyId,
        chargeDate: new Date(),
        chargeKind: 'BASE',
        dedupeKey: `r5p-${next()}`,
        shipmentId: shipment.id,
        reconciliationState: 'MATCHED',
        matchedAt: new Date(),
      },
    });
    await carrier.confirm(charge.id, internalId);
    const after = await prisma.agentLedgerEntry.findMany({
      where: { agentId: agentAId },
      select: { id: true },
    });
    expect(after.map((e) => e.id).sort()).toEqual(
      before.map((e) => e.id).sort(),
    );

    const internal = await get(
      internalToken,
      `/agent-orders/${id}/shipping-pricing`,
    );
    expect(internal.status).toBe(200);
    expect(internal.body.economics).toMatchObject({
      contractualFee: 25,
      margin: { amount: 5, basis: 'ACTUAL' },
    });
    const report = await get(
      internalToken,
      `/agent-finance/agents/${agentAId}/commission-report`,
    );
    expect(report.status).toBe(200);
    const row = report.body.orders.find(
      (o: { storeOrderId: string }) => o.storeOrderId === id,
    );
    expect(row.shipping.margin).toEqual({ amount: 5, basis: 'ACTUAL' });
    expect(report.body.summary.carrierCost).toBeDefined();
  });

  it('acceptance 6 — agent portal responses carry no carrier cost / margin keys', async () => {
    const detailId = (
      await prisma.storeOrder.findFirstOrThrow({
        where: { agentId: agentAId, agentDispatchedAt: { not: null } },
        select: { id: true },
      })
    ).id;
    const paths = [
      '/agent-portal/me',
      '/agent-portal/dashboard',
      '/agent-portal/products',
      '/agent-portal/stock',
      '/agent-portal/orders',
      `/agent-portal/orders/${detailId}`,
      '/agent-portal/statement',
      '/agent-portal/statement/summary',
      '/agent-portal/statement/print-data',
      '/agent-portal/commission-report',
      '/agent-portal/payouts',
    ];
    for (const path of paths) {
      const res = await get(adminToken, path);
      expect({ path, status: res.status }).toEqual({ path, status: 200 });
      expect({ path, leaked: leakedKeys(res.body) }).toEqual({
        path,
        leaked: [],
      });
    }
    const detail = await get(adminToken, `/agent-portal/orders/${detailId}`);
    expect(detail.body.shippingPricing).toMatchObject({ status: 'CONFIRMED' });
    // Tariff dimensions are part of the agent's own agreement terms.
    const me = await get(adminToken, '/agent-portal/me');
    expect(me.body.agreement.shippingRates[0]).toHaveProperty(
      'deliveryChannel',
    );
  });

  it('agent portal confirms the customer total for its own order', async () => {
    const id = await createOrder(productAId, {
      pricingMode: 'SHIPPING_ADDED',
    });
    // Courier 25 → lower (applied), then carrier 35 → confirmation required.
    expect((await assign(id, courierCoId)).status).toBe(200);
    expect((await assign(id, carrierCoId)).status).toBe(200);
    expect((await loadOrder(id)).customerTotalStatus).toBe(
      'CONFIRMATION_REQUIRED',
    );
    const res = await post(
      adminToken,
      `/agent-portal/orders/${id}/customer-total/confirm`,
      { expectedPayableTotal: 435 },
    );
    expect(res.status).toBe(200);
    expect(res.body.shippingPricing).toMatchObject({
      customerTotalStatus: 'CONFIRMED',
      payableTotal: 435,
    });
    expect(leakedKeys(res.body)).toEqual([]);
    const again = await post(
      adminToken,
      `/agent-portal/orders/${id}/customer-total/confirm`,
      { expectedPayableTotal: 435 },
    );
    expect(again.body.code).toBe('AGENT_CUSTOMER_TOTAL_NOT_PENDING');
    // The shown total must always be echoed back.
    const blind = await post(
      internalToken,
      `/agent-orders/${id}/customer-total/confirm`,
    );
    expect(blind.status).toBe(400);
    expect(again.status).toBe(409);
  });

  it('review H1 — prepaid + PAYMENT_VERIFIED never earns on a provisional fee; the assignment earns; the earned fee is frozen', async () => {
    const agentId = await makeAgent(
      `H1${next()}`,
      [
        { deliveryChannel: 'CARRIER', paymentType: 'PREPAID', amount: 25 },
        {
          deliveryChannel: 'INTERNAL_COURIER',
          paymentType: 'PREPAID',
          amount: 35,
        },
      ],
      { commissionEarningEvent: 'PAYMENT_VERIFIED' },
    );
    const productId = await makeProduct(agentId);
    const id = await createOrder(productId, { paymentType: 'PREPAID' });
    let order = await loadOrder(id);
    expect(order.shippingPricingStatus).toBe('PENDING_METHOD');
    expect(Number(order.payableTotal)).toBe(425);
    await prisma.payment.create({
      data: {
        paymentNumber: `PAY-R5P-${next()}`,
        storeOrderId: id,
        paymentDate: new Date(),
        amount: 425,
        currencyId,
        paymentSourceId,
        paymentMethodId,
        origin: PaymentOrigin.SALES_DECLARATION,
        senderName: 'R5 customer',
        status: PaymentStatus.VERIFIED,
        agentId,
        destinationOwnership: 'COMPANY',
      },
    });
    await prisma.storeOrder.update({
      where: { id },
      data: { declaredPaymentStatus: 'PAID', declaredAmount: 425 },
    });
    // Fully verified, but the fee is provisional → no earning.
    const earned = await prisma.$transaction((tx) =>
      fulfillment.tryEarn(tx, id, 'PAYMENT_VERIFIED', internalId),
    );
    expect(earned).toBe(false);
    expect((await loadOrder(id)).agentEarnedAt).toBeNull();

    // Carrier (25) confirms the fee → the assignment retries the earning.
    expect((await assign(id, carrierCoId)).status).toBe(200);
    order = await loadOrder(id);
    expect(order.agentEarnedAt).not.toBeNull();
    const retained = await prisma.agentLedgerEntry.findFirstOrThrow({
      where: { storeOrderId: id, entryType: 'CUSTOMER_SHIPPING_RETAINED' },
    });
    expect(Number(retained.debit)).toBe(25);
    // Another method would change an earned fee → refused; same fee passes.
    const frozen = await assign(id, courierCoId);
    expect(frozen.status).toBe(409);
    expect(frozen.body.code).toBe('AGENT_SHIPPING_FEE_FROZEN');
    expect((await assign(id, carrierCoId)).status).toBe(200);
    expect((await snapshotOf(id)).agentShippingCharge?.amount).toBe(25);
  });

  it('review M2 — a tariff edited after submission never changes the order; legacy snapshots ship unchanged', async () => {
    const agentId = await makeAgent(`M2${next()}`, [
      { deliveryChannel: 'CARRIER', paymentType: 'ANY', amount: 25 },
      { deliveryChannel: 'INTERNAL_COURIER', paymentType: 'ANY', amount: 30 },
    ]);
    const productId = await makeProduct(agentId);
    const id = await createOrder(productId);
    const legacyId = await createOrder(productId);
    expect((await snapshotOf(id)).agentShippingCharge?.byChannel).toEqual({
      CARRIER: expect.objectContaining({ amount: 25 }),
      INTERNAL_COURIER: expect.objectContaining({ amount: 30 }),
    });
    const agreementId = (await loadOrder(id)).agentAgreementId!;
    await prisma.agentShippingRate.updateMany({
      where: { agreementId, deliveryChannel: 'CARRIER' },
      data: { amount: 99 },
    });
    expect((await assign(id, carrierCoId)).status).toBe(200);
    expect(Number((await loadOrder(id)).shippingCharge)).toBe(25);
    expect((await snapshotOf(id)).agentShippingCharge?.amount).toBe(25);

    // Legacy: priced once at submission (no frozen channels, no payment type).
    const snap = await snapshotOf(legacyId);
    await prisma.storeOrder.update({
      where: { id: legacyId },
      data: {
        shippingPricingStatus: 'CONFIRMED',
        agentTermsSnapshot: {
          ...snap,
          agentShippingCharge: { amount: 25, source: 'RATE', rateId: null },
        } as unknown as Prisma.InputJsonValue,
      },
    });
    expect((await assign(legacyId, courierCoId)).status).toBe(200);
    await shipments.markShipped(legacyId, internalId);
    const legacy = await loadOrder(legacyId);
    expect(legacy.agentDispatchedAt).not.toBeNull();
    expect(Number(legacy.shippingCharge)).toBe(25);
    expect(
      (legacy.agentTermsSnapshot as unknown as AgentOrderSnapshot)
        .agentShippingCharge,
    ).toEqual({ amount: 25, source: 'RATE', rateId: null });
  });

  it('review M3/L — link needs products.edit; concurrent links: one wins; tariff city unique ignoring case', async () => {
    const clerk = await prisma.user.create({
      data: {
        email: `r5p-clerk-${lower}@test.local`,
        username: `r5p-clerk-${lower}`,
        fullName: `R5 clerk ${tag}`,
        passwordHash: 'x',
      },
    });
    const permission = await prisma.permission.upsert({
      where: { name: 'agents.edit' },
      create: { name: 'agents.edit' },
      update: {},
    });
    await prisma.userPermission.create({
      data: { userId: clerk.id, permissionId: permission.id },
    });
    const clerkToken = jwt.sign({ sub: clerk.id, email: clerk.email });
    const product = await makeProduct(null, false);
    const denied = await post(
      clerkToken,
      `/agents/${agentAId}/products/${product}/link`,
    );
    expect(denied.status).toBe(403);

    const results = await Promise.all([
      post(internalToken, `/agents/${agentAId}/products/${product}/link`),
      post(internalToken, `/agents/${agentBId}/products/${product}/link`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const owner = (
      await prisma.product.findUniqueOrThrow({ where: { id: product } })
    ).ownerAgentId;
    expect([agentAId, agentBId]).toContain(owner);

    const rate = await prisma.agentShippingRate.findFirstOrThrow({
      where: { agreement: { agentId: agentAId } },
    });
    await expect(
      prisma.agentShippingRate.create({
        data: {
          agreementId: rate.agreementId,
          countryId: rate.countryId,
          city: ` ${rate.city.toUpperCase()}X `.replace('X', ''),
          deliveryChannel: rate.deliveryChannel,
          paymentType: rate.paymentType,
          amount: 1,
        },
      }),
    ).rejects.toThrow();
  });

  it('acceptance 7 — link / unlink from the agent Products tab; own active sellable products only', async () => {
    const companyProduct = await makeProduct(null, false);
    const link = await post(
      internalToken,
      `/agents/${agentAId}/products/${companyProduct}/link`,
    );
    expect(link.status).toBe(201);
    expect(link.body.ownerAgentId).toBe(agentAId);

    const tab = await get(internalToken, `/agents/${agentAId}/products`);
    expect(tab.status).toBe(200);
    const linked = tab.body.items.find(
      (p: { id: string }) => p.id === companyProduct,
    );
    expect(linked).toMatchObject({
      itemType: 'PRODUCT',
      commission: { source: 'AGREEMENT', ratePercent: 10 },
    });

    const portal = await get(adminToken, '/agent-portal/products');
    const ids = portal.body.items.map((p: { id: string }) => p.id);
    expect(ids).toContain(companyProduct);
    expect(ids).not.toContain(productBId);

    // Referenced by orders → unlink refused with the readable 409.
    const locked = await post(
      internalToken,
      `/agents/${agentAId}/products/${productAId}/unlink`,
    );
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('PRODUCT_OWNER_LOCKED');

    // Linking another agent's product is refused; unreferenced unlink works.
    const foreign = await post(
      internalToken,
      `/agents/${agentAId}/products/${productBId}/link`,
    );
    expect(foreign.status).toBe(409);
    const unlink = await post(
      internalToken,
      `/agents/${agentAId}/products/${companyProduct}/unlink`,
    );
    expect(unlink.status).toBe(201);
    expect(unlink.body.ownerAgentId).toBeNull();
    const after = await get(adminToken, '/agent-portal/products');
    expect(after.body.items.map((p: { id: string }) => p.id)).not.toContain(
      companyProduct,
    );

    // An inactive product of the agent is not offered to agent users.
    await prisma.product.update({
      where: { id: companyProduct },
      data: { ownerAgentId: agentAId, status: 'INACTIVE' },
    });
    const inactive = await get(adminToken, '/agent-portal/products');
    expect(inactive.body.items.map((p: { id: string }) => p.id)).not.toContain(
      companyProduct,
    );

    const linkable = await get(
      internalToken,
      `/agents/${agentAId}/products/linkable?search=R5 pricing`,
    );
    expect(linkable.status).toBe(200);
    expect(
      linkable.body.every((p: { id: string }) => p.id !== productAId),
    ).toBe(true);
  });
});
