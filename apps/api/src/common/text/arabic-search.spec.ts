import {
  containsArabic,
  escapeLikePattern,
  normalizeArabicSearch,
} from './arabic-search';

describe('normalizeArabicSearch', () => {
  it('folds alef variants أ إ آ ٱ to ا', () => {
    expect(normalizeArabicSearch('أحمد')).toBe('احمد');
    expect(normalizeArabicSearch('إبراهيم')).toBe('ابراهيم');
    expect(normalizeArabicSearch('آمنة')).toBe('امنه');
    expect(normalizeArabicSearch('ٱلله')).toBe('الله');
  });

  it('folds taa marbuta to haa and alef maqsura to yaa', () => {
    expect(normalizeArabicSearch('السعودية')).toBe(
      normalizeArabicSearch('السعوديه'),
    );
    expect(normalizeArabicSearch('مصطفى')).toBe('مصطفي');
  });

  it('strips tashkeel, superscript alef and tatweel', () => {
    expect(normalizeArabicSearch('مُحَمَّد')).toBe('محمد');
    expect(normalizeArabicSearch('رحمٰن')).toBe('رحمن');
    expect(normalizeArabicSearch('مـحـمـد')).toBe('محمد');
    expect(normalizeArabicSearch('ٍِSA')).toBe('sa');
  });

  it('makes "أحمد محمد صالح" and "احمد محمد صالح" equal, collapsing whitespace', () => {
    expect(normalizeArabicSearch('  أحمد   محمد صالح ')).toBe(
      normalizeArabicSearch('احمد محمد صالح'),
    );
  });

  it('lower-cases Latin text and leaves digits/symbols alone', () => {
    expect(normalizeArabicSearch('Saudi Arabia')).toBe('saudi arabia');
    expect(normalizeArabicSearch('+966')).toBe('+966');
  });
});

describe('containsArabic / escapeLikePattern', () => {
  it('detects Arabic text', () => {
    expect(containsArabic('سعودية')).toBe(true);
    expect(containsArabic('Saudi')).toBe(false);
  });

  it('escapes LIKE wildcards', () => {
    expect(escapeLikePattern('50%_a')).toBe(String.raw`50\%\_a`);
  });
});
