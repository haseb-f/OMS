import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import {
  AccountType,
  FinancialTransactionStatus,
  FinancialTransactionType,
  JournalEntryStatus,
  PaymentSettlementDocStatus,
  PaymentSettlementStatus,
  PaymentStatus,
  PaymentStatementSourceType,
  PaymentOrigin,
  Prisma,
} from '@prisma/client';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { AuthModule } from '../auth/auth.module';
import { ExchangeRatesService } from '../accounting/fx/exchange-rates.service';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { PaymentSettlementsModule } from './payment-settlements.module';
import { PaymentSettlementsService } from './payment-settlements.service';
import { PaymentSettlementsController } from './payment-settlements.controller';

/**
 * Batch provider settlement against the real local Postgres. Each scenario
 * gets its own payment method + clearing account so GL balances are exact.
 * Claims are minimal fixtures matching the IMPL-DECL contract: VERIFIED
 * payment with a PaymentReceiptLink to a CONFIRMED CUSTOMER_RECEIPT whose
 * exchangeRate is frozen and whose POSTED JE debits the method clearing account.
 */
describe('PaymentSettlementsService (integration)', () => {
  jest.setTimeout(180_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: PaymentSettlementsService;

  const tag = randomUUID().slice(0, 6).toUpperCase();
  let seq = 0;
  const SETTLE_DATE = '2026-09-15';
  const RECEIPT_DATE = new Date('2026-09-10T00:00:00.000Z');

  let functionalId: string;
  let foreignId: string;
  let paymentSourceId: string;
  let counterAccountId: string;
  let bankReceivingId: string;
  let bankAccountId: string;
  let commissionAccountId: string;
  let fxAccountId: string;
  const cleanup: Array<() => Promise<unknown>> = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        AuthModule,
        PaymentSettlementsModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(PaymentSettlementsService);

    functionalId = await moduleRef
      .get(ExchangeRatesService)
      .requireFunctionalCurrencyId();
    const settings = await prisma.postingSettings.findFirstOrThrow();
    if (
      !settings.paymentGatewayFeeAccountId ||
      !settings.exchangeDifferenceAccountId
    ) {
      throw new Error(
        'Local PostingSettings must map paymentGatewayFee and exchangeDifference accounts.',
      );
    }
    commissionAccountId = settings.paymentGatewayFeeAccountId;
    fxAccountId = settings.exchangeDifferenceAccountId;

    const foreign = await prisma.currency.create({
      data: { code: `S${tag}`, name: `Settlement FX ${tag}` },
    });
    foreignId = foreign.id;
    await prisma.exchangeRate.create({
      data: {
        fromCurrencyId: foreignId,
        toCurrencyId: functionalId,
        rate: 13.2,
        effectiveDate: new Date(`${SETTLE_DATE}T00:00:00.000Z`),
        source: 'MANUAL',
      },
    });

    const source = await prisma.paymentSource.findFirst({
      where: { isActive: true, deletedAt: null },
    });
    if (!source) throw new Error('Expected a seeded active PaymentSource.');
    paymentSourceId = source.id;

    counterAccountId = (
      await prisma.chartOfAccount.create({
        data: {
          code: `STL-CTR-${tag}`,
          name: `Settlement test counter ${tag}`,
          accountType: AccountType.ASSET,
        },
      })
    ).id;
    bankAccountId = (
      await prisma.chartOfAccount.create({
        data: {
          code: `STL-BANK-${tag}`,
          name: `Settlement test bank ${tag}`,
          accountType: AccountType.ASSET,
        },
      })
    ).id;
    bankReceivingId = (
      await prisma.receivingAccount.create({
        data: {
          name: `Settlement bank ${tag}`,
          code: `STL-RA-${tag}`,
          chartOfAccountId: bankAccountId,
        },
      })
    ).id;
  });

  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
    await moduleRef?.close();
  });

  // --- fixtures ---------------------------------------------------------------

  async function setupMethod() {
    seq += 1;
    const clearing = await prisma.chartOfAccount.create({
      data: {
        code: `STL-CLR-${tag}-${seq}`,
        name: `Provider clearing ${tag}-${seq}`,
        accountType: AccountType.ASSET,
      },
    });
    const method = await prisma.paymentMethod.create({
      data: {
        name: `Provider ${tag}-${seq}`,
        accountId: clearing.id,
        requiresReconciliation: true,
      },
    });
    return { methodId: method.id, clearingAccountId: clearing.id };
  }

  async function makeClaim(
    methodId: string,
    clearingAccountId: string,
    amount: number,
    currencyId: string,
    rate: number,
  ) {
    seq += 1;
    const n = `${tag}-${seq}`;
    const payment = await prisma.payment.create({
      data: {
        paymentNumber: `PAY-STL-${n}`,
        paymentDate: RECEIPT_DATE,
        amount,
        currencyId,
        paymentSourceId,
        paymentMethodId: methodId,
        senderName: `Customer ${n}`,
        status: PaymentStatus.VERIFIED,
        origin: PaymentOrigin.SALES_DECLARATION,
        settlementStatus: PaymentSettlementStatus.AWAITING_SETTLEMENT,
      },
    });
    const receipt = await prisma.financialTransaction.create({
      data: {
        transactionNumber: `CR-STL-${n}`,
        type: FinancialTransactionType.CUSTOMER_RECEIPT,
        currencyId,
        exchangeRate: rate,
        rateAsOf: RECEIPT_DATE,
        rateSource: 'MANUAL',
        amount,
        debitAccountId: clearingAccountId,
        transactionDate: RECEIPT_DATE,
        status: FinancialTransactionStatus.CONFIRMED,
        postedToAccounting: true,
      },
    });
    await prisma.paymentReceiptLink.create({
      data: { paymentId: payment.id, financialTransactionId: receipt.id },
    });
    const functional = Math.round(amount * rate * 100) / 100;
    await prisma.journalEntry.create({
      data: {
        entryNumber: `JV-STL-${n}`,
        entryDate: RECEIPT_DATE,
        status: JournalEntryStatus.POSTED,
        postedAt: new Date(),
        sourceType: 'CUSTOMER_RECEIPT',
        sourceId: receipt.id,
        description: 'Settlement test receipt',
        totalDebit: functional,
        totalCredit: functional,
        lines: {
          create: [
            {
              accountId: clearingAccountId,
              debit: functional,
              credit: 0,
              lineOrder: 0,
            },
            {
              accountId: counterAccountId,
              debit: 0,
              credit: functional,
              lineOrder: 1,
            },
          ],
        },
      },
    });
    return payment.id;
  }

  async function makeClaims(
    count: number,
    amount: number,
    currencyId: string,
    rate: number,
  ) {
    const { methodId, clearingAccountId } = await setupMethod();
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      ids.push(
        await makeClaim(methodId, clearingAccountId, amount, currencyId, rate),
      );
    }
    return { methodId, clearingAccountId, ids };
  }

  function input(
    methodId: string,
    ids: string[],
    extra: Partial<Parameters<PaymentSettlementsService['preview']>[0]> = {},
  ) {
    return {
      paymentMethodId: methodId,
      claims: ids.map((paymentId) => ({ paymentId })),
      receivedAmount: 0,
      receivedCurrencyId: functionalId,
      receivingAccountId: bankReceivingId,
      settlementDate: SETTLE_DATE,
      providerReference: `PAYOUT-${tag}`,
      ...extra,
    };
  }

  async function journalFor(settlementId: string) {
    return prisma.journalEntry.findMany({
      where: { sourceType: 'PAYMENT_SETTLEMENT', sourceId: settlementId },
      include: { lines: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  function lineOf(
    entry: {
      lines: Array<{
        accountId: string;
        debit: Prisma.Decimal;
        credit: Prisma.Decimal;
      }>;
    },
    accountId: string,
  ) {
    const line = entry.lines.find((l) => l.accountId === accountId);
    return line
      ? { debit: Number(line.debit), credit: Number(line.credit) }
      : null;
  }

  async function expectCode(promise: Promise<unknown>, code: string) {
    let caught: unknown = null;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeTruthy();
    const response =
      caught instanceof BadRequestException ||
      (caught as { getResponse?: unknown })?.getResponse
        ? (caught as BadRequestException).getResponse()
        : caught;
    expect((response as { code?: string }).code).toBe(code);
  }

  async function balance(methodId: string) {
    return (await service.providerBalances(methodId)) as {
      glBalance: string;
      unsettledCarrying: string;
      difference: string;
    };
  }

  // --- scenarios ----------------------------------------------------------------

  it('same currency (claim = functional): 10 × 500 received 4,500 → fee 500, one balanced JE, clearing reconciles before/after', async () => {
    const { methodId, clearingAccountId, ids } = await makeClaims(
      10,
      500,
      functionalId,
      1,
    );

    expect(await balance(methodId)).toMatchObject({
      glBalance: '5000.00',
      unsettledCarrying: '5000.00',
      difference: '0.00',
    });

    const dto = input(methodId, ids, { receivedAmount: 4500 });
    const preview = await service.preview(dto);
    expect(preview).toMatchObject({
      grossAmount: '5000.00',
      receivedAmount: '4500.00',
      feeAmount: '500.00',
      fxDifference: '0.00',
      totalDebit: '5000.00',
      totalCredit: '5000.00',
    });

    const created = await service.create(
      { ...dto, idempotencyKey: `k-${tag}-same` },
      undefined,
    );
    expect(created.replayed).toBe(false);
    expect(created.settlementNumber).toMatch(/^PST-/);
    expect(created.feeAmount).toBe('500.00');

    const [entry, ...others] = await journalFor(created.id);
    expect(others).toHaveLength(0);
    expect(entry.status).toBe(JournalEntryStatus.POSTED);
    expect(entry.entryDate.toISOString().slice(0, 10)).toBe(SETTLE_DATE);
    expect(lineOf(entry, bankAccountId)).toEqual({ debit: 4500, credit: 0 });
    expect(lineOf(entry, commissionAccountId)).toEqual({
      debit: 500,
      credit: 0,
    });
    expect(lineOf(entry, clearingAccountId)).toEqual({
      debit: 0,
      credit: 5000,
    });
    expect(lineOf(entry, fxAccountId)).toBeNull();
    // Confirm recomputed server-side and posted exactly the previewed lines.
    expect(
      preview.journalLines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
      })),
    ).toEqual(
      entry.lines
        .sort((a, b) => a.lineOrder - b.lineOrder)
        .map((l) => ({
          accountId: l.accountId,
          debit: Number(l.debit),
          credit: Number(l.credit),
        })),
    );

    const payments = await prisma.payment.findMany({
      where: { id: { in: ids } },
    });
    for (const p of payments) {
      expect(p.settlementStatus).toBe(PaymentSettlementStatus.SETTLED);
      expect(Number(p.settledAmount)).toBe(500);
    }
    expect(created.lines).toHaveLength(10);
    expect(created.journalEntry?.id).toBe(entry.id);

    expect(await balance(methodId)).toMatchObject({
      glBalance: '0.00',
      unsettledCarrying: '0.00',
      difference: '0.00',
    });

    // Fully settled claims are no longer eligible.
    await expectCode(service.preview(dto), 'CLAIM_ALREADY_SETTLED');
  });

  it('foreign claim currency: clearing released at receipt rates, bank/commission at settlement rate, FX difference on its own line', async () => {
    const { methodId, clearingAccountId, ids } = await makeClaims(
      10,
      500,
      foreignId,
      13,
    );
    const created = await service.create(
      {
        ...input(methodId, ids, {
          receivedAmount: 4500,
          receivedCurrencyId: foreignId,
        }),
        idempotencyKey: `k-${tag}-fx`,
      },
      undefined,
    );
    expect(created.feeAmount).toBe('500.00');
    expect(created.fxDifference).toBe('-1000.00');
    const [entry] = await journalFor(created.id);
    expect(Number(entry.exchangeRate)).toBe(13.2);
    expect(lineOf(entry, bankAccountId)).toEqual({ debit: 59400, credit: 0 });
    expect(lineOf(entry, commissionAccountId)).toEqual({
      debit: 6600,
      credit: 0,
    });
    expect(lineOf(entry, fxAccountId)).toEqual({ debit: 0, credit: 1000 });
    expect(lineOf(entry, clearingAccountId)).toEqual({
      debit: 0,
      credit: 65000,
    });
    expect(Number(entry.totalDebit)).toBe(Number(entry.totalCredit));

    const basis = created.conversionBasis as {
      claimRate: { rate: string; source: string; effectiveDate: string };
      feeBasis: string;
    };
    expect(basis.claimRate.rate).toBe('13.2');
    expect(basis.claimRate.effectiveDate).toBe(SETTLE_DATE);
    expect(basis.claimRate.source).toBeTruthy();
    expect(basis.feeBasis).toBe('GROSS_MINUS_RECEIVED');

    // A later rate change never rewrites the posted settlement.
    await prisma.exchangeRate.updateMany({
      where: { fromCurrencyId: foreignId, toCurrencyId: functionalId },
      data: { rate: 14 },
    });
    const again = await service.findOne(created.id);
    expect(
      again.journalEntry?.lines.find((l) => l.account.id === bankAccountId)
        ?.debit,
    ).toBe('59400.00');
    await prisma.exchangeRate.updateMany({
      where: { fromCurrencyId: foreignId, toCurrencyId: functionalId },
      data: { rate: 13.2 },
    });
    expect(await balance(methodId)).toMatchObject({
      difference: '0.00',
      glBalance: '0.00',
    });
  });

  it('cross-currency requires an explicit fee (or matched statement fees) and never subtracts unlike currencies', async () => {
    const { methodId, clearingAccountId, ids } = await makeClaims(
      10,
      500,
      foreignId,
      13,
    );
    const base = input(methodId, ids, {
      receivedAmount: 58000,
      receivedCurrencyId: functionalId,
    });
    await expectCode(service.preview(base), 'FEE_REQUIRED');

    // Matched statement lines carry the provider fee → used as the default basis.
    const line = await prisma.paymentStatementLine.create({
      data: {
        paymentMethodId: methodId,
        sourceType: PaymentStatementSourceType.MANUAL,
        dedupeKey: `ref:STL-${tag}`,
        amount: 5000,
        currencyId: foreignId,
        transactionDate: RECEIPT_DATE,
        feeAmount: 500,
        netAmount: 4500,
        status: 'MATCHED',
        matchedAmount: 5000,
      },
    });
    await prisma.paymentMatch.createMany({
      data: ids.map((paymentId) => ({
        statementLineId: line.id,
        paymentId,
        amount: 500,
      })),
    });
    const suggested = await service.preview(base);
    expect(suggested.feeBasis).toBe('STATEMENT_FEES');
    expect(suggested.feeAmount).toBe('500.00');

    const created = await service.create(
      { ...base, feeAmount: 500, idempotencyKey: `k-${tag}-cross` },
      undefined,
    );
    const [entry] = await journalFor(created.id);
    expect(lineOf(entry, bankAccountId)).toEqual({ debit: 58000, credit: 0 });
    expect(lineOf(entry, commissionAccountId)).toEqual({
      debit: 6600,
      credit: 0,
    });
    expect(lineOf(entry, fxAccountId)).toEqual({ debit: 400, credit: 0 });
    expect(lineOf(entry, clearingAccountId)).toEqual({
      debit: 0,
      credit: 65000,
    });
    expect((created.conversionBasis as { feeBasis: string }).feeBasis).toBe(
      'ENTERED',
    );
  });

  it('refuses an over-receipt and saves nothing', async () => {
    const { methodId, ids } = await makeClaims(2, 500, functionalId, 1);
    const dto = input(methodId, ids, { receivedAmount: 1000.01 });
    await expectCode(service.preview(dto), 'OVER_RECEIPT');
    await expectCode(
      service.create({ ...dto, idempotencyKey: `k-${tag}-over` }, undefined),
      'OVER_RECEIPT',
    );
    expect(
      await prisma.paymentSettlement.count({
        where: { paymentMethodId: methodId },
      }),
    ).toBe(0);
  });

  it('explicit partial settlement per claim never marks the unpaid remainder settled; reversal is latest-first and restores amounts', async () => {
    const { methodId, clearingAccountId, ids } = await makeClaims(
      2,
      500,
      functionalId,
      1,
    );
    const [a, b] = ids;
    const first = await service.create(
      {
        ...input(methodId, ids, { receivedAmount: 650 }),
        claims: [{ paymentId: a, amount: 200 }, { paymentId: b }],
        idempotencyKey: `k-${tag}-part1`,
      },
      undefined,
    );
    expect(first.grossAmount).toBe('700.00');
    let pa = await prisma.payment.findUniqueOrThrow({ where: { id: a } });
    let pb = await prisma.payment.findUniqueOrThrow({ where: { id: b } });
    expect(pa.settlementStatus).toBe(PaymentSettlementStatus.PARTIALLY_SETTLED);
    expect(Number(pa.settledAmount)).toBe(200);
    expect(pb.settlementStatus).toBe(PaymentSettlementStatus.SETTLED);
    expect(await balance(methodId)).toMatchObject({
      glBalance: '300.00',
      unsettledCarrying: '300.00',
      difference: '0.00',
    });

    await expectCode(
      service.preview({
        ...input(methodId, [a], { receivedAmount: 300 }),
        claims: [{ paymentId: a, amount: 300.01 }],
      }),
      'SETTLE_AMOUNT_EXCEEDS_REMAINING',
    );

    const second = await service.create(
      {
        ...input(methodId, [a], { receivedAmount: 290 }),
        idempotencyKey: `k-${tag}-part2`,
      },
      undefined,
    );
    pa = await prisma.payment.findUniqueOrThrow({ where: { id: a } });
    expect(pa.settlementStatus).toBe(PaymentSettlementStatus.SETTLED);
    expect(second.lines[0].amount).toBe('300.00');

    await expectCode(
      service.reverse(first.id, 'wrong payout', undefined),
      'SETTLEMENT_HAS_LATER_SETTLEMENTS',
    );

    const reversedSecond = await service.reverse(
      second.id,
      'bank bounced',
      undefined,
    );
    expect(reversedSecond.status).toBe(PaymentSettlementDocStatus.REVERSED);
    expect(reversedSecond.reversalJournalEntry).not.toBeNull();
    pa = await prisma.payment.findUniqueOrThrow({ where: { id: a } });
    expect(pa.settlementStatus).toBe(PaymentSettlementStatus.PARTIALLY_SETTLED);
    expect(Number(pa.settledAmount)).toBe(200);

    await service.reverse(first.id, 'wrong payout', undefined);
    pa = await prisma.payment.findUniqueOrThrow({ where: { id: a } });
    pb = await prisma.payment.findUniqueOrThrow({ where: { id: b } });
    expect(pa.settlementStatus).toBe(
      PaymentSettlementStatus.AWAITING_SETTLEMENT,
    );
    expect(Number(pa.settledAmount)).toBe(0);
    expect(pb.settlementStatus).toBe(
      PaymentSettlementStatus.AWAITING_SETTLEMENT,
    );
    expect(Number(pb.settledAmount)).toBe(0);

    const [original] = await journalFor(first.id);
    expect(original.status).toBe(JournalEntryStatus.REVERSED);
    expect(await balance(methodId)).toMatchObject({
      glBalance: '1000.00',
      unsettledCarrying: '1000.00',
      difference: '0.00',
    });
    await expectCode(
      service.reverse(first.id, 'again', undefined),
      'SETTLEMENT_NOT_POSTED',
    );
    expect(clearingAccountId).toBeTruthy();
  });

  it('double submit with the same idempotency key creates exactly one settlement and one JE', async () => {
    const { methodId, ids } = await makeClaims(3, 100, functionalId, 1);
    const dto = {
      ...input(methodId, ids, { receivedAmount: 290 }),
      idempotencyKey: `k-${tag}-dup`,
    };
    const [r1, r2] = await Promise.all([
      service.create(dto, undefined),
      service.create(dto, undefined),
    ]);
    expect(r1.id).toBe(r2.id);
    expect([r1.replayed, r2.replayed].filter(Boolean)).toHaveLength(1);
    const r3 = await service.create(dto, undefined);
    expect(r3.id).toBe(r1.id);
    expect(r3.replayed).toBe(true);
    expect(
      await prisma.paymentSettlement.count({
        where: { paymentMethodId: methodId },
      }),
    ).toBe(1);
    expect(await journalFor(r1.id)).toHaveLength(1);
  });

  it('concurrent settlements with different keys over the same claims: one succeeds, the other fails cleanly (no over-settlement)', async () => {
    const { methodId, ids } = await makeClaims(3, 100, functionalId, 1);
    const claims = ids.map((paymentId) => ({ paymentId, amount: 100 }));
    const results = await Promise.allSettled([
      service.create(
        {
          ...input(methodId, ids, { receivedAmount: 290 }),
          claims,
          idempotencyKey: `k-${tag}-c1`,
        },
        undefined,
      ),
      service.create(
        {
          ...input(methodId, ids, { receivedAmount: 290 }),
          claims,
          idempotencyKey: `k-${tag}-c2`,
        },
        undefined,
      ),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    const payments = await prisma.payment.findMany({
      where: { id: { in: ids } },
    });
    for (const p of payments) expect(Number(p.settledAmount)).toBe(100);
    expect(
      await prisma.paymentSettlement.count({
        where: { paymentMethodId: methodId },
      }),
    ).toBe(1);
  });

  it('refuses claims whose receipt did not debit the method clearing account', async () => {
    const { methodId, ids } = await makeClaims(1, 100, functionalId, 1);
    const other = await prisma.chartOfAccount.create({
      data: {
        code: `STL-OTH-${tag}`,
        name: 'Other',
        accountType: AccountType.ASSET,
      },
    });
    const link = await prisma.paymentReceiptLink.findUniqueOrThrow({
      where: { paymentId: ids[0] },
    });
    await prisma.financialTransaction.update({
      where: { id: link.financialTransactionId },
      data: { debitAccountId: other.id },
    });
    await expectCode(
      service.preview(input(methodId, ids, { receivedAmount: 90 })),
      'CLEARING_ACCOUNT_MISMATCH',
    );
  });

  it('fails with an actionable error when the commission account is not configured', async () => {
    const { methodId, ids } = await makeClaims(1, 100, functionalId, 1);
    const original = prisma.postingSettings.findFirst.bind(
      prisma.postingSettings,
    );
    const spy = jest
      .spyOn(prisma.postingSettings, 'findFirst')
      .mockImplementation(((args?: Prisma.PostingSettingsFindFirstArgs) => {
        if (args?.select && 'paymentGatewayFeeAccountId' in args.select) {
          return Promise.resolve({
            paymentGatewayFeeAccountId: null,
            exchangeDifferenceAccountId: null,
          });
        }
        return original(args);
      }) as unknown as typeof prisma.postingSettings.findFirst);
    try {
      await expectCode(
        service.preview(input(methodId, ids, { receivedAmount: 90 })),
        'COMMISSION_ACCOUNT_NOT_CONFIGURED',
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('L1: refuses a settlement dated in the future (Cairo today + small tolerance)', async () => {
    const { methodId, ids } = await makeClaims(1, 100, functionalId, 1);
    const future = new Date(Date.now() + 3 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await expectCode(
      service.preview(
        input(methodId, ids, { receivedAmount: 90, settlementDate: future }),
      ),
      'SETTLEMENT_DATE_IN_FUTURE',
    );
  });

  it('fails clearly when the settlement date is in a closed accounting period', async () => {
    const { methodId, ids } = await makeClaims(1, 100, functionalId, 1);
    // The fixture receipt dates are 2026; a 1990 settlement would also trip
    // SETTLEMENT_BEFORE_RECEIPT, so clear the rate date for this claim only.
    const link = await prisma.paymentReceiptLink.findUniqueOrThrow({
      where: { paymentId: ids[0] },
    });
    await prisma.financialTransaction.update({
      where: { id: link.financialTransactionId },
      data: { rateAsOf: null },
    });
    const year = await prisma.fiscalYear.create({
      data: {
        name: `STL-1990-${tag}`,
        startDate: new Date('1990-01-01T00:00:00.000Z'),
        endDate: new Date('1990-12-31T00:00:00.000Z'),
      },
    });
    const period = await prisma.accountingPeriod.create({
      data: {
        name: `STL-Jun-1990-${tag}`,
        startDate: new Date('1990-06-01T00:00:00.000Z'),
        endDate: new Date('1990-06-30T00:00:00.000Z'),
        status: 'CLOSED',
        fiscalYearId: year.id,
      },
    });
    cleanup.push(() => prisma.fiscalYear.delete({ where: { id: year.id } }));
    cleanup.push(() =>
      prisma.accountingPeriod.delete({ where: { id: period.id } }),
    );
    await expectCode(
      service.preview(
        input(methodId, ids, {
          receivedAmount: 90,
          settlementDate: '1990-06-15',
        }),
      ),
      'PERIOD_CLOSED',
    );
  });

  it('enforces view / settle / correct permissions on the controller', async () => {
    const resolver = {
      isSuperAdmin: jest.fn().mockResolvedValue(false),
      hasPermission: jest.fn((_user: string, name: string) =>
        Promise.resolve(name === 'finance.payment-reconciliation.view'),
      ),
    };
    const guard = new PermissionsGuard(
      new Reflector(),
      resolver as unknown as PermissionsResolverService,
    );
    const context = (
      name: keyof PaymentSettlementsController,
      method: string,
    ) =>
      ({
        getHandler: (): unknown =>
          Reflect.get(PaymentSettlementsController.prototype, name),
        getClass: () => PaymentSettlementsController,
        switchToHttp: () => ({
          getRequest: () => ({ method, user: { sub: 'viewer' } }),
        }),
      }) as unknown as ExecutionContext;

    await expect(guard.canActivate(context('eligible', 'GET'))).resolves.toBe(
      true,
    );
    await expect(guard.canActivate(context('findAll', 'GET'))).resolves.toBe(
      true,
    );
    await expect(guard.canActivate(context('create', 'POST'))).rejects.toThrow(
      new ForbiddenException(
        'Missing permission "finance.payment-reconciliation.settle".',
      ),
    );
    await expect(guard.canActivate(context('preview', 'POST'))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(guard.canActivate(context('reverse', 'POST'))).rejects.toThrow(
      new ForbiddenException(
        'Missing permission "finance.payment-reconciliation.correct".',
      ),
    );
  });
});
