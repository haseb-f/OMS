import { Prisma } from '@prisma/client';
import {
  buildInvariant,
  compareKitCogs,
  plain,
  reconcileValuation,
  renderIntegrityMarkdown,
  summarize,
  valuationRoundingBound,
  violationFromRow,
  worstStatus,
} from './integrity-rules';
import { VIOLATION_CAP, type IntegrityViolation } from './integrity.types';

const violation = (
  severity: IntegrityViolation['severity'],
  rule = 'R',
): IntegrityViolation => ({ rule, severity, message: rule });

describe('integrity rules', () => {
  describe('status', () => {
    it('worst status wins, PASS when nothing is reported', () => {
      expect(worstStatus([])).toBe('PASS');
      expect(worstStatus(['PASS', 'WARN'])).toBe('WARN');
      expect(worstStatus(['WARN', 'FAIL', 'PASS'])).toBe('FAIL');
    });

    it('an invariant takes the worst violation severity and caps the list but not the count', () => {
      const many = Array.from({ length: VIOLATION_CAP + 5 }, () =>
        violation('WARN'),
      );
      const result = buildInvariant({
        id: 'I3',
        title: 't',
        checked: 10,
        violations: [...many, violation('FAIL')],
        uncounted: 7,
      });
      expect(result.status).toBe('FAIL');
      expect(result.violations).toHaveLength(VIOLATION_CAP);
      expect(result.violationCount).toBe(VIOLATION_CAP + 6 + 7);
      expect(result.truncated).toBe(true);
    });

    it('a floor raises a clean invariant (an unexplained GL difference is a WARN, never a FAIL)', () => {
      const result = buildInvariant({
        id: 'I6',
        title: 't',
        checked: 1,
        violations: [],
        floor: 'WARN',
      });
      expect(result.status).toBe('WARN');
      expect(result.violationCount).toBe(0);
    });

    it('summarizes per status', () => {
      const make = (status: 'PASS' | 'WARN' | 'FAIL') =>
        buildInvariant({
          id: 'I1',
          title: 't',
          checked: 0,
          violations: status === 'PASS' ? [] : [violation(status)],
        });
      expect(summarize([make('PASS'), make('WARN'), make('PASS')])).toEqual({
        status: 'WARN',
        summary: { PASS: 2, WARN: 1, FAIL: 0 },
      });
    });
  });

  describe('row conversion', () => {
    it('makes raw SQL values JSON-safe and drops the window total', () => {
      const row = {
        rule: 'X',
        total: 3,
        count: BigInt(4),
        amount: new Prisma.Decimal('1.2300'),
        at: new Date('2026-10-05T00:00:00.000Z'),
        list: ['a'],
        none: null,
      };
      const result = violationFromRow(row, 'FAIL', 'msg');
      expect(result).toEqual({
        rule: 'X',
        severity: 'FAIL',
        message: 'msg',
        count: 4,
        amount: '1.23',
        at: '2026-10-05T00:00:00.000Z',
        list: ['a'],
        none: null,
      });
      expect(() => JSON.stringify(result)).not.toThrow();
      expect(plain(undefined)).toBeNull();
    });
  });

  describe('valuation vs GL (I6)', () => {
    it('compares per account, keeps GL-only and unmapped buckets, totals the difference', () => {
      const result = reconcileValuation({
        subledger: [
          { accountId: 'inv-a', value: '100.10' },
          { accountId: 'inv-a', value: '50' },
          { accountId: null, value: '7' },
        ],
        gl: [
          { accountId: 'inv-a', code: '1300', name: 'Stock', balance: '150' },
          { accountId: 'inv-b', code: '1310', name: 'Other', balance: '-20' },
        ],
      });
      expect(result.rows).toEqual([
        {
          accountId: 'inv-a',
          code: '1300',
          name: 'Stock',
          subledgerValue: '150.10',
          glBalance: '150.00',
          difference: '0.10',
          products: 2,
        },
        {
          accountId: 'inv-b',
          code: '1310',
          name: 'Other',
          subledgerValue: '0.00',
          glBalance: '-20.00',
          difference: '20.00',
          products: 0,
        },
        {
          accountId: null,
          code: null,
          name: null,
          subledgerValue: '7.00',
          glBalance: '0.00',
          difference: '7.00',
          products: 1,
        },
      ]);
      expect(result.subledgerTotal.toFixed(2)).toBe('157.10');
      expect(result.glTotal.toFixed(2)).toBe('130.00');
      expect(result.difference.toFixed(2)).toBe('27.10');
    });

    it('rounding bound = Σ|onHand| × 0.00005 + 0.005 per product, rounded up to the cent', () => {
      expect(
        valuationRoundingBound([{ onHand: 1000 }, { onHand: -200 }]).toFixed(2),
      ).toBe('0.07');
      expect(valuationRoundingBound([]).toFixed(2)).toBe('0.00');
    });
  });

  describe('kit COGS (I5)', () => {
    const base = {
      invoiceId: 'inv-1',
      invoiceNumber: 'INV-1',
      accountId: 'cogs-k',
    };

    it('passes when the posted COGS equals the snapshot values of every line on the account', () => {
      expect(
        compareKitCogs({
          expected: [
            { ...base, amount: '35.00', hasKit: true },
            { ...base, amount: '12.50', hasKit: false },
          ],
          actual: [{ invoiceId: 'inv-1', accountId: 'cogs-k', debit: '47.5' }],
        }),
      ).toEqual([]);
    });

    it('fails when COGS was booked twice or not at all for a kit account', () => {
      const twice = compareKitCogs({
        expected: [{ ...base, amount: '35', hasKit: true }],
        actual: [{ invoiceId: 'inv-1', accountId: 'cogs-k', debit: '70' }],
      });
      expect(twice).toHaveLength(1);
      expect(twice[0]).toMatchObject({
        rule: 'KIT_COGS_MISMATCH',
        expected: '35.00',
        actual: '70.00',
      });
      expect(
        compareKitCogs({
          expected: [{ ...base, amount: '35', hasKit: true }],
          actual: [],
        })[0],
      ).toMatchObject({ actual: '0.00' });
    });

    it('ignores accounts no kit line maps to', () => {
      expect(
        compareKitCogs({
          expected: [{ ...base, amount: '10', hasKit: false }],
          actual: [],
        }),
      ).toEqual([]);
    });
  });

  it('renders a markdown summary with every invariant', () => {
    const invariants = [
      buildInvariant({ id: 'I1', title: 'Chain', checked: 3, violations: [] }),
      buildInvariant({
        id: 'I6',
        title: 'Valuation',
        checked: 2,
        violations: [violation('WARN', 'VALUATION_GL_DIFFERENCE')],
        notes: ['company-wide'],
        metrics: { difference: '1.00' },
      }),
    ];
    const markdown = renderIntegrityMarkdown({
      generatedAt: '2026-10-05T00:00:00.000Z',
      durationMs: 5,
      filter: { productIds: null, warehouseId: null },
      ...summarize(invariants),
      invariants,
    });
    expect(markdown).toContain('overall **WARN**');
    expect(markdown).toContain('| I1 Chain | PASS | 3 | 0 |');
    expect(markdown).toContain('[WARN] VALUATION_GL_DIFFERENCE');
    expect(markdown).toContain('| difference | 1.00 |');
  });
});
