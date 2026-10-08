import {
  deliveryChannelOf,
  destinationKeyOf,
  resolveSubmissionTariff,
  resolveTariff,
  serviceOf,
  shippingAgreementCoverage,
  type TariffRow,
} from './agent-shipping-tariff';
import { repriceForConfirmedFee } from './agent-shipping-reprice';
import {
  agentShippingEconomics,
  agentShippingPricingView,
} from './agent-shipping-pricing-view';
import { leakedKeys } from './leaked-keys.test-util';

const SA = 'country-sa';
const EG = 'country-eg';
const row = (
  id: string,
  over: Partial<TariffRow> & Pick<TariffRow, 'service' | 'amount'>,
): TariffRow => ({ id, countryId: SA, city: '', ...over });

/** spec-2-agent-pricing.md worked tariff (SAR), as explicit services. */
const WORKED: TariffRow[] = [
  row('prepaid-carrier', { service: 'PREPAID_CARRIER', amount: 25 }),
  row('cod-carrier', { service: 'COD_CARRIER', amount: 35 }),
  row('cod-internal', { service: 'COD_INTERNAL_COURIER', amount: 25 }),
];
const dest = { countryId: SA, city: 'Riyadh' };

describe('agent shipping agreement resolution (R15 D15-13)', () => {
  it('service = delivery channel × payment type (four services, no wildcard)', () => {
    expect(serviceOf('CARRIER', 'PREPAID')).toBe('PREPAID_CARRIER');
    expect(serviceOf('CARRIER', 'CASH_ON_DELIVERY')).toBe('COD_CARRIER');
    expect(serviceOf('INTERNAL_COURIER', 'CASH_ON_DELIVERY')).toBe(
      'COD_INTERNAL_COURIER',
    );
    expect(serviceOf('INTERNAL_COURIER', 'PREPAID')).toBe(
      'PREPAID_INTERNAL_COURIER',
    );
  });

  it('worked tariff: every service resolves to its own row; a missing service is null (never zero)', () => {
    expect(resolveTariff(WORKED, dest, 'PREPAID_CARRIER')?.amount).toBe(25);
    expect(resolveTariff(WORKED, dest, 'COD_CARRIER')?.amount).toBe(35);
    expect(resolveTariff(WORKED, dest, 'COD_INTERNAL_COURIER')?.amount).toBe(
      25,
    );
    expect(resolveTariff(WORKED, dest, 'PREPAID_INTERNAL_COURIER')).toBeNull();
  });

  it('destination specificity: city > country > all destinations; other countries / cities never match', () => {
    const rows: TariffRow[] = [
      row('all', { service: 'COD_CARRIER', countryId: null, amount: 70 }),
      row('country', { service: 'COD_CARRIER', amount: 60 }),
      row('city', { service: 'COD_CARRIER', city: ' riyadh ', amount: 40 }),
      row('other-service', { service: 'PREPAID_CARRIER', amount: 1 }),
    ];
    expect(resolveTariff(rows, dest, 'COD_CARRIER')).toEqual({
      id: 'city',
      amount: 40,
      service: 'COD_CARRIER',
      scope: 'CITY',
    });
    const jeddah = { countryId: SA, city: 'Jeddah' };
    expect(resolveTariff(rows, jeddah, 'COD_CARRIER')).toMatchObject({
      id: 'country',
      scope: 'COUNTRY',
    });
    const egypt = { countryId: EG, city: 'Riyadh' };
    expect(resolveTariff(rows, egypt, 'COD_CARRIER')).toMatchObject({
      id: 'all',
      scope: 'ALL',
    });
    // The order of the rows never changes the winner.
    expect(resolveTariff([...rows].reverse(), dest, 'COD_CARRIER')?.id).toBe(
      'city',
    );
    // No row for the service anywhere.
    expect(resolveTariff(rows, dest, 'PREPAID_INTERNAL_COURIER')).toBeNull();
    // A city row of another country never matches.
    expect(
      resolveTariff(
        [row('sa-city', { service: 'COD_CARRIER', city: 'Riyadh', amount: 9 })],
        egypt,
        'COD_CARRIER',
      ),
    ).toBeNull();
  });

  it('destination key: all = "*", country, country|lower(trimmed city)', () => {
    expect(destinationKeyOf(null, '')).toBe('*');
    expect(destinationKeyOf(EG, '')).toBe(EG);
    expect(destinationKeyOf(EG, '  Cairo ')).toBe(`${EG}|cairo`);
    expect(destinationKeyOf(EG, 'CAIRO')).toBe(destinationKeyOf(EG, 'cairo'));
  });

  it('submission: equal fee on every channel confirms; otherwise pending with the carrier estimate', () => {
    expect(
      resolveSubmissionTariff(WORKED, dest, 'CASH_ON_DELIVERY'),
    ).toMatchObject({
      status: 'PENDING_METHOD',
      estimateChannel: 'CARRIER',
      tariff: { amount: 35, service: 'COD_CARRIER' },
      byChannel: {
        CARRIER: { id: 'cod-carrier' },
        INTERNAL_COURIER: { id: 'cod-internal' },
      },
    });
    // Prepaid: internal courier missing → pending, estimate = carrier 25.
    expect(resolveSubmissionTariff(WORKED, dest, 'PREPAID')).toMatchObject({
      status: 'PENDING_METHOD',
      estimateChannel: 'CARRIER',
      tariff: { amount: 25 },
      byChannel: { INTERNAL_COURIER: null },
    });
    // Only the internal courier resolves → it is the first resolvable.
    const internalOnly = [WORKED[2]];
    expect(
      resolveSubmissionTariff(internalOnly, dest, 'CASH_ON_DELIVERY'),
    ).toMatchObject({
      status: 'PENDING_METHOD',
      estimateChannel: 'INTERNAL_COURIER',
      tariff: { amount: 25 },
    });
    const equal = [
      row('a', { service: 'PREPAID_CARRIER', amount: 30 }),
      row('b', { service: 'PREPAID_INTERNAL_COURIER', amount: 30 }),
    ];
    expect(resolveSubmissionTariff(equal, dest, 'PREPAID')?.status).toBe(
      'CONFIRMED',
    );
    expect(resolveSubmissionTariff([], dest, 'PREPAID')).toBeNull();
  });

  it('coverage matrix: one row per named destination, inherited cells marked, missing combinations listed', () => {
    // spec-w3 §7 agreement: COD carrier Egypt 60, COD courier Cairo 40,
    // prepaid carrier all destinations 70.
    const rows: TariffRow[] = [
      { id: 'eg', service: 'COD_CARRIER', countryId: EG, city: '', amount: 60 },
      {
        id: 'cairo',
        service: 'COD_INTERNAL_COURIER',
        countryId: EG,
        city: 'Cairo',
        amount: 40,
      },
      {
        id: 'all',
        service: 'PREPAID_CARRIER',
        countryId: null,
        city: '',
        amount: 70,
      },
    ];
    const coverage = shippingAgreementCoverage(rows);
    expect(coverage.destinations.map((d) => [d.key, d.scope])).toEqual([
      ['*', 'ALL'],
      [EG, 'COUNTRY'],
      [`${EG}|cairo`, 'CITY'],
    ]);
    const cairo = coverage.destinations[2].cells;
    expect(cairo.COD_INTERNAL_COURIER).toEqual({
      rateId: 'cairo',
      amount: 40,
      inherited: false,
    });
    expect(cairo.COD_CARRIER).toEqual({
      rateId: 'eg',
      amount: 60,
      inherited: true,
    });
    expect(cairo.PREPAID_CARRIER).toMatchObject({
      amount: 70,
      inherited: true,
    });
    expect(cairo.PREPAID_INTERNAL_COURIER).toBeNull();
    expect(coverage.complete).toBe(false);
    expect(
      coverage.missing.map((m) => `${m.destinationKey}:${m.service}`),
    ).toEqual([
      '*:COD_CARRIER',
      '*:COD_INTERNAL_COURIER',
      '*:PREPAID_INTERNAL_COURIER',
      `${EG}:COD_INTERNAL_COURIER`,
      `${EG}:PREPAID_INTERNAL_COURIER`,
      `${EG}|cairo:PREPAID_INTERNAL_COURIER`,
    ]);
    expect(shippingAgreementCoverage([])).toEqual({
      destinations: [],
      missing: [],
      complete: true,
    });
  });

  it('maps the shipping company type to the delivery channel', () => {
    expect(deliveryChannelOf('EXTERNAL_COMPANY')).toBe('CARRIER');
    expect(deliveryChannelOf('INTERNAL_DELIVERY')).toBe('INTERNAL_COURIER');
  });
});

