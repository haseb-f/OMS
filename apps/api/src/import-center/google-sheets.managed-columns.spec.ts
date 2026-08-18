import { planManagedColumnWrites } from './google-sheets.managed-columns';

const LIST_LAYOUT = {
  headerRow: 2,
  dataStartRow: 3,
  startColumn: 'A',
} as const;

describe('planManagedColumnWrites', () => {
  it('resolves managed columns from row 2 and writes values from row 3 only', () => {
    const plan = planManagedColumnWrites(
      [
        ['TITLE', 'KEEP', 'ROW1'],
        [
          'Country',
          'Product',
          'Currency',
          'Payment Method',
          'Employee Email',
          'Shipping Status',
          'Shipping Company',
        ],
        [
          'OldCountry',
          'OldProduct',
          'XXX',
          'Cash',
          'old@x.com',
          'SHIPPED',
          'DHL',
        ],
        ['Stale', '', '', '', '', '', ''],
      ],
      [
        { header: 'Country', values: ['السعودية'] },
        { header: 'Product', values: ['منتج الاختبار'] },
      ],
      LIST_LAYOUT,
    );

    const country = plan.writes.find((write) => write.header === 'Country');
    const product = plan.writes.find((write) => write.header === 'Product');
    expect(country?.columnIndex).toBe(0);
    expect(country?.startRow).toBe(3);
    expect(country?.cells[0]).toBe('السعودية');
    expect(country?.cells).not.toContain('Country');
    expect(country?.cells[1]).toBe('');
    expect(product?.columnIndex).toBe(1);
    expect(product?.startRow).toBe(3);
    expect(product?.cells[0]).toBe('منتج الاختبار');
    expect(plan.headerWrites).toEqual([]);
    expect(plan.missingHeaders).toEqual([]);
  });

  it('places missing managed headers into empty row-2 cells from column A', () => {
    const plan = planManagedColumnWrites(
      [['0', '0', '0', '0', '0', '0', '0']],
      [
        { header: 'Country', values: ['السعودية'] },
        { header: 'Product', values: ['منتج الاختبار'] },
      ],
      LIST_LAYOUT,
    );

    expect(plan.headerWrites).toEqual([
      { header: 'Country', columnIndex: 0, row: 2 },
      { header: 'Product', columnIndex: 1, row: 2 },
    ]);
    expect(plan.writes[0].startRow).toBe(3);
    expect(plan.writes[0].cells[0]).toBe('السعودية');
    expect(plan.writes[1].cells[0]).toBe('منتج الاختبار');
  });

  it('does not overwrite unmanaged row-2 cells when placing a missing header', () => {
    const plan = planManagedColumnWrites(
      [
        ['keep row 1'],
        ['Lead Status', 'Country', 'Notes'],
        ['New', 'Egypt', 'keep me'],
      ],
      [
        { header: 'Country', values: ['Saudi Arabia'] },
        { header: 'Product', values: ['أهم 5000 كلمة'] },
      ],
      LIST_LAYOUT,
    );

    expect(
      plan.writes.find((write) => write.header === 'Country')?.columnIndex,
    ).toBe(1);
    const productHeader = plan.headerWrites.find(
      (write) => write.header === 'Product',
    );
    expect(productHeader?.columnIndex).toBe(3);
    expect(plan.writes.some((write) => write.header === 'Lead Status')).toBe(
      false,
    );
    expect(plan.writes.some((write) => write.header === 'Notes')).toBe(false);
  });

  it('does not duplicate an existing header or rewrite it', () => {
    const plan = planManagedColumnWrites(
      [['keep row 1'], ['Country', 'Country']],
      [{ header: 'Country', values: ['Egypt'] }],
      LIST_LAYOUT,
    );
    expect(plan.writes).toHaveLength(1);
    expect(plan.headerWrites).toEqual([]);
    expect(plan.writes[0].columnIndex).toBe(0);
    expect(plan.writes[0].cells).toEqual(['Egypt']);
  });

  it('matches trimmed header names in the configured header row', () => {
    const plan = planManagedColumnWrites(
      [[], [' Country ']],
      [{ header: 'Country', values: ['Egypt'] }],
      LIST_LAYOUT,
    );
    expect(plan.writes[0].columnIndex).toBe(0);
    expect(plan.writes[0].startRow).toBe(3);
    expect(plan.headerWrites).toEqual([]);
  });
});
