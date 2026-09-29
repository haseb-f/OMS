import { AccountingReportsService } from './accounting-reports.service';
import {
  collectPostingLeaves,
  type HierarchicalReportLine,
} from './financial-report-tree';
import {
  buildBalanceSheet,
  buildCashFlowActivities,
  buildIncomeStatement,
  effectiveSourceType,
  type AccountSums,
} from './financial-statements';
import {
  buildClassificationContext,
  BS_HEADER_GROUPS,
  classifyPnlAccount,
  PNL_HEADER_LINES,
  type RoleAssignment,
} from './statement-classification';
import { coa, createTestLedger, type TestEntry } from './report-test-ledger';
import { journalReportOrder } from './report-scope';
import { STANDARD_CHART_OF_ACCOUNTS } from '../foundation/standard-chart-of-accounts';

/**
 * Accounting review (specs/usability-financial-reports/accounting-review.md
 * §Tests): every expected figure below is computed by hand in the spec
 * document. Pure builders first, then the real service on an in-memory
 * ledger for cross-report reconciliation.
 */

// --- A small chart mirroring the standard OMS COA codes --------------------
const ACCOUNTS = [
  coa('1', 'ASSET', null, false),
  coa('11', 'ASSET', '1', false),
  coa('111', 'ASSET', '11'), // cash (receiving account)
  coa('112', 'ASSET', '11'), // bank (receiving account)
  coa('12', 'ASSET', '1', false),
  coa('121', 'ASSET', '12'), // AR
  coa('13', 'ASSET', '1', false),
  coa('131', 'ASSET', '13'), // inventory
  coa('15', 'ASSET', '1', false),
  coa('151', 'ASSET', '15'), // fixed assets
  coa('CLR', 'ASSET', '1'), // gateway clearing (payment method)
  coa('XA', 'ASSET', null), // unmapped root asset
  coa('2', 'LIABILITY', null, false),
  coa('21', 'LIABILITY', '2', false),
  coa('211', 'LIABILITY', '21'), // AP
  coa('24', 'LIABILITY', '2', false),
  coa('241', 'LIABILITY', '24'), // investor funding
  coa('3', 'EQUITY', null, false),
  coa('31', 'EQUITY', '3', false),
  coa('311', 'EQUITY', '31'), // capital
  coa('32', 'EQUITY', '3', false),
  coa('321', 'EQUITY', '32'), // retained earnings
  coa('4', 'REVENUE', null, false),
  coa('41', 'REVENUE', '4', false),
  coa('411', 'REVENUE', '41'), // product sales (role)
  coa('412', 'REVENUE', '41'), // service sales (standard header 41)
  coa('42', 'REVENUE', '4', false),
  coa('421', 'REVENUE', '42'), // sales returns
  coa('422', 'REVENUE', '42'), // sales discounts
  coa('43', 'REVENUE', '4', false),
  coa('431', 'REVENUE', '43'), // other income
  coa('5', 'EXPENSE', null, false),
  coa('51', 'EXPENSE', '5', false),
  coa('511', 'EXPENSE', '51'), // COGS
  coa('52', 'EXPENSE', '5', false),
  coa('521', 'EXPENSE', '52'), // shipping
  coa('522', 'EXPENSE', '52'), // gateway fees
  coa('529', 'EXPENSE', '52'), // marketing (no role → header 52)
  coa('53', 'EXPENSE', '5', false),
  coa('531', 'EXPENSE', '53'), // general
  coa('532', 'EXPENSE', '53'), // salaries
  coa('534', 'EXPENSE', '53'), // sales commissions (role → selling)
  coa('54', 'EXPENSE', '5', false),
  coa('546', 'EXPENSE', '54'), // realized FX
  coa('549', 'EXPENSE', '54'), // investor profit distribution
  coa('XE', 'EXPENSE', null), // unmapped root expense
];

const SETTINGS: Record<string, string> = {
  salesRevenueAccountId: '411',
  salesReturnAccountId: '421',
  salesDiscountAccountId: '422',
  otherIncomeAccountId: '431',
  costOfGoodsSoldAccountId: '511',
  shippingExpenseAccountId: '521',
  paymentGatewayFeeAccountId: '522',
  defaultExpenseAccountId: '531',
  salaryExpenseAccountId: '532',
  commissionExpenseAccountId: '534',
  exchangeDifferenceAccountId: '546',
  investorProfitDistributionAccountId: '549',
  accountsReceivableAccountId: '121',
  inventoryAccountId: '131',
  fixedAssetsAccountId: '151',
  accountsPayableAccountId: '211',
  investorFundingAccountId: '241',
  retainedEarningsAccountId: '321',
};

const ROLES: RoleAssignment[] = [
  { accountId: '411', role: 'SALES_REVENUE' },
  { accountId: '421', role: 'SALES_RETURNS' },
  { accountId: '422', role: 'SALES_DISCOUNTS' },
  { accountId: '431', role: 'OTHER_INCOME' },
  { accountId: '511', role: 'COGS' },
  { accountId: '521', role: 'SHIPPING_EXPENSE' },
  { accountId: '522', role: 'GATEWAY_FEES' },
  { accountId: '531', role: 'OPERATING_EXPENSE' },
  { accountId: '532', role: 'SALARY_EXPENSE' },
  { accountId: '534', role: 'COMMISSION_EXPENSE' },
  { accountId: '546', role: 'EXCHANGE_DIFF' },
  { accountId: '549', role: 'INVESTOR_DIST' },
  { accountId: '121', role: 'AR' },
  { accountId: '131', role: 'INVENTORY' },
  { accountId: '151', role: 'FIXED_ASSETS' },
  { accountId: '211', role: 'AP' },
  { accountId: '241', role: 'INVESTOR_FUNDING' },
  { accountId: '321', role: 'RETAINED_EARNINGS' },
  { accountId: '111', role: 'CASH_ACCOUNT' },
  { accountId: '112', role: 'CASH_ACCOUNT' },
  { accountId: 'CLR', role: 'PAYMENT_CLEARING' },
];
const CASH = new Set(['111', '112']);

const sums = (rows: Array<[string, number, number]>): AccountSums =>
  new Map(rows.map(([id, debit, credit]) => [id, { debit, credit }]));

const find = (lines: HierarchicalReportLine[], id: string) => {
  const walk = (
    nodes: HierarchicalReportLine[],
  ): HierarchicalReportLine | null => {
    for (const node of nodes) {
      if (node.id === id) return node;
      const hit = walk(node.children);
      if (hit) return hit;
    }
    return null;
  };
  return walk(lines);
};

// Period P&L sums (see accounting-review.md "IS fixture").
const PNL_SUMS = sums([
  ['411', 0, 1000], // gross product sales (discount grossed up, as posted)
  ['412', 0, 200], // service sales (no role; standard header 41)
  ['421', 150, 0], // sales return
  ['422', 100, 0], // sales discount
  ['431', 0, 15], // other income
  ['511', 400, 60], // COGS less COGS reversed by the return
  ['521', 50, 0],
  ['522', 20, 0],
  ['529', 30, 0], // marketing — header 52 → selling
  ['534', 25, 0], // commissions (under 53, role → selling)
  ['531', 70, 0],
  ['532', 100, 0],
  ['546', 8, 0], // FX loss
  ['549', 12, 0], // investor profit distribution → finance costs
  ['XE', 5, 0], // unmapped expense → unclassified
]);