describe('customer-side effect of the confirmed fee (spec 2B)', () => {
  it.each([
    ['below the fee (company bears 20)', 80],
    ['above the fee (company keeps 20)', 120],
  ])(
    'O1 — a manual customer shipping charge %s stays exactly as agreed',
    (_label, manual) => {
      for (const mode of ['SHIPPING_ADDED', 'SHIPPING_INCLUDED'] as const) {
        const result = repriceForConfirmedFee({
          mode,
          merchandiseAmount: 1000,
          taxAmount: 0,
          serviceCharge: 0,
          shippingCharge: manual,
          payableTotal: 1000 + manual,
          lines: [{ id: 'a', quantity: 1, amount: 1000 }],
          fee: 100,
          manualShippingCharge: true,
        });
        expect(result).toEqual({
          kind: 'APPLY',
          shippingCharge: manual,
          merchandiseAmount: 1000,
          payableTotal: 1000 + manual,
          lines: null,
          discountAmount: null,
        });
      }
    },
  );

  it('INCLUDED: agreed total 500, fee 35 → merchandise 465, shipping 35, total unchanged', () => {
    const result = repriceForConfirmedFee({
      mode: 'SHIPPING_INCLUDED',
      merchandiseAmount: 475,
      taxAmount: 0,
      serviceCharge: 0,
      shippingCharge: 25,
      payableTotal: 500,
      lines: [
        { id: 'a', quantity: 1, amount: 300 },
        { id: 'b', quantity: 3, amount: 175 },
      ],
      fee: 35,
    });
    expect(result).toMatchObject({
      kind: 'APPLY',
      shippingCharge: 35,
      merchandiseAmount: 465,
      payableTotal: 500,
    });
    if (result.kind !== 'APPLY') throw new Error('expected APPLY');
    const lines = result.lines!;
    expect(lines.reduce((s, l) => s + Math.round(l.amount * 100), 0)).toBe(
      46_500,
    );
    expect(lines[1].unitPrice).toBeCloseTo(lines[1].amount / 3, 2);
  });

  it('INCLUDED: a 0 line stays 0 and the discount follows the list price (list 500: 475 → 465 ⇒ discount 35)', () => {
    const result = repriceForConfirmedFee({
      mode: 'SHIPPING_INCLUDED',
      merchandiseAmount: 475,
      taxAmount: 0,
      serviceCharge: 0,
      shippingCharge: 25,
      payableTotal: 500,
      lines: [
        { id: 'a', quantity: 1, amount: 475, listAmount: 500 },
        { id: 'gift', quantity: 1, amount: 0, listAmount: null },
      ],
      fee: 35,
    });
    if (result.kind !== 'APPLY') throw new Error('expected APPLY');
    expect(result.lines).toEqual([
      { id: 'a', amount: 465, unitPrice: 465 },
      { id: 'gift', amount: 0, unitPrice: 0 },
    ]);
    expect(result.discountAmount).toBe(35);
  });

  it('INCLUDED: a fee leaving no merchandise room is refused with both amounts', () => {
    expect(
      repriceForConfirmedFee({
        mode: 'SHIPPING_INCLUDED',
        merchandiseAmount: 20,
        taxAmount: 0,
        serviceCharge: 10,
        shippingCharge: 10,
        payableTotal: 40,
        lines: [{ id: 'a', quantity: 1, amount: 20 }],
        fee: 30,
      }),
    ).toEqual({
      kind: 'REFUSED',
      code: 'AGENT_SHIPPING_EXCEEDS_TOTAL',
      agreedTotal: 40,
      fee: 30,
    });
  });

  it('ADDED: a higher payable needs the customer (425 → 435); lower applies at once', () => {
    const base = {
      mode: 'SHIPPING_ADDED' as const,
      merchandiseAmount: 400,
      taxAmount: 0,
      serviceCharge: 0,
      lines: [{ id: 'a', quantity: 1, amount: 400 }],
    };
    expect(
      repriceForConfirmedFee({
        ...base,
        shippingCharge: 25,
        payableTotal: 425,
        fee: 35,
      }),
    ).toEqual({
      kind: 'CONFIRMATION_REQUIRED',
      proposedShippingCharge: 35,
      proposedPayableTotal: 435,
    });
    expect(
      repriceForConfirmedFee({
        ...base,
        shippingCharge: 35,
        payableTotal: 435,
        fee: 25,
      }),
    ).toEqual({
      kind: 'APPLY',
      shippingCharge: 25,
      merchandiseAmount: 400,
      payableTotal: 425,
      lines: null,
      discountAmount: null,
    });
  });
});

