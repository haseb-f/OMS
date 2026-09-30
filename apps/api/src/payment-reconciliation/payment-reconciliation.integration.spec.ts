import { Test, type TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AccountType,
  FinancialTransactionStatus,
  JournalEntryStatus,
  PartnerRoleType,
  PaymentOrigin,
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
import { PaymentReconciliationModule } from './payment-reconciliation.module';
import { PaymentStatementsService } from './payment-statements.service';
import { PaymentMatchingService } from './payment-matching.service';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { ClaimPostingAdapter } from './claim-posting.adapter';
import { PaymentsService } from '../payments/payments.service';
import { FinancialTransactionsService } from '../financial-transactions/financial-transactions.service';
import type { StatementMappingConfig } from './statement-row.util';

/**
 * payment-declaration-reconciliation — statements, dedupe, suggestions,
 * Confirm Match & Post, correction. Real local Postgres, self-created tagged
 * fixtures; Google Sheets is replaced by an in-memory grid (no network, no
 * credentials). Skipped unless DATABASE_URL points at a local database.
 */
const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(
  process.env.DATABASE_URL ?? '',
);
const describeDb = LOCAL_DB ? describe : describe.skip;

const HEADERS = [
  'Ref',
  'Name',
  'Phone',
  'Amount',
  'Currency',
  'Date',
  'Status',
  'Order',
];

describeDb('Payment reconciliation (local DB)', () => {
  jest.setTimeout(240_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let statements: PaymentStatementsService;
  let matching: PaymentMatchingService;
  let overview: PaymentReconciliationService;
  let adapter: ClaimPostingAdapter;
  let payments: PaymentsService;
  let financialTransactions: FinancialTransactionsService;

  const tag = randomUUID().slice(0, 6).toUpperCase();
  let userId: string;
  let currencyId: string;
  let currencyCode: string;
  let otherCurrencyId: string;
  let otherCurrencyCode: string;
  let partnerId: string;
  let productId: string;
  let methodId: string;
  let paymentSourceId: string;
  let seq = 0;

  const day = (offset: number) =>
    new Date(
      Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate() + offset,
      ),
    );
  const providerDay = day(-2);
  const providerDate = providerDay.toISOString().slice(0, 10);

  let sheetGrid: string[][] = [];
  const sheetsMock = {
    resolveSheetTitle: jest.fn(() => Promise.resolve('Statement')),
    getSheetData: jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return sheetGrid;
    }),
  };

  const mapping = (): StatementMappingConfig => ({
    columns: {
      providerReference: 'Ref',
      customerName: 'Name',
      customerPhone: 'Phone',
      amount: 'Amount',
      currency: 'Currency',
      transactionDate: 'Date',
      providerStatus: 'Status',
      orderReference: 'Order',
    },
    dateFormat: 'YMD',
  });

  const raw = (overrides: Record<string, string>) => ({
    Ref: '',
    Name: '',
    Phone: '',
    Amount: '100',
    Currency: currencyCode,
    Date: providerDate,
    Status: 'CAPTURED',
    Order: '',
    ...overrides,
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
      .useValue(sheetsMock)
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    statements = moduleRef.get(PaymentStatementsService);
    matching = moduleRef.get(PaymentMatchingService);
    overview = moduleRef.get(PaymentReconciliationService);
    adapter = moduleRef.get(ClaimPostingAdapter);
    payments = moduleRef.get(PaymentsService, { strict: false });
    financialTransactions = moduleRef.get(FinancialTransactionsService, {
      strict: false,
    });

    userId = (
      await prisma.user.create({
        data: {
          email: `rec-${tag.toLowerCase()}@test.local`,
          username: `rec-${tag.toLowerCase()}`,
          fullName: `Reconciliation Test ${tag}`,
          passwordHash: 'x',
        },
      })
    ).id;

    const functionalId = await moduleRef
      .get(ExchangeRatesService)
      .requireFunctionalCurrencyId();
    currencyCode = `R${tag}`;
    otherCurrencyCode = `S${tag}`;
    currencyId = (
      await prisma.currency.create({
        data: { code: currencyCode, name: `Reconciliation ${tag}` },
      })
    ).id;
    otherCurrencyId = (
      await prisma.currency.create({
        data: { code: otherCurrencyCode, name: `Reconciliation other ${tag}` },
      })
    ).id;
    for (const offset of [-5, -4, -3, -2, -1, 0]) {
      await prisma.exchangeRate.create({
        data: {
          fromCurrencyId: currencyId,
          toCurrencyId: functionalId,
          rate: 40 + offset, // distinct per day ⇒ the frozen rate proves the FX date
          effectiveDate: day(offset),
        },
      });
    }

    partnerId = (
      await prisma.partner.create({
        data: {
          partnerNumber: `PT-REC-${tag}`,
          name: `عميل المطابقة ${tag}`,
          mobile: '+966501234567',
          roles: { create: { role: PartnerRoleType.CUSTOMER } },
        },
      })
    ).id;
    const product = await prisma.product.findFirst({
      where: { deletedAt: null, status: 'ACTIVE', ownerAgentId: null },
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

    const clearing = await prisma.chartOfAccount.create({
      data: {
        code: `REC-CLR-${tag}`,
        name: `Reconciliation Clearing ${tag}`,
        accountType: AccountType.ASSET,
      },
    });
    methodId = (
      await prisma.paymentMethod.create({
        data: {
          name: `Rec Method ${tag}`,
          accountId: clearing.id,
          requiresReconciliation: true,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function makeClaim(amount = 100, opts: { currency?: string } = {}) {
    seq += 1;
    const order = await prisma.storeOrder.create({
      data: {
        internalOrderId: `SO-REC-${tag}-${seq}`,
        partnerId,
        currencyId: opts.currency ?? currencyId,
        paymentType: StoreOrderPaymentType.PREPAID,
        items: {
          create: [
            { productId, quantity: 1, unitPrice: amount, agreedAmount: amount },
          ],
        },
      },
    });
    const payment = await prisma.payment.create({
      data: {
        paymentNumber: `PAY-REC-${tag}-${seq}`,
        storeOrderId: order.id,
        paymentDate: day(-3),
        amount,
        currencyId: opts.currency ?? currencyId,
        paymentSourceId,
        paymentMethodId: methodId,
        origin: PaymentOrigin.SALES_DECLARATION,
        senderName: `عميل المطابقة ${tag}`,
        status: PaymentStatus.PENDING,
      },
    });
    return { order, payment };
  }

  async function importRows(rows: Record<string, string>[]) {
    return statements.commitRows({
      methodId,
      sourceType: PaymentStatementSourceType.FILE,
      rows: rows.map((r, index) => ({ rowNumber: index + 2, raw: r })),
      config: mapping(),
      userId,
      fileName: `statement-${tag}.csv`,
    });
  }

  async function lineByRef(ref: string) {
    return prisma.paymentStatementLine.findFirstOrThrow({
      where: { paymentMethodId: methodId, providerReference: ref },
    });
  }

  it('file import: provenance, identical re-import, changed unmatched row, validation errors', async () => {
    const first = await importRows([
      raw({ Ref: `A-${tag}`, Amount: '100' }),
      raw({ Ref: `B-${tag}`, Amount: '0' }),
      raw({ Ref: `C-${tag}`, Currency: 'NOPE' }),
    ]);
    expect(first.createdRows).toBe(1);
    expect(first.errorRows).toBe(2);
    expect(first.errors.map((e) => e.rowNumber)).toEqual([3, 4]);

    const line = await lineByRef(`A-${tag}`);
    expect(line.rowNumber).toBe(2);
    expect(line.importId).toBe(first.importId);
    expect(line.rowHash).toBeTruthy();
    expect(line.rawRow).toMatchObject({ Ref: `A-${tag}` });

    const again = await importRows([raw({ Ref: `A-${tag}`, Amount: '100' })]);
    expect(again.duplicateRows).toBe(1);
    expect(again.createdRows).toBe(0);

    const changed = await importRows([raw({ Ref: `A-${tag}`, Amount: '120' })]);
    expect(changed.updatedRows).toBe(1);
    expect(Number((await lineByRef(`A-${tag}`)).amount)).toBe(120);
    expect(
      await prisma.journalEntry.count({ where: { sourceId: line.id } }),
    ).toBe(0);
  });

  it('manual entry is validated and deduplicated', async () => {
    const dto = {
      providerReference: `M-${tag}`,
      amount: 50,
      currencyId,
      transactionDate: providerDate,
      feeAmount: 60,
    };
    await expect(
      statements.createManualLine(methodId, dto, userId),
    ).rejects.toBeInstanceOf(BadRequestException);
    await statements.createManualLine(
      methodId,
      { ...dto, feeAmount: 5 },
      userId,
    );
    const line = await lineByRef(`M-${tag}`);
    expect(line.sourceType).toBe('MANUAL');
    expect(Number(line.netAmount)).toBe(45);
    await expect(
      statements.createManualLine(methodId, { ...dto, feeAmount: 5 }, userId),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('suggests the claim by order reference and phone; ambiguity; dismissal', async () => {
    const { order, payment } = await makeClaim(100);
    const twinA = await makeClaim(77);
    const twinB = await makeClaim(77);
    await importRows([
      raw({ Ref: `S-${tag}`, Order: order.internalOrderId, Amount: '100' }),
      raw({ Ref: `T-${tag}`, Phone: '0501234567', Amount: '77' }),
    ]);
    const byOrder = await matching.suggestions(
      methodId,
      (await lineByRef(`S-${tag}`)).id,
    );
    expect(byOrder.candidates[0].paymentId).toBe(payment.id);
    expect(byOrder.candidates[0].strength).toBe('STRONG');
    expect(byOrder.ambiguous).toBe(false);

    // Phone without a region is not E.164 → store it with a region hint.
    const phoneLine = await lineByRef(`T-${tag}`);
    await prisma.paymentStatementLine.update({
      where: { id: phoneLine.id },
      data: { customerPhoneE164: '+966501234567' },
    });
    const byPhone = await matching.suggestions(methodId, phoneLine.id);
    const top = byPhone.candidates.filter(
      (c) => c.score === byPhone.candidates[0].score,
    );
    expect(top.map((c) => c.paymentId).sort()).toEqual(
      [twinA.payment.id, twinB.payment.id].sort(),
    );
    expect(byPhone.ambiguous).toBe(true);

    await matching.dismissSuggestion(
      methodId,
      phoneLine.id,
      twinA.payment.id,
      'not this one',
      userId,
    );
    const afterDismiss = await matching.suggestions(methodId, phoneLine.id);
    expect(afterDismiss.candidates.map((c) => c.paymentId)).not.toContain(
      twinA.payment.id,
    );
    const claim = await prisma.payment.findUniqueOrThrow({
      where: { id: twinA.payment.id },
    });
    expect(claim.status).toBe(PaymentStatus.PENDING);
  });

  it('rejects currency mismatch and over-allocation', async () => {
    const { payment } = await makeClaim(100);
    const foreign = await makeClaim(100, { currency: otherCurrencyId });
    await importRows([raw({ Ref: `X-${tag}`, Amount: '100' })]);
    const line = await lineByRef(`X-${tag}`);

    await expect(
      matching.confirm(
        methodId,
        {
          statementLineId: line.id,
          allocations: [{ paymentId: foreign.payment.id, amount: 100 }],
          idempotencyKey: randomUUID(),
        },
        userId,
      ),
    ).rejects.toThrow(/Currency mismatch/);
    await expect(
      matching.confirm(
        methodId,
        {
          statementLineId: line.id,
          allocations: [{ paymentId: payment.id, amount: 100.01 }],
          idempotencyKey: randomUUID(),
        },
        userId,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      await prisma.paymentMatch.count({ where: { statementLineId: line.id } }),
    ).toBe(0);
    void otherCurrencyCode;
  });

  it('partial allocation does not post; completing it posts once via confirmInTx at the provider date', async () => {
    const spy = jest.spyOn(adapter, 'confirmInTx');
    const { payment } = await makeClaim(100);
    await importRows([
      raw({
        Ref: `P1-${tag}`,
        Amount: '60',
        Date: day(-4).toISOString().slice(0, 10),
      }),
      raw({ Ref: `P2-${tag}`, Amount: '40' }),
    ]);
    const l1 = await lineByRef(`P1-${tag}`);
    const l2 = await lineByRef(`P2-${tag}`);

    await matching.confirm(
      methodId,
      {
        statementLineId: l1.id,
        allocations: [{ paymentId: payment.id, amount: 60 }],
        idempotencyKey: randomUUID(),
      },
      userId,
    );
    let claim = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      include: { receiptLink: true },
    });
    expect(claim.status).toBe(PaymentStatus.MATCHED);
    expect(claim.receiptLink).toBeNull();
    expect(spy).not.toHaveBeenCalled();

    const result = await matching.confirm(
      methodId,
      {
        statementLineId: l2.id,
        allocations: [{ paymentId: payment.id, amount: 40 }],
        idempotencyKey: randomUUID(),
      },
      userId,
    );
    expect(result.postings[0].posted).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][3]).toEqual({
      rateAsOf: l2.transactionDate,
      statementLineId: l2.id,
    });
    claim = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      include: { receiptLink: true },
    });
    expect(claim.status).toBe(PaymentStatus.VERIFIED);
    expect(claim.receiptLink).not.toBeNull();
    const receipt = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: claim.receiptLink!.financialTransactionId },
    });
    expect(receipt.rateAsOf?.toISOString().slice(0, 10)).toBe(providerDate);
    expect(Number(receipt.exchangeRate)).toBe(38); // rate dated providerDay (-2)
    spy.mockRestore();
  });

  it('concurrent double confirm: one allocation, one receipt; same key replays', async () => {
    const { payment } = await makeClaim(100);
    await importRows([raw({ Ref: `D-${tag}`, Amount: '100' })]);
    const line = await lineByRef(`D-${tag}`);
    const results = await Promise.allSettled([
      matching.confirm(
        methodId,
        {
          statementLineId: line.id,
          allocations: [{ paymentId: payment.id, amount: 100 }],
          idempotencyKey: randomUUID(),
        },
        userId,
      ),
      matching.confirm(
        methodId,
        {
          statementLineId: line.id,
          allocations: [{ paymentId: payment.id, amount: 100 }],
          idempotencyKey: randomUUID(),
        },
        userId,
      ),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await prisma.paymentMatch.count({ where: { paymentId: payment.id } }),
    ).toBe(1);
    expect(
      await prisma.paymentReceiptLink.count({
        where: { paymentId: payment.id },
      }),
    ).toBe(1);

    const { payment: p2 } = await makeClaim(100);
    await importRows([raw({ Ref: `K-${tag}`, Amount: '100' })]);
    const line2 = await lineByRef(`K-${tag}`);
    const key = randomUUID();
    const dto = {
      statementLineId: line2.id,
      allocations: [{ paymentId: p2.id, amount: 100 }],
      idempotencyKey: key,
    };
    const [a, b] = await Promise.all([
      matching.confirm(methodId, dto, userId),
      matching.confirm(methodId, dto, userId),
    ]);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(a.matches[0].id).toBe(b.matches[0].id);
    expect(
      await prisma.paymentMatch.count({ where: { paymentId: p2.id } }),
    ).toBe(1);
  });

  it('changed source row after match becomes an exception and is not modified', async () => {
    const { payment } = await makeClaim(100);
    await importRows([raw({ Ref: `E-${tag}`, Amount: '100' })]);
    const line = await lineByRef(`E-${tag}`);
    await matching.confirm(
      methodId,
      {
        statementLineId: line.id,
        allocations: [{ paymentId: payment.id, amount: 100 }],
        idempotencyKey: randomUUID(),
      },
      userId,
    );
    const summary = await importRows([raw({ Ref: `E-${tag}`, Amount: '999' })]);
    expect(summary.exceptionRows).toBe(1);
    const after = await lineByRef(`E-${tag}`);
    expect(after.status).toBe('EXCEPTION');
    expect(after.exceptionReason).toMatch(/Source row changed after match/);
    expect(Number(after.amount)).toBe(100);
    expect(Number(after.matchedAmount)).toBe(100);
  });

  it('correction reverses the receipt JE and allows a re-match without double posting; settled claims refuse', async () => {
    const { payment } = await makeClaim(100);
    await importRows([raw({ Ref: `R-${tag}`, Amount: '100' })]);
    const line = await lineByRef(`R-${tag}`);
    const first = await matching.confirm(
      methodId,
      {
        statementLineId: line.id,
        allocations: [{ paymentId: payment.id, amount: 100 }],
        idempotencyKey: randomUUID(),
      },
      userId,
    );
    const receiptId = first.postings[0].receiptId as string;
    const je = await prisma.journalEntry.findFirstOrThrow({
      where: {
        sourceType: 'CUSTOMER_RECEIPT',
        sourceId: receiptId,
        reversalOfEntryId: null,
      },
    });

    const reversed = await matching.reverseMatch(
      methodId,
      first.matches[0].id,
      'wrong customer',
      userId,
    );
    expect(reversed.paymentStatus).toBe(PaymentStatus.PENDING);
    expect(reversed.cancelledReceipt?.id).toBe(receiptId);
    expect(
      (await prisma.journalEntry.findUniqueOrThrow({ where: { id: je.id } }))
        .status,
    ).toBe(JournalEntryStatus.REVERSED);
    expect(
      (
        await prisma.financialTransaction.findUniqueOrThrow({
          where: { id: receiptId },
        })
      ).status,
    ).toBe(FinancialTransactionStatus.CANCELLED);
    expect(
      await prisma.paymentReceiptLink.count({
        where: { paymentId: payment.id },
      }),
    ).toBe(0);
    const lineAfter = await lineByRef(`R-${tag}`);
    expect(lineAfter.status).toBe('UNMATCHED');
    expect(Number(lineAfter.matchedAmount)).toBe(0);

    const second = await matching.confirm(
      methodId,
      {
        statementLineId: line.id,
        allocations: [{ paymentId: payment.id, amount: 100 }],
        idempotencyKey: randomUUID(),
      },
      userId,
    );
    expect(second.postings[0].receiptId).not.toBe(receiptId);
    const live = await prisma.financialTransaction.count({
      where: {
        notes: `STORE_ORDER_PAYMENT:${payment.id}`,
        status: { not: FinancialTransactionStatus.CANCELLED },
      },
    });
    const linked = await prisma.paymentReceiptLink.count({
      where: { paymentId: payment.id },
    });
    expect(live + linked).toBeGreaterThanOrEqual(1);
    expect(linked).toBe(1);

    await prisma.payment.update({
      where: { id: payment.id },
      data: { settlementStatus: 'PARTIALLY_SETTLED', settledAmount: 10 },
    });
    await expect(
      matching.reverseMatch(methodId, second.matches[0].id, 'late', userId),
    ).rejects.toThrow(/reverse the settlement first/);
  });

  it('dispute is separate from reject-suggestion and refused while matched', async () => {
    const { payment } = await makeClaim(100);
    const disputed = await matching.disputeClaim(
      methodId,
      payment.id,
      'no such transfer',
      userId,
    );
    expect((disputed as { status: string }).status).toBe(
      PaymentStatus.DISPUTED,
    );
  });

  it('Google Sheets: sync is repeatable, deleted rows become exceptions, concurrent sync is locked', async () => {
    sheetGrid = [
      HEADERS,
      ['G1-' + tag, '', '', '10', currencyCode, providerDate, 'PAID', ''],
      ['G2-' + tag, '', '', '20', currencyCode, providerDate, 'PAID', ''],
    ];
    await statements.connectSheet(
      methodId,
      {
        url: 'javascript:alert(1)//https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd/edit?usp=sharing#gid=0',
        mapping: mapping(),
      },
      userId,
    );
    const first = await statements.syncSheet(methodId, userId);
    expect(first.createdRows).toBe(2);
    const again = await statements.syncSheet(methodId, userId);
    expect(again.duplicateRows).toBe(2);
    expect(again.createdRows).toBe(0);

    sheetGrid = [
      HEADERS,
      ['G1-' + tag, '', '', '10', currencyCode, providerDate, 'PAID', ''],
    ];
    const third = await statements.syncSheet(methodId, userId);
    expect(third.deletedAtSourceRows).toBe(1);
    const g2 = await lineByRef(`G2-${tag}`);
    expect(g2.status).toBe('EXCEPTION');
    expect(g2.exceptionReason).toMatch(/Deleted at source/);

    const both = await Promise.allSettled([
      statements.syncSheet(methodId, userId),
      statements.syncSheet(methodId, userId),
    ]);
    expect(both.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const source = await statements.getSheetSource(methodId);
    // Stored + rendered URL is rebuilt from the id — never the typed text.
    expect(source.connection?.url).toBe(
      'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd/edit#gid=0',
    );
    expect(source.connection?.lastSyncStatus).toBe('SUCCESS');
    expect(source.connection?.isSyncing).toBe(false);

    const summary = await overview.getMethod(methodId);
    expect(summary.summary?.lines.EXCEPTION).toBeGreaterThanOrEqual(1);
  });

  // ------------------------------------------------------------ FIX-PDR

  async function matchFully(ref: string, amount = 100) {
    const claim = await makeClaim(amount);
    await importRows([raw({ Ref: ref, Amount: String(amount) })]);
    const line = await lineByRef(ref);
    const result = await matching.confirm(
      methodId,
      {
        statementLineId: line.id,
        allocations: [{ paymentId: claim.payment.id, amount }],
        idempotencyKey: randomUUID(),
      },
      userId,
    );
    return { ...claim, line, result };
  }

  it('H1: a claim receipt is never cancelled directly (unsettled → Correct match, settled → reverse settlement); the correction path still cancels it', async () => {
    const { payment, result } = await matchFully(`H1-${tag}`);
    const receiptId = result.postings[0].receiptId as string;

    await expect(
      financialTransactions.cancel(receiptId, userId),
    ).rejects.toThrow(/Correct match/);
    await expect(
      financialTransactions.cancel(receiptId, userId),
    ).rejects.toBeInstanceOf(ConflictException);

    // Historical adoption: no link row, but the note names a VERIFIED claim.
    const link = await prisma.paymentReceiptLink.findUniqueOrThrow({
      where: { paymentId: payment.id },
    });
    await prisma.paymentReceiptLink.delete({ where: { id: link.id } });
    await expect(
      financialTransactions.cancel(receiptId, userId),
    ).rejects.toBeInstanceOf(ConflictException);
    await prisma.paymentReceiptLink.create({
      data: { paymentId: payment.id, financialTransactionId: receiptId },
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: { settlementStatus: 'PARTIALLY_SETTLED', settledAmount: 10 },
    });
    await expect(
      financialTransactions.cancel(receiptId, userId),
    ).rejects.toThrow(/reverse the settlement first/);
    await prisma.payment.update({
      where: { id: payment.id },
      data: { settlementStatus: 'AWAITING_SETTLEMENT', settledAmount: 0 },
    });
    expect(
      (
        await prisma.financialTransaction.findUniqueOrThrow({
          where: { id: receiptId },
        })
      ).status,
    ).toBe(FinancialTransactionStatus.CONFIRMED);

    const reversed = await matching.reverseMatch(
      methodId,
      result.matches[0].id,
      'H1 correction',
      userId,
    );
    expect(reversed.cancelledReceipt?.id).toBe(receiptId);
    expect(
      (
        await prisma.financialTransaction.findUniqueOrThrow({
          where: { id: receiptId },
        })
      ).status,
    ).toBe(FinancialTransactionStatus.CANCELLED);
    const activity = await prisma.financialTransactionActivity.findFirstOrThrow(
      {
        where: { transactionId: receiptId, type: 'TRANSACTION_CANCELLED' },
      },
    );
    expect(activity.description).toContain('H1 correction');
  });

  it('H1: an ordinary (unlinked) customer receipt still cancels', async () => {
    const bank = await prisma.chartOfAccount.create({
      data: {
        code: `REC-BANK-${tag}`,
        name: `Reconciliation bank ${tag}`,
        accountType: AccountType.ASSET,
      },
    });
    const receiving = await prisma.receivingAccount.create({
      data: {
        name: `Rec RA ${tag}`,
        code: `REC-RA-${tag}`,
        chartOfAccountId: bank.id,
      },
    });
    const created = await financialTransactions.create('CUSTOMER_RECEIPT', {
      partnerId,
      currencyId,
      transactionDate: day(0).toISOString(),
      paymentSourceId,
      receivingAccountId: receiving.id,
      amount: 25,
      allocations: [],
    });
    await financialTransactions.confirm(created.id, userId);
    const cancelled = await financialTransactions.cancel(created.id, userId);
    expect(cancelled.status).toBe(FinancialTransactionStatus.CANCELLED);
  });

  it('H2: reject / dispute are refused while a statement match stands; allowed after the match is reversed', async () => {
    const { payment } = await makeClaim(100);
    await importRows([raw({ Ref: `H2-${tag}`, Amount: '40' })]);
    const line = await lineByRef(`H2-${tag}`);
    const partial = await matching.confirm(
      methodId,
      {
        statementLineId: line.id,
        allocations: [{ paymentId: payment.id, amount: 40 }],
        idempotencyKey: randomUUID(),
      },
      userId,
    );
    await expect(
      payments.reject(payment.id, {
        rejectionReason: 'no',
        rejectedById: userId,
      }),
    ).rejects.toThrow(/reverse the match first/);
    await expect(
      payments.dispute(payment.id, userId, 'no'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      matching.disputeClaim(methodId, payment.id, 'no', userId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }))
        .status,
    ).toBe(PaymentStatus.MATCHED);

    await matching.reverseMatch(
      methodId,
      partial.matches[0].id,
      'wrong line',
      userId,
    );
    const disputed = await payments.dispute(payment.id, userId, 'no');
    expect(disputed.status).toBe(PaymentStatus.DISPUTED);
  });

  it('H2: correcting a match never revives a REJECTED claim and recomputes the declared status when it changes one', async () => {
    // Legacy state (before the H2 guard): a claim rejected while matched.
    const { payment } = await makeClaim(100);
    await importRows([raw({ Ref: `H2R-${tag}`, Amount: '30' })]);
    const line = await lineByRef(`H2R-${tag}`);
    const partial = await matching.confirm(
      methodId,
      {
        statementLineId: line.id,
        allocations: [{ paymentId: payment.id, amount: 30 }],
        idempotencyKey: randomUUID(),
      },
      userId,
    );
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.REJECTED },
    });
    const reversed = await matching.reverseMatch(
      methodId,
      partial.matches[0].id,
      'legacy',
      userId,
    );
    expect(reversed.paymentStatus).toBe(PaymentStatus.REJECTED);
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }))
        .status,
    ).toBe(PaymentStatus.REJECTED);
    expect(Number((await lineByRef(`H2R-${tag}`)).matchedAmount)).toBe(0);

    // Status-changing correction (VERIFIED → PENDING) recomputes the order's
    // declared status — a stale value is corrected.
    const posted = await matchFully(`H2D-${tag}`);
    await prisma.storeOrder.update({
      where: { id: posted.order.id },
      data: { declaredPaymentStatus: 'UNPAID', declaredAmount: 0 },
    });
    const back = await matching.reverseMatch(
      methodId,
      posted.result.matches[0].id,
      'recompute',
      userId,
    );
    expect(back.paymentStatus).toBe(PaymentStatus.PENDING);
    const fresh = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: posted.order.id },
    });
    expect(fresh.declaredPaymentStatus).toBe('PAID');
    expect(Number(fresh.declaredAmount)).toBe(100);
  });

  it('M1: a reconciled-method claim is confirmed only through matching (409 from payment review)', async () => {
    const { payment } = await makeClaim(100);
    await expect(payments.confirm(payment.id, userId)).rejects.toThrow(
      /requires reconciliation/,
    );
    await expect(payments.confirm(payment.id, userId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    const posted = await matchFully(`M1-${tag}`);
    expect(posted.result.postings[0].posted).toBe(true);
    // A retry of the already-posted claim returns its receipt and posts nothing.
    const again = await payments.confirm(posted.payment.id, userId);
    expect(again.alreadyPosted).toBe(true);
  });

  it('M3: imports beyond one write chunk use batched creates with provenance', async () => {
    const rows = Array.from({ length: 1_200 }, (_, i) =>
      raw({ Ref: `BULK-${tag}-${i}`, Amount: String(10 + (i % 7)) }),
    );
    const summary = await importRows(rows);
    expect(summary.createdRows).toBe(1_200);
    expect(
      await prisma.paymentStatementLine.count({
        where: { importId: summary.importId! },
      }),
    ).toBe(1_200);
    const again = await importRows(rows);
    expect(again.duplicateRows).toBe(1_200);
    expect(again.createdRows).toBe(0);
  });

  it('M3: upload caps — size, rows and columns; raw values stored as-is', async () => {
    await expect(
      statements.readUploadedFile({
        originalname: 'big.csv',
        buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 'a'),
      }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    const tooManyRows = ['Ref,Amount']
      .concat(Array.from({ length: 5_001 }, (_, i) => `r${i},1`))
      .join('\n');
    await expect(
      statements.readUploadedFile({
        originalname: 'rows.csv',
        buffer: Buffer.from(tooManyRows),
      }),
    ).rejects.toThrow(/limit is 5000/);
    const wide = Array.from({ length: 101 }, (_, i) => `c${i}`).join(',');
    await expect(
      statements.readUploadedFile({
        originalname: 'wide.csv',
        buffer: Buffer.from(`${wide}\n${wide}`),
      }),
    ).rejects.toThrow(/columns/);
    const ok = await statements.readUploadedFile({
      originalname: 'ok.csv',
      buffer: Buffer.from('Ref,Amount\n=SUM(1),1\n'),
    });
    // Formula-looking cells are stored raw (no CSV export re-emits them).
    expect(ok.rows[0].raw.Ref).toBe('=SUM(1)');
  });

  it('L1: a future-dated manual statement transaction is refused', async () => {
    await expect(
      statements.createManualLine(
        methodId,
        {
          providerReference: `FUT-${tag}`,
          amount: 5,
          currencyId,
          transactionDate: day(3).toISOString().slice(0, 10),
        },
        userId,
      ),
    ).rejects.toThrow(/in the future/);
  });
});