describe('statement classification', () => {
  const ctx = buildClassificationContext(ACCOUNTS, ROLES);
  const byId = new Map(ACCOUNTS.map((a) => [a.id, a]));

  it('standard header codes used by the report layer exist in the standard COA with the same type', () => {
    const std = new Map(STANDARD_CHART_OF_ACCOUNTS.map((d) => [d.code, d]));
    for (const code of [
      ...Object.keys(PNL_HEADER_LINES),
      ...Object.keys(BS_HEADER_GROUPS),
    ]) {
      expect(std.get(code)?.allowsPosting).toBe(false);
    }
  });

  it('role beats header, header beats unmapped, unmapped is UNCLASSIFIED', () => {
    expect(classifyPnlAccount(byId.get('534')!, ctx)).toMatchObject({
      line: 'SELLING_DISTRIBUTION',
      basis: 'ROLE',
    });
    expect(classifyPnlAccount(byId.get('529')!, ctx)).toMatchObject({
      line: 'SELLING_DISTRIBUTION',
      basis: 'STANDARD_HEADER',
      viaAccountId: '52',
    });
    expect(classifyPnlAccount(byId.get('XE')!, ctx)).toMatchObject({
      line: 'UNCLASSIFIED',
      basis: 'UNMAPPED',
    });
  });

  it('flags one account mapped to roles on different lines, keeping the first by priority', () => {
    const conflictCtx = buildClassificationContext(ACCOUNTS, [
      ...ROLES,
      { accountId: '431', role: 'SALES_REVENUE' },
    ]);
    const result = classifyPnlAccount(byId.get('431')!, conflictCtx);
    expect(result.line).toBe('REVENUE');
    expect(result.conflict?.lines).toEqual(['REVENUE', 'OTHER_INCOME']);
  });
});

describe('Income Statement builder', () => {
  const ctx = buildClassificationContext(ACCOUNTS, ROLES);
  const result = buildIncomeStatement({
    accounts: ACCOUNTS,
    sums: PNL_SUMS,
    ctx,
  });

  it('revenue net of returns and discounts, gross profit, operating profit, net profit', () => {
    expect(result.totals).toMatchObject({
      grossRevenue: 1200,
      revenueDeductions: -250,
      netRevenue: 950,
      costOfSales: 340,
      grossProfit: 610,
      sellingDistribution: 125,
      administrative: 170,
      operatingProfit: 315,
      otherIncome: 15,
      otherExpenses: 0,
      financeCosts: 12,
      fxDifferences: 8,
      unclassified: -5,
      netIncome: 305,
      totalRevenue: 965,
      totalExpense: 660,
    });
    expect(result.partitionDifference).toBe(0);
    expect(find(result.lines, 'is-gross-profit')?.values.balance).toBe(610);
    expect(find(result.lines, 'is-operating-profit')?.values.balance).toBe(315);
    expect(find(result.lines, 'net-income')?.values.balance).toBe(305);
  });

  it('a sales return reduces revenue through the contra line, not an expense', () => {
    const noReturn = buildIncomeStatement({
      accounts: ACCOUNTS,
      sums: new Map([...PNL_SUMS].filter(([id]) => id !== '421')),
      ctx,
    });
    expect(noReturn.totals.netRevenue - result.totals.netRevenue).toBe(150);
    expect(noReturn.totals.sellingDistribution).toBe(
      result.totals.sellingDistribution,
    );
    expect(
      find(result.lines, 'is-revenue-deductions/421')?.values.balance,
    ).toBe(-150);
  });

  it('partitions the ledger: every P&L account appears on exactly one line, nothing is double counted', () => {
    const leaves = collectPostingLeaves(result.lines);
    const ids = leaves.map((leaf) => leaf.accountId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set(PNL_SUMS.keys()));
    // selling and admin never share an account
    const sectionIds = (sectionId: string) =>
      collectPostingLeaves(find(result.lines, sectionId)!.children).map(
        (l) => l.accountId,
      );
    const selling = sectionIds('is-selling');
    const admin = sectionIds('is-admin');
    expect(selling.sort()).toEqual(['521', '522', '529', '534']);
    expect(admin.sort()).toEqual(['531', '532']);
    expect(selling.filter((id) => admin.includes(id))).toEqual([]);
  });

  it('surfaces unmapped accounts in an explicit Unclassified section with a warning', () => {
    expect(find(result.lines, 'is-unclassified/XE')?.values.balance).toBe(-5);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'UNCLASSIFIED_ACCOUNTS',
        accounts: [expect.objectContaining({ accountId: 'XE', amount: -5 })],
      }),
    );
  });
});

describe('Income Statement — shipping, gateway commissions and fulfilment (owner decision P2)', () => {
  const accounts = [...ACCOUNTS, coa('523', 'EXPENSE', '52')];
  const ctx = buildClassificationContext(accounts, [
    ...ROLES,
    { accountId: '523', role: 'FULFILLMENT_EXPENSE' },
  ]);

  it('are selling expenses below gross profit, each on its own visible line', () => {
    const result = buildIncomeStatement({ accounts, sums: PNL_SUMS, ctx });
    // Gross profit is untouched by shipping / gateway fees (cost of sales = COGS only).
    expect(result.totals).toMatchObject({
      costOfSales: 340,
      grossProfit: 610,
      shippingDelivery: 50,
      paymentGatewayFees: 20,
      fulfillment: 0,
      otherSelling: 55, // 529 marketing 30 + 534 commissions 25
      sellingDistribution: 125,
      recoveredFromAgents: 0,
      operatingProfit: 315,
      netIncome: 305,
    });
    const selling = find(result.lines, 'is-selling')!;
    expect(selling.children.map((c) => c.id)).toEqual([
      'is-selling-shipping',
      'is-selling-gateway',
      'is-selling-other',
      'is-selling:total',
    ]);
    expect(find(result.lines, 'is-selling-shipping/521')?.values.balance).toBe(
      50,
    );
    expect(find(result.lines, 'is-selling-gateway/522')?.values.balance).toBe(
      20,
    );
    expect(
      find(result.lines, 'is-selling-shipping:total')?.values.balance,
    ).toBe(50);
    expect(find(result.lines, 'is-selling:total')?.values.balance).toBe(125);
    // nothing of 52x is in cost of sales
    const cos = collectPostingLeaves(
      find(result.lines, 'is-cost-of-sales')!.children,
    );
    expect(cos.map((l) => l.accountId)).toEqual(['511']);
  });

  it('gateway fees recovered from agents are a contra line; carrier shipping stays company expense', () => {
    // Carrier shipping 50 (company expense only — never recovered from
    // agents); gateway fee 20 of which 8 recovered (AGENT_PROVIDER_FEE:
    // Dr Agent funds payable / Cr 522); fulfilment 40.
    const ledgerSums = new Map(PNL_SUMS);
    ledgerSums.set('522', { debit: 20, credit: 8 });
    ledgerSums.set('523', { debit: 40, credit: 0 });
    const result = buildIncomeStatement({
      accounts,
      sums: ledgerSums,
      recoverySums: sums([['522', 0, 8]]),
      ctx,
    });
    expect(result.totals.sellingBreakdown).toEqual({
      SHIPPING_DELIVERY: { gross: 50, recoveredFromAgents: 0, net: 50 },
      PAYMENT_GATEWAY_FEES: { gross: 20, recoveredFromAgents: 8, net: 12 },
      FULFILLMENT: { gross: 40, recoveredFromAgents: 0, net: 40 },
      OTHER_SELLING: { gross: 55, recoveredFromAgents: 0, net: 55 },
    });
    expect(result.totals).toMatchObject({
      grossRevenue: 1200, // recoveries never become revenue
      grossProfit: 610,
      sellingDistribution: 157, // 50 + 12 + 40 + 55
      recoveredFromAgents: 8,
      operatingProfit: 283, // 610 − 157 − 170
      netIncome: 273,
      totalRevenue: 965,
      totalExpense: 692, // 660 − 8 + 40
    });
    expect(result.partitionDifference).toBe(0);
    expect(find(result.lines, 'is-selling-gateway/522')?.values.balance).toBe(
      20,
    );
    expect(find(result.lines, 'is-selling-gateway:recovered')).toMatchObject({
      kind: 'result',
      values: { balance: -8 },
    });
    expect(find(result.lines, 'is-selling-gateway:total')?.values.balance).toBe(
      12,
    );
    // the contra row renders only when something was recovered
    expect(find(result.lines, 'is-selling-shipping:recovered')).toBeNull();
    expect(find(result.lines, 'is-selling-fulfillment:recovered')).toBeNull();
    expect(
      find(result.lines, 'is-selling-shipping:total')?.values.balance,
    ).toBe(50);
    expect(find(result.lines, 'is-selling:total')?.values.balance).toBe(157);
  });
});

