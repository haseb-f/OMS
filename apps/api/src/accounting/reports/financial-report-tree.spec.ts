import {
  buildAccountForest,
  classifyCashFlowSource,
  leafLine,
  rollUpCoaAmounts,
  wrapSection,
  type CoaNode,
} from './financial-report-tree';

const accounts: CoaNode[] = [
  {
    id: '1',
    code: '1',
    name: 'Assets',
    nameEn: 'Assets',
    accountType: 'ASSET',
    parentAccountId: null,
    level: 1,
    allowsPosting: false,
  },
  {
    id: '11',
    code: '11',
    name: 'Current Assets',
    nameEn: 'Current Assets',
    accountType: 'ASSET',
    parentAccountId: '1',
    level: 2,
    allowsPosting: false,
  },
  {
    id: '1101',
    code: '1101',
    name: 'Cash',
    nameEn: 'Cash',
    accountType: 'ASSET',
    parentAccountId: '11',
    level: 3,
    allowsPosting: true,
  },
  {
    id: '1102',
    code: '1102',
    name: 'Bank',
    nameEn: 'Bank',
    accountType: 'ASSET',
    parentAccountId: '11',
    level: 3,
    allowsPosting: true,
  },
];

describe('financial-report-tree', () => {
  it('rolls posting amounts up the real COA parent chain', () => {
    const rolled = rollUpCoaAmounts(
      accounts,
      {
        '1101': { balance: 100 },
        '1102': { balance: 40 },
      },
      ['balance'],
    );
    expect(rolled['1101'].balance).toBe(100);
    expect(rolled['11'].balance).toBe(140);
    expect(rolled['1'].balance).toBe(140);
  });

  it('builds an expandable forest with posting children under groups', () => {
    const forest = buildAccountForest(accounts, { '1101': { balance: 100 } }, [
      'balance',
    ]);
    expect(forest).toHaveLength(1);
    expect(forest[0].kind).toBe('group');
    expect(forest[0].code).toBe('1');
    expect(forest[0].children[0].code).toBe('11');
    expect(forest[0].children[0].children[0].kind).toBe('posting');
    expect(forest[0].children[0].children[0].values.balance).toBe(100);
  });

  it('wraps a section with a subtotal derived from children', () => {
    const section = wrapSection({
      id: 'assets',
      label: 'Assets',
      children: [
        leafLine({
          id: 'cash',
          kind: 'posting',
          label: 'Cash',
          values: { balance: 80 },
        }),
      ],
      valueKeys: ['balance'],
      totalLabel: 'Total Assets',
    });
    expect(section.kind).toBe('section');
    expect(section.children.at(-1)?.kind).toBe('section_total');
    expect(section.values.balance).toBe(80);
  });

  it('classifies cash-flow source types into operating / investing / financing', () => {
    expect(classifyCashFlowSource('CUSTOMER_RECEIPT')).toBe('OPERATING');
    expect(classifyCashFlowSource('FIXED_ASSET_CAPITALIZATION')).toBe(
      'INVESTING',
    );
    expect(classifyCashFlowSource('CAPITAL_CONTRIBUTION')).toBe('FINANCING');
  });
});
