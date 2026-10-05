import { Prisma } from '@prisma/client';
import { computeAssemblyCost } from './assembly-cost';
import { blendMovingAverage } from '../accounting/inventory-valuation/inventory-valuation.service';

describe('computeAssemblyCost', () => {
  it('the spec fixture: A 2 x 10 + B 1 x 15 + direct 5 = 40 for one unit', () => {
    const cost = computeAssemblyCost({
      lines: [
        { componentProductId: 'A', quantity: 2, unitCost: '10' },
        { componentProductId: 'B', quantity: 1, unitCost: '15' },
      ],
      directCost: '5',
      quantity: 1,
    });
    expect(cost.lines.map((line) => line.value.toString())).toEqual([
      '20',
      '15',
    ]);
    expect(cost.componentCost.toString()).toBe('35');
    expect(cost.totalCost.toString()).toBe('40');
    expect(cost.unitCost.toString()).toBe('40');
  });

  it('total 100 over 3 units gives 33.3333 per unit, and the total stays exactly 100', () => {
    const cost = computeAssemblyCost({
      lines: [{ componentProductId: 'A', quantity: 10, unitCost: '9' }],
      directCost: '10',
      quantity: 3,
    });
    expect(cost.totalCost.toString()).toBe('100');
    expect(cost.unitCost.toString()).toBe('33.3333');
    // the moving average blends the TOTAL: the pool value rises by exactly 100
    const average = blendMovingAverage({
      onHandBefore: 0,
      previousCost: 0,
      addedQuantity: 3,
      addedValue: cost.totalCost,
    });
    expect(average.toString()).toBe('33.3333');
    // a second batch blends against the first one's recorded total, not a rounded unit cost
    const blended = blendMovingAverage({
      onHandBefore: 3,
      previousCost: average,
      addedQuantity: 3,
      addedValue: cost.totalCost,
    });
    expect(blended.toString()).toBe('33.3333');
  });

  it('values each line at 2 dp from the 4-dp moving average, and the journal sum is the order total', () => {
    const cost = computeAssemblyCost({
      lines: [
        { componentProductId: 'A', quantity: 3, unitCost: '3.3333' },
        { componentProductId: 'B', quantity: 7, unitCost: '0.1234' },
      ],
      directCost: '0.01',
      quantity: 2,
    });
    expect(cost.lines[0].value.toString()).toBe('10'); // 9.9999 -> 10.00
    expect(cost.lines[1].value.toString()).toBe('0.86'); // 0.8638 -> 0.86
    const credits = cost.lines.reduce(
      (sum, line) => sum.add(line.value),
      new Prisma.Decimal(0),
    );
    expect(credits.add(cost.directCost).equals(cost.totalCost)).toBe(true);
    expect(cost.totalCost.toString()).toBe('10.87');
  });

  it('a zero-cost component contributes nothing and a zero direct cost is allowed', () => {
    const cost = computeAssemblyCost({
      lines: [{ componentProductId: 'A', quantity: 5, unitCost: 0 }],
      directCost: 0,
      quantity: 5,
    });
    expect(cost.totalCost.isZero()).toBe(true);
    expect(cost.unitCost.isZero()).toBe(true);
  });
});