describe('Balance Sheet builder', () => {
  const ctx = buildClassificationContext(ACCOUNTS, ROLES);
  // Cumulative sums as of the report date (fixture in accounting-review.md).
  const cumulative: Array<[string, number, number]> = [
    ['111', 5100, 850], // +5000 capital +100 … −800 fixed asset −50 XA
    ['112', 2000, 0],
    ['121', 800, 0],
    ['131', 1000, 200],
    ['151', 800, 0],
    ['XA', 50, 0],
    ['211', 0, 1000],
    ['241', 0, 2100],
    ['311', 0, 5000],
    ['411', 0, 800], // 300 prior year + 500 current year
    ['511', 200, 0],
  ];
  // Income Statement sums for [FY start, as-of]: 500 revenue, 200 COGS.
  const currentYear = sums([
    ['411', 0, 500],
    ['511', 200, 0],
  ]);

  it('assets = liabilities + equity with current-year profit and prior unclosed profit', () => {
    const bs = buildBalanceSheet({
      accounts: ACCOUNTS,
      sums: sums(cumulative),
      currentYearSums: currentYear,
      currentYearClosingSums: new Map(),
      ctx,
      cashAccountIds: CASH,
    });
    expect(bs.totals).toMatchObject({
      totalAssets: 8700,
      currentAssets: 7850,
      nonCurrentAssets: 800,
      unclassifiedAssets: 50,
      totalLiabilities: 3100,
      currentLiabilities: 1000,
      nonCurrentLiabilities: 2100,
      equityAccounts: 5000,
      priorPeriodsUnclosedProfit: 300,
      currentYearProfit: 300,
      totalEquity: 5600,
      totalLiabilitiesAndEquity: 8700,
      difference: 0,
      balanced: true,
      cashAndCashEquivalents: 6250,
    });
    expect(bs.currentEarnings).toBe(600);
    expect(bs.warnings[0]).toMatchObject({ code: 'UNCLASSIFIED_ACCOUNTS' });
  });

  it('after year closing the prior profit sits in retained earnings and the equation still holds', () => {
    const closing: Array<[string, number, number]> = [
      ['411', 300, 0],
      ['321', 0, 300],
    ];
    const merge = (
      base: Array<[string, number, number]>,
      add: Array<[string, number, number]>,
    ) => {
      const map = sums(base);
      for (const [id, d, c] of add) {
        const cur = map.get(id) ?? { debit: 0, credit: 0 };
        map.set(id, { debit: cur.debit + d, credit: cur.credit + c });
      }
      return map;
    };
    const bs = buildBalanceSheet({
      accounts: ACCOUNTS,
      sums: merge(cumulative, closing),
      currentYearSums: currentYear,
      // the closing belongs to the prior fiscal year, not this one
      currentYearClosingSums: new Map(),
      ctx,
      cashAccountIds: CASH,
    });
    expect(bs.totals.priorPeriodsUnclosedProfit).toBe(0);
    expect(bs.totals.currentYearProfit).toBe(300);
    expect(bs.totals.equityAccounts).toBe(5300);
    expect(bs.totals.totalEquity).toBe(5600);
    expect(bs.totals.balanced).toBe(true);
  });

  it('reports the exact discrepancy when the equation does not hold', () => {
    const bs = buildBalanceSheet({
      accounts: ACCOUNTS,
      sums: sums([
        ['111', 100, 0],
        ['311', 0, 90],
      ]),
      currentYearSums: new Map(),
      currentYearClosingSums: new Map(),
      ctx,
      cashAccountIds: CASH,
    });
    expect(bs.totals.balanced).toBe(false);
    expect(bs.totals.difference).toBe(10);
  });

  it('closing THIS year moves its profit to retained earnings via its own line; prior stays 0', () => {
    // Current-year profit 300 closed at year end: Dr 411 500, Cr 511 200, Cr 321 300.
    const closingThisYear: Array<[string, number, number]> = [
      ['411', 500, 0],
      ['511', 0, 200],
      ['321', 0, 300],
    ];
    const cumulativeMap = sums(cumulative);
    for (const [id, d, c] of closingThisYear) {
      const cur = cumulativeMap.get(id) ?? { debit: 0, credit: 0 };
      cumulativeMap.set(id, { debit: cur.debit + d, credit: cur.credit + c });
    }
    const bs = buildBalanceSheet({
      accounts: ACCOUNTS,
      sums: cumulativeMap,
      currentYearSums: currentYear,
      currentYearClosingSums: sums(closingThisYear),
      ctx,
      cashAccountIds: CASH,
    });
    expect(bs.totals).toMatchObject({
      currentYearProfit: 300,
      currentYearClosedToRetainedEarnings: -300,
      priorPeriodsUnclosedProfit: 300,
      equityAccounts: 5300,
      totalEquity: 5600,
      balanced: true,
    });
    expect(find(bs.lines, 'current-year-closed')?.values.balance).toBe(-300);
  });

  it('shows a header row inside a group only when that header belongs to the group', () => {
    const bs = buildBalanceSheet({
      accounts: ACCOUNTS,
      sums: sums(cumulative),
      currentYearSums: currentYear,
      currentYearClosingSums: new Map(),
      ctx,
      cashAccountIds: CASH,
    });
    // header 1 (root) never appears; 11 (current) under current assets;
    // 15 (non-current) only under non-current assets
    expect(find(bs.lines, 'bs-assets-current/1')).toBeNull();
    expect(find(bs.lines, 'bs-assets-current/11')?.values.balance).toBe(6250);
    expect(find(bs.lines, 'bs-assets-non-current/15')?.values.balance).toBe(
      800,
    );
    expect(find(bs.lines, 'bs-assets-current/15')).toBeNull();
  });
});

describe('Income Statement — headers of another line are not shown inside a line', () => {
  const ctx = buildClassificationContext(ACCOUNTS, ROLES);
  const result = buildIncomeStatement({
    accounts: ACCOUNTS,
    sums: PNL_SUMS,
    ctx,
  });

  it('534 (role Selling, under header 53 Admin) sits directly in Selling, not under "53"', () => {
    expect(find(result.lines, 'is-selling-other/53')).toBeNull();
    expect(find(result.lines, 'is-selling-other/534')).toMatchObject({
      parentId: null,
      level: 2,
      values: { balance: 25 },
    });
    // header 52 stays with the one account that has no own selling line
    // (529 marketing = 30); 521 / 522 moved to their own visible lines
    expect(find(result.lines, 'is-selling-other/52')?.values.balance).toBe(30);
    expect(find(result.lines, 'is-selling-shipping/52')).toBeNull();
    // header 53 inside Admin shows only admin accounts (531 + 532)
    expect(find(result.lines, 'is-admin/53')?.values.balance).toBe(170);
    // header 54 (Other expenses) is not shown inside Finance costs
    expect(find(result.lines, 'is-finance-costs/54')).toBeNull();
  });
});

