import { JournalEntryStatus, PartnerControlAccountType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingReportsService } from './accounting-reports.service';
import { buildLedgerMovements, type LedgerLineInput } from './ledger-movements';
import { GeneralLedgerQueryDto } from './dto/general-ledger-query.dto';

const cents = (value: number) => Math.round(value * 100);

function line(
  id: string,
  debit: number,
  credit: number,
  entryDate = new Date('2026-01-01'),
): LedgerLineInput {
  return {
    id,
    description: null,
    debit: debit as never,
    credit: credit as never,
    account: {
      id: 'acc',
      code: '1101',
      name: 'Cash',
      nameEn: 'Cash',
      partnerControlType: null,
    },
    partner: null,
    journalEntry: {
      id: `je-${id}`,
      entryNumber: `JV-${id}`,
      entryDate,
      description: 'entry',
      sourceType: 'MANUAL',
      sourceId: null,
      referenceNumber: null,
      status: JournalEntryStatus.POSTED,
      journal: null,
    },
  };
}

describe('buildLedgerMovements', () => {
  it('opening + period movements = closing, debit-positive running balance', () => {
    const result = buildLedgerMovements(
      [line('1', 100, 0), line('2', 0, 30.1), line('3', 0.2, 0)],
      50,
    );
    expect(result.movements.map((m) => m.runningBalance)).toEqual([
      150, 119.9, 120.1,
    ]);
    expect(result.periodDebit).toBe(100.2);
    expect(result.periodCredit).toBe(30.1);
    expect(result.closingBalance).toBe(120.1);
    expect(cents(50 + result.periodDebit - result.periodCredit)).toBe(
      cents(result.closingBalance),
    );
  });

  it('never drifts on binary floating point (0.1 + 0.2)', () => {
    const result = buildLedgerMovements(
      [line('1', 0.1, 0), line('2', 0.2, 0)],
      0,
    );
    expect(result.closingBalance).toBe(0.3);
    expect(result.movements[1].runningBalance).toBe(0.3);
  });

  it('an empty period keeps the opening balance as closing', () => {
    expect(buildLedgerMovements([], -42.5).closingBalance).toBe(-42.5);
  });
});

/**
 * Read-only reconciliation against the local development database: the
 * General Ledger, Account Statement, Trial Balance and Customer/Supplier
 * Statements must agree with each other and with the posted Journal
 * Entries. Never writes. Skipped unless DATABASE_URL points at a local DB.
 */
const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(
  process.env.DATABASE_URL ?? '',
);
const describeDb = LOCAL_DB ? describe : describe.skip;

