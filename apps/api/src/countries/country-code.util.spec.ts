import {
  isValidCountryCode,
  isValidCountryIso3,
  normalizeIsoCode,
} from './country-code.util';

describe('country code validation (ISO 3166-1)', () => {
  const valid = (raw: string) => isValidCountryCode(normalizeIsoCode(raw));

  it('accepts two Latin letters after trim + upper-case', () => {
    expect(valid('SA')).toBe(true);
    expect(valid(' sa ')).toBe(true);
    expect(normalizeIsoCode(' eg')).toBe('EG');
  });

  it('rejects Arabic diacritics prepended to a valid code (the "ٍِSA" duplicate)', () => {
    expect(valid('ٍِSA')).toBe(false);
  });

  it('rejects wrong length, digits, Arabic letters and punctuation', () => {
    for (const raw of ['S', 'SAU', 'S1', '12', 'سع', 'S-', 'S A', '']) {
      expect(valid(raw)).toBe(false);
    }
  });

  it('validates ISO3 as exactly three Latin letters', () => {
    expect(isValidCountryIso3(normalizeIsoCode('sau'))).toBe(true);
    expect(isValidCountryIso3('SA')).toBe(false);
    expect(isValidCountryIso3('SA1')).toBe(false);
  });
});
