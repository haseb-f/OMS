import { AccountingReportsService } from './accounting-reports.service';
import { buildCashMovementReport } from './financial-report-tree';

interface FakeLine {
  accountId: string;
  debit: number;
  credit: number;
  entryDate: Date;
  sourceType: string;
}

type DateFilter = { lt?: Date; gte?: Date; lte?: Date };

function inRange(date: Date, filter?: DateFilter): boolean {
  if (!filter) return true;
  if (filter.lt && !(date < filter.lt)) return false;
  if (filter.gte && date < filter.gte) return false;
  if (filter.lte && date > filter.lte) return false;
  return true;
}

/** In-memory stand-in for the few Prisma calls the cash-flow report makes. */
function fakePrisma(lines: FakeLine[]) {
  type LineWhere = {
    accountId: { in: string[] };
    journalEntry: { entryDate?: DateFilter };
  };
  const match = (where: LineWhere) =>
    lines.filter(
      (line) =>
        where.accountId.in.includes(line.accountId) &&
        inRange(line.entryDate, where.journalEntry.entryDate),
    );
  return {
    receivingAccount: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { chartOfAccountId: 'cash' },
          { chartOfAccountId: 'bank' },
        ]),
    },
    chartOfAccount: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'bank', code: '1102', name: 'البنك', nameEn: 'Bank' },
        { id: 'cash', code: '1101', name: 'الصندوق', nameEn: 'Cash' },
      ]),
    },
    journalEntryLine: {
      aggregate: jest.fn(({ where }: { where: LineWhere }) => {
        const rows = match(where);
        return Promise.resolve({
          _sum: {
            debit: rows.reduce((sum, row) => sum + row.debit, 0),
            credit: rows.reduce((sum, row) => sum + row.credit, 0),
          },
        });
      }),
      findMany: jest.fn(({ where }: { where: LineWhere }) =>
        Promise.resolve(
          match(where).map((row) => ({
            ...row,
            journalEntry: { sourceType: row.sourceType },
          })),
        ),
      ),
      groupBy: jest.fn(({ where }: { where: LineWhere }) => {
        const byAccount = new Map<string, { debit: number; credit: number }>();
        for (const row of match(where)) {
          const current = byAccount.get(row.accountId) ?? {
            debit: 0,
            credit: 0,
          };
          current.debit += row.debit;
          current.credit += row.credit;
          byAccount.set(row.accountId, current);
        }
        return Promise.resolve(
          [...byAccount.entries()].map(([accountId, sum]) => ({
            accountId,
            _sum: sum,
          })),
        );
      }),
    },
  };
}

const LINES: FakeLine[] = [
  // Before the period — opening balances.
  {
    accountId: 'cash',
    debit: 1000,
    credit: 0,
    entryDate: new Date('2026-01-10'),
    sourceType: 'CAPITAL_CONTRIBUTION',
  },
  {
    accountId: 'bank',
    debit: 500,
    credit: 0,
    entryDate: new Date('2026-01-15'),
    sourceType: 'CUSTOMER_RECEIPT',
  },
  // In the period.
  {
    accountId: 'cash',
    debit: 250.25,
    credit: 0,
    entryDate: new Date('2026-02-03'),
    sourceType: 'CUSTOMER_RECEIPT',
  },
  {
    accountId: 'bank',
    debit: 0,
    credit: 120.5,
    entryDate: new Date('2026-02-05'),
    sourceType: 'SUPPLIER_PAYMENT',
  },
  // Internal transfer cash → bank: an outflow on one row, inflow on the other.
  {
    accountId: 'cash',
    debit: 0,
    credit: 300,
    entryDate: new Date('2026-02-10'),
    sourceType: 'INTERNAL_TRANSFER',
  },
  {
    accountId: 'bank',
    debit: 300,
    credit: 0,
    entryDate: new Date('2026-02-10'),
    sourceType: 'INTERNAL_TRANSFER',
  },
  // After the period — must be excluded.
  {
    accountId: 'cash',
    debit: 999,
    credit: 0,
    entryDate: new Date('2026-03-15'),
    sourceType: 'CUSTOMER_RECEIPT',
  },
];

const PERIOD = { dateFrom: '2026-02-01', dateTo: '2026-02-28' };

describe('Cash Flow views reconcile with the GL', () => {
  const service = () =>
    new AccountingReportsService(fakePrisma(LINES) as never);

  it('movement view: opening + net change = closing, per account and in total', async () => {
    const result = (await service().cashFlowStatement({
      ...PERIOD,
      view: 'movement',
    })) as Awaited<
      ReturnType<AccountingReportsService['cashFlowStatement']>
    > & {
      totals: {
        openingBalance: number;
        inflows: number;
        outflows: number;
        netCashChange: number;
        closingBalance: number;
      };
    };

    expect(result.view).toBe('movement');
    for (const line of result.lines) {
      const v = line.values;
      expect(v.netChange).toBeCloseTo(v.inflow - v.outflow, 2);
      expect(v.closing).toBeCloseTo(v.opening + v.netChange, 2);
    }
    expect(result.totals).toEqual({
      openingBalance: 1500,
      inflows: 550.25,
      outflows: 420.5,
      netCashChange: 129.75,
      closingBalance: 1629.75,
    });
  });

  it('activities and movement views agree on opening, net change and closing cash', async () => {
    const activities = await service().cashFlowStatement({
      ...PERIOD,
    });
    const movement = await service().cashFlowStatement({
      ...PERIOD,
      view: 'movement',
    });

    expect(activities.view).toBe('activities');
    expect(activities.openingBalance).toBeCloseTo(movement.openingBalance, 2);
    expect(activities.totals.netCashChange).toBeCloseTo(
      movement.totals.netCashChange,
      2,
    );
    expect(activities.totals.closingBalance).toBeCloseTo(
      movement.totals.closingBalance,
      2,
    );
    expect(activities.totals.closingBalance).toBeCloseTo(
      activities.openingBalance + activities.totals.netCashChange,
      2,
    );
  });

  it('labels rows as cash accounts (not activity classes) and drops all-zero accounts', () => {
    const { lines } = buildCashMovementReport(
      [
        { id: 'a', code: '1', name: 'أ', nameEn: 'A' },
        { id: 'z', code: '2', name: 'ز', nameEn: 'Z' },
      ],
      new Map([['a', 10]]),
      new Map([['a', { debit: 5, credit: 2 }]]),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      id: 'cfm:a',
      kind: 'posting',
      accountId: 'a',
      values: { opening: 10, inflow: 5, outflow: 2, netChange: 3, closing: 13 },
    });
  });
});
