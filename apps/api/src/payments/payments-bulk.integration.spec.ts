import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import {
  AccountType,
  PartnerRoleType,
  PaymentOrigin,
  PaymentSettlementStatus,
  PaymentStatementSourceType,
  PaymentStatus,
  StoreOrderPaymentType,
} from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { PostingProvidersModule } from '../accounting/posting-providers/posting-providers.module';
import { FxModule } from '../accounting/fx/fx.module';
import { ExchangeRatesService } from '../accounting/fx/exchange-rates.service';
import { GoogleSheetsService } from '../import-center/google-sheets.service';
import { PaymentReconciliationModule } from '../payment-reconciliation/payment-reconciliation.module';
import { PaymentStatementsService } from '../payment-reconciliation/payment-statements.service';
import { PaymentMatchingService } from '../payment-reconciliation/payment-matching.service';
import { PaymentReconciliationService } from '../payment-reconciliation/payment-reconciliation.service';
import { PaymentBulkAcceptService } from '../payment-reconciliation/payment-bulk-accept.service';
import type { StatementMappingConfig } from '../payment-reconciliation/statement-row.util';
import { PaymentsService } from './payments.service';
import { PaymentsBulkService } from './payments-bulk.service';
import { PaymentReviewService } from './payment-review.service';

/**
 * Round 5 spec 3C — bulk Confirm & Post, bulk reject and "Accept strong
 * suggestions". Every item must go through the existing single-record
 * service: partial failures are reported per item, duplicates run once,
 * posted/settled records are refused, currency rules are the existing ones.
 * Real local Postgres, self-created tagged fixtures.
 */
const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(
  process.env.DATABASE_URL ?? '',
);
const describeDb = LOCAL_DB ? describe : describe.skip;

