import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import {
  AccountType,
  CapitalReturnStatus,
  JournalEntryStatus,
} from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { PostingProvidersModule } from '../accounting/posting-providers/posting-providers.module';
import { FiscalPeriodsModule } from '../accounting/fiscal-periods/fiscal-periods.module';
import { FiscalYearsService } from '../accounting/fiscal-periods/fiscal-years.service';
import { AccountingPeriodsService } from '../accounting/fiscal-periods/accounting-periods.service';
import { CapitalReturnsModule } from './capital-returns.module';
import { CapitalReturnCorrectionService } from './capital-return-correction.service';
import { YearClosingModule } from '../accounting/year-closing/year-closing.module';
import { YearClosingService } from '../accounting/year-closing/year-closing.service';

/**
 * Capital Return principal repayments that were posted to an EXPENSE
 * account (legacy mapping to 551) are corrected by an audited reverse +
 * re-post against Investor Funding — never by editing the posted rows.
 * Legacy-shaped entries are created as fixtures (the provider can no
 * longer produce them). Real local Postgres; `pnpm test:serial`.
 */
describe('Capital Return correction (expense → Investor Funding)', () => {
  jest.setTimeout(120_000);
  const tag = randomUUID().slice(0, 6).toUpperCase();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let corrections: CapitalReturnCorrectionService;
  let expenseId: string;
  let bankId: string;
  let fundingId: string;
  const returnIds: string[] = [];
  let closedYearId: string;
  let fiscalYears: FiscalYearsService;
  let periods: AccountingPeriodsService;

  async function legacyReturn(amount: number, entryDate: Date) {
    const subscription = await prisma.investorSubscription.findFirstOrThrow({
      select: { id: true, investorId: true },
    });
    const doc = await prisma.capitalReturn.create({
      data: {
        code: `CRET-YCT-${tag}-${returnIds.length}`,
        investorId: subscription.investorId,
        subscriptionId: subscription.id,
        amount,
        date: entryDate,
        financialAccountId: bankId,
        status: CapitalReturnStatus.PAID,
        paidAt: entryDate,
      },
      include: { investor: { select: { partnerId: true } } },
    });
    returnIds.push(doc.id);
    return prisma.journalEntry.create({
      data: {
        entryNumber: `YCT-CR-${tag}-${returnIds.length}`,
        entryDate,
        status: JournalEntryStatus.POSTED,
        postedAt: entryDate,
        sourceType: 'CAPITAL_RETURN',
        sourceId: doc.id,
        totalDebit: amount,
        totalCredit: amount,
        lines: {
          create: [
            {
              accountId: expenseId,
              debit: amount,
              credit: 0,
              partnerId: doc.investor.partnerId,
              lineOrder: 0,
            },
            { accountId: bankId, debit: 0, credit: amount, lineOrder: 1 },
          ],
        },
      },
    });
  }

  async function cleanup() {
    const where = { sourceType: 'CAPITAL_RETURN', sourceId: { in: returnIds } };
    await prisma.journalEntryActivity.deleteMany({
      where: { journalEntry: where },
    });
    await prisma.journalEntry.deleteMany({
      where: { ...where, reversalOfEntryId: { not: null } },
    });
    await prisma.journalEntry.deleteMany({ where });
    await prisma.capitalReturn.deleteMany({ where: { id: { in: returnIds } } });
    if (closedYearId) {
      const closingWhere = {
        sourceType: { in: ['YEAR_CLOSING', 'OPENING_BALANCE'] },
        sourceId: closedYearId,
      };
      await prisma.journalEntryActivity.deleteMany({
        where: { journalEntry: closingWhere },
      });
      await prisma.journalEntry.deleteMany({ where: closingWhere });
      await prisma.accountingPeriod.deleteMany({
        where: { fiscalYearId: closedYearId },
      });
      await prisma.fiscalYear.delete({ where: { id: closedYearId } });
    }
    await prisma.chartOfAccount.deleteMany({
      where: { code: { startsWith: `YCT-CRX-${tag}` } },
    });
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        PostingProvidersModule,
        FiscalPeriodsModule,
        CapitalReturnsModule,
        YearClosingModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    corrections = moduleRef.get(CapitalReturnCorrectionService);
    const settings = await prisma.postingSettings.findFirstOrThrow();
    fundingId = settings.investorFundingAccountId!;
    expenseId = (
      await prisma.chartOfAccount.create({
        data: {
          code: `YCT-CRX-${tag}-551`,
          name: 'Legacy Capital Return (expense)',
          accountType: AccountType.EXPENSE,
        },
      })
    ).id;
    bankId = (
      await prisma.chartOfAccount.create({
        data: {
          code: `YCT-CRX-${tag}-BANK`,
          name: 'Test bank',
          accountType: AccountType.ASSET,
        },
      })
    ).id;

    // FY1990: June closed, the rest open ("original period closed" case);
    // later fully closed, then Year-Closed.
    fiscalYears = moduleRef.get(FiscalYearsService);
    periods = moduleRef.get(AccountingPeriodsService);
    const year = await fiscalYears.create({
      name: `YCT-CRX-${tag}-1990`,
      startDate: '1990-01-01',
      endDate: '1990-12-31',
    });
    closedYearId = year.id;
    // Fixture go-live opening so 1990 accepts postings (posting gate).
    await prisma.journalEntry.create({
      data: {
        entryNumber: `YCT-CR-${tag}-OB`,
        entryDate: new Date('1990-01-01T00:00:00Z'),
        status: JournalEntryStatus.POSTED,
        sourceType: 'OPENING_BALANCE',
        sourceId: year.id,
        fiscalYearId: year.id,
        totalDebit: 1,
        totalCredit: 1,
        lines: {
          create: [
            { accountId: bankId, debit: 1, credit: 0, lineOrder: 0 },
            { accountId: expenseId, debit: 0, credit: 1, lineOrder: 1 },
          ],
        },
      },
    });
    await periods.close(year.periods[5].id);
  });

  afterAll(async () => {
    if (prisma) await cleanup();
    await moduleRef?.close();
  });

  it('dry-run changes nothing; the real run reverses and re-posts against Investor Funding once', async () => {
    const today = new Date();
    const open = await legacyReturn(1_500, today);
    const closed = await legacyReturn(800, new Date('1990-06-15T10:00:00Z'));

    const affected = await corrections.listAffected();
    const mine = affected.entries.filter((row) =>
      [open.id, closed.id].includes(row.journalEntryId),
    );
    expect(mine.map((row) => [row.profitEffect, row.dating])).toEqual([
      [800, 'OPEN_PERIOD_SAME_YEAR'],
      [1_500, 'ORIGINAL_PERIOD'],
    ]);

    const countBefore = await prisma.journalEntry.count({
      where: { sourceId: { in: returnIds } },
    });
    const preview = await corrections.correct(open.id, {
      reason: 'Test: principal is not an expense',
      dryRun: true,
    });
    expect(preview.dryRun).toBe(true);
    expect(preview.profitEffect).toBe(1_500);
    expect(preview.corrected?.lines).toEqual([
      expect.objectContaining({ accountType: 'LIABILITY', debit: 1_500 }),
      expect.objectContaining({ credit: 1_500 }),
    ]);
    expect(
      await prisma.journalEntry.count({
        where: { sourceId: { in: returnIds } },
      }),
    ).toBe(countBefore);
    expect(
      (await prisma.journalEntry.findUniqueOrThrow({ where: { id: open.id } }))
        .status,
    ).toBe(JournalEntryStatus.POSTED);

    const done = await corrections.correct(open.id, {
      reason: 'Test: principal is not an expense',
    });
    expect(done.dating).toBe('ORIGINAL_PERIOD');
    const reversal = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: done.reversal!.id },
      include: { lines: true },
    });
    expect(reversal.entryDate.getTime()).toBe(today.getTime());
    expect(reversal.reversalOfEntryId).toBe(open.id);
    const corrected = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: done.corrected!.id },
      include: { lines: true },
    });
    expect(
      corrected.lines.map((l) => [
        l.accountId,
        Number(l.debit),
        Number(l.credit),
      ]),
    ).toEqual([
      [fundingId, 1_500, 0],
      [bankId, 0, 1_500],
    ]);
    // Net effect on the expense account across original + reversal: 0.
    const expenseNet = await prisma.journalEntryLine.aggregate({
      where: {
        accountId: expenseId,
        journalEntry: { sourceId: open.sourceId },
      },
      _sum: { debit: true, credit: true },
    });
    expect(Number(expenseNet._sum.debit) - Number(expenseNet._sum.credit)).toBe(
      0,
    );
    const audit = await prisma.journalEntryActivity.count({
      where: {
        type: 'CAPITAL_RETURN_CORRECTION',
        journalEntryId: { in: [open.id, reversal.id, corrected.id] },
      },
    });
    expect(audit).toBe(3);

    await expect(
      corrections.correct(open.id, { reason: 'Test: second attempt' }),
    ).rejects.toThrow(/not an active posted entry/);

    // Original period (June 1990) closed → dated in the ORIGINAL fiscal
    // year's latest open period (December 1990, its last day) — never in
    // today's fiscal year.
    const late = await corrections.correct(closed.id, {
      reason: 'Test: closed-period original',
    });
    expect(late.dating).toBe('OPEN_PERIOD_SAME_YEAR');
    expect(late.correctionDate.toISOString()).toBe('1990-12-31T00:00:00.000Z');
    const lateReversal = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: late.reversal!.id },
    });
    expect(lateReversal.fiscalYearId).toBe(closedYearId);
    const stillAffected = (await corrections.listAffected()).entries.filter(
      (row) => [open.id, closed.id].includes(row.journalEntryId),
    );
    expect(stillAffected).toHaveLength(0);

    // No open period left in the original year → refused with a clear code.
    const inClosedYear = await legacyReturn(
      300,
      new Date('1990-07-01T10:00:00Z'),
    );
    for (const period of (await fiscalYears.findOne(closedYearId)).periods) {
      if (period.status === 'OPEN') await periods.close(period.id);
    }
    await fiscalYears.close(closedYearId);
    expect(
      (await corrections.listAffected()).entries.find(
        (row) => row.journalEntryId === inClosedYear.id,
      )?.dating,
    ).toBe('BLOCKED_NO_OPEN_PERIOD');
    await expect(
      corrections.correct(inClosedYear.id, {
        reason: 'Test: no open period in the year',
        dryRun: true,
      }),
    ).rejects.toMatchObject({
      response: { code: 'CAPITAL_RETURN_NO_OPEN_PERIOD_IN_YEAR' },
    });

    // Original year already Year-Closed → refused (owner decision needed).
    await moduleRef
      .get(YearClosingService)
      .execute({ fiscalYearId: closedYearId });
    const blocked = (await corrections.listAffected()).entries.find(
      (row) => row.journalEntryId === inClosedYear.id,
    );
    expect(blocked?.dating).toBe('BLOCKED_YEAR_CLOSED');
    await expect(
      corrections.correct(inClosedYear.id, {
        reason: 'Test: year already closed',
        dryRun: true,
      }),
    ).rejects.toMatchObject({
      response: { code: 'CAPITAL_RETURN_YEAR_ALREADY_CLOSED' },
    });
  });
});
