import {
  deriveNativeAmount,
  findCurrencyMismatches,
  readAccountCurrencyPolicy,
} from './account-currency';
import { buildNativeLedger } from '../reports/account-native-ledger';

const SAR = 'sar';
const EGP = 'egp';
const USD = 'usd';

describe('account-currency policy', () => {
  it('defaults to WARN; OFF and BLOCK are opt-in; junk falls back to WARN', () => {
    expect(readAccountCurrencyPolicy({})).toBe('WARN');
    expect(
      readAccountCurrencyPolicy({ ACCOUNT_CURRENCY_POLICY: 'block' }),
    ).toBe('BLOCK');
    expect(
      readAccountCurrencyPolicy({ ACCOUNT_CURRENCY_POLICY: ' off ' }),
    ).toBe('OFF');
    expect(
      readAccountCurrencyPolicy({ ACCOUNT_CURRENCY_POLICY: 'maybe' }),
    ).toBe('WARN');
  });

  const sarBank = { id: 'a1', code: '1110', currencyId: SAR };
  const egpBank = { id: 'a2', code: '1120', currencyId: EGP };
  const unbound = { id: 'a3', code: '4000', currencyId: null };

  it('flags a currency-bound foreign account hit by an entry in another currency', () => {
    expect(findCurrencyMismatches([sarBank], USD, EGP)).toHaveLength(1);
    // A functional (EGP) entry has no native SAR amount either.
    expect(findCurrencyMismatches([sarBank], null, EGP)).toHaveLength(1);
    expect(findCurrencyMismatches([sarBank], EGP, EGP)).toHaveLength(1);
  });

  it('does not flag matching, functional-bound or unbound accounts', () => {
    expect(findCurrencyMismatches([sarBank], SAR, EGP)).toEqual([]);
    // Lines are functional amounts, so a functional-bound account never mismatches.
    expect(findCurrencyMismatches([egpBank], SAR, EGP)).toEqual([]);
    expect(findCurrencyMismatches([unbound], SAR, EGP)).toEqual([]);
    expect(findCurrencyMismatches([sarBank], USD, null)).toEqual([]);
  });
});

describe('deriveNativeAmount', () => {
  it('derives (debit − credit) ÷ header rate only for an entry in the account currency', () => {
    expect(
      deriveNativeAmount(
        1393.61,
        { currencyId: SAR, exchangeRate: 13.9361 },
        SAR,
      ),
    ).toEqual({ status: 'PROVEN', amount: 100, rate: 13.9361 });
    expect(
      deriveNativeAmount(-250, { currencyId: SAR, exchangeRate: '12.5' }, SAR)
        .amount,
    ).toBe(-20);
  });

  it('never guesses: other currency or no recorded rate is unproven', () => {
    expect(
      deriveNativeAmount(100, { currencyId: USD, exchangeRate: 50 }, SAR),
    ).toEqual({ status: 'ENTRY_CURRENCY_DIFFERS', amount: null, rate: null });
    expect(
      deriveNativeAmount(100, { currencyId: null, exchangeRate: null }, SAR)
        .status,
    ).toBe('ENTRY_CURRENCY_DIFFERS');
    expect(
      deriveNativeAmount(100, { currencyId: SAR, exchangeRate: null }, SAR)
        .status,
    ).toBe('NO_RATE_RECORDED');
    expect(
      deriveNativeAmount(100, { currencyId: SAR, exchangeRate: 0 }, SAR).status,
    ).toBe('NO_RATE_RECORDED');
  });

  it('a zero line is trivially proven', () => {
    expect(
      deriveNativeAmount(0, { currencyId: null, exchangeRate: null }, SAR)
        .amount,
    ).toBe(0);
  });
});

describe('buildNativeLedger', () => {
  const entry = (rate: number) => ({ currencyId: SAR, exchangeRate: rate });

  it('native balance is the sum of native amounts at each date’s rate, not the closing at one rate', () => {
    const ledger = buildNativeLedger({
      accountCurrencyId: SAR,
      currencyCode: 'SAR',
      functionalCurrencyCode: 'EGP',
      openingLines: [{ debit: 1390, credit: 0, entry: entry(13.9) }], // 100 SAR
      periodLines: [
        { lineId: 'l1', debit: 2770, credit: 0, entry: entry(13.85) }, // 200 SAR
        { lineId: 'l2', debit: 0, credit: 698.5, entry: entry(13.97) }, // −50 SAR
      ],
    });
    expect(ledger.openingBalance).toBe(100);
    expect(ledger.periodDebit).toBe(200);
    expect(ledger.periodCredit).toBe(50);
    expect(ledger.closingBalance).toBe(250);
    expect(ledger.movements.map((m) => m.runningBalance)).toEqual([300, 250]);
    expect(ledger.complete).toBe(true);
    // Functional closing is 1390 + 2770 − 698.5 = 3461.5; at the latest rate
    // 250 SAR would be 3492.5 — the two must not be conflated.
    expect(250 * 13.97).not.toBe(1390 + 2770 - 698.5);
  });

  it('counts unproven lines honestly instead of guessing', () => {
    const ledger = buildNativeLedger({
      accountCurrencyId: SAR,
      currencyCode: 'SAR',
      functionalCurrencyCode: 'EGP',
      openingLines: [],
      periodLines: [
        { lineId: 'l1', debit: 1390, credit: 0, entry: entry(13.9) },
        {
          lineId: 'l2',
          debit: 500,
          credit: 0,
          entry: { currencyId: null, exchangeRate: null },
        },
      ],
    });
    expect(ledger.closingBalance).toBe(100);
    expect(ledger.complete).toBe(false);
    expect(ledger.unprovenLineCount).toBe(1);
    expect(ledger.unprovenFunctionalAmount).toBe(500);
    expect(ledger.movements[1]).toMatchObject({
      status: 'ENTRY_CURRENCY_DIFFERS',
      runningBalance: null,
    });
  });
});
