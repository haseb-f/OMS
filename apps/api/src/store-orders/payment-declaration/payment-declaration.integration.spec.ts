import { Test, type TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AccountType,
  JournalEntryStatus,
  PartnerRoleType,
  PaymentOrigin,
  PaymentStatus,
  StoreOrderFulfillmentMethod,
  StoreOrderPaymentType,
} from '@prisma/client';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsCoreModule } from '../../permissions/permissions-core.module';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { PhoneModule } from '../../common/phone/phone.module';
import { AuthModule } from '../../auth/auth.module';
import { PostingProvidersModule } from '../../accounting/posting-providers/posting-providers.module';
import { FxModule } from '../../accounting/fx/fx.module';
import { ExchangeRatesService } from '../../accounting/fx/exchange-rates.service';
import { StoreOrdersModule } from '../store-orders.module';
import { StoreOrdersService } from '../store-orders.service';
import { StoreOrderShipmentsService } from '../shipments/store-order-shipments.service';
import { PaymentsModule } from '../../payments/payments.module';
import { PaymentsService } from '../../payments/payments.service';
import {
  StoreOrderPaymentDeclarationService,
  type DeclarationActor,
} from './store-order-payment-declaration.service';
import type { PaymentDeclarationFieldsDto } from '../dto/declare-store-order-payment.dto';

/**
 * payment-declaration-reconciliation — declaration, prepaid fulfillment
 * gate, Confirm & Post to the method clearing account, dispute. Runs
 * against the real local Postgres with self-created, tagged fixtures.
 */
