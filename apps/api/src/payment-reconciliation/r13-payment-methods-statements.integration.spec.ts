import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  AccountType,
  PartnerRoleType,
  PaymentMatchStatus,
  PaymentOrigin,
  PaymentStatus,
  Prisma,
  StoreOrderPaymentType,
} from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { PostingProvidersModule } from '../accounting/posting-providers/posting-providers.module';
import { FxModule } from '../accounting/fx/fx.module';
import { GoogleSheetsService } from '../import-center/google-sheets.service';
import { BankTransactionsModule } from '../bank-transactions/bank-transactions.module';
import { BankTransactionsService } from '../bank-transactions/bank-transactions.service';
import { CashFlowReconciliationService } from '../bank-transactions/cash-flow-reconciliation.service';
import { resolvePaymentSourceId } from '../store-orders/payment-declaration/payment-declaration.core';
import { ReceivingAccountsModule } from '../receiving-accounts/receiving-accounts.module';
import { ReceivingAccountsService } from '../receiving-accounts/receiving-accounts.service';
import { PaymentReconciliationModule } from './payment-reconciliation.module';
import {
  PaymentStatementsService,
  STATEMENT_MAPPING_TEMPLATE_NAME,
  statementMappingImportType,
} from './payment-statements.service';
import { PaymentMatchingService } from './payment-matching.service';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import type { StatementMappingConfig } from './statement-row.util';

/**
 * R13 spec D — payment method channel (backfill + derivation), reusable statement file mapping,
 * refund / chargeback lines, the one-ACTIVE-allocation index and the cross-engine guard (provider
 * statement ⇄ bank transactions). Real local Postgres, tagged fixtures.
 */
const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(
  process.env.DATABASE_URL ?? '',
);
const describeDb = LOCAL_DB ? describe : describe.skip;

const MIGRATION_SQL = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20261006120000_r13_payment_method_channel/migration.sql',
  ),
  'utf8',
);

/** The migration's two backfill UPDATEs, scoped to the given method ids (never touches other rows). */
function scopedBackfillStatements(methodIds: string[]): string[] {
  const statements = MIGRATION_SQL.split(';')
    .map((part) => part.replace(/^\s*--.*$/gm, '').trim())
    .filter((part) => part.startsWith('UPDATE "payment_methods"'));
  expect(statements).toHaveLength(2);
  const scope = `pm."id" IN (${methodIds.map((id) => `'${id}'::uuid`).join(', ')})`;
  return statements.map((sql) =>
    sql.replace(
      /WHERE pm\."payment_source_id" IS NULL/,
      `WHERE pm."payment_source_id" IS NULL AND ${scope}`,
    ),
  );
}

