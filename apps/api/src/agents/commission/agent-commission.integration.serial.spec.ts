import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import {
  AccountType,
  PartnerRoleType,
  PaymentOrigin,
  PaymentStatus,
  StoreOrderFulfillmentMethod,
  StoreOrderPaymentType,
  type CarrierChargeKind,
  type ItemType,
  type Prisma,
} from '@prisma/client';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsCoreModule } from '../../permissions/permissions-core.module';
import { PhoneModule } from '../../common/phone/phone.module';
import { AuthModule } from '../../auth/auth.module';
import { PostingProvidersModule } from '../../accounting/posting-providers/posting-providers.module';
import { FxModule } from '../../accounting/fx/fx.module';
import { ExchangeRatesService } from '../../accounting/fx/exchange-rates.service';
import { GoogleSheetsService } from '../../import-center/google-sheets.service';
import { PaymentReconciliationModule } from '../../payment-reconciliation/payment-reconciliation.module';
import { PaymentSettlementsModule } from '../../payment-settlements/payment-settlements.module';
import { PaymentsService } from '../../payments/payments.service';
import { StoreOrderShipmentOperationsService } from '../../store-orders/shipments/store-order-shipment-operations.service';
import { InventoryService } from '../../inventory/inventory.service';
import { CarrierReconciliationModule } from '../../carrier-reconciliation/carrier-reconciliation.module';
import { CarrierReconciliationService } from '../../carrier-reconciliation/carrier-reconciliation.service';
import { AgentsAdminModule } from '../admin/agents-admin.module';
import { AgentAgreementsService } from '../admin/agent-agreements.service';
import { AgentShippingAgreementsModule } from '../shipping-agreements/agent-shipping-agreements.module';
import { AgentShippingAgreementsService } from '../shipping-agreements/agent-shipping-agreements.service';
import {
  activateShippingAgreement,
  everyService,
} from '../shipping-agreements/shipping-agreement.fixture';
import { AgentOrdersModule } from '../orders/agent-orders.module';
import { AgentOrdersService } from '../orders/agent-orders.service';
import type { CreateAgreementDto } from '../admin/dto/agreement.dto';
import type { CreateAgentOrderDto } from '../orders/dto/agent-order.dto';
import { AgentFinanceModule } from '../finance/agent-finance.module';
import { AgentFulfillmentService } from '../finance/agent-fulfillment.service';
import { AgentPayoutsService } from '../finance/agent-payouts.service';
import { AgentStatementService } from '../finance/agent-statement.service';
import { AgentAdjustmentsService } from '../finance/agent-adjustments.service';
import { AgentCommissionReportService } from '../finance/agent-commission-report.service';
import type {
  AgentShippingChargeSnapshot,
  AgentTermsSnapshot,
} from '../common/agent-terms';
import { AgentCommissionRatesService } from './agent-commission-rates.service';
import type { AgentLineCommissionRate } from './agent-commission';

/**
 * Commission and shipping policy acceptance (specs/agents-fulfillment-partners/
 * commission-policy.md A8) against the real local Postgres. Tagged,
 * self-created fixtures; the agreement currency is the functional currency.
 * Agent posting accounts are set for the run and restored afterwards.
 */
const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(
  process.env.DATABASE_URL ?? '',
);
const describeDb = LOCAL_DB ? describe : describe.skip;

