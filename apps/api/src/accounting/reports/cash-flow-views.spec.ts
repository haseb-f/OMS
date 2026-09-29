import { AccountingReportsService } from './accounting-reports.service';
import { buildCashMovementReport } from './financial-report-tree';
import { coa, createTestLedger, type TestEntry } from './report-test-ledger';

const ACCOUNTS = [
  coa('cash', 'ASSET', null, true, '1101'),
  coa('bank', 'ASSET', null, true, '1102'),
  coa('ar', 'ASSET', null, true, '1201'),
  coa('ap', 'LIABILITY', null, true, '2101'),
  coa('capital', 'EQUITY', null, true, '3101'),
];

const ENTRIES: TestEntry[] = [
  // Before the period — opening balances.
  {
    id: 'o1',
    entryDate: '2026-01-10',
    sourceType: 'CAPITAL_CONTRIBUTION',
    lines: [
      ['cash', 1000, 0],
      ['capital', 0, 1000],
    ],
  },
  {
    id: 'o2',
    entryDate: '2026-01-15',
    sourceType: 'CUSTOMER_RECEIPT',
    lines: [
      ['bank', 500, 0],
      ['ar', 0, 500],
    ],
  },
  // In the period.
  {
    id: 'p1',
    entryDate: '2026-02-03',
    sourceType: 'CUSTOMER_RECEIPT',
    lines: [
      ['cash', 250.25, 0],
      ['ar', 0, 250.25],
    ],
  },
  {
    id: 'p2',
    entryDate: '2026-02-05',
    sourceType: 'SUPPLIER_PAYMENT',
    lines: [
      ['ap', 120.5, 0],
      ['bank', 0, 120.5],
    ],
  },
  // Internal transfer cash → bank: an outflow on one row, inflow on the other.
  {
    id: 'p3',
    entryDate: '2026-02-10',
    sourceType: 'INTERNAL_TRANSFER',
    lines: [
      ['bank', 300, 0],
      ['cash', 0, 300],
    ],
  },
  // After the period — must be excluded.
  {
    id: 'a1',
    entryDate: '2026-03-15',
    sourceType: 'CUSTOMER_RECEIPT',
    lines: [
      ['cash', 999, 0],
      ['ar', 0, 999],
    ],
  },
];

const PERIOD = { dateFrom: '2026-02-01', dateTo: '2026-02-28' };

describe('Cash Flow views reconcile with the GL', () => {
  const service = () =>
    new AccountingReportsService(
      createTestLedger({
        accounts: ACCOUNTS,
        entries: ENTRIES,
        receivingAccountIds: ['cash', 'bank'],
      }) as never,
    );

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
    // the internal transfer moves 300 between cash accounts but is no cash flow
    expect(
      'reconciliation' in activities && activities.reconciliation,
    ).toMatchObject({
      operating: 129.75,
      internalTransfers: 300,
      balanced: true,
    });
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
