import { personNameKey } from './person-name';

describe('personNameKey (Spec 1B name-only duplicate match)', () => {
  const same = (a: string, b: string) =>
    expect(personNameKey(a)).toBe(personNameKey(b));

  it('treats alef / hamza-on-alef forms as one letter', () => {
    same('أحمد', 'احمد');
    same('إبراهيم', 'ابراهيم');
    same('آمنة', 'امنه');
    same('ٱلسيد', 'السيد');
  });

  it('treats ya / alef maqsura and ta marbuta / ha as equal', () => {
    same('مصطفى', 'مصطفي');
    same('فاطمة', 'فاطمه');
  });

  it('folds hamza carriers and drops a standalone hamza', () => {
    same('مؤمن', 'مومن');
    same('هانئ', 'هاني');
    same('علاء', 'علا');
  });

  it('ignores diacritics and tatweel', () => {
    same('مُحَمَّد', 'محمد');
    same('محـــمد', 'محمد');
  });

  it('ignores whitespace and case', () => {
    same('عبد الله', 'عبدالله');
    same('  Ahmed   Ali ', 'ahmed ali');
    same('AHMED ALI', 'ahmedali');
  });

  it('keeps different names different', () => {
    expect(personNameKey('أحمد علي')).not.toBe(personNameKey('أحمد عمر'));
    expect(personNameKey('Sara')).not.toBe(personNameKey('Sarah'));
  });

  it('returns an empty key for empty input', () => {
    expect(personNameKey('')).toBe('');
    expect(personNameKey(null)).toBe('');
    expect(personNameKey('   ')).toBe('');
  });
});
