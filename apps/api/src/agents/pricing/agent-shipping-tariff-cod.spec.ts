import {
  duplicateRateKey,
  resolveSubmissionTariff,
  resolveTariff,
  shippingAgreementCoverage,
  type TariffRow,
} from './agent-shipping-tariff';
import { assessmentInstant } from '../common/agent-assessment';

/**
 * R17 §3 (specs/round17-refinements/README.md) — the default `ANY` row, the
 * resolution order (destination first, then service-specific over ANY), the
 * COD collection fee ADDED vs INCLUDED, prepaid never paying the fee, and
 * duplicate rejection. Numeric anchors: base 25 SAR + fee 10 → prepaid 25,
 * COD 35; an INCLUDED COD row of 35 → 35 (not 45); v2 base 30 + fee 12 →
 * COD 42, prepaid 30.
 */
const SA = 'country-sa';
const EG = 'country-eg';
const riyadh = { countryId: SA, city: 'Riyadh' };
const row = (
  id: string,
  over: Partial<TariffRow> & Pick<TariffRow, 'service' | 'amount'>,
): TariffRow => ({ id, countryId: null, city: '', ...over });

describe('R17 §3 — default rate, specificity and the COD collection fee', () => {
  it('the ANY default row prices every service to every destination; prepaid 25, COD 25 + 10 = 35', () => {
    const rows = [row('default', { service: 'ANY', amount: 25 })];
    expect(resolveTariff(rows, riyadh, 'PREPAID_CARRIER', 10)).toEqual({
      id: 'default',
      amount: 25,
      base: 25,
      codFee: 0,
      codFeeMode: 'NONE',
      service: 'PREPAID_CARRIER',
      rowService: 'ANY',
      scope: 'ALL',
    });
    expect(resolveTariff(rows, riyadh, 'COD_INTERNAL_COURIER', 10)).toEqual({
      id: 'default',
      amount: 35,
      base: 25,
      codFee: 10,
      codFeeMode: 'ADDED',
      service: 'COD_INTERNAL_COURIER',
      rowService: 'ANY',
      scope: 'ALL',
    });
    // No fee configured: COD pays the base, nothing is added.
    expect(resolveTariff(rows, riyadh, 'COD_CARRIER', null)).toMatchObject({
      amount: 25,
      codFee: 0,
      codFeeMode: 'NONE',
    });
  });

  it('an INCLUDED COD row is all-inclusive: 35, never 35 + 10 = 45', () => {
    const rows = [
      row('default', { service: 'ANY', amount: 25 }),
      row('cod', { service: 'COD_CARRIER', amount: 35, codFee: 'INCLUDED' }),
    ];
    expect(resolveTariff(rows, riyadh, 'COD_CARRIER', 10)).toMatchObject({
      id: 'cod',
      amount: 35,
      base: 35,
      codFee: 0,
      codFeeMode: 'INCLUDED',
    });
    // Another COD channel still falls back to the default row + fee.
    expect(
      resolveTariff(rows, riyadh, 'COD_INTERNAL_COURIER', 10),
    ).toMatchObject({ id: 'default', amount: 35, codFeeMode: 'ADDED' });
    // An INCLUDED default row is all-inclusive for COD too.
    const inclusive = [
      row('default', { service: 'ANY', amount: 40, codFee: 'INCLUDED' }),
    ];
    expect(resolveTariff(inclusive, riyadh, 'COD_CARRIER', 10)).toMatchObject({
      amount: 40,
      codFeeMode: 'INCLUDED',
    });
  });

  it('prepaid never pays the fee, whatever the row mode', () => {
    const rows = [
      row('default', { service: 'ANY', amount: 25, codFee: 'INCLUDED' }),
      row('pp', { service: 'PREPAID_INTERNAL_COURIER', amount: 20 }),
    ];
    for (const service of [
      'PREPAID_CARRIER',
      'PREPAID_INTERNAL_COURIER',
    ] as const) {
      const hit = resolveTariff(rows, riyadh, service, 10);
      expect(hit?.codFee).toBe(0);
      expect(hit?.codFeeMode).toBe('NONE');
      expect(hit?.amount).toBe(hit?.base);
    }
  });

  it('resolution: most specific destination first, then service-specific over ANY; row order never matters', () => {
    const rows = [
      row('default', { service: 'ANY', amount: 25 }),
      row('all-cod', { service: 'COD_CARRIER', amount: 30 }),
      row('sa-any', { service: 'ANY', countryId: SA, amount: 27 }),
      row('sa-cod', { service: 'COD_CARRIER', countryId: SA, amount: 33 }),
      row('riyadh-any', {
        service: 'ANY',
        countryId: SA,
        city: 'riyadh',
        amount: 22,
      }),
    ];
    const at = (destination: typeof riyadh, service: 'COD_CARRIER') =>
      [rows, [...rows].reverse()].map(
        (list) => resolveTariff(list, destination, service)?.id,
      );
    // City (even ANY) beats a country service row.
    expect(at(riyadh, 'COD_CARRIER')).toEqual(['riyadh-any', 'riyadh-any']);
    // Same destination (country): the service row beats ANY.
    const jeddah = { countryId: SA, city: 'Jeddah' };
    expect(at(jeddah, 'COD_CARRIER')).toEqual(['sa-cod', 'sa-cod']);
    expect(resolveTariff(rows, jeddah, 'PREPAID_CARRIER')?.id).toBe('sa-any');
    // Same destination (all): the service row beats the default.
    const cairo = { countryId: EG, city: 'Cairo' };
    expect(at(cairo, 'COD_CARRIER')).toEqual(['all-cod', 'all-cod']);
    // The default row is the final fallback.
    expect(resolveTariff(rows, cairo, 'PREPAID_CARRIER')?.id).toBe('default');
    // No default and no match → unresolved (never zero).
    expect(
      resolveTariff(
        [row('sa', { service: 'ANY', countryId: SA, amount: 1 })],
        cairo,
        'COD_CARRIER',
      ),
    ).toBeNull();
  });

  it('submission freezes { base, codFee, codFeeMode, amount } per channel (spec example v1 / v2)', () => {
    const v1 = [row('v1', { service: 'ANY', amount: 25 })];
    expect(
      resolveSubmissionTariff(v1, riyadh, 'CASH_ON_DELIVERY', 10),
    ).toMatchObject({
      status: 'CONFIRMED',
      tariff: { amount: 35 },
      byChannel: {
        CARRIER: { base: 25, codFee: 10, codFeeMode: 'ADDED', amount: 35 },
        INTERNAL_COURIER: {
          base: 25,
          codFee: 10,
          codFeeMode: 'ADDED',
          amount: 35,
        },
      },
    });
    const v2 = [row('v2', { service: 'ANY', amount: 30 })];
    expect(
      resolveSubmissionTariff(v2, riyadh, 'CASH_ON_DELIVERY', 12)?.tariff
        .amount,
    ).toBe(42);
    expect(
      resolveSubmissionTariff(v2, riyadh, 'PREPAID', 12)?.tariff,
    ).toMatchObject({ amount: 30, codFee: 0, codFeeMode: 'NONE' });
  });

  it('coverage cells show the charged amount and name the default (ANY) row', () => {
    const coverage = shippingAgreementCoverage(
      [
        row('default', { service: 'ANY', amount: 25 }),
        row('cod', { service: 'COD_CARRIER', amount: 35, codFee: 'INCLUDED' }),
      ],
      10,
    );
    const cells = coverage.destinations[0].cells;
    expect(coverage.complete).toBe(true);
    expect(cells.PREPAID_CARRIER).toMatchObject({
      amount: 25,
      inherited: false,
      rowService: 'ANY',
    });
    expect(cells.COD_INTERNAL_COURIER).toMatchObject({
      amount: 35,
      base: 25,
      codFeeMode: 'ADDED',
      rowService: 'ANY',
    });
    expect(cells.COD_CARRIER).toMatchObject({
      amount: 35,
      codFeeMode: 'INCLUDED',
      inherited: false,
      rowService: 'COD_CARRIER',
    });
  });

  it('duplicates (same service × destination) are rejected; ANY and a service row at one destination are not duplicates', () => {
    expect(
      duplicateRateKey([
        { service: 'ANY', countryId: null, city: '' },
        { service: 'COD_CARRIER', countryId: null, city: '' },
        { service: 'ANY', countryId: SA, city: 'Riyadh' },
      ]),
    ).toBeNull();
    expect(
      duplicateRateKey([
        { service: 'ANY', countryId: null, city: '' },
        { service: 'ANY', countryId: null, city: '' },
      ]),
    ).toBe('ANY#*');
    expect(
      duplicateRateKey([
        { service: 'COD_CARRIER', countryId: SA, city: 'Riyadh' },
        { service: 'COD_CARRIER', countryId: SA, city: ' RIYADH ' },
      ]),
    ).toBe(`COD_CARRIER#${SA}|riyadh`);
  });
});

describe('R17 §2 — assessment instant = order submission', () => {
  const now = new Date('2026-10-11T09:30:00.000Z'); // 12:30 Cairo
  it('agent users and undated orders are assessed now', () => {
    expect(assessmentInstant(true, '2026-01-01', now)).toBe(now);
    expect(assessmentInstant(false, undefined, now)).toBe(now);
  });
  it('an internal order dated today is assessed now (a version saved earlier today applies)', () => {
    expect(assessmentInstant(false, '2026-10-11', now)).toBe(now);
  });
  it('an internal order back-dated to an earlier day keeps that date', () => {
    expect(assessmentInstant(false, '2026-06-01', now).toISOString()).toBe(
      '2026-06-01T00:00:00.000Z',
    );
  });
});