describeDb('Ledger reports reconcile with Journal Entries (local DB)', () => {
  let prisma: PrismaService;
  let reports: AccountingReportsService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    reports = new AccountingReportsService(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function fullLedger(query: Partial<GeneralLedgerQueryDto>) {
    const items = [];
    let page = 1;
    for (;;) {
      const result = await reports.generalLedger({
        postedOnly: true,
        ...query,
        page,
        pageSize: 200,
      });
      items.push(...result.items);
      if (items.length >= result.total || result.items.length === 0) {
        return { ...result, items };
      }
      page += 1;
    }
  }

  async function windowStart(): Promise<string | undefined> {
    const entries = await prisma.journalEntry.findMany({
      where: {
        deletedAt: null,
        status: {
          in: [JournalEntryStatus.POSTED, JournalEntryStatus.REVERSED],
        },
      },
      select: { entryDate: true },
      orderBy: { entryDate: 'asc' },
    });
    if (entries.length < 2) return undefined;
    const middle = entries[Math.floor(entries.length / 2)].entryDate;
    return middle.toISOString().slice(0, 10);
  }

  it('all-account GL totals equal the Trial Balance and balance (debit = credit)', async () => {
    const [gl, tb] = await Promise.all([
      fullLedger({}),
      reports.trialBalance({ postedOnly: true }),
    ]);
    expect(cents(gl.totals.periodDebit)).toBe(cents(gl.totals.periodCredit));
    expect(cents(gl.totals.periodDebit)).toBe(cents(tb.totals.debitTotal));
    expect(cents(gl.totals.periodCredit)).toBe(cents(tb.totals.creditTotal));
    expect(gl.items.length).toBe(tb.items.length);

    const tbByAccount = new Map(tb.items.map((row) => [row.accountId, row]));
    for (const ledger of gl.items) {
      const row = tbByAccount.get(ledger.account.id);
      expect(row).toBeDefined();
      expect(cents(ledger.closingBalance)).toBe(cents(row!.closingBalance));
      expect(cents(ledger.periodDebit)).toBe(cents(row!.debitTotal));
      expect(cents(ledger.periodCredit)).toBe(cents(row!.creditTotal));
    }
  });

  it('per account over a date window: opening + movements = closing = TB closing', async () => {
    const dateFrom = await windowStart();
    if (!dateFrom) return;
    const dateTo = new Date().toISOString().slice(0, 10);
    const [gl, tb, before] = await Promise.all([
      fullLedger({ dateFrom, dateTo }),
      reports.trialBalance({ postedOnly: true, dateFrom, dateTo }),
      fullLedger({
        dateTo: new Date(new Date(dateFrom).getTime() - 86_400_000)
          .toISOString()
          .slice(0, 10),
      }),
    ]);
    const tbByAccount = new Map(tb.items.map((row) => [row.accountId, row]));
    const closingBefore = new Map(
      before.items.map((l) => [l.account.id, l.closingBalance]),
    );

    for (const ledger of gl.items) {
      const movementsDebit = ledger.movements.reduce((s, m) => s + m.debit, 0);
      const movementsCredit = ledger.movements.reduce(
        (s, m) => s + m.credit,
        0,
      );
      expect(
        cents(ledger.openingBalance + movementsDebit - movementsCredit),
      ).toBe(cents(ledger.closingBalance));
      const last = ledger.movements.at(-1);
      expect(cents(last ? last.runningBalance : ledger.openingBalance)).toBe(
        cents(ledger.closingBalance),
      );
      // Opening of the window = closing of everything before it.
      expect(cents(ledger.openingBalance)).toBe(
        cents(closingBefore.get(ledger.account.id) ?? 0),
      );
      const row = tbByAccount.get(ledger.account.id);
      expect(cents(ledger.openingBalance)).toBe(cents(row!.openingBalance));
      expect(cents(ledger.closingBalance)).toBe(cents(row!.closingBalance));
    }
    expect(cents(gl.totals.closingBalance)).toBe(
      cents(tb.totals.closingBalance ?? 0),
    );
  });

  it('a single-account statement equals that account in the all-account GL', async () => {
    const gl = await fullLedger({});
    const busiest = [...gl.items].sort(
      (a, b) => b.movements.length - a.movements.length,
    )[0];
    if (!busiest) return;
    const [statement, selected] = await Promise.all([
      reports.accountStatement({
        accountId: busiest.account.id,
        postedOnly: true,
      }),
      reports.generalLedger({
        accountIds: [busiest.account.id],
        postedOnly: true,
      }),
    ]);
    expect(statement.closingBalance).toBe(busiest.closingBalance);
    expect(statement.movements.length).toBe(busiest.movements.length);
    expect(selected.total).toBe(1);
    expect(selected.items[0].closingBalance).toBe(busiest.closingBalance);
  });

  it('customer / supplier statements are complete and reconcile with the AR/AP control accounts', async () => {
    for (const controlType of [
      PartnerControlAccountType.RECEIVABLE,
      PartnerControlAccountType.PAYABLE,
    ]) {
      const partnerGroups = await prisma.journalEntryLine.groupBy({
        by: ['partnerId'],
        where: {
          partnerId: { not: null },
          account: { partnerControlType: controlType },
          journalEntry: {
            deletedAt: null,
            status: {
              in: [JournalEntryStatus.POSTED, JournalEntryStatus.REVERSED],
            },
          },
        },
        _sum: { debit: true, credit: true },
        _count: { _all: true },
      });

      let statementsClosing = 0;
      for (const group of partnerGroups) {
        const statement = await reports.partnerStatement({
          partnerId: group.partnerId!,
          controlType,
          postedOnly: true,
        });
        // Complete: no 20-row page truncation of the running balance.
        expect(statement.movements.length).toBe(group._count._all);
        expect(
          statement.movements.every(
            (m) => m.partnerControlType === controlType,
          ),
        ).toBe(true);
        const expected =
          Number(group._sum.debit ?? 0) - Number(group._sum.credit ?? 0);
        expect(cents(statement.closingBalance)).toBe(cents(expected));
        expect(
          cents(
            statement.openingBalance +
              statement.periodDebit -
              statement.periodCredit,
          ),
        ).toBe(cents(statement.closingBalance));
        statementsClosing += statement.closingBalance;
      }

      // Sum of partner statements = partner-tagged balance of the control
      // accounts in the General Ledger.
      const controlAccounts = await prisma.chartOfAccount.findMany({
        where: { partnerControlType: controlType, deletedAt: null },
        select: { id: true },
      });
      if (controlAccounts.length === 0) continue;
      const gl = await fullLedger({
        accountIds: controlAccounts.map((a) => a.id),
      });
      const partnerTaggedGl = gl.items
        .flatMap((l) => l.movements)
        .filter((m) => m.partner)
        .reduce((s, m) => s + m.debit - m.credit, 0);
      expect(cents(statementsClosing)).toBe(cents(partnerTaggedGl));
    }
  });

  it('a partner statement over a date window: opening = everything before dateFrom', async () => {
    const dateFrom = await windowStart();
    const group = await prisma.journalEntryLine.groupBy({
      by: ['partnerId'],
      where: {
        partnerId: { not: null },
        account: { partnerControlType: { not: null } },
      },
      _count: { _all: true },
      orderBy: { _count: { partnerId: 'desc' } },
      take: 1,
    });
    if (!dateFrom || !group[0]?.partnerId) return;
    const partnerId = group[0].partnerId;
    const [full, window] = await Promise.all([
      reports.partnerStatement({ partnerId, postedOnly: true }),
      reports.partnerStatement({
        partnerId,
        postedOnly: true,
        dateFrom,
      }),
    ]);
    const beforeWindow = full.movements
      .filter((m) => m.entryDate < new Date(dateFrom))
      .reduce((s, m) => s + m.debit - m.credit, 0);
    expect(cents(window.openingBalance)).toBe(cents(beforeWindow));
    expect(cents(window.closingBalance)).toBe(cents(full.closingBalance));
  });
});