describe('Cash Flow builder (direct method, by counterpart)', () => {
  const ctx = buildClassificationContext(ACCOUNTS, ROLES);
  const entries = [
    {
      id: 'E1',
      src: 'CUSTOMER_RECEIPT',
      lines: [
        ['111', 500, 0],
        ['121', 0, 500],
      ],
    },
    {
      id: 'E2',
      src: 'SUPPLIER_PAYMENT',
      lines: [
        ['211', 300, 0],
        ['112', 0, 300],
      ],
    },
    {
      id: 'E3',
      src: 'INTERNAL_TRANSFER',
      lines: [
        ['112', 1000, 0],
        ['111', 0, 1000],
      ],
    },
    {
      id: 'E4',
      src: 'FIXED_ASSET_CAPITALIZATION',
      lines: [
        ['151', 800, 0],
        ['111', 0, 800],
      ],
    },
    {
      id: 'E5',
      src: 'CAPITAL_CONTRIBUTION',
      lines: [
        ['111', 2000, 0],
        ['311', 0, 2000],
      ],
    },
    {
      id: 'E6',
      src: 'PAYMENT_SETTLEMENT',
      lines: [
        ['112', 450, 0],
        ['522', 50, 0],
        ['CLR', 0, 500],
      ],
    },
    {
      id: 'E7',
      src: 'FX_REVALUATION',
      lines: [
        ['112', 25, 0],
        ['546', 0, 25],
      ],
    },
    {
      id: 'E8',
      src: 'MANUAL',
      lines: [
        ['111', 100, 0],
        ['241', 0, 100],
      ],
    },
    {
      id: 'E9',
      src: 'CUSTOMER_RECEIPT',
      lines: [
        ['111', 70, 0],
        ['121', 0, 70],
      ],
    },
    {
      id: 'E9R',
      src: 'CUSTOMER_RECEIPT',
      lines: [
        ['121', 70, 0],
        ['111', 0, 70],
      ],
    },
    {
      id: 'E10',
      src: 'CUSTOMER_RECEIPT',
      lines: [
        ['112', 1000, 0],
        ['121', 0, 980],
        ['546', 0, 20],
      ],
    },
  ].map((e) => ({
    entryId: e.id,
    sourceType: e.src,
    lines: (e.lines as Array<[string, number, number]>).map(
      ([accountId, debit, credit]) => ({
        accountId,
        debit,
        credit,
      }),
    ),
  }));

  const result = buildCashFlowActivities({
    entries,
    accounts: ACCOUNTS,
    ctx,
    cashAccountIds: CASH,
    openingCash: 1000,
    closingCashBalance: 3975,
  });

  it('opening + operating + investing + financing + FX effect = closing = ledger', () => {
    expect(result.reconciliation).toEqual({
      openingCash: 1000,
      operating: 1650,
      investing: -800,
      financing: 2100,
      fxEffect: 25,
      netChange: 2975,
      openingBalanceEntries: 0,
      closingCash: 3975,
      ledgerClosingCash: 3975,
      difference: 0,
      balanced: true,
      internalTransfers: 1000,
    });
  });

  it('excludes transfers between cash accounts and classifies a manual entry by its counterpart', () => {
    expect(find(result.lines, 'cf:OPERATING:INTERNAL_TRANSFER')).toBeNull();
    expect(find(result.lines, 'cf:FINANCING:MANUAL')?.values.balance).toBe(100);
    expect(
      find(result.lines, 'cf:INVESTING:FIXED_ASSET_CAPITALIZATION')?.values
        .balance,
    ).toBe(-800);
    // settlement shows the net cash received, the fee is not a separate cash flow
    expect(
      find(result.lines, 'cf:OPERATING:PAYMENT_SETTLEMENT')?.values.balance,
    ).toBe(450);
    expect(find(result.lines, 'cf-fx-effect')?.values.balance).toBe(25);
  });

  it('the check is independent: a closing balance that disagrees is reported, not absorbed', () => {
    const off = buildCashFlowActivities({
      entries,
      accounts: ACCOUNTS,
      ctx,
      cashAccountIds: CASH,
      openingCash: 1000,
      closingCashBalance: 3900,
    });
    expect(off.reconciliation).toMatchObject({
      closingCash: 3975,
      ledgerClosingCash: 3900,
      difference: 75,
      balanced: false,
    });
  });

  it('opening-balance (go-live) entries are not cash flows: shown outside the activities', () => {
    // 2026-01-01 go-live: Dr Cash 10,000, Dr Inventory 5,000 / Cr Capital 12,000, Cr AP 3,000
    const golive = buildCashFlowActivities({
      entries: [
        {
          entryId: 'OB',
          sourceType: 'OPENING_BALANCE',
          lines: [
            { accountId: '111', debit: 10000, credit: 0 },
            { accountId: '131', debit: 5000, credit: 0 },
            { accountId: '311', debit: 0, credit: 12000 },
            { accountId: '211', debit: 0, credit: 3000 },
          ],
        },
        {
          entryId: 'R1',
          sourceType: 'CUSTOMER_RECEIPT',
          lines: [
            { accountId: '111', debit: 400, credit: 0 },
            { accountId: '121', debit: 0, credit: 400 },
          ],
        },
      ],
      accounts: ACCOUNTS,
      ctx,
      cashAccountIds: CASH,
      openingCash: 0,
      closingCashBalance: 10400,
    });
    expect(golive.reconciliation).toMatchObject({
      openingCash: 0,
      openingBalanceEntries: 10000,
      operating: 400,
      investing: 0,
      financing: 0,
      netChange: 400,
      closingCash: 10400,
      ledgerClosingCash: 10400,
      balanced: true,
    });
    expect(find(golive.lines, 'cf-opening-entries')?.values.balance).toBe(
      10000,
    );
  });

  it('a MANUAL reversal of an opening-balance entry is reported with the entry it reverses', () => {
    expect(
      effectiveSourceType({
        sourceType: 'MANUAL',
        reversalOfEntry: { sourceType: 'OPENING_BALANCE' },
      }),
    ).toBe('OPENING_BALANCE');
    expect(
      effectiveSourceType({ sourceType: 'MANUAL', reversalOfEntry: null }),
    ).toBe('MANUAL');
    // original +200 and its reversal −200 both stay outside the activities
    const ob = buildCashFlowActivities({
      entries: [
        {
          entryId: 'OB',
          sourceType: 'OPENING_BALANCE',
          lines: [
            { accountId: '111', debit: 200, credit: 0 },
            { accountId: '311', debit: 0, credit: 200 },
          ],
        },
        {
          entryId: 'OBR',
          sourceType: effectiveSourceType({
            sourceType: 'MANUAL',
            reversalOfEntry: { sourceType: 'OPENING_BALANCE' },
          }),
          lines: [
            { accountId: '311', debit: 200, credit: 0 },
            { accountId: '111', debit: 0, credit: 200 },
          ],
        },
      ],
      accounts: ACCOUNTS,
      ctx,
      cashAccountIds: CASH,
      openingCash: 0,
      closingCashBalance: 0,
    });
    expect(ob.reconciliation).toMatchObject({
      openingBalanceEntries: 0,
      financing: 0,
      closingCash: 0,
      balanced: true,
    });
  });

  it('a loan under header 24 is financing; an unmapped liability is operating WITH a warning', () => {
    const accounts = [
      ...ACCOUNTS,
      coa('243', 'LIABILITY', '24'), // custom short-term investor loan
      coa('LOAN', 'LIABILITY', null), // custom root loan account, unmapped
    ];
    const loanCtx = buildClassificationContext(accounts, ROLES);
    const flows = buildCashFlowActivities({
      entries: [
        {
          entryId: 'L1',
          sourceType: 'MANUAL',
          lines: [
            { accountId: '112', debit: 700, credit: 0 },
            { accountId: '243', debit: 0, credit: 700 },
          ],
        },
        {
          entryId: 'L2',
          sourceType: 'MANUAL',
          lines: [
            { accountId: '112', debit: 900, credit: 0 },
            { accountId: 'LOAN', debit: 0, credit: 900 },
          ],
        },
      ],
      accounts,
      ctx: loanCtx,
      cashAccountIds: CASH,
      openingCash: 0,
      closingCashBalance: 1600,
    });
    expect(flows.reconciliation).toMatchObject({
      financing: 700,
      operating: 900,
    });
    expect(flows.warnings).toEqual([
      {
        code: 'UNCLASSIFIED_ACCOUNTS',
        accounts: [
          { accountId: 'LOAN', code: 'LOAN', name: 'LOAN', amount: 900 },
        ],
      },
    ]);
  });

  it('a reversed receipt and its reversal net to zero (both included, not double excluded)', () => {
    // E1 500 + E10 1000 + E9/E9R 0
    expect(
      find(result.lines, 'cf:OPERATING:CUSTOMER_RECEIPT')?.values.balance,
    ).toBe(1500);
  });
});

