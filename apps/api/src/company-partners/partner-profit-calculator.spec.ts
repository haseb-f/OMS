import {
  type AgreementInForce,
  type ProfitFigures,
  computePartnerResult,
  frequencyWindow,
  maxConcurrentPercent,
  partnerWindows,
  round2HalfUp,
} from './partner-profit-calculator';

const figures = (gross: number, net: number): ProfitFigures => ({
  netRevenue: 0,
  costOfSales: 0,
  grossProfit: gross,
  otherExpensesNet: gross - net,
  netProfit: net,
});

const agreement = (
  partial: Partial<AgreementInForce> & { id: string },
): AgreementInForce => ({
  partnerId: 'A',
  percent: 30,
  basis: 'NET_PROFIT',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  frequency: 'MONTHLY',
  ...partial,
});

describe('company partner profit calculator (spec-5 §4)', () => {
  it('spec example: A 30% → 40% on 16 March = 8 000×30% + 12 000×40% = 7 200', () => {
    const agreements = [
      agreement({ id: 'a1', percent: 30, effectiveTo: '2026-03-15' }),
      agreement({ id: 'a2', percent: 40, effectiveFrom: '2026-03-16' }),
    ];
    const windows = partnerWindows(agreements, '2026-03-01', '2026-03-31');
    expect(windows.map((w) => [w.from, w.to])).toEqual([
      ['2026-03-01', '2026-03-15'],
      ['2026-03-16', '2026-03-31'],
    ]);
    const net = { '2026-03-01': 8_000, '2026-03-16': 12_000 } as Record<
      string,
      number
    >;
    const result = computePartnerResult(
      'A',
      windows.map((w) => ({ ...w, figures: figures(0, net[w.from]) })),
    );
    expect(result.amount).toBe(7_200);
    expect(result.segments.map((s) => [s.days, s.amount])).toEqual([
      [15, 2_400],
      [16, 4_800],
    ]);
  });

  it('a loss segment yields 0 (no carry-forward) and gross basis reads gross profit', () => {
    const net = computePartnerResult('A', [
      {
        agreement: agreement({ id: 'n' }),
        from: '2026-03-01',
        to: '2026-03-31',
        figures: figures(5_000, -1_000),
      },
    ]);
    expect(net.amount).toBe(0);
    expect(net.segments[0].lossClamped).toBe(true);
    const gross = computePartnerResult('A', [
      {
        agreement: agreement({ id: 'g', basis: 'GROSS_PROFIT' }),
        from: '2026-03-01',
        to: '2026-03-31',
        figures: figures(5_000, -1_000),
      },
    ]);
    expect(gross.amount).toBe(1_500);
  });

  it('rounds once per partner, 2 dp half-up, and the segments add up to it', () => {
    expect(round2HalfUp(0.005)).toBe(0.01);
    expect(round2HalfUp(2.675)).toBe(2.68);
    const result = computePartnerResult('A', [
      {
        agreement: agreement({ id: 'x', percent: 33.3333 }),
        from: '2026-03-01',
        to: '2026-03-15',
        figures: figures(0, 100.01),
      },
      {
        agreement: agreement({ id: 'y', percent: 33.3333 }),
        from: '2026-03-16',
        to: '2026-03-31',
        figures: figures(0, 100.01),
      },
    ]);
    // 200.02 × 33.3333 % = 66.67326… → 66.67
    expect(result.amount).toBe(66.67);
    expect(
      round2HalfUp(result.segments.reduce((s, x) => s + x.amount, 0)),
    ).toBe(66.67);
  });

  it('Σ% of agreements in force on any day: back-to-back is fine, an overlap is counted', () => {
    expect(
      maxConcurrentPercent([
        { from: '2026-01-01', to: '2026-03-15', percent: 60 },
        { from: '2026-03-16', to: null, percent: 70 },
        { from: '2026-01-01', to: null, percent: 30 },
      ]).max,
    ).toBe(100);
    expect(
      maxConcurrentPercent([
        { from: '2026-01-01', to: '2026-03-16', percent: 60 },
        { from: '2026-03-16', to: null, percent: 50 },
      ]),
    ).toEqual({ max: 110, on: '2026-03-16' });
  });

  it('period windows follow the frequency', () => {
    expect(frequencyWindow('MONTHLY', '2028-02-01')).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
    expect(frequencyWindow('QUARTERLY', '2026-04-01')?.to).toBe('2026-06-30');
    expect(frequencyWindow('QUARTERLY', '2026-05-01')).toBeNull();
    expect(frequencyWindow('ANNUAL', '2026-01-01')?.to).toBe('2026-12-31');
    expect(frequencyWindow('MONTHLY', '2026-03-02')).toBeNull();
  });
});