describeDb('R13 payment methods + statements (local DB)', () => {
  jest.setTimeout(240_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let statements: PaymentStatementsService;
  let matching: PaymentMatchingService;
  let overview: PaymentReconciliationService;
  let bankTransactions: BankTransactionsService;
  let cashFlow: CashFlowReconciliationService;

  const tag = randomUUID().slice(0, 6).toUpperCase();
  let userId: string;
  let currencyId: string;
  let currencyCode: string;
  let partnerId: string;
  let productId: string;
  let methodId: string;
  let fallbackSourceId: string;
  let receivingAccountId: string;
  let seq = 0;

  const today = new Date();
  const providerDate = new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() - 2,
    ),
  )
    .toISOString()
    .slice(0, 10);

  const sheetsMock = {
    resolveSheetTitle: jest.fn(() => Promise.resolve('Statement')),
    getSheetData: jest.fn(() => Promise.resolve([] as string[][])),
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
        PaymentReconciliationModule,
        BankTransactionsModule,
        ReceivingAccountsModule,
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
    bankTransactions = moduleRef.get(BankTransactionsService);
    cashFlow = moduleRef.get(CashFlowReconciliationService);

    userId = (
      await prisma.user.create({
        data: {
          email: `r13d-${tag.toLowerCase()}@test.local`,
          username: `r13d-${tag.toLowerCase()}`,
          fullName: `R13 D ${tag}`,
          passwordHash: 'x',
        },
      })
    ).id;
    currencyCode = `D${tag}`;
    currencyId = (
      await prisma.currency.create({
        data: { code: currencyCode, name: `R13 D ${tag}` },
      })
    ).id;
    partnerId = (
      await prisma.partner.create({
        data: {
          partnerNumber: `PT-R13D-${tag}`,
          name: `R13 D Customer ${tag}`,
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
    const fallback = await prisma.paymentSource.findFirst({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
      select: { id: true },
    });
    if (!fallback) throw new Error('Expected an active payment source.');
    fallbackSourceId = fallback.id;

    const clearing = await prisma.chartOfAccount.create({
      data: {
        code: `R13D-CLR-${tag}`,
        name: `R13 D Clearing ${tag}`,
        accountType: AccountType.ASSET,
      },
    });
    methodId = (
      await prisma.paymentMethod.create({
        data: {
          name: `R13 D Method ${tag}`,
          accountId: clearing.id,
          requiresReconciliation: true,
        },
      })
    ).id;
    const bank = await prisma.chartOfAccount.create({
      data: {
        code: `R13D-BNK-${tag}`,
        name: `R13 D Bank ${tag}`,
        accountType: AccountType.ASSET,
      },
    });
    receivingAccountId = (
      await prisma.receivingAccount.create({
        data: {
          name: `R13 D Bank ${tag}`,
          code: `R13D-${tag}`,
          chartOfAccountId: bank.id,
          currencyId,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function makeClaim(amount = 100) {
    seq += 1;
    const order = await prisma.storeOrder.create({
      data: {
        internalOrderId: `SO-R13D-${tag}-${seq}`,
        partnerId,
        currencyId,
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
        paymentNumber: `PAY-R13D-${tag}-${seq}`,
        storeOrderId: order.id,
        paymentDate: new Date(`${providerDate}T00:00:00.000Z`),
        amount,
        currencyId,
        paymentSourceId: fallbackSourceId,
        paymentMethodId: methodId,
        origin: PaymentOrigin.SALES_DECLARATION,
        senderName: `R13 D Customer ${tag}`,
        status: PaymentStatus.PENDING,
      },
    });
    return { order, payment };
  }

  function csv(headers: string[], rows: string[][]) {
    const text = [headers, ...rows].map((r) => r.join(',')).join('\n');
    return { originalname: `r13d-${tag}.csv`, buffer: Buffer.from(text) };
  }

  const PROVIDER_HEADERS = [
    'Col Ref',
    'Col Gross',
    'Col Ccy',
    'Col When',
    'Col State',
  ];
  const providerMapping = (): StatementMappingConfig => ({
    columns: {
      providerReference: 'Col Ref',
      amount: 'Col Gross',
      currency: 'Col Ccy',
      transactionDate: 'Col When',
      providerStatus: 'Col State',
    },
    dateFormat: 'YMD',
    defaultCurrencyCode: null,
    phoneRegion: null,
  });

  async function lineByKey(dedupeKey: string) {
    return prisma.paymentStatementLine.findUniqueOrThrow({
      where: {
        paymentMethodId_dedupeKey: { paymentMethodId: methodId, dedupeKey },
      },
    });
  }

  it('D1 migration backfill: name match (trimmed, case-insensitive) else the default source', async () => {
    const rolledBack = new Error('rollback');
    let outcome: Record<string, string | null> = {};
    await prisma
      .$transaction(async (tx) => {
        const named = await tx.paymentSource.create({
          data: { name: `Chan ${tag}`, isActive: true },
        });
        const fallback = await tx.paymentSource.create({
          data: {
            name: `Default ${tag}`,
            isActive: true,
            isDefault: true,
            sortOrder: -100000,
          },
        });
        const byName = await tx.paymentMethod.create({
          data: { name: `  chan ${tag.toLowerCase()} ` },
        });
        const other = await tx.paymentMethod.create({
          data: { name: `Unmatched ${tag}` },
        });
        for (const sql of scopedBackfillStatements([byName.id, other.id])) {
          await tx.$executeRawUnsafe(sql);
        }
        const rows = await tx.paymentMethod.findMany({
          where: { id: { in: [byName.id, other.id] } },
          select: { id: true, paymentSourceId: true },
        });
        const get = (id: string) =>
          rows.find((r) => r.id === id)?.paymentSourceId ?? null;
        outcome = {
          byName: get(byName.id),
          expectedByName: named.id,
          other: get(other.id),
          expectedOther: fallback.id,
        };
        throw rolledBack;
      })
      .catch((error: unknown) => {
        if (error !== rolledBack) throw error;
      });
    expect(outcome.byName).toBe(outcome.expectedByName);
    expect(outcome.other).toBe(outcome.expectedOther);
  });

  it('D1 declaration derives the source from the method channel, then the default; explicit input wins', async () => {
    const channel = await prisma.paymentSource.create({
      data: { name: `Channel ${tag}`, isActive: true },
    });
    const explicit = await prisma.paymentSource.create({
      data: { name: `Explicit ${tag}`, isActive: true },
    });
    const method = await prisma.paymentMethod.create({
      data: { name: `Channel Method ${tag}`, paymentSourceId: channel.id },
    });
    // A source with the method's exact name must NOT be picked any more (no name matching).
    const sameName = await prisma.paymentMethod.create({
      data: { name: `Explicit ${tag}` },
    });
    const resolve = (input: {
      paymentSourceId?: string;
      paymentMethodId?: string;
    }) => prisma.$transaction((tx) => resolvePaymentSourceId(tx, input));

    expect(await resolve({ paymentMethodId: method.id })).toBe(channel.id);
    expect(
      await resolve({
        paymentMethodId: method.id,
        paymentSourceId: explicit.id,
      }),
    ).toBe(explicit.id);
    expect(await resolve({ paymentMethodId: sameName.id })).toBe(
      fallbackSourceId,
    );

    await prisma.paymentSource.update({
      where: { id: channel.id },
      data: { isActive: false },
    });
    expect(await resolve({ paymentMethodId: method.id })).toBe(
      fallbackSourceId,
    );
  });

  it('D1 receiving accounts: generated code, posting-account check, paginated master-data list', async () => {
    const receiving = moduleRef.get(ReceivingAccountsService);
    const leaf = await prisma.chartOfAccount.create({
      data: {
        code: `R13D-RA-${tag}`,
        name: `R13 D RA ${tag}`,
        accountType: AccountType.ASSET,
      },
    });
    const created = await receiving.create(
      { name: `R13 D Wallet ${tag}`, chartOfAccountId: leaf.id, currencyId },
      userId,
    );
    expect(created.code).toMatch(/^RA-\d{4,}$/);
    const second = await receiving.create(
      { name: `R13 D Wallet 2 ${tag}`, chartOfAccountId: leaf.id },
      userId,
    );
    expect(Number(second.code.slice(3))).toBe(
      Number(created.code.slice(3)) + 1,
    );

    const header = await prisma.chartOfAccount.create({
      data: {
        code: `R13D-RAH-${tag}`,
        name: `R13 D RA Header ${tag}`,
        accountType: AccountType.ASSET,
        allowsPosting: false,
      },
    });
    await expect(
      receiving.create(
        { name: `R13 D Bad ${tag}`, chartOfAccountId: header.id },
        userId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    const page = await receiving.findAll({
      search: `R13 D Wallet`,
      pageSize: 50,
    });
    expect(page.items.map((row) => row.id)).toEqual(
      expect.arrayContaining([created.id, second.id]),
    );
    await receiving.archive(second.id, userId);
    const afterArchive = await receiving.findAll({
      search: `R13 D Wallet 2 ${tag}`,
    });
    expect(afterArchive.total).toBe(0);
  });

  it('D2 file import saves its mapping, reuses it next time, re-import is idempotent; refunds become REFUND lines', async () => {
    const file = csv(PROVIDER_HEADERS, [
      [`F1-${tag}`, '150', currencyCode, providerDate, 'Captured'],
      [`F2-${tag}`, '80', currencyCode, providerDate, 'Captured'],
      [`F1-${tag}`, '-50', currencyCode, providerDate, 'Refunded'],
      [`F3-${tag}`, '30', currencyCode, providerDate, 'Chargeback'],
    ]);

    // No saved mapping yet: the unusual headers cannot be guessed.
    const first = await statements.previewFile(methodId, file, null);
    expect(first.mappingSource).toBe('SUGGESTED');
    expect(first.mappingErrors.length).toBeGreaterThan(0);

    const committed = await statements.commitFile(
      methodId,
      file,
      providerMapping(),
      userId,
    );
    expect(committed.createdRows).toBe(4);
    expect(committed.errorRows).toBe(0);

    const template = await prisma.importMappingTemplate.findUniqueOrThrow({
      where: {
        importType_name: {
          importType: statementMappingImportType(methodId),
          name: STATEMENT_MAPPING_TEMPLATE_NAME,
        },
      },
    });
    expect(template.columnMapping).toMatchObject({
      amount: 'Col Gross',
      $dateFormat: 'YMD',
    });

    // Next file of this method: the saved mapping is pre-applied (and still editable by the caller).
    const next = await statements.previewFile(methodId, file, null);
    expect(next.mappingSource).toBe('SAVED');
    expect(next.mappingErrors).toEqual([]);
    expect(next.mapping.columns).toEqual(providerMapping().columns);
    expect(next.summary?.duplicateRows).toBe(4);
    // A file whose columns do not fit the saved mapping falls back to the header guess.
    const otherFile = csv(
      ['Reference', 'Amount', 'Currency', 'Date'],
      [[`G1-${tag}`, '10', currencyCode, providerDate]],
    );
    const guessed = await statements.previewFile(methodId, otherFile, null);
    expect(guessed.mappingSource).toBe('SUGGESTED');

    // Re-importing the same file changes nothing.
    const before = await prisma.paymentStatementLine.count({
      where: { paymentMethodId: methodId },
    });
    const again = await statements.commitFile(
      methodId,
      file,
      providerMapping(),
      userId,
    );
    expect(again.createdRows).toBe(0);
    expect(again.updatedRows).toBe(0);
    expect(again.duplicateRows).toBe(4);
    expect(
      await prisma.paymentStatementLine.count({
        where: { paymentMethodId: methodId },
      }),
    ).toBe(before);

    // The refund shares the payment's reference but never overwrites it; amounts stay positive.
    const payment = await lineByKey(`ref:F1-${tag}`);
    const refund = await lineByKey(`refund:ref:F1-${tag}`);
    const chargeback = await lineByKey(`chargeback:ref:F3-${tag}`);
    expect(payment.kind).toBe('PAYMENT');
    expect(Number(payment.amount)).toBe(150);
    expect(refund.kind).toBe('REFUND');
    expect(Number(refund.amount)).toBe(50);
    expect(chargeback.kind).toBe('CHARGEBACK');

    // Net totals: payments 230 − refunds / chargebacks 80 = 150; refunds are not "unmatched" work.
    const method = await overview.getMethod(methodId);
    const summary = method.summary!;
    expect(summary.statementPaymentsByCurrency[currencyCode].amount).toBe(230);
    expect(summary.statementRefundsByCurrency[currencyCode].amount).toBe(80);
    expect(summary.statementNetByCurrency[currencyCode].amount).toBe(150);
    expect(summary.refundLines).toBe(2);
    expect(summary.unmatchedByCurrency[currencyCode].count).toBe(2);
    const listed = await overview.listLines(methodId, { kind: 'REFUND' });
    expect(listed.items.map((l) => l.id)).toEqual([refund.id]);
  });

  it('D2 refund / chargeback lines take no suggestions and are refused by matching', async () => {
    const { payment } = await makeClaim(50);
    const refund = await lineByKey(`refund:ref:F1-${tag}`);
    const suggestions = await matching.suggestions(methodId, refund.id);
    expect(suggestions.blockedCode).toBe('NOT_A_PAYMENT');
    expect(suggestions.candidates).toEqual([]);
    await expect(
      matching.confirm(
        methodId,
        {
          statementLineId: refund.id,
          allocations: [{ paymentId: payment.id, amount: 50 }],
          idempotencyKey: randomUUID(),
        },
        userId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      await prisma.paymentMatch.count({
        where: { statementLineId: refund.id },
      }),
    ).toBe(0);
    // The DB refuses an allocation on a non-payment line too.
    await expect(
      prisma.paymentStatementLine.update({
        where: { id: refund.id },
        data: { matchedAmount: 10 },
      }),
    ).rejects.toThrow(/payment_statement_lines_kind_unmatched/);
  });

  it('D2 one ACTIVE allocation per (line, claim): the index refuses a duplicate; a top-up merges', async () => {
    const { payment } = await makeClaim(100);
    const line = await lineByKey(`ref:F1-${tag}`); // 150, unmatched
    await matching.confirm(
      methodId,
      {
        statementLineId: line.id,
        allocations: [{ paymentId: payment.id, amount: 30 }],
        idempotencyKey: randomUUID(),
      },
      userId,
    );
    await matching.confirm(
      methodId,
      {
        statementLineId: line.id,
        allocations: [{ paymentId: payment.id, amount: 20 }],
        idempotencyKey: randomUUID(),
      },
      userId,
    );
    const active = await prisma.paymentMatch.findMany({
      where: {
        statementLineId: line.id,
        paymentId: payment.id,
        status: PaymentMatchStatus.ACTIVE,
      },
    });
    expect(active).toHaveLength(1);
    expect(Number(active[0].amount)).toBe(50);
    expect(Number((await lineByKey(`ref:F1-${tag}`)).matchedAmount)).toBe(50);

    const duplicate = prisma.paymentMatch.create({
      data: { statementLineId: line.id, paymentId: payment.id, amount: 1 },
    });
    await expect(duplicate).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    await expect(
      prisma.paymentMatch.create({
        data: { statementLineId: line.id, paymentId: payment.id, amount: 1 },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    // Reversed history rows are not constrained.
    await prisma.paymentMatch.createMany({
      data: [1, 2].map(() => ({
        statementLineId: line.id,
        paymentId: payment.id,
        amount: 1,
        status: PaymentMatchStatus.REVERSED,
      })),
    });
  });

  it('D2 cross-engine: a provider-matched claim is refused by bank reconciliation (adopt + confirm)', async () => {
    // (a) The bank line would adopt the order's open claim — but it is allocated on the statement.
    const { order, payment } = await makeClaim(80);
    const line = await lineByKey(`ref:F2-${tag}`); // 80
    await matching.confirm(
      methodId,
      {
        statementLineId: line.id,
        allocations: [{ paymentId: payment.id, amount: 40 }],
        idempotencyKey: randomUUID(),
      },
      userId,
    );
    const incoming = await bankTransactions.upsertFromImport({
      fingerprint: `fp-${randomUUID()}`,
      transactionId: `TXN-R13D-${randomUUID()}`,
      transactionDate: new Date(),
      amount: 80,
      currencyId,
      cashSourceId: receivingAccountId,
      direction: 'INCOMING',
    });
    const paymentsBefore = await prisma.payment.count({
      where: { storeOrderId: order.id },
    });
    await expect(
      cashFlow.confirmStoreOrderPayment(
        incoming.id,
        { storeOrderId: order.id, paymentSourceId: fallbackSourceId },
        userId,
      ),
    ).rejects.toThrow(/already matched on its provider statement/);
    expect(
      await prisma.payment.count({ where: { storeOrderId: order.id } }),
    ).toBe(paymentsBefore);
    expect(
      (
        await prisma.bankTransaction.findUniqueOrThrow({
          where: { id: incoming.id },
        })
      ).matchedPaymentId,
    ).toBeNull();

    // (b) Direct "Confirm Match" on a claim holding an ACTIVE allocation (defence in depth).
    const pending = await makeClaim(25);
    const spare = await lineByKey(`ref:F2-${tag}`);
    await prisma.paymentMatch.create({
      data: {
        statementLineId: spare.id,
        paymentId: pending.payment.id,
        amount: 5,
      },
    });
    const other = await bankTransactions.upsertFromImport({
      fingerprint: `fp-${randomUUID()}`,
      transactionId: `TXN-R13D-${randomUUID()}`,
      transactionDate: new Date(),
      amount: 25,
      currencyId,
      cashSourceId: receivingAccountId,
      direction: 'INCOMING',
    });
    await expect(
      bankTransactions.confirmMatch(
        other.id,
        { paymentId: pending.payment.id },
        userId,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      (
        await prisma.payment.findUniqueOrThrow({
          where: { id: pending.payment.id },
        })
      ).status,
    ).toBe(PaymentStatus.PENDING);
  });

  it('D2 cross-engine: a bank-matched claim is never suggested nor allocated on a provider statement', async () => {
    const { payment } = await makeClaim(70);
    const incoming = await bankTransactions.upsertFromImport({
      fingerprint: `fp-${randomUUID()}`,
      transactionId: `TXN-R13D-${randomUUID()}`,
      transactionDate: new Date(),
      amount: 70,
      currencyId,
      cashSourceId: receivingAccountId,
      direction: 'INCOMING',
    });
    await bankTransactions.confirmMatch(
      incoming.id,
      { paymentId: payment.id },
      userId,
    );

    await statements.createManualLine(
      methodId,
      {
        providerReference: `BK-${tag}`,
        amount: 70,
        currencyId,
        transactionDate: providerDate,
      },
      userId,
    );
    const line = await lineByKey(`ref:BK-${tag}`);
    const suggestions = await matching.suggestions(methodId, line.id);
    expect(suggestions.candidates.map((c) => c.paymentId)).not.toContain(
      payment.id,
    );
    const search = await matching.searchClaims(methodId, {
      search: payment.paymentNumber,
    });
    expect(search.map((c) => c.id)).not.toContain(payment.id);
    await expect(
      matching.confirm(
        methodId,
        {
          statementLineId: line.id,
          allocations: [{ paymentId: payment.id, amount: 70 }],
          idempotencyKey: randomUUID(),
        },
        userId,
      ),
    ).rejects.toThrow(/already reconciled to bank transaction/);
    expect(
      await prisma.paymentMatch.count({ where: { paymentId: payment.id } }),
    ).toBe(0);
  });
});
