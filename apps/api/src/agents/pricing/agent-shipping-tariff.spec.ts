import {
  deliveryChannelOf,
  resolveSubmissionTariff,
  resolveTariff,
  type TariffRow,
} from './agent-shipping-tariff';
import { repriceForConfirmedFee } from './agent-shipping-reprice';
import {
  agentShippingEconomics,
  agentShippingPricingView,
} from './agent-shipping-pricing-view';
import { leakedKeys } from './leaked-keys.test-util';

const SA = 'country-sa';
const row = (
  id: string,
  over: Partial<TariffRow> & Pick<TariffRow, 'amount'>,
): TariffRow => ({
  id,
  countryId: SA,
  city: '',
  deliveryChannel: 'ANY',
  paymentType: 'ANY',
  ...over,
});

/** spec-2-agent-pricing.md worked tariff (SAR). */
const WORKED: TariffRow[] = [
  row('prepaid-carrier', {
    deliveryChannel: 'CARRIER',
    paymentType: 'PREPAID',
    amount: 25,
  }),
  row('cod-carrier', {
    deliveryChannel: 'CARRIER',
    paymentType: 'CASH_ON_DELIVERY',
    amount: 35,
  }),
  row('cod-internal', {
    deliveryChannel: 'INTERNAL_COURIER',
    paymentType: 'CASH_ON_DELIVERY',
    amount: 25,
  }),
];
const dest = { countryId: SA, city: 'Riyadh' };

describe('agent shipping tariff resolution (spec 2B)', () => {
  it('worked tariff: prepaid carrier 25, COD carrier 35, COD internal 25, prepaid internal unresolved', () => {
    expect(resolveTariff(WORKED, dest, 'CARRIER', 'PREPAID')?.amount).toBe(25);
    expect(
      resolveTariff(WORKED, dest, 'CARRIER', 'CASH_ON_DELIVERY')?.amount,
    ).toBe(35);
    expect(
      resolveTariff(WORKED, dest, 'INTERNAL_COURIER', 'CASH_ON_DELIVERY')
        ?.amount,
    ).toBe(25);
    expect(
      resolveTariff(WORKED, dest, 'INTERNAL_COURIER', 'PREPAID'),
    ).toBeNull();
  });

  it('city beats country, exact channel beats ANY, exact payment type beats ANY', () => {
    const rows: TariffRow[] = [
      row('country-any', { amount: 10 }),
      row('country-carrier', { deliveryChannel: 'CARRIER', amount: 20 }),
      row('country-carrier-cod', {
        deliveryChannel: 'CARRIER',
        paymentType: 'CASH_ON_DELIVERY',
        amount: 30,
      }),
      row('city-any', { city: 'riyadh ', amount: 40 }),
    ];
    // City (even ANY/ANY) wins over every country row.
    expect(resolveTariff(rows, dest, 'CARRIER', 'CASH_ON_DELIVERY')?.id).toBe(
      'city-any',
    );
    const jeddah = { countryId: SA, city: 'Jeddah' };
    expect(resolveTariff(rows, jeddah, 'CARRIER', 'CASH_ON_DELIVERY')?.id).toBe(
      'country-carrier-cod',
    );
    expect(resolveTariff(rows, jeddah, 'CARRIER', 'PREPAID')?.id).toBe(
      'country-carrier',
    );
    expect(resolveTariff(rows, jeddah, 'INTERNAL_COURIER', 'PREPAID')?.id).toBe(
      'country-any',
    );
    // Channel is more specific than payment type.
    const tie: TariffRow[] = [
      row('channel', { deliveryChannel: 'CARRIER', amount: 1 }),
      row('payment', { paymentType: 'PREPAID', amount: 2 }),
    ];
    expect(resolveTariff(tie, jeddah, 'CARRIER', 'PREPAID')?.id).toBe(
      'channel',
    );
    // Another country never matches.
    expect(
      resolveTariff(
        rows,
        { countryId: 'other', city: null },
        'CARRIER',
        'PREPAID',
      ),
    ).toBeNull();
  });

  it('legacy ANY/ANY rows resolve exactly as before (city row, else country row)', () => {
    const legacy: TariffRow[] = [
      row('country', { amount: 100 }),
      row('cairo', { city: 'Cairo', amount: 60 }),
    ];
    const cairo = { countryId: SA, city: 'cairo' };
    expect(resolveTariff(legacy, cairo, 'CARRIER', 'PREPAID')?.amount).toBe(60);
    const other = { countryId: SA, city: 'Giza' };
    expect(
      resolveTariff(legacy, other, 'INTERNAL_COURIER', 'CASH_ON_DELIVERY')
        ?.amount,
    ).toBe(100);
    const submission = resolveSubmissionTariff(legacy, cairo, 'PREPAID');
    expect(submission).toMatchObject({
      status: 'CONFIRMED',
      estimateChannel: null,
    });
    expect(submission?.tariff.amount).toBe(60);
  });

  it('submission: equal fee on every channel confirms; otherwise pending with the carrier estimate', () => {
    expect(
      resolveSubmissionTariff(WORKED, dest, 'CASH_ON_DELIVERY'),
    ).toMatchObject({
      status: 'PENDING_METHOD',
      estimateChannel: 'CARRIER',
      tariff: { amount: 35 },
    });
    // Prepaid: internal courier missing → pending, estimate = carrier 25.
    expect(resolveSubmissionTariff(WORKED, dest, 'PREPAID')).toMatchObject({
      status: 'PENDING_METHOD',
      estimateChannel: 'CARRIER',
      tariff: { amount: 25 },
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
      row('a', { deliveryChannel: 'CARRIER', amount: 30 }),
      row('b', { deliveryChannel: 'INTERNAL_COURIER', amount: 30 }),
    ];
    expect(resolveSubmissionTariff(equal, dest, 'PREPAID')?.status).toBe(
      'CONFIRMED',
    );
    expect(resolveSubmissionTariff([], dest, 'PREPAID')).toBeNull();
  });

  it('maps the shipping company type to the delivery channel', () => {
    expect(deliveryChannelOf('EXTERNAL_COMPANY')).toBe('CARRIER');
    expect(deliveryChannelOf('INTERNAL_DELIVERY')).toBe('INTERNAL_COURIER');
  });
});

describe('customer-side effect of the confirmed fee (spec 2B)', () => {
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
