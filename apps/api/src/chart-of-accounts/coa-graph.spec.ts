import { validateCoaImportGraph } from './coa-graph';

describe('validateCoaImportGraph', () => {
  const roots = [
    {
      code: '1',
      name: 'Assets',
      accountType: 'ASSET',
      parentCode: null,
      level: 1,
    },
  ];

  it('accepts a valid posting leaf under a system root', () => {
    const errors = validateCoaImportGraph(
      [
        {
          code: 'AR',
          name: 'Receivable',
          accountType: 'ASSET',
          parentAccountCode: '1',
          accountKind: 'POSTING',
        },
      ],
      roots,
    );
    expect(errors).toEqual([]);
  });

  it('rejects posting parents that gain children', () => {
    const errors = validateCoaImportGraph(
      [
        {
          code: '11',
          name: 'Current',
          accountType: 'ASSET',
          parentAccountCode: '1',
          accountKind: 'POSTING',
        },
        {
          code: '111',
          name: 'Cash',
          accountType: 'ASSET',
          parentAccountCode: '11',
          accountKind: 'POSTING',
        },
      ],
      roots,
    );
    expect(errors.some((error) => error.code === '111')).toBe(true);
  });

  it('rejects cycles and depth beyond 4', () => {
    const cycleErrors = validateCoaImportGraph(
      [
        {
          code: 'A',
          name: 'A',
          accountType: 'ASSET',
          parentAccountCode: 'B',
          accountKind: 'AGGREGATION',
        },
        {
          code: 'B',
          name: 'B',
          accountType: 'ASSET',
          parentAccountCode: 'A',
          accountKind: 'AGGREGATION',
        },
      ],
      roots,
    );
    expect(cycleErrors.length).toBeGreaterThan(0);

    const depthErrors = validateCoaImportGraph(
      [
        {
          code: '11',
          name: 'L2',
          accountType: 'ASSET',
          parentAccountCode: '1',
          accountKind: 'AGGREGATION',
        },
        {
          code: '111',
          name: 'L3',
          accountType: 'ASSET',
          parentAccountCode: '11',
          accountKind: 'AGGREGATION',
        },
        {
          code: '1111',
          name: 'L4',
          accountType: 'ASSET',
          parentAccountCode: '111',
          accountKind: 'AGGREGATION',
        },
        {
          code: '11111',
          name: 'L5',
          accountType: 'ASSET',
          parentAccountCode: '1111',
          accountKind: 'POSTING',
        },
      ],
      roots,
    );
    expect(depthErrors.some((error) => error.code === '11111')).toBe(true);
  });

  it('rejects non-root rows without a parent', () => {
    const errors = validateCoaImportGraph(
      [
        {
          code: 'ORPHAN',
          name: 'Orphan',
          accountType: 'ASSET',
          parentAccountCode: '',
          accountKind: 'POSTING',
        },
      ],
      roots,
    );
    expect(errors.some((error) => error.code === 'ORPHAN')).toBe(true);
  });

  it('R13 B1 — rejects a file child under an existing POSTING account', () => {
    const errors = validateCoaImportGraph(
      [
        {
          code: '1101',
          name: 'Petty cash',
          accountType: 'ASSET',
          parentAccountCode: '110',
          accountKind: 'POSTING',
        },
      ],
      [
        ...roots,
        {
          code: '110',
          name: 'Cash',
          accountType: 'ASSET',
          parentCode: '1',
          level: 2,
          allowsPosting: true,
        },
      ],
    );
    expect(errors.map((e) => e.code)).toEqual(['1101']);
    expect(errors[0].message).toMatch(/convert it to a Group/);
  });

  it('R13 B1 — rejects marking POSTING an account that keeps database children', () => {
    const errors = validateCoaImportGraph(
      [
        {
          code: '11',
          name: 'Current',
          accountType: 'ASSET',
          parentAccountCode: '1',
          accountKind: 'POSTING',
        },
      ],
      [
        ...roots,
        {
          code: '11',
          name: 'Current',
          accountType: 'ASSET',
          parentCode: '1',
          level: 2,
          allowsPosting: false,
        },
        {
          code: '1101',
          name: 'Cash',
          accountType: 'ASSET',
          parentCode: '11',
          level: 3,
          allowsPosting: true,
        },
      ],
    );
    expect(errors.map((e) => e.code)).toEqual(['11']);
  });

  it('R13 B1 — an archived code or archived parent is reported clearly', () => {
    const errors = validateCoaImportGraph(
      [
        {
          code: '19',
          name: 'Reused',
          accountType: 'ASSET',
          parentAccountCode: '1',
          accountKind: 'POSTING',
        },
        {
          code: '1801',
          name: 'Under archived',
          accountType: 'ASSET',
          parentAccountCode: '18',
          accountKind: 'POSTING',
        },
      ],
      [
        ...roots,
        {
          code: '19',
          name: 'Old',
          accountType: 'ASSET',
          parentCode: '1',
          level: 2,
          archived: true,
        },
        {
          code: '18',
          name: 'Old group',
          accountType: 'ASSET',
          parentCode: '1',
          level: 2,
          archived: true,
        },
      ],
    );
    expect(errors.map((e) => e.code)).toEqual(['19', '1801']);
    expect(errors[0].message).toMatch(/archived account/);
    expect(errors[1].message).toMatch(/is archived/);
  });
});