describeDb('Agent commission and shipping policy (local DB)', () => {
  jest.setTimeout(300_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let payments: PaymentsService;
  let shipments: StoreOrderShipmentOperationsService;
  let inventory: InventoryService;
  let carrier: CarrierReconciliationService;
  let agreements: AgentAgreementsService;
  let shippingAgreements: AgentShippingAgreementsService;
  let orders: AgentOrdersService;
  let fulfillment: AgentFulfillmentService;
  let payouts: AgentPayoutsService;
  let statements: AgentStatementService;
  let adjustments: AgentAdjustmentsService;
  let report: AgentCommissionReportService;
  let rates: AgentCommissionRatesService;

  const tag = randomUUID().slice(0, 6).toUpperCase();
  let seq = 0;
  const next = () => `${tag}-${++seq}`;
  const day = (offset: number) => {
    const now = new Date();
    return new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + offset,
      ),
    );
  };
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  let userId: string;
  let currencyId: string;
  let customerId: string;
  let countryId: string;
  let paymentSourceId: string;
  let bankReceivingId: string;
  let bankMethodId: string;
  let warehouseId: string;
  let categoryId: string;
  let unitId: string;
  const originalSettings: Record<string, string | null> = {};

  const PRODUCT35: AgentLineCommissionRate = {
    commissionClass: 'PRODUCT',
    rateSource: 'AGREEMENT_PRODUCT',
    ratePercent: 35,
    overrideId: null,
  };
  const SERVICE25: AgentLineCommissionRate = {
    commissionClass: 'SERVICE',
    rateSource: 'AGREEMENT_SERVICE',
    ratePercent: 25,
    overrideId: null,
  };
  const PREDETERMINED: Partial<AgentTermsSnapshot> = {
    productCommissionRatePercent: 35,
    serviceCommissionRatePercent: 25,
    shippingPolicy: 'PREDETERMINED_CHARGE',
    customerShippingChargeOwner: 'COMPANY',
    shippingFeePerShipment: 0,
    returnFeePerShipment: 0,
    serviceFeePerOrder: 0,
  };

  const agreementTerms = (
    over: Partial<CreateAgreementDto> = {},
  ): CreateAgreementDto => ({
    effectiveFrom: iso(day(-30)),
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

  async function makeAgent() {
    const n = next();
    const partner = await prisma.partner.create({
      data: {
        partnerNumber: `PT-AGC-${n}`,
        name: `Commission agent ${n}`,
        roles: { create: { role: PartnerRoleType.AGENT } },
      },
    });
    return prisma.agent.create({
      data: {
        agentNumber: `AG-C-${n}`,
        partnerId: partner.id,
        name: `Commission agent ${n}`,
        currencyId,
      },
    });
  }

  async function makeProduct(
    stocked: boolean,
    ownerAgentId: string,
    itemType: ItemType | null,
  ) {
    const sku = `CMP-${next()}`;
    const product = await prisma.product.create({
      data: {
        sku,
        name: sku,
        internalName: sku,
        displayName: sku,
        categoryId,
        unitId,
        type: itemType === 'SERVICE' ? 'SERVICE' : 'SALES_ONLY',
        status: 'ACTIVE',
        isPurchasable: false,
        isSellable: true,
        isInventoryItem: stocked,
        itemType,
        salesPrice: 100,
        preferredWarehouseId: warehouseId,
        ownerAgentId,
      },
    });
    if (stocked) {
      await inventory.openingBalance(
        { productId: product.id, warehouseId, quantity: 100 },
        userId,
      );
    }
    return product.id;
  }

  function terms(
    overrides: Partial<AgentTermsSnapshot> = {},
  ): AgentTermsSnapshot {
    return {
      agreementId: randomUUID(),
      agreementNumber: `AGR-C-${tag}`,
      currencyId,
      productCommissionRatePercent: 10,
      serviceCommissionRatePercent: 10,
      shippingPolicy: 'FLAT_FEE_PER_SHIPMENT',
      commissionEarningEvent: 'DELIVERED',
      returnCommissionTreatment: 'REVERSE',
      customerShippingChargeOwner: 'COMPANY',
      providerFeesBorneBy: 'AGENT',
      shippingFeePerShipment: 0,
      returnFeePerShipment: 0,
      serviceFeePerOrder: 0,
      allowAgentDestinations: true,
      payoutHoldDays: 0,
      ...overrides,
    };
  }

  /** An order as the agent order service persists it (snapshot incl. per-line rates). */
  async function makeOrder(input: {
    agentId: string;
    terms?: Partial<AgentTermsSnapshot>;
    lines: Array<{
      productId: string;
      quantity: number;
      amount: number;
      inventoryLine: boolean;
      commission?: AgentLineCommissionRate;
    }>;
    shipping?: number;
    agentShippingCharge?: AgentShippingChargeSnapshot | null;
    legacyRate?: number;
  }) {
    const merchandise = input.lines.reduce((s, l) => s + l.amount, 0);
    const shipping = input.shipping ?? 0;
    const snapshotTerms: Record<string, unknown> = { ...terms(input.terms) };
    if (input.legacyRate != null) {
      delete snapshotTerms.productCommissionRatePercent;
      delete snapshotTerms.serviceCommissionRatePercent;
      delete snapshotTerms.shippingPolicy;
      snapshotTerms.commissionRatePercent = input.legacyRate;
    }
    const digitalOnly = input.lines.every((l) => !l.inventoryLine);
    return prisma.storeOrder.create({
      data: {
        internalOrderId: `SO-CMP-${next()}`,
        partnerId: customerId,
        currencyId,
        paymentType: StoreOrderPaymentType.CASH_ON_DELIVERY,
        fulfillmentMethod: digitalOnly
          ? StoreOrderFulfillmentMethod.PICKUP
          : StoreOrderFulfillmentMethod.SHIPPING,
        agentId: input.agentId,
        agentTermsSnapshot: {
          ...snapshotTerms,
          agentShippingCharge: input.agentShippingCharge ?? null,
          lines: input.lines.map((l) => ({
            productId: l.productId,
            inventoryLine: l.inventoryLine,
            ...(l.commission ? { commission: l.commission } : {}),
          })),
        } as unknown as Prisma.InputJsonValue,
        pricingMode: 'SHIPPING_ADDED',
        merchandiseAmount: merchandise,
        discountAmount: 0,
        taxAmount: 0,
        shippingCharge: shipping,
        shippingChargeSource: shipping > 0 ? 'RATE' : 'NONE',
        serviceCharge: 0,
        payableTotal: merchandise + shipping,
        items: {
          create: input.lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: Math.round((l.amount / l.quantity) * 100) / 100,
            agreedAmount: l.amount,
          })),
        },
      },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
  }

  async function pay(
    order: { id: string; agentId: string | null },
    amount: number,
  ) {
    const payment = await prisma.payment.create({
      data: {
        paymentNumber: `PAY-CMP-${next()}`,
        storeOrderId: order.id,
        paymentDate: day(-1),
        amount,
        currencyId,
        paymentSourceId,
        paymentMethodId: bankMethodId,
        origin: PaymentOrigin.SALES_DECLARATION,
        senderName: 'Agent customer',
        status: PaymentStatus.PENDING,
        agentId: order.agentId,
        destinationOwnership: 'COMPANY',
      },
    });
    await payments.confirm(payment.id, userId);
    return payment;
  }

  async function shipAndDeliver(orderId: string) {
    await shipments.markShipped(orderId, userId);
    await shipments.markDelivered(orderId, userId);
    return prisma.shipment.findFirstOrThrow({
      where: { storeOrderId: orderId, deletedAt: null },
      orderBy: { attemptNumber: 'desc' },
    });
  }

  async function carrierCharge(
    shipmentId: string,
    amount: number,
    kind: CarrierChargeKind = 'BASE',
  ) {
    const charge = await prisma.carrierCharge.create({
      data: {
        carrierNameRaw: `Carrier ${tag}`,
        carrierReference: `CR-${next()}`,
        chargeAmount: amount,
        currencyId,
        chargeDate: day(0),
        chargeKind: kind,
        dedupeKey: `cmp-${next()}`,
        shipmentId,
        reconciliationState: 'MATCHED',
        matchedAt: new Date(),
      },
    });
    return charge.id;
  }

  const entries = (where: Prisma.AgentLedgerEntryWhereInput) =>
    prisma.agentLedgerEntry.findMany({
      where,
      orderBy: [{ entryDate: 'asc' }, { entryNumber: 'asc' }],
    });

  async function position(agentId: string) {
    const { balances } = await statements.balances(agentId);
    return balances.find((b) => b.currencyId === currencyId)!;
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        PostingProvidersModule,
        FxModule,
        PaymentReconciliationModule,
        PaymentSettlementsModule,
        AgentFinanceModule,
        AgentsAdminModule,
        AgentOrdersModule,
        AgentShippingAgreementsModule,
        CarrierReconciliationModule,
      ],
    })
      .overrideProvider(GoogleSheetsService)
      .useValue({ resolveSheetTitle: jest.fn(), getSheetData: jest.fn() })
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    const get = <T>(t: new (...args: never[]) => T) =>
      moduleRef.get(t, { strict: false });
    payments = get(PaymentsService);
    shipments = get(StoreOrderShipmentOperationsService);
    inventory = get(InventoryService);
    carrier = get(CarrierReconciliationService);
    agreements = get(AgentAgreementsService);
    shippingAgreements = get(AgentShippingAgreementsService);
    orders = get(AgentOrdersService);
    fulfillment = get(AgentFulfillmentService);
    payouts = get(AgentPayoutsService);
    statements = get(AgentStatementService);
    adjustments = get(AgentAdjustmentsService);
    report = get(AgentCommissionReportService);
    rates = get(AgentCommissionRatesService);

    userId = (
      await prisma.user.create({
        data: {
          email: `cmp-${tag.toLowerCase()}@test.local`,
          username: `cmp-${tag.toLowerCase()}`,
          fullName: `Commission Test ${tag}`,
          passwordHash: 'x',
          isSuperAdmin: true,
        },
      })
    ).id;
    currencyId = await moduleRef
      .get(ExchangeRatesService)
      .requireFunctionalCurrencyId();

    const settings = await prisma.postingSettings.findFirstOrThrow();
    for (const key of [
      'agentFundsPayableAccountId',
      'agentCommissionRevenueAccountId',
      'agentServiceRevenueAccountId',
    ] as const) {
      originalSettings[key] = settings[key];
    }
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
        agentFundsPayableAccountId: (
          await account('CMP-PAY', AccountType.LIABILITY)
        ).id,
        agentCommissionRevenueAccountId: (
          await account('CMP-COM', AccountType.REVENUE)
        ).id,
        agentServiceRevenueAccountId: (
          await account('CMP-SRV', AccountType.REVENUE)
        ).id,
      },
    });

    customerId = (
      await prisma.partner.create({
        data: {
          partnerNumber: `PT-CMPC-${tag}`,
          name: `Commission customer ${tag}`,
          roles: { create: { role: PartnerRoleType.CUSTOMER } },
        },
      })
    ).id;
    countryId = (
      await prisma.country.findFirstOrThrow({ where: { deletedAt: null } })
    ).id;
    paymentSourceId = (
      await prisma.paymentSource.findFirstOrThrow({
        where: { deletedAt: null, isActive: true },
      })
    ).id;
    const bankGl = await account('CMP-BANK', AccountType.ASSET);
    bankReceivingId = (
      await prisma.receivingAccount.create({
        data: {
          name: `Commission bank ${tag}`,
          code: `CMP-RA-${tag}`,
          chartOfAccountId: bankGl.id,
        },
      })
    ).id;
    bankMethodId = (
      await prisma.paymentMethod.create({
        data: {
          name: `Commission transfer ${tag}`,
          accountId: bankGl.id,
          requiresReconciliation: false,
        },
      })
    ).id;
    warehouseId = (
      await prisma.warehouse.create({
        data: { code: `CMP-WH-${tag}`, name: `Commission WH ${tag}` },
      })
    ).id;
    categoryId = (
      await prisma.productCategory.findFirstOrThrow({
        where: { deletedAt: null },
      })
    ).id;
    unitId = (await prisma.unit.findFirstOrThrow({})).id;
  });

  afterAll(async () => {
    if (prisma) {
      const settings = await prisma.postingSettings.findFirst();
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
    }
    await moduleRef?.close();
  });

  // ---------------------------------------------------------------------------

  it('A1 — commission by item type: 100,000 products @35% + 100,000 services @25% = 60,000', async () => {
    const agent = await makeAgent();
    const product = await makeProduct(true, agent.id, 'PRODUCT');
    const service = await makeProduct(false, agent.id, 'SERVICE');
    const productOrder = await makeOrder({
      agentId: agent.id,
      terms: PREDETERMINED,
      agentShippingCharge: { amount: 0, source: 'RATE', rateId: null },
      lines: [
        {
          productId: product,
          quantity: 1,
          amount: 100_000,
          inventoryLine: true,
          commission: PRODUCT35,
        },
      ],
    });
    const serviceOrder = await makeOrder({
      agentId: agent.id,
      terms: PREDETERMINED,
      agentShippingCharge: { amount: 0, source: 'DIGITAL_ONLY', rateId: null },
      lines: [
        {
          productId: service,
          quantity: 1,
          amount: 100_000,
          inventoryLine: false,
          commission: SERVICE25,
        },
      ],
    });
    await pay(productOrder, 100_000);
    await pay(serviceOrder, 100_000); // digital-only: earns on full verification
    await shipAndDeliver(productOrder.id);

    const commissions = await entries({
      agentId: agent.id,
      entryType: 'COMMISSION',
    });
    expect(commissions.map((e) => Number(e.debit)).sort()).toEqual([
      25_000, 35_000,
    ]);
    expect((await position(agent.id)).balance).toBe(140_000);
    const summary = await statements.summary(agent.id, {});
    expect(summary.commission.byClass.PRODUCT.commission).toBe(35_000);
    expect(summary.commission.byClass.SERVICE.commission).toBe(25_000);
    const r = await report.report(agent.id, {});
    expect(r.summary.products).toMatchObject({
      sales: 100_000,
      commission: 35_000,
    });
    expect(r.summary.services).toMatchObject({
      sales: 100_000,
      commission: 25_000,
    });
    expect(r.summary.totalCommission).toBe(60_000);
    expect(r.summary.netEntitlement).toBe(140_000);
  });

  let shipAgent: { id: string };
  let shipShipmentId: string;

  it('A1 — shipping: 1,000 + 100 customer shipping, 35% ⇒ company 350 + 100, agent 650 (no second 100)', async () => {
    shipAgent = await makeAgent();
    const product = await makeProduct(true, shipAgent.id, 'PRODUCT');
    const order = await makeOrder({
      agentId: shipAgent.id,
      terms: PREDETERMINED,
      shipping: 100,
      agentShippingCharge: { amount: 100, source: 'RATE', rateId: null },
      lines: [
        {
          productId: product,
          quantity: 1,
          amount: 1_000,
          inventoryLine: true,
          commission: PRODUCT35,
        },
      ],
    });
    await pay(order, 1_100);
    const shipment = await shipAndDeliver(order.id);
    shipShipmentId = shipment.id;

    const charges = await entries({
      storeOrderId: order.id,
      entryType: {
        in: [
          'COMMISSION',
          'CUSTOMER_SHIPPING_RETAINED',
          'SHIPPING_FEE',
          'SERVICE_FEE',
        ],
      },
    });
    expect(charges.map((e) => [e.entryType, Number(e.debit)])).toEqual([
      ['COMMISSION', 350],
      ['CUSTOMER_SHIPPING_RETAINED', 100],
    ]);
    expect(charges[1].basis).toMatchObject({
      agentShippingCharge: 100,
      appliedToAgentShippingCharge: 100,
      difference: 0,
    });
    expect((await position(shipAgent.id)).balance).toBe(650);

    const r = await report.report(shipAgent.id, {});
    expect(r.summary).toMatchObject({
      totalSales: 1_000,
      customerCharges: 100,
      totalCommission: 350,
      shippingRetained: 100,
      agentShippingCharges: 100,
      netEntitlement: 650,
    });
    expect(r.orders[0].shipping).toMatchObject({
      customerShipping: 100,
      agentShippingCharge: 100,
      retained: 100,
      difference: 0,
    });
  });

  it.each([
    [80, -20, 80],
    [120, 20, 100],
  ])(
    'O1 — fee 100, customer shipping %d ⇒ entitlement 650, one retained entry, difference %d borne / kept by the company',
    async (customerShipping, difference, applied) => {
      const agent = await makeAgent();
      const product = await makeProduct(true, agent.id, 'PRODUCT');
      const order = await makeOrder({
        agentId: agent.id,
        terms: PREDETERMINED,
        shipping: customerShipping,
        agentShippingCharge: { amount: 100, source: 'RATE', rateId: null },
        lines: [
          {
            productId: product,
            quantity: 1,
            amount: 1_000,
            inventoryLine: true,
            commission: PRODUCT35,
          },
        ],
      });
      await pay(order, 1_000 + customerShipping);
      await shipAndDeliver(order.id);

      const charges = await entries({
        storeOrderId: order.id,
        entryType: { notIn: ['COLLECTION_RECEIVED', 'COLLECTION_BY_AGENT'] },
      });
      // No extra agent debit for a shortfall, no agent credit for an excess.
      expect(
        charges.map((e) => [e.entryType, Number(e.debit), Number(e.credit)]),
      ).toEqual([
        ['COMMISSION', 350, 0],
        ['CUSTOMER_SHIPPING_RETAINED', customerShipping, 0],
      ]);
      expect(charges[1].basis).toMatchObject({
        shippingCharge: customerShipping,
        agentShippingCharge: 100,
        appliedToAgentShippingCharge: applied,
        difference,
        differenceBorneBy: 'COMPANY',
      });
      expect((await position(agent.id)).balance).toBe(650);

      const internal = await report.report(agent.id, {});
      expect(internal.summary.netEntitlement).toBe(650);
      expect(internal.orders[0].shipping).toMatchObject({
        customerShipping,
        agentShippingCharge: 100,
        difference,
        differenceBorneBy: 'COMPANY',
      });
      // The agent sees C and F only — never the difference attribution.
      const portal = await report.report(agent.id, {}, 'PORTAL');
      expect(portal.orders[0].shipping).toMatchObject({
        customerShipping,
        agentShippingCharge: 100,
      });
      expect(portal.orders[0].shipping).not.toHaveProperty('difference');
      expect(portal.orders[0].shipping).not.toHaveProperty('differenceBorneBy');
    },
  );

  it('O1 — customer shipping 0 with a fee of 100: no zero-amount entry, the company shortfall is on the commission basis', async () => {
    const agent = await makeAgent();
    const product = await makeProduct(true, agent.id, 'PRODUCT');
    const order = await makeOrder({
      agentId: agent.id,
      terms: PREDETERMINED,
      shipping: 0,
      agentShippingCharge: { amount: 100, source: 'RATE', rateId: null },
      lines: [
        {
          productId: product,
          quantity: 1,
          amount: 1_000,
          inventoryLine: true,
          commission: PRODUCT35,
        },
      ],
    });
    await pay(order, 1_000);
    await shipAndDeliver(order.id);
    const charges = await entries({
      storeOrderId: order.id,
      entryType: { notIn: ['COLLECTION_RECEIVED', 'COLLECTION_BY_AGENT'] },
    });
    expect(charges.map((e) => [e.entryType, Number(e.debit)])).toEqual([
      ['COMMISSION', 350],
    ]);
    expect(charges[0].basis).toMatchObject({
      shippingSettlement: {
        shippingCharge: 0,
        agentShippingCharge: 100,
        appliedToAgentShippingCharge: 0,
        difference: -100,
        differenceBorneBy: 'COMPANY',
      },
    });
    expect((await position(agent.id)).balance).toBe(650);
  });

  it('A6 — actual carrier costs (base, late surcharge, credit, re-import, unmatch) never touch the agent ledger', async () => {
    const before = await entries({ agentId: shipAgent.id });
    const base = await carrierCharge(shipShipmentId, 60, 'BASE');
    await carrier.confirm(base, userId);
    const late = await carrierCharge(shipShipmentId, 20, 'SURCHARGE');
    await carrier.confirm(late, userId);
    const credit = await carrierCharge(shipShipmentId, 10, 'CREDIT');
    await carrier.confirm(credit, userId);
    await carrier.unmatch(late, userId);
    const code = (
      await prisma.currency.findUniqueOrThrow({ where: { id: currencyId } })
    ).code;
    const csv = `Carrier,Carrier Reference,Tracking Number,Shipment Reference,Charge Amount,Currency,Charge Date,Charge Kind\nDup ${tag},DUP-${tag},,,40,${code},2026-01-01,SURCHARGE`;
    await carrier.importCsv(csv, 'a.csv', userId);
    expect((await carrier.importCsv(csv, 'a.csv', userId)).duplicateRows).toBe(
      1,
    );

    const after = await entries({ agentId: shipAgent.id });
    expect(after.map((e) => e.id)).toEqual(before.map((e) => e.id));
    expect((await position(shipAgent.id)).balance).toBe(650);
    const r = await report.report(shipAgent.id, {});
    // Company expense, reported apart (base 60 − credit 10).
    expect(r.orders[0].shipping.carrier?.approvedByCurrency).toEqual([
      { currencyCode: code, amount: 50 },
    ]);
    expect(r.summary.netEntitlement).toBe(650);
  });

  it('A2/A3/A6 — order submission: item type, predetermined charge, added/included, pickup, difference allowed (O1) but not below the fee for agent users', async () => {
    const agent = await makeAgent();
    const stocked = await makeProduct(true, agent.id, 'PRODUCT');
    const nonStock = await makeProduct(false, agent.id, 'PRODUCT');
    const course = await makeProduct(false, agent.id, 'SERVICE');
    const unclassified = await makeProduct(false, agent.id, null);
    const agreement = await agreements.create(
      agent.id,
      agreementTerms(),
      userId,
    );
    await activateShippingAgreement(
      shippingAgreements,
      agent.id,
      everyService(100, { countryId }),
      userId,
    );
    await agreements.activate(agent.id, agreement.id, userId);
    const actor = { userId };
    const input = (
      over: Partial<CreateAgentOrderDto> = {},
    ): CreateAgentOrderDto => ({
      agentId: agent.id,
      pricingMode: 'SHIPPING_ADDED',
      lines: [{ productId: stocked, quantity: 1, lineAmount: 1_000 }],
      fulfillmentMethod: 'SHIPPING',
      paymentType: 'PREPAID',
      countryId,
      customer: { name: `Customer ${tag}`, countryId },
      ...over,
    });

    const added = await orders.quote(input(), actor);
    expect(added.valid).toBe(true);
    expect(added.breakdown).toMatchObject({
      merchandiseAmount: 1_000,
      shippingCharge: 100,
      payableTotal: 1_100,
    });
    expect(added.agentShippingCharge).toMatchObject({
      amount: 100,
      source: 'RATE',
    });

    const included = await orders.quote(
      input({
        pricingMode: 'SHIPPING_INCLUDED',
        agreedTotal: 1_100,
        lines: [{ productId: stocked, quantity: 1 }],
      }),
      actor,
    );
    expect(included.valid).toBe(true);
    expect(included.breakdown).toMatchObject({
      merchandiseAmount: 1_000,
      shippingCharge: 100,
      payableTotal: 1_100,
    });

    // A non-stocked product earns the PRODUCT rate; a course the SERVICE rate.
    const mixed = await orders.quote(
      input({
        lines: [
          { productId: nonStock, quantity: 1, lineAmount: 200 },
          { productId: course, quantity: 1, lineAmount: 300 },
          { productId: stocked, quantity: 1, lineAmount: 500 },
        ],
      }),
      actor,
    );
    expect(mixed.valid).toBe(true);
    const resolved = await rates.resolveLineRates(
      await prisma.agentAgreement.findUniqueOrThrow({
        where: { id: agreement.id },
      }),
      [
        { productId: nonStock, itemType: 'PRODUCT' },
        { productId: course, itemType: 'SERVICE' },
      ],
      day(0),
    );
    expect(resolved.map((r) => [r.commissionClass, r.ratePercent])).toEqual([
      ['PRODUCT', 35],
      ['SERVICE', 25],
    ]);

    const pickup = await orders.quote(
      input({ fulfillmentMethod: 'PICKUP' }),
      actor,
    );
    expect(pickup.valid).toBe(true);
    expect(pickup.agentShippingCharge).toMatchObject({
      amount: 0,
      source: 'PICKUP',
    });

    const digital = await orders.quote(
      input({ lines: [{ productId: course, quantity: 1, lineAmount: 300 }] }),
      actor,
    );
    expect(digital.valid).toBe(true);
    expect(digital.agentShippingCharge).toMatchObject({
      amount: 0,
      source: 'DIGITAL_ONLY',
    });

    const refused = await orders.quote(
      input({
        lines: [{ productId: unclassified, quantity: 1, lineAmount: 100 }],
      }),
      actor,
    );
    expect(refused.valid).toBe(false);
    expect(refused.issues.map((i) => i.code)).toContain(
      'AGENT_ITEM_TYPE_REQUIRED',
    );

    // O1 (owner decision 2026-10-01) — a customer shipping that differs from
    // the agent shipping fee is allowed (was refused while D-R5-1 was open).
    const difference = await orders.quote(
      input({
        shippingChargeOverride: 80,
        shippingOverrideReason: 'Customer discount on shipping',
      }),
      actor,
    );
    expect(difference.valid).toBe(true);
    expect(difference.agentShippingCharge).toMatchObject({ amount: 100 });

    // Integrator decision (O1 guard): an agent USER may not set the customer
    // shipping below its fee (C ≥ F is fine); internal staff may.
    const agentUser = await prisma.user.create({
      data: {
        email: `o1-agent-${tag}@test.local`.toLowerCase(),
        username: `o1-agent-${tag}`.toLowerCase(),
        fullName: `O1 agent ${tag}`,
        passwordHash: 'x',
        userType: 'AGENT',
        agentRole: 'ADMIN',
        agentId: agent.id,
      },
    });
    const permission = await prisma.permission.upsert({
      where: { name: 'agent.orders.override_shipping' },
      create: { name: 'agent.orders.override_shipping' },
      update: {},
    });
    await prisma.userPermission.create({
      data: { userId: agentUser.id, permissionId: permission.id },
    });
    const agentActor = {
      userId: agentUser.id,
      agent: {
        userId: agentUser.id,
        agentId: agent.id,
        agentRole: 'ADMIN' as const,
      },
    };
    const below = await orders.quote(
      input({
        shippingChargeOverride: 80,
        shippingOverrideReason: 'Customer discount',
      }),
      agentActor,
    );
    expect(below.valid).toBe(false);
    expect(below.issues.map((i) => i.code)).toEqual([
      'AGENT_SHIPPING_BELOW_FEE',
    ]);
    const belowIssue = below.issues.find(
      (i) => i.code === 'AGENT_SHIPPING_BELOW_FEE',
    );
    expect(belowIssue?.message).toContain('100.00');
    const above = await orders.quote(
      input({
        shippingChargeOverride: 120,
        shippingOverrideReason: 'Express packaging',
      }),
      agentActor,
    );
    expect(above.valid).toBe(true);
    const internalBelow = await orders.createAgentOrder(
      input({
        shippingChargeOverride: 80,
        shippingOverrideReason: 'Goodwill',
      }),
      actor,
    );
    const audit = await prisma.storeOrderActivity.findFirst({
      where: {
        storeOrderId: internalBelow.id,
        action: 'AGENT_SHIPPING_OVERRIDE',
      },
    });
    expect(audit?.details).toContain(
      'below the agent shipping fee 100.00; the company bears 20.00',
    );

    // Preview before activation — the owner's shipping example.
    const draft = await agreements.create(
      agent.id,
      agreementTerms({ effectiveFrom: iso(day(400)) }),
      userId,
    );
    const preview = await rates.agreementPreview(agent.id, draft.id, {});
    expect(preview.example).toMatchObject({
      productCommission: 350,
      customerShipping: 100,
      shippingAppliedToCharge: 100,
      companyRetains: 450,
      agentEntitlement: 650,
    });
    expect(preview.items.find((i) => i.id === unclassified)?.missing).toBe(
      'AGENT_ITEM_TYPE_REQUIRED',
    );
  });

  it('A3 — shipping policy validation: predetermined needs company-owned shipping and no flat fee', async () => {
    const agent = await makeAgent();
    await expect(
      agreements.create(
        agent.id,
        agreementTerms({ customerShippingChargeOwner: 'AGENT' }),
        userId,
      ),
    ).rejects.toMatchObject({
      response: { code: 'AGENT_SHIPPING_POLICY_CONFLICT' },
    });
    await expect(
      agreements.create(
        agent.id,
        agreementTerms({ shippingPolicy: 'NONE', shippingFeePerShipment: 15 }),
        userId,
      ),
    ).rejects.toMatchObject({
      response: { code: 'AGENT_SHIPPING_POLICY_CONFLICT' },
    });
  });

  it('A4 — item override incl. 0%, effective-dated, agent-scoped; per-line return; refund leaves commission', async () => {
    const agentY = await makeAgent();
    const productP = await makeProduct(true, agentY.id, 'PRODUCT');
    const serviceS = await makeProduct(false, agentY.id, 'SERVICE');
    const draft = await agreements.create(
      agentY.id,
      agreementTerms({
        productCommissionRatePercent: 20,
        serviceCommissionRatePercent: 10,
        shippingPolicy: 'NONE',
      }),
      userId,
    );
    await agreements.activate(agentY.id, draft.id, userId);
    const agreement = await prisma.agentAgreement.findUniqueOrThrow({
      where: { id: draft.id },
    });
    const set = (
      productId: string,
      settingInput: Parameters<
        AgentCommissionRatesService['setProductSetting']
      >[1],
    ) => rates.setProductSetting(productId, settingInput, userId);
    await set(productP, {
      source: 'OVERRIDE',
      ratePercent: 5,
      effectiveFrom: iso(day(0)),
    });
    await set(serviceS, {
      source: 'OVERRIDE',
      ratePercent: 0,
      effectiveFrom: iso(day(0)),
    });
    await set(productP, {
      source: 'OVERRIDE',
      ratePercent: 7,
      effectiveFrom: iso(day(3)),
    });
    await expect(
      set(productP, {
        source: 'OVERRIDE',
        ratePercent: 9,
        effectiveFrom: iso(day(-1)),
      }),
    ).rejects.toMatchObject({
      response: { code: 'COMMISSION_EFFECTIVE_FROM_PAST' },
    });
    await expect(
      set(productP, {
        source: 'OVERRIDE',
        ratePercent: 9,
        effectiveFrom: iso(day(2)),
      }),
    ).rejects.toMatchObject({
      response: { code: 'COMMISSION_OVERRIDE_HISTORY_LOCKED' },
    });
    await set(productP, { source: 'INHERIT', effectiveFrom: iso(day(6)) });

    const lines = [
      { productId: productP, itemType: 'PRODUCT' as const },
      { productId: serviceS, itemType: 'SERVICE' as const },
    ];
    const at = (offset: number) =>
      rates.resolveLineRates(agreement, lines, day(offset));
    expect((await at(-1)).map((r) => [r.rateSource, r.ratePercent])).toEqual([
      ['AGREEMENT_PRODUCT', 20],
      ['AGREEMENT_SERVICE', 10],
    ]);
    expect((await at(1)).map((r) => r.ratePercent)).toEqual([5, 0]);
    expect((await at(4)).map((r) => r.ratePercent)).toEqual([7, 0]);
    expect((await at(7)).map((r) => [r.rateSource, r.ratePercent])).toEqual([
      ['AGREEMENT_PRODUCT', 20],
      ['ITEM_OVERRIDE', 0],
    ]);
    const other = await makeAgent();
    const foreign = await rates.resolveLineRates(
      { ...agreement, agentId: other.id },
      lines,
      day(1),
    );
    expect(foreign.map((r) => r.rateSource)).toEqual([
      'AGREEMENT_PRODUCT',
      'AGREEMENT_SERVICE',
    ]);

    const today = await at(1);
    const order = await makeOrder({
      agentId: agentY.id,
      terms: {
        productCommissionRatePercent: 20,
        serviceCommissionRatePercent: 10,
        shippingPolicy: 'NONE',
      },
      lines: [
        {
          productId: productP,
          quantity: 2,
          amount: 1_000,
          inventoryLine: true,
          commission: today[0],
        },
        {
          productId: serviceS,
          quantity: 1,
          amount: 600,
          inventoryLine: false,
          commission: today[1],
        },
      ],
    });
    await pay(order, 1_600);
    await shipAndDeliver(order.id);
    const [commission] = await entries({
      storeOrderId: order.id,
      entryType: 'COMMISSION',
    });
    expect(Number(commission.debit)).toBe(50);
    const detail = await prisma.agentCommissionLine.findMany({
      where: { ledgerEntryId: commission.id },
      orderBy: { commissionClass: 'asc' },
    });
    expect(
      detail.map((d) => [
        d.commissionClass,
        d.rateSource,
        Number(d.ratePercent),
        Number(d.amount),
      ]),
    ).toEqual([
      ['PRODUCT', 'ITEM_OVERRIDE', 5, 50],
      ['SERVICE', 'ITEM_OVERRIDE', 0, 0],
    ]);

    const physicalItem = order.items.find((i) => i.productId === productP)!;
    await fulfillment.receiveReturn(
      order.id,
      {
        lines: [{ storeOrderItemId: physicalItem.id, quantity: 1 }],
        warehouseId,
        idempotencyKey: `cmp-ret-${tag}`,
      },
      userId,
    );
    const [reversal] = await entries({
      storeOrderId: order.id,
      entryType: 'COMMISSION_REVERSAL',
    });
    expect(Number(reversal.credit)).toBe(25);
    await adjustments.refund(
      order.id,
      {
        amount: 100,
        paidBy: 'COMPANY',
        payingAccountId: bankReceivingId,
        reason: 'Partial refund',
        idempotencyKey: `cmp-rf-${tag}`,
      },
      userId,
    );
    expect(
      await entries({
        storeOrderId: order.id,
        entryType: 'COMMISSION_REVERSAL',
      }),
    ).toHaveLength(1);
    const r = await report.report(agentY.id, {});
    expect(r.lines.find((l) => l.productId === productP)).toMatchObject({
      commission: 50,
      commissionReversed: 25,
      rateSource: 'ITEM_OVERRIDE',
    });
    expect(r.cash.customerRefundsByCompany).toBe(100);
  });

  it('legacy snapshot — single rate on every line, class from the explicit item type', async () => {
    const agentL = await makeAgent();
    const p = await makeProduct(true, agentL.id, 'PRODUCT');
    const s = await makeProduct(false, agentL.id, null);
    const order = await makeOrder({
      agentId: agentL.id,
      legacyRate: 10,
      lines: [
        { productId: p, quantity: 1, amount: 500, inventoryLine: true },
        { productId: s, quantity: 1, amount: 300, inventoryLine: false },
      ],
    });
    await pay(order, 800);
    await shipAndDeliver(order.id);
    const [commission] = await entries({
      storeOrderId: order.id,
      entryType: 'COMMISSION',
    });
    expect(Number(commission.debit)).toBe(80);
    const detail = await prisma.agentCommissionLine.findMany({
      where: { ledgerEntryId: commission.id },
      orderBy: { salesAmount: 'desc' },
    });
    expect(detail.map((d) => [d.rateSource, d.commissionClass])).toEqual([
      ['LEGACY_SINGLE_RATE', 'PRODUCT'],
      ['LEGACY_SINGLE_RATE', null],
    ]);
    const summary = await statements.summary(agentL.id, {});
    expect(summary.commission.legacySingleRate).toBe(30);
    expect(summary.commission.byClass.PRODUCT.commission).toBe(50);
  });

  it('partial collection and prior payout: entitlement is not available cash', async () => {
    const agentP = await makeAgent();
    const s = await makeProduct(false, agentP.id, 'SERVICE');
    const order = await makeOrder({
      agentId: agentP.id,
      terms: PREDETERMINED,
      agentShippingCharge: { amount: 0, source: 'DIGITAL_ONLY', rateId: null },
      lines: [
        {
          productId: s,
          quantity: 1,
          amount: 1_000,
          inventoryLine: false,
          commission: SERVICE25,
        },
      ],
    });
    await pay(order, 400); // partial: not fully verified ⇒ not earned
    let r = await report.report(agentP.id, {});
    expect(r.lines).toHaveLength(0);
    expect((await position(agentP.id)).available).toBe(0);
    await pay(order, 600);
    r = await report.report(agentP.id, {});
    expect(r.summary.services.commission).toBe(250);
    expect(r.summary.netEntitlement).toBe(750);
    expect(r.cash.availableForPayout).toBe(750);
    await payouts.create(
      agentP.id,
      {
        payingAccountId: bankReceivingId,
        payoutDate: new Date().toISOString(),
        reference: `TRF-CMP-${tag}`,
        amount: 500,
        idempotencyKey: `cmp-po-${tag}`,
      },
      userId,
    );
    r = await report.report(agentP.id, {});
    expect(r.summary.netEntitlement).toBe(750);
    expect(r.cash).toMatchObject({ availableForPayout: 250, paidOut: 500 });
  });
});
