import * as fs from 'fs';
import * as path from 'path';
import {
  parseCbeDate,
  parseCbeHistorical,
  parseCbeHistoricalForm,
  parseCbeLatest,
  toCbeDate,
} from './cbe-parser';
import { FxProviderError } from './fx-provider.types';
import { rateForBasis } from '../fx-sync.service';

const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8');

/** No network: every case runs against HTML saved from cbe.org.eg. */
describe('CBE official rates parser', () => {
  const latest = fixture('cbe-latest.html');

  it('reads the "Rates for Date" line and all 18 published currencies', () => {
    const parsed = parseCbeLatest(latest);
    expect(parsed.effectiveDates).toEqual(['2026-09-24']);
    expect(parsed.quotes).toHaveLength(18);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.quotes.map((q) => q.code)).toEqual(
      expect.arrayContaining(['USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'JPY']),
    );
  });

  it('keeps buy/sell exactly and derives mid = (buy + sell) / 2', () => {
    const usd = parseCbeLatest(latest).quotes.find((q) => q.code === 'USD')!;
    expect(usd).toMatchObject({
      label: 'US Dollar',
      effectiveDate: '2026-09-24',
      buy: '51.7144',
      sell: '51.852',
      unitDivisor: 1,
    });
    expect(rateForBasis(usd, 'MID').toString()).toBe('51.7832');
    expect(rateForBasis(usd, 'BUY').toString()).toBe('51.7144');
    expect(rateForBasis(usd, 'SELL').toString()).toBe('51.852');
  });

  it('scales "Japanese Yen 100" to a per-unit rate', () => {
    const jpy = parseCbeLatest(latest).quotes.find((q) => q.code === 'JPY')!;
    expect(jpy.label).toBe('Japanese Yen 100');
    expect(jpy.unitDivisor).toBe(100);
    expect(jpy.buy).toBe('0.32576');
    expect(jpy.sell).toBe('0.326647');
    expect(rateForBasis(jpy, 'MID').toString()).toBe('0.3262035');
  });

  it('parses dd/MM/yyyy strictly', () => {
    expect(parseCbeDate('24/09/2026')).toBe('2026-09-24');
    expect(toCbeDate('2026-09-24')).toBe('24/09/2026');
    expect(() => parseCbeDate('2026-09-24')).toThrow(FxProviderError);
    expect(() => parseCbeDate('31/02/2026')).toThrow(/impossible date/);
  });

  describe('rejects a malformed page as a whole (nothing may be stored)', () => {
    it('missing date line', () => {
      expect(() =>
        parseCbeLatest(latest.replace(/Rates for Date:[^<]*/, '')),
      ).toThrow(/Rates for Date/);
    });

    it('changed headers', () => {
      expect(() =>
        parseCbeLatest(latest.replace(/>\s*Buy\s*</, '>Bid<')),
      ).toThrow(/unexpected table headers/);
    });

    it('non-decimal value', () => {
      expect(() =>
        parseCbeLatest(latest.replace('51.7144', '51,7144')),
      ).toThrow(/non-decimal/);
    });

    it('buy above sell', () => {
      expect(() =>
        parseCbeLatest(latest.replace('51.7144', '52.9999')),
      ).toThrow(/buy ≤ sell/);
    });

    it('a required currency missing', () => {
      const withoutUsd = latest.replace(
        /<tr class="content-height">\s*<td[^>]*>\s*US Dollar[\s\S]*?<\/tr>/,
        '',
      );
      expect(() => parseCbeLatest(withoutUsd)).toThrow(
        /required currencies missing: USD/,
      );
    });

    it('no rates table (e.g. a WAF block page)', () => {
      expect(() =>
        parseCbeLatest('<html><body>Request Rejected</body></html>'),
      ).toThrow(FxProviderError);
    });
  });

  it('skips (and reports) an unknown label instead of guessing an ISO code', () => {
    const drifted = latest.replace('Chinese Yuan', 'Martian Credit');
    const parsed = parseCbeLatest(drifted);
    expect(parsed.quotes.some((q) => q.code === 'CNY')).toBe(false);
    expect(parsed.warnings[0]).toMatch(/Martian Credit/);
  });

  it('parses the historical fragment (Date | Currency | Buy | Sell)', () => {
    const parsed = parseCbeHistorical(fixture('cbe-historical.html'));
    expect(parsed.effectiveDates).toEqual([
      '2026-09-24',
      '2026-09-23',
      '2026-09-22',
    ]);
    const usd23 = parsed.quotes.find(
      (q) => q.code === 'USD' && q.effectiveDate === '2026-09-23',
    )!;
    expect(usd23.buy).toBe('51.3606');
    expect(usd23.sell).toBe('51.4956');
    const jpy = parsed.quotes.filter((q) => q.code === 'JPY');
    expect(jpy).toHaveLength(3);
    expect(Number(jpy[0].buy)).toBeLessThan(1);
  });

  it('treats "no matching results" as an empty (not failed) historical payload', () => {
    const parsed = parseCbeHistorical(
      '<div id="api-data"><div class="status-container"><p>There are no matching results.</p></div></div>',
    );
    expect(parsed.quotes).toEqual([]);
  });

  it('extracts the historical form token and CMS ids', () => {
    const form = parseCbeHistoricalForm(fixture('cbe-historical-form.html'));
    expect(form.action).toBe('/api/statistics/GetHistoricalData');
    expect(form.fields.__RequestVerificationToken).toBe('FIXTURE_TOKEN_abc123');
    expect(form.fields.DataSourceId).toBe('19CFFDDBFF494350A5E9C6A4397FC7DF');
    expect(form.fields.LanguageName).toBe('en');
  });
});