describe('Payment declaration → fulfillment gate → confirm & post', () => {
  jest.setTimeout(180_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let declarations: StoreOrderPaymentDeclarationService;
  let payments: PaymentsService;
  let shipments: StoreOrderShipmentsService;
  let storeOrders: StoreOrdersService;
  let permissions: PermissionsResolverService;

  const tag = randomUUID().slice(0, 6).toUpperCase();
  let userId: string;
  let currencyId: string;
  let partnerId: string;
  let productId: string;
  let clearingAccountId: string;
  /** Non-reconciled method: Finance confirms it from payment review. */
  let methodId: string;
  /** Reconciliation-enabled method: confirmed only via statement matching (M1). */
  let reconMethodId: string;
  let badMethodId: string;
  let inactiveMethodId: string;
  let orderSeq = 0;

  // Two days ago (UTC date) — the rate row is dated exactly then.
  const paymentDay = new Date(
    Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate() - 2,
    ),
  );
  const paymentDate = paymentDay.toISOString().slice(0, 10);

  const sales: DeclarationActor = {
    userId: '',
    origin: PaymentOrigin.SALES_DECLARATION,
    allowCorrection: false,
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        PostingProvidersModule,
        FxModule,
        StoreOrdersModule,
        PaymentsModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    declarations = moduleRef.get(StoreOrderPaymentDeclarationService);
    payments = moduleRef.get(PaymentsService);
    shipments = moduleRef.get(StoreOrderShipmentsService);
    storeOrders = moduleRef.get(StoreOrdersService);
    permissions = moduleRef.get(PermissionsResolverService);

    const user = await prisma.user.create({
      data: {
        email: `decl-${tag.toLowerCase()}@test.local`,
        username: `decl-${tag.toLowerCase()}`,
        fullName: `Declaration Test ${tag}`,
        passwordHash: 'x',
      },
    });
    userId = user.id;
    sales.userId = userId;

    const functionalId = await moduleRef
      .get(ExchangeRatesService)
      .requireFunctionalCurrencyId();
    const currency = await prisma.currency.create({
      data: { code: `D${tag}`, name: `Declaration Test ${tag}` },
    });
    currencyId = currency.id;
    await prisma.exchangeRate.create({
      data: {
        fromCurrencyId: currencyId,
        toCurrencyId: functionalId,
        rate: 50,
        effectiveDate: paymentDay,
      },
    });

    const partner = await prisma.partner.create({
      data: {
        partnerNumber: `PT-DECL-${tag}`,
        name: `Declaration Customer ${tag}`,
        roles: { create: { role: PartnerRoleType.CUSTOMER } },
      },
    });
    partnerId = partner.id;
    const product = await prisma.product.findFirst({
      where: { deletedAt: null, status: 'ACTIVE', ownerAgentId: null },
      select: { id: true },
    });
    if (!product) throw new Error('Expected an active product.');
    productId = product.id;

    const clearing = await prisma.chartOfAccount.create({
      data: {
        code: `DECL-CLR-${tag}`,
        name: `Declaration Clearing ${tag}`,
        accountType: AccountType.ASSET,
      },
    });
    clearingAccountId = clearing.id;
    const liability = await prisma.chartOfAccount.create({
      data: {
        code: `DECL-LIA-${tag}`,
        name: `Declaration Liability ${tag}`,
        accountType: AccountType.LIABILITY,
      },
    });
    methodId = (
      await prisma.paymentMethod.create({
        data: {
          name: `Decl Method ${tag}`,
          accountId: clearing.id,
          requiresReconciliation: false,
        },
      })
    ).id;
    reconMethodId = (
      await prisma.paymentMethod.create({
        data: {
          name: `Decl Recon Method ${tag}`,
          accountId: clearing.id,
          requiresReconciliation: true,
        },
      })
    ).id;
    badMethodId = (
      await prisma.paymentMethod.create({
        data: { name: `Decl Bad Method ${tag}`, accountId: liability.id },
      })
    ).id;
    inactiveMethodId = (
      await prisma.paymentMethod.create({
        data: {
          name: `Decl Inactive ${tag}`,
          accountId: clearing.id,
          isActive: false,
        },
      })
    ).id;
  });

  afterAll(async () => {
    // Archive (never delete) this run's methods so master-data lists stay clean.
    if (prisma && methodId) {
      await prisma.paymentMethod.updateMany({
        where: {
          id: { in: [methodId, reconMethodId, badMethodId, inactiveMethodId] },
        },
        data: { deletedAt: new Date() },
      });
    }
    await moduleRef?.close();
  });

  async function makeOrder(
    opts: {
      paymentType?: StoreOrderPaymentType;
      fulfillmentMethod?: StoreOrderFulfillmentMethod;
      total?: number;
    } = {},
  ) {
    orderSeq += 1;
    const total = opts.total ?? 100;
    return prisma.storeOrder.create({
      data: {
        internalOrderId: `SO-DECL-${tag}-${orderSeq}`,
        partnerId,
        currencyId,
        paymentType: opts.paymentType ?? StoreOrderPaymentType.PREPAID,
        fulfillmentMethod:
          opts.fulfillmentMethod ?? StoreOrderFulfillmentMethod.SHIPPING,
        items: {
          create: [
            {
              productId,
              quantity: 1,
              unitPrice: total,
              agreedAmount: total,
            },
          ],
        },
      },
    });
  }

  function paid(
    kind: 'FULL' | 'PARTIAL',
    extra: Partial<PaymentDeclarationFieldsDto> = {},
  ): PaymentDeclarationFieldsDto {
    return {
      kind,
      paymentMethodId: methodId,
      currencyId,
      paymentDate,
      ...extra,
    };
  }

  it('FULL creates one pending claim for the validated total, no accounting, declared PAID', async () => {
    const order = await makeOrder();
    const result = await declarations.declare(
      order.id,
      paid('FULL', { amount: 1 }), // ignored for FULL
      randomUUID(),
      sales,
    );
    expect(result.created).toBe(true);
    expect(Number(result.payment!.amount)).toBe(100);
    expect(result.payment!.status).toBe(PaymentStatus.PENDING);
    expect(result.payment!.origin).toBe(PaymentOrigin.SALES_DECLARATION);
    expect(result.payment!.receivingAccountId).toBeNull();
    expect(result.payment!.paymentMethodId).toBe(methodId);
    expect(result.declaredPaymentStatus).toBe('PAID');
    const receipts = await prisma.paymentReceiptLink.count({
      where: { paymentId: result.payment!.id },
    });
    expect(receipts).toBe(0);
    const fresh = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(fresh.paymentStatus).toBe('PAYMENT_REVIEW');
    expect(fresh.paymentStatusId).not.toBeNull();
  });

  it('a repeated idempotency key returns the same claim; a concurrent double submit creates one', async () => {
    const order = await makeOrder();
    const key = randomUUID();
    const first = await declarations.declare(
      order.id,
      paid('FULL'),
      key,
      sales,
    );
    const again = await declarations.declare(
      order.id,
      paid('FULL'),
      key,
      sales,
    );
    expect(again.created).toBe(false);
    expect(again.payment!.id).toBe(first.payment!.id);

    const order2 = await makeOrder();
    const key2 = randomUUID();
    const results = await Promise.all([
      declarations.declare(order2.id, paid('FULL'), key2, sales),
      declarations.declare(order2.id, paid('FULL'), key2, sales),
    ]);
    expect(results[0].payment!.id).toBe(results[1].payment!.id);
    expect(
      await prisma.payment.count({ where: { storeOrderId: order2.id } }),
    ).toBe(1);
  });

  it('two different keys for FULL never exceed the total (second has nothing left)', async () => {
    const order = await makeOrder();
    await declarations.declare(order.id, paid('FULL'), randomUUID(), sales);
    await expect(
      declarations.declare(order.id, paid('FULL'), randomUUID(), sales),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('PARTIAL validates limits and never satisfies the prepaid gate', async () => {
    const order = await makeOrder();
    await expect(
      declarations.declare(
        order.id,
        paid('PARTIAL', { amount: 150 }),
        randomUUID(),
        sales,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      declarations.declare(
        order.id,
        paid('PARTIAL', { amount: 0 }),
        randomUUID(),
        sales,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    const partial = await declarations.declare(
      order.id,
      paid('PARTIAL', { amount: 40 }),
      randomUUID(),
      sales,
    );
    expect(partial.declaredPaymentStatus).toBe('PARTIALLY_PAID');
    expect((await storeOrders.canFulfill(order.id)).allowed).toBe(false);
    await expect(shipments.getOrCreateCurrent(order.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    const rest = await declarations.declare(
      order.id,
      paid('FULL'),
      randomUUID(),
      sales,
    );
    expect(Number(rest.payment!.amount)).toBe(60);
    expect(rest.declaredPaymentStatus).toBe('PAID');
  });

  it('rejects inactive method, future date, other currency, missing key', async () => {
    const order = await makeOrder();
    await expect(
      declarations.declare(
        order.id,
        paid('FULL', { paymentMethodId: inactiveMethodId }),
        randomUUID(),
        sales,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    const future = new Date(Date.now() + 5 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await expect(
      declarations.declare(
        order.id,
        paid('FULL', { paymentDate: future }),
        randomUUID(),
        sales,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    const other = await prisma.currency.findFirstOrThrow({
      where: { id: { not: currencyId }, deletedAt: null },
    });
    await expect(
      declarations.declare(
        order.id,
        paid('FULL', { currencyId: other.id }),
        randomUUID(),
        sales,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      declarations.declare(order.id, paid('FULL'), '', sales),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      await prisma.payment.count({ where: { storeOrderId: order.id } }),
    ).toBe(0);
  });

  it('UNPAID: allowed with no claims, 409 while claims stand', async () => {
    const order = await makeOrder();
    const unpaid = await declarations.declare(
      order.id,
      { kind: 'UNPAID' },
      randomUUID(),
      sales,
    );
    expect(unpaid.payment).toBeNull();
    expect(unpaid.declaredPaymentStatus).toBe('UNPAID');
    await declarations.declare(order.id, paid('FULL'), randomUUID(), sales);
    await expect(
      declarations.declare(order.id, { kind: 'UNPAID' }, randomUUID(), sales),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('full declared prepaid order can ship before Finance verification; COD unchanged; pickup label ban kept', async () => {
    const order = await makeOrder();
    await expect(shipments.getOrCreateCurrent(order.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await declarations.declare(order.id, paid('FULL'), randomUUID(), sales);
    const gate = await storeOrders.canFulfill(order.id);
    expect(gate).toMatchObject({ allowed: true, basis: 'DECLARED_PAID' });
    const { created } = await shipments.getOrCreateCurrent(order.id);
    expect(created).toBe(true);
    const fresh = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(fresh.paymentStatus).not.toBe('FULLY_PAID_RECONCILED');

    const cod = await makeOrder({
      paymentType: StoreOrderPaymentType.CASH_ON_DELIVERY,
    });
    expect((await shipments.getOrCreateCurrent(cod.id)).created).toBe(true);

    const pickup = await makeOrder({
      fulfillmentMethod: StoreOrderFulfillmentMethod.PICKUP,
    });
    await declarations.declare(pickup.id, paid('FULL'), randomUUID(), sales);
    await expect(
      shipments.getOrCreateCurrent(pickup.id),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('after fulfillment started, changing the declaration needs correction permission', async () => {
    const order = await makeOrder();
    await declarations.declare(
      order.id,
      paid('PARTIAL', { amount: 30 }),
      randomUUID(),
      sales,
    );
    await prisma.shipment.create({
      data: { storeOrderId: order.id, attemptNumber: 1 },
    });
    await expect(
      declarations.declare(order.id, paid('FULL'), randomUUID(), sales),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const corrected = await declarations.declare(
      order.id,
      paid('FULL'),
      randomUUID(),
      { ...sales, allowCorrection: true },
    );
    expect(corrected.declaredPaymentStatus).toBe('PAID');
  });

  it('declaring needs store-orders.edit or sales.receipts.create (any-of); origin follows confirm authority', async () => {
    const spy = jest.spyOn(permissions, 'hasPermission');
    spy.mockImplementation(() => Promise.resolve(false));
    await expect(declarations.resolveActor(userId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    spy.mockImplementation((_u, name) =>
      Promise.resolve(name === 'sales.receipts.create'),
    );
    await expect(declarations.resolveActor(userId)).resolves.toMatchObject({
      origin: PaymentOrigin.SALES_DECLARATION,
      allowCorrection: false,
    });
    spy.mockImplementation((_u, name) =>
      Promise.resolve(
        name === 'sales.receipts.create' || name === 'sales.receipts.confirm',
      ),
    );
    await expect(declarations.resolveActor(userId)).resolves.toMatchObject({
      origin: PaymentOrigin.FINANCE_DECLARATION,
      allowCorrection: true,
    });
    spy.mockRestore();
  });

  it('confirm debits the method account, freezes rate/date/source, links once; retries never repost', async () => {
    const order = await makeOrder();
    const { payment } = await declarations.declare(
      order.id,
      paid('FULL'),
      randomUUID(),
      sales,
    );
    const result = await payments.confirm(payment!.id, userId);
    expect(result.alreadyPosted).toBe(false);

    const receipt = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: result.receipt.id },
    });
    expect(receipt.debitAccountId).toBe(clearingAccountId);
    expect(receipt.receivingAccountId).toBeNull();
    expect(Number(receipt.exchangeRate)).toBe(50);
    expect(receipt.rateAsOf?.toISOString().slice(0, 10)).toBe(paymentDate);
    expect(receipt.rateSource).toBeTruthy();
    expect(Number(receipt.feeAmount)).toBe(0);

    const link = await prisma.paymentReceiptLink.findUniqueOrThrow({
      where: { paymentId: payment!.id },
    });
    expect(link.financialTransactionId).toBe(receipt.id);

    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: {
        sourceType: 'CUSTOMER_RECEIPT',
        sourceId: receipt.id,
        status: JournalEntryStatus.POSTED,
      },
      include: { lines: true },
    });
    expect(entry.entryDate.toISOString().slice(0, 10)).toBe(paymentDate);
    const debit = entry.lines.find((l) => l.accountId === clearingAccountId);
    expect(Number(debit?.debit)).toBe(5000);

    const claim = await prisma.payment.findUniqueOrThrow({
      where: { id: payment!.id },
    });
    expect(claim.status).toBe(PaymentStatus.VERIFIED);
    // FIX-QA OBS2 — a NON-reconciled method has no provider statement and no
    // settlement workspace: never stranded as AWAITING_SETTLEMENT.
    expect(claim.settlementStatus).toBe('NOT_APPLICABLE');

    const again = await payments.confirm(payment!.id, userId);
    expect(again.alreadyPosted).toBe(true);
    expect(again.receipt.id).toBe(receipt.id);
    expect(
      await prisma.journalEntry.count({
        where: { sourceType: 'CUSTOMER_RECEIPT', sourceId: receipt.id },
      }),
    ).toBe(1);
    expect(
      await prisma.financialTransaction.count({
        where: { paymentReceiptLink: { paymentId: payment!.id } },
      }),
    ).toBe(1);
  });

  it('concurrent confirms create exactly one receipt', async () => {
    const order = await makeOrder();
    const { payment } = await declarations.declare(
      order.id,
      paid('FULL'),
      randomUUID(),
      sales,
    );
    const results = await Promise.allSettled([
      payments.confirm(payment!.id, userId),
      payments.confirm(payment!.id, userId),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.financialTransaction.count({
        where: {
          type: 'CUSTOMER_RECEIPT',
          notes: `STORE_ORDER_PAYMENT:${payment!.id}`,
        },
      }),
    ).toBe(1);
  });

  it('an unsuitable method account is a 422 and changes nothing', async () => {
    const order = await makeOrder();
    const { payment } = await declarations.declare(
      order.id,
      paid('FULL', { paymentMethodId: badMethodId }),
      randomUUID(),
      sales,
    );
    await expect(payments.confirm(payment!.id, userId)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    const claim = await prisma.payment.findUniqueOrThrow({
      where: { id: payment!.id },
    });
    expect(claim.status).toBe(PaymentStatus.PENDING);
    expect(
      await prisma.paymentReceiptLink.count({
        where: { paymentId: payment!.id },
      }),
    ).toBe(0);
  });

  it('dispute after shipment flags a discrepancy and never touches the shipment', async () => {
    const order = await makeOrder();
    const { payment } = await declarations.declare(
      order.id,
      paid('FULL'),
      randomUUID(),
      sales,
    );
    const { shipment } = await shipments.getOrCreateCurrent(order.id);
    const disputed = await payments.dispute(
      payment!.id,
      userId,
      'Not on provider statement',
    );
    expect(disputed.status).toBe(PaymentStatus.DISPUTED);
    const fresh = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(fresh.paymentDiscrepancy).toBe(true);
    expect(fresh.paymentDiscrepancyReason).toContain(
      'Not on provider statement',
    );
    expect(fresh.declaredPaymentStatus).toBe('UNPAID');
    const stillThere = await prisma.shipment.findUniqueOrThrow({
      where: { id: shipment.id },
    });
    expect(stillThere.deletedAt).toBeNull();
    await expect(payments.confirm(payment!.id, userId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('reject before fulfillment recomputes declared status without a discrepancy', async () => {
    const order = await makeOrder();
    const { payment } = await declarations.declare(
      order.id,
      paid('FULL'),
      randomUUID(),
      sales,
    );
    await payments.reject(payment!.id, {
      rejectionReason: 'Duplicate',
      rejectedById: userId,
    });
    const fresh = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(fresh.paymentDiscrepancy).toBe(false);
    expect(fresh.declaredPaymentStatus).toBe('UNPAID');
  });
  // ------------------------------------------------------------ FIX-PDR

  it('M1: a reconciliation-enabled claim cannot be confirmed from payment review; the matching path (statementLineId) can', async () => {
    const order = await makeOrder();
    const { payment } = await declarations.declare(
      order.id,
      paid('FULL', { paymentMethodId: reconMethodId }),
      randomUUID(),
      sales,
    );
    await expect(payments.confirm(payment!.id, userId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(payments.confirm(payment!.id, userId)).rejects.toThrow(
      /Payment reconciliation/,
    );
    expect(
      await prisma.paymentReceiptLink.count({
        where: { paymentId: payment!.id },
      }),
    ).toBe(0);
    const viaMatching = await prisma.$transaction((tx) =>
      payments.confirmInTx(tx, payment!.id, userId, {
        statementLineId: 'spec-line',
      }),
    );
    expect(viaMatching.alreadyPosted).toBe(false);
    // FIX-QA OBS2 — a reconciled method's posted claim awaits settlement.
    const matched = await prisma.payment.findUniqueOrThrow({
      where: { id: payment!.id },
    });
    expect(matched.settlementStatus).toBe('AWAITING_SETTLEMENT');
  });

  it('M2: lowering the total below standing claims is refused; raising it reopens the prepaid gate without creating claims', async () => {
    const order = await makeOrder();
    const item = await prisma.storeOrderItem.findFirstOrThrow({
      where: { storeOrderId: order.id },
    });
    await declarations.declare(
      order.id,
      paid('PARTIAL', { amount: 60 }),
      randomUUID(),
      sales,
    );
    await expect(
      storeOrders.setLineAmounts(order.id, {
        items: [{ itemId: item.id, agreedAmount: 50 }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      Number(
        (
          await prisma.storeOrderItem.findUniqueOrThrow({
            where: { id: item.id },
          })
        ).agreedAmount,
      ),
    ).toBe(100);

    // Lowering to exactly the declared amount turns PARTIAL into PAID.
    await storeOrders.setLineAmounts(order.id, {
      items: [{ itemId: item.id, agreedAmount: 60 }],
    });
    let fresh = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(fresh.declaredPaymentStatus).toBe('PAID');
    expect((await storeOrders.canFulfill(order.id)).allowed).toBe(true);

    // Raising it: PAID → PARTIALLY_PAID, gate closes, no claim is created.
    await storeOrders.setLineAmounts(order.id, {
      items: [{ itemId: item.id, agreedAmount: 120 }],
    });
    fresh = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(fresh.declaredPaymentStatus).toBe('PARTIALLY_PAID');
    expect(Number(fresh.declaredAmount)).toBe(60);
    expect((await storeOrders.canFulfill(order.id)).allowed).toBe(false);
    expect(
      await prisma.payment.count({ where: { storeOrderId: order.id } }),
    ).toBe(1);
  });

  it('L7: prepaid pickup needs the payment gate before READY_FOR_PICKUP; COD does not', async () => {
    const pickup = await makeOrder({
      fulfillmentMethod: StoreOrderFulfillmentMethod.PICKUP,
    });
    await expect(
      storeOrders.transitionPickup(pickup.id, 'READY_FOR_PICKUP'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await declarations.declare(
      pickup.id,
      paid('PARTIAL', { amount: 10 }),
      randomUUID(),
      sales,
    );
    await expect(
      storeOrders.transitionPickup(pickup.id, 'READY_FOR_PICKUP'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await declarations.declare(pickup.id, paid('FULL'), randomUUID(), sales);
    const ready = await storeOrders.transitionPickup(
      pickup.id,
      'READY_FOR_PICKUP',
    );
    expect(ready.fulfillmentStatus?.code).toBe('READY_FOR_PICKUP');

    const cod = await makeOrder({
      paymentType: StoreOrderPaymentType.CASH_ON_DELIVERY,
      fulfillmentMethod: StoreOrderFulfillmentMethod.PICKUP,
    });
    const codReady = await storeOrders.transitionPickup(
      cod.id,
      'READY_FOR_PICKUP',
    );
    expect(codReady.fulfillmentStatus?.code).toBe('READY_FOR_PICKUP');
  });

  it('L8: after fulfillment started or a claim was verified, ANY new declaration needs correction permission', async () => {
    // Fulfillment started, declared status unchanged (PARTIAL → PARTIAL).
    const shipped = await makeOrder();
    await declarations.declare(
      shipped.id,
      paid('PARTIAL', { amount: 20 }),
      randomUUID(),
      sales,
    );
    await prisma.shipment.create({
      data: { storeOrderId: shipped.id, attemptNumber: 1 },
    });
    await expect(
      declarations.declare(
        shipped.id,
        paid('PARTIAL', { amount: 10 }),
        randomUUID(),
        sales,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const corrected = await declarations.declare(
      shipped.id,
      paid('PARTIAL', { amount: 10 }),
      randomUUID(),
      { ...sales, allowCorrection: true },
    );
    expect(corrected.created).toBe(true);

    // A VERIFIED claim, no shipment: another partial declaration is a correction too.
    const verified = await makeOrder();
    const first = await declarations.declare(
      verified.id,
      paid('PARTIAL', { amount: 30 }),
      randomUUID(),
      sales,
    );
    await payments.confirm(first.payment!.id, userId);
    await expect(
      declarations.declare(
        verified.id,
        paid('PARTIAL', { amount: 10 }),
        randomUUID(),
        sales,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // An untouched order still takes plain Sales declarations.
    const fresh = await makeOrder();
    await declarations.declare(
      fresh.id,
      paid('PARTIAL', { amount: 10 }),
      randomUUID(),
      sales,
    );
    await expect(
      declarations.declare(
        fresh.id,
        paid('PARTIAL', { amount: 10 }),
        randomUUID(),
        sales,
      ),
    ).resolves.toMatchObject({ created: true });
  });
});
