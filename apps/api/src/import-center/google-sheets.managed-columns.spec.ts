import {
  planManagedColumnWrites,
  planMissingResultColumnIndexes,
  resolveResultColumnIndexes,
} from './google-sheets.managed-columns';

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

  it('resolves managed result columns by trimmed header name', () => {
    const plan = resolveResultColumnIndexes(
      [
        'External Order ID',
        ' Sync Status ',
        'System Order ID',
        'Error Message',
      ],
      ['Sync Status', 'System Order ID', 'Error Message'],
    );
    expect(plan.columnIndexByName['Sync Status']).toBe(1);
    expect(plan.missing).toEqual([]);
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

  it('places missing shipping result headers at X even when T:W have no headers', () => {
    const headers = [
      'External Order ID',
      ...Array.from({ length: 15 }, (_, i) => `Src ${i}`),
      'Sync Status',
      'System Order ID',
      'Error Message',
    ];
    expect(headers).toHaveLength(19);
    const planned = planMissingResultColumnIndexes(
      headers,
      ['Shipping Sync Status', 'Shipping Sync Message', 'Shipment ID'],
      'X',
    );
    expect(planned['Shipping Sync Status']).toBe(23);
    expect(planned['Shipping Sync Message']).toBe(24);
    expect(planned['Shipment ID']).toBe(25);
  });

  it('reuses an existing named shipping result column instead of moving it', () => {
    const resolved = resolveResultColumnIndexes(
      ['A', 'Shipping Sync Status'],
      ['Shipping Sync Status', 'Shipping Sync Message'],
    );
    expect(resolved.columnIndexByName['Shipping Sync Status']).toBe(1);
    const planned = planMissingResultColumnIndexes(
      ['A', 'Shipping Sync Status'],
      resolved.missing,
      'X',
    );
    expect(planned['Shipping Sync Message']).toBe(23);
    expect(planned['Shipping Sync Status']).toBeUndefined();
  });
});