describeDb('Payments bulk actions (local DB)', () => {
  jest.setTimeout(240_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let payments: PaymentsService;
  let bulk: PaymentsBulkService;
  let review: PaymentReviewService;
  let accept: PaymentBulkAcceptService;
  let statements: PaymentStatementsService;
  let matching: PaymentMatchingService;
  let overview: PaymentReconciliationService;

  const tag = randomUUID().slice(0, 6).toUpperCase();
  let userId: string;
  let currencyId: string;
  let currencyCode: string;
  let otherCurrencyId: string;
  let otherCurrencyCode: string;
  let partnerId: string;
  const partnerName = `عميل الدفعات ${tag}`;
  let productId: string;
  let paymentSourceId: string;
  let clearingCode: string;
  /** Finance confirms from payment review. */
  let plainMethodId: string;
  /** Confirmed only by statement matching. */
  let reconMethodId: string;
  let seq = 0;

  const day = (offset: number) =>
    new Date(
      Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate() + offset,
      ),
    );
  const providerDate = day(-2).toISOString().slice(0, 10);

  const mapping = (): StatementMappingConfig => ({
    columns: {
      providerReference: 'Ref',
      customerName: 'Name',
      amount: 'Amount',
      currency: 'Currency',
      transactionDate: 'Date',
      providerStatus: 'Status',
    },
    dateFormat: 'YMD',
  });

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
      ],
    })
      .overrideProvider(GoogleSheetsService)
      .useValue({})
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    payments = moduleRef.get(PaymentsService, { strict: false });
    bulk = moduleRef.get(PaymentsBulkService, { strict: false });
    review = moduleRef.get(PaymentReviewService, { strict: false });
    accept = moduleRef.get(PaymentBulkAcceptService);
    statements = moduleRef.get(PaymentStatementsService);
    matching = moduleRef.get(PaymentMatchingService);
    overview = moduleRef.get(PaymentReconciliationService);

    userId = (
      await prisma.user.create({
        data: {
          email: `bulk-${tag.toLowerCase()}@test.local`,
          username: `bulk-${tag.toLowerCase()}`,
          fullName: `Bulk Test ${tag}`,
          passwordHash: 'x',
        },
      })
    ).id;

    const functionalId = await moduleRef
      .get(ExchangeRatesService)
      .requireFunctionalCurrencyId();
    currencyCode = `B${tag}`;
    otherCurrencyCode = `K${tag}`;
    currencyId = (
      await prisma.currency.create({
        data: { code: currencyCode, name: `Bulk ${tag}` },
      })
    ).id;
    otherCurrencyId = (
      await prisma.currency.create({
        data: { code: otherCurrencyCode, name: `Bulk other ${tag}` },
      })
    ).id;
    for (const id of [currencyId, otherCurrencyId]) {
      for (const offset of [-5, -4, -3, -2, -1, 0]) {
        await prisma.exchangeRate.create({
          data: {
            fromCurrencyId: id,
            toCurrencyId: functionalId,
            rate: 30,
            effectiveDate: day(offset),
          },
        });
      }
    }

    partnerId = (
      await prisma.partner.create({
        data: {
          partnerNumber: `PT-BULK-${tag}`,
          name: partnerName,
          roles: { create: { role: PartnerRoleType.CUSTOMER } },
        },
      })
    ).id;
    const product = await prisma.product.findFirst({
      where: { deletedAt: null, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!product) throw new Error('Expected an active product.');
    productId = product.id;
    const source = await prisma.paymentSource.findFirst({
      where: { deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!source) throw new Error('Expected an active payment source.');
    paymentSourceId = source.id;

    clearingCode = `BULK-CLR-${tag}`;
    const clearing = await prisma.chartOfAccount.create({
      data: {
        code: clearingCode,
        name: `Bulk Clearing ${tag}`,
        accountType: AccountType.ASSET,
      },
    });
    plainMethodId = (
      await prisma.paymentMethod.create({
        data: {
          name: `Bulk Plain ${tag}`,
          accountId: clearing.id,
          requiresReconciliation: false,
        },
      })
    ).id;
    reconMethodId = (
      await prisma.paymentMethod.create({
        data: {
          name: `Bulk Recon ${tag}`,
          accountId: clearing.id,
          requiresReconciliation: true,
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (prisma && plainMethodId) {
      await prisma.paymentMethod.updateMany({
        where: { id: { in: [plainMethodId, reconMethodId] } },
        data: { deletedAt: new Date() },
      });
    }
    await moduleRef?.close();
  });

  async function makeClaim(
    amount: number,
    opts: {
      methodId?: string;
      currency?: string;
      orderCurrency?: string;
      reference?: string;
    } = {},
  ) {
    seq += 1;
    const order = await prisma.storeOrder.create({
      data: {
        internalOrderId: `SO-BULK-${tag}-${seq}`,
        partnerId,
        currencyId: opts.orderCurrency ?? currencyId,
        paymentType: StoreOrderPaymentType.PREPAID,
        items: {
          create: [
            { productId, quantity: 1, unitPrice: amount, agreedAmount: amount },
          ],
        },
      },
    });
    return prisma.payment.create({
      data: {
        paymentNumber: `PAY-BULK-${tag}-${seq}`,
        storeOrderId: order.id,
        paymentDate: day(-3),
        amount,
        currencyId: opts.currency ?? currencyId,
        paymentSourceId,
        paymentMethodId: opts.methodId ?? plainMethodId,
        origin: PaymentOrigin.SALES_DECLARATION,
        referenceNumber: opts.reference ?? null,
        senderName: partnerName,
        status: PaymentStatus.PENDING,
      },
    });
  }

  async function importLines(rows: Record<string, string>[]) {
    await statements.commitRows({
      methodId: reconMethodId,
      sourceType: PaymentStatementSourceType.FILE,
      rows: rows.map((raw, index) => ({
        rowNumber: index + 2,
        raw: {
          Ref: '',
          Name: '',
          Amount: '100',
          Currency: currencyCode,
          Date: providerDate,
          Status: 'CAPTURED',
          ...raw,
        },
      })),
      config: mapping(),
      userId,
      fileName: `bulk-${tag}.csv`,
    });
  }

  const lineByRef = (ref: string) =>
    prisma.paymentStatementLine.findFirstOrThrow({
      where: { paymentMethodId: reconMethodId, providerReference: ref },
    });

  const receiptCount = (paymentId: string) =>
    prisma.paymentReceiptLink.count({ where: { paymentId } });

  it('bulk confirm: posts eligible items once and reports every refusal individually', async () => {
    const ok = await makeClaim(100);
    const reconciled = await makeClaim(100, { methodId: reconMethodId });
    const currencyMismatch = await makeClaim(100, {
      currency: otherCurrencyId,
    });
    const posted = await makeClaim(100);
    await payments.confirm(posted.id, userId);

    const result = await bulk.confirmMany(
      [ok.id, reconciled.id, ok.id, currencyMismatch.id, posted.id],
      userId,
    );

    // Duplicates run once: one success, three per-item failures.
    expect(result.succeeded.map((row) => row.id)).toEqual([ok.id]);
    expect(result.succeeded[0].receiptNumber).toBeTruthy();
    expect(result.succeeded[0].journalEntryNumber).toBeTruthy();
    const failures = new Map(result.failed.map((row) => [row.id, row]));
    expect(result.failed).toHaveLength(3);
    expect(failures.get(reconciled.id)?.code).toBe('CONFLICT');
    expect(failures.get(reconciled.id)?.message).toMatch(
      /requires reconciliation/,
    );
    expect(failures.get(currencyMismatch.id)?.code).toBe('BAD_REQUEST');
    expect(failures.get(currencyMismatch.id)?.message).toMatch(/currency/i);
    expect(failures.get(posted.id)?.code).toBe('ALREADY_POSTED');

    // Exactly one receipt each for the posted claims; refused ones untouched.
    expect(await receiptCount(ok.id)).toBe(1);
    expect(await receiptCount(posted.id)).toBe(1);
    expect(await receiptCount(reconciled.id)).toBe(0);
    expect(await receiptCount(currencyMismatch.id)).toBe(0);
    const statuses = await prisma.payment.findMany({
      where: { id: { in: [ok.id, reconciled.id, currencyMismatch.id] } },
      select: { id: true, status: true },
    });
    expect(Object.fromEntries(statuses.map((p) => [p.id, p.status]))).toEqual({
      [ok.id]: PaymentStatus.VERIFIED,
      [reconciled.id]: PaymentStatus.PENDING,
      [currencyMismatch.id]: PaymentStatus.PENDING,
    });

    // A retry of the same batch posts nothing twice.
    const retry = await bulk.confirmMany([ok.id], userId);
    expect(retry.succeeded).toHaveLength(0);
    expect(retry.failed[0].code).toBe('ALREADY_POSTED');
    expect(await receiptCount(ok.id)).toBe(1);
  });

  it('bulk reject: one shared reason; posted, settled and matched claims are refused', async () => {
    const pending = await makeClaim(60);
    const posted = await makeClaim(60);
    await payments.confirm(posted.id, userId);
    const settled = await makeClaim(60);
    await payments.confirm(settled.id, userId);
    await prisma.payment.update({
      where: { id: settled.id },
      data: {
        settlementStatus: PaymentSettlementStatus.SETTLED,
        settledAmount: 60,
      },
    });
    const partiallyMatched = await makeClaim(90, {
      methodId: reconMethodId,
      reference: `RJ-${tag}`,
    });
    await importLines([{ Ref: `RJ-${tag}`, Amount: '40' }]);
    const line = await lineByRef(`RJ-${tag}`);
    await matching.confirm(
      reconMethodId,
      {
        statementLineId: line.id,
        allocations: [{ paymentId: partiallyMatched.id, amount: 40 }],
        idempotencyKey: randomUUID(),
      },
      userId,
    );

    const reason = `Duplicate declaration ${tag}`;
    const result = await bulk.rejectMany(
      [pending.id, pending.id, posted.id, settled.id, partiallyMatched.id],
      reason,
      userId,
    );
    expect(result.succeeded).toEqual([
      expect.objectContaining({
        id: pending.id,
        status: PaymentStatus.REJECTED,
      }),
    ]);
    const failures = new Map(result.failed.map((row) => [row.id, row]));
    expect(result.failed).toHaveLength(3);
    expect(failures.get(posted.id)?.code).toBe('POSTED');
    expect(failures.get(settled.id)?.code).toBe('POSTED');
    expect(failures.get(settled.id)?.message).toMatch(/settled/);
    expect(failures.get(partiallyMatched.id)?.code).toBe('CONFLICT');

    const rejected = await prisma.payment.findUniqueOrThrow({
      where: { id: pending.id },
    });
    expect(rejected.rejectionReason).toBe(reason);
    expect(rejected.rejectedById).toBe(userId);
    const untouched = await prisma.payment.findMany({
      where: { id: { in: [posted.id, settled.id, partiallyMatched.id] } },
      select: { status: true },
    });
    expect(untouched.map((row) => row.status).sort()).toEqual(
      [
        PaymentStatus.MATCHED,
        PaymentStatus.VERIFIED,
        PaymentStatus.VERIFIED,
      ].sort(),
    );
  });

  it('bulk accept: dry run changes nothing; only strong unambiguous suggestions post; retries never double-post', async () => {
    const strong = await makeClaim(100, {
      methodId: reconMethodId,
      reference: `ST-${tag}`,
    });
    // Name + amount only ⇒ no reference/order identity — never accepted in bulk.
    const nameOnly = await makeClaim(77, { methodId: reconMethodId });
    // Exact reference, but the provider status is not a known success.
    const unverified = await makeClaim(44, {
      methodId: reconMethodId,
      reference: `UV-${tag}`,
    });
    // Same reference but the claim is in another currency than the line.
    await makeClaim(55, {
      methodId: reconMethodId,
      reference: `FX-${tag}`,
    });
    const changed = await makeClaim(33, {
      methodId: reconMethodId,
      reference: `CH-${tag}`,
    });
    await importLines([
      { Ref: `ST-${tag}`, Amount: '100' },
      { Ref: `NM-${tag}`, Amount: '77', Name: partnerName },
      { Ref: `FX-${tag}`, Amount: '55', Currency: otherCurrencyCode },
      { Ref: `CH-${tag}`, Amount: '33' },
      { Ref: `UV-${tag}`, Amount: '44', Status: 'PROCESSING' },
    ]);
    const strongLine = await lineByRef(`ST-${tag}`);
    const nameLine = await lineByRef(`NM-${tag}`);
    const fxLine = await lineByRef(`FX-${tag}`);
    const changedLine = await lineByRef(`CH-${tag}`);
    const unverifiedLine = await lineByRef(`UV-${tag}`);

    const dry = await accept.bulkAccept(
      reconMethodId,
      {
        dryRun: true,
        items: [
          { statementLineId: strongLine.id },
          { statementLineId: nameLine.id },
          { statementLineId: fxLine.id },
          { statementLineId: unverifiedLine.id },
        ],
      },
      userId,
    );
    expect(dry.succeeded).toEqual([
      expect.objectContaining({
        id: strongLine.id,
        paymentId: strong.id,
        amount: 100,
        currencyCode,
      }),
    ]);
    const dryFailures = new Map(dry.failed.map((row) => [row.id, row.code]));
    expect(dryFailures.get(nameLine.id)).toBe('NO_REFERENCE_MATCH');
    expect(dryFailures.get(unverifiedLine.id)).toBe('STATUS_UNVERIFIED');
    expect(dryFailures.get(fxLine.id)).toBe('NO_SUGGESTION');
    expect((await lineByRef(`ST-${tag}`)).status).toBe('UNMATCHED');
    expect(await receiptCount(strong.id)).toBe(0);

    const key = `bulk-${tag}`;
    const commit = await accept.bulkAccept(
      reconMethodId,
      {
        idempotencyKey: key,
        items: [
          { statementLineId: strongLine.id, paymentId: strong.id },
          { statementLineId: strongLine.id, paymentId: strong.id },
          { statementLineId: nameLine.id },
          { statementLineId: fxLine.id },
          // The reviewer saw a different claim than the current top suggestion.
          { statementLineId: changedLine.id, paymentId: nameOnly.id },
        ],
      },
      userId,
    );
    expect(commit.succeeded).toEqual([
      expect.objectContaining({
        id: strongLine.id,
        paymentId: strong.id,
        posted: true,
      }),
    ]);
    const failures = new Map(commit.failed.map((row) => [row.id, row.code]));
    expect(commit.failed).toHaveLength(3);
    expect(failures.get(nameLine.id)).toBe('NO_REFERENCE_MATCH');
    expect(failures.get(fxLine.id)).toBe('NO_SUGGESTION');
    expect(failures.get(changedLine.id)).toBe('SUGGESTION_CHANGED');

    expect(await receiptCount(strong.id)).toBe(1);
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: strong.id } }))
        .status,
    ).toBe(PaymentStatus.VERIFIED);
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: changed.id } }))
        .status,
    ).toBe(PaymentStatus.PENDING);
    expect(
      (
        await prisma.payment.findUniqueOrThrow({
          where: { id: unverified.id },
        })
      ).status,
    ).toBe(PaymentStatus.PENDING);

    // Same key: the recorded outcome comes back as a replay, nothing posts again.
    const retry = await accept.bulkAccept(
      reconMethodId,
      {
        idempotencyKey: key,
        items: [{ statementLineId: strongLine.id, paymentId: strong.id }],
      },
      userId,
    );
    expect(retry.failed).toHaveLength(0);
    expect(retry.succeeded).toEqual([
      expect.objectContaining({
        id: strongLine.id,
        paymentId: strong.id,
        paymentNumber: strong.paymentNumber,
        replayed: true,
        posted: true,
      }),
    ]);
    // A new action on the now-matched line is refused with a stable code.
    const again = await accept.bulkAccept(
      reconMethodId,
      {
        idempotencyKey: `other-${tag}`,
        items: [{ statementLineId: strongLine.id }],
      },
      userId,
    );
    expect(again.failed[0].code).toBe('LINE_NOT_UNMATCHED');
    expect(await receiptCount(strong.id)).toBe(1);
    expect(
      await prisma.paymentMatch.count({ where: { paymentId: strong.id } }),
    ).toBe(1);
  });

  it('match panel reads: claim lines, reversal effect named truthfully, review context and summary', async () => {
    const claim = await makeClaim(120, {
      methodId: reconMethodId,
      reference: `PN-${tag}`,
    });
    await importLines([{ Ref: `PN-${tag}`, Amount: '120' }]);
    const line = await lineByRef(`PN-${tag}`);

    const before = await matching.claimLines(reconMethodId, claim.id);
    expect(before.activeMatches).toHaveLength(0);
    expect(before.candidates[0]).toEqual(
      expect.objectContaining({ strength: 'STRONG', amountMatches: true }),
    );
    expect(before.candidates[0].line.id).toBe(line.id);
    expect(before.candidates[0].line.technical.dedupeKey).toContain(
      `PN-${tag}`,
    );

    await matching.confirm(
      reconMethodId,
      {
        statementLineId: line.id,
        allocations: [{ paymentId: claim.id, amount: 120 }],
        idempotencyKey: randomUUID(),
      },
      userId,
    );
    const after = await matching.claimLines(reconMethodId, claim.id);
    expect(after.candidates).toHaveLength(0);
    expect(after.activeMatches).toEqual([
      expect.objectContaining({
        reversalEffect: 'REVERSE_POSTING',
        settled: false,
      }),
    ]);
    expect(after.journalEntry?.entryNumber).toBeTruthy();
    const listed = await overview.listLines(reconMethodId, {
      search: `PN-${tag}`,
    });
    expect(listed.items[0].matches[0].reversalEffect).toBe('REVERSE_POSTING');

    // A receipt posted before PaymentReceiptLink existed (tagged only by its
    // notes) is found by the same lookup reverseMatch uses.
    await prisma.paymentReceiptLink.delete({ where: { paymentId: claim.id } });
    const legacyListed = await overview.listLines(reconMethodId, {
      search: `PN-${tag}`,
    });
    expect(legacyListed.items[0].matches[0].reversalEffect).toBe(
      'REVERSE_POSTING',
    );
    expect(legacyListed.items[0].matches[0].receipt?.id).toBeTruthy();
    expect(legacyListed.items[0].matches[0].journalEntry?.entryNumber).toBe(
      after.journalEntry?.entryNumber,
    );
    const legacyView = await matching.claimLines(reconMethodId, claim.id);
    expect(legacyView.activeMatches[0].reversalEffect).toBe('REVERSE_POSTING');
    expect(legacyView.journalEntry?.entryNumber).toBe(
      after.journalEntry?.entryNumber,
    );

    // A partial allocation posts nothing ⇒ reversing it is only an unmatch.
    const partial = await makeClaim(90, {
      methodId: reconMethodId,
      reference: `PP-${tag}`,
    });
    await importLines([{ Ref: `PP-${tag}`, Amount: '30' }]);
    const partialLine = await lineByRef(`PP-${tag}`);
    await matching.confirm(
      reconMethodId,
      {
        statementLineId: partialLine.id,
        allocations: [{ paymentId: partial.id, amount: 30 }],
        idempotencyKey: randomUUID(),
      },
      userId,
    );
    const partialView = await matching.claimLines(reconMethodId, partial.id);
    expect(partialView.activeMatches[0].reversalEffect).toBe('UNMATCH');

    const context = await review.context(claim.id);
    expect(context.paymentNumber).toBe(claim.paymentNumber);
    expect(context.status).toBe(PaymentStatus.VERIFIED);
    expect(context.activeMatchCount).toBe(1);
    expect(context.debitAccount?.code).toBe(clearingCode);
    expect(context.debitAccount?.source).toBe('PAYMENT_METHOD');
    expect(context.customer?.name).toBe(partnerName);

    // Matched manually (no statement) on a review-confirmed method.
    const manual = await makeClaim(25);
    await payments.match(manual.id, { matchedById: userId });

    // This user holds no reconciliation permission: statement stages are withheld.
    const summary = await review.summary(userId);
    expect(summary.unmatchedLines).toBeNull();
    expect(summary.exceptions).toBeNull();
    // Only claims confirmable from review count as "awaiting confirmation";
    // reconciliation-method MATCHED claims are finished in their workspace.
    expect(summary.awaitingConfirmation.totals[currencyCode]?.count).toBe(1);
    expect(
      summary.partiallyAllocated.totals[currencyCode]?.count,
    ).toBeGreaterThan(0);
    expect(
      summary.partiallyAllocated.methods.some((m) => m.id === reconMethodId),
    ).toBe(true);
    const confirmable = await payments.findAll({
      status: PaymentStatus.MATCHED,
      reconciled: 'false',
      pageSize: 200,
    });
    expect(confirmable.items.some((row) => row.id === manual.id)).toBe(true);
    expect(confirmable.items.some((row) => row.id === partial.id)).toBe(false);
    expect(
      confirmable.items.find((row) => row.id === manual.id)?.activeMatchCount,
    ).toBe(0);
    expect(
      summary.awaitingSettlement.methods.some((m) => m.id === reconMethodId),
    ).toBe(true);
  });

  it('review list search: payment number, order number, reference and customer name', async () => {
    const claim = await makeClaim(40, { reference: `REF-SRCH-${tag}` });
    const order = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: claim.storeOrderId! },
    });
    const ids = async (search: string) =>
      (await payments.findAll({ search, pageSize: 200 })).items.map(
        (row) => row.id,
      );
    expect(await ids(claim.paymentNumber.toLowerCase())).toContain(claim.id);
    expect(await ids(order.internalOrderId)).toContain(claim.id);
    expect(await ids(`ref-srch-${tag}`)).toContain(claim.id);
    expect(await ids(partnerName)).toContain(claim.id);
    expect(await ids(`NO-SUCH-${tag}`)).toHaveLength(0);
    // Search narrows, never widens, the other filters.
    const rejected = await payments.findAll({
      search: claim.paymentNumber,
      status: PaymentStatus.REJECTED,
    });
    expect(rejected.total).toBe(0);
  });
});
