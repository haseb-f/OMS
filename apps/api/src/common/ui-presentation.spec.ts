/**
 * Contract tests for OMS display date + bidi rules.
 * Mirrors apps/web/src/lib/date.ts and apps/web/src/lib/bidi.ts so the
 * Jest suite can enforce presentation without a React test runner.
 */

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const ARABIC_SCRIPT =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }
    return date;
  }

  const midnightUtc = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(\.\d+)?Z$/i.exec(
    trimmed,
  );
  if (midnightUtc) {
    const year = Number(midnightUtc[1]);
    const month = Number(midnightUtc[2]);
    const day = Number(midnightUtc[3]);
    return new Date(year, month - 1, day);
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDisplayDate(value: Date | string | null | undefined): string {
  const date = toDate(value);
  if (!date) return '';
  return `${pad2(date.getDate())} ${MONTH_ABBR[date.getMonth()]} ${date.getFullYear()}`;
}

function formatDisplayDateTime(
  value: Date | string | null | undefined,
): string {
  const date = toDate(value);
  if (!date) return '';
  return `${formatDisplayDate(date)} — ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function hasClockTime(value: Date | string | null | undefined): boolean {
  if (value == null) return false;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;
    if (/T00:00:00(\.\d+)?Z?$/i.test(trimmed)) return false;
  }
  const date = toDate(value);
  if (!date) return false;
  return (
    date.getHours() !== 0 || date.getMinutes() !== 0 || date.getSeconds() !== 0
  );
}

function detectTextDirection(value: string): 'rtl' | 'ltr' {
  for (const char of value) {
    if (ARABIC_SCRIPT.test(char)) return 'rtl';
    if (/[A-Za-z0-9]/.test(char)) return 'ltr';
  }
  return 'ltr';
}

describe('Display date format (DD MMM YYYY)', () => {
  it('formats calendar date-only values without UTC shift', () => {
    expect(formatDisplayDate('2026-09-05')).toBe('05 Sep 2026');
    expect(formatDisplayDate('2026-08-27')).toBe('27 Aug 2026');
    expect(formatDisplayDate('2027-01-03')).toBe('03 Jan 2027');
  });

  it('keeps midnight-UTC date-only timestamps on the calendar day', () => {
    expect(formatDisplayDate('2026-09-05T00:00:00.000Z')).toBe('05 Sep 2026');
  });

  it('formats datetimes with an em dash separator', () => {
    expect(formatDisplayDateTime('2026-09-05T14:35:00')).toBe(
      '05 Sep 2026 — 14:35',
    );
  });

  it('does not invent clock time for date-only values', () => {
    expect(hasClockTime('2026-09-05')).toBe(false);
    expect(hasClockTime('2026-09-05T00:00:00.000Z')).toBe(false);
    expect(hasClockTime('2026-09-05T14:35:00')).toBe(true);
  });
});

describe('Bidi text direction helpers', () => {
  it('marks Arabic prose as rtl', () => {
    expect(detectTextDirection('السعودية')).toBe('rtl');
    expect(detectTextDirection('أحمد محمد')).toBe('rtl');
  });

  it('marks English / codes as ltr', () => {
    expect(detectTextDirection('MANUAL')).toBe('ltr');
    expect(detectTextDirection('Google Sheets')).toBe('ltr');
    expect(detectTextDirection('LD-2026-000001')).toBe('ltr');
    expect(detectTextDirection('+966570267876')).toBe('ltr');
  });

  it('starts mixed Arabic+Latin content as rtl when Arabic leads', () => {
    expect(detectTextDirection('بوكس أهم 5000 كلمة — PRD-2026-000004')).toBe(
      'rtl',
    );
  });
});
