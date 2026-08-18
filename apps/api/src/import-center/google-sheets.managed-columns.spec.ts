import { planManagedColumnWrites } from './google-sheets.managed-columns';

describe('planManagedColumnWrites', () => {
  it('resolves managed columns by header name and leaves unmanaged columns untouched', () => {
    const plan = planManagedColumnWrites(
      [
        ['Lead Status', 'Country', 'Notes'],
        ['New', 'Egypt', 'keep me'],
        ['', 'OldCountry', 'also keep'],
      ],
      [
        { header: 'Country', values: ['Saudi Arabia'] },
        { header: 'Product', values: ['أهم 5000 كلمة'] },
      ],
    );

    const country = plan.writes.find((write) => write.header === 'Country');
    const product = plan.writes.find((write) => write.header === 'Product');
    expect(country?.columnIndex).toBe(1);
    expect(country?.cells).toEqual(['Country', 'Saudi Arabia', '']);
    expect(product?.columnIndex).toBe(3);
    expect(product?.cells[0]).toBe('Product');
    expect(product?.cells[1]).toBe('أهم 5000 كلمة');
    expect(plan.writes.some((write) => write.header === 'Lead Status')).toBe(
      false,
    );
    expect(plan.writes.some((write) => write.header === 'Notes')).toBe(false);
  });

  it('does not duplicate an existing header', () => {
    const plan = planManagedColumnWrites(
      [['Country', 'Country']],
      [{ header: 'Country', values: ['Egypt'] }],
    );
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0].columnIndex).toBe(0);
  });

  it('matches trimmed header names', () => {
    const plan = planManagedColumnWrites(
      [[' Country ']],
      [{ header: 'Country', values: ['Egypt'] }],
    );
    expect(plan.writes[0].columnIndex).toBe(0);
  });
});
