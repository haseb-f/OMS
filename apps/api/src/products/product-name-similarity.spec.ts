import {
  bestNameMatch,
  classifyNameMatch,
  compareNameMatches,
  normalizeProductName,
} from './product-name-similarity';

describe('normalizeProductName', () => {
  it('folds case, spaces and punctuation', () => {
    expect(normalizeProductName('  USB-C   Cable  ')).toBe('usb c cable');
  });

  it('applies the shared Arabic normalization (alef / taa marbuta / diacritics)', () => {
    expect(normalizeProductName('أحمد')).toBe(normalizeProductName('احمد'));
    expect(normalizeProductName('مَدرسة')).toBe(normalizeProductName('مدرسه'));
  });
});

describe('classifyNameMatch', () => {
  const n = normalizeProductName;

  it('EXACT for the same normalized text', () => {
    expect(classifyNameMatch(n('Cable USB'), n('cable  usb'))).toBe('EXACT');
    expect(classifyNameMatch(n('احمد'), n('أحمد'))).toBe('EXACT');
  });

  it('CONTAINS when one name holds the other (from 4 characters)', () => {
    expect(
      classifyNameMatch(n('samsung galaxy'), n('Samsung Galaxy S24')),
    ).toBe('CONTAINS');
    expect(
      classifyNameMatch(n('Samsung Galaxy S24 Ultra'), n('Samsung Galaxy S24')),
    ).toBe('CONTAINS');
  });

  it('does not report CONTAINS for fragments shorter than 4 characters', () => {
    expect(classifyNameMatch('usb', 'usb cable')).toBeNull();
    expect(classifyNameMatch('cable usb', 'usb')).toBeNull();
  });

  it('SIMILAR for mostly the same words in another order', () => {
    expect(
      classifyNameMatch(n('usb cable black'), n('black usb cable 2m')),
    ).toBe('SIMILAR');
  });

  it('SIMILAR for a near-typo of the whole name', () => {
    expect(classifyNameMatch(n('Samsnug charger'), n('Samsung charger'))).toBe(
      'SIMILAR',
    );
  });

  it('null for unrelated names and empty input', () => {
    expect(classifyNameMatch(n('Notebook A4'), n('Garden hose'))).toBeNull();
    expect(classifyNameMatch('', 'x')).toBeNull();
    expect(classifyNameMatch('x', '')).toBeNull();
  });
});

describe('bestNameMatch / compareNameMatches', () => {
  it('takes the strongest match across the name columns and ignores blanks', () => {
    expect(
      bestNameMatch(normalizeProductName('Widget Pro'), [
        'Widget Pro Max',
        null,
        'widget pro',
      ]),
    ).toBe('EXACT');
    expect(bestNameMatch('widget', [undefined, null])).toBeNull();
  });

  it('ranks EXACT before CONTAINS before SIMILAR, then same-category first', () => {
    const rows = [
      { id: 'a', match: 'SIMILAR' as const, sameCategory: true },
      { id: 'b', match: 'EXACT' as const, sameCategory: false },
      { id: 'c', match: 'CONTAINS' as const, sameCategory: false },
      { id: 'd', match: 'CONTAINS' as const, sameCategory: true },
    ];
    expect([...rows].sort(compareNameMatches).map((r) => r.id)).toEqual([
      'b',
      'd',
      'c',
      'a',
    ]);
  });
});