describe('shipping pricing view and internal economics (spec 2B/2E)', () => {
  const snapshot = {
    agentShippingCharge: {
      amount: 25,
      source: 'TARIFF',
      rateId: 'r',
      provisional: false,
      deliveryChannel: 'CARRIER',
      paymentType: 'PREPAID',
    },
    customerTotalChange: {
      previousShippingCharge: 25,
      previousPayableTotal: 425,
      proposedShippingCharge: 35,
      proposedPayableTotal: 435,
      requestedAt: '2026-09-30T00:00:00.000Z',
      confirmedAt: '2026-09-30T01:00:00.000Z',
    },
  };

  it('margin = contractual fee − confirmed carrier cost (25 − 20 = 5); estimate when nothing is confirmed', () => {
    const confirmed = agentShippingEconomics(
      { agentTermsSnapshot: snapshot },
      'SAR',
      [
        {
          baseShippingCost: 18,
          additionalShippingCost: null,
          carrierCharges: [
            {
              chargeAmount: 22,
              chargeKind: 'BASE',
              reconciliationState: 'CONFIRMED',
              currency: { code: 'SAR' },
            },
            {
              chargeAmount: 2,
              chargeKind: 'CREDIT',
              reconciliationState: 'CONFIRMED',
              currency: { code: 'SAR' },
            },
          ],
        },
      ],
    );
    expect(confirmed.margin).toEqual({ amount: 5, basis: 'ACTUAL' });
    const estimated = agentShippingEconomics(
      { agentTermsSnapshot: snapshot },
      'SAR',
      [{ baseShippingCost: 18, additionalShippingCost: 1, carrierCharges: [] }],
    );
    expect(estimated.margin).toEqual({ amount: 6, basis: 'ESTIMATE' });
    const otherCurrency = agentShippingEconomics(
      { agentTermsSnapshot: snapshot },
      'SAR',
      [
        {
          baseShippingCost: null,
          additionalShippingCost: null,
          carrierCharges: [
            {
              chargeAmount: 5,
              chargeKind: 'BASE',
              reconciliationState: 'CONFIRMED',
              currency: { code: 'USD' },
            },
          ],
        },
      ],
    );
    expect(otherCurrency.margin).toEqual({ amount: null, basis: null });
    // O1 — internal economics show C, F and the company's difference.
    const short = agentShippingEconomics(
      { agentTermsSnapshot: snapshot, shippingCharge: 20 },
      'SAR',
      [],
    );
    expect(short.customerShipping).toBe(20);
    expect(short.contractualFee).toBe(25);
    expect(short.difference).toEqual({ amount: -5, borneBy: 'COMPANY' });
    expect(
      agentShippingEconomics({ agentTermsSnapshot: snapshot }, 'SAR', [])
        .difference,
    ).toBeNull();
  });

  it('view: paid vs new payable → outstanding, and no carrier/margin keys', () => {
    const view = agentShippingPricingView(
      {
        shippingPricingStatus: 'CONFIRMED',
        customerTotalStatus: 'CONFIRMED',
        agentTermsSnapshot: snapshot,
        pricingMode: 'SHIPPING_ADDED',
        merchandiseAmount: 400,
        shippingCharge: 35,
        payableTotal: 435,
        declaredAmount: 0,
      },
      425,
    );
    expect(view).toMatchObject({
      paidAmount: 425,
      outstanding: 10,
      agentShippingFee: { amount: 25, provisional: false },
      customerTotalChange: { proposedPayableTotal: 435 },
    });
    expect(leakedKeys(view)).toEqual([]);
  });
});
