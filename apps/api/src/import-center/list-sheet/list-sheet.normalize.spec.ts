import {
  normalizeListValues,
  normalizeReferenceValue,
} from './list-sheet.normalize';

describe('normalizeListValues', () => {
  it('trims, collapses whitespace, drops empties, and deduplicates', () => {
    expect(
      normalizeListValues([
        '  Saudi Arabia  ',
        'Saudi  Arabia',
        '',
        '   ',
        null,
        'Egypt',
        'egypt',
      ]),
    ).toEqual(['Egypt', 'Saudi Arabia']);
  });

  it('preserves Arabic and does not transliterate', () => {
    expect(normalizeListValues(['أهم 5000 كلمة', '  أهم 5000 كلمة '])).toEqual([
      'أهم 5000 كلمة',
    ]);
  });

  it('preserves emails and currency codes', () => {
    expect(normalizeListValues(['SAR', ' employee@example.com '])).toEqual([
      'employee@example.com',
      'SAR',
    ]);
  });
});

describe('normalizeReferenceValue', () => {
  it('trims and collapses whitespace without changing Arabic letters', () => {
    expect(normalizeReferenceValue('  منتج   اختبار  ')).toBe('منتج اختبار');
  });
});