// ==========================================================================
// Service end to end on an in-memory ledger — cross-report reconciliation
// ==========================================================================

describe('AccountingReportsService — statements reconcile with each other', () => {
  // FY2026 = 2026-01-01..2026-12-31. Period under review: 2026-03-01..2026-03-31.
  const E: TestEntry[] = [
    {
      id: 'o1',
      entryDate: '2025-06-01',
      sourceType: 'CAPITAL_CONTRIBUTION',
      lines: [
        ['111', 5000, 0],
        ['311', 0, 5000],
      ],
    },
    {
      id: 'o2',
      entryDate: '2025-07-01',
      sourceType: 'SALES_INVOICE',
      lines: [
        ['121', 300, 0],
        ['411', 0, 300],
      ],
    }, // prior-year profit 300
    {
      id: 'f1',
      entryDate: '2026-02-15',
      sourceType: 'SALES_INVOICE',
      lines: [
        ['121', 1000, 0],
        ['411', 0, 1000],
      ],
    },
    {
      id: 'f2',
      entryDate: '2026-02-28',
      sourceType: 'SUPPLIER_PAYMENT',
      lines: [
        ['531', 100, 0],
        ['111', 0, 100],
      ],
    },
    // March (boundaries inclusive)
    {
      id: 'm1',
      entryDate: '2026-03-01',
      sourceType: 'SALES_INVOICE',
      lines: [
        ['121', 900, 0],
        ['422', 100, 0],
        ['411', 0, 1000],
        ['511', 400, 0],
        ['131', 0, 400],
      ],
    },
    {
      id: 'm2',
      entryDate: '2026-03-10',
      sourceType: 'SALES_RETURN',
      lines: [
        ['421', 150, 0],
        ['121', 0, 150],
        ['131', 60, 0],
        ['511', 0, 60],
      ],
    },
    {
      id: 'm3',
      entryDate: '2026-03-15',
      sourceType: 'CUSTOMER_RECEIPT',
      lines: [
        ['112', 600, 0],
        ['121', 0, 600],
      ],
    },
    {
      id: 'm4',
      entryDate: '2026-03-16',
      sourceType: 'INTERNAL_TRANSFER',
      lines: [
        ['112', 1000, 0],
        ['111', 0, 1000],
      ],
    },
    {
      id: 'm5',
      entryDate: '2026-03-20',
      sourceType: 'CUSTOMER_RECEIPT',
      status: 'REVERSED',
      lines: [
        ['111', 80, 0],
        ['121', 0, 80],
      ],
    },
    {
      id: 'm5r',
      entryDate: '2026-03-21',
      sourceType: 'CUSTOMER_RECEIPT',
      lines: [
        ['121', 80, 0],
        ['111', 0, 80],
      ],
    },
    {
      id: 'm6',
      entryDate: '2026-03-31',
      sourceType: 'SUPPLIER_PAYMENT',
      lines: [
        ['521', 50, 0],
        ['532', 100, 0],
        ['111', 0, 150],
      ],
    },
    {
      id: 'm7',
      entryDate: '2026-03-25',
      sourceType: 'MANUAL',
      status: 'DRAFT',
      lines: [
        ['531', 999, 0],
        ['111', 0, 999],
      ],
    },
    // After the period
    {
      id: 'a1',
      entryDate: '2026-04-01',
      sourceType: 'SALES_INVOICE',
      lines: [
        ['121', 777, 0],
        ['411', 0, 777],
      ],
    },
  ];
  const ledger = createTestLedger({
    accounts: ACCOUNTS,
    entries: E,
    postingSettings: SETTINGS,
    receivingAccountIds: ['111', '112'],
    fiscalYears: [{ startDate: '2026-01-01', endDate: '2026-12-31' }],
  });
  const service = new AccountingReportsService(ledger as never);
  const PERIOD = { dateFrom: '2026-03-01', dateTo: '2026-03-31' };

  it('Trial Balance: opening + period movement = closing, debits = credits, across the period boundary', async () => {
    const tb = await service.trialBalance({ ...PERIOD });
    const row = (id: string) => tb.items.find((r) => r.accountId === id)!;
    // Cash: opening 5000 − 100 = 4900; period Dr 80, Cr 1000 + 80 + 150 = 1230 → 3750
    expect(row('111')).toMatchObject({
      openingBalance: 4900,
      debitTotal: 80,
      creditTotal: 1230,
      closingBalance: 3750,
    });
    // AR: opening 1300; Dr 900 + 80, Cr 150 + 600 + 80 → 1450
    expect(row('121')).toMatchObject({
      openingBalance: 1300,
      debitTotal: 980,
      creditTotal: 830,
      closingBalance: 1450,
    });
    expect(tb.totals).toMatchObject({
      debitTotal: 3520,
      creditTotal: 3520,
      openingBalance: 0,
      closingBalance: 0,
    });
    expect(tb.checks).toMatchObject({
      balanced: true,
      periodDifference: 0,
      openingDifference: 0,
      closingDifference: 0,
    });
    // the draft and the post-period entry are out
    expect(row('531').debitTotal).toBe(0);
    expect(row('531').openingBalance).toBe(100);
  });

  it('Income Statement for March: gross → net revenue, gross profit and net profit', async () => {
    const is = await service.incomeStatement({ ...PERIOD });
    expect(is.totals).toMatchObject({
      grossRevenue: 1000,
      revenueDeductions: -250,
      netRevenue: 750,
      costOfSales: 340,
      grossProfit: 410,
      sellingDistribution: 50,
      administrative: 100,
      operatingProfit: 260,
      netIncome: 260,
    });
  });

  it('Balance Sheet at 31 March: A = L + E; current-year profit = IS from fiscal-year start', async () => {
    const bs = await service.balanceSheet({ dateTo: PERIOD.dateTo });
    const ytd = await service.incomeStatement({
      dateFrom: '2026-01-01',
      dateTo: PERIOD.dateTo,
    });
    expect(ytd.totals.netIncome).toBe(1160); // Feb 1000 − 100 + March 260
    expect(bs.totals.currentYearProfit).toBe(ytd.totals.netIncome);
    expect(bs.totals.priorPeriodsUnclosedProfit).toBe(300);
    expect(bs.totals.balanced).toBe(true);
    expect(bs.totals.difference).toBe(0);
    expect(bs.totals.totalAssets).toBe(6460);
  });

  it('TB closing sums agree with the Balance Sheet', async () => {
    const tb = await service.trialBalance({ ...PERIOD });
    const bs = await service.balanceSheet({ dateTo: PERIOD.dateTo });
    const assets = tb.items
      .filter((r) => r.accountType === 'ASSET')
      .reduce((s, r) => s + r.closingBalance, 0);
    expect(Math.round(assets * 100) / 100).toBe(bs.totals.totalAssets);
  });

  it('Cash Flow for March: opening → closing, internal transfer excluded, closing = Balance Sheet cash', async () => {
    const cf = await service.cashFlowStatement({
      ...PERIOD,
      view: 'activities',
    });
    const bs = await service.balanceSheet({ dateTo: PERIOD.dateTo });
    expect('reconciliation' in cf && cf.reconciliation).toMatchObject({
      openingCash: 4900,
      operating: 450, // +600 receipt, −150 payment, +80 −80 reversed receipt
      investing: 0,
      financing: 0,
      fxEffect: 0,
      netChange: 450,
      closingCash: 5350,
      ledgerClosingCash: 5350,
      balanced: true,
      internalTransfers: 1000,
    });
    expect(cf.totals.closingBalance).toBe(bs.totals.cashAndCashEquivalents);
  });

  it('Income Statement ignores Year Closing entries; the Balance Sheet keeps them in equity', async () => {
    const closed = createTestLedger({
      accounts: ACCOUNTS,
      entries: [
        ...E,
        {
          id: 'yc',
          entryDate: '2025-12-31',
          sourceType: 'YEAR_CLOSING',
          lines: [
            ['411', 300, 0],
            ['321', 0, 300],
          ],
        },
      ],
      postingSettings: SETTINGS,
      receivingAccountIds: ['111', '112'],
      fiscalYears: [
        { startDate: '2025-01-01', endDate: '2025-12-31' },
        { startDate: '2026-01-01', endDate: '2026-12-31' },
      ],
    });
    const svc = new AccountingReportsService(closed as never);
    const fy2025 = await svc.incomeStatement({
      dateFrom: '2025-01-01',
      dateTo: '2025-12-31',
    });
    expect(fy2025.totals.netIncome).toBe(300);
    const bs = await svc.balanceSheet({ dateTo: PERIOD.dateTo });
    expect(bs.totals.priorPeriodsUnclosedProfit).toBe(0);
    expect(bs.totals.equityAccounts).toBe(5300);
    expect(bs.totals.balanced).toBe(true);
  });

  it('a reversed PRIOR-year closing (reversal dated this year) stays in prior periods; current year = IS YTD', async () => {
    const reopened = createTestLedger({
      accounts: ACCOUNTS,
      entries: [
        ...E,
        {
          id: 'yc',
          entryDate: '2025-12-31',
          sourceType: 'YEAR_CLOSING',
          sourceId: 'fy2025',
          status: 'REVERSED',
          lines: [
            ['411', 300, 0],
            ['321', 0, 300],
          ],
        },
        {
          id: 'ycr',
          entryDate: '2026-03-05',
          sourceType: 'YEAR_CLOSING',
          sourceId: 'fy2025',
          lines: [
            ['321', 300, 0],
            ['411', 0, 300],
          ],
        },
      ],
      postingSettings: SETTINGS,
      receivingAccountIds: ['111', '112'],
      fiscalYears: [
        { id: 'fy2025', startDate: '2025-01-01', endDate: '2025-12-31' },
        { id: 'fy2026', startDate: '2026-01-01', endDate: '2026-12-31' },
      ],
    });
    const svc = new AccountingReportsService(reopened as never);
    const bs = await svc.balanceSheet({ dateTo: PERIOD.dateTo });
    const ytd = await svc.incomeStatement({
      dateFrom: '2026-01-01',
      dateTo: PERIOD.dateTo,
    });
    expect(ytd.totals.netIncome).toBe(1160);
    expect(bs.totals).toMatchObject({
      currentYearProfit: 1160,
      priorPeriodsUnclosedProfit: 300,
      currentYearClosedToRetainedEarnings: 0,
      equityAccounts: 5000,
      balanced: true,
    });
  });

  it('Journal Report pages in a total order: entries sharing one date are neither repeated nor skipped', async () => {
    const sameDay = createTestLedger({
      accounts: ACCOUNTS,
      entries: ['JV-5', 'JV-3', 'JV-1', 'JV-4', 'JV-2'].map((entryNumber) => ({
        id: `id-${entryNumber}`,
        entryNumber,
        entryDate: '2026-03-10',
        sourceType: 'MANUAL',
        lines: [
          ['531', 10, 0],
          ['111', 0, 10],
        ] as Array<[string, number, number]>,
      })),
    });
    const svc = new AccountingReportsService(sameDay as never);
    const seen: string[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const result = await svc.journalReport({
        page,
        pageSize: 2,
        sortOrder: 'asc',
      });
      seen.push(...result.items.map((item) => item.entryNumber));
      expect(result.total).toBe(5);
    }
    expect(seen).toEqual(['JV-1', 'JV-2', 'JV-3', 'JV-4', 'JV-5']);
    expect(journalReportOrder('desc')).toEqual([
      { entryDate: 'desc' },
      { entryNumber: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('a MANUAL (Journal Entries screen) reversal of a closing is judged with the closing it reverses', async () => {
    // FY2026 closed at 31 March (profit 1160) and the closing reversed from the JE screen.
    const ledger2 = createTestLedger({
      accounts: ACCOUNTS,
      entries: [
        ...E,
        {
          id: 'yc26',
          entryDate: '2026-03-31',
          sourceType: 'YEAR_CLOSING',
          sourceId: 'fy2026',
          status: 'REVERSED',
          lines: [
            ['411', 2000, 0],
            ['421', 0, 150],
            ['422', 0, 100],
            ['511', 0, 340],
            ['531', 0, 100],
            ['521', 0, 50],
            ['532', 0, 100],
            ['321', 0, 1160],
          ],
        },
        {
          id: 'yc26r',
          entryDate: '2026-03-31',
          sourceType: 'MANUAL',
          reversalOf: 'yc26',
          lines: [
            ['411', 0, 2000],
            ['421', 150, 0],
            ['422', 100, 0],
            ['511', 340, 0],
            ['531', 100, 0],
            ['521', 50, 0],
            ['532', 100, 0],
            ['321', 1160, 0],
          ],
        },
      ],
      postingSettings: SETTINGS,
      receivingAccountIds: ['111', '112'],
      fiscalYears: [
        { id: 'fy2026', startDate: '2026-01-01', endDate: '2026-12-31' },
      ],
    });
    const svc = new AccountingReportsService(ledger2 as never);
    const ytd = await svc.incomeStatement({
      dateFrom: '2026-01-01',
      dateTo: PERIOD.dateTo,
    });
    const bs = await svc.balanceSheet({ dateTo: PERIOD.dateTo });
    expect(ytd.totals.netIncome).toBe(1160); // neither the closing nor its MANUAL reversal
    expect(bs.totals).toMatchObject({
      currentYearProfit: 1160,
      currentYearClosedToRetainedEarnings: 0, // closing + reversal net
      priorPeriodsUnclosedProfit: 300,
      equityAccounts: 5000,
      balanced: true,
    });
  });
});

describe('AccountingReportsService — agent recoveries in the Income Statement', () => {
  const entries: TestEntry[] = [
    // Carrier shipping: company expense only.
    {
      id: 'ship',
      entryDate: '2026-05-10',
      sourceType: 'SHIPMENT_COST',
      lines: [
        ['521', 50, 0],
        ['211', 0, 50],
      ],
    },
    // Gateway fee expensed at settlement, then recovered from the agent.
    {
      id: 'fee',
      entryDate: '2026-05-14',
      sourceType: 'PAYMENT_SETTLEMENT',
      lines: [
        ['522', 20, 0],
        ['CLR', 0, 20],
      ],
    },
    {
      id: 'feeRec',
      entryDate: '2026-05-15',
      sourceType: 'AGENT_PROVIDER_FEE',
      lines: [
        ['211', 8, 0],
        ['522', 0, 8],
      ],
    },
    // A provider-fee recovery reversed on the Journal Entries screen (MANUAL).
    {
      id: 'feeRec2',
      entryDate: '2026-05-16',
      sourceType: 'AGENT_PROVIDER_FEE',
      status: 'REVERSED',
      lines: [
        ['211', 3, 0],
        ['522', 0, 3],
      ],
    },
    {
      id: 'feeRec2r',
      entryDate: '2026-05-17',
      sourceType: 'MANUAL',
      reversalOf: 'feeRec2',
      lines: [
        ['522', 3, 0],
        ['211', 0, 3],
      ],
    },
    // AGENT_ADJUSTMENT crediting the agent back for a provider fee (Dr 522).
    {
      id: 'adj',
      entryDate: '2026-05-18',
      sourceType: 'AGENT_ADJUSTMENT',
      lines: [
        ['522', 2, 0],
        ['211', 0, 2],
      ],
    },
    // Any other source type on a selling account is ordinary expense.
    {
      id: 'odd',
      entryDate: '2026-05-19',
      sourceType: 'SOMETHING_NEW',
      lines: [
        ['521', 4, 0],
        ['211', 0, 4],
      ],
    },
  ];
  const service = new AccountingReportsService(
    createTestLedger({
      accounts: ACCOUNTS,
      entries,
      postingSettings: SETTINGS,
      receivingAccountIds: ['111', '112'],
      paymentMethodAccountIds: ['CLR'],
    }) as never,
  );

  it('gateway fees are shown gross less recovered from agents; shipping has no contra; TB net per account unchanged', async () => {
    const period = { dateFrom: '2026-05-01', dateTo: '2026-05-31' };
    const is = await service.incomeStatement(period);
    expect(is.totals.sellingBreakdown.SHIPPING_DELIVERY).toEqual({
      gross: 54, // 50 carrier + 4 other
      recoveredFromAgents: 0,
      net: 54,
    });
    expect(is.totals.sellingBreakdown.PAYMENT_GATEWAY_FEES).toEqual({
      gross: 20,
      recoveredFromAgents: 6, // 8 − 2 adjustment; the reversed 3 nets to 0
      net: 14,
    });
    expect(is.totals).toMatchObject({
      sellingDistribution: 68,
      recoveredFromAgents: 6,
      grossRevenue: 0,
      netIncome: -68,
    });
    expect(is.partitionDifference).toBe(0);
    expect(find(is.lines, 'is-selling-shipping:recovered')).toBeNull();
    expect(find(is.lines, 'is-selling-gateway:recovered')?.values.balance).toBe(
      -6,
    );
    const tb = await service.trialBalance(period);
    const row = (id: string) => tb.items.find((r) => r.accountId === id)!;
    // Ledger: 521 = 50 + 4 = 54; 522 = 20 − 8 − 3 + 3 + 2 = 14 = IS net.
    expect(row('521').closingBalance).toBe(54);
    expect(row('522').closingBalance).toBe(14);
  });
});

describe('AccountingReportsService — Africa/Cairo business-day boundaries (owner decision P9)', () => {
  // Timestamped entries are UTC instants; date-only entries are 00:00Z.
  const sale = (id: string, entryDate: string, amount: number): TestEntry => ({
    id,
    entryNumber: `JV-${id}`,
    entryDate,
    sourceType: 'SALES_INVOICE',
    lines: [
      ['121', amount, 0],
      ['411', 0, amount],
    ],
  });
  const receipt = (
    id: string,
    entryDate: string,
    amount: number,
  ): TestEntry => ({
    id,
    entryNumber: `JV-${id}`,
    entryDate,
    sourceType: 'CUSTOMER_RECEIPT',
    lines: [
      ['111', amount, 0],
      ['121', 0, amount],
    ],
  });
  const entries: TestEntry[] = [
    {
      id: 'cap',
      entryDate: '2026-01-01',
      sourceType: 'CAPITAL_CONTRIBUTION',
      lines: [
        ['111', 10000, 0],
        ['311', 0, 10000],
      ],
    },
    // DST starts 24 Apr 2026 (last Friday of April) at 22:00Z on the 23rd.
    sale('d1', '2026-04-23T21:30:00Z', 1), // 23:30 (+2) on 23 Apr
    sale('d2', '2026-04-23T22:30:00Z', 2), // 01:30 (+3) on 24 Apr
    // Month end (UTC+3): 21:00Z on 30 Sep is 00:00 on 1 Oct.
    sale('m2', '2026-09-30T20:30:00Z', 20), // 23:30 on 30 Sep
    receipt('c2', '2026-09-30T20:45:00Z', 7), // 23:45 on 30 Sep
    sale('m1', '2026-09-30T21:30:00Z', 10), // 00:30 on 1 Oct
    receipt('c1', '2026-09-30T21:40:00Z', 5), // 00:40 on 1 Oct
    sale('m3', '2026-10-01', 40), // date-only 1 Oct (00:00Z)
    // DST ends at the end of 29 Oct 2026 (last Thursday), 21:00Z.
    sale('d3', '2026-10-29T21:30:00Z', 4), // 23:30 (+2, repeated hour) on 29 Oct
    sale('d4', '2026-10-29T22:00:00Z', 8), // 00:00 (+2) on 30 Oct
    // Year end (UTC+2): 22:00Z on 31 Dec is 00:00 on 1 Jan.
    sale('y1', '2026-12-31T21:30:00Z', 100), // 23:30 on 31 Dec
    sale('y2', '2026-12-31T22:30:00Z', 200), // 00:30 on 1 Jan 2027
    sale('y3', '2027-01-01', 400), // date-only 1 Jan 2027
  ];
  const service = new AccountingReportsService(
    createTestLedger({
      accounts: ACCOUNTS,
      entries,
      postingSettings: SETTINGS,
      receivingAccountIds: ['111', '112'],
      fiscalYears: [
        { id: 'fy2026', startDate: '2026-01-01', endDate: '2026-12-31' },
      ],
    }) as never,
  );
  const revenue = async (dateFrom: string, dateTo: string) =>
    (await service.incomeStatement({ dateFrom, dateTo })).totals.grossRevenue;

  it('Income Statement: local midnight, month end, DST days and year end', async () => {
    expect(await revenue('2026-09-01', '2026-09-30')).toBe(20); // m2 only
    expect(await revenue('2026-10-01', '2026-10-01')).toBe(50); // m1 00:30 + m3 date-only
    expect(await revenue('2026-10-01', '2026-10-31')).toBe(62); // 10 + 40 + 4 + 8
    expect(await revenue('2026-04-23', '2026-04-23')).toBe(1);
    expect(await revenue('2026-04-24', '2026-04-24')).toBe(2);
    expect(await revenue('2026-10-29', '2026-10-29')).toBe(4); // 25-hour day
    expect(await revenue('2026-10-30', '2026-10-30')).toBe(8);
    expect(await revenue('2026-01-01', '2026-12-31')).toBe(185);
    expect(await revenue('2026-12-31', '2026-12-31')).toBe(100);
    expect(await revenue('2027-01-01', '2027-01-31')).toBe(600); // 200 at 00:30 + 400 date-only
  });

  it('Trial Balance: opening before the Cairo day, period inside it, balanced', async () => {
    const tb = await service.trialBalance({
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
    });
    const ar = tb.items.find((r) => r.accountId === '121')!;
    // opening = 1 + 2 + 20 − 7 = 16; Oct Dr 10 + 40 + 4 + 8 = 62, Cr 5 → 73
    expect(ar).toMatchObject({
      openingBalance: 16,
      debitTotal: 62,
      creditTotal: 5,
      closingBalance: 73,
    });
    expect(tb.checks.balanced).toBe(true);
  });

  it('Balance Sheet as of month end and across the year end (fiscal year by business date)', async () => {
    const sep = await service.balanceSheet({ dateTo: '2026-09-30' });
    expect(sep.totals).toMatchObject({
      currentYearProfit: 23, // 1 + 2 + 20
      cashAndCashEquivalents: 10007,
      balanced: true,
    });
    const dec = await service.balanceSheet({ dateTo: '2026-12-31' });
    expect(dec.totals.currentYearProfit).toBe(185);
    expect(dec.fiscalYearStart.toISOString()).toBe('2025-12-31T22:00:00.000Z');
    // No FY2027 row: the year starts 1 Jan 2027 Cairo (22:00Z on 31 Dec).
    const jan = await service.balanceSheet({ dateTo: '2027-01-01' });
    expect(jan.fiscalYearStart.toISOString()).toBe('2026-12-31T22:00:00.000Z');
    expect(jan.totals).toMatchObject({
      currentYearProfit: 600,
      priorPeriodsUnclosedProfit: 185,
      balanced: true,
    });
  });

  it('Cash Flow: the receipt at 00:40 Cairo on 1 Oct is October cash; closing = ledger', async () => {
    const sep = await service.cashFlowStatement({
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      view: 'activities',
    });
    expect('reconciliation' in sep && sep.reconciliation).toMatchObject({
      openingCash: 10000,
      operating: 7,
      closingCash: 10007,
      ledgerClosingCash: 10007,
    });
    const oct = await service.cashFlowStatement({
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
      view: 'activities',
    });
    expect('reconciliation' in oct && oct.reconciliation).toMatchObject({
      openingCash: 10007,
      operating: 5,
      closingCash: 10012,
      ledgerClosingCash: 10012,
    });
  });

  it('General Ledger (account statement) and Journal Report use the same Cairo day', async () => {
    const statement = await service.accountStatement({
      accountId: '121',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-01',
    });
    expect(statement.openingBalance).toBe(16);
    expect(statement.movements.map((m) => m.journalEntryId)).toEqual([
      'm1',
      'c1',
      'm3',
    ]);
    expect(statement.closingBalance).toBe(61); // 16 + 10 − 5 + 40
    const lastDay = await service.journalReport({
      dateFrom: '2026-12-31',
      dateTo: '2026-12-31',
      pageSize: 50,
      sortOrder: 'asc',
    });
    expect(lastDay.items.map((e) => e.id)).toEqual(['y1']);
    const newYear = await service.journalReport({
      dateFrom: '2027-01-01',
      dateTo: '2027-01-01',
      pageSize: 50,
      sortOrder: 'asc',
    });
    expect(newYear.items.map((e) => e.id)).toEqual(['y2', 'y3']);
  });
});

describe('Balance Sheet — current fiscal year picked like the posting locks (period-bounds)', () => {
  const sale = (id: string, entryDate: string, amount: number): TestEntry => ({
    id,
    entryDate,
    sourceType: 'SALES_INVOICE',
    lines: [
      ['121', amount, 0],
      ['411', 0, amount],
    ],
  });
  const entries = [
    sale('dec31', '2025-12-31T21:30:00Z', 5), // 23:30 Cairo on 31 Dec 2025
    sale('jan1', '2025-12-31T22:30:00Z', 7), // 00:30 Cairo on 1 Jan 2026
  ];
  const bsFor = (startDate: string, endDate: string) =>
    new AccountingReportsService(
      createTestLedger({
        accounts: ACCOUNTS,
        entries,
        postingSettings: SETTINGS,
        fiscalYears: [
          { id: 'fy2025', startDate: '2025-01-01', endDate: '2025-12-31' },
          { id: 'fy2026', startDate, endDate },
        ],
      }) as never,
    ).balanceSheet({ dateTo: '2026-01-01' });

  it.each([
    [
      'date-only 00:00Z bounds',
      '2026-01-01T00:00:00.000Z',
      '2026-12-31T00:00:00.000Z',
    ],
    [
      'server-local midnight start, end-of-day marker end',
      '2025-12-31T21:00:00.000Z',
      '2026-12-31T23:59:59.999Z',
    ],
  ])(
    'as of 1 Jan 2026 with %s → FY2026 from 1 Jan Cairo',
    async (_, start, end) => {
      const bs = await bsFor(start, end);
      expect(bs.fiscalYearStartDate).toBe('2026-01-01');
      expect(bs.fiscalYearStart.toISOString()).toBe('2025-12-31T22:00:00.000Z');
      // Only the 00:30-Cairo sale is FY2026; the 23:30 one stays in prior periods.
      expect(bs.totals).toMatchObject({
        currentYearProfit: 7,
        priorPeriodsUnclosedProfit: 5,
        balanced: true,
      });
    },
  );
});

describe('Income Statement — legacy capital returns in profit or loss', () => {
  it('stay under finance costs with a warning that points at the corrections list', () => {
    const accounts = [...ACCOUNTS, coa('551', 'EXPENSE', '5')];
    const ctx = buildClassificationContext(accounts, [
      ...ROLES,
      { accountId: '551', role: 'CAPITAL_RETURN' },
    ]);
    const result = buildIncomeStatement({
      accounts,
      sums: new Map([...PNL_SUMS, ['551', { debit: 100, credit: 0 }]]),
      ctx,
    });
    expect(result.totals.financeCosts).toBe(112); // 12 distribution + 100 legacy capital return
    expect(result.totals.operatingProfit).toBe(315); // below operating profit
    expect(find(result.lines, 'is-finance-costs/551')?.values.balance).toBe(
      100,
    );
    expect(result.warnings).toContainEqual({
      code: 'CAPITAL_RETURN_IN_PROFIT_OR_LOSS',
      accounts: [expect.objectContaining({ accountId: '551', amount: 100 })],
      correctionsEndpoint: '/capital-returns/corrections/affected',
    });
  });
});
