import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import {
  AccountType,
  JournalEntryStatus,
  PartnerRoleType,
} from '@prisma/client';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsCoreModule } from '../../permissions/permissions-core.module';
import { PhoneModule } from '../../common/phone/phone.module';
import { AuthModule } from '../../auth/auth.module';
import { PostingProvidersModule } from '../posting-providers/posting-providers.module';
import { FinancialTransactionsModule } from '../../financial-transactions/financial-transactions.module';
import { FinancialTransactionsService } from '../../financial-transactions/financial-transactions.service';
import { FxModule } from './fx.module';
import { FxCorrectionService } from './fx-correction.service';
import { ExchangeRatesService } from './exchange-rates.service';

/**
 * Regression for the EGP 1,300 → 16,900 receipt: a foreign-currency
 * Customer Receipt must post at its snapshotted rate and record that rate
 * on the Journal Entry, and a receipt posted at a wrong rate is corrected
 * only by an audited reverse + re-post (dry-run first changes nothing).
 * Runs against the real local Postgres.
 */
describe('FX receipt posting + audited FX correction', () => {
  jest.setTimeout(120_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let financialTransactions: FinancialTransactionsService;
  let fxCorrection: FxCorrectionService;

  let currencyId: string;
  let partnerId: string;
  let receivingAccountId: string;
  let paymentSourceId: string;
  const tag = randomUUID().slice(0, 6).toUpperCase();

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        PostingProvidersModule,
        FinancialTransactionsModule,
        FxModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    financialTransactions = moduleRef.get(FinancialTransactionsService);
    fxCorrection = moduleRef.get(FxCorrectionService);

    const functionalId = await moduleRef
      .get(ExchangeRatesService)
      .requireFunctionalCurrencyId();
    const currency = await prisma.currency.create({
      data: { code: `Q${tag}`, name: `FX Test ${tag}` },
    });
    currencyId = currency.id;
    await prisma.exchangeRate.create({
      data: {
        fromCurrencyId: currencyId,
        toCurrencyId: functionalId,
        rate: 0.25,
        effectiveDate: new Date('2020-01-01'),
      },
    });

    const partner = await prisma.partner.create({
      data: {
        partnerNumber: `PT-FXTEST-${tag}`,
        name: `FX Test Customer ${tag}`,
        roles: { create: { role: PartnerRoleType.CUSTOMER } },
      },
    });
    partnerId = partner.id;

    const bank = await prisma.chartOfAccount.create({
      data: {
        code: `FXTEST-BANK-${tag}`,
        name: 'FX Test Bank',
        accountType: AccountType.ASSET,
      },
    });
    const receiving = await prisma.receivingAccount.create({
      data: {
        name: `FX Test Receiving ${tag}`,
        code: `FXTEST-RA-${tag}`,
        chartOfAccountId: bank.id,
      },
    });
    receivingAccountId = receiving.id;
    const source = await prisma.paymentSource.findFirst({
      where: { isActive: true, deletedAt: null },
    });
    if (!source) throw new Error('Expected a seeded active PaymentSource.');
    paymentSourceId = source.id;
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function receipt(amount: number, forcedRate?: number) {
    const created = await financialTransactions.create('CUSTOMER_RECEIPT', {
      partnerId,
      currencyId,
      transactionDate: new Date().toISOString(),
      paymentSourceId,
      receivingAccountId,
      amount,
      allocations: [],
    });
    if (forcedRate != null) {
      await prisma.financialTransaction.update({
        where: { id: created.id },
        data: { exchangeRate: forcedRate },
      });
    }
    await financialTransactions.confirm(created.id);
    return prisma.journalEntry.findFirstOrThrow({
      where: {
        sourceType: 'CUSTOMER_RECEIPT',
        sourceId: created.id,
        status: JournalEntryStatus.POSTED,
        reversalOfEntryId: null,
      },
      include: { lines: true },
    });
  }

  it('posts a foreign receipt once at its rate and records the rate on the entry', async () => {
    const entry = await receipt(1300);
    expect(Number(entry.exchangeRate)).toBe(0.25);
    expect(Number(entry.totalDebit)).toBe(325);
    expect(Number(entry.totalCredit)).toBe(325);
  });

  it('dry-run previews the correction and changes nothing; the real run reverses and re-posts', async () => {
    const wrong = await receipt(1300, 13);
    expect(Number(wrong.totalDebit)).toBe(16900);

    const preview = await fxCorrection.repost(wrong.id, {
      reason: 'Test: posted at inverted rate',
      dryRun: true,
    });
    expect(preview.dryRun).toBe(true);
    expect(preview.previousRate).toBe(13);
    expect(preview.correctedRate).toBe(0.25);
    expect(
      preview.corrected!.lines.reduce((sum, line) => sum + line.debit, 0),
    ).toBe(325);
    const untouched = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: wrong.id },
    });
    expect(untouched.status).toBe(JournalEntryStatus.POSTED);

    const done = await fxCorrection.repost(wrong.id, {
      reason: 'Test: posted at inverted rate',
    });
    const original = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: wrong.id },
    });
    expect(original.status).toBe(JournalEntryStatus.REVERSED);
    const reversal = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: done.reversal!.id },
    });
    expect(reversal.reversalOfEntryId).toBe(wrong.id);
    expect(Number(reversal.totalDebit)).toBe(16900);
    const corrected = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: done.corrected!.id },
    });
    expect(Number(corrected.totalDebit)).toBe(325);
    expect(Number(corrected.exchangeRate)).toBe(0.25);
    const audit = await prisma.journalEntryActivity.findMany({
      where: {
        type: 'FX_CORRECTION',
        journalEntryId: { in: [wrong.id, corrected.id] },
      },
    });
    expect(audit).toHaveLength(2);
  });

  it('refuses to correct an entry that is no longer the active posting', async () => {
    const wrong = await receipt(100, 13);
    await fxCorrection.repost(wrong.id, { reason: 'Test: first correction' });
    await expect(
      fxCorrection.repost(wrong.id, { reason: 'Test: second correction' }),
    ).rejects.toThrow(/not an active posted entry/);
  });
});
