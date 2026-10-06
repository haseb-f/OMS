import { Prisma } from '@prisma/client';
import {
  findRecipeCycle,
  maximumAssemblableQuantity,
  ownerViolation,
  toWholeUnits,
} from './recipe-rules';

const D = (value: string | number) => new Prisma.Decimal(value);

describe('toWholeUnits', () => {
  it('accepts whole numbers and rejects fractions, zero and negatives', () => {
    expect(toWholeUnits(D(4))).toBe(4);
    expect(toWholeUnits(D('12.000000'))).toBe(12);
    expect(toWholeUnits(D('2.5'))).toBeNull();
    expect(toWholeUnits(D(0))).toBeNull();
    expect(toWholeUnits(D(-3))).toBeNull();
  });

  it('reads a non-terminating quotient that multiplies back to a whole number as whole', () => {
    // 3 per run × (1 ÷ 3) of a run = 1 unit, although 1 ÷ 3 is not exact.
    expect(toWholeUnits(D(3).mul(D(1).div(3)))).toBe(1);
    expect(toWholeUnits(D(6).mul(D(100).div(300)))).toBe(2);
  });

  it('keeps 2.4999 fractional', () => {
    expect(toWholeUnits(D('2.4999'))).toBeNull();
  });
});

describe('findRecipeCycle', () => {
  const edges = (entries: Record<string, string[]>) =>
    new Map(Object.entries(entries));

  it('accepts an acyclic candidate', () => {
    expect(
      findRecipeCycle('A', ['B', 'C'], edges({ B: ['D'], C: [] })),
    ).toBeNull();
  });

  it('finds a direct self reference', () => {
    expect(findRecipeCycle('A', ['A'], edges({}))).toEqual(['A', 'A']);
  });

  it('finds a two-step cycle and names the path', () => {
    expect(findRecipeCycle('A', ['B'], edges({ B: ['A'] }))).toEqual([
      'A',
      'B',
      'A',
    ]);
  });

  it('finds a deep cycle through several active recipes', () => {
    expect(
      findRecipeCycle('A', ['B'], edges({ B: ['C'], C: ['D'], D: ['A'] })),
    ).toEqual(['A', 'B', 'C', 'D', 'A']);
  });

  it('ignores the old edges of the root (the version being replaced)', () => {
    // The ACTIVE recipe of A used B; the candidate drops B, so B -> A is no cycle for A -> C.
    expect(
      findRecipeCycle('A', ['C'], edges({ A: ['B'], B: ['A'] })),
    ).toBeNull();
  });

  it('terminates on a diamond and on a cycle that does not pass through the root', () => {
    expect(
      findRecipeCycle(
        'A',
        ['B', 'C'],
        edges({ B: ['D'], C: ['D'], D: ['E'], E: ['D'] }),
      ),
    ).toBeNull();
  });
});

describe('ownerViolation', () => {
  const product = (id: string, ownerAgentId: string | null) => ({
    id,
    label: id,
    ownerAgentId,
  });

  it('is satisfied when everything is company stock', () => {
    expect(
      ownerViolation(product('FG', null), [
        product('A', null),
        product('B', null),
      ]),
    ).toBeNull();
  });

  it('is satisfied when everything belongs to the same agent', () => {
    expect(
      ownerViolation(product('FG', 'agent-1'), [product('A', 'agent-1')]),
    ).toBeNull();
  });

  it('rejects a company product with an agent component, naming it', () => {
    const message = ownerViolation(product('FG', null), [
      product('A', null),
      product('B', 'agent-1'),
    ]);
    expect(message).toContain('B belongs to agent agent-1');
    expect(message).not.toContain('A belongs');
  });

  it('rejects an agent product with a company component and two different agents', () => {
    expect(
      ownerViolation(product('FG', 'agent-1'), [product('A', null)]),
    ).not.toBeNull();
    expect(
      ownerViolation(product('FG', 'agent-1'), [product('A', 'agent-2')]),
    ).not.toBeNull();
  });
});

describe('maximumAssemblableQuantity', () => {
  it('is the stock bound of the scarcest component', () => {
    expect(
      maximumAssemblableQuantity([
        { perUnit: D(2), available: 11 },
        { perUnit: D(1), available: 40 },
      ]),
    ).toBe(5);
  });

  it('counts only quantities that consume whole units (3 per 2 finished units)', () => {
    // perUnit 1.5: 7 units would consume 10.5, so the largest whole-consumption count is 6.
    expect(
      maximumAssemblableQuantity([{ perUnit: D('1.5'), available: 11 }]),
    ).toBe(6);
  });

  it('never counts negative or zero stock', () => {
    expect(maximumAssemblableQuantity([{ perUnit: D(1), available: -4 }])).toBe(
      0,
    );
    expect(maximumAssemblableQuantity([])).toBe(0);
  });
});
