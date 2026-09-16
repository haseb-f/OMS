import { allocateProportionally } from './landed-cost-allocation.util';

describe('allocateProportionally', () => {
  it('M1 acceptance — BY_PURCHASE_VALUE: 15,000 freight over 50,000/100,000 base reconciles exactly', () => {
    const result = allocateProportionally(15000, [
      { key: 'A', weight: 50000 },
      { key: 'B', weight: 100000 },
    ]);
    const byKey = Object.fromEntries(result.map((r) => [r.key, r.amount]));
    expect(byKey.A).toBe(5000);
    expect(byKey.B).toBe(10000);
    expect(result.reduce((sum, r) => sum + r.amount, 0)).toBe(15000);
  });

  it('M1 acceptance — BY_QUANTITY: 15,000 freight over 500/500 units splits evenly and reconciles exactly', () => {
    const result = allocateProportionally(15000, [
      { key: 'A', weight: 500 },
      { key: 'B', weight: 500 },
    ]);
    const byKey = Object.fromEntries(result.map((r) => [r.key, r.amount]));
    expect(byKey.A).toBe(7500);
    expect(byKey.B).toBe(7500);
    expect(result.reduce((sum, r) => sum + r.amount, 0)).toBe(15000);
  });

  it('never loses a halala/cent to rounding across an uneven three-way split', () => {
    const result = allocateProportionally(100, [
      { key: 'A', weight: 1 },
      { key: 'B', weight: 1 },
      { key: 'C', weight: 1 },
    ]);
    expect(result.reduce((sum, r) => sum + r.amount, 0)).toBe(100);
    // 33.33 / 33.33 / 33.34 (or an equivalent single-cent-different split) —
    // never three equal 33.33 lines, which would lose one cent.
    const amounts = result.map((r) => r.amount).sort();
    expect(amounts).toEqual([33.33, 33.33, 33.34]);
  });

  it('reconciles exactly even with an odd totalAmount and many lines', () => {
    const bases = Array.from({ length: 7 }, (_, i) => ({
      key: `line-${i}`,
      weight: i + 1,
    }));
    const result = allocateProportionally(1000.01, bases);
    const sum = result.reduce((total, r) => total + r.amount, 0);
    expect(Math.round(sum * 100) / 100).toBe(1000.01);
  });

  it('falls back to an even split when every basis weight is zero', () => {
    const result = allocateProportionally(90, [
      { key: 'A', weight: 0 },
      { key: 'B', weight: 0 },
      { key: 'C', weight: 0 },
    ]);
    expect(result.every((r) => r.amount === 30)).toBe(true);
  });

  it('returns an empty array for an empty basis list', () => {
    expect(allocateProportionally(100, [])).toEqual([]);
  });
});
