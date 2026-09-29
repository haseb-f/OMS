import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import {
  AccountType,
  AgentLedgerPostingStatus,
  PartnerRoleType,
  PaymentOrigin,
  PaymentStatus,
  StoreOrderFulfillmentMethod,
  StoreOrderPaymentType,
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
import { PaymentSettlementsService } from '../../payment-settlements/payment-settlements.service';
import { PaymentStatementsService } from '../../payment-reconciliation/payment-statements.service';
import { PaymentMatchingService } from '../../payment-reconciliation/payment-matching.service';
import { ClaimPostingAdapter } from '../../payment-reconciliation/claim-posting.adapter';
import { PaymentsService } from '../../payments/payments.service';
import { StoreOrderShipmentOperationsService } from '../../store-orders/shipments/store-order-shipment-operations.service';
import { StoreOrdersService } from '../../store-orders/store-orders.service';
import { InventoryService } from '../../inventory/inventory.service';
import type { AgentTermsSnapshot } from '../common/agent-terms';
import { AgentFinanceModule } from './agent-finance.module';
import { AgentLedgerService } from './agent-ledger.service';
import { AgentFulfillmentService } from './agent-fulfillment.service';
import { AgentCollectionsService } from './agent-collections.service';
import { AgentPayoutsService } from './agent-payouts.service';
import { AgentStatementService } from './agent-statement.service';
import { AgentAdjustmentsService } from './agent-adjustments.service';
import { ShippingUpdatesImportHandler } from '../../import-center/handlers/shipping-updates-import.handler';
import { StoreOrderShipmentsService } from '../../store-orders/shipments/store-order-shipments.service';
import { StoreOrderActivityService } from '../../store-orders/activities/store-order-activity.service';
import { PaymentAutoMatchingService } from '../../payments/auto-matching/payment-auto-matching.service';
import { PostingSettingsService } from '../../accounting/posting-settings/posting-settings.service';

/**
 * Agent finance lifecycle against the real local Postgres (spec §7–§10).
 * Tagged, self-created fixtures; the agreement currency is the functional
 * currency so journal amounts equal ledger amounts. The three agent posting
 * accounts are set for the run and restored afterwards.
 */
const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(
  process.env.DATABASE_URL ?? '',
);
const describeDb = LOCAL_DB ? describe : describe.skip;

describeDb('Agent finance (local DB)', () => {
  jest.setTimeout(300_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let payments: PaymentsService;
  let shipments: StoreOrderShipmentOperationsService;
  let storeOrders: StoreOrdersService;
  let inventory: InventoryService;
  let ledger: AgentLedgerService;
  let fulfillment: AgentFulfillmentService;
  let collections: AgentCollectionsService;
  let payouts: AgentPayoutsService;
  let statements: AgentStatementService;
  let adjustments: AgentAdjustmentsService;
  let settlements: PaymentSettlementsService;
  let statementLines: PaymentStatementsService;
  let matching: PaymentMatchingService;
  let adapter: ClaimPostingAdapter;

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

  let userId: string;
  let currencyId: string;
  let customerId: string;
  let paymentSourceId: string;
  let bankReceivingId: string;
  let bankMethodId: string;
  let courierMethodId: string;
  let warehouseId: string;
  let productA: string;
  let productB: string;
  let serviceProduct: string;
  let fundsPayableId: string;
  const originalSettings: Record<string, string | null> = {};

  async function makeAgent() {
    const n = next();
    const partner = await prisma.partner.create({
      data: {
        partnerNumber: `PT-AGT-${n}`,
        name: `Agent partner ${n}`,
        roles: { create: { role: PartnerRoleType.AGENT } },
      },
    });
    return prisma.agent.create({
      data: {
        agentNumber: `AG-T-${n}`,
        partnerId: partner.id,
        name: `Agent ${n}`,
        currencyId,
      },
    });
  }

  function terms(
    overrides: Partial<AgentTermsSnapshot> = {},
  ): AgentTermsSnapshot {
    return {
      agreementId: randomUUID(),
      agreementNumber: `AGR-T-${tag}`,
      currencyId,
      productCommissionRatePercent: 10,
      serviceCommissionRatePercent: 10,
      shippingPolicy: 'FLAT_FEE_PER_SHIPMENT',
      commissionEarningEvent: 'DELIVERED',
      returnCommissionTreatment: 'REVERSE',
      customerShippingChargeOwner: 'COMPANY',
      providerFeesBorneBy: 'AGENT',
      shippingFeePerShipment: 15,
      returnFeePerShipment: 20,
      serviceFeePerOrder: 5,
      allowAgentDestinations: true,
      payoutHoldDays: 0,
      ...overrides,
    };
  }

  async function makeOrder(input: {
    agentId: string;
    terms?: Partial<AgentTermsSnapshot>;
    lines: Array<{ productId: string; quantity: number; amount: number }>;
    shipping?: number;
    serviceCharge?: number;
    mode?: 'SHIPPING_ADDED' | 'SHIPPING_INCLUDED';
    method?: StoreOrderFulfillmentMethod;
  }) {
    const merchandise = input.lines.reduce((s, l) => s + l.amount, 0);
    const shipping = input.shipping ?? 0;
    const service = input.serviceCharge ?? 0;
    return prisma.storeOrder.create({
      data: {
        internalOrderId: `SO-AGT-${next()}`,
        partnerId: customerId,
        currencyId,
        paymentType: StoreOrderPaymentType.CASH_ON_DELIVERY,
        fulfillmentMethod: input.method ?? StoreOrderFulfillmentMethod.SHIPPING,
        agentId: input.agentId,
        agentTermsSnapshot: terms(
          input.terms,
        ) as unknown as Prisma.InputJsonValue,
        pricingMode: input.mode ?? 'SHIPPING_ADDED',
        merchandiseAmount: merchandise,
        discountAmount: 0,
        taxAmount: 0,
        shippingCharge: shipping,
        shippingChargeSource: shipping > 0 ? 'RATE' : 'NONE',
        serviceCharge: service,
        payableTotal: merchandise + shipping + service,
        items: {
          create: input.lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: Math.round((l.amount / l.quantity) * 100) / 100,
            agreedAmount: l.amount,
          })),
        },
      },
      include: { items: true },
    });
  }

  async function makePayment(
    order: { id: string; agentId: string | null },
    amount: number,
    opts: {
      methodId?: string;
      destination?: 'COMPANY' | 'AGENT';
      date?: Date;
    } = {},
  ) {
    return prisma.payment.create({
      data: {
        paymentNumber: `PAY-AGT-${next()}`,
        storeOrderId: order.id,
        paymentDate: opts.date ?? day(-2),
        amount,
        currencyId,
        paymentSourceId,
        paymentMethodId: opts.methodId ?? bankMethodId,
        origin: PaymentOrigin.SALES_DECLARATION,
        senderName: 'Agent customer',
        status: PaymentStatus.PENDING,
        agentId: order.agentId,
        destinationOwnership: opts.destination ?? 'COMPANY',
      },
    });
  }

  const entriesOf = (where: Prisma.AgentLedgerEntryWhereInput) =>
    prisma.agentLedgerEntry.findMany({
      where,
      orderBy: [{ entryDate: 'asc' }, { entryNumber: 'asc' }],
    });

  async function position(agentId: string) {
    const { balances } = await statements.balances(agentId);
    return balances.find((b) => b.currencyId === currencyId)!;
  }

  /** Σ (credit − debit) on Agent funds payable for the agent's partner = ledger balance of POSTED lines. */
  async function glPayable(agentId: string) {
    const agent = await prisma.agent.findUniqueOrThrow({
      where: { id: agentId },
    });
    const agg = await prisma.journalEntryLine.aggregate({
      where: {
        accountId: fundsPayableId,
        partnerId: agent.partnerId,
        journalEntry: { status: { in: ['POSTED', 'REVERSED'] } },
      },
      _sum: { debit: true, credit: true },
    });
    return (
      Math.round(
        (Number(agg._sum.credit ?? 0) - Number(agg._sum.debit ?? 0)) * 100,
      ) / 100
    );
  }

  async function ledgerPostedBalance(agentId: string) {
    const agg = await prisma.agentLedgerEntry.aggregate({
      where: { agentId, postingStatus: AgentLedgerPostingStatus.POSTED },
      _sum: { debit: true, credit: true },
    });
    return (
      Math.round(
        (Number(agg._sum.credit ?? 0) - Number(agg._sum.debit ?? 0)) * 100,
      ) / 100
    );
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
    storeOrders = get(StoreOrdersService);
    inventory = get(InventoryService);
    ledger = get(AgentLedgerService);
    fulfillment = get(AgentFulfillmentService);
    collections = get(AgentCollectionsService);
    payouts = get(AgentPayoutsService);
    statements = get(AgentStatementService);
    adjustments = get(AgentAdjustmentsService);
    settlements = get(PaymentSettlementsService);
    statementLines = get(PaymentStatementsService);
    matching = get(PaymentMatchingService);
    adapter = get(ClaimPostingAdapter);

    userId = (
      await prisma.user.create({
        data: {
          email: `agt-${tag.toLowerCase()}@test.local`,
          username: `agt-${tag.toLowerCase()}`,
          fullName: `Agent Finance Test ${tag}`,
          passwordHash: 'x',
        },
      })
    ).id;
    currencyId = await moduleRef
      .get(ExchangeRatesService)
      .requireFunctionalCurrencyId();

    const settings = await prisma.postingSettings.findFirstOrThrow();
    if (!settings.paymentGatewayFeeAccountId) {
      throw new Error(
        'Local PostingSettings must map the payment gateway fee account.',
      );
    }
    originalSettings.agentFundsPayableAccountId =
      settings.agentFundsPayableAccountId;
    originalSettings.agentCommissionRevenueAccountId =
      settings.agentCommissionRevenueAccountId;
    originalSettings.agentServiceRevenueAccountId =
      settings.agentServiceRevenueAccountId;
    const account = (code: string, type: AccountType) =>
      prisma.chartOfAccount.create({
        data: {
          code: `${code}-${tag}`,
          name: `${code} ${tag}`,
          accountType: type,
        },
      });
    fundsPayableId = (await account('AGT-PAY', AccountType.LIABILITY)).id;
    const commissionRev = (await account('AGT-COM', AccountType.REVENUE)).id;
    const serviceRev = (await account('AGT-SRV', AccountType.REVENUE)).id;
    await prisma.postingSettings.update({
      where: { id: settings.id },
      data: {
        agentFundsPayableAccountId: fundsPayableId,
        agentCommissionRevenueAccountId: commissionRev,
        agentServiceRevenueAccountId: serviceRev,
      },
    });

    customerId = (
      await prisma.partner.create({
        data: {
          partnerNumber: `PT-AGC-${tag}`,
          name: `Agent customer ${tag}`,
          roles: { create: { role: PartnerRoleType.CUSTOMER } },
        },
      })
    ).id;
    paymentSourceId = (
      await prisma.paymentSource.findFirstOrThrow({
        where: { deletedAt: null, isActive: true },
      })
    ).id;
    const bankGl = await account('AGT-BANK', AccountType.ASSET);
    bankReceivingId = (
      await prisma.receivingAccount.create({
        data: {
          name: `Agent bank ${tag}`,
          code: `AGT-RA-${tag}`,
          chartOfAccountId: bankGl.id,
        },
      })
    ).id;
    bankMethodId = (
      await prisma.paymentMethod.create({
        data: {
          name: `Agent transfer ${tag}`,
          accountId: bankGl.id,
          requiresReconciliation: false,
        },
      })
    ).id;
    const clearing = await account('AGT-CLR', AccountType.ASSET);
    courierMethodId = (
      await prisma.paymentMethod.create({
        data: {
          name: `Agent courier COD ${tag}`,
          accountId: clearing.id,
          requiresReconciliation: true,
        },
      })
    ).id;

    warehouseId = (
      await prisma.warehouse.create({
        data: { code: `AGT-WH-${tag}`, name: `Agent WH ${tag}` },
      })
    ).id;
    const category = await prisma.productCategory.findFirstOrThrow({
      where: { deletedAt: null },
    });
    const unit = await prisma.unit.findFirstOrThrow({});
    const product = async (sku: string, inventoryItem: boolean) =>
      (
        await prisma.product.create({
          data: {
            sku: `${sku}-${tag}`,
            name: `${sku} ${tag}`,
            internalName: `${sku} ${tag}`,
            displayName: `${sku} ${tag}`,
            categoryId: category.id,
            unitId: unit.id,
            type: inventoryItem ? 'PURCHASE_AND_SALE' : 'SERVICE',
            isPurchasable: inventoryItem,
            isSellable: true,
            isInventoryItem: inventoryItem,
            itemType: inventoryItem ? 'PRODUCT' : 'SERVICE',
            preferredWarehouseId: warehouseId,
          },
        })
      ).id;
    productA = await product('AGT-A', true);
    productB = await product('AGT-B', true);
    serviceProduct = await product('AGT-S', false);
    for (const productId of [productA, productB]) {
      await inventory.openingBalance(
        { productId, warehouseId, quantity: 100 },
        userId,
      );
    }
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

  const onHand = async (productId: string) => {
    const agg = await prisma.inventoryMovement.aggregate({
      where: {
        productId,
        warehouseId,
        type: { notIn: ['RESERVATION', 'RESERVATION_RELEASE'] },
      },
      _sum: { quantity: true },
    });
    return agg._sum.quantity ?? 0;
  };

  // ---------------------------------------------------------------------------

  let agentA: { id: string; partnerId: string };

  it('company destination, shipping included: collection credits agent payable (not AR); dispatch once; earning once', async () => {
    agentA = await makeAgent();
    // 1,000 incl. 100 shipping ⇒ merchandise 900 ⇒ commission 90 (10%).
    const order = await makeOrder({
      agentId: agentA.id,
      mode: 'SHIPPING_INCLUDED',
      lines: [{ productId: productA, quantity: 2, amount: 900 }],
      shipping: 100,
    });
    const payment = await makePayment(order, 1000);
    const confirmed = await payments.confirm(payment.id, userId);
    const again = await payments.confirm(payment.id, userId);
    expect(again.alreadyPosted).toBe(true);

    const je = await prisma.journalEntry.findFirstOrThrow({
      where: { id: confirmed.receipt.journalEntry!.id },
      include: { lines: true },
    });
    const credit = je.lines.find((l) => Number(l.credit) > 0)!;
    expect(credit.accountId).toBe(fundsPayableId);
    expect(credit.partnerId).toBe(agentA.partnerId);
    expect(Number(credit.credit)).toBe(1000);

    const collection = await entriesOf({
      paymentId: payment.id,
      entryType: 'COLLECTION_RECEIVED',
    });
    expect(collection).toHaveLength(1);
    expect(collection[0].postingStatus).toBe('POSTED');
    expect(collection[0].journalEntryId).toBe(je.id);
    // F-L1: the ledger line carries the receipt journal's date.
    expect(collection[0].entryDate.getTime()).toBe(je.entryDate.getTime());
    expect(collection[0].availableAt).toBeNull(); // not earned yet

    const before = await onHand(productA);
    await shipments.markShipped(order.id, userId);
    await shipments.markShipped(order.id, userId); // idempotent retry
    expect(await onHand(productA)).toBe(before - 2);
    expect(
      await entriesOf({ storeOrderId: order.id, entryType: 'SHIPPING_FEE' }),
    ).toHaveLength(1);

    await shipments.markDelivered(order.id, userId);
    await shipments.markDelivered(order.id, userId); // idempotent retry
    const earned = await entriesOf({
      storeOrderId: order.id,
      entryType: {
        in: ['COMMISSION', 'CUSTOMER_SHIPPING_RETAINED', 'SERVICE_FEE'],
      },
    });
    expect(earned.map((e) => [e.entryType, Number(e.debit)])).toEqual([
      ['COMMISSION', 90],
      ['CUSTOMER_SHIPPING_RETAINED', 100],
      ['SERVICE_FEE', 5],
    ]);
    expect(earned.every((e) => e.postingStatus === 'POSTED')).toBe(true);
    const commission = earned[0];
    // commission-policy.md A5: per-line detail, split by class.
    expect(commission.basis).toMatchObject({
      base: 900,
      byClass: { PRODUCT: { sales: 900, base: 900, commission: 90 } },
    });
    const commissionLines = await prisma.agentCommissionLine.findMany({
      where: { ledgerEntryId: commission.id },
    });
    expect(
      commissionLines.map((l) => [l.commissionClass, Number(l.amount)]),
    ).toEqual([['PRODUCT', 90]]);
    const commissionJe = await prisma.journalEntryLine.findMany({
      where: { journalEntryId: commission.journalEntryId! },
    });
    expect(commissionJe.find((l) => Number(l.debit) > 0)!.accountId).toBe(
      fundsPayableId,
    );

    const p = await position(agentA.id);
    // 1000 − 15 − 90 − 100 − 5
    expect(p.balance).toBe(790);
    expect(p.available).toBe(790);
    expect(await glPayable(agentA.id)).toBe(
      await ledgerPostedBalance(agentA.id),
    );
  });

  it('ledger is append-only at the database (UPDATE amount / DELETE fail)', async () => {
    const [entry] = await entriesOf({ agentId: agentA.id });
    await expect(
      prisma.$executeRaw`UPDATE agent_ledger_entries SET debit = debit + 1 WHERE id = ${entry.id}::uuid`,
    ).rejects.toThrow(/immutable/);
    await expect(
      prisma.$executeRaw`DELETE FROM agent_ledger_entries WHERE id = ${entry.id}::uuid`,
    ).rejects.toThrow(/append-only/);
  });

  it('payouts: partial, idempotent retry, concurrent overdraw refused, final, reversal', async () => {
    const preview = await payouts.preview(agentA.id);
    expect(preview.available).toBe(790);
    const base = {
      payingAccountId: bankReceivingId,
      payoutDate: new Date().toISOString(),
      reference: `TRF-${tag}`,
    };
    const first = await payouts.create(
      agentA.id,
      { ...base, amount: 300, idempotencyKey: `k1-${tag}` },
      userId,
    );
    const replay = await payouts.create(
      agentA.id,
      { ...base, amount: 300, idempotencyKey: `k1-${tag}` },
      userId,
    );
    expect(replay.id).toBe(first.id);
    expect(replay.replayed).toBe(true);
    expect(first.allocations.reduce((s, a) => s + a.amount, 0)).toBe(300);

    const results = await Promise.allSettled([
      payouts.create(
        agentA.id,
        { ...base, amount: 400, idempotencyKey: `k2-${tag}` },
        userId,
      ),
      payouts.create(
        agentA.id,
        { ...base, amount: 400, idempotencyKey: `k3-${tag}` },
        userId,
      ),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(
      JSON.stringify((rejected.reason as { response?: unknown }).response),
    ).toContain('PAYOUT_EXCEEDS_AVAILABLE');

    expect((await position(agentA.id)).available).toBe(90);
    await expect(
      payouts.create(
        agentA.id,
        { ...base, amount: 90.01, idempotencyKey: `k4-${tag}` },
        userId,
      ),
    ).rejects.toMatchObject({ response: { code: 'PAYOUT_EXCEEDS_AVAILABLE' } });
    const final = await payouts.create(
      agentA.id,
      { ...base, amount: 90, idempotencyKey: `k5-${tag}` },
      userId,
    );
    let p = await position(agentA.id);
    expect(p.available).toBe(0);
    expect(p.balance).toBe(0);

    const reversed = await payouts.reverse(
      final.id,
      'Bank returned the transfer',
      userId,
    );
    expect(reversed.status).toBe('REVERSED');
    await expect(
      payouts.reverse(final.id, 'again', userId),
    ).rejects.toMatchObject({
      response: { code: 'PAYOUT_ALREADY_REVERSED' },
    });
    p = await position(agentA.id);
    expect(p.available).toBe(90);
    expect(p.balance).toBe(90);
    const payoutJe = await prisma.journalEntry.findMany({
      where: {
        sourceType: 'AGENT_PAYOUT',
        sourceId: {
          in: (
            await entriesOf({ payoutId: final.id, entryType: 'PAYOUT' })
          ).map((e) => e.id),
        },
      },
    });
    expect(payoutJe.map((j) => j.status).sort()).toEqual([
      'POSTED',
      'REVERSED',
    ]);
    expect(await glPayable(agentA.id)).toBe(
      await ledgerPostedBalance(agentA.id),
    );
  });

  it('returns: partial + full with REVERSE; customer shipping retained is not reversed; RETAIN keeps commission', async () => {
    const order = await makeOrder({
      agentId: agentA.id,
      lines: [{ productId: productB, quantity: 3, amount: 300 }],
      shipping: 50,
    });
    await payments.confirm((await makePayment(order, 350)).id, userId);
    await shipments.markShipped(order.id, userId);
    await shipments.markDelivered(order.id, userId);
    const stock = await onHand(productB);
    const item = order.items[0];

    const key = `ret1-${tag}`;
    const r1 = await fulfillment.receiveReturn(
      order.id,
      {
        lines: [{ storeOrderItemId: item.id, quantity: 1 }],
        warehouseId,
        idempotencyKey: key,
      },
      userId,
    );
    const r1b = await fulfillment.receiveReturn(
      order.id,
      {
        lines: [{ storeOrderItemId: item.id, quantity: 1 }],
        warehouseId,
        idempotencyKey: key,
      },
      userId,
    );
    expect(r1b.replayed).toBe(true);
    expect(r1b.id).toBe(r1.id);
    expect(Number(r1.merchandiseAmount)).toBe(100);
    expect(await onHand(productB)).toBe(stock + 1);

    await fulfillment.receiveReturn(
      order.id,
      {
        lines: [{ storeOrderItemId: item.id, quantity: 2 }],
        warehouseId,
        idempotencyKey: `ret2-${tag}`,
      },
      userId,
    );
    await expect(
      fulfillment.receiveReturn(
        order.id,
        {
          lines: [{ storeOrderItemId: item.id, quantity: 1 }],
          warehouseId,
          idempotencyKey: `ret3-${tag}`,
        },
        userId,
      ),
    ).rejects.toMatchObject({ response: { code: 'RETURN_EXCEEDS_SHIPPED' } });

    const reversals = await entriesOf({
      storeOrderId: order.id,
      entryType: 'COMMISSION_REVERSAL',
    });
    expect(reversals.map((e) => Number(e.credit))).toEqual([10, 20]);
    // F-L4: two receipts of the same returned parcel — one return fee.
    expect(
      await entriesOf({ storeOrderId: order.id, entryType: 'RETURN_FEE' }),
    ).toHaveLength(1);
    expect(
      await entriesOf({
        storeOrderId: order.id,
        entryType: 'CUSTOMER_SHIPPING_RETAINED_REVERSAL',
      }),
    ).toHaveLength(0);

    const retain = await makeOrder({
      agentId: agentA.id,
      terms: { returnCommissionTreatment: 'RETAIN' },
      lines: [{ productId: productB, quantity: 1, amount: 200 }],
    });
    await shipments.markShipped(retain.id, userId);
    await shipments.markDelivered(retain.id, userId);
    await fulfillment.receiveReturn(
      retain.id,
      {
        lines: [{ storeOrderItemId: retain.items[0].id, quantity: 1 }],
        warehouseId,
        idempotencyKey: `ret4-${tag}`,
      },
      userId,
    );
    expect(
      await entriesOf({
        storeOrderId: retain.id,
        entryType: 'COMMISSION_REVERSAL',
      }),
    ).toHaveLength(0);
    expect(
      await entriesOf({ storeOrderId: retain.id, entryType: 'COMMISSION' }),
    ).toHaveLength(1);
  });

  it('agent destination: evidence verification is a memo (no JE, not company cash); PAYMENT_VERIFIED earns', async () => {
    const agentB = await makeAgent();
    const order = await makeOrder({
      agentId: agentB.id,
      terms: { commissionEarningEvent: 'PAYMENT_VERIFIED' },
      lines: [{ productId: productA, quantity: 1, amount: 500 }],
    });
    const payment = await makePayment(order, 500, { destination: 'AGENT' });
    await expect(payments.confirm(payment.id, userId)).rejects.toMatchObject({
      response: { code: 'AGENT_DESTINATION_USE_AGENT_COLLECTIONS' },
    });
    const queue = await collections.queue({ agentId: agentB.id });
    expect(queue.items.map((i) => i.id)).toContain(payment.id);

    const v1 = await collections.verify(payment.id, userId);
    const v2 = await collections.verify(payment.id, userId);
    expect(v1.alreadyVerified).toBe(false);
    expect(v2.alreadyVerified).toBe(true);
    const stored = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    expect(stored.status).toBe('VERIFIED');
    expect(stored.settlementStatus).toBe('NOT_APPLICABLE');
    expect(
      await prisma.paymentReceiptLink.count({
        where: { paymentId: payment.id },
      }),
    ).toBe(0);
    const memo = await entriesOf({ paymentId: payment.id });
    expect(memo).toHaveLength(1);
    expect(memo[0]).toMatchObject({
      entryType: 'COLLECTION_BY_AGENT',
      postingStatus: 'NOT_APPLICABLE',
      journalEntryId: null,
    });
    expect(Number(memo[0].memoAmount)).toBe(500);
    // fully verified ⇒ earning event reached: commission 50 + service fee 5, balance −55 (agent owes)
    const p = await position(agentB.id);
    expect(p.balance).toBe(-55);
    expect(p.available).toBe(0);

    const eligible = await settlements.findEligible(bankMethodId);
    expect(JSON.stringify(eligible)).not.toContain(payment.id);

    const rejectMe = await makePayment(order, 10, { destination: 'AGENT' });
    const rejected = await collections.reject(
      rejectMe.id,
      'Screenshot unreadable',
      userId,
    );
    expect(rejected.status).toBe('REJECTED');

    // Agent-paid refund = memo; company refund bounded by company collections (none here).
    await adjustments.refund(
      order.id,
      {
        amount: 100,
        paidBy: 'AGENT',
        reason: 'Customer returned',
        idempotencyKey: `rf1-${tag}`,
      },
      userId,
    );
    await expect(
      adjustments.refund(
        order.id,
        {
          amount: 1,
          paidBy: 'COMPANY',
          payingAccountId: bankReceivingId,
          reason: 'x',
          idempotencyKey: `rf2-${tag}`,
        },
        userId,
      ),
    ).rejects.toMatchObject({ response: { code: 'REFUND_EXCEEDS_COLLECTED' } });
  });

  it('digital-only order earns on full verification; partial payments do not', async () => {
    const agent = await makeAgent();
    const order = await makeOrder({
      agentId: agent.id,
      lines: [{ productId: serviceProduct, quantity: 1, amount: 400 }],
    });
    await payments.confirm((await makePayment(order, 150)).id, userId);
    expect(
      (await prisma.storeOrder.findUniqueOrThrow({ where: { id: order.id } }))
        .agentEarnedAt,
    ).toBeNull();
    await payments.confirm((await makePayment(order, 250)).id, userId);
    expect(
      (await prisma.storeOrder.findUniqueOrThrow({ where: { id: order.id } }))
        .agentEarnedAt,
    ).not.toBeNull();
    const commission = await entriesOf({
      storeOrderId: order.id,
      entryType: 'COMMISSION',
    });
    expect(Number(commission[0].debit)).toBe(40);
    expect(
      await entriesOf({ storeOrderId: order.id, entryType: 'SHIPPING_FEE' }),
    ).toHaveLength(0);
    const p = await position(agent.id);
    expect(p.available).toBe(355); // 400 − 40 − 5
  });

  it('pickup handover dispatches and earns (no shipping fee)', async () => {
    const agent = await makeAgent();
    const order = await makeOrder({
      agentId: agent.id,
      method: StoreOrderFulfillmentMethod.PICKUP,
      lines: [{ productId: productA, quantity: 1, amount: 120 }],
    });
    const stock = await onHand(productA);
    await storeOrders.transitionPickup(order.id, 'READY_FOR_PICKUP');
    await storeOrders.transitionPickup(order.id, 'COLLECTED');
    const stored = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(stored.agentDispatchedAt).not.toBeNull();
    expect(stored.agentEarnedAt).not.toBeNull();
    expect(await onHand(productA)).toBe(stock - 1);
    expect(
      await entriesOf({ storeOrderId: order.id, entryType: 'SHIPPING_FEE' }),
    ).toHaveLength(0);
    expect(
      Number(
        (
          await entriesOf({ storeOrderId: order.id, entryType: 'COMMISSION' })
        )[0].debit,
      ),
    ).toBe(12);
  });

  it('COD via courier: held until settlement, provider fee share borne by agent, reversal restores', async () => {
    const agent = await makeAgent();
    const orders = [
      await makeOrder({
        agentId: agent.id,
        lines: [{ productId: productA, quantity: 1, amount: 600 }],
      }),
      await makeOrder({
        agentId: agent.id,
        terms: { providerFeesBorneBy: 'COMPANY' },
        lines: [{ productId: productA, quantity: 1, amount: 400 }],
      }),
    ];
    const claims = [];
    for (const order of orders) {
      await shipments.markShipped(order.id, userId);
      await shipments.markDelivered(order.id, userId);
      const payment = await makePayment(order, Number(order.payableTotal), {
        methodId: courierMethodId,
        date: day(-3),
      });
      await prisma.$transaction((tx) =>
        adapter.confirmInTx(tx, payment.id, userId, {
          statementLineId: `test-${tag}`,
        }),
      );
      claims.push(payment);
    }
    let stages = await statements.paymentStages(agent.id);
    expect(stages.every((s) => s.stage === 'HELD_WITH_PROVIDER')).toBe(true);
    let p = await position(agent.id);
    expect(p.pending).toBe(1000);
    expect(p.available).toBe(0);

    const settlement = await settlements.create(
      {
        paymentMethodId: courierMethodId,
        claims: claims.map((c) => ({ paymentId: c.id })),
        receivedAmount: 980,
        receivedCurrencyId: currencyId,
        receivingAccountId: bankReceivingId,
        settlementDate: day(-1).toISOString().slice(0, 10),
        idempotencyKey: `stl-${tag}`,
      },
      userId,
    );
    const fees = await entriesOf({
      agentId: agent.id,
      entryType: 'PROVIDER_FEE',
    });
    expect(fees.map((f) => Number(f.debit))).toEqual([12]); // 20 × 600/1000, only the AGENT-borne order
    expect(fees[0].postingStatus).toBe('POSTED');
    stages = await statements.paymentStages(agent.id);
    expect(stages.every((s) => s.stage === 'AVAILABLE')).toBe(true);
    p = await position(agent.id);
    // 1000 − 2×15 shipping − 2×5 service − 60 − 40 commission − 12 fee
    expect(p.available).toBe(848);

    await settlements.reverse(settlement.id, 'Provider clawback', userId);
    const adj = await entriesOf({ agentId: agent.id, entryType: 'ADJUSTMENT' });
    expect(adj.map((a) => Number(a.credit))).toEqual([12]);
    // F-L2: the fee's own journal is mirrored (same amounts/rate), never
    // re-posted at today's rate; F-L1: the credit carries that JE's date.
    const mirror = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: adj[0].journalEntryId! },
    });
    expect(mirror.reversalOfEntryId).toBe(fees[0].journalEntryId);
    expect(adj[0].entryDate.getTime()).toBe(mirror.entryDate.getTime());
    p = await position(agent.id);
    expect(p.pending).toBe(1000);
    expect(await glPayable(agent.id)).toBe(await ledgerPostedBalance(agent.id));
  });

  it('reconciliation correction debits the collection back (COLLECTION_REVERSAL) and a re-match credits once more', async () => {
    const agent = await makeAgent();
    const order = await makeOrder({
      agentId: agent.id,
      lines: [{ productId: productA, quantity: 1, amount: 250 }],
    });
    const payment = await makePayment(order, 250, {
      methodId: courierMethodId,
      date: day(-2),
    });
    const line = await statementLines.createManualLine(
      courierMethodId,
      {
        providerReference: `AGT-L-${tag}`,
        amount: 250,
        currencyId,
        transactionDate: day(-2).toISOString().slice(0, 10),
      },
      userId,
    );
    const lineId = (
      await prisma.paymentStatementLine.findFirstOrThrow({
        where: {
          paymentMethodId: courierMethodId,
          providerReference: `AGT-L-${tag}`,
        },
      })
    ).id;
    expect(line).toBeDefined();
    const matched = await matching.confirm(
      courierMethodId,
      {
        statementLineId: lineId,
        allocations: [{ paymentId: payment.id, amount: 250 }],
        idempotencyKey: `m1-${tag}`,
      },
      userId,
    );
    await matching.reverseMatch(
      courierMethodId,
      matched.matches[0].id,
      'Wrong claim',
      userId,
    );
    const rows = await entriesOf({ paymentId: payment.id });
    expect(rows.map((r) => r.entryType)).toEqual([
      'COLLECTION_RECEIVED',
      'COLLECTION_REVERSAL',
    ]);
    expect(rows[1].journalEntryId).not.toBeNull();
    const reversalJe = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: rows[1].journalEntryId! },
    });
    expect(rows[1].entryDate.getTime()).toBe(reversalJe.entryDate.getTime());
    expect((await position(agent.id)).balance).toBe(0);

    await matching.confirm(
      courierMethodId,
      {
        statementLineId: lineId,
        allocations: [{ paymentId: payment.id, amount: 250 }],
        idempotencyKey: `m2-${tag}`,
      },
      userId,
    );
    const credits = await entriesOf({
      paymentId: payment.id,
      entryType: 'COLLECTION_RECEIVED',
    });
    expect(credits).toHaveLength(2);
    expect((await position(agent.id)).balance).toBe(250);
    expect(await glPayable(agent.id)).toBe(await ledgerPostedBalance(agent.id));
  });

  it('statement: running balance ends at Σ, summary agrees with orders and ledger', async () => {
    const statement = await statements.statement(agentA.id, {});
    const sum = statement.lines.reduce((s, l) => s + l.credit - l.debit, 0);
    expect(statement.openingBalance).toBe(0);
    expect(statement.closingBalance).toBe(Math.round(sum * 100) / 100);
    expect(statement.lines[statement.lines.length - 1].balance).toBe(
      statement.closingBalance,
    );
    expect(statement.closingBalance).toBe((await position(agentA.id)).balance);
    const orders = await prisma.storeOrder.findMany({
      where: { agentId: agentA.id },
    });
    expect(statement.summary.orders.merchandiseSalesExShipping).toBe(
      orders.reduce((s, o) => s + Number(o.merchandiseAmount), 0),
    );
    expect(statement.summary.orders.customerShippingCharges).toBe(150);
    expect(statement.summary.commission.charged).toBe(90 + 30 + 20);
    expect(statement.summary.commission.reversed).toBe(30);
    expect(statement.summary.collections.byCompany).toBe(1350);
    expect(statement.lines.some((l) => l.references.orderNumber)).toBe(true);

    const period = await statements.statement(agentA.id, {
      from: day(1).toISOString().slice(0, 10),
    });
    expect(period.openingBalance).toBe(statement.closingBalance);
    expect(period.lines).toHaveLength(0);
  });

  it('accounts not configured: charges stay PENDING_CONFIGURATION, collections/payouts refused; postPending posts once', async () => {
    const settings = await prisma.postingSettings.findFirstOrThrow();
    const agent = await makeAgent();
    const order = await makeOrder({
      agentId: agent.id,
      lines: [{ productId: productA, quantity: 1, amount: 100 }],
    });
    await prisma.postingSettings.update({
      where: { id: settings.id },
      data: { agentFundsPayableAccountId: null },
    });
    try {
      await shipments.markShipped(order.id, userId);
      const fee = await entriesOf({
        storeOrderId: order.id,
        entryType: 'SHIPPING_FEE',
      });
      expect(fee[0].postingStatus).toBe('PENDING_CONFIGURATION');
      expect(fee[0].journalEntryId).toBeNull();
      await expect(
        payments.confirm((await makePayment(order, 100)).id, userId),
      ).rejects.toMatchObject({
        response: { code: 'AGENT_ACCOUNTS_NOT_CONFIGURED' },
      });
      await expect(ledger.postPending(agent.id, userId)).rejects.toMatchObject({
        response: { code: 'AGENT_ACCOUNTS_NOT_CONFIGURED' },
      });
      await expect(
        adjustments.adjust(
          agent.id,
          {
            direction: 'CREDIT',
            amount: 50,
            reason: 'Goodwill',
            idempotencyKey: `adj-${tag}`,
          },
          userId,
        ),
      ).resolves.toMatchObject({ replayed: false });
      await expect(
        payouts.create(
          agent.id,
          {
            amount: 10,
            payingAccountId: bankReceivingId,
            payoutDate: new Date().toISOString(),
            reference: 'x',
            idempotencyKey: `kp-${tag}`,
          },
          userId,
        ),
      ).rejects.toMatchObject({
        response: { code: 'AGENT_ACCOUNTS_NOT_CONFIGURED' },
      });
    } finally {
      await prisma.postingSettings.update({
        where: { id: settings.id },
        data: { agentFundsPayableAccountId: fundsPayableId },
      });
    }
    const pending = await statements.listPendingPostings(agent.id);
    expect(pending.total).toBe(2);
    const first = await ledger.postPending(agent.id, userId);
    expect(first.posted).toHaveLength(2);
    expect(first.failed).toHaveLength(0);
    const second = await ledger.postPending(agent.id, userId);
    expect(second.total).toBe(0);
    const posted = await entriesOf({ agentId: agent.id });
    expect(
      posted.every((e) => e.postingStatus === 'POSTED' && e.journalEntryId),
    ).toBe(true);
    expect(
      await prisma.journalEntry.count({
        where: { sourceId: { in: posted.map((e) => e.id) } },
      }),
    ).toBe(2);
    expect(await glPayable(agent.id)).toBe(await ledgerPostedBalance(agent.id));
  });

  // ── Review fixes (S3, S5, F-M1, F-M4, F-L3, F-L4, F-L6, F-L7) ───────────

  it('S3: the shipping-updates import runs the agent dispatch/fee/earning hook exactly once', async () => {
    const agent = await makeAgent();
    const order = await makeOrder({
      agentId: agent.id,
      lines: [{ productId: productA, quantity: 2, amount: 400 }],
    });
    const handler = new ShippingUpdatesImportHandler(
      prisma,
      moduleRef.get(StoreOrderShipmentsService, { strict: false }),
      moduleRef.get(StoreOrderActivityService, { strict: false }),
      { register: () => undefined } as never,
      { resolveOptional: () => Promise.resolve(undefined) } as never,
      fulfillment,
    );
    const before = await onHand(productA);
    await handler.importRow(
      { systemOrderId: order.internalOrderId, status: 'SHIPPED' },
      userId,
    );
    expect(await onHand(productA)).toBe(before - 2);
    expect(
      (await prisma.storeOrder.findUniqueOrThrow({ where: { id: order.id } }))
        .agentDispatchedAt,
    ).not.toBeNull();
    await handler.importRow(
      { systemOrderId: order.internalOrderId, status: 'OUT_FOR_DELIVERY' },
      userId,
    );
    await handler.importRow(
      {
        systemOrderId: order.internalOrderId,
        status: 'DELIVERED',
        trackingNumber: `TRK-${tag}`,
      },
      userId,
    );
    expect(await onHand(productA)).toBe(before - 2);
    expect(
      await entriesOf({ storeOrderId: order.id, entryType: 'SHIPPING_FEE' }),
    ).toHaveLength(1);
    expect(
      await entriesOf({ storeOrderId: order.id, entryType: 'COMMISSION' }),
    ).toHaveLength(1);
  });

  it('S5 / F-M1: agent-received claims never go through company match, reject, dispute or bank matching', async () => {
    const agent = await makeAgent();
    const order = await makeOrder({
      agentId: agent.id,
      lines: [{ productId: productA, quantity: 1, amount: 777.77 }],
    });
    const claim = await makePayment(order, 777.77, { destination: 'AGENT' });
    const code = {
      response: { code: 'AGENT_DESTINATION_USE_AGENT_COLLECTIONS' },
    };
    await expect(
      payments.match(claim.id, { matchedById: userId }),
    ).rejects.toMatchObject(code);
    await expect(
      payments.reject(claim.id, {
        rejectionReason: 'x',
        rejectedById: userId,
      }),
    ).rejects.toMatchObject(code);
    await expect(payments.dispute(claim.id, userId, 'x')).rejects.toMatchObject(
      code,
    );
    const autoMatching = moduleRef.get(PaymentAutoMatchingService, {
      strict: false,
    });
    const classified = await autoMatching.classifyTransaction({
      id: randomUUID(),
      amount: 777.77,
      currencyId,
      reference: claim.paymentNumber,
      description: claim.paymentNumber,
      transactionDate: day(-2),
    });
    expect(classified.candidates.map((c) => c.paymentId)).not.toContain(
      claim.id,
    );
    // The agent collections review still decides it.
    const rejected = await collections.reject(claim.id, 'No proof', userId);
    expect(rejected.status).toBe('REJECTED');
  });

  it('F-L3: the ledger guard freezes basis/links/status history and blocks TRUNCATE', async () => {
    const [entry] = await entriesOf({
      agentId: agentA.id,
      postingStatus: 'POSTED',
      journalEntryId: { not: null },
    });
    const refuse = (sql: Promise<unknown>) =>
      expect(sql).rejects.toThrow(/immutable|posting status|set once/);
    await refuse(
      prisma.$executeRaw`UPDATE agent_ledger_entries SET basis = '{"base":1}'::jsonb WHERE id = ${entry.id}::uuid`,
    );
    await refuse(
      prisma.$executeRaw`UPDATE agent_ledger_entries SET store_order_id = NULL WHERE id = ${entry.id}::uuid`,
    );
    await refuse(
      prisma.$executeRaw`UPDATE agent_ledger_entries SET memo_amount = 1 WHERE id = ${entry.id}::uuid`,
    );
    await refuse(
      prisma.$executeRaw`UPDATE agent_ledger_entries SET posting_status = 'PENDING_CONFIGURATION' WHERE id = ${entry.id}::uuid`,
    );
    await refuse(
      prisma.$executeRaw`UPDATE agent_ledger_entries SET journal_entry_id = gen_random_uuid() WHERE id = ${entry.id}::uuid`,
    );
    // Availability is computed and stays refreshable.
    await prisma.$executeRaw`UPDATE agent_ledger_entries SET available_at = available_at WHERE id = ${entry.id}::uuid`;
    // TRUNCATE is refused; the rollback guard keeps the table even if not.
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('TRUNCATE agent_ledger_entries CASCADE');
        throw new Error('TRUNCATE was not blocked');
      }),
    ).rejects.toThrow(/append-only/);
  });

  it('F-L4: one return fee per returned shipment; explicit flag without a shipment', async () => {
    const agent = await makeAgent();
    const order = await makeOrder({
      agentId: agent.id,
      lines: [{ productId: productB, quantity: 3, amount: 300 }],
    });
    await shipments.markShipped(order.id, userId);
    await shipments.markDelivered(order.id, userId);
    const shipment = await prisma.shipment.findFirstOrThrow({
      where: { storeOrderId: order.id, deletedAt: null },
    });
    const line = order.items[0];
    const receive = (key: string, extra: object) =>
      fulfillment.receiveReturn(
        order.id,
        {
          lines: [{ storeOrderItemId: line.id, quantity: 1 }],
          warehouseId,
          idempotencyKey: `${key}-${tag}`,
          ...extra,
        },
        userId,
      );
    await receive('fl4a', { shipmentId: shipment.id });
    await receive('fl4b', { shipmentId: shipment.id });
    const fees = await entriesOf({
      storeOrderId: order.id,
      entryType: 'RETURN_FEE',
    });
    expect(fees).toHaveLength(1);
    expect(fees[0].sourceId).toBe(shipment.id);
    await receive('fl4c', { chargeReturnFee: true });
    expect(
      await entriesOf({ storeOrderId: order.id, entryType: 'RETURN_FEE' }),
    ).toHaveLength(2);
    await expect(
      receive('fl4d', { shipmentId: randomUUID() }),
    ).rejects.toMatchObject({ response: { code: 'RETURN_SHIPMENT_INVALID' } });
  });

  it('F-L7: dispatch follows the order snapshot, not the live product flag', async () => {
    const agent = await makeAgent();
    const category = await prisma.productCategory.findFirstOrThrow({
      where: { deletedAt: null },
    });
    const unit = await prisma.unit.findFirstOrThrow({});
    const course = await prisma.product.create({
      data: {
        sku: `AGT-F7-${tag}`,
        name: `F7 ${tag}`,
        internalName: `F7 ${tag}`,
        displayName: `F7 ${tag}`,
        categoryId: category.id,
        unitId: unit.id,
        type: 'SERVICE',
        isPurchasable: false,
        isSellable: true,
        isInventoryItem: false,
        itemType: 'SERVICE',
        preferredWarehouseId: warehouseId,
      },
    });
    const order = await makeOrder({
      agentId: agent.id,
      lines: [{ productId: course.id, quantity: 1, amount: 100 }],
    });
    await prisma.storeOrder.update({
      where: { id: order.id },
      data: {
        agentTermsSnapshot: {
          ...(order.agentTermsSnapshot as object),
          lines: [{ productId: course.id, inventoryLine: false }],
        },
      },
    });
    // The product later becomes an inventory item: the order stays digital.
    await prisma.product.update({
      where: { id: course.id },
      data: { isInventoryItem: true },
    });
    const loaded = (await fulfillment.loadOrder(prisma, order.id))!;
    expect(fulfillment.isDigitalOnly(loaded)).toBe(true);
    await prisma.$transaction((tx) => fulfillment.dispatch(tx, loaded, userId));
    expect(
      await prisma.inventoryMovement.count({ where: { productId: course.id } }),
    ).toBe(0);
  });

  it('F-L6: a paying account inherits its ledger account currency', async () => {
    const other = await prisma.currency.create({
      data: { code: `X${tag}`, name: `Other ${tag}` },
    });
    const gl = await prisma.chartOfAccount.create({
      data: {
        code: `AGT-FX-${tag}`,
        name: `FX bank ${tag}`,
        accountType: AccountType.ASSET,
        currencyId: other.id,
      },
    });
    const foreign = await prisma.receivingAccount.create({
      data: {
        name: `FX bank ${tag}`,
        code: `AGT-FX-RA-${tag}`,
        chartOfAccountId: gl.id,
      },
    });
    await expect(
      payouts.create(
        agentA.id,
        {
          payingAccountId: foreign.id,
          payoutDate: new Date().toISOString(),
          reference: `FX-${tag}`,
          amount: 1,
          idempotencyKey: `fx-${tag}`,
        },
        userId,
      ),
    ).rejects.toMatchObject({ response: { code: 'CURRENCY_MISMATCH' } });
  });

  it('F-M4: agent accounts are locked once posted and must be in the functional currency', async () => {
    const settingsService = new PostingSettingsService(prisma);
    const other = await prisma.currency.create({
      data: { code: `Y${tag}`, name: `Other2 ${tag}` },
    });
    const foreignLiability = await prisma.chartOfAccount.create({
      data: {
        code: `AGT-PAY-FX-${tag}`,
        name: `Payable FX ${tag}`,
        accountType: AccountType.LIABILITY,
        currencyId: other.id,
      },
    });
    await expect(
      settingsService.update({
        agentFundsPayableAccountId: foreignLiability.id,
      }),
    ).rejects.toMatchObject({ response: { code: 'AGENT_ACCOUNT_CURRENCY' } });
    const newLiability = await prisma.chartOfAccount.create({
      data: {
        code: `AGT-PAY2-${tag}`,
        name: `Payable 2 ${tag}`,
        accountType: AccountType.LIABILITY,
      },
    });
    await expect(
      settingsService.update({ agentFundsPayableAccountId: newLiability.id }),
    ).rejects.toMatchObject({ response: { code: 'AGENT_ACCOUNTS_LOCKED' } });
    // Re-saving the same account is not a change.
    await expect(
      settingsService.update({ agentFundsPayableAccountId: fundsPayableId }),
    ).resolves.toBeDefined();
  });
});
